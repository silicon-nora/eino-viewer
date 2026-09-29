package einoworkflowsnapshot

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/cloudwego/eino/schema"
)

func TestSchemaDomainEnvelopesMatchSharedFixture(t *testing.T) {
	index := 0
	message := &schema.Message{
		Role:    schema.Assistant,
		Content: "I will check the weather.",
		ToolCalls: []schema.ToolCall{{
			Index: &index,
			ID:    "call-1",
			Type:  "function",
			Function: schema.FunctionCall{
				Name:      "weather",
				Arguments: `{"city":"Singapore"}`,
			},
		}},
	}
	agenticMessage := &schema.AgenticMessage{
		Role: schema.AgenticRoleTypeAssistant,
		ContentBlocks: []*schema.ContentBlock{{
			Type: schema.ContentBlockTypeAssistantGenText,
			AssistantGenText: &schema.AssistantGenText{
				Text: "It is sunny.",
			},
		}},
	}
	tool := &schema.ToolInfo{
		Name: "weather",
		Desc: "Look up the current weather.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"city": {Type: schema.String, Desc: "City name", Required: true},
		}),
	}
	document := &schema.Document{
		ID:      "doc-1",
		Content: "Singapore weather report",
		MetaData: map[string]any{
			"source": "fixture",
			"score":  0.98,
		},
	}
	observedAt := int64(1_789_000_000_000)
	options := EnvelopeOptions{
		Source:       map[string]string{"einoVersion": "0.9.19"},
		Correlation:  map[string]string{"runId": "run-schema-1"},
		ObservedAtMS: &observedAt,
	}

	projectors := []func() (Envelope, []Diagnostic, error){
		func() (Envelope, []Diagnostic, error) { return ProjectSchemaMessageEnvelope(message, options) },
		func() (Envelope, []Diagnostic, error) {
			return ProjectSchemaAgenticMessageEnvelope(agenticMessage, options)
		},
		func() (Envelope, []Diagnostic, error) { return ProjectSchemaToolEnvelope(tool, options) },
		func() (Envelope, []Diagnostic, error) { return ProjectSchemaDocumentEnvelope(document, options) },
	}
	envelopes := make([]Envelope, 0, len(projectors))
	for _, project := range projectors {
		envelope, diagnostics, err := project()
		if err != nil {
			t.Fatal(err)
		}
		if len(diagnostics) != 0 {
			t.Fatalf("unexpected diagnostics: %#v", diagnostics)
		}
		envelopes = append(envelopes, envelope)
	}
	if envelopes[0].Source["format"] != "Message" || envelopes[3].Source["format"] != "Document" {
		t.Fatalf("source defaults were not applied: %#v", envelopes)
	}
	if options.Source["module"] != "" {
		t.Fatal("schema projection mutated caller source")
	}

	actual, err := json.MarshalIndent(envelopes, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err := os.ReadFile("../../fixtures/eino-schema-domains-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("schema domains do not match shared fixture\nactual:\n%s", actual)
	}
}

func TestSchemaDomainProjectionRejectsNilAndUnsafeExtensions(t *testing.T) {
	if _, _, err := ProjectSchemaMessageEnvelope(nil, EnvelopeOptions{}); !errors.Is(err, ErrNilSchemaValue) {
		t.Fatalf("expected ErrNilSchemaValue, got %v", err)
	}
	message := &schema.Message{Role: schema.User, Extra: map[string]any{"callback": func() {}}}
	if _, _, err := ProjectSchemaMessageEnvelope(message, EnvelopeOptions{}); !errors.Is(err, ErrUnsafeJSON) {
		t.Fatalf("expected ErrUnsafeJSON, got %v", err)
	}
}

func TestSchemaDomainProjectionAppliesRedaction(t *testing.T) {
	message := &schema.Message{Role: schema.User, Content: "secret"}
	envelope, diagnostics, err := ProjectSchemaMessageEnvelope(message, EnvelopeOptions{
		Policy: ProjectionPolicy{Redact: func(path []string, value any) (any, bool) {
			if len(path) == 2 && path[0] == "payload" && path[1] == "content" {
				return "[REDACTED]", true
			}
			return value, false
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 1 || string(envelope.Payload) == "" {
		t.Fatalf("unexpected projection: %s %#v", envelope.Payload, diagnostics)
	}
	var payload map[string]any
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["content"] != "[REDACTED]" {
		t.Fatalf("content was not redacted: %#v", payload)
	}
}
