package einoworkflowsnapshot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	v2 "github.com/silicon-nora/eino-viewer/integrations/go/protocolv2"
)

func explicitTestContent(role, schemaRef string, body json.RawMessage) ContentV2 {
	content := ContentV2{Content: v2.Content{Role: role, MediaType: "application/json", Provenance: "observed", Completeness: "complete", Data: v2.ContentData{Availability: "inline", Value: body}}}
	if schemaRef != "" {
		content.SchemaRef = &schemaRef
	}
	return content
}

func TestNativeV2ExplicitPolicyKeepsAutomaticIORestricted(t *testing.T) {
	r, err := NewRunRecorderV2("explicit-policy", RunRecorderV2Options{
		Envelope: EnvelopeOptions{Policy: ProjectionPolicy{Redact: func(path []string, value any) (any, bool) {
			if len(path) > 0 && path[len(path)-1] == "body" {
				return map[string]any{}, true
			}
			return value, false
		}}},
		ExplicitContentRedactor: func(path []string, value any) (any, bool) {
			if len(path) > 0 && path[len(path)-1] == "secret" {
				return "[redacted]", true
			}
			return value, false
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, _, err := r.Begin(context.Background(), InvocationStartV2{Kind: "application", Name: "Generate", HasInput: true, Input: map[string]any{"secret": "automatic-secret"}})
	if err != nil {
		t.Fatal(err)
	}
	contentID, err := r.RecordContent(ctx, explicitTestContent("state", "", json.RawMessage(`[{"material":"中文","secret":"explicit-secret"}]`)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Annotate(ctx, "example.state", 1, map[string]any{"contentRef": contentID, "secret": "annotation-secret"}); err != nil {
		t.Fatal(err)
	}
	if err := r.End(ctx, InvocationEndV2{Status: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	raw, err := r.MarshalRunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"automatic-secret", "explicit-secret", "annotation-secret"} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("leaked %s", secret)
		}
	}
	if !bytes.Contains(raw, []byte("中文")) || !bytes.Contains(raw, []byte("[redacted]")) {
		t.Fatal("explicit projected material or redaction was lost")
	}
}

func TestNativeV2ApplicationWorkflowExplicitFacts(t *testing.T) {
	r, err := NewRunRecorderV2("explicit-facts", RunRecorderV2Options{})
	if err != nil {
		t.Fatal(err)
	}
	root, rootID, err := r.Begin(context.Background(), InvocationStartV2{Kind: "application", Name: "Generate"})
	if err != nil {
		t.Fatal(err)
	}
	correlation := map[string]string{"task_id": "9007199254740993"}
	if err := r.SetCorrelation(correlation); err != nil {
		t.Fatal(err)
	}
	correlation["task_id"] = "mutated"
	if err := r.SetLabels(map[string]string{"pipeline_version": "observed-version"}); err != nil {
		t.Fatal(err)
	}
	if err := r.SetCapture(v2.Capture{State: "complete", Coverage: []string{"invocations", "events", "io", "model", "state", "business"}}); err != nil {
		t.Fatal(err)
	}
	profile := explicitTestContent("state", "urn:eino:cloud-focus:1#/$defs/user-profile", json.RawMessage(`{"user_id":"100","nick_name":"Recorder test"}`))
	profileID, err := r.RecordContent(root, profile)
	if err != nil {
		t.Fatal(err)
	}
	missing := ContentV2{Content: v2.Content{Role: "diagnostic", MediaType: "application/json", Provenance: "observed", Completeness: "unknown", Data: v2.ContentData{Availability: "missing", Reason: v2Ptr("provider_did_not_supply_details")}}}
	missingID, err := r.RecordContent(root, missing)
	if err != nil {
		t.Fatal(err)
	}
	workflow := compose.NewWorkflow[string, string]()
	var modelID, routeEventID v2.Id
	workflow.AddLambdaNode("selector", compose.InvokableLambda(func(ctx context.Context, input string) (string, error) {
		if _, ok := r.CurrentInvocationID(ctx); !ok {
			return "", errors.New("missing actual node context")
		}
		definition, ok := r.DefinitionID([]string{"generate"})
		if !ok {
			return "", errors.New("definition lookup did not use compile GraphInfo")
		}
		routeEventID, err = r.RecordEvent(ctx, v2.Event{Type: "business.route-selected", AtMs: ObservedEventTimeV2(), TargetDefinitionIDs: &[]v2.Id{definition}, ContentRefs: []v2.Id{profileID}})
		if err != nil {
			return "", err
		}
		_, err = r.AnnotateOwner(v2Ref("event", routeEventID), "cloud-focus.route-decision", 1, map[string]any{"selectedDefinitionIds": []string{string(definition)}, "source": "policy", "effectiveIntent": "week_report", "requestedIntent": nil})
		return input, err
	})).AddInput(compose.START)
	workflow.AddLambdaNode("generate", compose.InvokableLambda(func(ctx context.Context, input string) (string, error) {
		modelCtx, id, err := r.Begin(ctx, InvocationStartV2{Kind: "model", Name: "Application model"})
		if err != nil {
			return "", err
		}
		modelID = id
		request := explicitTestContent("model-request", "", json.RawMessage(`["system","request"]`))
		request.InputOf = []v2.Id{id}
		if _, err = r.RecordContent(modelCtx, request); err != nil {
			return "", err
		}
		if _, err = r.RecordRelation(v2.Relation{Type: "reads", From: v2Ref("invocation", id), To: v2Ref("content", profileID)}); err != nil {
			return "", err
		}
		// The provider executes its real callback-enabled Generate method inside
		// an actual Workflow Lambda. Manual ownership suppresses only native v2.
		providerCtx := callbacks.ReuseHandlers(SkipChatModelCallbacks(modelCtx), &callbacks.RunInfo{Component: components.ComponentOfChatModel, Name: "actual-provider"})
		answer, err := (&nativeV2Model{direct: true}).Generate(providerCtx, []*schema.Message{schema.UserMessage(input)})
		if err != nil {
			return "", err
		}
		response := explicitTestContent("model-response", "", json.RawMessage(`"answer"`))
		response.OutputOf = []v2.Id{id}
		responseID, err := r.RecordContent(modelCtx, response)
		if err != nil {
			return "", err
		}
		partial := explicitTestContent("diagnostic", "urn:example:unknown-schema:9", json.RawMessage(`"ans"`))
		partial.Provenance, partial.Completeness = "projected", "partial"
		partial.Transforms = []v2.Transform{{Kind: "truncated", Reason: "test_preview", OriginalByteLength: v2Ptr(v2Number(8))}, {Kind: "redacted", Reason: "explicit_test_projection"}}
		partialID, err := r.RecordContent(ctx, partial)
		if err != nil {
			return "", err
		}
		if _, err = r.RecordRelation(v2.Relation{Type: "derived_from", From: v2Ref("content", partialID), To: v2Ref("content", responseID)}); err != nil {
			return "", err
		}
		if _, err = r.AnnotateOwner(v2Ref("invocation", id), "cloud-focus.validation", 1, map[string]any{"stage": "card", "status": "passed", "subjectContentRef": string(responseID), "modelInvocationId": string(id), "detailsContentRef": string(missingID), "repair": map[string]any{"status": "not_required", "attemptCount": 0}}); err != nil {
			return "", err
		}
		inputTokens, outputTokens, total := int64(10), int64(3), int64(13)
		if err = r.RecordModelUsage(modelCtx, ModelUsageV2{Source: "provider", Model: "actual-mock-model", Input: &inputTokens}); err != nil {
			return "", err
		}
		if err = r.RecordModelUsage(modelCtx, ModelUsageV2{Source: "provider", Output: &outputTokens, Total: &total}); err != nil {
			return "", err
		}
		return answer.Content, r.End(modelCtx, InvocationEndV2{Status: "succeeded"})
	})).AddInput("selector")
	workflow.End().AddInput("generate")
	runnable, err := workflow.Compile(root, r.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runnable.Invoke(root, "request", r.InvokeOption()); err != nil {
		t.Fatal(err)
	}
	result := explicitTestContent("result", "urn:eino:cloud-focus:1#/$defs/result-content", json.RawMessage(`{"items":[]}`))
	result.OutputOf = []v2.Id{rootID}
	resultID, err := r.RecordContent(root, result)
	if err != nil {
		t.Fatal(err)
	}
	resultAnnotationID, err := r.AnnotateOwner(v2Ref("run", "explicit-facts"), "cloud-focus.result", 1, map[string]any{"resultId": "observed-result", "version": 1, "status": "no_items", "contentRef": string(resultID), "itemIds": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.AnnotateOwner(v2Ref("run", "explicit-facts"), "cloud-focus.evaluation-context", 1, map[string]any{"resultAnnotationId": string(resultAnnotationID), "userProfileContentRef": string(profileID), "routeDecisionEventId": string(routeEventID), "scene": "weekly_report"}); err != nil {
		t.Fatal(err)
	}
	unknownPayload := map[string]any{"future": map[string]any{"preserve": []any{"value", nil, true}}}
	if _, err = r.AnnotateOwner(v2Ref("content", resultID), "example.unknown-extension", 27, unknownPayload); err != nil {
		t.Fatal(err)
	}
	unknownPayload["future"] = "mutated"
	if err = r.End(root, InvocationEndV2{Status: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	record, err := r.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Usage) != 1 || record.Usage[0].InvocationID != modelID || record.Usage[0].Completeness != "complete" {
		t.Fatal("manual model callbacks created duplicate/partial usage")
	}
	if (*record.Run.Correlation)["task_id"] != "9007199254740993" {
		t.Fatal("correlation was not snapshotted")
	}
	if !bytes.Contains(record.Annotations[len(record.Annotations)-1].Payload, []byte(`"preserve"`)) {
		t.Fatal("unknown annotation was changed")
	}
	requireV2Fixture(t, "application-explicit-facts", record)
}

func TestNativeV2SealedWritesAndLegacyCallbacks(t *testing.T) {
	r, _ := NewRunRecorderV2("sealed", RunRecorderV2Options{})
	ctx, id, err := r.Begin(context.Background(), InvocationStartV2{Kind: "application", Name: "Generate"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := r.MarshalRunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	assertSealed := func(err error) {
		t.Helper()
		if !errors.Is(err, ErrV2Sealed) {
			t.Fatalf("got %v, want ErrV2Sealed", err)
		}
	}
	_, _, err = r.Begin(ctx, InvocationStartV2{Kind: "model", Name: "late"})
	assertSealed(err)
	assertSealed(r.End(ctx, InvocationEndV2{Status: "succeeded"}))
	assertSealed(r.RecordModelUsage(ctx, ModelUsageV2{Source: "unknown"}))
	_, err = r.RecordContent(ctx, explicitTestContent("input", "", json.RawMessage(`null`)))
	assertSealed(err)
	_, err = r.RecordEvent(ctx, v2.Event{Type: "late"})
	assertSealed(err)
	_, err = r.RecordRelation(v2.Relation{Type: "follows", From: v2Ref("invocation", id), To: v2Ref("invocation", id)})
	assertSealed(err)
	_, err = r.Annotate(ctx, "example.future", 1, map[string]any{})
	assertSealed(err)
	_, err = r.AnnotateOwner(v2Ref("run", "sealed"), "example.future", 1, map[string]any{})
	assertSealed(err)
	assertSealed(r.SetCorrelation(map[string]string{}))
	assertSealed(r.SetLabels(map[string]string{}))
	assertSealed(r.SetCapture(v2.Capture{State: "complete"}))
	for _, sealed := range []bool{false, true} {
		recorder := r.native
		if !sealed {
			recorder = newNativeV2("filter", "application", EnvelopeOptions{}, false)
		}
		calls := 0
		legacy := callbacks.NewHandlerBuilder().OnStartFn(func(ctx context.Context, _ *callbacks.RunInfo, _ callbacks.CallbackInput) context.Context {
			calls++
			return ctx
		}).OnEndFn(func(ctx context.Context, _ *callbacks.RunInfo, _ callbacks.CallbackOutput) context.Context {
			calls++
			return ctx
		}).OnErrorFn(func(ctx context.Context, _ *callbacks.RunInfo, _ error) context.Context { calls++; return ctx }).OnStartWithStreamInputFn(func(ctx context.Context, _ *callbacks.RunInfo, _ *schema.StreamReader[callbacks.CallbackInput]) context.Context {
			calls++
			return ctx
		}).OnEndWithStreamOutputFn(func(ctx context.Context, _ *callbacks.RunInfo, _ *schema.StreamReader[callbacks.CallbackOutput]) context.Context {
			calls++
			return ctx
		}).Build()
		handler := recorder.wrap(legacy)
		filtered := SkipChatModelCallbacks(ctx)
		for _, component := range []components.Component{components.ComponentOfChatModel, "AgenticModel"} {
			info := &callbacks.RunInfo{Component: component}
			handler.OnStart(filtered, info, nil)
			handler.OnEnd(filtered, info, nil)
			handler.OnError(filtered, info, errors.New("error"))
			handler.OnStartWithStreamInput(filtered, info, nil)
			handler.OnEndWithStreamOutput(filtered, info, nil)
		}
		if calls != 10 {
			t.Fatal("v2 filtering suppressed a legacy timing")
		}
		if !sealed && (len(recorder.record.Invocations) != 0 || len(recorder.record.Events) != 0 || len(recorder.record.Usage) != 0) {
			t.Fatal("filtered native timings still wrote facts")
		}
	}
	r.OnFinish(ctx, nil)
	// Unfiltered late callbacks must also preserve the sealed document.
	r.Handler().OnStart(ctx, &callbacks.RunInfo{Component: "Lambda"}, "late")
	r.Handler().OnEnd(ctx, &callbacks.RunInfo{Component: "Lambda"}, "late")
	for i := 0; i < 10; i++ {
		record, err := r.RunRecordV2()
		if err != nil {
			t.Fatal(err)
		}
		record.Run.Status = "failed"
		record.Invocations[0].Name = "mutated"
		again, err := r.MarshalRunRecordV2()
		if err != nil || !bytes.Equal(first, again) {
			t.Fatalf("sealed export changed: %v", err)
		}
	}
}

func TestNativeV2ConcurrentExplicitFactsAndCaptureGaps(t *testing.T) {
	r, _ := NewRunRecorderV2("concurrent", RunRecorderV2Options{})
	ctx, _, _ := r.Begin(context.Background(), InvocationStartV2{Kind: "application", Name: "Generate"})
	var group sync.WaitGroup
	for i := 0; i < 32; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := r.RecordContent(ctx, explicitTestContent("state", "", json.RawMessage(`null`))); err != nil {
				t.Error(err)
			}
			if _, err := r.RecordEvent(ctx, v2.Event{Type: "state.observed"}); err != nil {
				t.Error(err)
			}
			if err := r.SetLabels(map[string]string{"version": "1"}); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	if err := r.SetCapture(v2.Capture{State: "partial", Coverage: []string{"state"}, Issues: []v2.CaptureIssue{{Code: "caller_gap", Message: "Caller observed a collection gap."}}}); err != nil {
		t.Fatal(err)
	}
	if err := r.SetCapture(v2.Capture{State: "complete", Coverage: []string{"state"}}); err != nil {
		t.Fatal(err)
	}
	if err := r.End(ctx, InvocationEndV2{Status: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	record, err := r.RunRecordV2()
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Contents) != 32 || len(record.Events) != 34 || len(record.Run.Capture.Issues) != 1 || record.Run.Capture.State != "partial" {
		t.Fatal("concurrent facts or preserved capture gap lost")
	}
	requireV2Fixture(t, "application-explicit-concurrent", record)
}
