package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloudwego/eino/compose"
)

// These fixtures come from actual local Eino compilation and invocation. A
// fixed clock keeps callback timestamps and Workflow duration fields stable;
// none of the scenarios use a model provider, network, or synthetic callbacks.
func staticMatrixNow() time.Time { return time.UnixMilli(1_789_500_000_000) }

func staticMatrixGraphRecorder(runID string) *GraphRecorder {
	recorder := NewGraphRecorder(runID, GraphRecorderOptions{DisableIO: true})
	recorder.now = staticMatrixNow
	recorder.events.now = staticMatrixNow
	return recorder
}

func staticMatrixWorkflowRecorder(runID string) *WorkflowRecorder {
	recorder := NewWorkflowRecorder(runID, WorkflowRecorderOptions{DisableRootIO: true})
	recorder.now = staticMatrixNow
	recorder.execution.now = staticMatrixNow
	return recorder
}

// Golden comparison permits unrelated invocations to interleave. Separately
// enforce source order inside each invocation and around the run boundaries;
// an evidence multiset alone cannot detect a swapped input/output or visit.
func validateStaticGraphWorkflowOrder(record RunRecord) error {
	startIndex, endIndex := -1, -1
	for index, envelope := range record.Evidence {
		if envelope.Kind != RunLifecycleKind {
			continue
		}
		var payload RunLifecyclePayload
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			return err
		}
		switch payload.State {
		case "started":
			if startIndex != -1 || endIndex != -1 {
				return fmt.Errorf("duplicate or late run start at evidence[%d]", index)
			}
			startIndex = index
		case "ended":
			if startIndex == -1 || endIndex != -1 {
				return fmt.Errorf("run end without one preceding start at evidence[%d]", index)
			}
			endIndex = index
		}
	}
	if (startIndex == -1) != (endIndex == -1) {
		return fmt.Errorf("matrix invocation must have both run boundaries or neither")
	}
	type graphVisit struct {
		index    int
		sequence uint64
	}
	graphPending := map[string]graphVisit{}
	graphVisits := map[string]int{}
	graphLastSequence := map[string]uint64{}
	workflowPending := map[string]int{}
	rootStarted, rootFinished := false, false
	for index, envelope := range record.Evidence {
		switch envelope.Kind {
		case CallbackEventKind:
			if rootFinished {
				return fmt.Errorf("callback follows the root terminal callback at evidence[%d]", index)
			}
			var event CallbackEvent
			if err := json.Unmarshal(envelope.Payload, &event); err != nil {
				return err
			}
			root := isRootRunnableAddress(event.Address)
			if root && event.Phase == CallbackPhaseStart {
				// Graph records the observed root start immediately before its
				// derived lifecycle marker; child callbacks follow that marker.
				if rootStarted || startIndex < 0 || index >= startIndex {
					return fmt.Errorf("root callback start must precede run start at evidence[%d]", index)
				}
				rootStarted = true
			} else if startIndex < 0 || index <= startIndex || index >= endIndex {
				return fmt.Errorf("callback outside recorded invocation at evidence[%d]", index)
			}
			address, _ := json.Marshal(event.Address)
			key := string(address)
			if event.Sequence <= graphLastSequence[key] {
				return fmt.Errorf("Graph callbacks for %s are not in invocation sequence", key)
			}
			graphLastSequence[key] = event.Sequence
			visit, pending := graphPending[key]
			switch event.Phase {
			case CallbackPhaseStart:
				if pending {
					return fmt.Errorf("Graph visit %s #%d restarted before its terminal callback", key, graphVisits[key])
				}
				graphVisits[key]++
				graphPending[key] = graphVisit{index: index, sequence: event.Sequence}
			case CallbackPhaseEnd, CallbackPhaseError:
				if !pending || visit.index >= index || visit.sequence >= event.Sequence {
					return fmt.Errorf("Graph visit %s #%d terminal callback precedes its start", key, graphVisits[key])
				}
				delete(graphPending, key)
				if root {
					if len(graphPending) != 0 {
						return fmt.Errorf("root terminal callback precedes active child visits: %#v", graphPending)
					}
					rootFinished = true
				}
			default:
				return fmt.Errorf("unknown callback phase at evidence[%d]", index)
			}
		case ComponentIOKind:
			if startIndex < 0 || index <= startIndex || index >= endIndex {
				return fmt.Errorf("component outside recorded invocation at evidence[%d]", index)
			}
			var payload ComponentIOPayload
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
				return err
			}
			path, _ := json.Marshal(payload.NodePath)
			key := string(path)
			inputIndex, pending := workflowPending[key]
			switch payload.Direction {
			case ComponentIOInput:
				if pending {
					return fmt.Errorf("Workflow path %s repeated input before output", key)
				}
				workflowPending[key] = index
			case ComponentIOOutput:
				if !pending || inputIndex >= index {
					return fmt.Errorf("Workflow path %s output precedes its input", key)
				}
				delete(workflowPending, key)
			default:
				return fmt.Errorf("unknown component direction at evidence[%d]", index)
			}
		}
	}
	if len(graphPending) != 0 {
		return fmt.Errorf("Graph run ended with unpaired visits: %#v", graphPending)
	}
	if record.Source == RunSourceGraph && startIndex >= 0 && (!rootStarted || !rootFinished) {
		return fmt.Errorf("Graph lifecycle markers are not backed by ordered root callbacks")
	}
	// Workflow failures intentionally have an input but no output callback.
	// Per-scenario assertions and the golden still verify every observed record.
	return nil
}

func TestStaticGraphWorkflowMatrixOrderChecksRejectReorderedEvidence(t *testing.T) {
	for _, test := range []struct {
		name  string
		file  string
		left  int
		right int
	}{
		{"graph visit terminal before start", "graph-step-limit.json", 3, 4},
		{"graph repeated visits reordered", "graph-step-limit.json", 3, 5},
		{"workflow output before input", "workflow-nested-names.json", 2, 5},
		{"run end before component", "workflow-failed-successor.json", 4, 5},
		{"run boundaries reversed", "workflow-failed-successor.json", 1, 5},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("../../fixtures/recorder-matrix", test.file))
			if err != nil {
				t.Fatal(err)
			}
			var record RunRecord
			if err := json.Unmarshal(data, &record); err != nil {
				t.Fatal(err)
			}
			if err := validateStaticGraphWorkflowOrder(record); err != nil {
				t.Fatalf("unmodified fixture failed order check: %v", err)
			}
			record.Evidence[test.left], record.Evidence[test.right] = record.Evidence[test.right], record.Evidence[test.left]
			if err := validateStaticGraphWorkflowOrder(record); err == nil {
				t.Fatal("order check accepted reordered evidence with the same multiset")
			}
		})
	}
}

func assertStaticGraphWorkflowFixture(t *testing.T, name string, record RunRecord) {
	t.Helper()
	if !strings.HasPrefix(name, "graph-") && !strings.HasPrefix(name, "workflow-") {
		t.Fatalf("fixture outside Graph/Workflow matrix: %q", name)
	}
	record.Metadata = JSONMap{"fixtureScenario": strings.TrimSuffix(name, ".json"), "executionMode": "deterministic-local"}
	if err := ValidateRunRecord(record); err != nil {
		t.Fatalf("invalid matrix RunRecord: %v", err)
	}
	if err := validateStaticGraphWorkflowOrder(record); err != nil {
		t.Fatalf("invalid actual invocation order: %v", err)
	}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	directory := "../../fixtures/recorder-matrix"
	path := filepath.Join(directory, name)
	if os.Getenv("WRITE_STATIC_GRAPH_WORKFLOW_FIXTURES") == "1" {
		if err := os.MkdirAll(directory, 0o755); err != nil {
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
	if err := validateStaticGraphWorkflowOrder(expectedRecord); err != nil {
		t.Fatalf("invalid golden invocation order: %v", err)
	}
	if !equivalentRunRecordFixture(t, record, expected) {
		t.Fatalf("matrix fixture differs: %s\nactual:\n%s", name, encoded)
	}
}

func TestStaticGraphWorkflowMatrixGraphMaxStepsFailure(t *testing.T) {
	graph := compose.NewGraph[int, int]()
	visits := 0
	if err := graph.AddLambdaNode("retry", compose.InvokableLambda(func(_ context.Context, value int) (int, error) {
		visits++
		return value + 1, nil
	}), compose.WithNodeName("Retry forever")); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge(compose.START, "retry"); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddBranch("retry", compose.NewGraphBranch(func(_ context.Context, _ int) (string, error) {
		return "retry", nil
	}, map[string]bool{"retry": true, compose.END: true})); err != nil {
		t.Fatal(err)
	}
	recorder := staticMatrixGraphRecorder("matrix-graph-max-steps")
	runnable, err := graph.Compile(context.Background(), compose.WithGraphName("Retry loop reaches maximum steps"), compose.WithMaxRunSteps(3), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	_, runErr := runnable.Invoke(context.Background(), 0, recorder.InvokeOption())
	if !errors.Is(runErr, compose.ErrExceedMaxSteps) {
		t.Fatalf("run error = %v, want ErrExceedMaxSteps", runErr)
	}
	if visits != 3 {
		t.Fatalf("retry visits = %d, want 3", visits)
	}
	starts, ends := 0, 0
	for _, event := range recorder.Events() {
		if reflect.DeepEqual(event.NodePath, []string{"retry"}) {
			if event.Phase == CallbackPhaseStart {
				starts++
			}
			if event.Phase == CallbackPhaseEnd {
				ends++
			}
		}
	}
	if starts != visits || ends != visits {
		t.Fatalf("repeated callbacks lost: starts=%d ends=%d visits=%d", starts, ends, visits)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, record.Evidence, "failed", "complete")
	assertStaticGraphWorkflowFixture(t, "graph-step-limit.json", record)
}

func TestStaticGraphWorkflowMatrixGraphContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	graph := compose.NewGraph[string, string]()
	var visits int32
	if err := graph.AddLambdaNode("cancel", compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
		atomic.AddInt32(&visits, 1)
		cancel()
		return "", ctx.Err()
	}), compose.WithNodeName("Cancel current run")); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge(compose.START, "cancel"); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge("cancel", compose.END); err != nil {
		t.Fatal(err)
	}
	recorder := staticMatrixGraphRecorder("matrix-graph-context-cancelled")
	runnable, err := graph.Compile(context.Background(), compose.WithGraphName("Context cancelled during invocation"), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	_, runErr := runnable.Invoke(ctx, "cancel this run", recorder.InvokeOption())
	if !errors.Is(runErr, context.Canceled) {
		t.Fatalf("run error = %v, want context.Canceled", runErr)
	}
	if atomic.LoadInt32(&visits) != 1 {
		t.Fatalf("cancel node visits = %d, want 1", visits)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, record.Evidence, "cancelled", "complete")
	assertStaticGraphWorkflowFixture(t, "graph-cancelled.json", record)
}

func TestStaticGraphWorkflowMatrixWorkflowStopsAfterFailure(t *testing.T) {
	wanted := errors.New("matrix planned validation failure")
	workflow := compose.NewWorkflow[string, string]()
	visits := map[string]int{}
	workflow.AddLambdaNode("prepare", compose.InvokableLambda(func(_ context.Context, input string) (string, error) {
		visits["prepare"]++
		return input + "/prepared", nil
	})).AddInput(compose.START)
	workflow.AddLambdaNode("fail", compose.InvokableLambda(func(_ context.Context, _ string) (string, error) {
		visits["fail"]++
		return "", wanted
	})).AddInput("prepare")
	workflow.AddLambdaNode("after", compose.InvokableLambda(func(_ context.Context, input string) (string, error) {
		visits["after"]++
		return input + "/must-not-run", nil
	})).AddInput("fail")
	workflow.End().AddInput("after")
	recorder := staticMatrixWorkflowRecorder("matrix-workflow-midway-failure")
	runnable, err := workflow.Compile(context.Background(), compose.WithGraphName("Stop after validation failure"), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	_, runErr := runnable.Invoke(context.Background(), "request", recorder.InvokeOption())
	if !errors.Is(runErr, wanted) {
		t.Fatalf("run error = %v, want planned validation failure", runErr)
	}
	if !reflect.DeepEqual(visits, map[string]int{"prepare": 1, "fail": 1}) {
		t.Fatalf("unexpected actual visits: %#v", visits)
	}
	snapshot, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]NodeStatus{}
	for _, node := range snapshot.Execution.Nodes {
		statuses[strings.Join(node.Path, "/")] = node.Status
	}
	if !reflect.DeepEqual(statuses, map[string]NodeStatus{"prepare": NodeStatusSuccess, "fail": NodeStatusFailed}) {
		t.Fatalf("snapshot invented the unobserved successor or lost a failure: %#v", statuses)
	}
	if len(snapshot.Workflow.Nodes) != 3 {
		t.Fatalf("declared successor must remain in topology: %#v", snapshot.Workflow.Nodes)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, record.Evidence, "failed", "complete")
	assertStaticGraphWorkflowFixture(t, "workflow-failed-successor.json", record)
}

func TestStaticGraphWorkflowMatrixWorkflowNestedSameName(t *testing.T) {
	visits := map[string]int{}
	child := func(scope string) *compose.Workflow[string, string] {
		workflow := compose.NewWorkflow[string, string]()
		workflow.AddLambdaNode("shared", compose.InvokableLambda(func(_ context.Context, input string) (string, error) {
			visits[scope]++
			return input + "/" + scope, nil
		}), compose.WithNodeName("Shared step")).AddInput(compose.START)
		workflow.End().AddInput("shared")
		return workflow
	}
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddGraphNode("left", child("left")).AddInput(compose.START)
	workflow.AddGraphNode("right", child("right")).AddInput("left")
	workflow.End().AddInput("right")
	recorder := staticMatrixWorkflowRecorder("matrix-workflow-nested-same-name")
	runnable, err := workflow.Compile(context.Background(), compose.WithGraphName("Distinct nested shared steps"), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	output, err := runnable.Invoke(context.Background(), "request", recorder.InvokeOption())
	if err != nil || output != "request/left/right" {
		t.Fatalf("nested output=%q error=%v", output, err)
	}
	if !reflect.DeepEqual(visits, map[string]int{"left": 1, "right": 1}) {
		t.Fatalf("unexpected nested visits: %#v", visits)
	}
	snapshot, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]NodeStatus{}
	for _, node := range snapshot.Execution.Nodes {
		paths[strings.Join(node.Path, "/")] = node.Status
	}
	wantPaths := map[string]NodeStatus{"left": NodeStatusSuccess, "left/shared": NodeStatusSuccess, "right": NodeStatusSuccess, "right/shared": NodeStatusSuccess}
	if !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("nested invocation scopes collapsed: %#v", paths)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	assertLifecycle(t, record.Evidence, "success", "complete")
	assertStaticGraphWorkflowFixture(t, "workflow-nested-names.json", record)
}

func TestStaticGraphWorkflowMatrixWorkflowDefinitionOnly(t *testing.T) {
	workflow := compose.NewWorkflow[string, string]()
	visits := 0
	workflow.AddLambdaNode("never-invoked", compose.InvokableLambda(func(_ context.Context, input string) (string, error) {
		visits++
		return input, nil
	})).AddInput(compose.START)
	workflow.End().AddInput("never-invoked")
	recorder := staticMatrixWorkflowRecorder("matrix-workflow-definition-only")
	if _, err := workflow.Compile(context.Background(), compose.WithGraphName("Compiled but not invoked"), recorder.CompileOption()); err != nil {
		t.Fatal(err)
	}
	if visits != 0 {
		t.Fatal("compilation executed a node")
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Evidence) != 1 || record.Evidence[0].Kind != "workflow.snapshot" || len(lifecyclePayloads(t, record.Evidence)) != 0 {
		t.Fatalf("definition-only record invented execution boundaries: %#v", record.Evidence)
	}
	snapshot, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Execution.Nodes) != 0 || snapshot.Execution.StartedAtMS != nil || snapshot.Execution.FinishedAtMS != nil {
		t.Fatalf("definition-only snapshot invented observed execution: %#v", snapshot.Execution)
	}
	assertStaticGraphWorkflowFixture(t, "workflow-definition-only.json", record)
}
