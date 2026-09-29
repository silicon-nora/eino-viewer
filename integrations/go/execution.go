package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// ExecutionRecorder collects Eino callback timings for one workflow run.
// Create a new recorder for every invocation.
type ExecutionRecorder struct {
	mu       sync.Mutex
	id       string
	now      func() time.Time
	started  *time.Time
	finished *time.Time
	nodes    map[string]*recordedNode
}

type recordedNode struct {
	path         []string
	status       NodeStatus
	started      *time.Time
	finished     *time.Time
	errorMessage string
}

// NewExecutionRecorder creates an isolated recorder for one Eino invocation.
func NewExecutionRecorder(id string) *ExecutionRecorder {
	return &ExecutionRecorder{
		id:    id,
		now:   time.Now,
		nodes: make(map[string]*recordedNode),
	}
}

// Handler returns an Eino callback handler. Pass it through
// compose.WithCallbacks when invoking a compiled workflow.
func (recorder *ExecutionRecorder) Handler() callbacks.Handler {
	return callbacks.NewHandlerBuilder().
		OnStartFn(func(ctx context.Context, _ *callbacks.RunInfo, _ callbacks.CallbackInput) context.Context {
			recorder.recordStart(nodePath(ctx))
			return ctx
		}).
		OnEndFn(func(ctx context.Context, _ *callbacks.RunInfo, _ callbacks.CallbackOutput) context.Context {
			recorder.recordEnd(nodePath(ctx), nil)
			return ctx
		}).
		OnErrorFn(func(ctx context.Context, _ *callbacks.RunInfo, err error) context.Context {
			recorder.recordEnd(nodePath(ctx), err)
			return ctx
		}).
		OnStartWithStreamInputFn(func(
			ctx context.Context,
			_ *callbacks.RunInfo,
			input *schema.StreamReader[callbacks.CallbackInput],
		) context.Context {
			if input != nil {
				input.Close()
			}
			recorder.recordStart(nodePath(ctx))
			return ctx
		}).
		OnEndWithStreamOutputFn(func(
			ctx context.Context,
			_ *callbacks.RunInfo,
			output *schema.StreamReader[callbacks.CallbackOutput],
		) context.Context {
			if output != nil {
				output.Close()
			}
			recorder.recordEnd(nodePath(ctx), nil)
			return ctx
		}).
		Build()
}

// Execution returns a deterministic copy of the final outcomes collected so
// far. Nodes that have started but not finished are omitted.
func (recorder *ExecutionRecorder) Execution() Execution {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()

	execution := Execution{ID: recorder.id}
	if recorder.started != nil {
		startedAt := recorder.started.UnixMilli()
		execution.StartedAtMS = &startedAt
	}
	if recorder.finished != nil {
		finishedAt := recorder.finished.UnixMilli()
		execution.FinishedAtMS = &finishedAt
	}
	if recorder.started != nil && recorder.finished != nil {
		duration := milliseconds(recorder.finished.Sub(*recorder.started))
		execution.DurationMS = &duration
	}

	keys := make([]string, 0, len(recorder.nodes))
	for key := range recorder.nodes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		recorded := recorder.nodes[key]
		if recorded.status == "" {
			continue
		}
		node := NodeExecution{
			Path:         append([]string{}, recorded.path...),
			Status:       recorded.status,
			ErrorMessage: recorded.errorMessage,
		}
		if recorded.started != nil {
			startedAt := recorded.started.UnixMilli()
			node.StartedAtMS = &startedAt
		}
		if recorded.finished != nil {
			finishedAt := recorded.finished.UnixMilli()
			node.FinishedAtMS = &finishedAt
		}
		if recorded.started != nil && recorded.finished != nil {
			duration := milliseconds(recorded.finished.Sub(*recorded.started))
			node.DurationMS = &duration
		}
		execution.Nodes = append(execution.Nodes, node)
	}

	return execution
}

func (recorder *ExecutionRecorder) recordStart(path []string) {
	now := recorder.now()
	recorder.mu.Lock()
	defer recorder.mu.Unlock()

	if len(path) == 0 {
		if recorder.started == nil {
			recorder.started = timePointer(now)
		}
		return
	}

	key := executionPathKey(path)
	node := recorder.nodes[key]
	if node == nil {
		node = &recordedNode{path: append([]string{}, path...)}
		recorder.nodes[key] = node
	}
	if node.started == nil {
		node.started = timePointer(now)
	}
	node.finished = nil
	node.status = ""
	node.errorMessage = ""
}

func (recorder *ExecutionRecorder) recordEnd(path []string, err error) {
	now := recorder.now()
	recorder.mu.Lock()
	defer recorder.mu.Unlock()

	if len(path) == 0 {
		recorder.finished = timePointer(now)
		return
	}

	key := executionPathKey(path)
	node := recorder.nodes[key]
	if node == nil {
		node = &recordedNode{
			path: append([]string{}, path...),
		}
		recorder.nodes[key] = node
	}
	node.finished = timePointer(now)
	if err == nil {
		node.status = NodeStatusSuccess
		node.errorMessage = ""
	} else {
		node.status = NodeStatusFailed
		node.errorMessage = err.Error()
	}
}

// MarkSkipped records a node that an authoritative Eino routing decision did
// not invoke. Eino's generic callback API does not expose skipped nodes, so a
// producer must call this method from routing or observability information it
// controls. A skipped node has no timing and serializes durationMs as null.
func (recorder *ExecutionRecorder) MarkSkipped(path []string) {
	if len(path) == 0 {
		return
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()

	key := executionPathKey(path)
	recorder.nodes[key] = &recordedNode{
		path:   append([]string{}, path...),
		status: NodeStatusSkipped,
	}
}

func nodePath(ctx context.Context) []string {
	path := make([]string, 0)
	for _, segment := range compose.GetCurrentAddress(ctx) {
		if segment.Type == compose.AddressSegmentNode {
			path = append(path, segment.ID)
		}
	}
	return path
}

func executionPathKey(path []string) string {
	encoded, _ := json.Marshal(path)
	return string(encoded)
}

func timePointer(value time.Time) *time.Time {
	copy := value
	return &copy
}

func milliseconds(duration time.Duration) float64 {
	return float64(duration) / float64(time.Millisecond)
}
