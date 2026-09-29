package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// These models only choose deterministic messages. Eino supplies all three
// Agent boundaries, AgentTool calls, callback addresses and forwarded events.
type deepNestedRecorderModel struct {
	depth     int
	recovered bool
}

func (*deepNestedRecorderModel) GetType() string { return "DeepNestedRecorderModel" }
func (m *deepNestedRecorderModel) WithTools([]*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}
func (*deepNestedRecorderModel) Stream(context.Context, []*schema.Message, ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, fmt.Errorf("streaming intentionally unsupported")
}
func (m *deepNestedRecorderModel) Generate(_ context.Context, messages []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	request, result := "", ""
	for _, message := range messages {
		if message.Role == schema.User {
			request = message.Content
		}
		if message.Role == schema.Tool {
			if message.ToolCallID != "shared-depth-call" || result != "" {
				return nil, fmt.Errorf("unexpected tool result at Agent depth %d", m.depth)
			}
			result = message.Content
		}
	}
	if result == "" {
		name, argument := "worker", "request"
		if m.depth == 3 {
			name, argument = "lookup_item", "key"
		}
		// A call ID is local to its Agent, not a globally unique execution ID.
		call := schema.ToolCall{ID: "shared-depth-call", Type: "function", Function: schema.FunctionCall{Name: name, Arguments: fmt.Sprintf(`{%q:%q}`, argument, request)}}
		return schema.AssistantMessage("", []schema.ToolCall{call}), nil
	}
	want, answer := "", ""
	switch m.depth {
	case 3:
		want, answer = "lookup:"+request, "leaf result: verified "+request
	case 2:
		want, answer = "leaf result: verified "+request, "middle result: reviewed "+request
		if m.recovered {
			want, answer = "handled leaf failure: deep lookup rejected: failure", "middle result: recovered with local fallback"
		}
	case 1:
		want, answer = "middle result: reviewed "+request, "parent final: accepted "+request
		if m.recovered {
			want, answer = "middle result: recovered with local fallback", "parent final: accepted middle fallback"
		}
	}
	if result != want {
		return nil, fmt.Errorf("Agent depth %d received a foreign local result: %q, want %q", m.depth, result, want)
	}
	return schema.AssistantMessage(answer, nil), nil
}

type deepNestedRecorderTool struct {
	calls   int
	address string
}

func (*deepNestedRecorderTool) Info(context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{Name: "lookup_item", Desc: "Deterministic third-level lookup."}, nil
}
func (implementation *deepNestedRecorderTool) InvokableRun(ctx context.Context, input string, _ ...tool.Option) (string, error) {
	var args struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return "", err
	}
	if compose.GetToolCallID(ctx) != "shared-depth-call" {
		return "", fmt.Errorf("missing actual third-level tool call ID")
	}
	implementation.calls++
	implementation.address = callbackAddressID(callbackAddressFromContext(ctx))
	if args.Key == "failure" {
		return "", fmt.Errorf("deep lookup rejected: failure")
	}
	return "lookup:" + args.Key, nil
}

// Every invocation constructs its own real ChatModelAgent. This does not rely
// on the known unsafe shared ChatModelAgent run closure in Eino v0.9.19.
type deepNestedAgentFactory struct {
	depth     int
	recovered bool
	tool      *deepNestedRecorderTool
	calls     recorderAtomicCounter
	child     *deepNestedAgentFactory
}

func (*deepNestedAgentFactory) Name(context.Context) string { return "worker" }
func (*deepNestedAgentFactory) Description(context.Context) string {
	return "Nested worker acceptance."
}
func (factory *deepNestedAgentFactory) Run(ctx context.Context, input *adk.AgentInput, options ...adk.AgentRunOption) *adk.AsyncIterator[*adk.AgentEvent] {
	factory.calls.Add(1)
	agent, err := factory.newAgent(ctx)
	if err != nil {
		iterator, generator := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
		generator.Send(&adk.AgentEvent{Err: err})
		generator.Close()
		return iterator
	}
	return agent.Run(ctx, input, options...)
}
func (factory *deepNestedAgentFactory) newAgent(ctx context.Context) (adk.Agent, error) {
	config := compose.ToolsNodeConfig{ExecuteSequentially: true}
	if factory.depth == 3 {
		config.Tools = []tool.BaseTool{factory.tool}
	} else {
		config.Tools = []tool.BaseTool{adk.NewAgentTool(ctx, factory.child)}
	}
	if factory.depth == 2 && factory.recovered {
		config.ToolCallMiddlewares = []compose.ToolMiddleware{{Invokable: func(next compose.InvokableToolEndpoint) compose.InvokableToolEndpoint {
			return func(ctx context.Context, input *compose.ToolInput) (*compose.ToolOutput, error) {
				output, err := next(ctx, input)
				if err != nil && strings.Contains(err.Error(), "deep lookup rejected: failure") {
					return &compose.ToolOutput{Result: "handled leaf failure: deep lookup rejected: failure"}, nil
				}
				return output, err
			}
		}}}
	}
	name := factory.Name(ctx)
	if factory.depth == 1 {
		name = "coordinator"
	}
	return adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: name, Model: &deepNestedRecorderModel{depth: factory.depth, recovered: factory.recovered}, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: config, EmitInternalEvents: true}})
}

func TestDeepNestedAgentRecorderMatrix(t *testing.T) {
	for _, scenario := range []struct {
		name, request, final string
		recovered            bool
	}{
		{name: "agent-deep-nested-distinct-results", request: "single", final: "parent final: accepted single"},
		{name: "agent-deep-nested-failure-recovered", request: "failure", final: "parent final: accepted middle fallback", recovered: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			implementation := &deepNestedRecorderTool{}
			leaf := &deepNestedAgentFactory{depth: 3, tool: implementation, recovered: scenario.recovered}
			middle := &deepNestedAgentFactory{depth: 2, tool: implementation, recovered: scenario.recovered, child: leaf}
			root := &deepNestedAgentFactory{depth: 1, tool: implementation, recovered: scenario.recovered, child: middle}
			parent, err := root.newAgent(ctx)
			if err != nil {
				t.Fatal(err)
			}
			recorder := NewAgentRecorder("run-"+scenario.name, AgentRecorderOptions{})
			recorder.now = graphIOClock
			iterator, err := recorder.Query(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: parent, EnableStreaming: false}), scenario.request)
			if err != nil {
				t.Fatal(err)
			}
			finals := map[int]string{}
			for {
				event, ok := iterator.Next()
				if !ok {
					break
				}
				if event.Err != nil {
					t.Fatalf("unhandled root event error: %v", event.Err)
				}
				if event.Output != nil && event.Output.MessageOutput != nil && event.Output.MessageOutput.Message != nil {
					message := event.Output.MessageOutput.Message
					if message.Role == schema.Assistant && len(message.ToolCalls) == 0 {
						if _, duplicate := finals[len(event.RunPath)]; duplicate {
							t.Fatalf("duplicate final event at depth %d", len(event.RunPath))
						}
						finals[len(event.RunPath)] = message.Content
					}
				}
			}
			if implementation.calls != 1 || middle.calls.Load() != 1 || leaf.calls.Load() != 1 {
				t.Fatal("expected one actual invocation at each of the three levels")
			}
			if finals[1] != scenario.final {
				t.Fatalf("wrong root final: %v", finals)
			}
			if scenario.recovered {
				if finals[2] != "middle result: recovered with local fallback" || finals[3] != "" {
					t.Fatalf("middle recovery rewrote the failed leaf answer: %v", finals)
				}
			} else if finals[2] != "middle result: reviewed single" || finals[3] != "leaf result: verified single" {
				t.Fatalf("three final answers were not emitted separately: %v", finals)
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, record.Evidence, "success", "complete")
			assertDeepNestedSourceFacts(t, record, implementation.address, scenario.request, scenario.final, scenario.recovered)
			// The selected test name limits writes to these two new files; no
			// pre-existing nested fixture is regenerated by this test.
			nestedRecorderFixture(t, record, scenario.name+".json")
		})
	}
}

func assertDeepNestedSourceFacts(t *testing.T, record RunRecord, leafAddress, request, final string, recovered bool) {
	t.Helper()
	inputs, outputs, failures, depths := map[string]int{}, map[string]int{}, map[string]int{}, map[int]string{}
	derivedFinals := 0
	for _, envelope := range record.Evidence {
		var payload map[string]any
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if envelope.Kind == SchemaMessageKind && payload["role"] == "assistant" {
			derivedFinals++
			if payload["content"] != final {
				t.Fatal("a nested answer was promoted to the whole-run result")
			}
		}
		address := envelope.Correlation["entityId"]
		if envelope.Kind == CallbackEventKind && payload["phase"] == "error" {
			failures[address]++
			message := payload["error"].(map[string]any)["message"].(string)
			if !strings.Contains(message, "deep lookup rejected: failure") || inputs[address] != 1 {
				t.Fatal("nested error lost its exact source boundary")
			}
			if address == leafAddress && message != "deep lookup rejected: failure" {
				t.Fatal("original leaf error was rewritten as a propagation error")
			}
		}
		if envelope.Kind != ComponentIOKind || payload["component"] != "Tool" {
			continue
		}
		segments := payload["address"].([]any)
		depth := 0
		for _, segment := range segments {
			if segment.(map[string]any)["type"] == "agent" {
				depth++
			}
		}
		if segments[len(segments)-1].(map[string]any)["subId"] != "shared-depth-call" {
			t.Fatal("tool did not retain the actual reused call ID")
		}
		body := payload["body"].(map[string]any)
		if payload["direction"] == "input" {
			inputs[address]++
			depths[depth] = address
			argument := "request"
			if depth == 3 {
				argument = "key"
			}
			if body["argumentsJson"] != fmt.Sprintf(`{%q:%q}`, argument, request) {
				t.Fatal("input arguments crossed invocation boundaries")
			}
		} else {
			outputs[address]++
			if inputs[address] != 1 {
				t.Fatal("tool output preceded its own input")
			}
			want := map[int]string{1: "middle result: reviewed single", 2: "leaf result: verified single", 3: "lookup:single"}[depth]
			if recovered {
				want = map[int]string{1: "middle result: recovered with local fallback", 2: "handled leaf failure: deep lookup rejected: failure"}[depth]
			}
			if body["response"] != want {
				t.Fatalf("depth %d source output crossed boundaries: %v", depth, body)
			}
		}
	}
	if derivedFinals != 1 || len(depths) != 3 || len(inputs) != 3 || depths[3] != leafAddress {
		t.Fatal("three distinct actual callback scopes were not recorded")
	}
	for depth, address := range depths {
		wantOutputs, wantFailures := 1, 0
		// Middleware converts the error only after the leaf AgentTool's
		// callback has failed. Neither it nor the lookup has a success output.
		if recovered && depth >= 2 {
			wantOutputs, wantFailures = 0, 1
		}
		if inputs[address] != 1 || outputs[address] != wantOutputs {
			t.Fatalf("depth %d wrong input/output counts: %d/%d", depth, inputs[address], outputs[address])
		}
		if failures[address] != wantFailures {
			t.Fatalf("depth %d source failure changed: %d, want %d", depth, failures[address], wantFailures)
		}
	}
}
