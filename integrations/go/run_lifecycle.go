package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/compose"
)

const (
	RunLifecycleKind        = "run.lifecycle"
	RunLifecycleKindVersion = 1
)

// RunLifecyclePayload records an observed invocation boundary, independently
// from individual node errors and from the completeness of captured evidence.
// An ended record does not imply successful execution or complete capture.
type RunLifecyclePayload struct {
	State   string `json:"state"`
	Outcome string `json:"outcome,omitempty"`
	Capture string `json:"capture,omitempty"`
}

// ProjectRunLifecycleEnvelope projects a source-observed invocation boundary.
// Callers must not manufacture an ended boundary from an assistant message,
// a component error, or merely receiving a stream reader.
func ProjectRunLifecycleEnvelope(payload RunLifecyclePayload, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if strings.TrimSpace(options.Correlation["runId"]) == "" {
		return Envelope{}, nil, fmt.Errorf("%w: run lifecycle requires a run id", ErrInvalidEnvelope)
	}
	if payload.State == "started" {
		if payload.Outcome != "" || payload.Capture != "" {
			return Envelope{}, nil, fmt.Errorf("%w: started lifecycle must not declare an outcome or capture", ErrInvalidEnvelope)
		}
	} else if payload.State == "ended" {
		if payload.Outcome != "success" && payload.Outcome != "failed" && payload.Outcome != "cancelled" && payload.Outcome != "unknown" {
			return Envelope{}, nil, fmt.Errorf("%w: invalid run outcome %q", ErrInvalidEnvelope, payload.Outcome)
		}
		if payload.Capture != "complete" && payload.Capture != "partial" {
			return Envelope{}, nil, fmt.Errorf("%w: invalid capture completeness %q", ErrInvalidEnvelope, payload.Capture)
		}
	} else {
		return Envelope{}, nil, fmt.Errorf("%w: invalid lifecycle state %q", ErrInvalidEnvelope, payload.State)
	}
	envelope, diagnostics, err := NewEnvelope(RunLifecycleKind, RunLifecycleKindVersion, payload, withSourceDefaults(options, "recorder", "RunLifecycle"))
	if err != nil {
		return Envelope{}, diagnostics, err
	}
	if _, err := validateRunLifecycleEnvelope(envelope); err != nil {
		return Envelope{}, diagnostics, err
	}
	return envelope, diagnostics, nil
}

func validateRunLifecycleEnvelope(envelope Envelope) (RunLifecyclePayload, error) {
	var payload RunLifecyclePayload
	invalid := func(message string) (RunLifecyclePayload, error) {
		return payload, fmt.Errorf("%w: %s", ErrInvalidEnvelope, message)
	}
	if envelope.Kind != RunLifecycleKind || envelope.KindVersion != RunLifecycleKindVersion {
		return invalid("expected run.lifecycle kindVersion 1")
	}
	if strings.TrimSpace(envelope.Correlation["runId"]) == "" {
		return invalid("run lifecycle requires a run id")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(envelope.Payload, &fields); err != nil || fields == nil {
		return invalid("run lifecycle payload must be an object")
	}
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		return invalid("run lifecycle fields must be strings")
	}
	for field := range fields {
		if field != "state" && !(payload.State == "ended" && (field == "outcome" || field == "capture")) {
			return invalid("unknown run lifecycle field " + field)
		}
	}
	if payload.State == "started" {
		return payload, nil
	}
	if payload.State != "ended" {
		return invalid("run lifecycle state must be started or ended")
	}
	if payload.Outcome != "success" && payload.Outcome != "failed" && payload.Outcome != "cancelled" && payload.Outcome != "unknown" {
		return invalid("invalid run lifecycle outcome")
	}
	if payload.Capture != "complete" && payload.Capture != "partial" {
		return invalid("invalid run lifecycle capture completeness")
	}
	return payload, nil
}

func validateRunLifecycleSequence(envelopes []Envelope) error {
	state := ""
	for index, envelope := range envelopes {
		if envelope.Kind == RunLifecycleKind {
			payload, err := validateRunLifecycleEnvelope(envelope)
			if err != nil {
				return fmt.Errorf("evidence[%d]: %v", index, err)
			}
			if state == "ended" || state == "started" && payload.State == "started" {
				return fmt.Errorf("evidence[%d]: conflicting run lifecycle markers", index)
			}
			state = payload.State
			continue
		}
		if state != "ended" {
			continue
		}
		switch envelope.Kind {
		case AgentEventKind, CallbackEventKind, ComponentIOKind, "schema.message", "schema.agentic_message", "workflow.snapshot":
			return fmt.Errorf("evidence[%d]: execution evidence cannot follow the recorded run end", index)
		}
	}
	return nil
}

func observedRunOutcome(err error) string {
	if err == nil {
		return "success"
	}
	var cancelled *adk.CancelError
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.As(err, &cancelled) || errors.Is(err, adk.ErrStreamCanceled) {
		return "cancelled"
	}
	if _, interrupted := compose.ExtractInterruptInfo(err); interrupted {
		return "unknown"
	}
	return "failed"
}

func captureCompleteness(captureErr error, diagnostics []Diagnostic) string {
	if captureErr != nil {
		return "partial"
	}
	for _, diagnostic := range diagnostics {
		switch diagnostic.Code {
		case "projection.stream_omitted", "projection.message_missing", "projection.redacted", "projection.runtime_field_omitted", "projection.body_omitted":
			return "partial"
		}
	}
	return "complete"
}

func isRootRunnableAddress(address []CallbackAddressSegment) bool {
	return len(address) == 1 && address[0].Type == "runnable"
}
