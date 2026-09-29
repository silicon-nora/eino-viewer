package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/compose"
)

func TestCallbackEventRecorderProducesStableEnvelopes(t *testing.T) {
	recorder := NewCallbackEventRecorder("run-1")
	ticks := []time.Time{
		time.UnixMilli(1_000),
		time.UnixMilli(1_010),
		time.UnixMilli(1_020),
		time.UnixMilli(1_030),
	}
	recorder.now = func() time.Time {
		next := ticks[0]
		ticks = ticks[1:]
		return next
	}
	handler := recorder.Handler()
	root := compose.AppendAddressSegment(
		context.Background(),
		compose.AddressSegmentRunnable,
		"support-assistant",
	)
	prepare := compose.AppendAddressSegment(root, compose.AddressSegmentNode, "prepare")
	answer := compose.AppendAddressSegment(root, compose.AddressSegmentNode, "answer")
	model := compose.AppendAddressSegment(answer, compose.AddressSegmentNode, "invoke")

	prepareInfo := &callbacks.RunInfo{
		Name:      "Prepare",
		Type:      "fixtureLambda",
		Component: compose.ComponentOfLambda,
	}
	modelInfo := &callbacks.RunInfo{
		Name:      "Invoke",
		Type:      "fixtureModel",
		Component: components.ComponentOfChatModel,
	}
	handler.OnStart(prepare, prepareInfo, "input")
	handler.OnEnd(prepare, prepareInfo, "output")
	handler.OnStartWithStreamInput(model, modelInfo, nil)
	handler.OnError(model, modelInfo, errors.New("model unavailable"))

	events := recorder.Events()
	if len(events) != 4 {
		t.Fatalf("expected four callback events, got %#v", events)
	}
	if events[0].Sequence != 1 || events[3].Sequence != 4 {
		t.Fatalf("unexpected event sequence: %#v", events)
	}
	if !reflect.DeepEqual(events[2].NodePath, []string{"answer", "invoke"}) || !events[2].Streaming {
		t.Fatalf("nested streaming event was not correlated: %#v", events[2])
	}
	if events[3].Phase != CallbackPhaseError || events[3].Error.Message != "model unavailable" {
		t.Fatalf("error event was not recorded: %#v", events[3])
	}
	events[0].Address[0].ID = "mutated"
	if recorder.Events()[0].Address[0].ID != "support-assistant" {
		t.Fatal("Events returned caller-mutable recorder state")
	}

	envelopes, diagnostics, err := recorder.Envelopes(EnvelopeOptions{
		Source: map[string]string{"einoVersion": "0.9.19"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 0 || len(envelopes) != 4 {
		t.Fatalf("unexpected envelope result: %#v %#v", envelopes, diagnostics)
	}
	if envelopes[2].Correlation["runId"] != "run-1" ||
		envelopes[2].Correlation["eventId"] != "run-1:3" ||
		envelopes[2].Correlation["entityId"] != "runnable:support-assistant/node:answer/node:invoke" ||
		envelopes[2].Correlation["parentEntityId"] != "runnable:support-assistant/node:answer" {
		t.Fatalf("event correlation is incomplete: %#v", envelopes[2].Correlation)
	}

	actual, err := json.MarshalIndent(envelopes, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err := os.ReadFile("../../fixtures/eino-callback-events-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("callback events do not match shared fixture\nactual:\n%s", actual)
	}
}

func TestCallbackEventRecorderRequiresRunIDForEnvelopes(t *testing.T) {
	recorder := NewCallbackEventRecorder("")
	if _, _, err := recorder.Envelopes(EnvelopeOptions{}); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("expected ErrInvalidEnvelope, got %v", err)
	}
}
