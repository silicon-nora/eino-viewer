package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/cloudwego/eino/compose"
)

func TestWorkflowRecorderCapturesCompiledTopologyAndExecution(t *testing.T) {
	type prepared struct{ Text string }
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode(
		"prepare",
		compose.InvokableLambda(func(_ context.Context, input string) (prepared, error) {
			return prepared{Text: input}, nil
		}),
		compose.WithNodeName("Prepare"),
	).AddInput(compose.START)
	workflow.AddLambdaNode(
		"answer",
		compose.InvokableLambda(func(_ context.Context, input prepared) (string, error) {
			return input.Text + "!", nil
		}),
		compose.WithNodeName("Answer"),
	).AddInput("prepare")
	workflow.End().AddInput("answer")

	recorder := NewWorkflowRecorder("run-workflow-recorder", WorkflowRecorderOptions{
		DisableRootIO: true, // This test retains the legacy node-only evidence assertions.
		Project: ProjectOptions{ResolveNodeKind: func(path []string, _ compose.GraphNodeInfo) (NodeKind, bool) {
			switch path[len(path)-1] {
			case "prepare":
				return NodeKindCPU, true
			case "answer":
				return NodeKindLLM, true
			default:
				return "", false
			}
		}},
		Metadata: JSONMap{"source": "workflow-recorder-test", "nested": map[string]any{"owner": "caller"}},
	})
	if _, err := recorder.Snapshot(); !errors.Is(err, ErrWorkflowNotCompiled) {
		t.Fatalf("Snapshot before compile error = %v, want ErrWorkflowNotCompiled", err)
	}

	runnable, err := workflow.Compile(
		context.Background(),
		compose.WithGraphName("recorded-workflow"),
		recorder.CompileOption(),
	)
	if err != nil {
		t.Fatal(err)
	}
	output, err := runnable.Invoke(context.Background(), "hello", recorder.InvokeOption())
	if err != nil {
		t.Fatal(err)
	}
	if output != "hello!" {
		t.Fatalf("output = %q, want hello!", output)
	}
	recorder.options.Metadata["nested"].(map[string]any)["owner"] = "mutated"

	snapshot, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Workflow.Name != "recorded-workflow" || snapshot.Metadata["source"] != "workflow-recorder-test" {
		t.Fatalf("unexpected snapshot header: %#v", snapshot)
	}
	if snapshot.Metadata["nested"].(map[string]any)["owner"] != "caller" {
		t.Fatal("WorkflowRecorder retained caller-owned nested metadata")
	}
	if got := []NodeKind{snapshot.Workflow.Nodes[0].Kind, snapshot.Workflow.Nodes[1].Kind}; !reflect.DeepEqual(got, []NodeKind{NodeKindLLM, NodeKindCPU}) {
		t.Fatalf("projected kinds = %v", got)
	}
	if snapshot.Execution == nil || snapshot.Execution.ID != "run-workflow-recorder" {
		t.Fatalf("execution missing: %#v", snapshot.Execution)
	}
	if len(snapshot.Execution.Nodes) != 2 {
		t.Fatalf("execution nodes = %#v", snapshot.Execution.Nodes)
	}
	for _, node := range snapshot.Execution.Nodes {
		if node.Status != NodeStatusSuccess || node.StartedAtMS == nil || node.FinishedAtMS == nil || node.DurationMS == nil {
			t.Fatalf("incomplete execution node: %#v", node)
		}
	}

	// Snapshot callers cannot mutate the recorder's captured topology.
	snapshot.Workflow.Nodes[0].Name = "mutated"
	again, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if again.Workflow.Nodes[0].Name == "mutated" {
		t.Fatal("Snapshot did not return a defensive copy")
	}

	encoded, err := recorder.MarshalSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	var decoded Snapshot
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Execution == nil || len(decoded.Execution.Nodes) != 2 {
		t.Fatalf("marshaled execution missing: %#v", decoded.Execution)
	}

	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 4 {
		t.Fatalf("component projection diagnostics = %#v, want four custom-component warnings", diagnostics)
	}
	if len(envelopes) != 7 || envelopes[0].Kind != "workflow.snapshot" {
		t.Fatalf("workflow evidence = %#v, want one anchor, two lifecycle and four component records", envelopes)
	}
	assertLifecycle(t, envelopes, "success", "complete")
	for index, envelope := range withoutLifecycleEvidence(envelopes)[1:] {
		if envelope.Kind != ComponentIOKind || envelope.Correlation["runId"] != "run-workflow-recorder" {
			t.Fatalf("component envelope %d = %#v", index+1, envelope)
		}
		var payload ComponentIOPayload
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.NodePath) != 1 || payload.Body == nil {
			t.Fatalf("component payload %d did not retain node path and body: %#v", index+1, payload)
		}
	}
	marshaledEnvelopes, _, err := recorder.MarshalEnvelopes()
	if err != nil {
		t.Fatal(err)
	}
	var decodedEnvelopes []Envelope
	if err := json.Unmarshal(marshaledEnvelopes, &decodedEnvelopes); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decodedEnvelopes, envelopes) {
		t.Fatal("MarshalEnvelopes did not preserve the captured evidence collection")
	}
	runRecord, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if runRecord.Source != RunSourceWorkflow || runRecord.RunID != "run-workflow-recorder" || len(runRecord.Evidence) != len(envelopes) {
		t.Fatalf("Workflow RunRecord = %#v", runRecord)
	}
}

func TestWorkflowRecorderPreservesFailuresAndExplicitSkippedNodes(t *testing.T) {
	wanted := errors.New("planned failure")
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode(
		"fail",
		compose.InvokableLambda(func(_ context.Context, _ string) (string, error) {
			return "", wanted
		}),
	).AddInput(compose.START)
	workflow.End().AddInput("fail")

	recorder := NewWorkflowRecorder("run-workflow-failure", WorkflowRecorderOptions{DisableRootIO: true})
	runnable, err := workflow.Compile(context.Background(), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runnable.Invoke(context.Background(), "input", recorder.InvokeOption()); !errors.Is(err, wanted) {
		t.Fatalf("Invoke error = %v, want planned failure", err)
	}
	recorder.MarkSkipped([]string{"not-selected"})
	snapshot, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Execution.Nodes) != 2 {
		t.Fatalf("execution nodes = %#v", snapshot.Execution.Nodes)
	}
	statuses := map[string]NodeExecution{}
	for _, node := range snapshot.Execution.Nodes {
		statuses[node.Path[len(node.Path)-1]] = node
	}
	if statuses["fail"].Status != NodeStatusFailed || statuses["fail"].ErrorMessage != wanted.Error() {
		t.Fatalf("failed node = %#v", statuses["fail"])
	}
	if statuses["not-selected"].Status != NodeStatusSkipped || statuses["not-selected"].DurationMS != nil {
		t.Fatalf("skipped node = %#v", statuses["not-selected"])
	}
	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 1 || len(envelopes) != 4 {
		t.Fatalf("failed Workflow evidence = %d envelopes, %#v diagnostics", len(envelopes), diagnostics)
	}
	var input ComponentIOPayload
	assertLifecycle(t, envelopes, "failed", "complete")
	if err := json.Unmarshal(withoutLifecycleEvidence(envelopes)[1].Payload, &input); err != nil {
		t.Fatal(err)
	}
	if input.Direction != ComponentIOInput || input.Body != "input" {
		t.Fatalf("failed Workflow should retain only its observed input, got %#v", input)
	}
}

func TestWorkflowRecorderReturnsProjectionErrors(t *testing.T) {
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode(
		"leaf",
		compose.InvokableLambda(func(_ context.Context, input string) (string, error) { return input, nil }),
	).AddInput(compose.START)
	workflow.End().AddInput("leaf")

	recorder := NewWorkflowRecorder("run-invalid-projection", WorkflowRecorderOptions{
		Project: ProjectOptions{ResolveNodeKind: func([]string, compose.GraphNodeInfo) (NodeKind, bool) {
			return NodeKindGraph, true
		}},
	})
	if _, err := workflow.Compile(context.Background(), recorder.CompileOption()); err != nil {
		t.Fatal(err)
	}
	if _, err := recorder.Snapshot(); !errors.Is(err, ErrInvalidNodeKind) {
		t.Fatalf("Snapshot error = %v, want ErrInvalidNodeKind", err)
	}
}
