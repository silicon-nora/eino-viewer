package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	v2 "github.com/silicon-nora/eino-viewer/integrations/go/protocolv2"
)

type nativeV2Model struct {
	deterministicWeatherModel
	usageMode string
	direct    bool
}

func (*nativeV2Model) IsCallbacksEnabled() bool { return true }
func (m *nativeV2Model) WithTools([]*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}
func (m *nativeV2Model) Generate(ctx context.Context, messages []*schema.Message, options ...model.Option) (*schema.Message, error) {
	ctx = callbacks.EnsureRunInfo(ctx, "DeterministicV2Provider", components.ComponentOfChatModel)
	ctx = callbacks.OnStart(ctx, &model.CallbackInput{Messages: messages, Config: &model.Config{Model: "actual-mock-model"}})
	answer, err := m.deterministicWeatherModel.Generate(ctx, messages, options...)
	if m.direct {
		answer = schema.AssistantMessage("answer", nil)
	}
	if err != nil {
		callbacks.OnError(ctx, err)
		return nil, err
	}
	usage := &model.TokenUsage{PromptTokens: 10, CompletionTokens: 3, TotalTokens: 13, PromptTokenDetails: model.PromptTokenDetails{CachedTokens: 2}}
	switch m.usageMode {
	case "nil":
		usage = nil
	case "zero":
		usage = &model.TokenUsage{}
	case "negative":
		usage.PromptTokens = -1
	case "inconsistent":
		usage.TotalTokens = 99
	case "unsafe":
		usage.TotalTokens = 9007199254740992
	}
	callbacks.OnEnd(ctx, &model.CallbackOutput{Message: answer, Config: &model.Config{Model: "actual-mock-model"}, TokenUsage: usage})
	return answer, nil
}
func requireV2Fixture(t *testing.T, name string, record v2.RunRecord) {
	t.Helper()
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if record.SchemaVersion != "2" || record.Run.RootInvocationID == nil || len(record.Invocations) == 0 {
		t.Fatalf("missing native execution: %s", data)
	}
	byID := map[v2.Id]v2.Invocation{}
	for _, call := range record.Invocations {
		byID[call.ID] = call
	}
	root := byID[*record.Run.RootInvocationID]
	if root.Status != record.Run.Status || root.Parent.State != "root" {
		t.Fatalf("invalid root: %s", data)
	}
	for _, call := range record.Invocations {
		if call.Parent.State == "known" {
			if _, ok := byID[*call.Parent.InvocationID]; !ok {
				t.Fatal("dangling parent")
			}
		}
	}
	if os.Getenv("WRITE_NATIVE_V2_FIXTURES") != "" {
		directory := os.Getenv("WRITE_NATIVE_V2_FIXTURES")
		if directory == "1" {
			directory = filepath.Join("testdata", "v2")
		}
		path := filepath.Join(directory, name+".json")
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
	}
}
func TestNativeV2AgentModelToolUsage(t *testing.T) {
	ctx := context.Background()
	provider := &nativeV2Model{}
	implementation := &deterministicWeatherTool{}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "native-v2-agent", Instruction: "Use get_weather.", Model: provider, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: []tool.BaseTool{implementation}}}})
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorderV2("native-agent-tools", AgentRecorderOptions{})
	iterator, err := recorder.Run(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent}), []*schema.Message{schema.UserMessage("Singapore weather")})
	if err != nil {
		t.Fatal(err)
	}
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
	}
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	requireV2Fixture(t, "agent-model-tool-usage", record)
	encoded, _ := json.MarshalIndent(record, "", "  ")
	if record.Run.Status != "succeeded" {
		t.Fatalf("root outcome: %s", encoded)
	}
	counts := map[string]int{}
	for _, call := range record.Invocations {
		counts[call.Kind]++
		if call.Parent.State == "unknown" {
			t.Fatalf("lost callback parent: %s", encoded)
		}
	}
	if counts["model"] != 2 || counts["tool"] != 1 || len(record.Usage) != 2 {
		t.Fatalf("lost invocations or usage: %s", encoded)
	}
	for _, usage := range record.Usage {
		if usage.Completeness != "complete" || usage.Model == nil || *usage.Model != "actual-mock-model" || usage.Tokens.Total == nil || *usage.Tokens.Total != "13" {
			t.Fatalf("bad usage: %#v", usage)
		}
	}
	if len(record.Relations) != 1 || record.Relations[0].Type != "responds_to" {
		t.Fatalf("lost tool dispatch identity: %s", encoded)
	}
	root := record.Invocations[0]
	if len(root.OutputRefs) == 0 {
		t.Fatalf("root answer absent: %s", encoded)
	}
	record.Invocations[0].Name = "mutated"
	again, _ := recorder.RunRecordV2()
	if again.Invocations[0].Name == "mutated" {
		t.Fatal("snapshot not defensive")
	}
}
func TestNativeV2GraphRepeatedCalls(t *testing.T) {
	graph := compose.NewGraph[int, int]()
	_ = graph.AddLambdaNode("repeat", compose.InvokableLambda(func(_ context.Context, in int) (int, error) { return in + 1, nil }))
	_ = graph.AddEdge(compose.START, "repeat")
	_ = graph.AddBranch("repeat", compose.NewGraphBranch(func(_ context.Context, in int) (string, error) {
		if in < 3 {
			return "repeat", nil
		}
		return compose.END, nil
	}, map[string]bool{"repeat": true, compose.END: true}))
	recorder := NewGraphRecorderV2("native-graph-repeat", GraphRecorderOptions{})
	runnable, err := graph.Compile(context.Background(), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if out, err := runnable.Invoke(context.Background(), 0, recorder.InvokeOption()); err != nil || out != 3 {
		t.Fatalf("run: %d %v", out, err)
	}
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	requireV2Fixture(t, "graph-repeated-calls", record)
	counts := map[v2.Id]int{}
	for _, call := range record.Invocations {
		if call.Kind == "node" {
			if call.DefinitionID == nil {
				t.Fatal("definition identity absent")
			}
			counts[*call.DefinitionID]++
		}
	}
	repeated := false
	for _, n := range counts {
		repeated = repeated || n == 3
	}
	if !repeated || len(record.Invocations) != 4 {
		data, _ := json.MarshalIndent(record, "", "  ")
		t.Fatalf("repeat merged: %s", data)
	}
}
func TestNativeV2WorkflowOutcomes(t *testing.T) {
	for _, name := range []string{"success-empty", "failed", "cancelled"} {
		t.Run(name, func(t *testing.T) {
			workflow := compose.NewWorkflow[string, string]()
			workflow.AddLambdaNode("work", compose.InvokableLambda(func(context.Context, string) (string, error) {
				switch name {
				case "failed":
					return "", errors.New("observed failure")
				case "cancelled":
					return "", context.Canceled
				default:
					return "", nil
				}
			})).AddInput(compose.START)
			workflow.End().AddInput("work")
			recorder := NewWorkflowRecorderV2("native-workflow-"+name, WorkflowRecorderOptions{})
			runnable, err := workflow.Compile(context.Background(), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			_, _ = runnable.Invoke(context.Background(), "input", recorder.InvokeOption())
			record, err := recorder.RunRecordV2()
			if err != nil {
				t.Fatal(err)
			}
			requireV2Fixture(t, "workflow-"+name, record)
			want := v2.Status(name)
			if name == "success-empty" {
				want = "succeeded"
			}
			if record.Run.Status != want {
				t.Fatalf("status %s wanted %s", record.Run.Status, want)
			}
			if name == "success-empty" {
				root := record.Invocations[0]
				found := false
				for _, content := range record.Contents {
					if len(root.OutputRefs) > 0 && content.ID == root.OutputRefs[0] && string(content.Data.Value) == `""` {
						found = true
					}
				}
				if !found {
					t.Fatal("observed empty output was lost")
				}
			}
		})
	}
}
func TestNativeV2ExplicitOptIn(t *testing.T) {
	if _, err := NewAgentRecorder("legacy", AgentRecorderOptions{}).RunRecordV2(); !errors.Is(err, ErrV2NotEnabled) {
		t.Fatalf("legacy was implicitly migrated: %v", err)
	}
}

func TestNativeV2NestedParallelIdentity(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	implementation := &nestedRecorderTool{parallel: true, slowStarted: make(chan struct{}), fastObserved: make(chan struct{}), addresses: map[string]string{}}
	child := &nestedRecorderAgentFactory{tool: implementation}
	parent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "coordinator", Model: &nestedRecorderModel{parent: true, parallel: true}, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: []tool.BaseTool{adk.NewAgentTool(ctx, child)}}, EmitInternalEvents: true}})
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorderV2("native-nested-parallel", AgentRecorderOptions{})
	iterator, err := recorder.Query(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: parent}), "parallel")
	if err != nil {
		t.Fatal(err)
	}
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		if event.Output != nil && event.Output.MessageOutput != nil && event.Output.MessageOutput.Message != nil {
			message := event.Output.MessageOutput.Message
			if message.Role == schema.Tool && message.ToolCallID == "call-child-fast" {
				close(implementation.fastObserved)
			}
		}
	}
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	requireV2Fixture(t, "agent-nested-parallel", record)
	invocations := map[v2.Id]v2.Invocation{}
	events := map[v2.Id]v2.Event{}
	for _, call := range record.Invocations {
		invocations[call.ID] = call
	}
	for _, event := range record.Events {
		events[event.ID] = event
	}
	scope := func(id v2.Id) v2.Id {
		for id != "" {
			call := invocations[id]
			if call.Kind == "agent" {
				return id
			}
			if call.Parent.InvocationID == nil {
				return ""
			}
			id = *call.Parent.InvocationID
		}
		return ""
	}
	lookups := []v2.Id{}
	for _, call := range record.Invocations {
		if call.Kind == "tool" && call.Name == "lookup_item" {
			lookups = append(lookups, call.ID)
			if call.ExternalCallID == nil || *call.ExternalCallID != "shared-inner-call" {
				t.Fatal("actual external ID missing")
			}
		}
	}
	if len(lookups) != 2 || scope(lookups[0]) == scope(lookups[1]) {
		data, _ := json.MarshalIndent(record, "", "  ")
		t.Fatalf("same-name child scopes collapsed: %s", data)
	}
	for _, id := range lookups {
		found := false
		for _, rel := range record.Relations {
			if rel.Type == "responds_to" && *rel.From.ID == id {
				request := events[*rel.To.ID]
				if scope(*request.Owner.ID) != scope(id) {
					t.Fatal("crossed same external ID across agent scopes")
				}
				found = true
			}
		}
		if !found {
			data, _ := json.MarshalIndent(record, "", "  ")
			t.Fatalf("missing exact tool response: %s", data)
		}
	}
	if record.Run.Status != "succeeded" {
		t.Fatalf("nested root=%s", record.Run.Status)
	}
}

func TestNativeV2CaptureLimitsAndNull(t *testing.T) {
	for _, name := range []string{"disabled", "unsupported", "null", "error-redacted"} {
		t.Run(name, func(t *testing.T) {
			graph := compose.NewGraph[any, any]()
			_ = graph.AddLambdaNode("work", compose.InvokableLambda(func(context.Context, any) (any, error) {
				switch name {
				case "unsupported":
					return make(chan int), nil
				case "error-redacted":
					return nil, errors.New("SECRET-provider-error")
				default:
					return nil, nil
				}
			}))
			_ = graph.AddEdge(compose.START, "work")
			_ = graph.AddEdge("work", compose.END)
			options := GraphRecorderOptions{DisableIO: name == "disabled"}
			if name == "error-redacted" {
				options.Events.Policy.Redact = func(_ []string, value any) (any, bool) {
					text, ok := value.(string)
					if ok && strings.Contains(text, "SECRET") {
						return "[REDACTED]", true
					}
					return nil, false
				}
			}
			recorder := NewGraphRecorderV2("native-"+name, options)
			runnable, err := graph.Compile(context.Background(), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			_, _ = runnable.Invoke(context.Background(), nil, recorder.InvokeOption())
			record, err := recorder.RunRecordV2()
			if err != nil {
				t.Fatal(err)
			}
			requireV2Fixture(t, "capture-"+name, record)
			data, _ := json.Marshal(record)
			if strings.Contains(string(data), "SECRET") {
				t.Fatal("error escaped configured redaction")
			}
			if name == "disabled" || name == "unsupported" {
				if record.Run.Capture.State != "partial" {
					t.Fatal("capture loss claimed complete")
				}
				missing := false
				for _, content := range record.Contents {
					if content.Data.Availability == "missing" && content.Completeness == "unknown" {
						missing = true
					}
				}
				if !missing {
					t.Fatal("missing body invented")
				}
			}
			if name == "null" {
				found := false
				for _, content := range record.Contents {
					if content.Role == "output" && content.Data.Availability == "inline" && string(content.Data.Value) == "null" {
						found = true
					}
				}
				if !found {
					t.Fatal("explicit null lost")
				}
			}
		})
	}
}
func TestNativeV2StreamingSnapshotIsNonblocking(t *testing.T) {
	ctx := context.Background()
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "stream-agent", Model: &deterministicWeatherModel{}})
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorderV2("native-stream-open", AgentRecorderOptions{})
	iterator, err := recorder.Query(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: true}), "weather")
	if err != nil {
		t.Fatal(err)
	}
	event, ok := iterator.Next()
	if !ok || event.Output == nil || event.Output.MessageOutput == nil {
		t.Fatal("no stream event")
	}
	started := time.Now()
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(started) > 100*time.Millisecond {
		t.Fatal("static snapshot waited on a live stream")
	}
	requireV2Fixture(t, "agent-stream-open", record)
	if record.Run.Status == "succeeded" || record.Run.Capture.State != "partial" {
		t.Fatal("unconsumed stream marked final/complete")
	}
	// The application's independent stream is still readable; collector never
	// consumes it or closes it. Close it after this assertion to release resources.
	output := event.Output.MessageOutput
	if !output.IsStreaming || output.MessageStream == nil {
		t.Fatal("expected stream")
	}
	message, err := output.MessageStream.Recv()
	if err != nil || message == nil {
		t.Fatalf("application stream was consumed: %v", err)
	}
	output.MessageStream.Close()
}

func TestNativeV2ApplicationBoundaryAndExplicitModel(t *testing.T) {
	recorder, err := NewRunRecorderV2("native-application", RunRecorderV2Options{Source: "application", Scope: "test-service"})
	if err != nil {
		t.Fatal(err)
	}
	root, _, err := recorder.Begin(context.Background(), InvocationStartV2{Kind: "application", Name: "Generate", HasInput: true, Input: map[string]any{"request": "report"}})
	if err != nil {
		t.Fatal(err)
	}
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode("prepare", compose.InvokableLambda(func(context.Context, string) (string, error) { return "prepared", nil })).AddInput(compose.START)
	workflow.End().AddInput("prepare")
	runnable, err := workflow.Compile(root, recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runnable.Invoke(root, "input", recorder.InvokeOption()); err != nil {
		t.Fatal(err)
	}
	modelCtx, id, err := recorder.Begin(root, InvocationStartV2{Kind: "model", Name: "Application-owned model client", HasInput: true, Input: []string{"system instruction", "prepared"}})
	if err != nil {
		t.Fatal(err)
	}
	input, output, total, zero := int64(7), int64(2), int64(9), int64(0)
	badTotal := int64(5)
	if recorder.RecordModelUsage(modelCtx, ModelUsageV2{Source: "provider", Input: &input, Total: &badTotal}) == nil {
		t.Fatal("accepted partial total below observed input")
	}
	if err = recorder.RecordModelUsage(modelCtx, ModelUsageV2{Source: "provider", Model: "effective-model", RequestID: "observed-request-id", Input: &input, InputCached: &zero}); err != nil {
		t.Fatal(err)
	}
	if err = recorder.RecordModelUsage(modelCtx, ModelUsageV2{Source: "provider", Output: &output, Total: &total}); err != nil {
		t.Fatal(err)
	}
	// A partial update is checked against existing observations; rejected updates
	// must preserve both the counters and metadata of the previous ledger row.
	recorder.native.mu.Lock()
	before, _ := json.Marshal(recorder.native.record.Usage)
	recorder.native.mu.Unlock()
	if recorder.RecordModelUsage(modelCtx, ModelUsageV2{Source: "provider", Model: "rejected-model", Total: &badTotal}) == nil {
		t.Fatal("accepted inconsistent merged usage")
	}
	if err = recorder.RecordModelUsage(modelCtx, ModelUsageV2{Source: "unknown"}); err != nil {
		t.Fatal(err)
	}
	recorder.native.mu.Lock()
	after, _ := json.Marshal(recorder.native.record.Usage)
	recorder.native.mu.Unlock()
	if string(before) != string(after) {
		t.Fatal("rejected or unknown observation erased prior usage")
	}
	if err = recorder.End(modelCtx, InvocationEndV2{Status: "succeeded", HasOutput: true, Output: "result"}); err != nil {
		t.Fatal(err)
	}
	if err = recorder.End(root, InvocationEndV2{Status: "succeeded", HasOutput: true, Output: "result"}); err != nil {
		t.Fatal(err)
	}
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	requireV2Fixture(t, "application-explicit-model", record)
	if len(record.Usage) != 1 || record.Usage[0].InvocationID != id || record.Usage[0].Tokens.InputCached == nil || *record.Usage[0].Tokens.InputCached != "0" {
		t.Fatal("explicit observed zero usage lost")
	}
	usage := record.Usage[0]
	if usage.Completeness != "complete" || usage.Tokens.Input == nil || *usage.Tokens.Input != "7" || usage.Tokens.Output == nil || *usage.Tokens.Output != "2" || usage.Tokens.Total == nil || *usage.Tokens.Total != "9" {
		t.Fatal("successive usage observations did not merge without addition")
	}
	for _, call := range record.Invocations {
		if call.Kind == "model" && call.DefinitionID != nil {
			t.Fatal("manual model was falsely bound to a graph definition")
		}
		if call.Kind == "workflow" {
			if call.DefinitionID == nil {
				t.Fatal("actual workflow definition reference is missing")
			}
			found := false
			for _, definition := range record.Definitions {
				if definition.ID == *call.DefinitionID && definition.Kind == "workflow" {
					found = true
				}
			}
			if !found {
				t.Fatal("actual workflow definition kind was lost")
			}
		}
	}
	if len(record.Invocations) != 4 || record.Run.Source != "application" {
		t.Fatalf("application boundary lost: %#v", record.Invocations)
	}
	if recorder.End(modelCtx, InvocationEndV2{Status: "succeeded"}) == nil {
		t.Fatal("duplicate end accepted")
	}
}

func TestNativeV2ApplicationWorkflowFailureRecovered(t *testing.T) {
	recorder, err := NewRunRecorderV2("native-application-fallback", RunRecorderV2Options{Scope: "test-service"})
	if err != nil {
		t.Fatal(err)
	}
	root, _, err := recorder.Begin(context.Background(), InvocationStartV2{Kind: "application", Name: "Generate with fallback", HasInput: true, Input: "report"})
	if err != nil {
		t.Fatal(err)
	}
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode("prepare", compose.InvokableLambda(func(context.Context, string) (string, error) {
		return "", errors.New("preparation unavailable")
	})).AddInput(compose.START)
	workflow.End().AddInput("prepare")
	runnable, err := workflow.Compile(root, recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runnable.Invoke(root, "input", recorder.InvokeOption()); err == nil {
		t.Fatal("expected actual workflow failure")
	}
	if err = recorder.End(root, InvocationEndV2{Status: "succeeded", HasOutput: true, Output: "cached report"}); err != nil {
		t.Fatal(err)
	}
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	if record.Run.Status != "succeeded" || record.Invocations[0].Status != "succeeded" || record.Invocations[0].Error != nil {
		t.Fatal("handled child failure incorrectly failed the application")
	}
	found := false
	for _, call := range record.Invocations {
		if call.Kind == "workflow" && call.Status == "failed" && call.Error != nil && call.Parent.InvocationID != nil && *call.Parent.InvocationID == record.Invocations[0].ID {
			found = true
		}
	}
	if !found {
		t.Fatal("recovered application lost the actual child workflow failure")
	}
	requireV2Fixture(t, "application-workflow-fallback", record)
}

func TestNativeV2UsageUnknownZeroAndMalformed(t *testing.T) {
	for _, mode := range []string{"nil", "zero", "negative", "inconsistent", "unsafe"} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "usage-agent", Model: &nativeV2Model{usageMode: mode, direct: true}})
			if err != nil {
				t.Fatal(err)
			}
			recorder := NewAgentRecorderV2("native-usage-"+mode, AgentRecorderOptions{})
			iterator, err := recorder.Query(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent}), "question")
			if err != nil {
				t.Fatal(err)
			}
			for {
				event, ok := iterator.Next()
				if !ok {
					break
				}
				if event.Err != nil {
					t.Fatal(event.Err)
				}
			}
			record, err := recorder.RunRecordV2()
			if err != nil {
				t.Fatal(err)
			}
			requireV2Fixture(t, "usage-"+mode, record)
			if len(record.Usage) != 1 {
				t.Fatal("ledger count")
			}
			usage := record.Usage[0]
			if mode == "zero" {
				if usage.Completeness != "complete" || usage.Tokens.Total == nil || *usage.Tokens.Total != "0" {
					t.Fatal("observed zero discarded")
				}
			} else {
				if usage.Completeness != "unknown" || usage.Tokens.Total != nil || usage.Tokens.Input != nil {
					t.Fatal("unknown/invalid usage became a measured zero")
				}
			}
			if mode == "negative" || mode == "inconsistent" || mode == "unsafe" {
				if record.Run.Capture.State != "partial" {
					t.Fatal("invalid provider usage not reported")
				}
			}
			if mode == "unsafe" {
				found := false
				for _, content := range record.Contents {
					if content.Role == "diagnostic" && strings.Contains(string(content.Data.Value), "9007199254740992") {
						found = true
					}
				}
				if !found {
					t.Fatal("original provider number not retained")
				}
			}
		})
	}
}
func TestNativeV2RejectUnicodeWhitespaceID(t *testing.T) {
	if _, err := NewRunRecorderV2("bad\u00a0id", RunRecorderV2Options{}); err == nil {
		t.Fatal("accepted Unicode whitespace ID")
	}
	if _, err := NewGraphRecorderV2("bad\u2003id", GraphRecorderOptions{}).RunRecordV2(); err == nil {
		t.Fatal("accepted Unicode whitespace ID at export")
	}
}

type nativeV2TransferAgent struct{}

func (*nativeV2TransferAgent) Name(context.Context) string { return "transfer-root" }
func (*nativeV2TransferAgent) Description(context.Context) string {
	return "Transfer failure acceptance"
}
func (*nativeV2TransferAgent) Run(context.Context, *adk.AgentInput, ...adk.AgentRunOption) *adk.AsyncIterator[*adk.AgentEvent] {
	iterator, generator := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
	go func() {
		defer generator.Close()
		generator.Send(&adk.AgentEvent{Action: &adk.AgentAction{TransferToAgent: &adk.TransferToAgentAction{DestAgentName: "missing-child"}}})
	}()
	return iterator
}
func TestNativeV2OuterRunnerFailureIsAuthoritative(t *testing.T) {
	ctx := context.Background()
	recorder := NewAgentRecorderV2("native-transfer-failed", AgentRecorderOptions{})
	iterator, err := recorder.Query(ctx, adk.NewRunner(ctx, adk.RunnerConfig{Agent: &nativeV2TransferAgent{}}), "question")
	if err != nil {
		t.Fatal(err)
	}
	var actual error
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			actual = event.Err
		}
	}
	if actual == nil {
		t.Fatal("real runner did not fail")
	}
	record, err := recorder.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	requireV2Fixture(t, "agent-transfer-failed", record)
	if record.Run.Status != "failed" || record.Invocations[0].Error == nil || !strings.Contains(record.Invocations[0].Error.Message, "missing-child") {
		data, _ := json.MarshalIndent(record, "", "  ")
		t.Fatalf("callback copy overwrote actual Runner failure: %s", data)
	}
	time.Sleep(5 * time.Millisecond)
	again, _ := recorder.RunRecordV2()
	if again.Run.Status != "failed" {
		t.Fatal("late callback overwrote root outcome")
	}
}
func TestNativeV2LegacyManualEntrypointsFailExplicitly(t *testing.T) {
	for _, withHandler := range []bool{false, true} {
		t.Run(fmt.Sprint(withHandler), func(t *testing.T) {
			ctx := context.Background()
			recorder := NewAgentRecorderV2("native-wrap", AgentRecorderOptions{})
			recorder.RecordMessage(schema.UserMessage("question"))
			options := []adk.AgentRunOption{}
			if withHandler {
				options = append(options, adk.WithCallbacks(recorder.Handler()))
			}
			iterator := recorder.Wrap(adk.NewRunner(ctx, adk.RunnerConfig{Agent: &nativeV2TransferAgent{}}).Query(ctx, "question", options...))
			for {
				_, ok := iterator.Next()
				if !ok {
					break
				}
			}
			if _, err := recorder.RunRecordV2(); err == nil {
				t.Fatal("legacy manual entry silently emitted an empty or invented v2 record")
			}
		})
	}
}

func TestNativeV2EmptyRedactedErrorIsMissingEvidence(t *testing.T) {
	for name, replacement := range map[string]any{"null": nil, "empty": ""} {
		t.Run(name, func(t *testing.T) {
			workflow := compose.NewWorkflow[string, string]()
			workflow.AddLambdaNode("fail", compose.InvokableLambda(func(context.Context, string) (string, error) { return "", errors.New("SECRET") })).AddInput(compose.START)
			workflow.End().AddInput("fail")
			options := WorkflowRecorderOptions{Envelope: EnvelopeOptions{Policy: ProjectionPolicy{Redact: func(path []string, value any) (any, bool) {
				if len(path) > 0 && path[len(path)-1] == "message" {
					return replacement, true
				}
				return nil, false
			}}}}
			recorder := NewWorkflowRecorderV2("native-empty-error", options)
			runnable, err := workflow.Compile(context.Background(), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			_, _ = runnable.Invoke(context.Background(), "input", recorder.InvokeOption())
			record, err := recorder.RunRecordV2()
			if err != nil {
				t.Fatal(err)
			}
			if record.Run.Status != "failed" || record.Run.Capture.State != "partial" {
				t.Fatal("redacted error changed outcome or hid capture loss")
			}
			for _, call := range record.Invocations {
				if call.Error != nil {
					t.Fatalf("empty error should be absent: %#v", call.Error)
				}
			}
			requireV2Fixture(t, "capture-empty-error-"+name, record)
		})
	}
}
