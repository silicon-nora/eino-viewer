package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/cloudwego/eino/callbacks"
	toolcomponent "github.com/cloudwego/eino/components/tool"
)

func TestSafeComponentIOFallbackStillRedactsIdentity(t *testing.T) {
	for _, value := range []any{strings.Repeat("large", 1000), func() {}} {
		envelope, diagnostics, err := safeComponentIO(context.Background(), &callbacks.RunInfo{Name: "PRIVATE_CALLBACK_NAME", Component: "Lambda"}, ComponentIOInput, false, value, "root", EnvelopeOptions{Policy: ProjectionPolicy{MaxDocumentBytes: 900, Redact: func(path []string, value any) (any, bool) {
			if path[len(path)-1] == "name" {
				return "anonymous", true
			}
			return nil, false
		}}})
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(envelope)
		if strings.Contains(string(encoded), "PRIVATE_CALLBACK_NAME") {
			t.Fatal("fallback restored private identity")
		}
		if graphIOPayload(t, envelope)["name"] != "anonymous" {
			t.Fatal("redaction not retained")
		}
		if captureCompleteness(nil, diagnostics) != "partial" {
			t.Fatal("omission not partial")
		}
	}
}

func TestSafeComponentIORedactorCannotIntroduceRuntimeSerialization(t *testing.T) {
	var calls recorderAtomicCounter
	for _, target := range []string{"payload", "metadata"} {
		t.Run(target, func(t *testing.T) {
			envelope, _, _ := safeComponentIO(context.Background(), &callbacks.RunInfo{Component: "Lambda"}, ComponentIOInput, false, "original", "root", EnvelopeOptions{Metadata: map[string]any{"secret": "original"}, Policy: ProjectionPolicy{Redact: func(path []string, value any) (any, bool) {
				if strings.Join(path, "/") == target+"/"+map[string]string{"payload": "body", "metadata": "secret"}[target] {
					return graphIOForbiddenMarshaler{&calls}, true
				}
				return nil, false
			}}})
			if calls.Load() != 0 {
				t.Fatal("redactor replacement MarshalJSON was executed")
			}
			if len(envelope.Payload) > 0 && strings.Contains(string(envelope.Payload), `"body"`) {
				t.Fatal("unsafe redactor replacement retained")
			}
		})
	}
}

func TestSafeComponentIOPlainJSONSubsetPreservesOrRejects(t *testing.T) {
	type empty struct{}
	type basic struct {
		Empty empty   `json:"empty,omitempty"`
		Ratio float32 `json:"ratio"`
		Bytes []byte  `json:"bytes"`
		Null  *string `json:"null"`
	}
	value := basic{Ratio: 0.1, Bytes: []byte{1, 2, 3}}
	budget := 100000
	cloned, err := clonePlainJSON(reflect.ValueOf(value), 0, &budget)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(value)
	got, _ := json.Marshal(cloned)
	var wantJSON, gotJSON any
	json.Unmarshal(want, &wantJSON)
	json.Unmarshal(got, &gotJSON)
	if !reflect.DeepEqual(wantJSON, gotJSON) {
		t.Fatalf("plain snapshot changed JSON semantics: want=%s got=%s", want, got)
	}
	duplicateType := reflect.StructOf([]reflect.StructField{
		{Name: "A", Type: reflect.TypeOf(""), Tag: `json:"same"`},
		{Name: "B", Type: reflect.TypeOf(""), Tag: `json:"same"`},
	})
	duplicate := reflect.New(duplicateType).Elem().Interface()
	for name, value := range map[string]any{"number": json.Number("123"), "duplicate": duplicate, "nonfinite": math.Inf(-1), "oversized-bytes": make([]byte, DefaultMaxDocumentBytes*4+1)} {
		t.Run(name, func(t *testing.T) {
			budget := 100000
			if _, err := clonePlainJSON(reflect.ValueOf(value), 0, &budget); err == nil {
				t.Fatal("unsafe/ambiguous value accepted")
			}
		})
	}
}

func TestSafeComponentIONilAndPanickingPolicy(t *testing.T) {
	if _, _, err := safeComponentIO(context.Background(), nil, ComponentIOInput, false, "input", "root", EnvelopeOptions{}); err == nil {
		t.Fatal("nil callback info accepted")
	}
	// A misconfigured redactor cannot panic through the application's callback.
	_, _, err := safeComponentIO(context.Background(), &callbacks.RunInfo{Component: "Lambda"}, ComponentIOInput, false, "input", "root", EnvelopeOptions{Policy: ProjectionPolicy{Redact: func([]string, any) (any, bool) { panic("policy failure") }}})
	if err == nil {
		t.Fatal("policy failure not surfaced as capture error")
	}
}

func TestSafeComponentIOEmptyToolResponse(t *testing.T) {
	envelope, _, err := safeComponentIO(context.Background(), &callbacks.RunInfo{Component: "Tool"}, ComponentIOOutput, false, &toolcomponent.CallbackOutput{Response: ""}, "node", EnvelopeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	body := graphIOPayload(t, envelope)["body"].(map[string]any)
	if value, exists := body["response"]; !exists || value != "" {
		t.Fatal("observed empty tool response lost")
	}
}

func TestGraphIOLiteralNullInputOutput(t *testing.T) {
	record, _, err := graphIORecord(t, "literal-null", nil, func(context.Context, any) (any, error) { return nil, nil }, ProjectionPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	for _, envelope := range record.Evidence {
		if envelope.Kind != ComponentIOKind {
			continue
		}
		body, present := graphIOPayload(t, envelope)["body"]
		if !present || body != nil {
			t.Fatal("literal nil input/output lost")
		}
	}
}
