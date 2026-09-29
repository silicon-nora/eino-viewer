package einoworkflowsnapshot

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"errors"
	"io"
	"os"
	"testing"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

func TestAgentEventProjectionDoesNotConsumeLiveStream(t *testing.T) {
	stream := schema.StreamReaderFromArray([]*schema.Message{{
		Role:    schema.Assistant,
		Content: "first chunk",
	}})
	defer stream.Close()
	event := &adk.AgentEvent{
		AgentName: "researcher",
		Output: &adk.AgentOutput{MessageOutput: &adk.MessageVariant{
			IsStreaming:   true,
			MessageStream: stream,
			Role:          schema.Assistant,
		}},
	}
	envelope, diagnostics, err := ProjectAgentEventEnvelope(event, EnvelopeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 1 || diagnostics[0].Code != "projection.stream_omitted" {
		t.Fatalf("expected explicit stream warning, got %#v", diagnostics)
	}
	var payload AgentEventPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Output == nil || payload.Output.Message == nil || !payload.Output.Message.Streaming || payload.Output.Message.Value != nil {
		t.Fatalf("unexpected streaming projection: %#v", payload)
	}
	chunk, err := stream.Recv()
	if err != nil || chunk.Content != "first chunk" {
		t.Fatalf("projector consumed the live stream: %#v %v", chunk, err)
	}
	if _, err := stream.Recv(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected stream EOF, got %v", err)
	}
}

func TestAgentEventEnvelopesMatchSharedFixture(t *testing.T) {
	step := runStep(t, "planner")
	messageEvent := &adk.AgentEvent{
		AgentName: "planner",
		RunPath:   []adk.RunStep{step},
		Output: &adk.AgentOutput{MessageOutput: &adk.MessageVariant{
			Message: &schema.Message{
				Role:    schema.Assistant,
				Content: "Calling the weather agent.",
			},
			Role: schema.Assistant,
		}},
	}
	actionEvent := &adk.AgentEvent{
		AgentName: "planner",
		Action: &adk.AgentAction{
			TransferToAgent: &adk.TransferToAgentAction{DestAgentName: "weather-agent"},
			BreakLoop: &adk.BreakLoopAction{
				From:              "planner",
				Done:              true,
				CurrentIterations: 2,
			},
			CustomizedAction: map[string]any{"reason": "fixture"},
		},
	}
	errorEvent := &adk.AgentEvent{AgentName: "weather-agent", Err: errors.New("weather backend unavailable")}
	observedAt := int64(1_789_000_000_100)
	options := EnvelopeOptions{
		Source:       map[string]string{"einoVersion": "0.9.19"},
		Correlation:  map[string]string{"runId": "run-agent-1"},
		ObservedAtMS: &observedAt,
	}
	events := []*adk.AgentEvent{messageEvent, actionEvent, errorEvent}
	envelopes := make([]Envelope, 0, len(events))
	for _, event := range events {
		envelope, diagnostics, err := ProjectAgentEventEnvelope(event, options)
		if err != nil {
			t.Fatal(err)
		}
		if len(diagnostics) != 0 {
			t.Fatalf("unexpected diagnostics: %#v", diagnostics)
		}
		envelopes = append(envelopes, envelope)
	}
	actual, err := json.MarshalIndent(envelopes, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err := os.ReadFile("../../fixtures/eino-agent-events-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("agent events do not match shared fixture\nactual:\n%s", actual)
	}
}

func TestAgenticEventProjectionPreservesMaterializedMessage(t *testing.T) {
	event := &adk.TypedAgentEvent[*schema.AgenticMessage]{
		AgentName: "assistant",
		Output: &adk.TypedAgentOutput[*schema.AgenticMessage]{
			MessageOutput: &adk.TypedMessageVariant[*schema.AgenticMessage]{
				Message:     &schema.AgenticMessage{Role: schema.AgenticRoleTypeAssistant},
				AgenticRole: schema.AgenticRoleTypeAssistant,
			},
		},
	}
	envelope, diagnostics, err := ProjectAgenticEventEnvelope(event, EnvelopeOptions{})
	if err != nil || len(diagnostics) != 0 {
		t.Fatalf("unexpected projection: %v %#v", err, diagnostics)
	}
	if envelope.Source["format"] != "TypedAgentEvent[AgenticMessage]" {
		t.Fatalf("unexpected source: %#v", envelope.Source)
	}
}

func TestAgentEventProjectionRejectsNilAndUnsafeCustomValues(t *testing.T) {
	if _, _, err := ProjectAgentEventEnvelope(nil, EnvelopeOptions{}); !errors.Is(err, ErrNilAgentEvent) {
		t.Fatalf("expected ErrNilAgentEvent, got %v", err)
	}
	event := &adk.AgentEvent{Output: &adk.AgentOutput{CustomizedOutput: func() {}}}
	if _, _, err := ProjectAgentEventEnvelope(event, EnvelopeOptions{}); !errors.Is(err, ErrUnsafeJSON) {
		t.Fatalf("expected ErrUnsafeJSON, got %v", err)
	}
}

func runStep(t *testing.T, name string) adk.RunStep {
	t.Helper()
	var encoded bytes.Buffer
	if err := gob.NewEncoder(&encoded).Encode(&struct{ AgentName string }{AgentName: name}); err != nil {
		t.Fatal(err)
	}
	var step adk.RunStep
	if err := step.GobDecode(encoded.Bytes()); err != nil {
		t.Fatal(err)
	}
	return step
}
