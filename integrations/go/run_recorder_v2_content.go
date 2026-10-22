package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/eino/callbacks"
	v2 "github.com/silicon-nora/eino-viewer/integrations/go/protocolv2"
)

// ContentV2 uses the generated wire descriptor, including explicit null,
// missing/reference bodies, provenance, completeness and transforms. ID is
// assigned by the recorder. An empty Owner uses the current invocation.
// InputOf/OutputOf bind this same immutable content to actual consumers/results;
// state and diagnostic references can also be recorded in events and relations.
type ContentV2 struct {
	v2.Content
	InputOf, OutputOf []v2.Id
}

type skipChatModelV2Key struct{}

// SkipChatModelCallbacks suppresses only native v2 ChatModel/AgenticModel
// observations in this context. All five legacy callback timings still run.
// Use it inside a manually observed model boundary to avoid duplicate usage.
func SkipChatModelCallbacks(ctx context.Context) context.Context {
	return context.WithValue(ctx, skipChatModelV2Key{}, true)
}
func skipV2ChatModel(ctx context.Context, info *callbacks.RunInfo) bool {
	skip, _ := ctx.Value(skipChatModelV2Key{}).(bool)
	return skip && info != nil && v2Kind(string(info.Component)) == "model"
}

func (r *RunRecorderV2) CurrentInvocationID(ctx context.Context) (v2.Id, bool) {
	if r == nil || r.native == nil {
		return "", false
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	frame, _ := ctx.Value(v2ContextKey{n}).(v2Frame)
	_, ok := n.byID[frame.id]
	return frame.id, ok
}

// DefinitionID resolves a complete node path from this recorder's own compile
// callback. It does not resolve a name or another GraphInfo's definition IDs.
func (r *RunRecorderV2) DefinitionID(path []string) (v2.Id, bool) {
	if r == nil || r.native == nil {
		return "", false
	}
	r.native.mu.Lock()
	defer r.native.mu.Unlock()
	id, ok := r.native.definitions[v2Path(path)]
	return id, ok
}

func (r *RunRecorderV2) RecordContent(ctx context.Context, observed ContentV2) (v2.Id, error) {
	if r == nil || r.native == nil {
		return "", ErrV2NotEnabled
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return "", ErrV2Sealed
	}
	content, err := cloneWireV2(observed.Content)
	if err != nil {
		return "", err
	}
	content.Owner, err = n.owner(ctx, content.Owner)
	if err != nil {
		return "", err
	}
	for _, ids := range [][]v2.Id{observed.InputOf, observed.OutputOf} {
		for _, id := range ids {
			if _, exists := n.byID[id]; !exists {
				return "", fmt.Errorf("content binding requires an observed invocation")
			}
		}
	}
	if content.MediaType == "" || content.Role == "" || content.Provenance == "" || content.Completeness == "" {
		return "", fmt.Errorf("content requires explicit role, media type, provenance and completeness")
	}
	if content.Transforms == nil {
		content.Transforms = []v2.Transform{}
	}
	switch content.Data.Availability {
	case "inline":
		body, redacted, reason, err := n.explicitJSON(ctx, content.Data.Value)
		if err != nil {
			return "", err
		}
		if reason != "" {
			content.Data = v2.ContentData{Availability: "missing", Reason: v2Ptr(reason)}
			content.Completeness = "unknown"
			n.issue("body_omitted", "Explicit content body was omitted by the safe-body policy.", content.Owner)
		} else {
			content.Data.Value = body
		}
		if redacted {
			content.Transforms = append(content.Transforms, v2.Transform{Kind: "redacted", Reason: "configured_redactor"})
		}
	case "missing":
		if content.Data.Reason == nil || strings.TrimSpace(*content.Data.Reason) == "" || content.Completeness != "unknown" {
			return "", fmt.Errorf("missing content requires a reason and unknown completeness")
		}
	case "reference":
		if content.Data.Key == nil || content.Data.SHA256 == nil || content.Data.ByteLength == nil {
			return "", fmt.Errorf("referenced content requires key, digest and byte length")
		}
	default:
		return "", fmt.Errorf("content requires explicit availability")
	}
	content.ID = v2.Id(fmt.Sprintf("content-%d", len(n.record.Contents)+1))
	n.record.Contents = append(n.record.Contents, content)
	for _, id := range observed.InputOf {
		index := n.byID[id]
		n.record.Invocations[index].InputRefs = appendIDV2(n.record.Invocations[index].InputRefs, content.ID)
	}
	for _, id := range observed.OutputOf {
		index := n.byID[id]
		n.record.Invocations[index].OutputRefs = appendIDV2(n.record.Invocations[index].OutputRefs, content.ID)
	}
	n.unknownOwner(content.Owner)
	return content.ID, nil
}

// RecordEvent retains the supplied event facts and allocates a run-local ID and
// merge sequence. AtMs may be omitted when the source timestamp is unknown.
func (r *RunRecorderV2) RecordEvent(ctx context.Context, observed v2.Event) (v2.Id, error) {
	if r == nil || r.native == nil {
		return "", ErrV2NotEnabled
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return "", ErrV2Sealed
	}
	event, err := cloneWireV2(observed)
	if err != nil {
		return "", err
	}
	if !validV2ID(string(event.Type)) {
		return "", fmt.Errorf("invalid event type")
	}
	event.Owner, err = n.owner(ctx, event.Owner)
	if err != nil {
		return "", err
	}
	for _, id := range event.ContentRefs {
		if err = n.checkRef(v2Ref("content", id), false); err != nil {
			return "", err
		}
	}
	if event.TargetDefinitionIDs != nil {
		for _, id := range *event.TargetDefinitionIDs {
			if err = n.checkRef(v2Ref("definition", id), false); err != nil {
				return "", err
			}
		}
	}
	if event.Attributes != nil {
		raw, err := json.Marshal(event.Attributes)
		if err != nil {
			return "", err
		}
		body, _, reason, err := n.explicitJSON(ctx, raw)
		if err != nil {
			return "", err
		}
		if reason != "" {
			return "", fmt.Errorf("event attributes omitted: %s", reason)
		}
		var attrs v2.JsonObject
		if err = json.Unmarshal(body, &attrs); err != nil || attrs == nil {
			return "", ErrUnsafeJSON
		}
		event.Attributes = &attrs
	}
	sequence := len(n.record.Events) + 1
	event.ID, event.Sequence = v2.Id(fmt.Sprintf("event-%d", sequence)), v2Number(int64(sequence))
	if event.ContentRefs == nil {
		event.ContentRefs = []v2.Id{}
	}
	n.record.Events = append(n.record.Events, event)
	n.unknownOwner(event.Owner)
	return event.ID, nil
}

func (r *RunRecorderV2) RecordRelation(observed v2.Relation) (v2.Id, error) {
	if r == nil || r.native == nil {
		return "", ErrV2NotEnabled
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return "", ErrV2Sealed
	}
	relation, err := cloneWireV2(observed)
	if err != nil {
		return "", err
	}
	if !oneOfV2(relation.Type, "caused_by", "responds_to", "transfers_to", "repairs", "derived_from", "reads", "writes", "follows") {
		return "", fmt.Errorf("invalid relation type")
	}
	for _, ref := range []v2.Ref{relation.From, relation.To} {
		if err = n.checkRef(ref, false); err != nil {
			return "", err
		}
	}
	if relation.EvidenceEventID != nil {
		if err = n.checkRef(v2Ref("event", *relation.EvidenceEventID), false); err != nil {
			return "", err
		}
	}
	relation.ID = v2.Id(fmt.Sprintf("relation-%d", len(n.record.Relations)+1))
	n.record.Relations = append(n.record.Relations, relation)
	return relation.ID, nil
}

// AnnotateOwner supports run/event/content and other explicit local owners.
// Registered business payloads still require the shared JS profile validator.
func (r *RunRecorderV2) AnnotateOwner(owner v2.Ref, annotationType string, version int, payload any) (v2.Id, error) {
	if r == nil || r.native == nil {
		return "", ErrV2NotEnabled
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return "", ErrV2Sealed
	}
	if !validV2ID(annotationType) || version < 1 || uint64(version) > 9007199254740991 {
		return "", fmt.Errorf("invalid annotation type/version")
	}
	if err := n.checkRef(owner, true); err != nil {
		return "", err
	}
	copy, err := cloneWireV2(owner)
	if err != nil {
		return "", err
	}
	id, err := n.annotate(context.Background(), copy, annotationType, version, payload)
	if err == nil {
		n.unknownOwner(copy)
	}
	return id, err
}

func (r *RunRecorderV2) SetCorrelation(values map[string]string) error {
	return r.setRunMap(values, true)
}
func (r *RunRecorderV2) SetLabels(values map[string]string) error {
	return r.setRunMap(values, false)
}
func (r *RunRecorderV2) setRunMap(values map[string]string, correlation bool) error {
	if r == nil || r.native == nil {
		return ErrV2NotEnabled
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return ErrV2Sealed
	}
	var value *map[string]string
	if values != nil {
		copy := cloneStringMap(values)
		value = &copy
	}
	if correlation {
		n.record.Run.Correlation = value
	} else {
		n.record.Run.Labels = value
	}
	return nil
}

// SetCapture replaces declared coverage and adds caller-observed gaps. Existing
// recorder gaps are retained, so complete cannot erase a previous loss of facts.
func (r *RunRecorderV2) SetCapture(observed v2.Capture) error {
	if r == nil || r.native == nil {
		return ErrV2NotEnabled
	}
	n := r.native
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.sealed != nil {
		return ErrV2Sealed
	}
	capture, err := cloneWireV2(observed)
	if err != nil {
		return err
	}
	if !oneOfV2(capture.State, "complete", "partial") || capture.State == "partial" && len(capture.Issues) == 0 || capture.State == "complete" && len(capture.Issues) > 0 {
		return fmt.Errorf("capture state must agree with its issues")
	}
	for _, issue := range capture.Issues {
		if !validV2ID(string(issue.Code)) || strings.TrimSpace(issue.Message) == "" {
			return fmt.Errorf("capture issue requires code and message")
		}
		if issue.Owner != nil {
			if err := n.checkRef(*issue.Owner, true); err != nil {
				return err
			}
		}
	}
	n.record.Run.Capture.Coverage = []string{}
	for _, domain := range capture.Coverage {
		n.addCoverage(domain)
	}
	for _, issue := range capture.Issues {
		n.record.Run.Capture.Issues = append(n.record.Run.Capture.Issues, issue)
	}
	n.record.Run.Capture.State = "complete"
	if len(n.record.Run.Capture.Issues) > 0 {
		n.record.Run.Capture.State = "partial"
	}
	return nil
}

func (n *nativeV2Recorder) addCoverage(domain string) {
	for _, prior := range n.record.Run.Capture.Coverage {
		if prior == domain {
			return
		}
	}
	n.record.Run.Capture.Coverage = append(n.record.Run.Capture.Coverage, domain)
}
func appendIDV2(ids []v2.Id, id v2.Id) []v2.Id {
	for _, prior := range ids {
		if prior == id {
			return ids
		}
	}
	return append(ids, id)
}
func cloneWireV2[T any](value T) (T, error) {
	var result T
	data, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(data, &result)
	}
	return result, err
}
func (n *nativeV2Recorder) owner(ctx context.Context, owner v2.Ref) (v2.Ref, error) {
	if owner.Kind == "" {
		frame, _ := ctx.Value(v2ContextKey{n}).(v2Frame)
		owner = v2Ref("invocation", frame.id)
	}
	return owner, n.checkRef(owner, true)
}
func (n *nativeV2Recorder) unknownOwner(owner v2.Ref) {
	if owner.Kind == "unknown" {
		n.issue("unknown_owner", "Observed fact has no known local owner.", v2Ref("run", n.record.Run.ID))
	}
}
func (n *nativeV2Recorder) checkRef(ref v2.Ref, allowUnknown bool) error {
	if ref.Kind == "unknown" && allowUnknown && ref.ID == nil && ref.Reason != nil && strings.TrimSpace(*ref.Reason) != "" {
		return nil
	}
	if ref.ID == nil || ref.Reason != nil || !validV2ID(string(*ref.ID)) {
		return fmt.Errorf("reference requires a valid local identity")
	}
	id := *ref.ID
	found := false
	switch ref.Kind {
	case "run":
		found = n.record.Run.ID == id
	case "invocation":
		_, found = n.byID[id]
	case "definition":
		for _, value := range n.record.Definitions {
			found = found || value.ID == id
		}
	case "content":
		for _, value := range n.record.Contents {
			found = found || value.ID == id
		}
	case "event":
		for _, value := range n.record.Events {
			found = found || value.ID == id
		}
	case "annotation":
		for _, value := range n.record.Annotations {
			found = found || value.ID == id
		}
	case "usage":
		for _, value := range n.record.Usage {
			found = found || value.ID == id
		}
	}
	if !found {
		return fmt.Errorf("reference does not resolve in this run")
	}
	return nil
}

// explicitJSON applies the same bounded safe-body policy to supplied JSON wire
// values. Raw JSON is checked before decoding; application marshalers are never
// called. Unchanged raw values preserve their original numeric spelling.
func (n *nativeV2Recorder) explicitJSON(ctx context.Context, raw json.RawMessage) (json.RawMessage, bool, string, error) {
	if !json.Valid(raw) || !v2SafeNumbers(raw) {
		return nil, false, "", ErrUnsafeJSON
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false, "", err
	}
	envelope, _, err := safeComponentIO(ctx, &callbacks.RunInfo{Component: "Lambda"}, ComponentIOInput, false, value, "root", n.explicitOptions())
	if err != nil {
		return nil, false, "", err
	}
	var payload map[string]json.RawMessage
	if err = json.Unmarshal(envelope.Payload, &payload); err != nil {
		return nil, false, "", err
	}
	var metadata struct {
		Capture struct {
			Reason   string `json:"reason"`
			Redacted bool   `json:"redacted"`
		} `json:"capture"`
	}
	if err = json.Unmarshal(envelope.Metadata, &metadata); err != nil {
		return nil, false, "", err
	}
	body, ok := payload["body"]
	if !ok {
		return nil, metadata.Capture.Redacted, metadata.Capture.Reason, nil
	}
	if !metadata.Capture.Redacted {
		body = append(json.RawMessage(nil), raw...)
	}
	if !v2SafeNumbers(body) {
		return nil, false, "", ErrUnsafeJSON
	}
	return body, metadata.Capture.Redacted, "", nil
}

func (n *nativeV2Recorder) explicitOptions() EnvelopeOptions {
	options := n.options
	if n.explicitRedactor != nil {
		options.Policy.Redact = n.explicitRedactor
	}
	return options
}

// ObservedEventTimeV2 is a convenience for callers observing an event now.
func ObservedEventTimeV2() *v2.UInt { return v2Ptr(v2Number(time.Now().UnixMilli())) }
