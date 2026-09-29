package einoworkflowsnapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

// safeRecorderEnvelope is the Recorder-only boundary. Public Project* helpers
// retain their existing encoding/json compatibility contract. Rejected runtime
// values are never serialized, including values introduced by a redactor.
func safeRecorderEnvelope(kind string, version int, payload, fallback any, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	cloned, diagnostics, err := safeRecorderValue(payload, []string{"payload"}, options.Policy.Redact)
	metadata, metadataDiagnostics, metadataErr := safeRecorderValue(options.Metadata, []string{"metadata"}, options.Policy.Redact)
	diagnostics = append(diagnostics, metadataDiagnostics...)
	fields, ok := metadata.(map[string]any)
	if metadataErr != nil || metadata != nil && !ok {
		diagnostics = append(diagnostics, recorderOmission("/metadata", "unsupported_value"))
		fields = nil
	}
	if fields == nil {
		fields = map[string]any{}
	}
	// Recorder facts cannot be overwritten by application metadata.
	delete(fields, "capture")
	capture := map[string]any{"status": "captured"}
	redacted := false
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "projection.redacted" && len(diagnostic.Path) >= 8 && diagnostic.Path[:8] == "/payload" {
			capture["redacted"] = true
			redacted = true
		}
	}
	if redacted {
		fields["capture"] = capture
	}
	finalOptions := options
	if len(fields) > 0 {
		finalOptions.Metadata = fields
	} else {
		finalOptions.Metadata = nil
	}
	finalOptions.Policy.Redact = nil
	reason := "unsupported_value"
	if err == nil {
		limit, limitErr := policyLimit(options.Policy)
		if limitErr != nil {
			return Envelope{}, diagnostics, limitErr
		}
		remaining := limit
		if !plainJSONFits(cloned, &remaining) || !plainJSONFits(fields, &remaining) {
			err = ErrDocumentTooLarge
		} else {
			var nested []Diagnostic
			var envelope Envelope
			envelope, nested, err = NewEnvelope(kind, version, cloned, finalOptions)
			diagnostics = append(diagnostics, nested...)
			if err == nil {
				return envelope, diagnostics, nil
			}
		}
		if errors.Is(err, ErrDocumentTooLarge) {
			reason = "size_limit"
		}
	}
	diagnostics = append(diagnostics, recorderOmission("/payload", reason))
	// A fallback contains only structural facts from the source. It does not
	// replace missing content with "", null, a made-up answer, or a failure.
	cloned, nested, fallbackErr := safeRecorderValue(fallback, []string{"payload"}, options.Policy.Redact)
	diagnostics = append(diagnostics, nested...)
	if fallbackErr != nil {
		return Envelope{}, diagnostics, fallbackErr
	}
	finalOptions.Policy.MaxDocumentBytes = 0
	finalOptions.Metadata = map[string]any{"capture": map[string]any{"status": "omitted", "reason": reason}}
	remaining := DefaultMaxDocumentBytes
	if !plainJSONFits(cloned, &remaining) || !plainJSONFits(finalOptions.Metadata, &remaining) {
		return Envelope{}, diagnostics, ErrDocumentTooLarge
	}
	envelope, nested, fallbackErr := NewEnvelope(kind, version, cloned, finalOptions)
	return envelope, append(diagnostics, nested...), fallbackErr
}

func safeRecorderValue(value any, path []string, redact Redactor) (any, []Diagnostic, error) {
	budget := 100000
	cloned, err := clonePlainJSON(reflect.ValueOf(value), 0, &budget)
	if err != nil {
		return nil, nil, err
	}
	var diagnostics []Diagnostic
	if redact != nil {
		cloned, diagnostics, err = redactPlainJSON(cloned, path, redact)
		if err != nil {
			return nil, diagnostics, err
		}
		budget = 100000
		cloned, err = clonePlainJSON(reflect.ValueOf(cloned), 0, &budget)
	}
	return cloned, diagnostics, err
}

func recorderOmission(path, reason string) Diagnostic {
	return Diagnostic{Severity: "warning", Code: "projection.body_omitted", Path: path, Message: "Recorder content omitted: " + reason + "."}
}

func safeRecorderMessage(message *schema.Message, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if message == nil {
		return Envelope{}, nil, ErrNilSchemaValue
	}
	fallback := map[string]any{"role": string(message.Role)}
	if message.ToolCallID != "" {
		fallback["tool_call_id"] = message.ToolCallID
	}
	if message.ToolName != "" {
		fallback["tool_name"] = message.ToolName
	}
	return safeRecorderEnvelope(SchemaMessageKind, SchemaMessageKindVersion, message, fallback, withSourceDefaults(options, "schema", "Message"))
}

func safeRecorderAgentEvent(event *adk.AgentEvent, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if event == nil {
		return Envelope{}, nil, ErrNilAgentEvent
	}
	payload, diagnostics := projectAgentEventPayload(event, "Message")
	fallback := payload
	if payload.Output != nil {
		fallback.Output = &AgentEventOutput{}
		if payload.Output.Message != nil {
			message := *payload.Output.Message
			message.Value = nil
			fallback.Output.Message = &message
		}
	}
	if payload.Action != nil {
		action := *payload.Action
		action.Customized = nil
		if action.Interrupted != nil {
			interrupt := *action.Interrupted
			interrupt.Data = nil
			interrupt.Contexts = append([]AgentInterruptContext(nil), interrupt.Contexts...)
			for index := range interrupt.Contexts {
				interrupt.Contexts[index].Info = nil
			}
			action.Interrupted = &interrupt
		}
		fallback.Action = &action
	}
	envelope, nested, err := safeRecorderEnvelope(AgentEventKind, AgentEventKindVersion, payload, fallback, withSourceDefaults(options, "adk", "AgentEvent"))
	return envelope, append(diagnostics, nested...), err
}

const recorderErrorDetailsOmitted = "[error details omitted by capture policy]"

// The existing callback error contract requires a message string. Keep an
// explicit recorder-owned notice after safe capture omitted the actual error;
// do not run an application redactor on this non-source omission notice.
func safeRecorderCallbackError(payload CallbackEvent, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	fallback := payload
	fallback.Error = nil
	options = withSourceDefaults(options, "callbacks", "RunInfo")
	envelope, diagnostics, err := safeRecorderEnvelope(CallbackEventKind, CallbackEventKindVersion, payload, fallback, options)
	if err != nil {
		return envelope, diagnostics, err
	}
	var metadata map[string]any
	if len(envelope.Metadata) == 0 {
		return envelope, diagnostics, nil
	}
	if err := json.Unmarshal(envelope.Metadata, &metadata); err != nil {
		return Envelope{}, diagnostics, err
	}
	capture, _ := metadata["capture"].(map[string]any)
	if capture["status"] != "omitted" {
		return envelope, diagnostics, nil
	}
	var body map[string]any
	if err := json.Unmarshal(envelope.Payload, &body); err != nil {
		return Envelope{}, diagnostics, err
	}
	body["error"] = map[string]any{"message": recorderErrorDetailsOmitted}
	// Both maps were decoded from bounded recorder-owned JSON. Rebuilding still
	// checks the complete envelope against the existing fallback byte limit.
	finalOptions := EnvelopeOptions{Source: envelope.Source, Correlation: envelope.Correlation, ObservedAtMS: envelope.ObservedAtMS, Metadata: metadata}
	envelope, nested, err := NewEnvelope(CallbackEventKind, CallbackEventKindVersion, body, finalOptions)
	return envelope, append(diagnostics, nested...), err
}

// ToolInfo's private ParamsOneOf representation requires custom serialization
// or an unbounded recursive ToJSONSchema call. Neither is executed by Recorder.
// Names/descriptions/JSON-safe extensions remain available with explicit facts
// about any missing parameter definition.
func safeRecorderToolInfo(tool *schema.ToolInfo, path string) (map[string]any, []Diagnostic) {
	if tool == nil {
		return nil, nil
	}
	payload := map[string]any{}
	if tool.Name != "" {
		payload["name"] = tool.Name
	}
	if tool.Desc != "" {
		payload["desc"] = tool.Desc
	}
	if len(tool.Extra) > 0 {
		payload["extra"] = tool.Extra
	}
	if tool.ParamsOneOf == nil {
		return payload, nil
	}
	return payload, []Diagnostic{{Severity: "warning", Code: "projection.runtime_field_omitted", Path: path + "/params", Message: "Tool parameter definition omitted: unsupported_value; Recorder does not execute ToolInfo custom serialization."}}
}

func safeRecorderLifecycle(payload RunLifecyclePayload, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	envelope, diagnostics, err := safeRecorderEnvelope(RunLifecycleKind, RunLifecycleKindVersion, payload, payload, withSourceDefaults(options, "recorder", "RunLifecycle"))
	if err != nil {
		return Envelope{}, diagnostics, err
	}
	if _, err := validateRunLifecycleEnvelope(envelope); err != nil {
		return Envelope{}, diagnostics, err
	}
	return envelope, diagnostics, nil
}

// Only ToolInfo needs an explicit safe adapter among the standard model input
// fields: Eino gives it a custom serializer for private parameter schemas.
func safeRecorderModelTools(body any) (any, []Diagnostic) {
	var tools []*schema.ToolInfo
	var withoutTools any
	switch input := body.(type) {
	case ComponentModelInputBody:
		tools = input.Tools
		input.Tools = nil
		withoutTools = input
	case ComponentAgenticModelInputBody:
		tools = input.Tools
		input.Tools = nil
		withoutTools = input
	default:
		return body, nil
	}
	if len(tools) == 0 {
		return body, nil
	}
	budget := 100000
	cloned, err := clonePlainJSON(reflect.ValueOf(withoutTools), 0, &budget)
	if err != nil {
		return body, nil
	}
	values := make([]any, len(tools))
	var diagnostics []Diagnostic
	for index, tool := range tools {
		var nested []Diagnostic
		values[index], nested = safeRecorderToolInfo(tool, fmt.Sprintf("/payload/body/tools/%d", index))
		diagnostics = append(diagnostics, nested...)
	}
	cloned.(map[string]any)["tools"] = values
	return cloned, diagnostics
}
