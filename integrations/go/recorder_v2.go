package einoworkflowsnapshot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	v2 "github.com/silicon-nora/eino-viewer/integrations/go/protocolv2"
)

var ErrV2NotEnabled = errors.New("eino recorder: construct with NewAgentRecorderV2, NewGraphRecorderV2 or NewWorkflowRecorderV2 before invoking")

// ErrV2Sealed means the first static export has already frozen this recorder.
var ErrV2Sealed = errors.New("eino recorder: v2 run is sealed")

// NewAgentRecorderV2 enables native v2 observations while retaining the legacy API.
// Each recorder belongs to one execution. V2 is captured at callbacks, never
// reconstructed from RunRecord v1. The same configured safe-body policy applies.
func NewAgentRecorderV2(runID string, options AgentRecorderOptions) *AgentRecorder {
	r := NewAgentRecorder(runID, options)
	r.v2 = newNativeV2(runID, "agent", options.Envelope, false)
	return r
}
func NewGraphRecorderV2(runID string, options GraphRecorderOptions) *GraphRecorder {
	r := NewGraphRecorder(runID, options)
	policy := options.Events
	if options.IO != nil {
		policy = *options.IO
	}
	r.v2 = newNativeV2(runID, "graph", policy, options.DisableIO)
	return r
}
func NewWorkflowRecorderV2(runID string, options WorkflowRecorderOptions) *WorkflowRecorder {
	r := NewWorkflowRecorder(runID, options)
	r.v2 = newNativeV2(runID, "workflow", options.Envelope, false)
	r.v2.disableRootIO = options.DisableRootIO
	return r
}
func (r *AgentRecorder) RunRecordV2() (v2.RunRecord, error)     { return r.v2.snapshot() }
func (r *GraphRecorder) RunRecordV2() (v2.RunRecord, error)     { return r.v2.snapshot() }
func (r *WorkflowRecorder) RunRecordV2() (v2.RunRecord, error)  { return r.v2.snapshot() }
func (r *AgentRecorder) MarshalRunRecordV2() ([]byte, error)    { return marshalNativeV2(r.v2) }
func (r *GraphRecorder) MarshalRunRecordV2() ([]byte, error)    { return marshalNativeV2(r.v2) }
func (r *WorkflowRecorder) MarshalRunRecordV2() ([]byte, error) { return marshalNativeV2(r.v2) }
func marshalNativeV2(r *nativeV2Recorder) ([]byte, error) {
	record, err := r.snapshot()
	if err != nil {
		return nil, err
	}
	return json.Marshal(record)
}

type v2ContextKey struct{ recorder *nativeV2Recorder }
type v2Frame struct {
	id       v2.Id
	identity string
}
type nativeV2Recorder struct {
	mu                       sync.Mutex
	agentDone                []chan struct{}
	record                   v2.RunRecord
	options                  EnvelopeOptions
	explicitRedactor         Redactor
	disableIO, disableRootIO bool
	starts                   map[v2.Id]time.Time
	byID                     map[v2.Id]int
	definitions              map[string]v2.Id
	requests                 map[string][]v2.Id
	toolResponses            map[v2.Id]v2.Id
	rootBound, agentDrained  bool
	rootFinalized            bool
	rootError                *v2.Error
	entryError               error
	sealed                   []byte
}

func newNativeV2(runID, source string, options EnvelopeOptions, disabled bool) *nativeV2Recorder {
	return &nativeV2Recorder{options: options, disableIO: disabled, starts: map[v2.Id]time.Time{}, byID: map[v2.Id]int{}, definitions: map[string]v2.Id{}, requests: map[string][]v2.Id{}, toolResponses: map[v2.Id]v2.Id{}, record: v2.RunRecord{
		SchemaVersion: "2", Run: v2.Run{ID: v2.Id(runID), Mode: "definition", Scope: "eino", Source: source, Status: "unknown", Timing: v2.Timing{Basis: "unknown"}, Producer: v2.Producer{Name: "eino-viewer/go", Version: "0.1.0"}, Capture: v2.Capture{State: "complete", Coverage: []string{"invocations", "events", "io", "model"}, Issues: []v2.CaptureIssue{}}},
		Definitions: []v2.Definition{}, Invocations: []v2.Invocation{}, Events: []v2.Event{}, Relations: []v2.Relation{}, Contents: []v2.Content{}, Usage: []v2.Usage{}, Annotations: []v2.Annotation{}}}
}
func v2Number(n int64) json.Number       { return json.Number(strconv.FormatInt(n, 10)) }
func v2Ptr[T any](value T) *T            { return &value }
func v2Ref(kind string, id v2.Id) v2.Ref { return v2.Ref{Kind: kind, ID: v2Ptr(id)} }
func v2Path(path []string) string {
	if path == nil {
		path = []string{}
	}
	data, _ := json.Marshal(path)
	return string(data)
}
func v2Kind(component string) string {
	switch component {
	case "ChatModel", "AgenticModel":
		return "model"
	case "Tool":
		return "tool"
	case "Graph", "Chain":
		return "graph"
	case "Workflow":
		return "workflow"
	case "Agent", "AgenticAgent":
		return "agent"
	default:
		return "node"
	}
}
func (r *nativeV2Recorder) issue(code, message string, owner v2.Ref) {
	r.record.Run.Capture.State = "partial"
	for _, issue := range r.record.Run.Capture.Issues {
		if string(issue.Code) == code && issue.Message == message && (issue.Owner == nil || owner.ID == nil || issue.Owner.ID != nil && *issue.Owner.ID == *owner.ID) {
			return
		}
	}
	r.record.Run.Capture.Issues = append(r.record.Run.Capture.Issues, v2.CaptureIssue{Code: v2.Id(code), Message: message, Owner: &owner})
}
func (r *nativeV2Recorder) event(kind string, owner v2.Id, refs []v2.Id, attributes *v2.JsonObject) v2.Id {
	sequence := len(r.record.Events) + 1
	id := v2.Id(fmt.Sprintf("event-%d", sequence))
	if refs == nil {
		refs = []v2.Id{}
	}
	r.record.Events = append(r.record.Events, v2.Event{ID: id, Sequence: v2Number(int64(sequence)), Type: v2.Id(kind), Owner: v2Ref("invocation", owner), AtMs: v2Ptr(v2Number(time.Now().UnixMilli())), ContentRefs: refs, Attributes: attributes})
	return id
}
func (r *nativeV2Recorder) newInvocation(kind, name string, parent v2.Parent, path []string) v2.Id {
	id := v2.Id(fmt.Sprintf("call-%d", len(r.record.Invocations)+1))
	now := time.Now()
	invocation := v2.Invocation{ID: id, Kind: kind, Name: name, Parent: parent, Status: "running", Timing: v2.Timing{Basis: "observed", StartedAtMs: v2Ptr(v2Number(now.UnixMilli()))}, InputRefs: []v2.Id{}, OutputRefs: []v2.Id{}, Metrics: []v2.Metric{}}
	if definitionID, ok := r.definitions[v2Path(path)]; ok {
		invocation.DefinitionID = v2Ptr(definitionID)
	}
	r.byID[id] = len(r.record.Invocations)
	r.starts[id] = now
	r.record.Invocations = append(r.record.Invocations, invocation)
	if parent.State == "root" {
		r.record.Run.Mode = "execution"
		r.record.Run.RootInvocationID = v2Ptr(id)
	}
	if kind == "model" {
		r.record.Usage = append(r.record.Usage, v2.Usage{ID: v2.Id(fmt.Sprintf("usage-%d", len(r.record.Usage)+1)), InvocationID: id, Source: "unknown", Completeness: "unknown", Tokens: v2.TokenCounts{}})
	}
	r.event("invocation.started", id, nil, nil)
	return id
}
func (r *nativeV2Recorder) startAgent(ctx context.Context, messages []*schema.Message) context.Context {
	if r == nil {
		return ctx
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return ctx
	}
	if r.record.Run.RootInvocationID != nil {
		return context.WithValue(ctx, v2ContextKey{r}, v2Frame{id: *r.record.Run.RootInvocationID})
	}
	id := r.newInvocation("agent", "Agent run", v2.Parent{State: "root"}, nil)
	// Preserve the full caller input, including system and prior messages.
	r.capture(ctx, id, &callbacks.RunInfo{Component: adk.ComponentOfAgent}, ComponentIOInput, false, messages, true)
	return context.WithValue(ctx, v2ContextKey{r}, v2Frame{id: id})
}
func (r *nativeV2Recorder) finishAgentRun(outcome string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	r.agentDrained = outcome != "unknown"
	if r.record.Run.RootInvocationID == nil {
		return
	}
	id := *r.record.Run.RootInvocationID
	// The outer Runner iterator also carries orchestration failures that are
	// absent from Agent callback copies, such as a missing transfer target.
	if !r.rootFinalized {
		status := v2.Status("succeeded")
		if outcome == "failed" || outcome == "cancelled" {
			status = v2.Status(outcome)
		}
		if outcome == "unknown" {
			status = "interrupted"
		}
		r.record.Invocations[r.byID[id]].Error = r.rootError
		r.finish(id, status, nil)
		r.rootFinalized = true
	}

}
func (r *nativeV2Recorder) finish(id v2.Id, status v2.Status, runErr error) {
	if r.rootFinalized && r.record.Run.RootInvocationID != nil && id == *r.record.Run.RootInvocationID {
		return
	}
	index, ok := r.byID[id]
	if !ok {
		return
	}
	call := &r.record.Invocations[index]
	call.Status = status
	call.Timing.EndedAtMs = v2Ptr(v2Number(time.Now().UnixMilli()))
	if start, ok := r.starts[id]; ok {
		call.Timing.DurationMs = v2Ptr(v2Number(time.Since(start).Milliseconds()))
		call.Timing.Basis = "monotonic"
	}
	if runErr != nil {
		r.captureError(id, runErr)
	}
	if status == "failed" && r.record.Invocations[index].Error == nil {
		r.issue("missing_error", "Failed invocation has no safely captured error detail.", v2Ref("invocation", id))
	}
	r.event("invocation.ended", id, nil, nil)
}
func (r *nativeV2Recorder) captureError(id v2.Id, runErr error) {
	r.record.Invocations[r.byID[id]].Error = nil
	envelope, diagnostics, err := safeComponentIO(context.Background(), &callbacks.RunInfo{Component: "Lambda"}, ComponentIOOutput, false, map[string]any{"message": runErr.Error()}, "root", r.options)
	for _, d := range diagnostics {
		r.issue(d.Code, d.Message, v2Ref("invocation", id))
	}
	if err != nil {
		r.issue("error_omitted", "Error could not be safely captured.", v2Ref("invocation", id))
		return
	}
	var payload map[string]json.RawMessage
	_ = json.Unmarshal(envelope.Payload, &payload)
	var body struct {
		Message string `json:"message"`
	}
	raw, ok := payload["body"]
	if !ok || json.Unmarshal(raw, &body) != nil || body.Message == "" {
		r.issue("error_omitted", "Error detail was omitted by the safe-body policy.", v2Ref("invocation", id))
		return
	}
	r.record.Invocations[r.byID[id]].Error = &v2.Error{Message: body.Message}
}
func (r *nativeV2Recorder) start(ctx context.Context, info *callbacks.RunInfo, input any, streaming bool) context.Context {
	if info == nil {
		return ctx
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return ctx
	}
	parentFrame, _ := ctx.Value(v2ContextKey{r}).(v2Frame)
	kind := v2Kind(string(info.Component))
	path := callbackNodePath(callbackAddressFromContext(ctx))
	identity := string(info.Component) + ":" + callbackAddressID(callbackAddressFromContext(ctx))
	name := info.Name
	if name == "" {
		name = string(info.Component)
	}
	var id v2.Id
	if kind == "agent" && r.record.Run.Source == "agent" && !r.rootBound && parentFrame.id != "" && r.record.Run.RootInvocationID != nil && parentFrame.id == *r.record.Run.RootInvocationID {
		id = parentFrame.id
		r.rootBound = true
		r.record.Invocations[r.byID[id]].Name = name
	} else {
		parent := v2.Parent{State: "unknown", Reason: v2Ptr("No invocation identity was inherited from the Eino callback context.")}
		if parentFrame.id != "" {
			parent = v2.Parent{State: "known", InvocationID: v2Ptr(parentFrame.id)}
		}
		if r.record.Run.RootInvocationID == nil && kind == r.record.Run.Source && isRootRunnableAddress(callbackAddressFromContext(ctx)) {
			parent = v2.Parent{State: "root"}
		}
		id = r.newInvocation(kind, name, parent, path)
		if parent.State == "unknown" {
			r.issue("unknown_parent", *parent.Reason, v2Ref("invocation", id))
		}
	}

	if len(path) == 0 && (kind == "workflow" || kind == "graph") {
		if definitionID := r.record.Invocations[r.byID[id]].DefinitionID; definitionID != nil {
			for index := range r.record.Definitions {
				if r.record.Definitions[index].ID == *definitionID {
					r.record.Definitions[index].Kind = kind
				}
			}
		}
	}
	if kind == "agent" {
		if body := adk.ConvAgentCallbackInput(input); body != nil && body.Input != nil && len(r.record.Invocations[r.byID[id]].InputRefs) == 0 {
			r.capture(ctx, id, info, ComponentIOInput, false, body.Input.Messages, true)
		}
	} else {
		r.capture(ctx, id, info, ComponentIOInput, streaming, input, kind == r.record.Run.Source && r.record.Invocations[r.byID[id]].Parent.State == "root")
	}
	if kind == "tool" {
		callID := compose.GetToolCallID(ctx)
		if callID != "" {
			r.record.Invocations[r.byID[id]].ExternalCallID = &callID
			r.linkTool(id, callID, name)
		}
	}
	return context.WithValue(ctx, v2ContextKey{r}, v2Frame{id: id, identity: identity})
}
func (r *nativeV2Recorder) end(ctx context.Context, info *callbacks.RunInfo, output any, streaming bool, runErr error) {
	if info == nil {
		return
	}
	frame, _ := ctx.Value(v2ContextKey{r}).(v2Frame)
	identity := string(info.Component) + ":" + callbackAddressID(callbackAddressFromContext(ctx))
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if frame.id == "" || frame.identity != identity {
		r.issue("unmatched_callback_end", "Callback end has no matching start identity.", v2Ref("run", r.record.Run.ID))
		return
	}
	if v2Kind(string(info.Component)) == "agent" && runErr == nil {
		body := adk.ConvAgentCallbackOutput(output)
		if body != nil && body.Events != nil {
			done := make(chan struct{})
			r.agentDone = append(r.agentDone, done)
			go func() { defer close(done); r.observeAgent(ctx, frame.id, info, body.Events) }()
			return
		}
		r.issue("agent_iterator_missing", "Agent end did not expose an observable event iterator.", v2Ref("invocation", frame.id))
		return
	}
	if runErr != nil {
		status := v2.Status("failed")
		if errors.Is(runErr, context.Canceled) || errors.Is(runErr, context.DeadlineExceeded) {
			status = "cancelled"
		}
		r.finish(frame.id, status, runErr)
	} else {
		r.capture(ctx, frame.id, info, ComponentIOOutput, streaming, output, r.record.Invocations[r.byID[frame.id]].Parent.State == "root")
		if !streaming {
			r.finish(frame.id, "succeeded", nil)
		} else {
			r.issue("stream_end_unobserved", "Returning a stream does not establish its terminal outcome.", v2Ref("invocation", frame.id))
		}
	}
}
func (r *nativeV2Recorder) observeAgent(ctx context.Context, id v2.Id, info *callbacks.RunInfo, iterator *adk.AsyncIterator[*adk.AgentEvent]) {
	defer r.guard()
	status := v2.Status("succeeded")
	var finalErr error
	streamed := false
	depth := 0
	for _, s := range callbackAddressFromContext(ctx) {
		if s.Type == "agent" {
			depth++
		}
	}
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event == nil {
			continue
		}
		// This iterator is the exact agent invocation's independent Eino callback
		// copy. RunPath depth separates its own outputs from forwarded child events.
		own := event.AgentName == info.Name && (depth == 0 || len(event.RunPath) == depth)
		if !own {
			continue
		}
		if event.Err != nil {
			finalErr = event.Err
			status = "failed"
			if errors.Is(event.Err, context.Canceled) || errors.Is(event.Err, context.DeadlineExceeded) {
				status = "cancelled"
			}
		}
		if event.Action != nil && event.Action.Interrupted != nil {
			status = "interrupted"
		}
		func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.sealed != nil {
				return
			}
			if event.Action != nil && event.Action.TransferToAgent != nil {
				attrs := v2.JsonObject{"destinationAgent": v2JSON(event.Action.TransferToAgent.DestAgentName)}
				r.event("agent.transfer-requested", id, nil, &attrs)
			}
			if event.Output != nil && event.Output.MessageOutput != nil {
				out := event.Output.MessageOutput
				streamed = streamed || out.IsStreaming
				if out.IsStreaming {
					r.capture(ctx, id, info, ComponentIOOutput, true, nil, true)
				} else if out.Message != nil && out.Message.Role == schema.Assistant && len(out.Message.ToolCalls) == 0 {
					r.capture(ctx, id, info, ComponentIOOutput, false, out.Message, true)
				}
			}
		}()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if streamed && status == "succeeded" {
		r.issue("stream_end_unobserved", "Agent message stream was not consumed; its terminal outcome is unknown.", v2Ref("invocation", id))
		return
	}
	if r.record.Run.Source == "agent" && r.record.Run.RootInvocationID != nil && id == *r.record.Run.RootInvocationID {
		return
	}
	r.finish(id, status, finalErr)
}
func v2JSON(value any) json.RawMessage { data, _ := json.Marshal(value); return data }

// capture reuses the existing descriptor-safe, bounded JSON projection at the
// callback moment. It never reads a v1 record or pairs historical envelopes.
func (r *nativeV2Recorder) capture(ctx context.Context, id v2.Id, info *callbacks.RunInfo, direction ComponentIODirection, streaming bool, value any, raw bool) {
	role := string(direction)
	index := r.byID[id]
	kind := r.record.Invocations[index].Kind
	if kind == "model" {
		if direction == ComponentIOInput {
			role = "model-request"
		} else {
			role = "model-response"
		}
	}
	content := v2.Content{ID: v2.Id(fmt.Sprintf("content-%d", len(r.record.Contents)+1)), Owner: v2Ref("invocation", id), Role: role, MediaType: "application/json", Provenance: "observed", Completeness: "unknown", Transforms: []v2.Transform{}, Data: v2.ContentData{Availability: "missing", Reason: v2Ptr("body_not_captured")}}
	disabled := r.disableIO || (r.disableRootIO && r.record.Invocations[index].Parent.State == "root")
	if disabled {
		content.Data.Reason = v2Ptr("capture_disabled")
	} else {
		scope := "node"
		if raw {
			scope = "root"
		}
		envelope, diagnostics, err := safeComponentIO(ctx, info, direction, streaming, value, scope, r.options)
		for _, d := range diagnostics {
			if d.Code != "projection.custom_component" {
				r.issue(d.Code, d.Message, content.Owner)
			}
		}
		if err != nil {
			r.issue("body_omitted", "Callback body could not be safely projected.", content.Owner)
		} else {
			var payload map[string]json.RawMessage
			_ = json.Unmarshal(envelope.Payload, &payload)
			var metadata struct {
				Capture struct {
					Reason   string `json:"reason"`
					Redacted bool   `json:"redacted"`
				} `json:"capture"`
			}
			_ = json.Unmarshal(envelope.Metadata, &metadata)
			if body, ok := payload["body"]; ok {
				content.Data = v2.ContentData{Availability: "inline", Value: append(json.RawMessage(nil), body...)}
				content.Completeness = "complete"
				if !raw {
					content.Provenance = "projected"
				}
				if metadata.Capture.Redacted {
					content.Transforms = append(content.Transforms, v2.Transform{Kind: "redacted", Reason: "configured_redactor"})
				}
			} else if metadata.Capture.Reason != "" {
				content.Data.Reason = &metadata.Capture.Reason
			}
		}
	}
	if content.Data.Availability == "missing" {
		r.issue("content_missing", *content.Data.Reason, content.Owner)
	}

	if content.Data.Availability == "inline" && !v2SafeNumbers(content.Data.Value) {
		raw := v2.Content{ID: content.ID, Owner: content.Owner, Role: "diagnostic", MediaType: "text/plain", Provenance: "projected", Completeness: "complete", Transforms: append([]v2.Transform{}, content.Transforms...), Data: v2.ContentData{Availability: "inline", Value: v2JSON(string(content.Data.Value))}}
		r.record.Contents = append(r.record.Contents, raw)
		r.event("content.raw-json-retained", id, []v2.Id{raw.ID}, nil)
		content.ID = v2.Id(fmt.Sprintf("content-%d", len(r.record.Contents)+1))
		content.Completeness = "unknown"
		content.Data = v2.ContentData{Availability: "missing", Reason: v2Ptr("unsafe_numeric_range")}
		r.issue("unsafe_numeric_range", "Body contains a number outside the reader's exact range; sanitized original JSON is retained as diagnostic text.", content.Owner)
	}
	r.record.Contents = append(r.record.Contents, content)
	if direction == ComponentIOInput {
		r.record.Invocations[index].InputRefs = append(r.record.Invocations[index].InputRefs, content.ID)
	} else {
		r.record.Invocations[index].OutputRefs = append(r.record.Invocations[index].OutputRefs, content.ID)
	}
	r.event("content.captured", id, []v2.Id{content.ID}, nil)
	if kind == "model" && content.Data.Availability == "inline" {
		r.modelFacts(id, content, direction)
	}
}
func (r *nativeV2Recorder) modelFacts(id v2.Id, content v2.Content, direction ComponentIODirection) {
	var body struct {
		Config struct {
			Model string `json:"model"`
		} `json:"config"`
		TokenUsage *ComponentTokenUsage `json:"tokenUsage"`
		Message    *schema.Message      `json:"message"`
	}
	if len(content.Transforms) > 0 {
		return
	}
	if json.Unmarshal(content.Data.Value, &body) != nil {
		return
	}

	if body.TokenUsage == nil && body.Message != nil && body.Message.ResponseMeta != nil && body.Message.ResponseMeta.Usage != nil {
		usage := body.Message.ResponseMeta.Usage
		body.TokenUsage = &ComponentTokenUsage{PromptTokens: usage.PromptTokens, CompletionTokens: usage.CompletionTokens, TotalTokens: usage.TotalTokens, CachedTokens: usage.PromptTokenDetails.CachedTokens, ReasoningTokens: usage.CompletionTokensDetails.ReasoningTokens}
	}
	for i := range r.record.Usage {
		u := &r.record.Usage[i]
		if u.InvocationID != id {
			continue
		}
		if body.Config.Model != "" {
			u.Model = &body.Config.Model
		}
		if direction == ComponentIOOutput && body.TokenUsage != nil {
			t := body.TokenUsage
			if t.PromptTokens < 0 || t.CompletionTokens < 0 || t.TotalTokens < 0 || t.CachedTokens < 0 || t.ReasoningTokens < 0 || int64(t.PromptTokens) > 9007199254740991 || int64(t.CompletionTokens) > 9007199254740991 || int64(t.TotalTokens) > 9007199254740991 || t.TotalTokens != t.PromptTokens+t.CompletionTokens || t.CachedTokens > t.PromptTokens || t.ReasoningTokens > t.CompletionTokens {
				r.issue("invalid_usage", "Provider token counts failed nonnegative/subset/total checks; raw response is retained.", v2Ref("invocation", id))
				continue
			}
			u.Source = "provider"
			u.Completeness = "complete"
			u.Tokens = v2.TokenCounts{Input: v2Ptr(v2Number(int64(t.PromptTokens))), Output: v2Ptr(v2Number(int64(t.CompletionTokens))), Total: v2Ptr(v2Number(int64(t.TotalTokens)))}
			// Optional zero detail fields are omitted by Eino's public projection; do
			// not turn their absence into observed zero.
			if t.CachedTokens != 0 {
				u.Tokens.InputCached = v2Ptr(v2Number(int64(t.CachedTokens)))
			}
			if t.ReasoningTokens != 0 {
				u.Tokens.OutputReasoning = v2Ptr(v2Number(int64(t.ReasoningTokens)))
			}
		}
	}
	if direction != ComponentIOOutput || body.Message == nil {
		return
	}
	message := body.Message
	requestIDs := []v2.Id{}
	for _, call := range message.ToolCalls {
		if call.Function.Name == "" {
			continue
		}
		argument := v2.Content{ID: v2.Id(fmt.Sprintf("content-%d", len(r.record.Contents)+1)), Owner: v2Ref("invocation", id), Role: "other", MediaType: "application/json", Provenance: "projected", Completeness: content.Completeness, Transforms: append([]v2.Transform{}, content.Transforms...), Data: v2.ContentData{Availability: "inline", Value: v2JSON(call.Function.Arguments)}}
		r.record.Contents = append(r.record.Contents, argument)
		attrs := v2.JsonObject{"toolName": v2JSON(call.Function.Name)}
		if call.ID != "" {
			attrs["externalCallId"] = v2JSON(call.ID)
		}
		request := r.event("tool.requested", id, []v2.Id{argument.ID}, &attrs)
		requestIDs = append(requestIDs, request)
		if call.ID != "" {
			key := string(r.scope(id)) + "\x00" + call.ID + "\x00" + call.Function.Name
			r.requests[key] = append(r.requests[key], request)
		}
	}
	if message.Role != schema.Assistant {
		return
	}
	normalized := v2.Message{Role: "assistant", Parts: []v2.MessagePart{{Kind: "text", Text: v2Ptr(message.Content)}}}
	if len(requestIDs) > 0 {
		normalized.ToolRequestEventIDs = &requestIDs
	}
	r.record.Contents = append(r.record.Contents, v2.Content{ID: v2.Id(fmt.Sprintf("content-%d", len(r.record.Contents)+1)), Owner: v2Ref("invocation", id), Role: "message", MediaType: "application/json", SchemaRef: v2Ptr("urn:eino:run:2#/$defs/Message"), Provenance: "projected", Completeness: "partial", Transforms: append([]v2.Transform{}, content.Transforms...), Data: v2.ContentData{Availability: "inline", Value: v2JSON(normalized)}})
}
func (r *nativeV2Recorder) scope(id v2.Id) v2.Id {
	for id != "" {
		call := r.record.Invocations[r.byID[id]]
		if call.Kind == "agent" || call.Parent.State == "root" {
			return id
		}
		if call.Parent.InvocationID == nil {
			return id
		}
		id = *call.Parent.InvocationID
	}
	return id
}
func (r *nativeV2Recorder) linkTool(id v2.Id, externalID, name string) {
	key := string(r.scope(id)) + "\x00" + externalID + "\x00" + name
	requests := r.requests[key]
	if len(requests) != 1 {
		r.issue("tool_request_unresolved", "Tool request identity was absent or ambiguous within the actual invocation scope.", v2Ref("invocation", id))
		return
	}
	request := requests[0]
	delete(r.requests, key)
	r.toolResponses[id] = request
	r.record.Relations = append(r.record.Relations, v2.Relation{ID: v2.Id(fmt.Sprintf("relation-%d", len(r.record.Relations)+1)), Type: "responds_to", From: v2Ref("invocation", id), To: v2Ref("event", request)})
}

func (r *nativeV2Recorder) definition(info *compose.GraphInfo, options ProjectOptions) {
	if r == nil {
		return
	}
	graph, err := ProjectComposeGraph(info, options)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if err != nil {
		r.issue("definition_omitted", "Compiled graph could not be projected.", v2Ref("run", r.record.Run.ID))
		return
	}
	r.addCoverage("definitions")
	var visit func(Graph, []string, *v2.Id, string) v2.Id
	visit = func(graph Graph, path []string, parent *v2.Id, kind string) v2.Id {
		id := v2.Id(fmt.Sprintf("def-%d", len(r.record.Definitions)+1))
		name := graph.Name
		if name == "" {
			name = kind
		}
		index := len(r.record.Definitions)
		r.record.Definitions = append(r.record.Definitions, v2.Definition{ID: id, Kind: kind, Name: name, ParentID: parent, Path: v2Ptr(append([]string{}, path...))})
		r.definitions[v2Path(path)] = id
		endpoints := map[string]v2.Id{}
		for _, key := range []string{"start", "end"} {
			bid := v2.Id(fmt.Sprintf("def-%d", len(r.record.Definitions)+1))
			r.record.Definitions = append(r.record.Definitions, v2.Definition{ID: bid, Kind: "boundary", Name: key, ParentID: v2Ptr(id), Key: v2Ptr(key)})
			endpoints[key] = bid
		}
		for _, node := range graph.Nodes {
			nodePath := append(append([]string{}, path...), node.ID)
			var nid v2.Id
			if node.Workflow != nil {
				nestedKind := v2Kind(node.Component)
				if nestedKind != "workflow" {
					nestedKind = "graph"
				}
				nid = visit(*node.Workflow, nodePath, &id, nestedKind)
			} else {
				nid = v2.Id(fmt.Sprintf("def-%d", len(r.record.Definitions)+1))
				name := node.Name
				if name == "" {
					name = node.ID
				}
				definition := v2.Definition{ID: nid, Kind: v2Kind(node.Component), Name: name, ParentID: &id, Key: v2Ptr(node.ID), Path: &nodePath}
				if node.Component != "" {
					definition.Component = &node.Component
				}
				if node.Kind != "" {
					definition.SemanticKind = v2Ptr(string(node.Kind))
				}
				r.record.Definitions = append(r.record.Definitions, definition)
				r.definitions[v2Path(nodePath)] = nid
			}
			endpoints[node.ID] = nid
		}
		edges := []v2.Edge{}
		for _, edge := range graph.Edges {
			for _, channel := range edge.Channels {
				item := v2.Edge{ID: v2.Id(fmt.Sprintf("edge-%d", len(edges)+1)), From: endpoints[edge.From], To: endpoints[edge.To], Kind: channel}
				if channel == "data" && len(edge.Mappings) > 0 {
					mappings := []v2.FieldMapping{}
					for _, mapping := range edge.Mappings {
						mappings = append(mappings, v2.FieldMapping{SourcePath: v2Pointer(mapping.FromPath), TargetPath: v2Pointer(mapping.ToPath)})
					}
					item.Mappings = &mappings
				}
				edges = append(edges, item)
			}
		}
		for i, branch := range graph.Branches {
			for _, target := range branch.Targets {
				edges = append(edges, v2.Edge{ID: v2.Id(fmt.Sprintf("edge-%d", len(edges)+1)), From: endpoints[branch.From], To: endpoints[target], Kind: "candidate", BranchKey: v2Ptr(fmt.Sprintf("branch-%d", i+1))})
			}
		}
		r.record.Definitions[index].Edges = &edges
		return id
	}
	kind := r.record.Run.Source
	if kind == "application" || kind == "agent" {
		kind = "graph"
	}
	visit(graph, nil, nil, kind)
}
func v2Pointer(path []string) string {
	result := ""
	for _, segment := range path {
		result += "/" + strings.ReplaceAll(strings.ReplaceAll(segment, "~", "~0"), "/", "~1")
	}
	return result
}
func (r *nativeV2Recorder) snapshot() (v2.RunRecord, error) {
	if r == nil {
		return v2.RunRecord{}, ErrV2NotEnabled
	}
	r.mu.Lock()
	drained := r.agentDrained
	done := append([]chan struct{}{}, r.agentDone...)
	r.mu.Unlock()
	if drained {
		// Synchronize only copies registered before this export after the caller
		// drained a non-streaming root. Detached children cannot block sealing.
		timer := time.NewTimer(250 * time.Millisecond)
		defer timer.Stop()
	waitCopies:
		for _, completed := range done {
			select {
			case <-completed:
			case <-timer.C:
				break waitCopies
			}
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		var result v2.RunRecord
		err := json.Unmarshal(r.sealed, &result)
		return result, err
	}
	if r.entryError != nil {
		return v2.RunRecord{}, r.entryError
	}
	if !validV2ID(string(r.record.Run.ID)) {
		return v2.RunRecord{}, fmt.Errorf("eino recorder: invalid v2 run ID")
	}
	if rootID := r.record.Run.RootInvocationID; rootID != nil {
		root := r.record.Invocations[r.byID[*rootID]]
		r.record.Run.Status = root.Status
		r.record.Run.Timing = root.Timing
		if root.Status == "succeeded" || root.Status == "failed" || root.Status == "cancelled" {
			for _, call := range r.record.Invocations {
				if call.Status == "running" || call.Status == "unknown" {
					r.issue("unfinished_child", "Root ended while a child invocation has no observed terminal boundary.", v2Ref("invocation", call.ID))
				}
			}
		}
	} else if len(r.record.Invocations) > 0 {
		return v2.RunRecord{}, fmt.Errorf("eino recorder: no explicit root invocation observed")
	}
	r.record.Run.SealedAtMs = v2Number(time.Now().UnixMilli())
	data, err := json.Marshal(r.record)
	if err != nil {
		return v2.RunRecord{}, err
	}
	var result v2.RunRecord
	err = json.Unmarshal(data, &result)
	if err == nil {
		r.sealed = append([]byte(nil), data...)
	}
	return result, err
}

// The wrapper is a single handler: Eino guarantees start/end context continuity
// within that handler, without depending on ordering among separate handlers.
type nativeV2Handler struct {
	recorder *nativeV2Recorder
	legacy   callbacks.Handler
}

var _ callbacks.TimingChecker = (*nativeV2Handler)(nil)

// Needed is queried by Eino before allocating callback stream copies. A
// manually observed model needs this wrapper only when the legacy handler needs
// that timing; the native On* guards remain necessary for direct handler calls.
func (h *nativeV2Handler) Needed(ctx context.Context, info *callbacks.RunInfo, timing callbacks.CallbackTiming) bool {
	return !skipV2ChatModel(ctx, info) || h.needed(ctx, info, timing)
}

func (r *nativeV2Recorder) wrap(legacy callbacks.Handler) callbacks.Handler {
	if r == nil {
		return legacy
	}
	return &nativeV2Handler{r, legacy}
}
func (h *nativeV2Handler) OnStart(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
	if !skipV2ChatModel(ctx, info) {
		ctx = h.recorder.safeStart(ctx, info, input, false)
	}
	if h.needed(ctx, info, callbacks.TimingOnStart) {
		return h.legacy.OnStart(ctx, info, input)
	}
	return ctx
}
func (h *nativeV2Handler) OnEnd(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
	if !skipV2ChatModel(ctx, info) {
		h.recorder.safeEnd(ctx, info, output, false, nil)
	}
	if h.needed(ctx, info, callbacks.TimingOnEnd) {
		return h.legacy.OnEnd(ctx, info, output)
	}
	return ctx
}
func (h *nativeV2Handler) OnError(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
	if !skipV2ChatModel(ctx, info) {
		h.recorder.safeEnd(ctx, info, nil, false, err)
	}
	if h.needed(ctx, info, callbacks.TimingOnError) {
		return h.legacy.OnError(ctx, info, err)
	}
	return ctx
}
func (h *nativeV2Handler) OnStartWithStreamInput(ctx context.Context, info *callbacks.RunInfo, input *schema.StreamReader[callbacks.CallbackInput]) context.Context {
	if !skipV2ChatModel(ctx, info) {
		ctx = h.recorder.safeStart(ctx, info, nil, true)
	}
	if h.needed(ctx, info, callbacks.TimingOnStartWithStreamInput) {
		return h.legacy.OnStartWithStreamInput(ctx, info, input)
	}
	if input != nil {
		input.Close()
	}
	return ctx
}
func (h *nativeV2Handler) OnEndWithStreamOutput(ctx context.Context, info *callbacks.RunInfo, output *schema.StreamReader[callbacks.CallbackOutput]) context.Context {
	if !skipV2ChatModel(ctx, info) {
		h.recorder.safeEnd(ctx, info, nil, true, nil)
	}
	if h.needed(ctx, info, callbacks.TimingOnEndWithStreamOutput) {
		return h.legacy.OnEndWithStreamOutput(ctx, info, output)
	}
	if output != nil {
		output.Close()
	}
	return ctx
}

func (h *nativeV2Handler) needed(ctx context.Context, info *callbacks.RunInfo, timing callbacks.CallbackTiming) bool {
	if checker, ok := h.legacy.(callbacks.TimingChecker); ok {
		return checker.Needed(ctx, info, timing)
	}
	return true
}

func (r *nativeV2Recorder) guard() {
	if recover() != nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.sealed != nil {
			return
		}
		r.issue("recorder_panic", "Recorder could not safely inspect a runtime value.", v2Ref("run", r.record.Run.ID))
	}
}
func (r *nativeV2Recorder) safeStart(ctx context.Context, info *callbacks.RunInfo, input any, streaming bool) (result context.Context) {
	result = ctx
	defer r.guard()
	return r.start(ctx, info, input, streaming)
}
func (r *nativeV2Recorder) safeEnd(ctx context.Context, info *callbacks.RunInfo, output any, streaming bool, err error) {
	defer r.guard()
	r.end(ctx, info, output, streaming, err)
}

// Retain unsafe numeric tokens as diagnostic text, never silently round or
// coerce individual business fields to strings inside the original body.
func v2SafeNumbers(raw json.RawMessage) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(value any) bool {
		switch typed := value.(type) {
		case json.Number:
			n, err := strconv.ParseFloat(string(typed), 64)
			return err == nil && !math.IsInf(n, 0) && !(math.Trunc(n) == n && math.Abs(n) > 9007199254740991)
		case map[string]any:
			for _, child := range typed {
				if !visit(child) {
					return false
				}
			}
		case []any:
			for _, child := range typed {
				if !visit(child) {
					return false
				}
			}
		}
		return true
	}
	return visit(value)
}

func (r *nativeV2Recorder) rootEvent(event *adk.AgentEvent) {
	if r == nil || event == nil {
		return
	}
	defer r.guard()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if r.record.Run.RootInvocationID == nil {
		r.entryError = fmt.Errorf("eino recorder v2: standalone RecordEvent is a legacy source API; use Run or Query")
		return
	}
	r.rootError = nil
	if event.Err != nil {
		id := *r.record.Run.RootInvocationID
		r.captureError(id, event.Err)
		r.rootError = r.record.Invocations[r.byID[id]].Error
	}
}
func (r *nativeV2Recorder) rejectEntry(message string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if r.entryError == nil {
		r.entryError = fmt.Errorf("eino recorder v2: %s", message)
	}
}
func (r *nativeV2Recorder) requireRootForWrap() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if r.record.Run.RootInvocationID == nil || !r.rootBound && r.record.Invocations[0].Parent.State != "root" {
		r.entryError = fmt.Errorf("eino recorder v2: Wrap-only recording is unsupported; use Run or Query to establish the explicit root boundary")
	}
}
func (r *nativeV2Recorder) requireRootForExplicitRecord() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed != nil {
		return
	}
	if r.record.Run.RootInvocationID == nil {
		r.entryError = fmt.Errorf("eino recorder v2: standalone RecordMessage is a legacy source API; use Run or Query to capture the full root input")
	}
}
