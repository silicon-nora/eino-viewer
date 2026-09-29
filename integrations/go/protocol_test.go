package einoworkflowsnapshot

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestNewEnvelopeRedactsAndClonesContext(t *testing.T) {
	source := map[string]string{
		"module":      "schema",
		"format":      "Message",
		"einoVersion": "0.9.19",
	}
	correlation := map[string]string{"runId": "run-1", "checkpointId": "checkpoint-1"}
	envelope, diagnostics, err := NewEnvelope(
		"schema.message",
		1,
		map[string]any{
			"content": "hello",
			"secret":  "do-not-export",
		},
		EnvelopeOptions{
			Source:      source,
			Correlation: correlation,
			Metadata:    map[string]any{"owner": "example"},
			Policy: ProjectionPolicy{
				Redact: func(path []string, value any) (any, bool) {
					if reflect.DeepEqual(path, []string{"payload", "secret"}) {
						return "[REDACTED]", true
					}
					return value, false
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 1 || diagnostics[0].Code != "projection.redacted" || diagnostics[0].Path != "/payload/secret" {
		t.Fatalf("unexpected diagnostics: %#v", diagnostics)
	}
	source["module"] = "mutated"
	correlation["runId"] = "mutated"
	if envelope.Source["module"] != "schema" || envelope.Correlation["runId"] != "run-1" {
		t.Fatal("envelope context aliases caller-owned maps")
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("do-not-export")) || !bytes.Contains(encoded, []byte("[REDACTED]")) {
		t.Fatalf("redaction was not applied: %s", encoded)
	}
	parsed, err := ParseEnvelope(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Kind != "schema.message" || parsed.ProtocolVersion != 1 {
		t.Fatalf("unexpected parsed envelope: %#v", parsed)
	}
}

func TestNewEnvelopeRejectsUnsafeAndOversizedValues(t *testing.T) {
	_, _, err := NewEnvelope("custom.value", 1, map[string]any{"function": func() {}}, EnvelopeOptions{})
	if !errors.Is(err, ErrUnsafeJSON) {
		t.Fatalf("expected ErrUnsafeJSON, got %v", err)
	}
	_, _, err = NewEnvelope(
		"custom.value",
		1,
		map[string]any{"value": "too large"},
		EnvelopeOptions{Policy: ProjectionPolicy{MaxDocumentBytes: 8}},
	)
	if !errors.Is(err, ErrDocumentTooLarge) {
		t.Fatalf("expected ErrDocumentTooLarge, got %v", err)
	}
}

func TestParseEnvelopeRejectsUnknownFields(t *testing.T) {
	_, err := ParseEnvelope([]byte(`{
		"protocol":"eino-dag",
		"protocolVersion":1,
		"kind":"custom.value",
		"kindVersion":1,
		"payload":null,
		"unexpected":true
	}`))
	if !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("expected ErrInvalidEnvelope, got %v", err)
	}
}
