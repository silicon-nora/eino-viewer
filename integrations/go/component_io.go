package einoworkflowsnapshot

import (
	"context"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	documentcomponent "github.com/cloudwego/eino/components/document"
	"github.com/cloudwego/eino/components/embedding"
	"github.com/cloudwego/eino/components/indexer"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/prompt"
	"github.com/cloudwego/eino/components/retriever"
	toolcomponent "github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

const (
	ComponentIOKind        = "component.io"
	ComponentIOKindVersion = 1
)

type ComponentIODirection string

const (
	ComponentIOInput  ComponentIODirection = "input"
	ComponentIOOutput ComponentIODirection = "output"
)

var ErrUnsupportedComponentValue = errors.New("eino dag protocol: unsupported component callback value")

type ComponentIOPayload struct {
	Direction ComponentIODirection     `json:"direction"`
	Streaming bool                     `json:"streaming"`
	Component string                   `json:"component"`
	Name      string                   `json:"name,omitempty"`
	Type      string                   `json:"type,omitempty"`
	Format    string                   `json:"format"`
	Address   []CallbackAddressSegment `json:"address"`
	NodePath  []string                 `json:"nodePath,omitempty"`
	Body      any                      `json:"body,omitempty"`
}

type ComponentModelConfig struct {
	Model       string   `json:"model,omitempty"`
	MaxTokens   int      `json:"maxTokens,omitempty"`
	Temperature float32  `json:"temperature,omitempty"`
	TopP        float32  `json:"topP,omitempty"`
	Stop        []string `json:"stop,omitempty"`
}

type ComponentAgenticModelConfig struct {
	Model       string  `json:"model,omitempty"`
	MaxTokens   int     `json:"maxTokens,omitempty"`
	Temperature float32 `json:"temperature,omitempty"`
	TopP        float32 `json:"topP,omitempty"`
}

type ComponentTokenUsage struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
	CachedTokens     int `json:"cachedTokens,omitempty"`
	ReasoningTokens  int `json:"reasoningTokens,omitempty"`
}

type ComponentModelInputBody struct {
	Messages   []*schema.Message     `json:"messages"`
	Tools      []*schema.ToolInfo    `json:"tools,omitempty"`
	ToolChoice *schema.ToolChoice    `json:"toolChoice,omitempty"`
	Config     *ComponentModelConfig `json:"config,omitempty"`
	Extra      map[string]any        `json:"extra,omitempty"`
}

type ComponentModelOutputBody struct {
	Message    *schema.Message       `json:"message,omitempty"`
	Config     *ComponentModelConfig `json:"config,omitempty"`
	TokenUsage *ComponentTokenUsage  `json:"tokenUsage,omitempty"`
	Extra      map[string]any        `json:"extra,omitempty"`
}

type ComponentAgenticModelInputBody struct {
	Messages []*schema.AgenticMessage     `json:"messages"`
	Tools    []*schema.ToolInfo           `json:"tools,omitempty"`
	Config   *ComponentAgenticModelConfig `json:"config,omitempty"`
	Extra    map[string]any               `json:"extra,omitempty"`
}

type ComponentAgenticModelOutputBody struct {
	Message    *schema.AgenticMessage       `json:"message,omitempty"`
	Config     *ComponentAgenticModelConfig `json:"config,omitempty"`
	TokenUsage *ComponentTokenUsage         `json:"tokenUsage,omitempty"`
	Extra      map[string]any               `json:"extra,omitempty"`
}

type ComponentPromptInputBody struct {
	Variables map[string]any `json:"variables"`
	Extra     map[string]any `json:"extra,omitempty"`
}

type ComponentPromptOutputBody struct {
	Messages any            `json:"messages"`
	Extra    map[string]any `json:"extra,omitempty"`
}

type ComponentEmbeddingConfig struct {
	Model          string `json:"model,omitempty"`
	EncodingFormat string `json:"encodingFormat,omitempty"`
}

type ComponentEmbeddingInputBody struct {
	Texts  []string                  `json:"texts"`
	Config *ComponentEmbeddingConfig `json:"config,omitempty"`
	Extra  map[string]any            `json:"extra,omitempty"`
}

type ComponentEmbeddingOutputBody struct {
	Embeddings [][]float64               `json:"embeddings"`
	Config     *ComponentEmbeddingConfig `json:"config,omitempty"`
	TokenUsage *ComponentTokenUsage      `json:"tokenUsage,omitempty"`
	Extra      map[string]any            `json:"extra,omitempty"`
}

type ComponentDocumentsBody struct {
	Documents []*schema.Document `json:"documents"`
	Extra     map[string]any     `json:"extra,omitempty"`
}

type ComponentIndexerOutputBody struct {
	IDs   []string       `json:"ids"`
	Extra map[string]any `json:"extra,omitempty"`
}

type ComponentRetrieverInputBody struct {
	Query          string         `json:"query"`
	TopK           int            `json:"topK,omitempty"`
	Filter         string         `json:"filter,omitempty"`
	ScoreThreshold *float64       `json:"scoreThreshold,omitempty"`
	Extra          map[string]any `json:"extra,omitempty"`
}

type ComponentLoaderInputBody struct {
	URI   string         `json:"uri"`
	Extra map[string]any `json:"extra,omitempty"`
}

type ComponentLoaderOutputBody struct {
	URI       string             `json:"uri,omitempty"`
	Documents []*schema.Document `json:"documents"`
	Extra     map[string]any     `json:"extra,omitempty"`
}

type ComponentToolInputBody struct {
	ArgumentsJSON string         `json:"argumentsJson"`
	Extra         map[string]any `json:"extra,omitempty"`
}

type ComponentToolOutputBody struct {
	Response   string             `json:"response,omitempty"`
	ToolOutput *schema.ToolResult `json:"toolOutput,omitempty"`
	Extra      map[string]any     `json:"extra,omitempty"`
}

func ProjectComponentInputEnvelope(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	return projectComponentIOEnvelope(ctx, info, ComponentIOInput, false, input, options)
}

func ProjectComponentOutputEnvelope(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	return projectComponentIOEnvelope(ctx, info, ComponentIOOutput, false, output, options)
}

// ProjectComponentStreamEnvelope records only stream metadata. It accepts no
// reader by design, so projection cannot consume or close caller-owned data.
func ProjectComponentStreamEnvelope(ctx context.Context, info *callbacks.RunInfo, direction ComponentIODirection, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	return projectComponentIOEnvelope(ctx, info, direction, true, nil, options)
}

func MarshalComponentInputEnvelope(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectComponentInputEnvelope(ctx, info, input, options))
}

func MarshalComponentOutputEnvelope(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectComponentOutputEnvelope(ctx, info, output, options))
}

func MarshalComponentStreamEnvelope(ctx context.Context, info *callbacks.RunInfo, direction ComponentIODirection, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectComponentStreamEnvelope(ctx, info, direction, options))
}

func projectComponentIOEnvelope(ctx context.Context, info *callbacks.RunInfo, direction ComponentIODirection, streaming bool, value any, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if info == nil || info.Component == "" {
		return Envelope{}, nil, fmt.Errorf("%w: callback RunInfo component is required", ErrInvalidEnvelope)
	}
	if direction != ComponentIOInput && direction != ComponentIOOutput {
		return Envelope{}, nil, fmt.Errorf("%w: unsupported component direction %q", ErrInvalidEnvelope, direction)
	}

	var body any
	var format string
	var diagnostics []Diagnostic
	var err error
	if streaming {
		format = componentFormat(info.Component, direction) + "Stream"
		diagnostics = append(diagnostics, Diagnostic{
			Severity: "warning",
			Code:     "projection.stream_omitted",
			Path:     "/payload/body",
			Message:  "Live component stream was not consumed; only callback metadata was projected.",
		})
	} else {
		body, format, diagnostics, err = projectOfficialComponentBody(info.Component, direction, value)
		if err != nil {
			return Envelope{}, diagnostics, err
		}
	}

	address := callbackAddressFromContext(ctx)
	payload := ComponentIOPayload{
		Direction: direction,
		Streaming: streaming,
		Component: string(info.Component),
		Name:      info.Name,
		Type:      info.Type,
		Format:    format,
		Address:   address,
		NodePath:  callbackNodePath(address),
		Body:      body,
	}
	options = withSourceDefaults(options, "components", format)
	options.Correlation = cloneStringMap(options.Correlation)
	if options.Correlation == nil {
		options.Correlation = make(map[string]string)
	}
	if entityID := callbackAddressID(address); entityID != "" && options.Correlation["entityId"] == "" {
		options.Correlation["entityId"] = entityID
	}
	if parentID := callbackAddressID(address[:max(0, len(address)-1)]); parentID != "" && options.Correlation["parentEntityId"] == "" {
		options.Correlation["parentEntityId"] = parentID
	}

	envelope, envelopeDiagnostics, err := NewEnvelope(ComponentIOKind, ComponentIOKindVersion, payload, options)
	diagnostics = append(diagnostics, envelopeDiagnostics...)
	return envelope, diagnostics, err
}

func callbackAddressFromContext(ctx context.Context) []CallbackAddressSegment {
	if ctx == nil {
		return []CallbackAddressSegment{}
	}
	return callbackAddress(compose.GetCurrentAddress(ctx))
}

func projectOfficialComponentBody(component components.Component, direction ComponentIODirection, value any) (any, string, []Diagnostic, error) {
	if direction == ComponentIOInput {
		return projectOfficialComponentInput(component, value)
	}
	return projectOfficialComponentOutput(component, value)
}

func projectOfficialComponentInput(component components.Component, value any) (any, string, []Diagnostic, error) {
	switch component {
	case components.ComponentOfChatModel:
		input := model.ConvCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentModelInputBody{input.Messages, input.Tools, input.ToolChoice, projectModelConfig(input.Config), input.Extra}, "model.CallbackInput", nil, nil
	case components.ComponentOfAgenticModel:
		input := model.ConvAgenticCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentAgenticModelInputBody{input.Messages, input.Tools, projectAgenticModelConfig(input.Config), input.Extra}, "model.AgenticCallbackInput", nil, nil
	case components.ComponentOfPrompt:
		input := prompt.ConvCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentPromptInputBody{input.Variables, input.Extra}, "prompt.CallbackInput", omittedTemplates(len(input.Templates)), nil
	case components.ComponentOfAgenticPrompt:
		input := prompt.ConvAgenticCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentPromptInputBody{input.Variables, input.Extra}, "prompt.AgenticCallbackInput", omittedTemplates(len(input.Templates)), nil
	case components.ComponentOfEmbedding:
		input := embedding.ConvCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentEmbeddingInputBody{input.Texts, projectEmbeddingConfig(input.Config), input.Extra}, "embedding.CallbackInput", nil, nil
	case components.ComponentOfIndexer:
		input := indexer.ConvCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentDocumentsBody{input.Docs, input.Extra}, "indexer.CallbackInput", nil, nil
	case components.ComponentOfRetriever:
		input := retriever.ConvCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentRetrieverInputBody{input.Query, input.TopK, input.Filter, input.ScoreThreshold, input.Extra}, "retriever.CallbackInput", nil, nil
	case components.ComponentOfLoader:
		input := documentcomponent.ConvLoaderCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentLoaderInputBody{input.Source.URI, input.Extra}, "document.LoaderCallbackInput", nil, nil
	case components.ComponentOfTransformer:
		input := documentcomponent.ConvTransformerCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentDocumentsBody{input.Input, input.Extra}, "document.TransformerCallbackInput", nil, nil
	case components.ComponentOfTool:
		input := toolcomponent.ConvCallbackInput(value)
		if input == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOInput, value)
		}
		return ComponentToolInputBody{input.ArgumentsInJSON, input.Extra}, "tool.CallbackInput", nil, nil
	default:
		return projectCustomComponentBody(component, ComponentIOInput, value)
	}
}

func projectOfficialComponentOutput(component components.Component, value any) (any, string, []Diagnostic, error) {
	switch component {
	case components.ComponentOfChatModel:
		output := model.ConvCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentModelOutputBody{output.Message, projectModelConfig(output.Config), projectModelTokenUsage(output.TokenUsage), output.Extra}, "model.CallbackOutput", nil, nil
	case components.ComponentOfAgenticModel:
		output := model.ConvAgenticCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentAgenticModelOutputBody{output.Message, projectAgenticModelConfig(output.Config), projectModelTokenUsage(output.TokenUsage), output.Extra}, "model.AgenticCallbackOutput", nil, nil
	case components.ComponentOfPrompt:
		output := prompt.ConvCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentPromptOutputBody{output.Result, output.Extra}, "prompt.CallbackOutput", omittedTemplates(len(output.Templates)), nil
	case components.ComponentOfAgenticPrompt:
		output := prompt.ConvAgenticCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentPromptOutputBody{output.Result, output.Extra}, "prompt.AgenticCallbackOutput", omittedTemplates(len(output.Templates)), nil
	case components.ComponentOfEmbedding:
		output := embedding.ConvCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentEmbeddingOutputBody{output.Embeddings, projectEmbeddingConfig(output.Config), projectEmbeddingTokenUsage(output.TokenUsage), output.Extra}, "embedding.CallbackOutput", nil, nil
	case components.ComponentOfIndexer:
		output := indexer.ConvCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentIndexerOutputBody{output.IDs, output.Extra}, "indexer.CallbackOutput", nil, nil
	case components.ComponentOfRetriever:
		output := retriever.ConvCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentDocumentsBody{output.Docs, output.Extra}, "retriever.CallbackOutput", nil, nil
	case components.ComponentOfLoader:
		output := documentcomponent.ConvLoaderCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentLoaderOutputBody{output.Source.URI, output.Docs, output.Extra}, "document.LoaderCallbackOutput", nil, nil
	case components.ComponentOfTransformer:
		output := documentcomponent.ConvTransformerCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentDocumentsBody{output.Output, output.Extra}, "document.TransformerCallbackOutput", nil, nil
	case components.ComponentOfTool:
		output := toolcomponent.ConvCallbackOutput(value)
		if output == nil {
			return nil, "", nil, unsupportedComponentValue(component, ComponentIOOutput, value)
		}
		return ComponentToolOutputBody{output.Response, output.ToolOutput, output.Extra}, "tool.CallbackOutput", nil, nil
	default:
		return projectCustomComponentBody(component, ComponentIOOutput, value)
	}
}

func componentFormat(component components.Component, direction ComponentIODirection) string {
	suffix := "Input"
	if direction == ComponentIOOutput {
		suffix = "Output"
	}
	return string(component) + ".Callback" + suffix
}

func projectCustomComponentBody(component components.Component, direction ComponentIODirection, value any) (any, string, []Diagnostic, error) {
	if value == nil {
		return nil, "", nil, unsupportedComponentValue(component, direction, value)
	}
	return value, componentFormat(component, direction), []Diagnostic{{
		Severity: "warning",
		Code:     "projection.custom_component",
		Path:     "/payload/body",
		Message:  "Custom component body was preserved as JSON without official field normalization.",
	}}, nil
}

func unsupportedComponentValue(component components.Component, direction ComponentIODirection, value any) error {
	return fmt.Errorf("%w: %s %s received %T", ErrUnsupportedComponentValue, component, direction, value)
}

func omittedTemplates(count int) []Diagnostic {
	if count == 0 {
		return nil
	}
	return []Diagnostic{{
		Severity: "warning",
		Code:     "projection.runtime_field_omitted",
		Path:     "/payload/body/templates",
		Message:  "Runtime template instances were omitted from the JSON projection.",
	}}
}

func projectModelConfig(config *model.Config) *ComponentModelConfig {
	if config == nil {
		return nil
	}
	return &ComponentModelConfig{config.Model, config.MaxTokens, config.Temperature, config.TopP, config.Stop}
}

func projectAgenticModelConfig(config *model.AgenticConfig) *ComponentAgenticModelConfig {
	if config == nil {
		return nil
	}
	return &ComponentAgenticModelConfig{config.Model, config.MaxTokens, config.Temperature, config.TopP}
}

func projectModelTokenUsage(usage *model.TokenUsage) *ComponentTokenUsage {
	if usage == nil {
		return nil
	}
	return &ComponentTokenUsage{
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		CachedTokens:     usage.PromptTokenDetails.CachedTokens,
		ReasoningTokens:  usage.CompletionTokensDetails.ReasoningTokens,
	}
}

func projectEmbeddingConfig(config *embedding.Config) *ComponentEmbeddingConfig {
	if config == nil {
		return nil
	}
	return &ComponentEmbeddingConfig{config.Model, config.EncodingFormat}
}

func projectEmbeddingTokenUsage(usage *embedding.TokenUsage) *ComponentTokenUsage {
	if usage == nil {
		return nil
	}
	return &ComponentTokenUsage{usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens, 0, 0}
}
