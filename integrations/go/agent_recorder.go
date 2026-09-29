package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/schema"
)

var ErrNilAgentRunner = errors.New("eino agent recorder: runner is nil")

// AgentRecorderOptions controls source metadata, redaction, and document size
// policy for automatically captured Agent envelopes. Non-streaming runtime
// bodies use bounded defensive copies, redaction, then serialization (4 MiB by
// default). Unsupported values are explicitly omitted; no custom JSON/Text
// marshaler is executed. Configure Envelope.Policy.Redact for private data.
type AgentRecorderOptions struct {
	Envelope EnvelopeOptions
}

// AgentRecorder captures one default Eino ADK Agent run. Use Run or Query so
// input messages, component callbacks, AgentEvents, and the final assistant
// message share one ordered evidence collection.
type AgentRecorder struct {
	mu            sync.Mutex
	runID         string
	options       AgentRecorderOptions
	now           func() time.Time
	envelopes     []Envelope
	diagnostics   []Diagnostic
	captureErr    error
	errorSequence uint64
	started       bool
	ended         bool
}

// RecordedAgentIterator preserves the Runner iterator's pull semantics while
// recording each event immediately before returning it to the caller.
type RecordedAgentIterator struct {
	source   *adk.AsyncIterator[*adk.AgentEvent]
	recorder *AgentRecorder
	ended    bool
	outcome  string
	streamed bool
}

// NewAgentRecorder creates an isolated Recorder for one Agent run.
func NewAgentRecorder(runID string, options AgentRecorderOptions) *AgentRecorder {
	return &AgentRecorder{runID: runID, options: options, now: time.Now}
}

// Run records the last user input, installs component callbacks, and returns a
// pull-through iterator that preserves the original Eino AgentEvents.
func (recorder *AgentRecorder) Run(
	ctx context.Context,
	runner *adk.Runner,
	messages []*schema.Message,
	options ...adk.AgentRunOption,
) (*RecordedAgentIterator, error) {
	if runner == nil {
		return nil, ErrNilAgentRunner
	}
	recorder.recordLifecycleStart()
	recorder.recordLastUserMessage(messages)
	options = append(options, adk.WithCallbacks(recorder.Handler()))
	return recorder.Wrap(runner.Run(ctx, messages, options...)), nil
}

// Query is the string-query counterpart of Run.
func (recorder *AgentRecorder) Query(
	ctx context.Context,
	runner *adk.Runner,
	query string,
	options ...adk.AgentRunOption,
) (*RecordedAgentIterator, error) {
	if runner == nil {
		return nil, ErrNilAgentRunner
	}
	recorder.recordLifecycleStart()
	recorder.RecordMessage(schema.UserMessage(query))
	options = append(options, adk.WithCallbacks(recorder.Handler()))
	return recorder.Wrap(runner.Query(ctx, query, options...)), nil
}

// Wrap adds event projection to an existing default Agent iterator. Callers
// using Wrap directly remain responsible for recording the run input.
func (recorder *AgentRecorder) Wrap(source *adk.AsyncIterator[*adk.AgentEvent]) *RecordedAgentIterator {
	if source != nil {
		recorder.recordLifecycleStart()
	}
	return &RecordedAgentIterator{source: source, recorder: recorder, outcome: "success"}
}

// Next records one source event without consuming message streams, then
// returns the unchanged event pointer to the application. Drain the iterator
// through its false result, including after an error event, to observe the end
// boundary. Unconsumed message streams prevent a final boundary from being
// asserted because they can outlive their event iterator.
func (iterator *RecordedAgentIterator) Next() (*adk.AgentEvent, bool) {
	if iterator == nil || iterator.source == nil || iterator.ended {
		return nil, false
	}
	event, ok := iterator.source.Next()
	if !ok {
		iterator.ended = true
		// Application-owned message streams may outlive their event iterator.
		// Without consuming them, the recorder cannot assert a final boundary.
		if iterator.recorder != nil && !iterator.streamed {
			iterator.recorder.recordLifecycleEnd(iterator.outcome)
		}
		return nil, false
	}
	if event != nil {
		iterator.outcome = observedRunOutcome(event.Err)
		if event.Action != nil && event.Action.Interrupted != nil && event.Err == nil {
			iterator.outcome = "unknown"
		}
		if event.Output != nil && event.Output.MessageOutput != nil && event.Output.MessageOutput.IsStreaming {
			iterator.streamed = true
		}
	}
	if iterator.recorder != nil {
		iterator.recorder.RecordEvent(event)
	}
	return event, true
}

// Handler records JSON-safe component inputs and outputs. Stream callbacks are
// represented as metadata only and their private reader copies are closed.
func (recorder *AgentRecorder) Handler() callbacks.Handler {
	return callbacks.NewHandlerBuilder().
		OnStartFn(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
			recorder.recordComponent(ctx, info, ComponentIOInput, false, input)
			return ctx
		}).
		OnEndFn(func(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
			recorder.recordComponent(ctx, info, ComponentIOOutput, false, output)
			return ctx
		}).
		OnErrorFn(func(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
			// AgentTool does not forward child error events. Preserve the actual
			// nested callback error even when its parent later handles the failure.
			recorder.recordNestedComponentError(ctx, info, err)
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
			recorder.recordComponent(ctx, info, ComponentIOInput, true, nil)
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
			recorder.recordComponent(ctx, info, ComponentIOOutput, true, nil)
			return ctx
		}).
		Build()
}

// RecordMessage adds an explicit schema.message source record.
func (recorder *AgentRecorder) RecordMessage(message *schema.Message) {
	recorder.capture(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		return safeRecorderMessage(message, options)
	})
}

// RecordTool adds an optional schema.tool definition. Actual tool calls are
// captured independently from AgentEvents and component callbacks.
func (recorder *AgentRecorder) RecordTool(tool *schema.ToolInfo) {
	recorder.capture(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		if tool == nil {
			return Envelope{}, nil, ErrNilSchemaValue
		}
		payload, diagnostics := safeRecorderToolInfo(tool, "/payload")
		envelope, nested, err := safeRecorderEnvelope(SchemaToolKind, SchemaToolKindVersion, payload, map[string]any{"name": tool.Name, "desc": tool.Desc}, withSourceDefaults(options, "schema", "ToolInfo"))
		return envelope, append(diagnostics, nested...), err
	})
}

// RecordEvent adds one AgentEvent and derives schema.message only for an
// observed, non-streaming root assistant message without tool calls. Nested
// answers stay in their original AgentEvent and must not become run outputs.
func (recorder *AgentRecorder) RecordEvent(event *adk.AgentEvent) {
	recorder.capture(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		return safeRecorderAgentEvent(event, options)
	})
	if event == nil || event.Output == nil || event.Output.MessageOutput == nil {
		return
	}
	messageOutput := event.Output.MessageOutput
	message := messageOutput.Message
	if messageOutput.IsStreaming || message == nil || message.Role != schema.Assistant || len(message.ToolCalls) > 0 || len(event.RunPath) > 1 {
		return
	}
	recorder.RecordMessage(message)
}

// Envelopes returns defensive copies in observed order. Projection warnings do
// not fail the call; the first projection or callback error is returned.
func (recorder *AgentRecorder) Envelopes() ([]Envelope, []Diagnostic, error) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	encoded, err := json.Marshal(recorder.envelopes)
	if err != nil {
		return nil, append([]Diagnostic(nil), recorder.diagnostics...), fmt.Errorf("eino agent recorder: clone envelopes: %w", err)
	}
	var envelopes []Envelope
	if err := json.Unmarshal(encoded, &envelopes); err != nil {
		return nil, append([]Diagnostic(nil), recorder.diagnostics...), fmt.Errorf("eino agent recorder: clone envelopes: %w", err)
	}
	return envelopes, append([]Diagnostic(nil), recorder.diagnostics...), recorder.captureErr
}

// MarshalEnvelopes serializes the current ordered evidence collection.
func (recorder *AgentRecorder) MarshalEnvelopes() ([]byte, []Diagnostic, error) {
	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		return nil, diagnostics, err
	}
	encoded, marshalErr := json.Marshal(envelopes)
	if marshalErr != nil {
		return nil, diagnostics, fmt.Errorf("eino agent recorder: marshal envelopes: %w", marshalErr)
	}
	return encoded, diagnostics, nil
}

func (recorder *AgentRecorder) recordLastUserMessage(messages []*schema.Message) {
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index] != nil && messages[index].Role == schema.User {
			recorder.RecordMessage(messages[index])
			return
		}
	}
}

func (recorder *AgentRecorder) recordComponent(
	ctx context.Context,
	info *callbacks.RunInfo,
	direction ComponentIODirection,
	streaming bool,
	value any,
) {
	if info == nil || !recordedAgentComponent(info.Component) {
		return
	}
	recorder.capture(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		return safeComponentIO(ctx, info, direction, streaming, value, "node", options)
	})
}

func recordedAgentComponent(component components.Component) bool {
	switch component {
	case components.ComponentOfChatModel,
		components.ComponentOfAgenticModel,
		components.ComponentOfTool:
		return true
	default:
		return false
	}
}

func (recorder *AgentRecorder) recordNestedComponentError(ctx context.Context, info *callbacks.RunInfo, runErr error) {
	if info == nil || !recordedAgentComponent(info.Component) || runErr == nil {
		return
	}
	address := callbackAddressFromContext(ctx)
	agents := 0
	for _, segment := range address {
		if segment.Type == "agent" {
			agents++
		}
	}
	if agents < 2 {
		return
	}
	recorder.capture(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		recorder.errorSequence++
		payload := CallbackEvent{
			Sequence: recorder.errorSequence, Phase: CallbackPhaseError,
			TimestampMS: *options.ObservedAtMS, Address: address,
			NodePath: callbackNodePath(address), Run: projectRunInfo(info),
			Error: &CallbackEventError{Message: runErr.Error()},
		}
		options.Correlation["entityId"] = callbackAddressID(address)
		options.Correlation["parentEntityId"] = callbackAddressID(address[:len(address)-1])
		options.Correlation["eventId"] = fmt.Sprintf("%s:nested-error:%d", recorder.runID, recorder.errorSequence)
		return safeRecorderCallbackError(payload, options)
	})
}

func (recorder *AgentRecorder) capture(project func(EnvelopeOptions) (Envelope, []Diagnostic, error)) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	recorder.captureLocked(project)
}

func (recorder *AgentRecorder) captureLocked(project func(EnvelopeOptions) (Envelope, []Diagnostic, error)) {
	defer func() {
		if recover() != nil {
			recorder.diagnostics = append(recorder.diagnostics, recorderOmission("/payload", "unsupported_value"))
			if recorder.captureErr == nil {
				recorder.captureErr = ErrUnsafeJSON
			}
		}
	}()
	options := recorder.envelopeOptionsLocked()
	envelope, diagnostics, err := project(options)
	recorder.diagnostics = append(recorder.diagnostics, diagnostics...)
	if err != nil {
		if recorder.captureErr == nil {
			recorder.captureErr = err
		}
		return
	}
	recorder.envelopes = append(recorder.envelopes, envelope)
}

func (recorder *AgentRecorder) recordLifecycleStart() {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if recorder.started {
		return
	}
	recorder.started = true
	recorder.captureLocked(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		return safeRecorderLifecycle(RunLifecyclePayload{State: "started"}, options)
	})
}

func (recorder *AgentRecorder) recordLifecycleEnd(outcome string) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if recorder.ended {
		return
	}
	recorder.ended = true
	payload := RunLifecyclePayload{State: "ended", Outcome: outcome, Capture: captureCompleteness(recorder.captureErr, recorder.diagnostics)}
	recorder.captureLocked(func(options EnvelopeOptions) (Envelope, []Diagnostic, error) {
		return safeRecorderLifecycle(payload, options)
	})
}

func (recorder *AgentRecorder) envelopeOptionsLocked() EnvelopeOptions {
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
