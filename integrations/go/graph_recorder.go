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

var ErrGraphNotCompiled = errors.New("eino graph recorder: compile callback has not observed a graph")

// GraphRecorderOptions controls definition and callback-event envelopes.
type GraphRecorderOptions struct {
	Graph  ComposeGraphEnvelopeOptions
	Events EnvelopeOptions
	// IO defaults to Events, including its redaction and finite size policy.
	// Bodies are captured by default: callers must redact private application
	// data before exporting records. Unsupported/oversized bodies are omitted.
	// Metadata keys io and capture are reserved for recorder evidence facts.
	IO *EnvelopeOptions
	// DisableIO explicitly retains the legacy metadata-only callback recording.
	DisableIO bool
}

// GraphRecorder captures an Eino Graph definition without imposing DAG
// semantics and records its invocation as callback.event evidence.
type GraphRecorder struct {
	v2            *nativeV2Recorder
	mu            sync.Mutex
	runID         string
	options       GraphRecorderOptions
	now           func() time.Time
	definition    *Envelope
	diagnostics   []Diagnostic
	projectionErr error
	events        *CallbackEventRecorder
	io            map[uint64]Envelope
	invocations   map[uint64]string
}

// NewGraphRecorder creates an isolated recorder for one compiled Graph run.
func NewGraphRecorder(runID string, options GraphRecorderOptions) *GraphRecorder {
	events := NewCallbackEventRecorder(runID)
	return &GraphRecorder{
		runID:       runID,
		options:     options,
		now:         time.Now,
		events:      events,
		io:          map[uint64]Envelope{},
		invocations: map[uint64]string{},
	}
}

// OnFinish implements compose.GraphCompileCallback.
func (recorder *GraphRecorder) OnFinish(_ context.Context, info *compose.GraphInfo) {
	recorder.v2.definition(info, recorder.options.Graph.Projection)
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	options := recorder.options.Graph
	options.Envelope = recorder.envelopeOptionsLocked(options.Envelope)
	envelope, diagnostics, err := ProjectComposeGraphEnvelope(info, options)
	recorder.diagnostics = append(recorder.diagnostics, diagnostics...)
	recorder.projectionErr = err
	if err != nil {
		recorder.definition = nil
		return
	}
	recorder.definition = &envelope
}

// CompileOption captures the exact possibly-cyclic definition produced by Eino.
func (recorder *GraphRecorder) CompileOption() compose.GraphCompileOption {
	return compose.WithGraphCompileCallbacks(recorder)
}

// Handler records callback timing, component identity, and hierarchical paths.
func (recorder *GraphRecorder) Handler() callbacks.Handler {
	legacy := callbacks.NewHandlerBuilder().
		OnStartFn(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
			return recorder.recordIO(ctx, info, CallbackPhaseStart, false, input, nil)
		}).OnEndFn(func(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
		return recorder.recordIO(ctx, info, CallbackPhaseEnd, false, output, nil)
	}).OnErrorFn(func(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
		return recorder.recordIO(ctx, info, CallbackPhaseError, false, nil, err)
	}).OnStartWithStreamInputFn(func(ctx context.Context, info *callbacks.RunInfo, input *schema.StreamReader[callbacks.CallbackInput]) context.Context {
		if input != nil {
			input.Close()
		}
		return recorder.recordIO(ctx, info, CallbackPhaseStart, true, nil, nil)
	}).OnEndWithStreamOutputFn(func(ctx context.Context, info *callbacks.RunInfo, output *schema.StreamReader[callbacks.CallbackOutput]) context.Context {
		if output != nil {
			output.Close()
		}
		return recorder.recordIO(ctx, info, CallbackPhaseEnd, true, nil, nil)
	}).Build()
	return recorder.v2.wrap(legacy)
}

type graphInvocationKey struct{ recorder *GraphRecorder }
type graphInvocation struct{ entityID, id string }

func (recorder *GraphRecorder) recordIO(ctx context.Context, info *callbacks.RunInfo, phase CallbackPhase, streaming bool, value any, runErr error) context.Context {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	event := recorder.events.record(ctx, info, phase, streaming, runErr)
	if recorder.options.DisableIO {
		return ctx
	}
	entityID := callbackAddressID(event.Address)
	invocation, _ := ctx.Value(graphInvocationKey{recorder}).(graphInvocation)
	if phase == CallbackPhaseStart {
		invocation = graphInvocation{entityID, fmt.Sprintf("%s:%d", recorder.runID, event.Sequence)}
		ctx = context.WithValue(ctx, graphInvocationKey{recorder}, invocation)
	}
	if invocation.entityID == entityID {
		recorder.invocations[event.Sequence] = invocation.id
	}
	if phase == CallbackPhaseError || info == nil {
		return ctx
	}
	options := recorder.options.Events
	if recorder.options.IO != nil {
		options = *recorder.options.IO
	}
	options.Correlation = cloneStringMap(options.Correlation)
	if options.Correlation == nil {
		options.Correlation = map[string]string{}
	}
	options.Correlation["runId"] = recorder.runID
	options.Correlation["eventId"] = fmt.Sprintf("%s:%d", recorder.runID, event.Sequence)
	if id := recorder.invocations[event.Sequence]; id != "" {
		options.Correlation["invocationId"] = id
	}
	options.ObservedAtMS = &event.TimestampMS
	direction := ComponentIOInput
	if phase == CallbackPhaseEnd {
		direction = ComponentIOOutput
	}
	scope := "node"
	if isRootRunnableAddress(event.Address) {
		scope = "root"
	}
	envelope, diagnostics, err := safeComponentIO(ctx, info, direction, streaming, value, scope, options)
	recorder.diagnostics = append(recorder.diagnostics, diagnostics...)
	if err != nil {
		recorder.diagnostics = append(recorder.diagnostics, Diagnostic{Severity: "warning", Code: "projection.body_omitted", Path: "/payload/body", Message: "Component I/O envelope could not be safely projected."})
		return ctx
	}
	recorder.io[event.Sequence] = envelope
	return ctx
}

// InvokeOption installs the callback recorder for one Graph invocation.
func (recorder *GraphRecorder) InvokeOption() compose.Option {
	return compose.WithCallbacks(recorder.Handler())
}

// Events returns a defensive copy of raw callback observations.
func (recorder *GraphRecorder) Events() []CallbackEvent {
	return recorder.events.Events()
}

// Envelopes returns the compose.graph definition followed by callback.event,
// safe component.io, and lifecycle evidence in observed sequence. Cycles remain
// in the definition envelope. Body omission never discards runtime boundaries.
func (recorder *GraphRecorder) Envelopes() ([]Envelope, []Diagnostic, error) {
	recorder.mu.Lock()
	if recorder.projectionErr != nil {
		err := recorder.projectionErr
		diagnostics := append([]Diagnostic(nil), recorder.diagnostics...)
		recorder.mu.Unlock()
		return nil, diagnostics, err
	}
	if recorder.definition == nil {
		diagnostics := append([]Diagnostic(nil), recorder.diagnostics...)
		recorder.mu.Unlock()
		return nil, diagnostics, ErrGraphNotCompiled
	}
	definition, err := cloneEnvelope(*recorder.definition)
	diagnostics := append([]Diagnostic(nil), recorder.diagnostics...)
	if err != nil {
		recorder.mu.Unlock()
		return nil, diagnostics, err
	}
	eventOptions := recorder.options.Events
	observations := recorder.events.Events()
	io := make(map[uint64]Envelope, len(recorder.io))
	for sequence, envelope := range recorder.io {
		io[sequence], err = cloneEnvelope(envelope)
		if err != nil {
			recorder.mu.Unlock()
			return nil, diagnostics, err
		}
	}
	invocations := make(map[uint64]string, len(recorder.invocations))
	for sequence, id := range recorder.invocations {
		invocations[sequence] = id
	}
	recorder.mu.Unlock()
	if err != nil {
		return nil, diagnostics, err
	}
	events, eventDiagnostics, err := recorder.events.envelopesForEvents(observations, eventOptions)
	diagnostics = append(diagnostics, eventDiagnostics...)
	if err != nil {
		return nil, diagnostics, err
	}
	for index, event := range observations {
		if id := invocations[event.Sequence]; id != "" {
			events[index].Correlation["invocationId"] = id
		}
	}
	events, lifecycleDiagnostics, err := graphLifecycleEvidence(observations, events, eventOptions, recorder.runID, captureCompleteness(nil, diagnostics), io)
	diagnostics = append(diagnostics, lifecycleDiagnostics...)
	if err != nil {
		return nil, diagnostics, err
	}
	return append([]Envelope{definition}, events...), diagnostics, nil
}

// Root value callbacks are invocation boundaries; stream-return callbacks are
// not, because their readers may still produce data or errors after return.
func graphLifecycleEvidence(observations []CallbackEvent, envelopes []Envelope, options EnvelopeOptions, runID, captured string, capturedIO ...map[uint64]Envelope) ([]Envelope, []Diagnostic, error) {
	var io map[uint64]Envelope
	if len(capturedIO) > 0 {
		io = capturedIO[0]
	}
	result := make([]Envelope, 0, len(envelopes)+2)
	var diagnostics []Diagnostic
	started, ended, streamed := false, false, false
	for index, event := range observations {
		streamed = streamed || event.Streaming
		root := event.Run != nil && isRootRunnableAddress(event.Address)
		var payload *RunLifecyclePayload
		if root && event.Phase == CallbackPhaseStart && !started {
			started = true
			payload = &RunLifecyclePayload{State: "started"}
		}
		result = append(result, envelopes[index])
		// Root input follows started; terminal output precedes ended. Other I/O
		// sits directly after the callback identified by correlation.eventId.
		if value, ok := io[event.Sequence]; ok && !(root && event.Phase == CallbackPhaseStart) {
			result = append(result, value)
		}
		if root && started && !ended && (event.Phase == CallbackPhaseError || event.Phase == CallbackPhaseEnd && !event.Streaming) {
			ended = true
			outcome := "success"
			if event.Phase == CallbackPhaseError {
				outcome = event.outcome
			}
			capture := captured
			if streamed {
				capture = "partial"
			}
			payload = &RunLifecyclePayload{State: "ended", Outcome: outcome, Capture: capture}
		}
		if payload == nil {
			continue
		}
		lifecycleOptions := options
		lifecycleOptions.Correlation = cloneStringMap(options.Correlation)
		if lifecycleOptions.Correlation == nil {
			lifecycleOptions.Correlation = map[string]string{}
		}
		lifecycleOptions.Correlation["runId"] = runID
		lifecycleOptions.ObservedAtMS = &event.TimestampMS
		envelope, projectedDiagnostics, err := safeRecorderLifecycle(*payload, lifecycleOptions)
		diagnostics = append(diagnostics, projectedDiagnostics...)
		if err != nil {
			return nil, diagnostics, err
		}
		result = append(result, envelope)
		if root && event.Phase == CallbackPhaseStart {
			if value, ok := io[event.Sequence]; ok {
				result = append(result, value)
			}
		}
	}
	return result, diagnostics, nil
}

// MarshalEnvelopes serializes the Graph definition and execution evidence.
func (recorder *GraphRecorder) MarshalEnvelopes() ([]byte, []Diagnostic, error) {
	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		return nil, diagnostics, err
	}
	encoded, err := json.Marshal(envelopes)
	if err != nil {
		return nil, diagnostics, fmt.Errorf("eino graph recorder: marshal envelopes: %w", err)
	}
	return encoded, diagnostics, nil
}

func (recorder *GraphRecorder) envelopeOptionsLocked(options EnvelopeOptions) EnvelopeOptions {
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

func cloneEnvelope(envelope Envelope) (Envelope, error) {
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return Envelope{}, fmt.Errorf("eino recorder: clone envelope: %w", err)
	}
	var cloned Envelope
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return Envelope{}, fmt.Errorf("eino recorder: clone envelope: %w", err)
	}
	return cloned, nil
}
