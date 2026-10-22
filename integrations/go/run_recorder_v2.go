package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
	v2 "github.com/silicon-nora/eino-viewer/integrations/go/protocolv2"
)

// RunRecorderV2 records explicit application boundaries and Eino children in one
// native document. It is an extension point for application-owned model clients,
// state operations and diagnostics; it does not manufacture them from v1 data.
type RunRecorderV2 struct{ native *nativeV2Recorder }
type RunRecorderV2Options struct {
	Source   string
	Scope    string
	Envelope EnvelopeOptions
	// ExplicitContentRedactor applies to caller-projected contents, event
	// attributes and annotations. Nil uses Envelope.Policy.Redact. Automatic
	// component I/O always keeps Envelope.Policy.Redact and all size limits.
	ExplicitContentRedactor Redactor
}

// InvocationStartV2 makes absence and an observed JSON null distinct.
type InvocationStartV2 struct {
	Kind     string
	Name     string
	HasInput bool
	Input    any
}
type InvocationEndV2 struct {
	Status    v2.Status
	HasOutput bool
	Output    any
	Error     error
}

// ModelUsageV2 fields describe the actual request; never fill provider/model
// from an application default unless that configuration was applied to it.
type ModelUsageV2 struct {
	Provider, Model, RequestID                         string
	Source                                             string
	Input, Output, Total, InputCached, OutputReasoning *int64
}

func NewRunRecorderV2(runID string, options RunRecorderV2Options) (*RunRecorderV2, error) {
	if options.Source == "" {
		options.Source = "application"
	}
	if !oneOfV2(options.Source, "application", "agent", "graph", "workflow") {
		return nil, fmt.Errorf("invalid v2 run source")
	}
	if !validV2ID(runID) {
		return nil, fmt.Errorf("invalid v2 run ID")
	}
	if options.Scope == "" {
		options.Scope = "application"
	}
	if !validV2ID(options.Scope) {
		return nil, fmt.Errorf("invalid v2 scope")
	}
	native := newNativeV2(runID, options.Source, options.Envelope, false)
	native.explicitRedactor = options.ExplicitContentRedactor
	native.record.Run.Scope = v2.Id(options.Scope)
	return &RunRecorderV2{native}, nil
}
func oneOfV2(value string, values ...string) bool {
	for _, allowed := range values {
		if value == allowed {
			return true
		}
	}
	return false
}
func validV2ID(value string) bool {
	return value != "" && len(value) <= 256 && strings.IndexFunc(value, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' }) < 0
}

// Begin returns the exact invocation context for End, child Begin calls, and
// Eino Invoke. Reuse the returned context, rather than correlating by name.
func (r *RunRecorderV2) Begin(ctx context.Context, start InvocationStartV2) (context.Context, v2.Id, error) {
	if r == nil || r.native == nil {
		return ctx, "", ErrV2NotEnabled
	}
	if !oneOfV2(start.Kind, "application", "workflow", "graph", "agent", "node", "model", "tool", "operation") || strings.TrimSpace(start.Name) == "" {
		return ctx, "", fmt.Errorf("invalid invocation kind or name")
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return ctx, "", ErrV2Sealed
	}
	frame, _ := ctx.Value(v2ContextKey{n}).(v2Frame)
	parent := v2.Parent{State: "known", InvocationID: v2Ptr(frame.id)}
	if frame.id == "" {
		if n.record.Run.RootInvocationID != nil {
			return ctx, "", fmt.Errorf("root already exists; pass the parent invocation context")
		}
		if start.Kind != n.record.Run.Source {
			return ctx, "", fmt.Errorf("root kind must match run source")
		}
		parent = v2.Parent{State: "root"}
	}
	id := n.newInvocation(start.Kind, start.Name, parent, nil)
	// Explicit application operations have no declared graph position.
	n.record.Invocations[n.byID[id]].DefinitionID = nil
	if start.HasInput {
		n.capture(ctx, id, &callbacks.RunInfo{Component: "Lambda"}, ComponentIOInput, false, start.Input, true)
	}
	return context.WithValue(ctx, v2ContextKey{n}, v2Frame{id: id, identity: "manual:" + string(id)}), id, nil
}
func (r *RunRecorderV2) End(ctx context.Context, end InvocationEndV2) error {
	if r == nil || r.native == nil {
		return ErrV2NotEnabled
	}
	if !oneOfV2(string(end.Status), "succeeded", "failed", "cancelled", "interrupted", "unknown") {
		return fmt.Errorf("End requires an explicit terminal or unknown status")
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return ErrV2Sealed
	}
	frame, _ := ctx.Value(v2ContextKey{n}).(v2Frame)
	index, ok := n.byID[frame.id]
	if !ok || frame.identity != "manual:"+string(frame.id) {
		return fmt.Errorf("End requires the context returned by Begin")
	}
	if n.record.Invocations[index].Status != "running" {
		return fmt.Errorf("invocation already ended")
	}
	if end.Error != nil && end.Status == "succeeded" {
		return fmt.Errorf("succeeded invocation cannot carry an execution error")
	}
	if end.HasOutput {
		n.capture(ctx, frame.id, &callbacks.RunInfo{Component: "Lambda"}, ComponentIOOutput, false, end.Output, true)
	}
	n.finish(frame.id, end.Status, end.Error)
	return nil
}

// RecordModelUsage keeps one ledger row per actual model invocation. Non-nil
// counters replace prior observations, nil preserves known counters, and counts
// are never added. The merged row is validated before any change is committed.
func (r *RunRecorderV2) RecordModelUsage(ctx context.Context, usage ModelUsageV2) error {
	if r == nil || r.native == nil {
		return ErrV2NotEnabled
	}
	if !oneOfV2(usage.Source, "provider", "measured", "estimated", "unknown") {
		return fmt.Errorf("invalid usage source")
	}
	for _, number := range []*int64{usage.Input, usage.Output, usage.Total, usage.InputCached, usage.OutputReasoning} {
		if number != nil && (*number < 0 || *number > 9007199254740991) {
			return fmt.Errorf("token count outside safe integer range")
		}
		if number != nil && usage.Source == "unknown" {
			return fmt.Errorf("unknown usage must have no token counts")
		}
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return ErrV2Sealed
	}
	frame, _ := ctx.Value(v2ContextKey{n}).(v2Frame)
	index, ok := n.byID[frame.id]
	if !ok || n.record.Invocations[index].Kind != "model" {
		return fmt.Errorf("usage requires an actual model invocation context")
	}
	for i := range n.record.Usage {
		prior := n.record.Usage[i]
		if prior.InvocationID != frame.id {
			continue
		}
		merged := prior
		if usage.Source != "unknown" {
			merged.Source = usage.Source
		}
		for _, counter := range []struct {
			target   **json.Number
			observed *int64
		}{
			{&merged.Tokens.Input, usage.Input}, {&merged.Tokens.Output, usage.Output},
			{&merged.Tokens.Total, usage.Total}, {&merged.Tokens.InputCached, usage.InputCached},
			{&merged.Tokens.OutputReasoning, usage.OutputReasoning},
		} {
			if counter.observed != nil {
				*counter.target = v2OptionalNumber(counter.observed)
			}
		}
		if err := validateV2TokenCounts(merged.Tokens); err != nil {
			return err
		}
		merged.Completeness = "unknown"
		for _, counter := range []*json.Number{merged.Tokens.Input, merged.Tokens.Output, merged.Tokens.Total, merged.Tokens.InputCached, merged.Tokens.OutputReasoning} {
			if counter != nil {
				merged.Completeness = "partial"
			}
		}
		if merged.Tokens.Input != nil && merged.Tokens.Output != nil && merged.Tokens.Total != nil {
			merged.Completeness = "complete"
		}
		if usage.Provider != "" {
			merged.Provider = v2Ptr(usage.Provider)
		}
		if usage.Model != "" {
			merged.Model = v2Ptr(usage.Model)
		}
		if usage.RequestID != "" {
			merged.RequestID = v2Ptr(usage.RequestID)
		}
		n.record.Usage[i] = merged
		return nil
	}
	return fmt.Errorf("model ledger row is missing")
}

func validateV2TokenCounts(tokens v2.TokenCounts) error {
	value := func(number *json.Number) int64 {
		if number == nil {
			return 0
		}
		result, _ := number.Int64()
		return result
	}
	input, output := value(tokens.Input), value(tokens.Output)
	if tokens.Input != nil && tokens.Output != nil && tokens.Total != nil && value(tokens.Total) != input+output {
		return fmt.Errorf("total tokens do not equal input plus output")
	}
	if tokens.InputCached != nil && tokens.Input != nil && value(tokens.InputCached) > input {
		return fmt.Errorf("cached input exceeds input")
	}
	if tokens.OutputReasoning != nil && tokens.Output != nil && value(tokens.OutputReasoning) > output {
		return fmt.Errorf("reasoning output exceeds output")
	}
	if value(tokens.InputCached) > input {
		input = value(tokens.InputCached)
	}
	if value(tokens.OutputReasoning) > output {
		output = value(tokens.OutputReasoning)
	}
	if tokens.Total != nil && value(tokens.Total) < input+output {
		return fmt.Errorf("total tokens are below observed input/output bounds")
	}
	return nil
}
func v2OptionalNumber(value *int64) *json.Number {
	if value == nil {
		return nil
	}
	return v2Ptr(v2Number(*value))
}

// Annotate snapshots a namespaced business payload under the same safe body
// policy. The authoritative JS validator checks registered annotation schemas.
func (r *RunRecorderV2) Annotate(ctx context.Context, annotationType string, version int, payload any) (v2.Id, error) {
	if r == nil || r.native == nil {
		return "", ErrV2NotEnabled
	}
	if !validV2ID(annotationType) || version < 1 || float64(version) > math.Pow(2, 53)-1 {
		return "", fmt.Errorf("invalid annotation type/version")
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return "", ErrV2Sealed
	}
	frame, _ := ctx.Value(v2ContextKey{n}).(v2Frame)
	if _, ok := n.byID[frame.id]; !ok {
		return "", fmt.Errorf("annotation requires an invocation context")
	}
	return n.annotate(ctx, v2Ref("invocation", frame.id), annotationType, version, payload)
}

// annotate is called only while the native recorder lock is held.
func (n *nativeV2Recorder) annotate(ctx context.Context, owner v2.Ref, annotationType string, version int, payload any) (v2.Id, error) {
	envelope, diagnostics, err := safeComponentIO(ctx, &callbacks.RunInfo{Component: "Lambda"}, ComponentIOInput, false, payload, "root", n.explicitOptions())
	if err != nil {
		return "", err
	}
	var value map[string]json.RawMessage
	if err = json.Unmarshal(envelope.Payload, &value); err != nil {
		return "", err
	}
	body, ok := value["body"]
	if ok && !v2SafeNumbers(body) {
		n.issue("annotation_omitted", "Business annotation contains unsupported numbers.", owner)
		return "", ErrUnsafeJSON
	}
	if !ok {
		n.issue("annotation_omitted", "Business annotation body could not be safely captured.", owner)
		return "", ErrUnsafeJSON
	}
	for _, d := range diagnostics {
		n.issue(d.Code, d.Message, owner)
	}
	id := v2.Id(fmt.Sprintf("annotation-%d", len(n.record.Annotations)+1))
	n.record.Annotations = append(n.record.Annotations, v2.Annotation{ID: id, Owner: owner, Type: annotationType, SchemaVersion: v2Number(int64(version)), Payload: body})
	return id, nil
}
func (r *RunRecorderV2) Handler() callbacks.Handler {
	return r.native.wrap(callbacks.NewHandlerBuilder().Build())
}
func (r *RunRecorderV2) InvokeOption() compose.Option { return compose.WithCallbacks(r.Handler()) }
func (r *RunRecorderV2) OnFinish(_ context.Context, info *compose.GraphInfo) {
	r.native.definition(info, ProjectOptions{})
}
func (r *RunRecorderV2) CompileOption() compose.GraphCompileOption {
	return compose.WithGraphCompileCallbacks(r)
}
func (r *RunRecorderV2) RunRecordV2() (v2.RunRecord, error)  { return r.native.snapshot() }
func (r *RunRecorderV2) MarshalRunRecordV2() ([]byte, error) { return marshalNativeV2(r.native) }
