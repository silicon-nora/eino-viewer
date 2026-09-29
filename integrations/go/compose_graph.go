package einoworkflowsnapshot

import (
	"encoding/json"

	"github.com/cloudwego/eino/compose"
)

const (
	ComposeGraphKind        = "compose.graph"
	ComposeGraphKindVersion = 1
)

type ComposeGraphEnvelopeOptions struct {
	Projection ProjectOptions
	Envelope   EnvelopeOptions
}

// ProjectComposeGraph projects the topology domain without the legacy
// WorkflowSnapshot wrapper. Node kinds are included only when a resolver is
// supplied, matching the existing projection's opt-in semantics.
func ProjectComposeGraph(info *compose.GraphInfo, options ProjectOptions) (Graph, error) {
	if info == nil {
		return Graph{}, ErrNilGraphInfo
	}
	return projectGraph(
		info,
		make(map[*compose.GraphInfo]bool),
		nil,
		options,
		options.ResolveNodeKind != nil,
	)
}

// ProjectComposeGraphEnvelope projects GraphInfo into a compose.graph v1
// envelope. Source defaults are merged with caller-supplied version metadata.
func ProjectComposeGraphEnvelope(info *compose.GraphInfo, options ComposeGraphEnvelopeOptions) (Envelope, []Diagnostic, error) {
	graph, err := ProjectComposeGraph(info, options.Projection)
	if err != nil {
		return Envelope{}, nil, err
	}
	envelopeOptions := options.Envelope
	envelopeOptions.Source = cloneStringMap(envelopeOptions.Source)
	if envelopeOptions.Source == nil {
		envelopeOptions.Source = make(map[string]string)
	}
	if envelopeOptions.Source["module"] == "" {
		envelopeOptions.Source["module"] = "compose"
	}
	if envelopeOptions.Source["format"] == "" {
		envelopeOptions.Source["format"] = "GraphInfo"
	}
	return NewEnvelope(
		ComposeGraphKind,
		ComposeGraphKindVersion,
		graph,
		envelopeOptions,
	)
}

func MarshalComposeGraphEnvelope(info *compose.GraphInfo, options ComposeGraphEnvelopeOptions) ([]byte, []Diagnostic, error) {
	envelope, diagnostics, err := ProjectComposeGraphEnvelope(info, options)
	if err != nil {
		return nil, diagnostics, err
	}
	encoded, err := json.Marshal(envelope)
	return encoded, diagnostics, err
}
