package einoworkflowsnapshot

import (
	"errors"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

const (
	AgentEventKind        = "agent.event"
	AgentEventKindVersion = 1
)

var ErrNilAgentEvent = errors.New("eino dag protocol: nil agent event")

type AgentEventError struct {
	Message string `json:"message"`
}

// AgentMessageOutput describes a complete message or the existence of a live
// stream. A live stream is never consumed or closed by this projector, and its
// Value is therefore omitted.
type AgentMessageOutput struct {
	Format      string `json:"format"`
	Streaming   bool   `json:"streaming"`
	Role        string `json:"role,omitempty"`
	AgenticRole string `json:"agenticRole,omitempty"`
	ToolName    string `json:"toolName,omitempty"`
	Value       any    `json:"value,omitempty"`
}

type AgentEventOutput struct {
	Message          *AgentMessageOutput `json:"message,omitempty"`
	CustomizedOutput any                 `json:"customizedOutput,omitempty"`
}

type AgentAddressSegment struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	SubID string `json:"subId,omitempty"`
}

// AgentInterruptContext flattens Parent to ParentID so malformed application
// data cannot create a recursive JSON graph.
type AgentInterruptContext struct {
	ID          string                `json:"id"`
	Address     []AgentAddressSegment `json:"address"`
	Info        any                   `json:"info,omitempty"`
	IsRootCause bool                  `json:"isRootCause"`
	ParentID    string                `json:"parentId,omitempty"`
}

type AgentInterrupt struct {
	Data     any                     `json:"data,omitempty"`
	Contexts []AgentInterruptContext `json:"contexts,omitempty"`
}

type AgentTransferAction struct {
	DestinationAgent string `json:"destinationAgent"`
}

type AgentBreakLoopAction struct {
	From              string `json:"from,omitempty"`
	Done              bool   `json:"done"`
	CurrentIterations int    `json:"currentIterations"`
}

type AgentEventAction struct {
	Exit        bool                  `json:"exit"`
	Interrupted *AgentInterrupt       `json:"interrupted,omitempty"`
	Transfer    *AgentTransferAction  `json:"transfer,omitempty"`
	BreakLoop   *AgentBreakLoopAction `json:"breakLoop,omitempty"`
	Customized  any                   `json:"customized,omitempty"`
}

type AgentEventPayload struct {
	AgentName string            `json:"agentName,omitempty"`
	RunPath   []string          `json:"runPath,omitempty"`
	Output    *AgentEventOutput `json:"output,omitempty"`
	Action    *AgentEventAction `json:"action,omitempty"`
	Error     *AgentEventError  `json:"error,omitempty"`
}

// ProjectAgentEventEnvelope projects the default *schema.Message ADK event.
func ProjectAgentEventEnvelope(event *adk.AgentEvent, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	return projectTypedAgentEventEnvelope(event, "Message", "AgentEvent", options)
}

// ProjectAgenticEventEnvelope projects an AgenticMessage ADK event without
// consuming its stream.
func ProjectAgenticEventEnvelope(event *adk.TypedAgentEvent[*schema.AgenticMessage], options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	return projectTypedAgentEventEnvelope(event, "AgenticMessage", "TypedAgentEvent[AgenticMessage]", options)
}

func MarshalAgentEventEnvelope(event *adk.AgentEvent, options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectAgentEventEnvelope(event, options))
}

func MarshalAgenticEventEnvelope(event *adk.TypedAgentEvent[*schema.AgenticMessage], options EnvelopeOptions) ([]byte, []Diagnostic, error) {
	return marshalProjectedEnvelope(ProjectAgenticEventEnvelope(event, options))
}

func projectTypedAgentEventEnvelope[M adk.MessageType](event *adk.TypedAgentEvent[M], messageFormat string, sourceFormat string, options EnvelopeOptions) (Envelope, []Diagnostic, error) {
	if event == nil {
		return Envelope{}, nil, ErrNilAgentEvent
	}
	payload, diagnostics := projectAgentEventPayload(event, messageFormat)
	options = withSourceDefaults(options, "adk", sourceFormat)
	envelope, envelopeDiagnostics, err := NewEnvelope(
		AgentEventKind,
		AgentEventKindVersion,
		payload,
		options,
	)
	diagnostics = append(diagnostics, envelopeDiagnostics...)
	return envelope, diagnostics, err
}

func projectAgentEventPayload[M adk.MessageType](event *adk.TypedAgentEvent[M], format string) (AgentEventPayload, []Diagnostic) {
	payload := AgentEventPayload{
		AgentName: event.AgentName,
		RunPath:   make([]string, len(event.RunPath)),
	}
	for index := range event.RunPath {
		payload.RunPath[index] = event.RunPath[index].String()
	}

	var diagnostics []Diagnostic
	if event.Output != nil {
		payload.Output = &AgentEventOutput{CustomizedOutput: event.Output.CustomizedOutput}
		if message := event.Output.MessageOutput; message != nil {
			projected := &AgentMessageOutput{
				Format:      format,
				Streaming:   message.IsStreaming,
				Role:        string(message.Role),
				AgenticRole: string(message.AgenticRole),
				ToolName:    message.ToolName,
			}
			if message.IsStreaming {
				diagnostics = append(diagnostics, Diagnostic{
					Severity: "warning",
					Code:     "projection.stream_omitted",
					Path:     "/payload/output/message/value",
					Message:  "Live message stream was not consumed; only stream metadata was projected.",
				})
			} else {
				projected.Value = nonNilMessage(message.Message)
				if projected.Value == nil {
					diagnostics = append(diagnostics, Diagnostic{
						Severity: "warning",
						Code:     "projection.message_missing",
						Path:     "/payload/output/message/value",
						Message:  "Non-streaming message output did not contain a message value.",
					})
				}
			}
			payload.Output.Message = projected
		}
	}
	if event.Action != nil {
		payload.Action = projectAgentAction(event.Action)
	}
	if event.Err != nil {
		payload.Error = &AgentEventError{Message: event.Err.Error()}
	}
	return payload, diagnostics
}

func nonNilMessage[M adk.MessageType](message M) any {
	switch typed := any(message).(type) {
	case *schema.Message:
		if typed != nil {
			return typed
		}
	case *schema.AgenticMessage:
		if typed != nil {
			return typed
		}
	}
	return nil
}

func projectAgentAction(action *adk.AgentAction) *AgentEventAction {
	projected := &AgentEventAction{
		Exit:       action.Exit,
		Customized: action.CustomizedAction,
	}
	if action.TransferToAgent != nil {
		projected.Transfer = &AgentTransferAction{
			DestinationAgent: action.TransferToAgent.DestAgentName,
		}
	}
	if action.BreakLoop != nil {
		projected.BreakLoop = &AgentBreakLoopAction{
			From:              action.BreakLoop.From,
			Done:              action.BreakLoop.Done,
			CurrentIterations: action.BreakLoop.CurrentIterations,
		}
	}
	if action.Interrupted != nil {
		projected.Interrupted = &AgentInterrupt{
			Data:     action.Interrupted.Data,
			Contexts: projectInterruptContexts(action.Interrupted.InterruptContexts),
		}
	}
	return projected
}

func projectInterruptContexts(contexts []*adk.InterruptCtx) []AgentInterruptContext {
	result := make([]AgentInterruptContext, 0, len(contexts))
	for _, context := range contexts {
		if context == nil {
			continue
		}
		projected := AgentInterruptContext{
			ID:          context.ID,
			Address:     make([]AgentAddressSegment, len(context.Address)),
			Info:        context.Info,
			IsRootCause: context.IsRootCause,
		}
		if context.Parent != nil {
			projected.ParentID = context.Parent.ID
		}
		for index, segment := range context.Address {
			projected.Address[index] = AgentAddressSegment{
				Type:  string(segment.Type),
				ID:    segment.ID,
				SubID: segment.SubID,
			}
		}
		result = append(result, projected)
	}
	return result
}
