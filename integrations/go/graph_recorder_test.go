package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/cloudwego/eino/compose"
)

func TestGraphRecorderPreservesCycleAndExecutionEvents(t *testing.T) {
	graph := compose.NewGraph[int, int]()
	if err := graph.AddLambdaNode(
		"model",
		compose.InvokableLambda(func(_ context.Context, input int) (int, error) { return input + 1, nil }),
		compose.WithNodeName("Model"),
	); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge(compose.START, "model"); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddBranch("model", compose.NewGraphBranch(
		func(_ context.Context, value int) (string, error) {
			if value < 2 {
				return "model", nil
			}
			return compose.END, nil
		},
		map[string]bool{"model": true, compose.END: true},
	)); err != nil {
		t.Fatal(err)
	}

	// Preserve the historical metadata-only fixture; safe I/O has its own matrix.
	recorder := NewGraphRecorder("run-cyclic-graph", GraphRecorderOptions{DisableIO: true})
	clock := time.UnixMilli(1_789_200_000_000)
	recorder.now = func() time.Time {
		clock = clock.Add(time.Millisecond)
		return clock
	}
	recorder.events.now = recorder.now
	runnable, err := graph.Compile(
		context.Background(),
		compose.WithGraphName("cyclic-agent-graph"),
		recorder.CompileOption(),
	)
	if err != nil {
		t.Fatal(err)
	}
	output, err := runnable.Invoke(context.Background(), 0, recorder.InvokeOption())
	if err != nil {
		t.Fatal(err)
	}
	if output != 2 {
		t.Fatalf("output = %d, want 2", output)
	}
	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %#v", diagnostics)
	}
	if len(envelopes) < 2 || envelopes[0].Kind != ComposeGraphKind {
		t.Fatalf("Graph definition missing: %#v", envelopes)
	}
	var definition Graph
	if err := json.Unmarshal(envelopes[0].Payload, &definition); err != nil {
		t.Fatal(err)
	}
	if len(definition.Branches) != 1 || len(definition.Branches[0].Targets) != 2 {
		t.Fatalf("cyclic branch was not preserved: %#v", definition.Branches)
	}
	for _, envelope := range envelopes {
		if envelope.Correlation["runId"] != "run-cyclic-graph" {
			t.Fatalf("run correlation missing: %#v", envelope.Correlation)
		}
	}
	if len(recorder.Events()) == 0 {
		t.Fatal("Graph execution callbacks were not captured")
	}
	assertLifecycle(t, envelopes, "success", "complete")
	runRecord, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if runRecord.Source != RunSourceGraph || runRecord.RunID != "run-cyclic-graph" || len(runRecord.Evidence) != len(envelopes) {
		t.Fatalf("Graph RunRecord = %#v", runRecord)
	}
	assertCompletedRunFixture(t, runRecord, "eino-graph-recorder-cyclic-completed-v1.json")
	legacyRecord := runRecord
	legacyRecord.Evidence = withoutLifecycleEvidence(runRecord.Evidence)
	fixture, err := json.MarshalIndent(legacyRecord, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	const fixturePath = "../../fixtures/eino-graph-recorder-cyclic-v1.json"
	if os.Getenv("WRITE_GRAPH_RUN_RECORD_FIXTURE") != "" {
		if err := os.WriteFile(fixturePath, fixture, 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		expected, err := os.ReadFile(fixturePath)
		if err != nil {
			t.Fatalf("%v\nactual:\n%s", err, fixture)
		}
		if string(fixture) != string(expected) {
			t.Fatalf("GraphRecorder RunRecord does not match the shared fixture\nactual:\n%s", fixture)
		}
	}

	envelopes[0].Correlation["runId"] = "mutated"
	again, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if again[0].Correlation["runId"] != "run-cyclic-graph" {
		t.Fatal("GraphRecorder definition was mutated by caller")
	}
}

func TestGraphRecorderRequiresCompileAndRunID(t *testing.T) {
	recorder := NewGraphRecorder("", GraphRecorderOptions{})
	if _, _, err := recorder.Envelopes(); !errors.Is(err, ErrGraphNotCompiled) {
		t.Fatalf("Envelopes error = %v, want ErrGraphNotCompiled", err)
	}
	recorder.OnFinish(context.Background(), &compose.GraphInfo{
		Nodes: map[string]compose.GraphNodeInfo{},
		Edges: map[string][]string{},
	})
	if _, _, err := recorder.Envelopes(); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("empty run ID error = %v, want ErrInvalidEnvelope", err)
	}
}
