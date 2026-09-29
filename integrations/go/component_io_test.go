package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	documentcomponent "github.com/cloudwego/eino/components/document"
	"github.com/cloudwego/eino/components/prompt"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

type officialComponentIOCase struct {
	component components.Component
	input     any
	output    any
	inputFmt  string
	outputFmt string
}

func officialComponentIOCases() []officialComponentIOCase {
	documents := []*schema.Document{{ID: "doc-1", Content: "content"}}
	messages := []*schema.Message{{Role: schema.User, Content: "hello"}}
	agenticMessages := []*schema.AgenticMessage{{Role: schema.AgenticRoleTypeUser}}
	return []officialComponentIOCase{
		{components.ComponentOfChatModel, messages, messages[0], "model.CallbackInput", "model.CallbackOutput"},
		{components.ComponentOfAgenticModel, agenticMessages, agenticMessages[0], "model.AgenticCallbackInput", "model.AgenticCallbackOutput"},
		{components.ComponentOfPrompt, map[string]any{"name": "Ada"}, messages, "prompt.CallbackInput", "prompt.CallbackOutput"},
		{components.ComponentOfAgenticPrompt, map[string]any{"name": "Ada"}, agenticMessages, "prompt.AgenticCallbackInput", "prompt.AgenticCallbackOutput"},
		{components.ComponentOfEmbedding, []string{"hello"}, [][]float64{{0.1, 0.2}}, "embedding.CallbackInput", "embedding.CallbackOutput"},
		{components.ComponentOfIndexer, documents, []string{"doc-1"}, "indexer.CallbackInput", "indexer.CallbackOutput"},
		{components.ComponentOfRetriever, "weather", documents, "retriever.CallbackInput", "retriever.CallbackOutput"},
		{components.ComponentOfLoader, documentcomponent.Source{URI: "memory://fixture"}, documents, "document.LoaderCallbackInput", "document.LoaderCallbackOutput"},
		{components.ComponentOfTransformer, documents, documents, "document.TransformerCallbackInput", "document.TransformerCallbackOutput"},
		{components.ComponentOfTool, `{"city":"Singapore"}`, "sunny", "tool.CallbackInput", "tool.CallbackOutput"},
	}
}

func TestOfficialComponentIOProjectionMatrix(t *testing.T) {
	for _, test := range officialComponentIOCases() {
		t.Run(string(test.component), func(t *testing.T) {
			info := &callbacks.RunInfo{Name: "fixture", Type: "Fixture", Component: test.component}
			input, diagnostics, err := ProjectComponentInputEnvelope(context.Background(), info, test.input, EnvelopeOptions{})
			if err != nil || len(diagnostics) != 0 {
				t.Fatalf("input projection failed: %v %#v", err, diagnostics)
			}
			output, diagnostics, err := ProjectComponentOutputEnvelope(context.Background(), info, test.output, EnvelopeOptions{})
			if err != nil || len(diagnostics) != 0 {
				t.Fatalf("output projection failed: %v %#v", err, diagnostics)
			}
			var inputPayload, outputPayload ComponentIOPayload
			if err := json.Unmarshal(input.Payload, &inputPayload); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(output.Payload, &outputPayload); err != nil {
				t.Fatal(err)
			}
			if inputPayload.Format != test.inputFmt || outputPayload.Format != test.outputFmt {
				t.Fatalf("unexpected formats: %q %q", inputPayload.Format, outputPayload.Format)
			}
		})
	}
}

func TestComponentIOProjectionReportsLossAndCustomData(t *testing.T) {
	info := &callbacks.RunInfo{Name: "template", Component: components.ComponentOfPrompt}
	_, diagnostics, err := ProjectComponentInputEnvelope(
		context.Background(),
		info,
		&prompt.CallbackInput{
			Variables: map[string]any{"name": "Ada"},
			Templates: []schema.MessagesTemplate{schema.MessagesPlaceholder("history", true)},
		},
		EnvelopeOptions{},
	)
	if err != nil || len(diagnostics) != 1 || diagnostics[0].Code != "projection.runtime_field_omitted" {
		t.Fatalf("template omission was not reported: %v %#v", err, diagnostics)
	}

	customInfo := &callbacks.RunInfo{Name: "custom", Component: components.Component("CustomSearch")}
	envelope, diagnostics, err := ProjectComponentInputEnvelope(
		context.Background(),
		customInfo,
		map[string]any{"query": "eino"},
		EnvelopeOptions{},
	)
	if err != nil || len(diagnostics) != 1 || diagnostics[0].Code != "projection.custom_component" {
		t.Fatalf("custom component projection failed: %v %#v", err, diagnostics)
	}
	if envelope.Source["format"] != "CustomSearch.CallbackInput" {
		t.Fatalf("unexpected custom source: %#v", envelope.Source)
	}

	knownInfo := &callbacks.RunInfo{Component: components.ComponentOfEmbedding}
	if _, _, err := ProjectComponentInputEnvelope(context.Background(), knownInfo, 42, EnvelopeOptions{}); !errors.Is(err, ErrUnsupportedComponentValue) {
		t.Fatalf("expected ErrUnsupportedComponentValue, got %v", err)
	}
}

func TestComponentIOFixtureAndStreamBoundary(t *testing.T) {
	root := compose.AppendAddressSegment(context.Background(), compose.AddressSegmentRunnable, "component-catalog")
	observedAt := int64(1_789_000_000_200)
	options := EnvelopeOptions{
		Source:       map[string]string{"einoVersion": "0.9.19"},
		Correlation:  map[string]string{"runId": "run-component-catalog"},
		ObservedAtMS: &observedAt,
	}
	envelopes := make([]Envelope, 0, len(officialComponentIOCases())*2+1)
	for _, test := range officialComponentIOCases() {
		ctx := compose.AppendAddressSegment(root, compose.AddressSegmentNode, strings.ToLower(string(test.component)))
		info := &callbacks.RunInfo{
			Name:      string(test.component),
			Type:      "Fixture" + string(test.component),
			Component: test.component,
		}
		input, diagnostics, err := ProjectComponentInputEnvelope(ctx, info, test.input, options)
		if err != nil || len(diagnostics) != 0 {
			t.Fatalf("%s input projection failed: %v %#v", test.component, err, diagnostics)
		}
		output, diagnostics, err := ProjectComponentOutputEnvelope(ctx, info, test.output, options)
		if err != nil || len(diagnostics) != 0 {
			t.Fatalf("%s output projection failed: %v %#v", test.component, err, diagnostics)
		}
		envelopes = append(envelopes, input, output)
	}
	streamCtx := compose.AppendAddressSegment(root, compose.AddressSegmentNode, "embedding-stream")
	stream, diagnostics, err := ProjectComponentStreamEnvelope(
		streamCtx,
		&callbacks.RunInfo{Name: "Embedding stream", Type: "FixtureEmbedding", Component: components.ComponentOfEmbedding},
		ComponentIOOutput,
		options,
	)
	if err != nil || len(diagnostics) != 1 || diagnostics[0].Code != "projection.stream_omitted" {
		t.Fatalf("stream projection failed: %v %#v", err, diagnostics)
	}

	envelopes = append(envelopes, stream)
	actual, err := json.MarshalIndent(envelopes, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	fixturePath := filepath.Join("..", "..", "fixtures", "eino-component-io-v1.json")
	if os.Getenv("UPDATE_EINO_FIXTURES") == "1" {
		if err := os.WriteFile(fixturePath, actual, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("component IO does not match shared fixture\nactual:\n%s", actual)
	}
}
