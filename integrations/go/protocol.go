package einoworkflowsnapshot

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const (
	EinoDAGProtocol         = "eino-dag"
	EinoDAGProtocolVersion  = 1
	DefaultMaxDocumentBytes = 4 << 20
)

var (
	ErrInvalidEnvelope  = errors.New("eino dag protocol: invalid envelope")
	ErrUnsafeJSON       = errors.New("eino dag protocol: unsafe JSON value")
	ErrDocumentTooLarge = errors.New("eino dag protocol: document exceeds size limit")
)

// Envelope carries one independently versioned Eino information domain.
// Payload and Metadata contain validated raw JSON so marshaling the envelope
// preserves their JSON representation instead of base64-encoding it.
type Envelope struct {
	Protocol        string            `json:"protocol"`
	ProtocolVersion int               `json:"protocolVersion"`
	Kind            string            `json:"kind"`
	KindVersion     int               `json:"kindVersion"`
	Payload         json.RawMessage   `json:"payload"`
	Source          map[string]string `json:"source,omitempty"`
	Correlation     map[string]string `json:"correlation,omitempty"`
	ObservedAtMS    *int64            `json:"observedAtMs,omitempty"`
	Metadata        json.RawMessage   `json:"metadata,omitempty"`
}

type Diagnostic struct {
	Severity  string `json:"severity"`
	Code      string `json:"code"`
	Path      string `json:"path"`
	Message   string `json:"message"`
	AdapterID string `json:"adapterId,omitempty"`
}

// Redactor can replace a JSON value before it enters an envelope. Path starts
// with "payload" or "metadata" and then contains object keys or array indexes.
// Returning true records a warning diagnostic and skips traversal below the
// replacement value.
type Redactor func(path []string, value any) (replacement any, redact bool)

type ProjectionPolicy struct {
	// MaxDocumentBytes limits both intermediate domain JSON and the final
	// envelope. Zero selects DefaultMaxDocumentBytes.
	MaxDocumentBytes int
	Redact           Redactor
}

type EnvelopeOptions struct {
	Source       map[string]string
	Correlation  map[string]string
	ObservedAtMS *int64
	Metadata     any
	Policy       ProjectionPolicy
}

// NewEnvelope safely projects payload and optional metadata into JSON and
// constructs a protocol-version-1 envelope.
func NewEnvelope(kind string, kindVersion int, payload any, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if strings.TrimSpace(kind) == "" {
		return Envelope{}, nil, fmt.Errorf("%w: kind must be non-empty", ErrInvalidEnvelope)
	}
	if kindVersion < 1 {
		return Envelope{}, nil, fmt.Errorf("%w: kindVersion must be positive", ErrInvalidEnvelope)
	}
	if err := validateStringMap("source", options.Source, true); err != nil {
		return Envelope{}, nil, err
	}
	if err := validateStringMap("correlation", options.Correlation, false); err != nil {
		return Envelope{}, nil, err
	}
	if options.ObservedAtMS != nil && *options.ObservedAtMS < 0 {
		return Envelope{}, nil, fmt.Errorf("%w: observedAtMs must be non-negative", ErrInvalidEnvelope)
	}

	limit, err := policyLimit(options.Policy)
	if err != nil {
		return Envelope{}, nil, err
	}
	payloadJSON, diagnostics, err := projectJSON(payload, []string{"payload"}, options.Policy, limit)
	if err != nil {
		return Envelope{}, diagnostics, err
	}

	var metadataJSON json.RawMessage
	if options.Metadata != nil {
		var metadataDiagnostics []Diagnostic
		metadataJSON, metadataDiagnostics, err = projectJSON(
			options.Metadata,
			[]string{"metadata"},
			options.Policy,
			limit,
		)
		diagnostics = append(diagnostics, metadataDiagnostics...)
		if err != nil {
			return Envelope{}, diagnostics, err
		}
		if !isJSONObjectOrNull(metadataJSON) {
			return Envelope{}, diagnostics, fmt.Errorf("%w: metadata must be a JSON object or null", ErrInvalidEnvelope)
		}
	}

	envelope := Envelope{
		Protocol:        EinoDAGProtocol,
		ProtocolVersion: EinoDAGProtocolVersion,
		Kind:            kind,
		KindVersion:     kindVersion,
		Payload:         payloadJSON,
		Source:          cloneStringMap(options.Source),
		Correlation:     cloneStringMap(options.Correlation),
		ObservedAtMS:    cloneInt64(options.ObservedAtMS),
		Metadata:        metadataJSON,
	}
	if err := ValidateEnvelope(envelope); err != nil {
		return Envelope{}, diagnostics, err
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return Envelope{}, diagnostics, fmt.Errorf("%w: %v", ErrUnsafeJSON, err)
	}
	if len(encoded) > limit {
		return Envelope{}, diagnostics, fmt.Errorf(
			"%w: %d bytes exceeds %d",
			ErrDocumentTooLarge,
			len(encoded),
			limit,
		)
	}
	return envelope, diagnostics, nil
}

// ValidateEnvelope checks an already decoded envelope without interpreting its
// domain payload.
func ValidateEnvelope(envelope Envelope) error {
	if envelope.Protocol != EinoDAGProtocol {
		return fmt.Errorf("%w: protocol must be %q", ErrInvalidEnvelope, EinoDAGProtocol)
	}
	if envelope.ProtocolVersion != EinoDAGProtocolVersion {
		return fmt.Errorf("%w: unsupported protocolVersion %d", ErrInvalidEnvelope, envelope.ProtocolVersion)
	}
	if strings.TrimSpace(envelope.Kind) == "" || envelope.KindVersion < 1 {
		return fmt.Errorf("%w: kind and kindVersion are required", ErrInvalidEnvelope)
	}
	if len(envelope.Payload) == 0 || !json.Valid(envelope.Payload) {
		return fmt.Errorf("%w: payload must contain valid JSON", ErrInvalidEnvelope)
	}
	if err := validateStringMap("source", envelope.Source, true); err != nil {
		return err
	}
	if err := validateStringMap("correlation", envelope.Correlation, false); err != nil {
		return err
	}
	if envelope.ObservedAtMS != nil && *envelope.ObservedAtMS < 0 {
		return fmt.Errorf("%w: observedAtMs must be non-negative", ErrInvalidEnvelope)
	}
	if len(envelope.Metadata) > 0 && !isJSONObjectOrNull(envelope.Metadata) {
		return fmt.Errorf("%w: metadata must be a JSON object or null", ErrInvalidEnvelope)
	}
	return nil
}

// ParseEnvelope decodes a strict protocol document. Unknown top-level fields
// and documents above the default size limit are rejected.
func ParseEnvelope(data []byte) (Envelope, error) {
	if len(data) > DefaultMaxDocumentBytes {
		return Envelope{}, fmt.Errorf(
			"%w: %d bytes exceeds %d",
			ErrDocumentTooLarge,
			len(data),
			DefaultMaxDocumentBytes,
		)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var envelope Envelope
	if err := decoder.Decode(&envelope); err != nil {
		return Envelope{}, fmt.Errorf("%w: %v", ErrInvalidEnvelope, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return Envelope{}, fmt.Errorf("%w: multiple JSON values", ErrInvalidEnvelope)
	} else if !errors.Is(err, io.EOF) {
		return Envelope{}, fmt.Errorf("%w: %v", ErrInvalidEnvelope, err)
	}
	if err := ValidateEnvelope(envelope); err != nil {
		return Envelope{}, err
	}
	return envelope, nil
}

func policyLimit(policy ProjectionPolicy) (int, error) {
	if policy.MaxDocumentBytes < 0 {
		return 0, fmt.Errorf("%w: MaxDocumentBytes must not be negative", ErrInvalidEnvelope)
	}
	if policy.MaxDocumentBytes == 0 {
		return DefaultMaxDocumentBytes, nil
	}
	return policy.MaxDocumentBytes, nil
}

func projectJSON(value any, path []string, policy ProjectionPolicy, limit int) (json.RawMessage, []Diagnostic, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, nil, fmt.Errorf("%w at %s: %v", ErrUnsafeJSON, jsonPointer(path), err)
	}
	if len(encoded) > limit {
		return nil, nil, fmt.Errorf(
			"%w at %s: %d bytes exceeds %d",
			ErrDocumentTooLarge,
			jsonPointer(path),
			len(encoded),
			limit,
		)
	}
	if policy.Redact == nil {
		return append(json.RawMessage(nil), encoded...), nil, nil
	}

	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, nil, fmt.Errorf("%w at %s: %v", ErrUnsafeJSON, jsonPointer(path), err)
	}
	redacted, diagnostics := redactJSON(decoded, path, policy.Redact)
	encoded, err = json.Marshal(redacted)
	if err != nil {
		return nil, diagnostics, fmt.Errorf("%w at %s after redaction: %v", ErrUnsafeJSON, jsonPointer(path), err)
	}
	if len(encoded) > limit {
		return nil, diagnostics, fmt.Errorf(
			"%w at %s after redaction: %d bytes exceeds %d",
			ErrDocumentTooLarge,
			jsonPointer(path),
			len(encoded),
			limit,
		)
	}
	return encoded, diagnostics, nil
}

func redactJSON(value any, path []string, redact Redactor) (any, []Diagnostic) {
	replacement, redacted := redact(append([]string(nil), path...), value)
	if redacted {
		return replacement, []Diagnostic{{
			Severity: "warning",
			Code:     "projection.redacted",
			Path:     jsonPointer(path),
			Message:  "Value was replaced by the configured redaction policy.",
		}}
	}

	var diagnostics []Diagnostic
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			next, nested := redactJSON(typed[key], appendPath(path, key), redact)
			typed[key] = next
			diagnostics = append(diagnostics, nested...)
		}
	case []any:
		for index := range typed {
			next, nested := redactJSON(
				typed[index],
				appendPath(path, fmt.Sprintf("%d", index)),
				redact,
			)
			typed[index] = next
			diagnostics = append(diagnostics, nested...)
		}
	}
	return value, diagnostics
}

func validateStringMap(name string, values map[string]string, requireSource bool) error {
	if values == nil {
		return nil
	}
	for key, value := range values {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s keys and values must be non-empty", ErrInvalidEnvelope, name)
		}
	}
	if requireSource {
		if values["module"] == "" || values["format"] == "" {
			return fmt.Errorf("%w: source requires module and format", ErrInvalidEnvelope)
		}
	}
	return nil
}

func isJSONObjectOrNull(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return json.Valid(trimmed) &&
		(bytes.Equal(trimmed, []byte("null")) || (len(trimmed) > 0 && trimmed[0] == '{'))
}

func cloneStringMap(value map[string]string) map[string]string {
	if value == nil {
		return nil
	}
	copy := make(map[string]string, len(value))
	for key, entry := range value {
		copy[key] = entry
	}
	return copy
}

func cloneInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func appendPath(path []string, segment string) []string {
	next := append([]string(nil), path...)
	return append(next, segment)
}

func jsonPointer(path []string) string {
	encoded := make([]string, len(path))
	for index, segment := range path {
		encoded[index] = strings.ReplaceAll(strings.ReplaceAll(segment, "~", "~0"), "/", "~1")
	}
	return "/" + strings.Join(encoded, "/")
}
