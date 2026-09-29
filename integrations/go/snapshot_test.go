package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

type graphInfoCallback func(context.Context, *compose.GraphInfo)

func (callback graphInfoCallback) OnFinish(ctx context.Context, info *compose.GraphInfo) {
	callback(ctx, info)
}

func TestProjectGraphInfo(t *testing.T) {
	branch := compose.NewGraphBranch(
		func(_ context.Context, _ string) (string, error) { return "answer", nil },
		map[string]bool{"end": true, "answer": true},
	)
	nested := &compose.GraphInfo{
		Name:  "nested",
		Nodes: map[string]compose.GraphNodeInfo{"inner": {Component: compose.ComponentOfLambda}},
		Edges: map[string][]string{"start": {"inner"}, "inner": {"end"}},
	}
	info := &compose.GraphInfo{
		Name: "fixture",
		Nodes: map[string]compose.GraphNodeInfo{
			"route": {Component: compose.ComponentOfLambda},
			"answer": {
				Name:      "Answer",
				Component: compose.ComponentOfGraph,
				GraphInfo: nested,
			},
		},
		Edges:     map[string][]string{"start": {"route"}, "route": {"answer"}},
		DataEdges: map[string][]string{"start": {"route"}, "route": {"answer"}},
		Branches:  map[string][]compose.GraphBranch{"route": {*branch}},
	}
	snapshot, err := Project(info)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != 1 || snapshot.Workflow.Name != "fixture" {
		t.Fatalf("unexpected snapshot header: %#v", snapshot)
	}
	if got := []string{snapshot.Workflow.Nodes[0].ID, snapshot.Workflow.Nodes[1].ID}; !reflect.DeepEqual(got, []string{"answer", "route"}) {
		t.Fatalf("nodes are not deterministic: %v", got)
	}
	if snapshot.Workflow.Nodes[0].Workflow == nil {
		t.Fatal("nested graph was not projected")
	}
	if got := snapshot.Workflow.Edges[0].Channels; !reflect.DeepEqual(got, []string{"control", "data"}) {
		t.Fatalf("edge channels were not merged: %v", got)
	}
	if got := snapshot.Workflow.Branches[0].Targets; !reflect.DeepEqual(got, []string{"answer", "end"}) {
		t.Fatalf("branch targets are not deterministic: %v", got)
	}

	if _, err := json.Marshal(snapshot); err != nil {
		t.Fatal(err)
	}
}

func TestProjectWithOptionsAddsNodeKindsByFullPath(t *testing.T) {
	nested := &compose.GraphInfo{
		Nodes: map[string]compose.GraphNodeInfo{
			"invoke/model": {Component: compose.ComponentOfLambda},
		},
		Edges: map[string][]string{},
	}
	info := &compose.GraphInfo{
		Nodes: map[string]compose.GraphNodeInfo{
			"answer/flow": {
				Component: compose.ComponentOfGraph,
				GraphInfo: nested,
			},
			"route/strategy": {Component: compose.ComponentOfLambda},
		},
		Edges: map[string][]string{},
	}
	resolveKind := func(path []string) (NodeKind, bool) {
		switch {
		case reflect.DeepEqual(path, []string{"answer/flow", "invoke/model"}):
			return NodeKindLLM, true
		case reflect.DeepEqual(path, []string{"route/strategy"}):
			return NodeKindBranch, true
		default:
			return "", false
		}
	}
	seen := make([][]string, 0, 2)
	snapshot, err := ProjectWithOptions(info, ProjectOptions{
		ResolveNodeKind: func(path []string, _ compose.GraphNodeInfo) (NodeKind, bool) {
			seen = append(seen, append([]string(nil), path...))
			return resolveKind(path)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != SchemaVersion {
		t.Fatalf("unexpected schema version: %d", snapshot.SchemaVersion)
	}
	if got := snapshot.Workflow.Nodes[0].Kind; got != NodeKindGraph {
		t.Fatalf("nested workflow kind = %q, want %q", got, NodeKindGraph)
	}
	if got := snapshot.Workflow.Nodes[0].Workflow.Nodes[0].Kind; got != NodeKindLLM {
		t.Fatalf("nested leaf kind = %q, want %q", got, NodeKindLLM)
	}
	if got := snapshot.Workflow.Nodes[1].Kind; got != NodeKindBranch {
		t.Fatalf("route kind = %q, want %q", got, NodeKindBranch)
	}
	if !reflect.DeepEqual(seen, [][]string{{"answer/flow", "invoke/model"}, {"route/strategy"}}) {
		t.Fatalf("resolver paths = %v", seen)
	}

	marshaled, err := MarshalWithOptions(info, ProjectOptions{
		ResolveNodeKind: func(path []string, _ compose.GraphNodeInfo) (NodeKind, bool) {
			return resolveKind(path)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var marshaledSnapshot Snapshot
	if err := json.Unmarshal(marshaled, &marshaledSnapshot); err != nil {
		t.Fatal(err)
	}
	actual, err := json.MarshalIndent(marshaledSnapshot, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err := os.ReadFile("../../fixtures/eino-workflow-kind-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("node-kind projection does not match shared fixture\nactual:\n%s", actual)
	}
}

func TestProjectWithOptionsRejectsInvalidNodeKind(t *testing.T) {
	info := &compose.GraphInfo{
		Nodes: map[string]compose.GraphNodeInfo{
			"leaf": {Component: compose.ComponentOfLambda},
		},
		Edges: map[string][]string{},
	}
	for _, kind := range []NodeKind{"custom", NodeKindGraph} {
		_, err := ProjectWithOptions(info, ProjectOptions{
			ResolveNodeKind: func([]string, compose.GraphNodeInfo) (NodeKind, bool) {
				return kind, true
			},
		})
		if !errors.Is(err, ErrInvalidNodeKind) {
			t.Fatalf("kind %q: expected ErrInvalidNodeKind, got %v", kind, err)
		}
	}
}

func TestRealWeatherWorkflowMatchesSharedFixture(t *testing.T) {
	type weatherRequest struct {
		City string
	}
	type weatherReport struct {
		City            string
		Condition       string
		TemperatureC    int
		HumidityPercent int
	}

	const question = "新加坡现在天气怎么样？"
	workflowModel := &deterministicWeatherModel{}
	workflow := compose.NewWorkflow[string, *schema.Message]()
	workflow.AddLambdaNode(
		"parse-city",
		compose.InvokableLambda(func(_ context.Context, _ string) (weatherRequest, error) {
			return weatherRequest{City: "新加坡"}, nil
		}),
		compose.WithNodeName("Parse city"),
	).AddInput(compose.START)
	workflow.AddLambdaNode(
		"get-weather",
		compose.InvokableLambda(func(_ context.Context, request weatherRequest) (weatherReport, error) {
			return weatherReport{
				City:            request.City,
				Condition:       "晴",
				TemperatureC:    31,
				HumidityPercent: 68,
			}, nil
		}),
		compose.WithNodeName("Get weather"),
	).AddInput("parse-city")
	workflow.AddLambdaNode(
		"build-context",
		compose.InvokableLambda(func(_ context.Context, _ weatherReport) ([]*schema.Message, error) {
			return []*schema.Message{
				schema.SystemMessage("请根据天气工具结果回答用户。"),
				schema.UserMessage(question),
				schema.ToolMessage(`{"city":"新加坡","condition":"晴","temperatureC":31,"humidityPercent":68}`, "call-weather-workflow"),
			}, nil
		}),
		compose.WithNodeName("Build model context"),
	).AddInput("get-weather")
	workflow.AddChatModelNode(
		"generate-answer",
		workflowModel,
		compose.WithNodeName("Generate answer"),
	).AddInput("build-context")
	workflow.End().AddInput("generate-answer")

	recorder := NewWorkflowRecorder("run-weather-workflow-1", WorkflowRecorderOptions{
		DisableRootIO: true, // Preserve the published legacy fixture verbatim.
		Project: ProjectOptions{
			ResolveNodeKind: func(path []string, _ compose.GraphNodeInfo) (NodeKind, bool) {
				switch path[len(path)-1] {
				case "parse-city":
					return NodeKindIO, true
				case "get-weather", "build-context":
					return NodeKindCPU, true
				case "generate-answer":
					return NodeKindLLM, true
				default:
					return "", false
				}
			},
		},
		Metadata: JSONMap{
			"fixture": "real-eino-workflow",
			"input":   question,
		},
		Envelope: EnvelopeOptions{Source: map[string]string{
			"module": "weather-workflow-example",
			"format": "Eino runtime callbacks",
		}},
	})
	fixedTime := time.UnixMilli(1789000000000)
	recorder.now = func() time.Time { return fixedTime }
	recorder.execution.now = func() time.Time { return fixedTime }
	runner, err := workflow.Compile(
		context.Background(),
		compose.WithGraphName("weather-query-workflow"),
		recorder.CompileOption(),
	)
	if err != nil {
		t.Fatal(err)
	}

	answer, err := runner.Invoke(context.Background(), question, recorder.InvokeOption())
	if err != nil {
		t.Fatal(err)
	}
	const expectedAnswer = "新加坡当前晴，31°C，湿度 68%。适合出行，注意防晒。"
	if answer == nil || answer.Role != schema.Assistant || answer.Content != expectedAnswer {
		t.Fatalf("weather Workflow answer = %#v, want assistant %q", answer, expectedAnswer)
	}
	if workflowModel.callCount() != 1 {
		t.Fatalf("weather Workflow ChatModel calls = %d, want 1", workflowModel.callCount())
	}

	snapshot, err := recorder.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	for index := range snapshot.Execution.Nodes {
		snapshot.Execution.Nodes[index].StartedAtMS = nil
		snapshot.Execution.Nodes[index].FinishedAtMS = nil
		snapshot.Execution.Nodes[index].DurationMS = nil
	}
	snapshot.Execution.StartedAtMS = nil
	snapshot.Execution.FinishedAtMS = nil
	snapshot.Execution.DurationMS = nil
	snapshot.Metadata["output"] = answer.Content

	actual, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err := os.ReadFile("../../fixtures/eino-weather-workflow-v1.json")
	if err != nil {
		t.Fatalf("%v\nactual:\n%s", err, actual)
	}
	if string(actual) != string(expected) {
		t.Fatalf("real Eino weather Workflow does not match shared fixture\nactual:\n%s", actual)
	}

	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if len(envelopes) != 11 {
		t.Fatalf("weather Workflow evidence count = %d, want anchor, two boundaries and four input/output pairs", len(envelopes))
	}
	assertLifecycle(t, envelopes, "success", "complete")
	if len(diagnostics) != 6 {
		t.Fatalf("weather Workflow projection diagnostics = %#v, want Lambda custom-body warnings", diagnostics)
	}
	var anchor Snapshot
	if err := json.Unmarshal(envelopes[0].Payload, &anchor); err != nil {
		t.Fatal(err)
	}
	anchor.Metadata["output"] = answer.Content
	for index := range anchor.Execution.Nodes {
		anchor.Execution.Nodes[index].StartedAtMS = nil
		anchor.Execution.Nodes[index].FinishedAtMS = nil
		anchor.Execution.Nodes[index].DurationMS = nil
	}
	anchor.Execution.StartedAtMS = nil
	anchor.Execution.FinishedAtMS = nil
	anchor.Execution.DurationMS = nil
	envelopes[0].Payload, err = json.Marshal(anchor)
	if err != nil {
		t.Fatal(err)
	}
	completedRecord, err := NewRunRecord("run-weather-workflow-1", RunSourceWorkflow, envelopes, diagnostics, JSONMap{"scenario": "weather"})
	if err != nil {
		t.Fatal(err)
	}
	assertCompletedRunFixture(t, completedRecord, "eino-workflow-recorder-weather-completed-v1.json")
	envelopes = withoutLifecycleEvidence(envelopes)
	expectedEvidence, err := os.ReadFile("../../fixtures/eino-weather-workflow-evidence-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var expectedEnvelopes []Envelope
	if err := json.Unmarshal(expectedEvidence, &expectedEnvelopes); err != nil {
		t.Fatal(err)
	}
	if len(expectedEnvelopes) != len(envelopes)-1 {
		t.Fatalf("shared runtime evidence count = %d, want %d", len(expectedEnvelopes), len(envelopes)-1)
	}
	for index := range expectedEnvelopes {
		var actualPayload, expectedPayload ComponentIOPayload
		if err := json.Unmarshal(envelopes[index+1].Payload, &actualPayload); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(expectedEnvelopes[index].Payload, &expectedPayload); err != nil {
			t.Fatal(err)
		}
		actualPayload.Address = nil
		expectedPayload.Address = nil
		if !reflect.DeepEqual(actualPayload, expectedPayload) {
			t.Fatalf("runtime evidence %d differs from Eino capture\nactual: %#v\nfixture: %#v", index, actualPayload, expectedPayload)
		}
	}

	runRecord, err := NewRunRecord(
		"run-weather-workflow-1",
		RunSourceWorkflow,
		envelopes,
		diagnostics,
		JSONMap{"scenario": "weather"},
	)
	if err != nil {
		t.Fatal(err)
	}
	runRecordFixture, err := json.MarshalIndent(runRecord, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	runRecordFixture = append(runRecordFixture, '\n')
	const runRecordFixturePath = "../../fixtures/eino-workflow-recorder-weather-v1.json"
	if os.Getenv("WRITE_WORKFLOW_RUN_RECORD_FIXTURE") != "" {
		if err := os.WriteFile(runRecordFixturePath, runRecordFixture, 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		expectedRunRecord, err := os.ReadFile(runRecordFixturePath)
		if err != nil {
			t.Fatalf("%v\nactual:\n%s", err, runRecordFixture)
		}
		if !orderedRecorderFixtureEqual(t, runRecord, expectedRunRecord) {
			t.Fatalf("WorkflowRecorder RunRecord does not match the shared fixture\nactual:\n%s", runRecordFixture)
		}
	}
}

func TestRealWorkflowMatchesSharedFixture(t *testing.T) {
	type prepared struct {
		Text string
	}

	nested := compose.NewGraph[string, string]()
	if err := nested.AddLambdaNode(
		"invoke",
		compose.InvokableLambda(func(_ context.Context, input string) (string, error) { return input, nil }),
		compose.WithNodeName("Invoke"),
	); err != nil {
		t.Fatal(err)
	}
	if err := nested.AddBranch(compose.START, compose.NewGraphBranch(
		func(_ context.Context, input string) (string, error) {
			if input == "" {
				return compose.END, nil
			}
			return "invoke", nil
		},
		map[string]bool{"invoke": true, compose.END: true},
	)); err != nil {
		t.Fatal(err)
	}
	if err := nested.AddEdge("invoke", compose.END); err != nil {
		t.Fatal(err)
	}

	workflow := compose.NewWorkflow[string, map[string]any]()
	workflow.AddLambdaNode(
		"prepare",
		compose.InvokableLambda(func(_ context.Context, input string) (prepared, error) {
			return prepared{Text: input}, nil
		}),
		compose.WithNodeName("Prepare"),
	).AddInput(compose.START)
	workflow.AddGraphNode(
		"answer",
		nested,
		compose.WithNodeName("Answer"),
	).AddInputWithOptions(
		"route",
		[]*compose.FieldMapping{compose.FromField("Text")},
		compose.WithNoDirectDependency(),
	)
	workflow.AddLambdaNode(
		"fallback",
		compose.InvokableLambda(func(_ context.Context, input string) (string, error) { return input, nil }),
		compose.WithNodeName("Fallback"),
	).AddInputWithOptions(
		"route",
		[]*compose.FieldMapping{compose.FromField("Text")},
		compose.WithNoDirectDependency(),
	)
	workflow.AddLambdaNode(
		"route",
		compose.InvokableLambda(func(_ context.Context, input prepared) (prepared, error) { return input, nil }),
		compose.WithNodeName("Route"),
	).AddInput("prepare")
	workflow.AddBranch("route", compose.NewGraphBranch(
		func(_ context.Context, input prepared) (string, error) {
			if input.Text == "" {
				return "fallback", nil
			}
			return "answer", nil
		},
		map[string]bool{"answer": true, "fallback": true},
	))
	workflow.End().AddInput("answer", compose.ToField("answer")).AddInput("fallback", compose.ToField("fallback"))

	var info *compose.GraphInfo
	runner, err := workflow.Compile(
		context.Background(),
		compose.WithGraphName("support-assistant"),
		compose.WithGraphCompileCallbacks(graphInfoCallback(func(_ context.Context, graph *compose.GraphInfo) {
			info = graph
		})),
	)
	if err != nil {
		t.Fatal(err)
	}
	if info == nil {
		t.Fatal("Eino did not invoke the graph compile callback")
	}
	recorder := NewExecutionRecorder("run-1")
	callbackRecorder := NewCallbackEventRecorder("run-1")
	if _, err := runner.Invoke(
		context.Background(),
		"hello",
		compose.WithCallbacks(recorder.Handler(), callbackRecorder.Handler()),
	); err != nil {
		t.Fatal(err)
	}
	// This test controls the branch input and can therefore authoritatively
	// identify the unselected route. Generic Eino callbacks do not report it.
	recorder.MarkSkipped([]string{"fallback"})
	execution := recorder.Execution()
	if len(execution.Nodes) == 0 {
		t.Fatal("Eino execution callbacks did not expose node paths")
	}
	if execution.StartedAtMS == nil || execution.FinishedAtMS == nil || execution.DurationMS == nil {
		t.Fatalf("workflow timing was not collected: %#v", execution)
	}
	foundSkipped := false
	for _, node := range execution.Nodes {
		if node.Status == NodeStatusSkipped {
			foundSkipped = true
			if !reflect.DeepEqual(node.Path, []string{"fallback"}) || node.DurationMS != nil {
				t.Fatalf("unexpected skipped execution state: %#v", node)
			}
		} else if node.Status != NodeStatusSuccess {
			t.Fatalf("unexpected execution state: %#v", execution)
		}
	}
	if !foundSkipped {
		t.Fatal("the unselected Eino branch was not represented as skipped")
	}

	snapshot, err := Project(info)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range callbackRecorder.Events() {
		if len(event.NodePath) > 0 && !graphContainsNodePath(snapshot.Workflow, event.NodePath) {
			t.Fatalf("callback path does not resolve in projected topology: %#v", event)
		}
	}
	snapshot.Execution = &Execution{ID: execution.ID}
	for _, node := range execution.Nodes {
		snapshot.Execution.Nodes = append(snapshot.Execution.Nodes, NodeExecution{
			Path:   node.Path,
			Status: node.Status,
		})
	}
	actual, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err := os.ReadFile("../../fixtures/eino-workflow-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("real Eino projection does not match shared fixture\nactual:\n%s", actual)
	}

	graphEnvelope, diagnostics, err := ProjectComposeGraphEnvelope(
		info,
		ComposeGraphEnvelopeOptions{
			Envelope: EnvelopeOptions{Source: map[string]string{
				"einoVersion": "0.9.19",
			}},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 0 {
		t.Fatalf("unexpected compose graph diagnostics: %#v", diagnostics)
	}
	actual, err = json.MarshalIndent(graphEnvelope, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	expected, err = os.ReadFile("../../fixtures/eino-compose-graph-envelope-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("real Eino compose.graph projection does not match shared fixture\nactual:\n%s", actual)
	}

}

func graphContainsNodePath(graph Graph, path []string) bool {
	if len(path) == 0 {
		return false
	}
	for _, node := range graph.Nodes {
		if node.ID != path[0] {
			continue
		}
		if len(path) == 1 {
			return true
		}
		return node.Workflow != nil && graphContainsNodePath(*node.Workflow, path[1:])
	}
	return false
}

func TestExecutionRecorderCapturesFailure(t *testing.T) {
	wanted := errors.New("planned failure")
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode(
		"fail",
		compose.InvokableLambda(func(_ context.Context, _ string) (string, error) {
			return "", wanted
		}),
	).AddInput(compose.START)
	workflow.End().AddInput("fail")
	runner, err := workflow.Compile(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	recorder := NewExecutionRecorder("failed-run")
	if _, err := runner.Invoke(
		context.Background(),
		"input",
		compose.WithCallbacks(recorder.Handler()),
	); !errors.Is(err, wanted) {
		t.Fatalf("expected planned failure, got %v", err)
	}
	execution := recorder.Execution()
	if len(execution.Nodes) != 1 {
		t.Fatalf("expected one failed node, got %#v", execution.Nodes)
	}
	node := execution.Nodes[0]
	if !reflect.DeepEqual(node.Path, []string{"fail"}) || node.Status != "failed" || node.ErrorMessage != wanted.Error() {
		t.Fatalf("unexpected failed node state: %#v", node)
	}
}

func TestExecutionRecorderUsesErrorPresenceForFailure(t *testing.T) {
	wanted := errors.New("")
	workflow := compose.NewWorkflow[string, string]()
	workflow.AddLambdaNode(
		"fail",
		compose.InvokableLambda(func(_ context.Context, _ string) (string, error) {
			return "", wanted
		}),
	).AddInput(compose.START)
	workflow.End().AddInput("fail")
	runner, err := workflow.Compile(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	recorder := NewExecutionRecorder("empty-message-failure")
	if _, err := runner.Invoke(
		context.Background(),
		"input",
		compose.WithCallbacks(recorder.Handler()),
	); !errors.Is(err, wanted) {
		t.Fatalf("expected empty-message failure, got %v", err)
	}
	execution := recorder.Execution()
	if len(execution.Nodes) != 1 {
		t.Fatalf("expected one failed node, got %#v", execution.Nodes)
	}
	node := execution.Nodes[0]
	if !reflect.DeepEqual(node.Path, []string{"fail"}) || node.Status != NodeStatusFailed || node.ErrorMessage != "" {
		t.Fatalf("non-nil error with an empty message must remain failed: %#v", node)
	}
}

func TestExecutionRecorderOmitsUnfinishedAndMarksSkipped(t *testing.T) {
	recorder := NewExecutionRecorder("partial-run")
	recorder.recordStart([]string{"unfinished"})
	recorder.MarkSkipped([]string{"route", "unused"})

	execution := recorder.Execution()
	if len(execution.Nodes) != 1 {
		t.Fatalf("expected only the final skipped record, got %#v", execution.Nodes)
	}
	node := execution.Nodes[0]
	if !reflect.DeepEqual(node.Path, []string{"route", "unused"}) || node.Status != NodeStatusSkipped {
		t.Fatalf("unexpected skipped node state: %#v", node)
	}
	if node.DurationMS != nil || node.StartedAtMS != nil || node.FinishedAtMS != nil {
		t.Fatalf("skipped node must not have timing: %#v", node)
	}

	encoded, err := json.Marshal(node)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"path":["route","unused"],"status":"skipped","durationMs":null}` {
		t.Fatalf("unexpected skipped JSON: %s", encoded)
	}
}

func TestProjectRejectsInvalidGraphInfo(t *testing.T) {
	if _, err := Project(nil); !errors.Is(err, ErrNilGraphInfo) {
		t.Fatalf("expected ErrNilGraphInfo, got %v", err)
	}

	info := &compose.GraphInfo{Nodes: map[string]compose.GraphNodeInfo{}, Edges: map[string][]string{}}
	info.Nodes["self"] = compose.GraphNodeInfo{GraphInfo: info}
	if _, err := Project(info); !errors.Is(err, ErrRecursiveGraphInfo) {
		t.Fatalf("expected ErrRecursiveGraphInfo, got %v", err)
	}
}
