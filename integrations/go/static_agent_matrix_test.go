package einoworkflowsnapshot

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// These test doubles replace only the external model/provider. Eino's real
// Runner, ChatModelAgent turn loop, tool dispatch, middleware, cancellation and
// interrupt machinery produce every event captured by the recorder.
type staticAgentMatrixModel struct {
	scenario string
	calls    int32
	started  chan struct{}
	release  chan struct{}
}

func (m *staticAgentMatrixModel) GetType() string { return "StaticAgentMatrixModel" }

func (m *staticAgentMatrixModel) Generate(ctx context.Context, messages []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	call := atomic.AddInt32(&m.calls, 1)
	if call > 2 {
		return nil, errors.New("unexpected third model invocation")
	}
	if m.scenario == "direct-answer" {
		return schema.AssistantMessage("你好，运行已完成。", nil), nil
	}
	if m.scenario == "adk-cancelled" {
		close(m.started)
		select {
		case <-m.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	for _, message := range messages {
		if message.Role != schema.Tool {
			continue
		}
		if m.scenario == "tool-recovered" {
			if !strings.Contains(message.Content, "quote provider unavailable") || !strings.Contains(message.Content, `"recovered":true`) {
				return nil, fmt.Errorf("recovery result did not reach the model: %s", message.Content)
			}
			return schema.AssistantMessage("已恢复：使用缓存报价 120 元。", nil), nil
		}
		return schema.AssistantMessage("已读取资料：private@example.test，欢迎 Ada。", nil), nil
	}
	return schema.AssistantMessage("", []schema.ToolCall{{
		ID: "call-" + m.scenario, Type: "function",
		Function: schema.FunctionCall{Name: "lookup_profile", Arguments: `{"customer":"Ada"}`},
	}}), nil
}

func (m *staticAgentMatrixModel) Stream(context.Context, []*schema.Message, ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, errors.New("static matrix must not request streaming")
}

func (m *staticAgentMatrixModel) WithTools([]*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}

type staticAgentMatrixTool struct {
	scenario string
	calls    int32
}

func (t *staticAgentMatrixTool) Info(context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{Name: "lookup_profile", Desc: "Look up a synthetic customer profile for recorder acceptance tests."}, nil
}

func (t *staticAgentMatrixTool) InvokableRun(ctx context.Context, input string, _ ...tool.Option) (string, error) {
	atomic.AddInt32(&t.calls, 1)
	if input != `{"customer":"Ada"}` {
		return "", fmt.Errorf("unexpected tool input %s", input)
	}
	switch t.scenario {
	case "tool-recovered":
		return "", errors.New("quote provider unavailable")
	case "tool-interrupted":
		return "", tool.Interrupt(ctx, "approval required for booking")
	default:
		return `{"customer":"Ada","email":"private@example.test"}`, nil
	}
}

func TestStaticAgentRecorderMatrix(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		query      string
		outcome    string
		capture    string
		answer     string
		modelCalls int32
		toolCalls  int32
	}{
		{"direct-answer", "请直接打个招呼。", "success", "complete", "你好，运行已完成。", 1, 0},
		{"tool-recovered", "查询报价；供应商失败时使用缓存报价。", "success", "complete", "已恢复：使用缓存报价 120 元。", 2, 1},
		{"adk-cancelled", "查询客户资料，但在模型完成后取消。", "cancelled", "complete", "", 1, 0},
		{"tool-interrupted", "提交预订前，先请求人工批准。", "unknown", "complete", "", 1, 1},
		{"redacted-tool", "读取客户资料，不在记录里保留邮箱。", "success", "partial", "已读取资料：private@example.test，欢迎 Ada。", 2, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			matrixModel := &staticAgentMatrixModel{scenario: scenario.name}
			matrixTool := &staticAgentMatrixTool{scenario: scenario.name}
			var recovered int32
			toolsConfig := adk.ToolsConfig{}
			if scenario.name != "direct-answer" {
				toolsConfig.ToolsNodeConfig = compose.ToolsNodeConfig{Tools: []tool.BaseTool{matrixTool}, ExecuteSequentially: true}
			}
			if scenario.name == "tool-recovered" {
				// ToolCallMiddlewares is Eino's official invokable-tool recovery
				// extension. next executes the real failing tool before recovery.
				toolsConfig.ToolCallMiddlewares = []compose.ToolMiddleware{{Invokable: func(next compose.InvokableToolEndpoint) compose.InvokableToolEndpoint {
					return func(ctx context.Context, input *compose.ToolInput) (*compose.ToolOutput, error) {
						output, err := next(ctx, input)
						if err == nil {
							return output, nil
						}
						atomic.AddInt32(&recovered, 1)
						if err.Error() != "quote provider unavailable" {
							return nil, err
						}
						return &compose.ToolOutput{Result: `{"recovered":true,"error":"quote provider unavailable","price":120}`}, nil
					}
				}}}
			}
			if scenario.name == "adk-cancelled" {
				matrixModel.started = make(chan struct{})
				matrixModel.release = make(chan struct{})
			}
			agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
				Name: "static-matrix-" + scenario.name, Instruction: "Follow the requested synthetic acceptance scenario.",
				Model: matrixModel, ToolsConfig: toolsConfig,
			})
			if err != nil {
				t.Fatal(err)
			}
			runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
			options := AgentRecorderOptions{}
			if scenario.name == "redacted-tool" {
				options.Envelope.Policy.Redact = func(_ []string, value any) (any, bool) {
					text, ok := value.(string)
					if !ok || !strings.Contains(text, "private@example.test") {
						return nil, false
					}
					return strings.ReplaceAll(text, "private@example.test", "[REDACTED]"), true
				}
			}
			recorder := NewAgentRecorder("run-static-agent-"+scenario.name, options)
			clock := time.UnixMilli(1_790_000_000_000)
			recorder.now = func() time.Time { clock = clock.Add(time.Millisecond); return clock }
			var runOptions []adk.AgentRunOption
			var cancel adk.AgentCancelFunc
			if scenario.name == "adk-cancelled" {
				var option adk.AgentRunOption
				option, cancel = adk.WithCancel()
				runOptions = append(runOptions, option)
			}
			iterator, err := recorder.Query(ctx, runner, scenario.query, runOptions...)
			if err != nil {
				t.Fatal(err)
			}
			var cancelHandle *adk.CancelHandle
			if cancel != nil {
				select {
				case <-matrixModel.started:
				case <-ctx.Done():
					t.Fatal("real model was not entered before cancellation")
				}
				var accepted bool
				cancelHandle, accepted = cancel(adk.WithAgentCancelMode(adk.CancelAfterChatModel))
				if !accepted {
					t.Fatal("Eino rejected cancellation before the model safe point")
				}
				close(matrixModel.release)
			}
			var answer string
			var runErr error
			interrupted := false
			for {
				event, ok := iterator.Next()
				if !ok {
					break
				}
				if event.Err != nil {
					runErr = event.Err
				}
				if event.Action != nil && event.Action.Interrupted != nil {
					interrupted = true
				}
				if event.Output != nil && event.Output.MessageOutput != nil {
					message := event.Output.MessageOutput.Message
					if message != nil && message.Role == schema.Assistant && len(message.ToolCalls) == 0 {
						answer = message.Content
					}
				}
			}
			if cancelHandle != nil {
				if err := cancelHandle.Wait(); err != nil {
					t.Fatalf("Eino cancellation did not finish: %v", err)
				}
				var cancelled *adk.CancelError
				if !errors.As(runErr, &cancelled) {
					t.Fatalf("expected native adk.CancelError, got %v", runErr)
				}
			} else if runErr != nil {
				t.Fatal(runErr)
			}
			if interrupted != (scenario.name == "tool-interrupted") {
				t.Fatalf("real Eino interrupt observed = %v", interrupted)
			}
			if answer != scenario.answer || atomic.LoadInt32(&matrixModel.calls) != scenario.modelCalls || atomic.LoadInt32(&matrixTool.calls) != scenario.toolCalls {
				t.Fatalf("answer=%q modelCalls=%d toolCalls=%d", answer, matrixModel.calls, matrixTool.calls)
			}
			if scenario.name == "tool-recovered" && atomic.LoadInt32(&recovered) != 1 {
				t.Fatal("official tool middleware did not recover the real error")
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, record.Evidence, scenario.outcome, scenario.capture)
			record.Metadata = JSONMap{"scenario": scenario.name, "runtime": "eino-adk-runner", "modelMode": "deterministic-test-double", "streaming": false}
			if scenario.name == "redacted-tool" {
				encoded, _ := json.Marshal(record)
				if strings.Contains(string(encoded), "private@example.test") || !strings.Contains(string(encoded), "[REDACTED]") {
					t.Fatal("redacted fixture leaked the synthetic email or lost the placeholder")
				}
			}
			filename := "agent-" + scenario.name + ".json"
			if scenario.name == "adk-cancelled" {
				filename = "agent-cancelled.json"
			}
			agentMatrixFixture(t, record, filename)
		})
	}
}

var agentMatrixUUID = regexp.MustCompile(`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)

func agentMatrixFixture(t *testing.T, record RunRecord, filename string) {
	t.Helper()
	if err := staticAgentEvidenceOrderError(record.Evidence); err != nil {
		t.Fatalf("actual recorder evidence order: %v", err)
	}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("..", "..", "fixtures", "recorder-matrix", filename)
	if os.Getenv("WRITE_STATIC_AGENT_FIXTURES") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var expectedRecord RunRecord
	if err := json.Unmarshal(expected, &expectedRecord); err != nil {
		t.Fatal(err)
	}
	if err := staticAgentEvidenceOrderError(expectedRecord.Evidence); err != nil {
		t.Fatalf("golden recorder evidence order: %v", err)
	}
	// Preserve the raw runtime payload, correlation and observed ordering in
	// the fixture. Only comparison copies normalize Eino-allocated identities.
	actualComparison := agentMatrixComparisonRecord(t, encoded)
	expectedComparison, err := json.Marshal(agentMatrixComparisonRecord(t, expected))
	if err != nil {
		t.Fatal(err)
	}
	if !equivalentRunRecordFixture(t, actualComparison, expectedComparison) {
		t.Fatalf("real Agent recorder output differs from %s\nactual:\n%s", filename, encoded)
	}
}

// Compare only causal order within this run and each component identity.
// Independent callback/event delivery can interleave without imposing one
// global fixture order. An input without output is allowed: interrupted calls
// and the underlying failing tool recovered by middleware have no OnEnd.
func staticAgentEvidenceOrderError(evidence []Envelope) error {
	started, ended := false, false
	pending := map[string][]int{}
	for index, envelope := range evidence {
		if envelope.Kind == RunLifecycleKind {
			var boundary RunLifecyclePayload
			if err := json.Unmarshal(envelope.Payload, &boundary); err != nil {
				return err
			}
			switch boundary.State {
			case "started":
				if started || ended {
					return fmt.Errorf("evidence[%d]: repeated or late run start", index)
				}
				started = true
			case "ended":
				if !started || ended {
					return fmt.Errorf("evidence[%d]: run end without one earlier start", index)
				}
				ended = true
			default:
				return fmt.Errorf("evidence[%d]: unexpected lifecycle state %q", index, boundary.State)
			}
			continue
		}
		if !started || ended {
			return fmt.Errorf("evidence[%d]: runtime evidence outside the observed run boundaries", index)
		}
		if envelope.Kind != ComponentIOKind {
			continue
		}
		var component ComponentIOPayload
		if err := json.Unmarshal(envelope.Payload, &component); err != nil {
			return err
		}
		entityID := envelope.Correlation["entityId"]
		if entityID == "" {
			return fmt.Errorf("evidence[%d]: missing component correlation", index)
		}
		// Tool entity IDs include the call ID; repeated model turns reuse an
		// entity ID, so pair each output with its earliest unmatched input.
		key := component.Component + "\x00" + entityID
		switch component.Direction {
		case ComponentIOInput:
			pending[key] = append(pending[key], index)
		case ComponentIOOutput:
			if len(pending[key]) == 0 {
				return fmt.Errorf("evidence[%d]: component output has no earlier matching input: %s", index, entityID)
			}
			pending[key] = pending[key][1:]
		default:
			return fmt.Errorf("evidence[%d]: unexpected component direction %q", index, component.Direction)
		}
	}
	if !started || !ended {
		return errors.New("completed matrix capture requires one observed start and one later end")
	}
	return nil
}

func TestStaticAgentRecorderOrderGuards(t *testing.T) {
	encoded, err := os.ReadFile("../../fixtures/recorder-matrix/agent-redacted-tool.json")
	if err != nil {
		t.Fatal(err)
	}
	var record RunRecord
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	if err := staticAgentEvidenceOrderError(record.Evidence); err != nil {
		t.Fatal(err)
	}
	// Mutate only copies of real captured evidence to prove that the order
	// guard catches inversions even when the evidence multiset is unchanged.
	inverted := append([]Envelope(nil), record.Evidence...)
	inverted[0], inverted[len(inverted)-1] = inverted[len(inverted)-1], inverted[0]
	if err := staticAgentEvidenceOrderError(inverted); err == nil {
		t.Fatal("run boundary inversion was accepted")
	}
	inputIndex := -1
	for index, envelope := range record.Evidence {
		if envelope.Kind != ComponentIOKind {
			continue
		}
		var component ComponentIOPayload
		if err := json.Unmarshal(envelope.Payload, &component); err != nil {
			t.Fatal(err)
		}
		if component.Direction == ComponentIOInput && inputIndex < 0 {
			inputIndex = index
		}
		if component.Direction == ComponentIOOutput && inputIndex >= 0 && envelope.Correlation["entityId"] == record.Evidence[inputIndex].Correlation["entityId"] {
			inverted = append([]Envelope(nil), record.Evidence...)
			inverted[inputIndex], inverted[index] = inverted[index], inverted[inputIndex]
			if err := staticAgentEvidenceOrderError(inverted); err == nil {
				t.Fatal("component output-before-input inversion was accepted")
			}
			return
		}
	}
	t.Fatal("real fixture has no component input/output pair to test")
}

func agentMatrixComparisonRecord(t *testing.T, encoded []byte) RunRecord {
	t.Helper()
	var record RunRecord
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	// Callback capture and iterator delivery can interleave, so diagnostics
	// have no stable cross-envelope arrival order either. Compare the complete
	// diagnostic multiset, preserving every field and duplicate occurrence.
	// This sorts only the decoded comparison copy, never the raw RunRecord.
	sort.SliceStable(record.Diagnostics, func(left, right int) bool {
		leftJSON, _ := json.Marshal(record.Diagnostics[left])
		rightJSON, _ := json.Marshal(record.Diagnostics[right])
		return string(leftJSON) < string(rightJSON)
	})
	for index := range record.Evidence {
		removeGeneratedMessageIDs(t, &record.Evidence[index])
		if record.Evidence[index].Kind != AgentEventKind {
			continue
		}
		var payload AgentEventPayload
		if err := json.Unmarshal(record.Evidence[index].Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Action != nil && payload.Action.Interrupted != nil {
			// Eino's opaque checkpoint includes random IDs, gob registration
			// numbers and version-specific runtime state. Verify its presence,
			// then omit only that internal checkpoint from comparison copies.
			// The exported golden retains the complete unmodified checkpoint.
			data, ok := payload.Action.Interrupted.Data.(map[string]any)
			if !ok || data["Info"] == nil {
				t.Fatal("real tool interruption did not capture its checkpoint info")
			}
			checkpoint, ok := data["Data"].(string)
			if decoded, err := base64.StdEncoding.DecodeString(checkpoint); !ok || err != nil || len(decoded) == 0 {
				t.Fatal("real tool interruption did not capture its opaque checkpoint")
			}
			payload.Action.Interrupted.Data = map[string]any{"opaqueCheckpoint": "present"}
			normalized, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			record.Evidence[index].Payload = normalized
		}
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	encoded = agentMatrixUUID.ReplaceAllFunc(encoded, func(id []byte) []byte {
		if ids[string(id)] == "" {
			ids[string(id)] = fmt.Sprintf("matrix-context-%d", len(ids)+1)
		}
		return []byte(ids[string(id)])
	})
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestStaticAgentRecorderDiagnosticComparison(t *testing.T) {
	encoded, err := os.ReadFile("../../fixtures/recorder-matrix/agent-redacted-tool.json")
	if err != nil {
		t.Fatal(err)
	}
	var record RunRecord
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	canonical := func(record RunRecord) string {
		t.Helper()
		input, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		return string(normalizedRunRecordFixture(t, agentMatrixComparisonRecord(t, input)))
	}
	want := canonical(record)
	for left, right := 0, len(record.Diagnostics)-1; left < right; left, right = left+1, right-1 {
		record.Diagnostics[left], record.Diagnostics[right] = record.Diagnostics[right], record.Diagnostics[left]
	}
	if got := canonical(record); got != want {
		t.Fatal("diagnostic arrival order changed the comparison")
	}
	duplicateIndex := -1
	for index, diagnostic := range record.Diagnostics {
		for previous := 0; previous < index; previous++ {
			if record.Diagnostics[previous] == diagnostic {
				duplicateIndex = index
				break
			}
		}
	}
	if duplicateIndex < 0 {
		t.Fatal("real redacted capture has no duplicate diagnostic to verify")
	}
	missing := record
	missing.Diagnostics = append([]Diagnostic(nil), record.Diagnostics[:duplicateIndex]...)
	missing.Diagnostics = append(missing.Diagnostics, record.Diagnostics[duplicateIndex+1:]...)
	if canonical(missing) == want {
		t.Fatal("comparison discarded diagnostic multiplicity")
	}
	changed := record
	changed.Diagnostics = append([]Diagnostic(nil), record.Diagnostics...)
	changed.Diagnostics[0].Message += " changed"
	if canonical(changed) == want {
		t.Fatal("comparison discarded diagnostic content")
	}
}
