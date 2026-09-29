package einoworkflowsnapshot

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/schema"
)

const (
	SchemaMessageKind               = "schema.message"
	SchemaMessageKindVersion        = 1
	SchemaAgenticMessageKind        = "schema.agentic_message"
	SchemaAgenticMessageKindVersion = 1
	SchemaToolKind                  = "schema.tool"
	SchemaToolKindVersion           = 1
	SchemaDocumentKind              = "schema.document"
	SchemaDocumentKindVersion       = 1
)

var ErrNilSchemaValue = errors.New("eino dag protocol: nil schema value")

// ProjectSchemaMessageEnvelope preserves Eino's public Message JSON shape.
// Open extension fields remain subject to the envelope's JSON, size, and
// redaction policy instead of being normalized or silently discarded.
func ProjectSchemaMessageEnvelope(message *schema.Message, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if message == nil {
		return Envelope{}, nil, fmt.Errorf("%w: Message", ErrNilSchemaValue)
	}
	return projectSchemaEnvelope(SchemaMessageKind, SchemaMessageKindVersion, "Message", message, options)
}

func ProjectSchemaAgenticMessageEnvelope(message *schema.AgenticMessage, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if message == nil {
		return Envelope{}, nil, fmt.Errorf("%w: AgenticMessage", ErrNilSchemaValue)
	}
	return projectSchemaEnvelope(SchemaAgenticMessageKind, SchemaAgenticMessageKindVersion, "AgenticMessage", message, options)
}

func ProjectSchemaToolEnvelope(tool *schema.ToolInfo, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if tool == nil {
		return Envelope{}, nil, fmt.Errorf("%w: ToolInfo", ErrNilSchemaValue)
	}
	return projectSchemaEnvelope(SchemaToolKind, SchemaToolKindVersion, "ToolInfo", tool, options)
}

func ProjectSchemaDocumentEnvelope(document *schema.Document, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if document == nil {
		return Envelope{}, nil, fmt.Errorf("%w: Document", ErrNilSchemaValue)
	}
	return projectSchemaEnvelope(SchemaDocumentKind, SchemaDocumentKindVersion, "Document", document, options)
}

func MarshalSchemaMessageEnvelope(message *schema.Message, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectSchemaMessageEnvelope(message, options))
}

func MarshalSchemaAgenticMessageEnvelope(message *schema.AgenticMessage, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectSchemaAgenticMessageEnvelope(message, options))
}

func MarshalSchemaToolEnvelope(tool *schema.ToolInfo, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectSchemaToolEnvelope(tool, options))
}

func MarshalSchemaDocumentEnvelope(document *schema.Document, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectSchemaDocumentEnvelope(document, options))
}

func projectSchemaEnvelope(kind string, version int, format string, value any, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	options = withSourceDefaults(options, "schema", format)
	return NewEnvelope(kind, version, value, options)
}

func marshalProjectedEnvelope(envelope Envelope, diagnostics []Diagnostic, err error) ([]byte, []Diagnostic, error) {
	if err != nil {
		return nil, diagnostics, err
	}
	encoded, err := json.Marshal(envelope)
	return encoded, diagnostics, err
}

func withSourceDefaults(options EnvelopeOptions, module string, format string) EnvelopeOptions {
	options.Source = cloneStringMap(options.Source)
	if options.Source == nil {
		options.Source = make(map[string]string)
	}
	if options.Source["module"] == "" {
		options.Source["module"] = module
	}
	if options.Source["format"] == "" {
		options.Source["format"] = format
	}
	return options
}
