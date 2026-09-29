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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
)

// The observer forwards genuine Eino callbacks to the default Recorder first.
// Releasing slow only AFTER the fast OnEnd has been recorded avoids relying on
// scheduler luck between a business-function return and its terminal callback.
type parallelWorkflowObserver struct {
	callbacks.Handler
	fastRecorded chan struct{}
	mu           sync.Mutex
	observed     []string
}

func (observer *parallelWorkflowObserver) note(ctx context.Context, phase string) {
	path := nodePath(ctx)
	name := "root"
	if len(path) > 0 {
		name = strings.Join(path, "/")
	}
	observer.mu.Lock()
	observer.observed = append(observer.observed, name+":"+phase)
	observer.mu.Unlock()
}

func (observer *parallelWorkflowObserver) OnStart(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
	ctx = observer.Handler.OnStart(ctx, info, input)
	observer.note(ctx, "start")
	return ctx
}

func (observer *parallelWorkflowObserver) OnEnd(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
	ctx = observer.Handler.OnEnd(ctx, info, output)
	observer.note(ctx, "end")
	if reflect.DeepEqual(nodePath(ctx), []string{"fast"}) {
		close(observer.fastRecorded)
	}
	return ctx
}

func (observer *parallelWorkflowObserver) OnError(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
	ctx = observer.Handler.OnError(ctx, info, err)
	observer.note(ctx, "error")
	return ctx
}

func parallelWorkflowBodies() map[string]map[string]any {
	input := map[string]any{"requestId": "order-42", "quantity": 3}
	prepared := map[string]any{"requestId": "order-42", "quantity": 3, "unitPrice": 7}
	slow := map[string]any{"requestId": "order-42", "amount": 21, "source": "inventory"}
	fast := map[string]any{"requestId": "order-42", "amount": 8, "source": "shipping"}
	joined := map[string]any{"requestId": "order-42", "subtotal": 21, "shipping": 8, "total": 29}
	final := map[string]any{"requestId": "order-42", "subtotal": 21, "shipping": 8, "total": 29, "status": "completed"}
	return map[string]map[string]any{
		"root:input": input, "root:output": final,
		"prepare:input": input, "prepare:output": prepared,
		"slow:input": prepared, "slow:output": slow,
		"fast:input": prepared, "fast:output": fast,
		"join:input": {"slow": slow, "fast": fast}, "join:output": joined,
		"finish:input": joined, "finish:output": final,
	}
}

func parallelWorkflowWait(ctx context.Context, signal <-chan struct{}) error {
	select {
	case <-signal:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Validate causal boundaries independently of the golden's evidence multiset.
// The two sibling input callbacks may arrive in either order, but completion
// order and both predecessor-output -> join-input dependencies are mandatory.
func validateParallelWorkflowEvidence(record RunRecord, failed bool) error {
	if err := validateStaticGraphWorkflowOrder(record); err != nil {
		return err
	}
	bodies := parallelWorkflowBodies()
	if failed {
		for _, key := range []string{"slow:output", "join:input", "join:output", "finish:input", "finish:output", "root:output"} {
			delete(bodies, key)
		}
	}
	positions := map[string]int{}
	anchors := 0
	for index, envelope := range record.Evidence {
		switch envelope.Kind {
		case ComponentIOKind:
			var io ComponentIOPayload
			if err := json.Unmarshal(envelope.Payload, &io); err != nil {
				return err
			}
			name := "root"
			if len(io.NodePath) > 0 {
				name = strings.Join(io.NodePath, "/")
			}
			key := name + ":" + string(io.Direction)
			want, exists := bodies[key]
			if !exists {
				return fmt.Errorf("unexpected component evidence %s", key)
			}
			if _, duplicate := positions[key]; duplicate {
				return fmt.Errorf("duplicate component evidence %s", key)
			}
			actualJSON, _ := json.Marshal(io.Body)
			wantJSON, _ := json.Marshal(want)
			if string(actualJSON) != string(wantJSON) || io.Streaming {
				return fmt.Errorf("%s = %s (streaming=%v), want %s", key, actualJSON, io.Streaming, wantJSON)
			}
			positions[key] = index
		case "workflow.snapshot":
			anchors++
			var snapshot Snapshot
			if err := json.Unmarshal(envelope.Payload, &snapshot); err != nil {
				return err
			}
			wantEdges := []Edge{
				{From: "fast", To: "join", Channels: []string{"control", "data"}, Mappings: []FieldMapping{{FromPath: []string{}, ToPath: []string{"fast"}}}},
				{From: "finish", To: "end", Channels: []string{"control", "data"}},
				{From: "join", To: "finish", Channels: []string{"control", "data"}},
				{From: "prepare", To: "fast", Channels: []string{"control", "data"}},
				{From: "prepare", To: "slow", Channels: []string{"control", "data"}},
				{From: "slow", To: "join", Channels: []string{"control", "data"}, Mappings: []FieldMapping{{FromPath: []string{}, ToPath: []string{"slow"}}}},
				{From: "start", To: "prepare", Channels: []string{"control", "data"}},
			}
			if !reflect.DeepEqual(snapshot.Workflow.Edges, wantEdges) {
				return fmt.Errorf("parallel topology or join field mappings differ: %#v", snapshot.Workflow.Edges)
			}
			if snapshot.Execution == nil {
				return errors.New("missing Workflow execution")
			}
			wantStatuses := map[string]NodeStatus{"prepare": NodeStatusSuccess, "fast": NodeStatusSuccess, "slow": NodeStatusSuccess, "join": NodeStatusSuccess, "finish": NodeStatusSuccess}
			if failed {
				wantStatuses["slow"] = NodeStatusFailed
				delete(wantStatuses, "join")
				delete(wantStatuses, "finish")
			}
			if len(snapshot.Execution.Nodes) != len(wantStatuses) {
				return fmt.Errorf("unexpected recorded execution nodes: %#v", snapshot.Execution.Nodes)
			}
			seen := map[string]bool{}
			for _, node := range snapshot.Execution.Nodes {
				name := strings.Join(node.Path, "/")
				wantStatus, exists := wantStatuses[name]
				if !exists || seen[name] || node.Status != wantStatus || node.StartedAtMS == nil || node.FinishedAtMS == nil || node.DurationMS == nil {
					return fmt.Errorf("unexpected recorded node outcome: %#v", node)
				}
				seen[name] = true
				wantError := ""
				if failed && name == "slow" {
					wantError = "inventory lookup failed"
				}
				if node.ErrorMessage != wantError {
					return fmt.Errorf("%s error = %q, want %q", name, node.ErrorMessage, wantError)
				}
			}
		}
	}
	if anchors != 1 || len(positions) != len(bodies) {
		return fmt.Errorf("incomplete evidence: anchors=%d, components=%d, want %d", anchors, len(positions), len(bodies))
	}
	dependencies := [][2]string{
		{"root:input", "prepare:input"},
		{"prepare:output", "slow:input"}, {"prepare:output", "fast:input"},
		{"slow:input", "fast:output"},
	}
	if !failed {
		dependencies = append(dependencies,
			[2]string{"fast:output", "slow:output"},
			[2]string{"fast:output", "join:input"}, [2]string{"slow:output", "join:input"},
			[2]string{"join:output", "finish:input"}, [2]string{"finish:output", "root:output"})
	}
	for _, dependency := range dependencies {
		if positions[dependency[0]] >= positions[dependency[1]] {
			return fmt.Errorf("causal boundary violated: %s must precede %s", dependency[0], dependency[1])
		}
	}
	return nil
}

func assertParallelWorkflowObservedOrder(t *testing.T, observer *parallelWorkflowObserver, failed bool) {
	t.Helper()
	observer.mu.Lock()
	observed := append([]string(nil), observer.observed...)
	observer.mu.Unlock()
	positions := map[string]int{}
	for index, event := range observed {
		if _, duplicate := positions[event]; duplicate {
			t.Fatalf("duplicate observed callback %s: %v", event, observed)
		}
		positions[event] = index
	}
	before := func(left, right string) {
		t.Helper()
		l, hasLeft := positions[left]
		r, hasRight := positions[right]
		if !hasLeft || !hasRight || l >= r {
			t.Fatalf("callback boundary %s -> %s violated: %v", left, right, observed)
		}
	}
	before("prepare:end", "slow:start")
	before("prepare:end", "fast:start")
	before("slow:start", "fast:end")
	if failed {
		before("fast:end", "slow:error")
		before("slow:error", "root:error")
		if len(observed) != 8 {
			t.Fatalf("failed run unexpectedly observed successors or missing callbacks: %v", observed)
		}
	} else {
		before("fast:end", "slow:end")
		before("fast:end", "join:start")
		before("slow:end", "join:start")
		before("join:end", "finish:start")
		before("finish:end", "root:end")
		if len(observed) != 12 {
			t.Fatalf("successful run callbacks differ: %v", observed)
		}
	}
}

func assertParallelWorkflowFixture(t *testing.T, name string, record RunRecord, failed bool) {
	t.Helper()
	if name != "workflow-parallel-join-success.json" && name != "workflow-parallel-join-failed.json" {
		t.Fatalf("fixture outside parallel Workflow matrix: %q", name)
	}
	record.Metadata = JSONMap{"fixtureScenario": strings.TrimSuffix(name, ".json"), "executionMode": "deterministic-local"}
	if err := ValidateRunRecord(record); err != nil {
		t.Fatal(err)
	}
	if err := validateParallelWorkflowEvidence(record, failed); err != nil {
		t.Fatalf("actual invocation evidence: %v", err)
	}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("../../fixtures/recorder-matrix", name)
	if os.Getenv("WRITE_PARALLEL_WORKFLOW_FIXTURES") == "1" {
		if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var golden RunRecord
	if err := json.Unmarshal(expected, &golden); err != nil {
		t.Fatal(err)
	}
	if err := validateParallelWorkflowEvidence(golden, failed); err != nil {
		t.Fatalf("golden invocation evidence: %v", err)
	}
	// The relative arrival of the two sibling starts is intentionally ignored;
	// field values, counts, topology, statuses and causal boundaries are not.
	if string(normalizedRunRecordFixture(t, record)) != string(normalizedRunRecordFixture(t, golden)) {
		t.Fatalf("parallel Workflow fixture differs: %s\nactual:\n%s", name, encoded)
	}
}

func TestParallelWorkflowRecorderMatrix(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "workflow-parallel-join-success"
		if failed {
			name = "workflow-parallel-join-failed"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			bodies := parallelWorkflowBodies()
			wantedFailure := errors.New("inventory lookup failed")
			slowEntered := make(chan struct{})
			fastRecorded := make(chan struct{})
			var calls [5]int32
			workflow := compose.NewWorkflow[map[string]any, map[string]any]()
			checkInput := func(node string, actual map[string]any) error {
				if !reflect.DeepEqual(actual, bodies[node+":input"]) {
					return fmt.Errorf("%s received %#v, want %#v", node, actual, bodies[node+":input"])
				}
				return nil
			}
			workflow.AddLambdaNode("prepare", compose.InvokableLambda(func(_ context.Context, input map[string]any) (map[string]any, error) {
				atomic.AddInt32(&calls[0], 1)
				return bodies["prepare:output"], checkInput("prepare", input)
			}), compose.WithNodeName("Prepare order")).AddInput(compose.START)
			workflow.AddLambdaNode("slow", compose.InvokableLambda(func(ctx context.Context, input map[string]any) (map[string]any, error) {
				atomic.AddInt32(&calls[1], 1)
				close(slowEntered)
				if err := checkInput("slow", input); err != nil {
					return nil, err
				}
				if err := parallelWorkflowWait(ctx, fastRecorded); err != nil {
					return nil, err
				}
				if failed {
					return nil, wantedFailure
				}
				return bodies["slow:output"], nil
			}), compose.WithNodeName("Inventory subtotal")).AddInput("prepare")
			workflow.AddLambdaNode("fast", compose.InvokableLambda(func(ctx context.Context, input map[string]any) (map[string]any, error) {
				atomic.AddInt32(&calls[2], 1)
				if err := checkInput("fast", input); err != nil {
					return nil, err
				}
				if err := parallelWorkflowWait(ctx, slowEntered); err != nil {
					return nil, err
				}
				return bodies["fast:output"], nil
			}), compose.WithNodeName("Shipping quote")).AddInput("prepare")
			workflow.AddLambdaNode("join", compose.InvokableLambda(func(_ context.Context, input map[string]any) (map[string]any, error) {
				atomic.AddInt32(&calls[3], 1)
				if err := checkInput("join", input); err != nil {
					return nil, err
				}
				slow := input["slow"].(map[string]any)
				fast := input["fast"].(map[string]any)
				return map[string]any{"requestId": slow["requestId"], "subtotal": slow["amount"], "shipping": fast["amount"], "total": slow["amount"].(int) + fast["amount"].(int)}, nil
			}), compose.WithNodeName("Merge charges")).AddInput("slow", compose.ToField("slow")).AddInput("fast", compose.ToField("fast"))
			workflow.AddLambdaNode("finish", compose.InvokableLambda(func(_ context.Context, input map[string]any) (map[string]any, error) {
				atomic.AddInt32(&calls[4], 1)
				if err := checkInput("finish", input); err != nil {
					return nil, err
				}
				output := make(map[string]any, len(input)+1)
				for key, value := range input {
					output[key] = value
				}
				output["status"] = "completed"
				return output, nil
			}), compose.WithNodeName("Complete order")).AddInput("join")
			workflow.End().AddInput("finish")
			recorder := NewWorkflowRecorder("run-"+name, WorkflowRecorderOptions{})
			recorder.now = staticMatrixNow
			recorder.execution.now = staticMatrixNow
			observer := &parallelWorkflowObserver{Handler: recorder.Handler(), fastRecorded: fastRecorded}
			runnable, err := workflow.Compile(ctx, compose.WithGraphName(name), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			output, runErr := runnable.Invoke(ctx, bodies["root:input"], compose.WithCallbacks(observer))
			wantCalls := [5]int32{1, 1, 1, 1, 1}
			if failed {
				wantCalls = [5]int32{1, 1, 1, 0, 0}
				if !errors.Is(runErr, wantedFailure) || output != nil {
					t.Fatalf("failed invocation output=%#v error=%v", output, runErr)
				}
			} else if runErr != nil || !reflect.DeepEqual(output, bodies["root:output"]) {
				t.Fatalf("successful invocation output=%#v error=%v", output, runErr)
			}
			for index, want := range wantCalls {
				if got := atomic.LoadInt32(&calls[index]); got != want {
					t.Fatalf("node %d calls=%d, want %d", index, got, want)
				}
			}
			assertParallelWorkflowObservedOrder(t, observer, failed)
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			outcome := "success"
			if failed {
				outcome = "failed"
			}
			assertLifecycle(t, record.Evidence, outcome, "complete")
			assertParallelWorkflowFixture(t, name+".json", record, failed)
		})
	}
}

func TestParallelWorkflowRecorderMatrixOrderRejectsCounterexamples(t *testing.T) {
	encoded, err := os.ReadFile("../../fixtures/recorder-matrix/workflow-parallel-join-success.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, left, right string }{
		{"join before slow terminal", "slow:output", "join:input"},
		{"join before fast terminal", "fast:output", "join:input"},
		{"reversed observed completion", "fast:output", "slow:output"},
		{"serial branches masquerade as parallel", "slow:input", "fast:output"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var record RunRecord
			if err := json.Unmarshal(encoded, &record); err != nil {
				t.Fatal(err)
			}
			if err := validateParallelWorkflowEvidence(record, false); err != nil {
				t.Fatal(err)
			}
			positions := map[string]int{}
			for index, envelope := range record.Evidence {
				if envelope.Kind != ComponentIOKind {
					continue
				}
				var io ComponentIOPayload
				if err := json.Unmarshal(envelope.Payload, &io); err != nil {
					t.Fatal(err)
				}
				positions[strings.Join(io.NodePath, "/")+":"+string(io.Direction)] = index
			}
			left, right := positions[test.left], positions[test.right]
			record.Evidence[left], record.Evidence[right] = record.Evidence[right], record.Evidence[left]
			if err := validateParallelWorkflowEvidence(record, false); err == nil {
				t.Fatalf("accepted a same-multiset causal counterexample: %s", test.name)
			}
		})
	}
}
