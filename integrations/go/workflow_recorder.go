package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

var ErrWorkflowNotCompiled = errors.New("eino workflow recorder: compile callback has not observed a graph")

// WorkflowRecorderOptions controls the topology projection and document-level
// metadata produced by a WorkflowRecorder.
type WorkflowRecorderOptions struct {
	Project  ProjectOptions
	Metadata JSONMap
	// Envelope controls runtime root and node bodies. Safe capture uses bounded
	// defensive copies before redaction and serialization (4 MiB by default),
	// without executing custom JSON/Text marshalers. Configure Policy.Redact
	// for private data; compile-time Project and Metadata retain legacy codecs.
	Envelope EnvelopeOptions
	// DisableRootIO retains the legacy node-only evidence collection. By
	// default root input/output is safely captured using Envelope's policy;
	// callers must configure redaction for private application data.
	DisableRootIO bool
}

// WorkflowRecorder combines Eino's compile-time GraphInfo with callback-based
// execution outcomes. Create one recorder for one compiled Workflow invocation.
// It is safe for concurrent Eino node callbacks.
type WorkflowRecorder struct {
	v2             *nativeV2Recorder
	mu             sync.Mutex
	runID          string
	options        WorkflowRecorderOptions
	now            func() time.Time
	compiledAtMS   *int64
	topology       *Snapshot
	projectionErr  error
	execution      *ExecutionRecorder
	envelopes      []Envelope
	diagnostics    []Diagnostic
	captureErr     error
	capturePartial bool
	started        bool
	ended          bool
}

// NewWorkflowRecorder creates an isolated recorder for one Workflow run.
func NewWorkflowRecorder(runID string, options WorkflowRecorderOptions) *WorkflowRecorder {
	return &WorkflowRecorder{
		runID:     runID,
		options:   options,
		now:       time.Now,
		execution: NewExecutionRecorder(runID),
	}
}

// OnFinish implements compose.GraphCompileCallback. Applications normally use
// CompileOption instead of calling this method directly.
func (recorder *WorkflowRecorder) OnFinish(_ context.Context, info *compose.GraphInfo) {
	recorder.v2.definition(info, recorder.options.Project)
	snapshot, err := ProjectWithOptions(info, recorder.options.Project)
	compiledAtMS := recorder.now().UnixMilli()
	if err == nil {
		snapshot.Metadata, err = cloneJSONMap(recorder.options.Metadata)
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	recorder.projectionErr = err
	recorder.compiledAtMS = &compiledAtMS
	if err != nil {
		recorder.topology = nil
		return
	}
	recorder.topology = &snapshot
}

// CompileOption captures the exact GraphInfo produced by Eino compilation.
func (recorder *WorkflowRecorder) CompileOption() compose.GraphCompileOption {
	return compose.WithGraphCompileCallbacks(recorder)
}

// Handler records node execution paths, final status, timing, errors, and
// JSON-safe component inputs and outputs for every observed Workflow node.
func (recorder *WorkflowRecorder) Handler() callbacks.Handler {
	legacy := callbacks.NewHandlerBuilder().
		OnStartFn(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
			recorder.recordRootLifecycle(ctx, "started", nil)
			path := nodePath(ctx)
			recorder.execution.recordStart(path)
			recorder.recordComponent(ctx, info, path, ComponentIOInput, false, input)
			return ctx
		}).
		OnEndFn(func(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
			path := nodePath(ctx)
			recorder.recordComponent(ctx, info, path, ComponentIOOutput, false, output)
			recorder.execution.recordEnd(path, nil)
			recorder.recordRootLifecycle(ctx, "ended", nil)
			return ctx
		}).
		OnErrorFn(func(ctx context.Context, _ *callbacks.RunInfo, err error) context.Context {
			recorder.execution.recordEnd(nodePath(ctx), err)
			recorder.recordRootLifecycle(ctx, "ended", err)
			return ctx
		}).
		OnStartWithStreamInputFn(func(
			ctx context.Context,
			info *callbacks.RunInfo,
			input *schema.StreamReader[callbacks.CallbackInput],
		) context.Context {
			if input != nil {
				input.Close()
			}
			recorder.recordRootLifecycle(ctx, "started", nil)
			path := nodePath(ctx)
			recorder.execution.recordStart(path)
			recorder.recordComponent(ctx, info, path, ComponentIOInput, true, nil)
			return ctx
		}).
		OnEndWithStreamOutputFn(func(
			ctx context.Context,
			info *callbacks.RunInfo,
			output *schema.StreamReader[callbacks.CallbackOutput],
		) context.Context {
			if output != nil {
				output.Close()
			}
			path := nodePath(ctx)
			recorder.recordComponent(ctx, info, path, ComponentIOOutput, true, nil)
			recorder.execution.recordEnd(path, nil)
			return ctx
		}).
		Build()
	return recorder.v2.wrap(legacy)
}

func (recorder *WorkflowRecorder) recordRootLifecycle(ctx context.Context, state string, runErr error) {
	if !isRootRunnableAddress(callbackAddress(compose.GetCurrentAddress(ctx))) {
		return
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if state == "started" {
		if recorder.started {
			return
		}
		recorder.started = true
	} else {
		if !recorder.started || recorder.ended {
			return
		}
		recorder.ended = true
	}
	payload := RunLifecyclePayload{State: state}
	if state == "ended" {
		payload.Outcome = observedRunOutcome(runErr)
		payload.Capture = captureCompleteness(recorder.captureErr, recorder.diagnostics)
	}
	envelope, diagnostics, err := safeRecorderLifecycle(payload, recorder.envelopeOptionsLocked())
	recorder.diagnostics = append(recorder.diagnostics, diagnostics...)
	if err != nil {
		if recorder.captureErr == nil {
			recorder.captureErr = err
		}
		return
	}
	recorder.envelopes = append(recorder.envelopes, envelope)
}

// InvokeOption installs the execution callback handler for one invocation.
func (recorder *WorkflowRecorder) InvokeOption() compose.Option {
	return compose.WithCallbacks(recorder.Handler())
}

// MarkSkipped records a node that authoritative application routing identifies
// as not invoked. Generic Eino callbacks cannot infer skipped branches.
func (recorder *WorkflowRecorder) MarkSkipped(path []string) {
	recorder.execution.MarkSkipped(path)
}

// Execution returns the deterministic execution state collected so far.
func (recorder *WorkflowRecorder) Execution() Execution {
	return recorder.execution.Execution()
}

// Snapshot returns a defensive copy containing the captured topology and the
// latest final execution outcomes. It fails until Eino invokes CompileOption's
// callback, or when topology projection failed.
func (recorder *WorkflowRecorder) Snapshot() (Snapshot, error) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if recorder.projectionErr != nil {
		return Snapshot{}, recorder.projectionErr
	}
	if recorder.topology == nil {
		return Snapshot{}, ErrWorkflowNotCompiled
	}
	snapshot, err := cloneWorkflowSnapshot(*recorder.topology)
	if err != nil {
		return Snapshot{}, err
	}
	execution := recorder.execution.Execution()
	snapshot.Execution = &execution
	return snapshot, nil
}

// MarshalSnapshot serializes the current combined Workflow snapshot.
func (recorder *WorkflowRecorder) MarshalSnapshot() ([]byte, error) {
	snapshot, err := recorder.Snapshot()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("eino workflow recorder: marshal snapshot: %w", err)
	}
	return encoded, nil
}

// Envelopes returns one workflow.snapshot anchor followed by the component.io
// records observed during execution. Snapshot remains available for consumers
// of the original eino-workflow-dag contract.
func (recorder *WorkflowRecorder) Envelopes() ([]Envelope, []Diagnostic, error) {
	snapshot, err := recorder.Snapshot()
	if err != nil {
		return nil, nil, err
	}

	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	options := recorder.envelopeOptionsLocked()
	options.ObservedAtMS = cloneInt64(recorder.compiledAtMS)
	options = withSourceDefaults(options, "compose", "EinoWorkflowSnapshot")
	anchor, anchorDiagnostics, err := NewEnvelope("workflow.snapshot", 1, snapshot, options)
	diagnostics := append(append([]Diagnostic(nil), recorder.diagnostics...), anchorDiagnostics...)
	if err != nil {
		return nil, diagnostics, err
	}
	envelopes := make([]Envelope, 0, len(recorder.envelopes)+1)
	envelopes = append(envelopes, anchor)
	envelopes = append(envelopes, recorder.envelopes...)
	encoded, err := json.Marshal(envelopes)
	if err != nil {
		return nil, diagnostics, fmt.Errorf("eino workflow recorder: clone envelopes: %w", err)
	}
	var cloned []Envelope
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return nil, diagnostics, fmt.Errorf("eino workflow recorder: clone envelopes: %w", err)
	}
	// Anchor projection occurs when taking the snapshot. Its redaction or
	// omission diagnostics must participate in the exported capture truth too.
	// Change only the defensive copy, never a previously returned snapshot.
	if captureCompleteness(recorder.captureErr, diagnostics) == "partial" {
		recorder.capturePartial = true
	}
	if recorder.capturePartial {
		for index := range cloned {
			if cloned[index].Kind != RunLifecycleKind {
				continue
			}
			payload, err := validateRunLifecycleEnvelope(cloned[index])
			if err != nil {
				return nil, diagnostics, err
			}
			if payload.State == "ended" && payload.Capture != "partial" {
				payload.Capture = "partial"
				cloned[index].Payload, err = json.Marshal(payload)
				if err != nil {
					return nil, diagnostics, err
				}
			}
		}
	}
	return cloned, diagnostics, recorder.captureErr
}

// MarshalEnvelopes serializes the Workflow definition and its observed node
// inputs and outputs as one Viewer-compatible evidence collection.
func (recorder *WorkflowRecorder) MarshalEnvelopes() ([]byte, []Diagnostic, error) {
	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		return nil, diagnostics, err
	}
	encoded, err := json.Marshal(envelopes)
	if err != nil {
		return nil, diagnostics, fmt.Errorf("eino workflow recorder: marshal envelopes: %w", err)
	}
	return encoded, diagnostics, nil
}

func (recorder *WorkflowRecorder) recordComponent(
	ctx context.Context,
	info *callbacks.RunInfo,
	path []string,
	direction ComponentIODirection,
	streaming bool,
	value any,
) {
	root := isRootRunnableAddress(callbackAddressFromContext(ctx))
	if info == nil || len(path) == 0 && (!root || recorder.options.DisableRootIO) {
		return
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	options := recorder.envelopeOptionsLocked()
	var envelope Envelope
	var diagnostics []Diagnostic
	var err error
	if root {
		options.Correlation["invocationId"] = recorder.runID + ":root"
		envelope, diagnostics, err = safeComponentIO(ctx, info, direction, streaming, value, "root", options)
	} else {
		envelope, diagnostics, err = safeComponentIO(ctx, info, direction, streaming, value, "node", options)
		if !streaming && string(info.Component) == "Lambda" {
			_, _, customDiagnostics, _ := projectCustomComponentBody(info.Component, direction, value)
			diagnostics = append(customDiagnostics, diagnostics...)
		}
	}
	recorder.diagnostics = append(recorder.diagnostics, diagnostics...)
	if err != nil {
		if recorder.captureErr == nil {
			recorder.captureErr = err
		}
		return
	}
	recorder.envelopes = append(recorder.envelopes, envelope)
}

func (recorder *WorkflowRecorder) envelopeOptionsLocked() EnvelopeOptions {
	options := recorder.options.Envelope
	options.Source = cloneStringMap(options.Source)
	options.Correlation = cloneStringMap(options.Correlation)
	if options.Correlation == nil {
		options.Correlation = map[string]string{}
	}
	if recorder.runID != "" {
		options.Correlation["runId"] = recorder.runID
	}
	observedAt := recorder.now().UnixMilli()
	options.ObservedAtMS = &observedAt
	return options
}

func cloneWorkflowSnapshot(snapshot Snapshot) (Snapshot, error) {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return Snapshot{}, fmt.Errorf("eino workflow recorder: clone snapshot: %w", err)
	}
	var cloned Snapshot
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return Snapshot{}, fmt.Errorf("eino workflow recorder: clone snapshot: %w", err)
	}
	return cloned, nil
}

func cloneJSONMap(value JSONMap) (JSONMap, error) {
	if value == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("eino workflow recorder: clone metadata: %w", err)
	}
	var cloned JSONMap
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return nil, fmt.Errorf("eino workflow recorder: clone metadata: %w", err)
	}
	return cloned, nil
}
