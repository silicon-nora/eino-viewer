package einoworkflowsnapshot

import (
	"context"
	"errors"
	"testing"

	"github.com/cloudwego/eino/compose"
)

func TestExecutionRecorderEndOnlyDoesNotInventStarts(t *testing.T) {
	for _, runErr := range []error{nil, errors.New("source terminal failure")} {
		recorder := NewWorkflowRecorder("end-only", WorkflowRecorderOptions{})
		recorder.execution.now = graphIOClock
		recorder.OnFinish(context.Background(), &compose.GraphInfo{Nodes: map[string]compose.GraphNodeInfo{}, Edges: map[string][]string{}})
		recorder.execution.recordEnd([]string{"observed-end"}, runErr)
		recorder.execution.recordEnd(nil, runErr)
		snapshot, err := recorder.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		execution := snapshot.Execution
		if execution.StartedAtMS != nil || execution.DurationMS != nil || execution.FinishedAtMS == nil {
			t.Fatalf("end-only run fabricated a start or duration: %#v", execution)
		}
		if len(execution.Nodes) != 1 {
			t.Fatal("observed terminal node lost")
		}
		node := execution.Nodes[0]
		if node.StartedAtMS != nil || node.DurationMS != nil || node.FinishedAtMS == nil {
			t.Fatalf("end-only node fabricated a start or duration: %#v", node)
		}
		want := NodeStatusSuccess
		if runErr != nil {
			want = NodeStatusFailed
		}
		if node.Status != want {
			t.Fatal("missing start changed observed terminal outcome")
		}
	}
}

func TestExecutionRecorderChildOnlyDoesNotInventRootTiming(t *testing.T) {
	recorder := NewExecutionRecorder("child-only")
	recorder.now = graphIOClock
	recorder.recordStart([]string{"child"})
	recorder.recordEnd([]string{"child"}, nil)
	execution := recorder.Execution()
	if execution.StartedAtMS != nil || execution.FinishedAtMS != nil || execution.DurationMS != nil {
		t.Fatalf("child callbacks fabricated root timing: %#v", execution)
	}
	if len(execution.Nodes) != 1 || execution.Nodes[0].StartedAtMS == nil || execution.Nodes[0].FinishedAtMS == nil || execution.Nodes[0].DurationMS == nil {
		t.Fatal("observed child timing was lost")
	}
	recorder.recordEnd(nil, nil)
	execution = recorder.Execution()
	if execution.StartedAtMS != nil || execution.DurationMS != nil || execution.FinishedAtMS == nil {
		t.Fatalf("root end inferred root start from child: %#v", execution)
	}
}
