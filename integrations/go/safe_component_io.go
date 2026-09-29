package einoworkflowsnapshot

import (
	"context"
	"encoding"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/schema"
)

// safeComponentIO snapshots plain JSON data before running the redactor and
// before serialization. In particular it never invokes application MarshalJSON
// methods. Unsupported or oversized bodies retain identity and omission facts.
func safeComponentIO(ctx context.Context, info *callbacks.RunInfo, direction ComponentIODirection, streaming bool, value any, scope string, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if info == nil || info.Component == "" {
		return Envelope{}, nil, ErrInvalidEnvelope
	}
	address := callbackAddressFromContext(ctx)
	payload := map[string]any{
		"direction": string(direction), "streaming": streaming,
		"component": string(info.Component), "format": componentFormat(info.Component, direction),
		"address": address,
	}
	if info.Name != "" {
		payload["name"] = info.Name
	}
	if info.Type != "" {
		payload["type"] = info.Type
	}
	if path := callbackNodePath(address); len(path) > 0 {
		payload["nodePath"] = path
	}
	options.Correlation = cloneStringMap(options.Correlation)
	if options.Correlation == nil {
		options.Correlation = map[string]string{}
	}
	if id := callbackAddressID(address); id != "" {
		options.Correlation["entityId"] = id
	}
	if id := callbackAddressID(address[:max(0, len(address)-1)]); id != "" {
		options.Correlation["parentEntityId"] = id
	}
	var diagnostics []Diagnostic
	reason := ""
	if streaming {
		reason = "stream_not_consumed"
		payload["format"] = componentFormat(info.Component, direction) + "Stream"
	} else {
		body := value
		// Root Graph/Workflow values and Lambda bodies are application data.
		// Official component callbacks still use their existing normalization.
		if scope != "root" && string(info.Component) != "Lambda" {
			var err error
			var format string
			body, format, diagnostics, err = projectOfficialComponentBody(info.Component, direction, value)
			if format != "" {
				payload["format"] = format
			}
			if err != nil {
				reason = "unsupported_value"
			}
			var toolDiagnostics []Diagnostic
			body, toolDiagnostics = safeRecorderModelTools(body)
			diagnostics = append(diagnostics, toolDiagnostics...)
			// The general legacy codec's optional Response field omits "".
			// Safe recording preserves this observed empty tool result too.
			if output, ok := body.(ComponentToolOutputBody); ok {
				body = map[string]any{"response": output.Response}
				if output.ToolOutput != nil {
					body.(map[string]any)["toolOutput"] = output.ToolOutput
				}
				if len(output.Extra) > 0 {
					body.(map[string]any)["extra"] = output.Extra
				}
			}
		}
		if reason == "" {
			payload["body"] = body
		}
	}
	options = withSourceDefaults(options, "components", payload["format"].(string))
	budget := 100000
	cloned, err := clonePlainJSON(reflect.ValueOf(payload), 0, &budget)
	if err != nil {
		reason = "unsupported_value"
	}
	redacted := false
	if reason == "" && options.Policy.Redact != nil {
		var redactionDiagnostics []Diagnostic
		cloned, redactionDiagnostics, err = redactPlainJSON(cloned, []string{"payload"}, options.Policy.Redact)
		diagnostics = append(diagnostics, redactionDiagnostics...)
		redacted = len(redactionDiagnostics) > 0
		budget = 100000
		if err == nil {
			cloned, err = clonePlainJSON(reflect.ValueOf(cloned), 0, &budget)
		}
		if err != nil {
			reason = "unsupported_value"
		}
	}
	// The policy has already seen a defensive plain-data copy. Never run it
	// again on this envelope or on recorder-owned capture metadata.
	finalOptions := options
	finalOptions.Policy.Redact = nil
	metadata := map[string]any{"io": map[string]any{"scope": scope}, "capture": map[string]any{"status": "captured"}}
	if redacted {
		metadata["capture"].(map[string]any)["redacted"] = true
	}
	// Preserve user metadata only after the same safe copy/redaction boundary.
	if options.Metadata != nil {
		budget = 100000
		userMetadata, metadataErr := clonePlainJSON(reflect.ValueOf(options.Metadata), 0, &budget)
		if metadataErr == nil && options.Policy.Redact != nil {
			var nested []Diagnostic
			userMetadata, nested, metadataErr = redactPlainJSON(userMetadata, []string{"metadata"}, options.Policy.Redact)
			diagnostics = append(diagnostics, nested...)
		}
		if metadataErr == nil {
			budget = 100000
			userMetadata, metadataErr = clonePlainJSON(reflect.ValueOf(userMetadata), 0, &budget)
		}
		if fields, ok := userMetadata.(map[string]any); ok {
			for key, value := range fields {
				if key != "io" && key != "capture" {
					metadata[key] = value
				}
			}
		} else if metadataErr != nil || userMetadata != nil {
			reason = "unsupported_value"
		}
	}
	finalOptions.Metadata = metadata
	if reason == "" {
		limit, limitErr := policyLimit(options.Policy)
		if limitErr != nil {
			return Envelope{}, diagnostics, limitErr
		}
		remaining := limit
		if !plainJSONFits(cloned, &remaining) || !plainJSONFits(metadata, &remaining) {
			reason = "size_limit"
		}
	}
	if reason == "" {
		envelope, nested, projectionErr := NewEnvelope(ComponentIOKind, ComponentIOKindVersion, cloned, finalOptions)
		diagnostics = append(diagnostics, nested...)
		if projectionErr == nil {
			return envelope, diagnostics, nil
		}
		if errors.Is(projectionErr, ErrDocumentTooLarge) {
			reason = "size_limit"
		} else {
			reason = "unsupported_value"
		}
	}
	// Do not retain the rejected value or stringify its error: either may carry
	// secrets. A metadata-only envelope still identifies this exact callback.
	delete(payload, "body")
	// Apply the identity-field policy on the fallback too. Never restore a
	// previously redacted name just because its body exceeded the size limit.
	budget = 100000
	fallbackPayload, err := clonePlainJSON(reflect.ValueOf(payload), 0, &budget)
	if err != nil {
		return Envelope{}, diagnostics, ErrUnsafeJSON
	}
	if options.Policy.Redact != nil {
		var nested []Diagnostic
		fallbackPayload, nested, err = redactPlainJSON(fallbackPayload, []string{"payload"}, options.Policy.Redact)
		diagnostics = append(diagnostics, nested...)
		redacted = redacted || len(nested) > 0
		if err != nil {
			return Envelope{}, diagnostics, ErrUnsafeJSON
		}
		budget = 100000
		fallbackPayload, err = clonePlainJSON(reflect.ValueOf(fallbackPayload), 0, &budget)
		if err != nil {
			return Envelope{}, diagnostics, ErrUnsafeJSON
		}
	}
	code := "projection.body_omitted"
	if reason == "stream_not_consumed" {
		code = "projection.stream_omitted"
	}
	diagnostics = append(diagnostics, Diagnostic{Severity: "warning", Code: code, Path: "/payload/body", Message: "Component body omitted: " + reason + "."})
	metadata = map[string]any{"io": map[string]any{"scope": scope}, "capture": map[string]any{"status": "omitted", "reason": reason}}
	if redacted {
		metadata["capture"].(map[string]any)["redacted"] = true
	}
	finalOptions.Metadata = metadata
	// Body limits must not discard identity, lifecycle, or omission evidence.
	finalOptions.Policy.MaxDocumentBytes = 0
	remaining := DefaultMaxDocumentBytes
	if !plainJSONFits(fallbackPayload, &remaining) || !plainJSONFits(metadata, &remaining) {
		return Envelope{}, diagnostics, ErrDocumentTooLarge
	}
	returnEnvelope, nested, fallbackErr := NewEnvelope(ComponentIOKind, ComponentIOKindVersion, fallbackPayload, finalOptions)
	return returnEnvelope, append(diagnostics, nested...), fallbackErr
}

var jsonMarshalerType = reflect.TypeOf((*json.Marshaler)(nil)).Elem()
var textMarshalerType = reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()

func redactPlainJSON(value any, path []string, redact Redactor) (result any, diagnostics []Diagnostic, err error) {
	defer func() {
		if recover() != nil {
			result = nil
			err = ErrUnsafeJSON
		}
	}()
	result, diagnostics = redactJSON(value, path, redact)
	return
}

// clonePlainJSON deliberately implements a conservative subset of encoding/json:
// plain exported struct fields (JSON names/omitempty), string-keyed maps, slices,
// scalar values and pointers. Runtime values, custom marshalers, anonymous
// fields and unusual tag options are omitted instead of executing user code or
// silently changing their JSON meaning. Depth/work bounds also reject cycles.
func clonePlainJSON(value reflect.Value, depth int, budget *int) (any, error) {
	*budget--
	if depth > 64 || *budget < 0 {
		return nil, ErrUnsafeJSON
	}
	if !value.IsValid() {
		return nil, nil
	}
	if value.Kind() == reflect.Interface {
		if value.IsNil() {
			return nil, nil
		}
		return clonePlainJSON(value.Elem(), depth+1, budget)
	}
	// encoding/json treats nil pointers as null without calling MarshalJSON.
	if value.Kind() == reflect.Pointer && value.IsNil() {
		return nil, nil
	}
	// Eino ToolInfo is a known custom-serialized public type. With no private
	// parameter schema its complete JSON shape is just these exported fields;
	// preserve that shape directly, never invoke the serializer. ParamsOneOf
	// requires an explicit omission-aware adapter at the enclosing boundary.
	if value.Type() == reflect.TypeOf((*schema.ToolInfo)(nil)) && value.CanInterface() {
		tool := value.Interface().(*schema.ToolInfo)
		if tool.ParamsOneOf != nil {
			return nil, ErrUnsafeJSON
		}
		payload, _ := safeRecorderToolInfo(tool, "/payload")
		return clonePlainJSON(reflect.ValueOf(payload), depth+1, budget)
	}
	if value.Type().Implements(jsonMarshalerType) || reflect.PointerTo(value.Type()).Implements(jsonMarshalerType) ||
		value.Type().Implements(textMarshalerType) || reflect.PointerTo(value.Type()).Implements(textMarshalerType) {
		return nil, ErrUnsafeJSON
	}
	if value.Type() == reflect.TypeOf(json.Number("")) {
		return nil, ErrUnsafeJSON
	}
	switch value.Kind() {
	case reflect.Pointer:
		if value.IsNil() {
			return nil, nil
		}
		return clonePlainJSON(value.Elem(), depth+1, budget)
	case reflect.Bool:
		return value.Bool(), nil
	case reflect.String:
		return value.String(), nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return value.Int(), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return value.Uint(), nil
	case reflect.Float32, reflect.Float64:
		if math.IsNaN(value.Float()) || math.IsInf(value.Float(), 0) {
			return nil, ErrUnsafeJSON
		}
		if value.Kind() == reflect.Float32 {
			return float32(value.Float()), nil
		}
		return value.Float(), nil
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String {
			return nil, ErrUnsafeJSON
		}
		if value.IsNil() {
			return nil, nil
		}
		if value.Len() > *budget {
			return nil, ErrUnsafeJSON
		}
		result := map[string]any{}
		keys := value.MapKeys()
		sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
		for _, key := range keys {
			child, err := clonePlainJSON(value.MapIndex(key), depth+1, budget)
			if err != nil {
				return nil, err
			}
			result[key.String()] = child
		}
		return result, nil
	case reflect.Array, reflect.Slice:
		if value.Kind() == reflect.Slice && value.IsNil() {
			return nil, nil
		}
		// []byte has base64 JSON semantics, not an integer array.
		if value.Kind() == reflect.Slice && value.Type().Elem().Kind() == reflect.Uint8 {
			// This pre-redaction copy has its own hard allocation bound. Body
			// limits still apply after redaction, so moderately oversized secrets
			// can be replaced without being serialized first.
			if value.Len() > DefaultMaxDocumentBytes*4 {
				return nil, ErrUnsafeJSON
			}
			// Charge copied bytes against the shared traversal budget too, so
			// many independently small blobs cannot multiply memory without bound.
			*budget -= (value.Len() + 255) / 256
			if *budget < 0 {
				return nil, ErrUnsafeJSON
			}
			result := make([]byte, value.Len())
			for index := range result {
				result[index] = byte(value.Index(index).Uint())
			}
			return result, nil
		}
		if value.Len() > *budget {
			return nil, ErrUnsafeJSON
		}
		result := make([]any, value.Len())
		for index := range result {
			child, err := clonePlainJSON(value.Index(index), depth+1, budget)
			if err != nil {
				return nil, err
			}
			result[index] = child
		}
		return result, nil
	case reflect.Struct:
		result := map[string]any{}
		seen := map[string]bool{}
		for index := 0; index < value.NumField(); index++ {
			field := value.Type().Field(index)
			if field.PkgPath != "" {
				continue
			}
			tag := strings.Split(field.Tag.Get("json"), ",")
			if tag[0] == "-" {
				continue
			}
			if field.Anonymous {
				return nil, ErrUnsafeJSON
			}
			name := tag[0]
			if name == "" {
				name = field.Name
			}
			if seen[name] {
				return nil, ErrUnsafeJSON
			}
			seen[name] = true
			omit := false
			for _, option := range tag[1:] {
				if option != "omitempty" {
					return nil, ErrUnsafeJSON
				}
				child := value.Field(index)
				switch child.Kind() {
				case reflect.Array, reflect.Slice, reflect.Map, reflect.String:
					omit = child.Len() == 0
				case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64, reflect.Interface, reflect.Pointer:
					omit = child.IsZero()
				}
			}
			if omit {
				continue
			}
			child, err := clonePlainJSON(value.Field(index), depth+1, budget)
			if err != nil {
				return nil, err
			}
			result[name] = child
		}
		return result, nil
	default:
		return nil, fmt.Errorf("%w: unsupported data kind", ErrUnsafeJSON)
	}
}

// Bound the serialization allocation before encoding. This is a lower bound
// (escaping and envelope overhead are checked by NewEnvelope afterward), so it
// never truncates a value or changes JSON semantics.
func plainJSONFits(value any, remaining *int) bool {
	*remaining -= 2
	if *remaining < 0 {
		return false
	}
	switch typed := value.(type) {
	case string:
		*remaining -= len(typed)
	case []byte:
		*remaining -= (len(typed) + 2) / 3 * 4
	case map[string]any:
		for key, child := range typed {
			*remaining -= len(key) + 3
			if !plainJSONFits(child, remaining) {
				return false
			}
		}
	case []any:
		for _, child := range typed {
			if !plainJSONFits(child, remaining) {
				return false
			}
		}
	}
	return *remaining >= 0
}
