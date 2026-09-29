package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

type complexRecorderModel struct {
	parallel bool
	calls    recorderAtomicCounter
}

func (m *complexRecorderModel) GetType() string { return "ComplexRecorderModel" }
func (m *complexRecorderModel) WithTools([]*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}
func (m *complexRecorderModel) Stream(context.Context, []*schema.Message, ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, fmt.Errorf("streaming intentionally unsupported")
}
func (m *complexRecorderModel) Generate(_ context.Context, messages []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	turn := m.calls.Add(1)
	call := func(id, key string) schema.ToolCall {
		return schema.ToolCall{ID: id, Type: "function", Function: schema.FunctionCall{Name: "lookup_item", Arguments: fmt.Sprintf(`{"key":%q}`, key)}}
	}
	if turn == 1 {
		if m.parallel {
			return schema.AssistantMessage("", []schema.ToolCall{call("call-slow", "slow"), call("call-fast", "fast")}), nil
		}
		return schema.AssistantMessage("", []schema.ToolCall{call("call-repeat-1", "first")}), nil
	}
	results := map[string]string{}
	for _, message := range messages {
		if message.Role == schema.Tool {
			results[message.ToolCallID] = message.Content
		}
	}
	if m.parallel {
		if results["call-fast"] != "result:fast" || results["call-slow"] != "result:slow" {
			return nil, fmt.Errorf("parallel results misassociated: %v", results)
		}
		return schema.AssistantMessage("两个同名工具已完成：fast 与 slow。", nil), nil
	}
	if results["call-repeat-1"] != "result:first" {
		return nil, fmt.Errorf("first tool result misassociated")
	}
	if turn == 2 {
		return schema.AssistantMessage("", []schema.ToolCall{call("call-repeat-2", "second")}), nil
	}
	if results["call-repeat-2"] != "result:second" {
		return nil, fmt.Errorf("repeated tool result misassociated")
	}
	return schema.AssistantMessage("同名工具两次调用已分别完成：first、second。", nil), nil
}

type complexRecorderTool struct {
	parallel     bool
	slowStarted  chan struct{}
	fastObserved chan struct{}
	mu           sync.Mutex
	ids          map[string]string
}

func (*complexRecorderTool) Info(context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{Name: "lookup_item", Desc: "Deterministic item lookup for non-streaming recorder acceptance."}, nil
}
func (tool *complexRecorderTool) InvokableRun(ctx context.Context, input string, _ ...tool.Option) (string, error) {
	var args struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal([]byte(input), &args); err != nil {
		return "", err
	}
	// This ID comes from actual Eino tool dispatch, not from event adjacency.
	id := compose.GetToolCallID(ctx)
	if id == "" {
		return "", fmt.Errorf("Eino tool call ID missing")
	}
	tool.mu.Lock()
	tool.ids[id] = args.Key
	tool.mu.Unlock()
	if tool.parallel {
		if args.Key == "slow" {
			close(tool.slowStarted)
			select {
			case <-tool.fastObserved:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		} else {
			select {
			case <-tool.slowStarted:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
	}
	return "result:" + args.Key, nil
}

func TestComplexAgentRecorderMatrix(t *testing.T) {
	for _, parallel := range []bool{true, false} {
		name := "agent-repeated-tool"
		if parallel {
			name = "agent-parallel-same-tool"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			provider := &complexRecorderModel{parallel: parallel}
			implementation := &complexRecorderTool{parallel: parallel, slowStarted: make(chan struct{}), fastObserved: make(chan struct{}), ids: map[string]string{}}
			agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: name, Model: provider, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: []tool.BaseTool{implementation}, ExecuteSequentially: !parallel}}})
			if err != nil {
				t.Fatal(err)
			}
			runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
			recorder := NewAgentRecorder("run-"+name, AgentRecorderOptions{})
			recorder.now = graphIOClock
			iterator, err := recorder.Query(ctx, runner, "分别查询每次工具调用，并汇总最终结果。")
			if err != nil {
				t.Fatal(err)
			}
			order := []string{}
			final := ""
			for {
				event, ok := iterator.Next()
				if !ok {
					break
				}
				if event.Err != nil {
					t.Fatal(event.Err)
				}
				if event.Output == nil || event.Output.MessageOutput == nil {
					continue
				}
				message := event.Output.MessageOutput.Message
				if message == nil {
					continue
				}
				if message.Role == schema.Tool {
					order = append(order, message.ToolCallID)
					if parallel && message.ToolCallID == "call-fast" {
						close(implementation.fastObserved)
					}
				}
				if message.Role == schema.Assistant && len(message.ToolCalls) == 0 {
					final = message.Content
				}
			}
			if len(order) != 2 || final == "" {
				t.Fatalf("actual execution incomplete: %v %q", order, final)
			}
			if parallel && strings.Join(order, ",") != "call-fast,call-slow" {
				t.Fatalf("source completion was not deliberately out of planning order: %v", order)
			}
			wantTurns := int32(3)
			if parallel {
				wantTurns = 2
			}
			if provider.calls.Load() != wantTurns {
				t.Fatal("unexpected actual model turns")
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, record.Evidence, "success", "complete")
			assertComplexRecorderSourceFacts(t, record, implementation.ids)
			complexRecorderFixture(t, record, name+".json")
		})
	}
}

func assertComplexRecorderSourceFacts(t *testing.T, record RunRecord, sourceCalls map[string]string) {
	t.Helper()
	if err := staticAgentEvidenceOrderError(record.Evidence); err != nil {
		t.Fatal(err)
	}
	inputs, outputs, events := map[string]int{}, map[string]int{}, map[string]int{}
	for _, envelope := range record.Evidence {
		var payload map[string]any
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if envelope.Kind == ComponentIOKind && payload["component"] == "Tool" {
			var id string
			for _, segment := range payload["address"].([]any) {
				address := segment.(map[string]any)
				if address["type"] == "tool" {
					id, _ = address["subId"].(string)
				}
			}
			key, ok := sourceCalls[id]
			if !ok {
				t.Fatalf("recorded tool lacks source dispatch: %s", id)
			}
			if !strings.HasSuffix(envelope.Correlation["entityId"], ":"+id) {
				t.Fatalf("entity does not retain exact tool call ID: %s", id)
			}
			body := payload["body"].(map[string]any)
			if payload["direction"] == "input" {
				if body["argumentsJson"] != fmt.Sprintf(`{"key":%q}`, key) {
					t.Fatal("input assigned to wrong tool call")
				}
				inputs[id]++
			} else {
				if body["response"] != "result:"+key {
					t.Fatal("output assigned to wrong tool call")
				}
				outputs[id]++
			}
		}
		if envelope.Kind == AgentEventKind {
			var event AgentEventPayload
			json.Unmarshal(envelope.Payload, &event)
			if event.Output != nil && event.Output.Message != nil && event.Output.Message.Role == "tool" {
				message := event.Output.Message.Value.(map[string]any)
				id := message["tool_call_id"].(string)
				if message["content"] != "result:"+sourceCalls[id] {
					t.Fatal("AgentEvent tool result misassociated")
				}
				events[id]++
			}
		}
	}
	for id := range sourceCalls {
		if inputs[id] != 1 || outputs[id] != 1 || events[id] != 1 {
			t.Fatalf("call %s source facts count input/output/event=%d/%d/%d", id, inputs[id], outputs[id], events[id])
		}
	}
}

func complexRecorderFixture(t *testing.T, record RunRecord, filename string) {
	t.Helper()
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("../../fixtures/recorder-matrix", filename)
	if os.Getenv("WRITE_COMPLEX_RECORDER_FIXTURES") == "1" {
		if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
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
		t.Fatalf("complex fixture source facts changed: %s", filename)
	}
}
