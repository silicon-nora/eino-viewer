package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

const (
	CallbackEventKind        = "callback.event"
	CallbackEventKindVersion = 1
)

type CallbackPhase string

const (
	CallbackPhaseStart CallbackPhase = "start"
	CallbackPhaseEnd   CallbackPhase = "end"
	CallbackPhaseError CallbackPhase = "error"
)

type CallbackAddressSegment struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	SubID string `json:"subId,omitempty"`
}

type CallbackRunInfo struct {
	Name      string `json:"name,omitempty"`
	Type      string `json:"type,omitempty"`
	Component string `json:"component,omitempty"`
}

type CallbackEventError struct {
	Message string `json:"message"`
}

// CallbackEvent is a transport-safe observation of one Eino callback timing.
// Callback input and output bodies are deliberately excluded; domain-specific
// codecs can project them separately after applying an explicit policy.
type CallbackEvent struct {
	Sequence    uint64                   `json:"sequence"`
	Phase       CallbackPhase            `json:"phase"`
	Streaming   bool                     `json:"streaming"`
	TimestampMS int64                    `json:"timestampMs"`
	Address     []CallbackAddressSegment `json:"address"`
	NodePath    []string                 `json:"nodePath,omitempty"`
	Run         *CallbackRunInfo         `json:"run,omitempty"`
	Error       *CallbackEventError      `json:"error,omitempty"`
	outcome     string
}

// CallbackEventRecorder records callback arrival order under a mutex so events
// from concurrent graph nodes receive one stable sequence within the run.
type CallbackEventRecorder struct {
	mu     sync.Mutex
	runID  string
	now    func() time.Time
	next   uint64
	events []CallbackEvent
}

func NewCallbackEventRecorder(runID string) *CallbackEventRecorder {
	return &CallbackEventRecorder{
		runID: runID,
		now:   time.Now,
		next:  1,
	}
}

// Handler observes value, stream, and error callbacks. Stream copies are
// closed without being consumed so the recorder does not retain live data or
// leak callback-owned readers.
func (recorder *CallbackEventRecorder) Handler() callbacks.Handler {
	return callbacks.NewHandlerBuilder().
		OnStartFn(func(ctx context.Context, info *callbacks.RunInfo, _ callbacks.CallbackInput) context.Context {
			recorder.record(ctx, info, CallbackPhaseStart, false, nil)
			return ctx
		}).
		OnEndFn(func(ctx context.Context, info *callbacks.RunInfo, _ callbacks.CallbackOutput) context.Context {
			recorder.record(ctx, info, CallbackPhaseEnd, false, nil)
			return ctx
		}).
		OnErrorFn(func(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
			recorder.record(ctx, info, CallbackPhaseError, false, err)
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
			recorder.record(ctx, info, CallbackPhaseStart, true, nil)
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
			recorder.record(ctx, info, CallbackPhaseEnd, true, nil)
			return ctx
		}).
		Build()
}

func (recorder *CallbackEventRecorder) record(
	ctx context.Context,
	info *callbacks.RunInfo,
	phase CallbackPhase,
	streaming bool,
	err error,
) CallbackEvent {
	address := callbackAddress(compose.GetCurrentAddress(ctx))
	event := CallbackEvent{
		Phase:     phase,
		Streaming: streaming,
		Address:   address,
		NodePath:  callbackNodePath(address),
		Run:       projectRunInfo(info),
	}
	if phase == CallbackPhaseError {
		event.outcome = observedRunOutcome(err)
		message := ""
		if err != nil {
			message = err.Error()
		}
		event.Error = &CallbackEventError{Message: message}
	}

	recorder.mu.Lock()
	event.TimestampMS = recorder.now().UnixMilli()
	event.Sequence = recorder.next
	recorder.next++
	recorder.events = append(recorder.events, event)
	recorder.mu.Unlock()
	return cloneCallbackEvent(event)
}

// Events returns a deterministic deep copy of all callback observations so far.
func (recorder *CallbackEventRecorder) Events() []CallbackEvent {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()

	result := make([]CallbackEvent, len(recorder.events))
	for index := range recorder.events {
		result[index] = cloneCallbackEvent(recorder.events[index])
	}
	return result
}

// Envelopes returns one callback.event envelope per observation. The run,
// event, current entity, and parent entity identifiers are added to caller
// correlation fields without mutating the caller's options.
func (recorder *CallbackEventRecorder) Envelopes(options EnvelopeOptions) ([]Envelope, []Diagnostic, error) {
	return recorder.envelopesForEvents(recorder.Events(), options)
}

func (recorder *CallbackEventRecorder) envelopesForEvents(events []CallbackEvent, options EnvelopeOptions) ([]Envelope, []Diagnostic, error) {
	if strings.TrimSpace(recorder.runID) == "" {
		return nil, nil, fmt.Errorf("%w: callback event recorder requires a run id", ErrInvalidEnvelope)
	}
	envelopes := make([]Envelope, 0, len(events))
	allDiagnostics := make([]Diagnostic, 0)
	for _, event := range events {
		eventOptions := options
		eventOptions.Source = cloneStringMap(options.Source)
		if eventOptions.Source == nil {
			eventOptions.Source = make(map[string]string)
		}
		if eventOptions.Source["module"] == "" {
			eventOptions.Source["module"] = "callbacks"
		}
		if eventOptions.Source["format"] == "" {
			eventOptions.Source["format"] = "RunInfo"
		}
		eventOptions.Correlation = cloneStringMap(options.Correlation)
		if eventOptions.Correlation == nil {
			eventOptions.Correlation = make(map[string]string)
		}
		eventOptions.Correlation["runId"] = recorder.runID
		eventOptions.Correlation["eventId"] = fmt.Sprintf("%s:%d", recorder.runID, event.Sequence)
		if entityID := callbackAddressID(event.Address); entityID != "" {
			eventOptions.Correlation["entityId"] = entityID
		}
		if parentID := callbackAddressID(event.Address[:max(0, len(event.Address)-1)]); parentID != "" {
			eventOptions.Correlation["parentEntityId"] = parentID
		}
		eventOptions.ObservedAtMS = cloneInt64(&event.TimestampMS)

		envelope, diagnostics, err := NewEnvelope(
			CallbackEventKind,
			CallbackEventKindVersion,
			event,
			eventOptions,
		)
		allDiagnostics = append(allDiagnostics, diagnostics...)
		if err != nil {
			return nil, allDiagnostics, err
		}
		envelopes = append(envelopes, envelope)
	}
	return envelopes, allDiagnostics, nil
}

func (recorder *CallbackEventRecorder) MarshalEnvelopes(options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	envelopes, diagnostics, err := recorder.Envelopes(options)
	if err != nil {
		return nil, diagnostics, err
	}
	encoded, err := json.Marshal(envelopes)
	if err != nil {
		return nil, diagnostics, err
	}
	return encoded, diagnostics, nil
}

func callbackAddress(address compose.Address) []CallbackAddressSegment {
	result := make([]CallbackAddressSegment, len(address))
	for index, segment := range address {
		result[index] = CallbackAddressSegment{
			Type:  string(segment.Type),
			ID:    segment.ID,
			SubID: segment.SubID,
		}
	}
	return result
}

func callbackNodePath(address []CallbackAddressSegment) []string {
	path := make([]string, 0, len(address))
	for _, segment := range address {
		if segment.Type == string(compose.AddressSegmentNode) {
			path = append(path, segment.ID)
		}
	}
	return path
}

func callbackAddressID(address []CallbackAddressSegment) string {
	parts := make([]string, 0, len(address))
	for _, segment := range address {
		part := segment.Type + ":" + segment.ID
		if segment.SubID != "" {
			part += ":" + segment.SubID
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, "/")
}

func projectRunInfo(info *callbacks.RunInfo) *CallbackRunInfo {
	if info == nil {
		return nil
	}
	return &CallbackRunInfo{
		Name:      info.Name,
		Type:      info.Type,
		Component: string(info.Component),
	}
}

func cloneCallbackEvent(event CallbackEvent) CallbackEvent {
	copy := event
	copy.Address = append([]CallbackAddressSegment(nil), event.Address...)
	copy.NodePath = append([]string(nil), event.NodePath...)
	if event.Run != nil {
		run := *event.Run
		copy.Run = &run
	}
	if event.Error != nil {
		errorCopy := *event.Error
		copy.Error = &errorCopy
	}
	return copy
}

// Go 1.18 compatibility helper.
func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}
