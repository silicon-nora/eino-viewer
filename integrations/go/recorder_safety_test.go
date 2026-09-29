package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

type recorderSafetyModel struct {
	answer *schema.Message
	mutate bool
	calls  int
}

type recorderCountingMarshaler struct{ calls *recorderAtomicCounter }

func (value recorderCountingMarshaler) MarshalJSON() ([]byte, error) {
	value.calls.Add(1)
	return []byte(`"legacy custom value"`), nil
}

func TestRecorderSafeBoundaryDoesNotChangePublicProjectors(t *testing.T) {
	var calls recorderAtomicCounter
	message := schema.AssistantMessage("answer", nil)
	message.Extra = map[string]any{"custom": recorderCountingMarshaler{&calls}}
	envelope, _, err := ProjectSchemaMessageEnvelope(message, EnvelopeOptions{})
	if err != nil || calls.Load() == 0 || !strings.Contains(string(envelope.Payload), "legacy custom value") {
		t.Fatalf("public projector no longer preserves its existing JSON behavior: %v", err)
	}
	calls.Store(0)
	envelope, diagnostics, err := safeRecorderMessage(message, EnvelopeOptions{})
	if err != nil || calls.Load() != 0 || captureCompleteness(nil, diagnostics) != "partial" {
		t.Fatalf("Recorder boundary invoked custom encoding: %v", err)
	}
	if _, exists := graphIOPayload(t, envelope)["content"]; exists {
		t.Fatal("rejected message was replaced with a manufactured answer")
	}
}

func TestAgentRecorderSafeMetadata(t *testing.T) {
	for _, introducedByRedactor := range []bool{false, true} {
		var calls recorderAtomicCounter
		metadata := JSONMap{"nested": map[string]any{"value": "original"}}
		options := AgentRecorderOptions{Envelope: EnvelopeOptions{Metadata: metadata}}
		if introducedByRedactor {
			options.Envelope.Policy.Redact = func(path []string, _ any) (any, bool) {
				if len(path) == 1 && path[0] == "metadata" {
					return recorderCountingMarshaler{&calls}, true
				}
				return nil, false
			}
		} else {
			metadata["custom"] = recorderCountingMarshaler{&calls}
		}
		record, _ := runSafetyAgent(t, &recorderSafetyModel{answer: schema.AssistantMessage("answer", nil)}, schema.UserMessage("input"), options)
		assertLifecycle(t, record.Evidence, "success", "partial")
		if calls.Load() != 0 || metadata["nested"].(map[string]any)["value"] != "original" {
			t.Fatal("Recorder metadata escaped safe-copy boundary")
		}
	}
}

func TestRecorderSafeFallbackIsBounded(t *testing.T) {
	name := strings.Repeat("x", DefaultMaxDocumentBytes+1)
	_, _, err := safeRecorderEnvelope("custom", 1, make(chan int), map[string]any{"name": name}, EnvelopeOptions{})
	if !errors.Is(err, ErrDocumentTooLarge) {
		t.Fatalf("oversized structural fallback was not bounded: %v", err)
	}
	_, _, err = safeComponentIO(context.Background(), &callbacks.RunInfo{Name: name, Component: "Lambda"}, ComponentIOInput, false, make(chan int), "node", EnvelopeOptions{})
	if !errors.Is(err, ErrDocumentTooLarge) {
		t.Fatalf("oversized component identity fallback was not bounded: %v", err)
	}
}

func (*recorderSafetyModel) GetType() string { return "RecorderSafetyModel" }
func (m *recorderSafetyModel) WithTools([]*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}
func (*recorderSafetyModel) Stream(context.Context, []*schema.Message, ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, fmt.Errorf("streaming unsupported")
}
func (m *recorderSafetyModel) Generate(_ context.Context, messages []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	m.calls++
	if m.mutate {
		for _, message := range messages {
			if message.Role == schema.User {
				message.Content = "changed by business"
				message.Extra["nested"].(map[string]any)["value"] = "changed nested"
			}
		}
	}
	return m.answer, nil
}

func runSafetyAgent(t *testing.T, provider *recorderSafetyModel, input *schema.Message, options AgentRecorderOptions) (RunRecord, *schema.Message) {
	t.Helper()
	ctx := context.Background()
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "safe-agent", Model: provider})
	if err != nil {
		t.Fatal(err)
	}
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
	recorder := NewAgentRecorder("run-safe-agent", options)
	iterator, err := recorder.Run(ctx, runner, []*schema.Message{input})
	if err != nil {
		t.Fatal(err)
	}
	var original *schema.Message
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		if event.Output != nil && event.Output.MessageOutput != nil {
			original = event.Output.MessageOutput.Message
		}
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 1 || original == nil || original.Content != provider.answer.Content || original.Role != provider.answer.Role {
		t.Fatal("recorder altered the real runner's answer")
	}
	return record, original
}

func TestAgentRecorderSafeBodyOmissionAndRedaction(t *testing.T) {
	var calls recorderAtomicCounter
	for _, scenario := range []string{"marshal-extra", "oversized", "redacted-large", "bad-redactor"} {
		t.Run(scenario, func(t *testing.T) {
			answer := schema.AssistantMessage("business answer", nil)
			options := AgentRecorderOptions{}
			switch scenario {
			case "marshal-extra":
				answer.Extra = map[string]any{"private": graphIOForbiddenMarshaler{&calls}}
			case "oversized":
				answer.Content = strings.Repeat("raw large answer", 1000)
				options.Envelope.Policy.MaxDocumentBytes = 1800
			case "redacted-large":
				answer.Content = strings.Repeat("PRIVATE_LARGE_ANSWER", 1000)
				options.Envelope.Policy = ProjectionPolicy{MaxDocumentBytes: 1800, Redact: func(_ []string, value any) (any, bool) {
					if text, ok := value.(string); ok && strings.Contains(text, "PRIVATE_LARGE_ANSWER") {
						return "[REDACTED]", true
					}
					return nil, false
				}}
			case "bad-redactor":
				options.Envelope.Policy.Redact = func(path []string, value any) (any, bool) {
					if path[len(path)-1] == "content" {
						return graphIOForbiddenMarshaler{&calls}, true
					}
					return nil, false
				}
			}
			record, original := runSafetyAgent(t, &recorderSafetyModel{answer: answer}, schema.UserMessage("input"), options)
			assertLifecycle(t, record.Evidence, "success", "partial")
			if original.Content != answer.Content || calls.Load() != 0 {
				t.Fatal("recording executed a serializer or mutated the business answer")
			}
			omissions := 0
			derived := 0
			for _, envelope := range record.Evidence {
				if strings.Contains(string(envelope.Metadata), `"status":"omitted"`) {
					omissions++
				}
				if envelope.Kind == SchemaMessageKind {
					payload := graphIOPayload(t, envelope)
					if payload["role"] == "assistant" {
						derived++
						if scenario != "redacted-large" {
							if _, exists := payload["content"]; exists {
								t.Fatal("omitted content was replaced by a fake empty/final answer")
							}
						} else if payload["content"] != "[REDACTED]" {
							t.Fatal("redaction did not precede size limit")
						}
					}
				}
			}
			if derived != 1 {
				t.Fatal("derived assistant source boundary was lost")
			}
			if scenario != "redacted-large" && omissions < 3 {
				t.Fatalf("component, event and derived message omissions=%d", omissions)
			}
			encoded, _ := json.Marshal(record)
			if strings.Contains(string(encoded), "PRIVATE_LARGE_ANSWER") {
				t.Fatal("private answer escaped redaction")
			}
		})
	}
}

func TestAgentRecorderSnapshotsBeforeBusinessMutation(t *testing.T) {
	input := schema.UserMessage("original input")
	input.Extra = map[string]any{"nested": map[string]any{"value": "original nested"}}
	record, _ := runSafetyAgent(t, &recorderSafetyModel{answer: schema.AssistantMessage("answer", nil), mutate: true}, input, AgentRecorderOptions{})
	for _, envelope := range record.Evidence {
		if envelope.Kind == SchemaMessageKind {
			payload := graphIOPayload(t, envelope)
			if payload["role"] == "user" {
				if payload["content"] != "original input" || payload["extra"].(map[string]any)["nested"].(map[string]any)["value"] != "original nested" {
					t.Fatal("recorded user message aliased caller data")
				}
			}
		}
		if envelope.Kind == ComponentIOKind {
			payload := graphIOPayload(t, envelope)
			if payload["direction"] == "input" {
				messages := payload["body"].(map[string]any)["messages"].([]any)
				for _, message := range messages {
					value := message.(map[string]any)
					if value["role"] == "user" && value["content"] != "original input" {
						t.Fatal("model input was snapshotted after business mutation")
					}
				}
			}
		}
	}
}

func TestAgentRecorderSafeCustomizedEventsAndToolDefinitions(t *testing.T) {
	var calls recorderAtomicCounter
	unsafe := graphIOForbiddenMarshaler{&calls}
	recorder := NewAgentRecorder("safe-explicit", AgentRecorderOptions{})
	recorder.RecordMessage(&schema.Message{Role: schema.User, Content: "source input", Extra: map[string]any{"private": unsafe}})
	recorder.RecordEvent(&adk.AgentEvent{AgentName: "source-agent", Output: &adk.AgentOutput{CustomizedOutput: unsafe}, Action: &adk.AgentAction{CustomizedAction: unsafe}})
	params := map[string]*schema.ParameterInfo{}
	cycle := &schema.ParameterInfo{Type: schema.Object, SubParams: params}
	params["cycle"] = cycle
	recorder.RecordTool(&schema.ToolInfo{Name: "lookup", Desc: "safe description", ParamsOneOf: schema.NewParamsOneOfByParams(params), Extra: map[string]any{"private": unsafe}})
	evidence, diagnostics, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || captureCompleteness(nil, diagnostics) != "partial" {
		t.Fatal("unsafe explicit recorder data was not omitted")
	}
	if len(evidence) != 3 {
		t.Fatal("source envelope identities were lost")
	}
	toolPayload := graphIOPayload(t, evidence[2])
	if toolPayload["name"] != "lookup" {
		t.Fatal("safe tool identity missing")
	}
	if _, exists := toolPayload["params"]; exists {
		t.Fatal("unsupported cyclic parameters were serialized")
	}
	if !strings.Contains(string(evidence[2].Metadata), `"status":"omitted"`) {
		t.Fatal("unsafe tool extension omission not explicit")
	}
	parameterOmitted := false
	for _, diagnostic := range diagnostics {
		if diagnostic.Path == "/payload/params" && strings.Contains(diagnostic.Message, "unsupported_value") {
			parameterOmitted = true
		}
	}
	if !parameterOmitted {
		t.Fatal("tool parameter omission has no reason")
	}
}

func TestRecorderSafeOfficialModelAndToolCallbackShapes(t *testing.T) {
	info := &schema.ToolInfo{Name: "lookup", Desc: "lookup item", ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{"key": {Type: schema.String, Required: true}})}
	value := &model.CallbackInput{Messages: []*schema.Message{schema.UserMessage("")}, Tools: []*schema.ToolInfo{info}}
	envelope, diagnostics, err := safeComponentIO(context.Background(), &callbacks.RunInfo{Component: "ChatModel"}, ComponentIOInput, false, value, "node", EnvelopeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	payload := graphIOPayload(t, envelope)
	body := payload["body"].(map[string]any)
	if payload["format"] != "model.CallbackInput" || body["messages"].([]any)[0].(map[string]any)["content"] != "" {
		t.Fatal("official model input shape or empty content changed")
	}
	if body["tools"].([]any)[0].(map[string]any)["name"] != "lookup" || captureCompleteness(nil, diagnostics) != "partial" {
		t.Fatal("safe model tool definition boundary was not explicit")
	}
	output := &tool.CallbackOutput{Response: "", Extra: map[string]any{"nested": map[string]any{"before": true}}}
	envelope, _, err = safeComponentIO(context.Background(), &callbacks.RunInfo{Component: "Tool"}, ComponentIOOutput, false, output, "node", EnvelopeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	output.Extra["nested"].(map[string]any)["before"] = false
	body = graphIOPayload(t, envelope)["body"].(map[string]any)
	if body["response"] != "" || body["extra"].(map[string]any)["nested"].(map[string]any)["before"] != true {
		t.Fatal("official tool response lost empty value or snapshot")
	}
}

func TestWorkflowRecorderSafeNodeBodies(t *testing.T) {
	var calls recorderAtomicCounter
	workflow := compose.NewWorkflow[map[string]any, any]()
	workflow.AddLambdaNode("process", compose.InvokableLambda(func(_ context.Context, input map[string]any) (any, error) {
		input["nested"].(map[string]any)["value"] = "mutated"
		return graphIOForbiddenMarshaler{&calls}, nil
	})).AddInput(compose.START)
	workflow.End().AddInput("process")
	recorder := NewWorkflowRecorder("safe-workflow", WorkflowRecorderOptions{})
	runnable, err := workflow.Compile(context.Background(), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	output, err := runnable.Invoke(context.Background(), map[string]any{"nested": map[string]any{"value": "original"}}, recorder.InvokeOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := output.(graphIOForbiddenMarshaler); !ok {
		t.Fatal("business output changed")
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, record.Evidence, "success", "partial")
	inputs, outputs := 0, 0
	for _, envelope := range record.Evidence {
		if envelope.Kind != ComponentIOKind {
			continue
		}
		payload := graphIOPayload(t, envelope)
		if payload["direction"] == "input" {
			inputs++
			body := payload["body"].(map[string]any)
			if !reflect.DeepEqual(body, map[string]any{"nested": map[string]any{"value": "original"}}) {
				t.Fatal("Workflow root/node input aliased business mutation")
			}
		} else {
			outputs++
			if _, exists := payload["body"]; exists {
				t.Fatal("unsafe Workflow output serialized")
			}
			if !strings.Contains(string(envelope.Metadata), `"reason":"unsupported_value"`) {
				t.Fatal("Workflow output omission lacks reason")
			}
		}
	}
	if inputs != 2 || outputs != 2 || calls.Load() != 0 {
		t.Fatalf("root/node capture=%d/%d, unsafe method calls=%d", inputs, outputs, calls.Load())
	}
}
