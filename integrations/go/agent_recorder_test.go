package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

func TestAgentRecorderAutomaticallyCapturesRealWeatherRun(t *testing.T) {
	ctx := context.Background()
	weatherModel := &deterministicWeatherModel{}
	weatherTool := &deterministicWeatherTool{}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "weather-agent",
		Instruction: "需要实时天气时调用 get_weather。",
		Model:       weatherModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools: []tool.BaseTool{weatherTool},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
	recorder := NewAgentRecorder("run-auto-weather", AgentRecorderOptions{})
	clock := time.UnixMilli(1_789_100_000_000)
	recorder.now = func() time.Time {
		clock = clock.Add(time.Millisecond)
		return clock
	}
	iterator, err := recorder.Run(ctx, runner, []*schema.Message{schema.UserMessage("新加坡天气怎么样？")})
	if err != nil {
		t.Fatal(err)
	}
	var originalEvents []*adk.AgentEvent
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		originalEvents = append(originalEvents, event)
	}
	if len(originalEvents) != 3 {
		t.Fatalf("Agent event count = %d, want 3", len(originalEvents))
	}
	envelopes, diagnostics, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %#v", diagnostics)
	}
	counts := map[string]int{}
	for index, envelope := range envelopes {
		counts[envelope.Kind]++
		if envelope.Correlation["runId"] != "run-auto-weather" {
			t.Fatalf("envelope %d runId = %q", index, envelope.Correlation["runId"])
		}
		if envelope.ObservedAtMS == nil {
			t.Fatalf("envelope %d has no observation time", index)
		}
		if index > 0 && *envelope.ObservedAtMS <= *envelopes[index-1].ObservedAtMS {
			t.Fatalf(
				"envelopes are not in observation order: evidence[%d]=%d, evidence[%d]=%d",
				index-1,
				*envelopes[index-1].ObservedAtMS,
				index,
				*envelope.ObservedAtMS,
			)
		}
	}
	if counts["schema.message"] != 2 || counts["agent.event"] != 3 {
		t.Fatalf("unexpected message/event counts: %#v", counts)
	}
	if counts["component.io"] < 4 {
		t.Fatalf("component callbacks were not captured: %#v", counts)
	}
	if envelopes[0].Kind != RunLifecycleKind || envelopes[1].Kind != "schema.message" || envelopes[len(envelopes)-2].Kind != "schema.message" || envelopes[len(envelopes)-1].Kind != RunLifecycleKind {
		t.Fatalf("invocation boundaries or visible input/output anchors missing")
	}
	assertLifecycle(t, envelopes, "success", "complete")
	runRecord, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if runRecord.Source != RunSourceAgent || runRecord.RunID != "run-auto-weather" || len(runRecord.Evidence) != len(envelopes) {
		t.Fatalf("Agent RunRecord = %#v", runRecord)
	}
	for index := range envelopes {
		removeGeneratedMessageIDs(t, &envelopes[index])
		observedAt := int64(1_789_100_000_001 + index)
		envelopes[index].ObservedAtMS = &observedAt
	}
	runRecord.Evidence = envelopes
	fixture, err := json.MarshalIndent(runRecord, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	if outputPath := os.Getenv("WRITE_AGENT_RECORDER_FIXTURE"); outputPath != "" {
		if err := os.WriteFile(outputPath, fixture, 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		expected, err := os.ReadFile("../../fixtures/eino-agent-recorder-weather-v1.json")
		if err != nil {
			t.Fatal(err)
		}
		if !equivalentRunRecordFixture(t, runRecord, expected) {
			t.Fatalf("AgentRecorder output does not match the shared fixture\nactual:\n%s", fixture)
		}
	}

	// Envelopes returns defensive copies.
	envelopes[0].Correlation["runId"] = "mutated"
	again, _, err := recorder.Envelopes()
	if err != nil {
		t.Fatal(err)
	}
	if again[0].Correlation["runId"] != "run-auto-weather" {
		t.Fatal("AgentRecorder envelopes were mutated by the caller")
	}
}

func TestAgentRecorderCapturesFailureWithoutInventingOutput(t *testing.T) {
	ctx := context.Background()
	weatherModel := &deterministicWeatherModel{toolArguments: `{"city":"Atlantis"}`}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "weather-agent",
		Instruction: "需要实时天气时调用 get_weather。",
		Model:       weatherModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools: []tool.BaseTool{&deterministicWeatherTool{}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorder("run-auto-failure", AgentRecorderOptions{})
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
	iterator, err := recorder.Query(ctx, runner, "查询 Atlantis 天气")
	if err != nil {
		t.Fatal(err)
	}
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil && !errors.Is(event.Err, context.Canceled) {
			// The source error remains on the unchanged event and in agent.event.
			continue
		}
	}
	envelopes, _, captureErr := recorder.Envelopes()
	if captureErr != nil {
		t.Fatalf("runtime failure must not become a Recorder failure: %v", captureErr)
	}
	messageCount := 0
	hasAgentError := false
	for _, envelope := range envelopes {
		if envelope.Kind == "schema.message" {
			messageCount++
		}
		if envelope.Kind == "agent.event" {
			var payload AgentEventPayload
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			hasAgentError = hasAgentError || payload.Error != nil
		}
	}
	if messageCount != 1 {
		t.Fatalf("failed run invented an assistant message: %d schema.message envelopes", messageCount)
	}
	if !hasAgentError {
		t.Fatal("failed run did not preserve its Agent error event")
	}
	assertLifecycle(t, envelopes, "failed", "complete")
	runRecord, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	for index := range runRecord.Evidence {
		removeGeneratedMessageIDs(t, &runRecord.Evidence[index])
		observedAt := int64(1_789_100_100_001 + index)
		runRecord.Evidence[index].ObservedAtMS = &observedAt
	}
	fixture, err := json.MarshalIndent(runRecord, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	const fixturePath = "../../fixtures/eino-agent-recorder-failure-v1.json"
	if os.Getenv("WRITE_AGENT_FAILURE_RECORD_FIXTURE") != "" {
		if err := os.WriteFile(fixturePath, fixture, 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		expected, err := os.ReadFile(fixturePath)
		if err != nil {
			t.Fatalf("%v\nactual:\n%s", err, fixture)
		}
		if !equivalentRunRecordFixture(t, runRecord, expected) {
			t.Fatalf("failed Agent RunRecord does not match the shared fixture\nactual:\n%s", fixture)
		}
	}
}

// Concurrent Eino callbacks and iterator delivery have no guaranteed relative
// order. Golden records therefore compare the complete evidence multiset while
// dedicated assertions above verify that each actual RunRecord preserves its
// own monotonic observation order.
func equivalentRunRecordFixture(t *testing.T, actual RunRecord, expectedJSON []byte) bool {
	t.Helper()
	var expected RunRecord
	if err := json.Unmarshal(expectedJSON, &expected); err != nil {
		t.Fatalf("decode expected RunRecord: %v", err)
	}
	// Published legacy fixtures intentionally remain unchanged. New lifecycle
	// evidence is asserted separately and in dedicated completed-run fixtures.
	if len(withoutLifecycleEvidence(expected.Evidence)) == len(expected.Evidence) {
		actual.Evidence = withoutLifecycleEvidence(actual.Evidence)
	}
	actual = recorderFixtureSafetyCompatibility(t, actual, expected)
	return string(normalizedRunRecordFixture(t, actual)) == string(normalizedRunRecordFixture(t, expected))
}

func normalizedRunRecordFixture(t *testing.T, record RunRecord) []byte {
	t.Helper()
	cloned, err := cloneRunRecord(record)
	if err != nil {
		t.Fatalf("clone RunRecord fixture: %v", err)
	}
	for index := range cloned.Evidence {
		cloned.Evidence[index].ObservedAtMS = nil
		cloned.Evidence[index].Payload = canonicalRecorderJSON(t, cloned.Evidence[index].Payload)
		cloned.Evidence[index].Metadata = canonicalRecorderJSON(t, cloned.Evidence[index].Metadata)
	}
	sort.SliceStable(cloned.Evidence, func(left, right int) bool {
		leftJSON, _ := json.Marshal(cloned.Evidence[left])
		rightJSON, _ := json.Marshal(cloned.Evidence[right])
		return string(leftJSON) < string(rightJSON)
	})
	encoded, err := json.Marshal(cloned)
	if err != nil {
		t.Fatalf("marshal normalized RunRecord fixture: %v", err)
	}
	return encoded
}

func TestAgentRecorderEmitsIncompleteRunWithoutInventingOutput(t *testing.T) {
	recorder := NewAgentRecorder("run-auto-incomplete", AgentRecorderOptions{})
	fixedTime := time.UnixMilli(1_789_100_200_001)
	recorder.now = func() time.Time { return fixedTime }
	recorder.RecordMessage(schema.UserMessage("新加坡天气怎么样？"))
	runRecord, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if len(runRecord.Evidence) != 1 || runRecord.Evidence[0].Kind != "schema.message" {
		t.Fatalf("incomplete Agent RunRecord invented evidence: %#v", runRecord.Evidence)
	}
	fixture, err := json.MarshalIndent(runRecord, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	const fixturePath = "../../fixtures/eino-agent-recorder-incomplete-v1.json"
	if os.Getenv("WRITE_AGENT_INCOMPLETE_RECORD_FIXTURE") != "" {
		if err := os.WriteFile(fixturePath, fixture, 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		expected, err := os.ReadFile(fixturePath)
		if err != nil {
			t.Fatalf("%v\nactual:\n%s", err, fixture)
		}
		if !orderedRecorderFixtureEqual(t, runRecord, expected) {
			t.Fatalf("incomplete Agent RunRecord does not match the shared fixture\nactual:\n%s", fixture)
		}
	}
}

func TestAgentRecorderRejectsNilRunner(t *testing.T) {
	recorder := NewAgentRecorder("run-nil", AgentRecorderOptions{})
	if _, err := recorder.Run(context.Background(), nil, nil); !errors.Is(err, ErrNilAgentRunner) {
		t.Fatalf("Run error = %v, want ErrNilAgentRunner", err)
	}
	if _, err := recorder.Query(context.Background(), nil, "query"); !errors.Is(err, ErrNilAgentRunner) {
		t.Fatalf("Query error = %v, want ErrNilAgentRunner", err)
	}
}
