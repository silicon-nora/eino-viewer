package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

func withoutLifecycleEvidence(envelopes []Envelope) []Envelope {
	result := make([]Envelope, 0, len(envelopes))
	for _, envelope := range envelopes {
		if envelope.Kind != RunLifecycleKind {
			result = append(result, envelope)
		}
	}
	return result
}

func lifecyclePayloads(t *testing.T, envelopes []Envelope) []RunLifecyclePayload {
	t.Helper()
	var result []RunLifecyclePayload
	for _, envelope := range envelopes {
		if envelope.Kind != RunLifecycleKind {
			continue
		}
		var payload RunLifecyclePayload
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		result = append(result, payload)
	}
	return result
}

func assertLifecycle(t *testing.T, envelopes []Envelope, outcome, capture string) {
	t.Helper()
	want := []RunLifecyclePayload{{State: "started"}, {State: "ended", Outcome: outcome, Capture: capture}}
	if got := lifecyclePayloads(t, envelopes); !reflect.DeepEqual(got, want) {
		t.Fatalf("lifecycle = %#v, want %#v", got, want)
	}
}

func assertCompletedRunFixture(t *testing.T, record RunRecord, name string) {
	t.Helper()
	path := "../../fixtures/" + name
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("WRITE_COMPLETED_RUN_FIXTURES") != "" {
		if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !equivalentRunRecordFixture(t, record, expected) {
		t.Fatalf("completed RunRecord does not match %s\nactual:\n%s", name, encoded)
	}
}

func TestLifecycleRequiresValidBoundaryAndRunID(t *testing.T) {
	options := EnvelopeOptions{Correlation: map[string]string{"runId": "run-lifecycle"}}
	for _, payload := range []RunLifecyclePayload{
		{State: "started", Outcome: "success"},
		{State: "ended", Outcome: "success"},
		{State: "ended", Outcome: "other", Capture: "complete"},
		{State: "other"},
	} {
		if _, _, err := ProjectRunLifecycleEnvelope(payload, options); !errors.Is(err, ErrInvalidEnvelope) {
			t.Fatalf("invalid payload %#v: %v", payload, err)
		}
	}
	if _, _, err := ProjectRunLifecycleEnvelope(RunLifecyclePayload{State: "started"}, EnvelopeOptions{}); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("missing run id: %v", err)
	}
	options.Policy.Redact = func(path []string, value any) (any, bool) {
		return "redacted", len(path) == 2 && path[0] == "payload" && path[1] == "state"
	}
	if _, _, err := ProjectRunLifecycleEnvelope(RunLifecyclePayload{State: "started"}, options); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("malformed redacted lifecycle accepted: %v", err)
	}
}

func TestAgentLifecycleWaitsForExhaustionAndIgnoresLocalComponentError(t *testing.T) {
	recorder := NewAgentRecorder("run-boundary", AgentRecorderOptions{})
	source, generator := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
	iterator := recorder.Wrap(source)
	final := &adk.AgentEvent{Output: &adk.AgentOutput{MessageOutput: &adk.MessageVariant{Message: schema.AssistantMessage("answer", nil)}}}
	generator.Send(final)
	generator.Close()
	if event, ok := iterator.Next(); !ok || event != final {
		t.Fatal("iterator did not preserve event ownership")
	}
	envelopes, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if got := lifecyclePayloads(t, envelopes); !reflect.DeepEqual(got, []RunLifecyclePayload{{State: "started"}}) {
		t.Fatalf("assistant message falsely completed abandoned iterator: %#v", got)
	}
	recorder.Handler().OnError(context.Background(), &callbacks.RunInfo{Component: components.ComponentOfTool}, errors.New("recoverable local error"))
	for index := 0; index < 3; index++ {
		if _, ok := iterator.Next(); ok {
			t.Fatal("closed iterator yielded an event")
		}
	}
	envelopes, _, err = recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, envelopes, "success", "complete")
}

func TestAgentLifecycleFailureCancellationInterruptionAndRecovery(t *testing.T) {
	for _, test := range []struct {
		name    string
		events  []*adk.AgentEvent
		outcome string
	}{
		{"failure", []*adk.AgentEvent{{Err: errors.New("terminal failure")}}, "failed"},
		{"cancelled", []*adk.AgentEvent{{Err: context.Canceled}}, "cancelled"},
		{"adk cancelled", []*adk.AgentEvent{{Err: &adk.CancelError{Info: &adk.AgentCancelInfo{}}}}, "cancelled"},
		{"adk wrapped cancelled", []*adk.AgentEvent{{Err: fmt.Errorf("wrapped: %w", &adk.CancelError{Info: &adk.AgentCancelInfo{}})}}, "cancelled"},
		{"adk stream cancelled", []*adk.AgentEvent{{Err: adk.ErrStreamCanceled}}, "cancelled"},
		{"interrupted", []*adk.AgentEvent{{Action: &adk.AgentAction{Interrupted: &adk.InterruptInfo{}}}}, "unknown"},
		{"recovered", []*adk.AgentEvent{{Err: errors.New("local event")}, {Action: &adk.AgentAction{Exit: true}}}, "success"},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := NewAgentRecorder("run-"+test.name, AgentRecorderOptions{})
			source, generator := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
			iterator := recorder.Wrap(source)
			for _, event := range test.events {
				generator.Send(event)
			}
			generator.Close()
			for {
				if _, ok := iterator.Next(); !ok {
					break
				}
			}
			envelopes, _, err := recorder.Envelopes()
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, envelopes, test.outcome, "complete")
		})
	}
}

func TestAgentLifecycleCaptureLossDoesNotInventExecutionFailure(t *testing.T) {
	for _, streamed := range []bool{false, true} {
		recorder := NewAgentRecorder("run-capture-loss", AgentRecorderOptions{})
		source, generator := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
		iterator := recorder.Wrap(source)
		if streamed {
			generator.Send(&adk.AgentEvent{Output: &adk.AgentOutput{MessageOutput: &adk.MessageVariant{IsStreaming: true}}})
		} else {
			// A malformed capture is distinct from a runtime failure.
			recorder.RecordEvent(nil)
		}
		generator.Close()
		for {
			if _, ok := iterator.Next(); !ok {
				break
			}
		}
		envelopes, _, err := recorder.Envelopes()
		outcome := "success"
		if streamed {
			if got := lifecyclePayloads(t, envelopes); !reflect.DeepEqual(got, []RunLifecyclePayload{{State: "started"}}) {
				t.Fatalf("unconsumed stream falsely completed: %#v", got)
			}
			continue
		} else if !errors.Is(err, ErrNilAgentEvent) {
			t.Fatalf("capture failure lost: %v", err)
		}
		assertLifecycle(t, envelopes, outcome, "partial")
	}
}

func TestWorkflowRootStreamReturnDoesNotDeclareCompletion(t *testing.T) {
	recorder := NewWorkflowRecorder("run-stream", WorkflowRecorderOptions{})
	ctx := compose.AppendAddressSegment(context.Background(), compose.AddressSegmentRunnable, "root")
	info := &callbacks.RunInfo{Component: compose.ComponentOfWorkflow}
	handler := recorder.Handler()
	handler.OnStart(ctx, info, "input")
	reader, writer := schema.Pipe[callbacks.CallbackOutput](1)
	handler.OnEndWithStreamOutput(ctx, info, reader)
	writer.Close()
	if got := lifecyclePayloads(t, recorder.envelopes); !reflect.DeepEqual(got, []RunLifecyclePayload{{State: "started"}}) {
		t.Fatalf("stream reader return falsely completed invocation: %#v", got)
	}
}

func TestGraphRootBoundaryIgnoresLocalErrorsAndStreamReturns(t *testing.T) {
	root := []CallbackAddressSegment{{Type: "runnable", ID: "root"}}
	observations := []CallbackEvent{
		{Phase: CallbackPhaseStart, Address: root, Run: &CallbackRunInfo{Component: "Graph"}},
		{Phase: CallbackPhaseError, Address: append(append([]CallbackAddressSegment(nil), root...), CallbackAddressSegment{Type: "node", ID: "tool"}), Run: &CallbackRunInfo{Component: "Tool"}, outcome: "failed"},
		{Phase: CallbackPhaseEnd, Address: root, Run: &CallbackRunInfo{Component: "Graph"}},
	}
	evidence := make([]Envelope, len(observations))
	options := EnvelopeOptions{Correlation: map[string]string{"runId": "run-graph-boundary"}}
	result, _, err := graphLifecycleEvidence(observations, evidence, options, "run-graph-boundary", "complete")
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, result, "success", "complete")
	observations[2].Streaming = true
	result, _, err = graphLifecycleEvidence(observations, evidence, options, "run-graph-boundary", "complete")
	if err != nil {
		t.Fatal(err)
	}
	if got := lifecyclePayloads(t, result); !reflect.DeepEqual(got, []RunLifecyclePayload{{State: "started"}}) {
		t.Fatalf("stream reader return falsely completed graph: %#v", got)
	}
}

func TestGraphDefinitionRedactionMarksCapturePartial(t *testing.T) {
	recorder := NewGraphRecorder("run-definition-redacted", GraphRecorderOptions{
		Graph: ComposeGraphEnvelopeOptions{Envelope: EnvelopeOptions{Policy: ProjectionPolicy{Redact: func(path []string, value any) (any, bool) {
			return "redacted", reflect.DeepEqual(path, []string{"payload", "name"})
		}}}},
	})
	graph := compose.NewGraph[string, string]()
	if err := graph.AddLambdaNode("echo", compose.InvokableLambda(func(_ context.Context, value string) (string, error) { return value, nil })); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge(compose.START, "echo"); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge("echo", compose.END); err != nil {
		t.Fatal(err)
	}
	runnable, err := graph.Compile(context.Background(), compose.WithGraphName("private name"), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runnable.Invoke(context.Background(), "input", recorder.InvokeOption()); err != nil {
		t.Fatal(err)
	}
	envelopes, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, envelopes, "success", "partial")
	before, err := json.Marshal(envelopes)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := recorder.Envelopes(); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(envelopes)
	if string(before) != string(after) {
		t.Fatal("later snapshot mutated previously exported evidence")
	}
}

func TestWorkflowSnapshotRedactionMarksCapturePartialMonotonically(t *testing.T) {
	redact := false
	recorder := NewWorkflowRecorder("run-workflow-redacted", WorkflowRecorderOptions{
		Envelope: EnvelopeOptions{Policy: ProjectionPolicy{Redact: func(path []string, value any) (any, bool) {
			return "redacted", redact && reflect.DeepEqual(path, []string{"payload", "workflow", "name"})
		}}},
	})
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode("echo", compose.InvokableLambda(func(_ context.Context, value string) (string, error) { return value, nil })).AddInput(compose.START)
	workflow.End().AddInput("echo")
	runnable, err := workflow.Compile(context.Background(), compose.WithGraphName("private name"), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runnable.Invoke(context.Background(), "input", recorder.InvokeOption()); err != nil {
		t.Fatal(err)
	}
	before, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, before, "success", "complete")
	redact = true
	partial, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, partial, "success", "partial")
	assertLifecycle(t, before, "success", "complete")
	redact = false
	later, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, later, "success", "partial")
}
