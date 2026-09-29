package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// Models are deterministic, but every model/tool dispatch, nested runner,
// callback, event and address below is produced by Eino itself.
type nestedRecorderModel struct {
	parent    bool
	parallel  bool
	recovered bool
}

func (*nestedRecorderModel) GetType() string { return "NestedRecorderModel" }
func (m *nestedRecorderModel) WithTools([]*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}
func (*nestedRecorderModel) Stream(context.Context, []*schema.Message, ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, fmt.Errorf("streaming intentionally unsupported")
}
func (m *nestedRecorderModel) Generate(_ context.Context, messages []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	request := ""
	results := map[string]string{}
	for _, message := range messages {
		if message.Role == schema.User {
			request = message.Content
		}
		if message.Role == schema.Tool {
			results[message.ToolCallID] = message.Content
		}
	}
	call := func(id, name, argument, value string) schema.ToolCall {
		return schema.ToolCall{ID: id, Type: "function", Function: schema.FunctionCall{Name: name, Arguments: fmt.Sprintf(`{%q:%q}`, argument, value)}}
	}
	if !m.parent {
		if len(results) == 0 {
			// Reuse is legal across the two independent child invocations.
			return schema.AssistantMessage("", []schema.ToolCall{call("shared-inner-call", "lookup_item", "key", request)}), nil
		}
		if results["shared-inner-call"] != "lookup:"+request {
			return nil, fmt.Errorf("child tool result crossed invocation scope")
		}
		return schema.AssistantMessage("child result:"+request, nil), nil
	}
	if len(results) == 0 {
		if m.parallel {
			return schema.AssistantMessage("", []schema.ToolCall{call("call-child-slow", "worker", "request", "slow"), call("call-child-fast", "worker", "request", "fast")}), nil
		}
		return schema.AssistantMessage("", []schema.ToolCall{call("call-child-one", "worker", "request", request)}), nil
	}
	if m.parallel {
		if results["call-child-slow"] != "child result:slow" || results["call-child-fast"] != "child result:fast" {
			return nil, fmt.Errorf("child answers crossed parent call scope")
		}
		return schema.AssistantMessage("parent final: combined slow and fast", nil), nil
	}
	if m.recovered {
		if results["call-child-one"] != "handled child failure: lookup rejected: failure" {
			return nil, fmt.Errorf("parent did not receive the handled child failure")
		}
		return schema.AssistantMessage("parent final: recovered with fallback", nil), nil
	}
	if results["call-child-one"] != "child result:"+request {
		return nil, fmt.Errorf("parent received an unexpected child answer")
	}
	return schema.AssistantMessage("parent final: reviewed "+request, nil), nil
}

type nestedRecorderTool struct {
	parallel     bool
	slowStarted  chan struct{}
	fastObserved chan struct{}
	mu           sync.Mutex
	addresses    map[string]string
}

// Eino v0.9.19 ChatModelAgent's run closure mutates shared cancel config.
// Keep one logical AgentTool while isolating that upstream mutable instance
// per invocation. The inner runs are still real, concurrent Eino agents.
type nestedRecorderAgentFactory struct {
	tool  *nestedRecorderTool
	calls recorderAtomicCounter
}

func (*nestedRecorderAgentFactory) Name(context.Context) string { return "worker" }
func (*nestedRecorderAgentFactory) Description(context.Context) string {
	return "Child worker for recorder acceptance."
}
func (factory *nestedRecorderAgentFactory) Run(ctx context.Context, input *adk.AgentInput, options ...adk.AgentRunOption) *adk.AsyncIterator[*adk.AgentEvent] {
	factory.calls.Add(1)
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: factory.Name(ctx), Description: factory.Description(ctx), Model: &nestedRecorderModel{}, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: []tool.BaseTool{factory.tool}}}})
	if err != nil {
		iterator, generator := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
		generator.Send(&adk.AgentEvent{Err: err})
		generator.Close()
		return iterator
	}
	return agent.Run(ctx, input, options...)
}

func (*nestedRecorderTool) Info(context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{Name: "lookup_item", Desc: "Deterministic nested lookup."}, nil
}
func (implementation *nestedRecorderTool) InvokableRun(ctx context.Context, input string, _ ...tool.Option) (string, error) {
	var args struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return "", err
	}
	if compose.GetToolCallID(ctx) != "shared-inner-call" {
		return "", fmt.Errorf("missing actual nested tool ID")
	}
	address := callbackAddressID(callbackAddressFromContext(ctx))
	implementation.mu.Lock()
	implementation.addresses[address] = args.Key
	implementation.mu.Unlock()
	if args.Key == "failure" {
		return "", fmt.Errorf("lookup rejected: failure")
	}
	if implementation.parallel {
		if args.Key == "slow" {
			close(implementation.slowStarted)
			select {
			case <-implementation.fastObserved:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		} else {
			select {
			case <-implementation.slowStarted:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
	}
	return "lookup:" + args.Key, nil
}

func TestNestedAgentRecorderMatrix(t *testing.T) {
	for _, scenario := range []struct {
		name                         string
		parallel, recovered, failure bool
	}{
		{name: "agent-nested-distinct-results"},
		{name: "agent-nested-parallel-scopes", parallel: true},
		{name: "agent-nested-failure-recovered", failure: true, recovered: true},
		{name: "agent-nested-failure-propagated", failure: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			implementation := &nestedRecorderTool{parallel: scenario.parallel, slowStarted: make(chan struct{}), fastObserved: make(chan struct{}), addresses: map[string]string{}}
			child, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "worker", Description: "Child worker for recorder acceptance.", Model: &nestedRecorderModel{}, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: []tool.BaseTool{implementation}}}})
			if err != nil {
				t.Fatal(err)
			}
			var childForTool adk.Agent = child
			factory := &nestedRecorderAgentFactory{tool: implementation}
			// Explicit opt-in keeps the exact upstream race reproducible; normal
			// acceptance does not claim shared ChatModelAgent instance safety.
			if scenario.parallel && os.Getenv("EINO_REPRO_SHARED_AGENT_RACE") != "1" {
				childForTool = factory
			}
			config := compose.ToolsNodeConfig{Tools: []tool.BaseTool{adk.NewAgentTool(ctx, childForTool)}, ExecuteSequentially: !scenario.parallel}
			if scenario.recovered {
				config.ToolCallMiddlewares = []compose.ToolMiddleware{{Invokable: func(next compose.InvokableToolEndpoint) compose.InvokableToolEndpoint {
					return func(ctx context.Context, input *compose.ToolInput) (*compose.ToolOutput, error) {
						output, err := next(ctx, input)
						if err != nil {
							if !strings.Contains(err.Error(), "lookup rejected: failure") {
								return nil, err
							}
							return &compose.ToolOutput{Result: "handled child failure: lookup rejected: failure"}, nil
						}
						return output, nil
					}
				}}}
			}
			parent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "coordinator", Model: &nestedRecorderModel{parent: true, parallel: scenario.parallel, recovered: scenario.recovered}, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: config, EmitInternalEvents: true}})
			if err != nil {
				t.Fatal(err)
			}
			recorder := NewAgentRecorder("run-"+scenario.name, AgentRecorderOptions{})
			recorder.now = graphIOClock
			request := "single"
			if scenario.failure {
				request = "failure"
			}
			iterator, err := recorder.Query(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: parent, EnableStreaming: false}), request)
			if err != nil {
				t.Fatal(err)
			}
			rootFinal, childFinals := "", 0
			rootErrors := 0
			completionOrder := []string{}
			for {
				event, ok := iterator.Next()
				if !ok {
					break
				}
				if event.Err != nil {
					rootErrors++
					continue
				}
				if event.Output == nil || event.Output.MessageOutput == nil || event.Output.MessageOutput.Message == nil {
					continue
				}
				message := event.Output.MessageOutput.Message
				if message.Role == schema.Assistant && len(message.ToolCalls) == 0 {
					if len(event.RunPath) == 1 {
						rootFinal = message.Content
					} else {
						childFinals++
					}
				}
				if message.Role == schema.Tool && strings.HasPrefix(message.ToolCallID, "call-child-") {
					completionOrder = append(completionOrder, message.ToolCallID)
					if scenario.parallel && message.ToolCallID == "call-child-fast" {
						close(implementation.fastObserved)
					}
				}
			}
			wantOutcome := "success"
			if scenario.failure && !scenario.recovered {
				wantOutcome = "failed"
				if rootErrors == 0 || rootFinal != "" {
					t.Fatal("child failure did not propagate")
				}
			} else if rootErrors != 0 || !strings.HasPrefix(rootFinal, "parent final:") {
				t.Fatalf("parent result missing or failed: %q errors=%d", rootFinal, rootErrors)
			}
			if !scenario.failure && childFinals == 0 {
				t.Fatal("real child events were not emitted")
			}
			if scenario.parallel && strings.Join(completionOrder, ",") != "call-child-fast,call-child-slow" {
				t.Fatalf("child execution was not deliberately out of order: %v", completionOrder)
			}
			if scenario.parallel && childForTool == factory && factory.calls.Load() != 2 {
				t.Fatal("parallel child calls were not independently instantiated")
			}
			wantCalls := 1
			if scenario.parallel {
				wantCalls = 2
			}
			if len(implementation.addresses) != wantCalls {
				t.Fatal("nested call scopes collapsed")
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, record.Evidence, wantOutcome, "complete")
			assertNestedSourceFacts(t, record, implementation.addresses, scenario.failure, rootFinal)
			nestedRecorderFixture(t, record, scenario.name+".json")
		})
	}
}

func assertNestedSourceFacts(t *testing.T, record RunRecord, sourceCalls map[string]string, failure bool, rootFinal string) {
	t.Helper()
	inputs, outputs, failures := map[string]int{}, map[string]int{}, map[string]int{}
	derivedFinals := 0
	for _, envelope := range record.Evidence {
		var payload map[string]any
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if envelope.Kind == SchemaMessageKind && payload["role"] == "assistant" {
			derivedFinals++
			if rootFinal == "" || payload["content"] != rootFinal {
				t.Fatal("nested answer escaped as run schema.message")
			}
		}
		key, exists := sourceCalls[envelope.Correlation["entityId"]]
		if !exists {
			continue
		}
		if envelope.Kind == ComponentIOKind {
			body := payload["body"].(map[string]any)
			if payload["direction"] == "input" {
				inputs[key]++
				if body["argumentsJson"] != fmt.Sprintf(`{"key":%q}`, key) {
					t.Fatal("nested input crossed source scope")
				}
			} else {
				if inputs[key] != 1 {
					t.Fatal("nested output observed before its exact source input")
				}
				outputs[key]++
				if body["response"] != "lookup:"+key {
					t.Fatal("nested output crossed source scope")
				}
			}
		}
		if envelope.Kind == CallbackEventKind && payload["phase"] == "error" {
			if inputs[key] != 1 {
				t.Fatal("nested error observed before its exact source input")
			}
			failures[key]++
			if payload["error"].(map[string]any)["message"] != "lookup rejected: failure" {
				t.Fatal("wrong nested callback error")
			}
		}
	}
	if (rootFinal != "" && derivedFinals != 1) || (rootFinal == "" && derivedFinals != 0) {
		t.Fatal("run result derivation was not root-only")
	}
	for _, key := range sourceCalls {
		if inputs[key] != 1 {
			t.Fatalf("nested input missing for %s", key)
		}
		if failure {
			if outputs[key] != 0 || failures[key] != 1 {
				t.Fatalf("nested failure facts missing: output=%d failure=%d", outputs[key], failures[key])
			}
		} else if outputs[key] != 1 || failures[key] != 0 {
			t.Fatalf("nested success facts missing: output=%d failure=%d", outputs[key], failures[key])
		}
	}
}

func nestedRecorderFixture(t *testing.T, record RunRecord, filename string) {
	t.Helper()
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("../../fixtures/recorder-matrix", filename)
	if os.Getenv("WRITE_NESTED_RECORDER_FIXTURES") == "1" {
		if err := os.WriteFile(path, append(encoded, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	actual := agentMatrixComparisonRecord(t, encoded)
	expected, err := json.Marshal(agentMatrixComparisonRecord(t, want))
	if err != nil {
		t.Fatal(err)
	}
	if !equivalentRunRecordFixture(t, actual, expected) {
		t.Fatalf("nested fixture source facts changed: %s", filename)
	}
}

func TestAgentRecorderNestedAnswersNeverBecomeRootMessages(t *testing.T) {
	for _, depth := range []int{0, 1, 2, 3} {
		t.Run(fmt.Sprintf("path-depth-%d", depth), func(t *testing.T) {
			recorder := NewAgentRecorder("scope-test", AgentRecorderOptions{})
			answer := schema.AssistantMessage("same agent name does not prove root ownership", nil)
			event := &adk.AgentEvent{AgentName: "same-name", RunPath: make([]adk.RunStep, depth), Output: &adk.AgentOutput{MessageOutput: &adk.MessageVariant{Message: answer}}}
			recorder.RecordEvent(event)
			envelopes, _, err := recorder.Envelopes()
			if err != nil {
				t.Fatal(err)
			}
			want := 1
			if depth <= 1 {
				want = 2
			}
			if len(envelopes) != want || envelopes[0].Kind != AgentEventKind || event.Output.MessageOutput.Message != answer {
				t.Fatal("nested event lost, mutated, or promoted to root")
			}
		})
	}
}

func TestAgentRecorderNestedErrorSafeBoundary(t *testing.T) {
	for _, scenario := range []string{"plain", "redacted", "oversized", "unsafe-redactor"} {
		t.Run(scenario, func(t *testing.T) {
			var marshalCalls recorderAtomicCounter
			message := "private nested error"
			options := AgentRecorderOptions{}
			switch scenario {
			case "redacted":
				options.Envelope.Policy.Redact = func(path []string, value any) (any, bool) {
					if strings.Join(path, "/") == "payload/error/message" {
						return "[REDACTED]", true
					}
					return nil, false
				}
			case "oversized":
				message = strings.Repeat(message, 1000)
				options.Envelope.Policy.MaxDocumentBytes = 1500
			case "unsafe-redactor":
				options.Envelope.Policy.Redact = func(path []string, value any) (any, bool) {
					if strings.Join(path, "/") == "payload/error/message" {
						return recorderCountingMarshaler{&marshalCalls}, true
					}
					return nil, false
				}
			}
			recorder := NewAgentRecorder("nested-error-safe", options)
			recorder.now = graphIOClock
			// A source-compatible callback address with repeated agent names.
			ctx := compose.AppendAddressSegment(context.Background(), compose.AddressSegmentType("agent"), "same-name")
			ctx = compose.AppendAddressSegment(ctx, compose.AddressSegmentTool, "worker")
			ctx = compose.AppendAddressSegment(ctx, compose.AddressSegmentType("agent"), "same-name")
			ctx = compose.AppendAddressSegment(ctx, compose.AddressSegmentNode, "ChatModel")
			recorder.Handler().OnError(ctx, &callbacks.RunInfo{Component: components.ComponentOfChatModel, Name: "model"}, errors.New(message))
			envelopes, diagnostics, err := recorder.Envelopes()
			if err != nil || len(envelopes) != 1 || marshalCalls.Load() != 0 {
				t.Fatalf("nested callback bypassed safe capture: %v", err)
			}
			envelope := envelopes[0]
			payload := graphIOPayload(t, envelope)
			if envelope.Kind != CallbackEventKind || envelope.Correlation["entityId"] != callbackAddressID(callbackAddressFromContext(ctx)) || envelope.Correlation["eventId"] != "nested-error-safe:nested-error:1" || payload["phase"] != "error" {
				t.Fatal("nested source identity lost")
			}
			switch scenario {
			case "plain":
				if payload["error"].(map[string]any)["message"] != message || len(diagnostics) != 0 {
					t.Fatal("plain nested error changed")
				}
			case "redacted":
				if strings.Contains(string(envelope.Payload), "private nested error") || payload["error"].(map[string]any)["message"] != "[REDACTED]" {
					t.Fatal("nested error redaction was bypassed")
				}
			default:
				if payload["error"].(map[string]any)["message"] != recorderErrorDetailsOmitted || strings.Contains(string(envelope.Payload), "private nested error") {
					t.Fatal("omitted error was not an explicit non-source omission notice")
				}
				if !strings.Contains(string(envelope.Metadata), `"status":"omitted"`) || captureCompleteness(nil, diagnostics) != "partial" {
					t.Fatal("nested omission facts lost")
				}
			}
		})
	}
}
