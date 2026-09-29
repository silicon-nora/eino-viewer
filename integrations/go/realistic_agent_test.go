package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	toolutils "github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

const (
	realisticTripRunID        = "run-realistic-trip-agent-1"
	realisticTripFailureRunID = "run-realistic-trip-agent-late-failure-1"
)

type tripWeatherInput struct {
	City string `json:"city" jsonschema:"required" jsonschema_description:"City name in English"`
}

type tripWeatherOutput struct {
	City            string `json:"city"`
	Condition       string `json:"condition"`
	TemperatureC    int    `json:"temperatureC"`
	RainProbability int    `json:"rainProbability"`
}

type airQualityInput struct {
	City string `json:"city" jsonschema:"required" jsonschema_description:"City name in English"`
}

type airQualityOutput struct {
	City     string `json:"city"`
	AQI      int    `json:"aqi"`
	Category string `json:"category"`
}

type tripToolCalls struct {
	mu          sync.Mutex
	weather     []string
	airQuality  []string
	weatherLive int32
	weatherPeak int32
	barrier     chan struct{}
	barrierOnce sync.Once
	failAQ      bool
}

func (calls *tripToolCalls) recordWeather(city string) {
	calls.mu.Lock()
	calls.weather = append(calls.weather, city)
	calls.mu.Unlock()
}

func (calls *tripToolCalls) recordAirQuality(city string) {
	calls.mu.Lock()
	calls.airQuality = append(calls.airQuality, city)
	calls.mu.Unlock()
}

func (calls *tripToolCalls) snapshot() (weather []string, airQuality []string) {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	weather = append([]string(nil), calls.weather...)
	airQuality = append([]string(nil), calls.airQuality...)
	sort.Strings(weather)
	sort.Strings(airQuality)
	return weather, airQuality
}

func (calls *tripToolCalls) observeParallelWeather() error {
	if calls.barrier == nil {
		return nil
	}
	live := atomic.AddInt32(&calls.weatherLive, 1)
	defer atomic.AddInt32(&calls.weatherLive, -1)
	for {
		peak := atomic.LoadInt32(&calls.weatherPeak)
		if live <= peak || atomic.CompareAndSwapInt32(&calls.weatherPeak, peak, live) {
			break
		}
	}
	if live == 2 {
		calls.barrierOnce.Do(func() { close(calls.barrier) })
	}
	select {
	case <-calls.barrier:
		return nil
	case <-time.After(2 * time.Second):
		return errors.New("weather calls did not overlap")
	}
}

func newTripTools(calls *tripToolCalls) (tool.BaseTool, tool.BaseTool, error) {
	weather, err := toolutils.InferTool(
		"get_weather",
		"Get current weather and rain probability for one city.",
		func(_ context.Context, input tripWeatherInput) (tripWeatherOutput, error) {
			calls.recordWeather(input.City)
			if err := calls.observeParallelWeather(); err != nil {
				return tripWeatherOutput{}, err
			}
			switch input.City {
			case "Singapore":
				return tripWeatherOutput{City: input.City, Condition: "thunderstorms", TemperatureC: 31, RainProbability: 80}, nil
			case "Tokyo":
				return tripWeatherOutput{City: input.City, Condition: "clear", TemperatureC: 24, RainProbability: 10}, nil
			default:
				return tripWeatherOutput{}, fmt.Errorf("weather is unavailable for %q", input.City)
			}
		},
	)
	if err != nil {
		return nil, nil, err
	}
	airQuality, err := toolutils.InferTool(
		"get_air_quality",
		"Get the current air quality index for one city.",
		func(_ context.Context, input airQualityInput) (airQualityOutput, error) {
			calls.recordAirQuality(input.City)
			if calls.failAQ {
				return airQualityOutput{}, errors.New("air quality provider timed out")
			}
			if input.City != "Tokyo" {
				return airQualityOutput{}, fmt.Errorf("air quality is unavailable for %q", input.City)
			}
			return airQualityOutput{City: input.City, AQI: 42, Category: "good"}, nil
		},
	)
	if err != nil {
		return nil, nil, err
	}
	return weather, airQuality, nil
}

// tripPlanningModel is intentionally deterministic so the integration test is
// reproducible. It still participates as a real Eino ToolCallingChatModel: the
// ADK owns the turn loop, tool dispatch, message history, callbacks, and events.
type tripPlanningModel struct {
	mu     sync.Mutex
	inputs [][]*schema.Message
}

func (m *tripPlanningModel) GetType() string { return "TripPlanningTestModel" }

func (m *tripPlanningModel) Generate(_ context.Context, input []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	m.mu.Lock()
	m.inputs = append(m.inputs, append([]*schema.Message(nil), input...))
	m.mu.Unlock()

	weatherResults := map[string]tripWeatherOutput{}
	var airQuality *airQualityOutput
	for _, message := range input {
		if message == nil || message.Role != schema.Tool {
			continue
		}
		switch message.ToolName {
		case "get_weather":
			var output tripWeatherOutput
			if err := json.Unmarshal([]byte(message.Content), &output); err != nil {
				return nil, fmt.Errorf("decode weather result: %w", err)
			}
			weatherResults[output.City] = output
		case "get_air_quality":
			var output airQualityOutput
			if err := json.Unmarshal([]byte(message.Content), &output); err != nil {
				return nil, fmt.Errorf("decode air quality result: %w", err)
			}
			airQuality = &output
		}
	}

	if len(weatherResults) == 0 {
		message := schema.AssistantMessage("", []schema.ToolCall{
			{
				ID:   "call-weather-singapore",
				Type: "function",
				Function: schema.FunctionCall{
					Name:      "get_weather",
					Arguments: `{"city":"Singapore"}`,
				},
			},
			{
				ID:   "call-weather-tokyo",
				Type: "function",
				Function: schema.FunctionCall{
					Name:      "get_weather",
					Arguments: `{"city":"Tokyo"}`,
				},
			},
		})
		message.ResponseMeta = responseMeta("tool_calls", 89, 22)
		return message, nil
	}
	if len(weatherResults) != 2 {
		return nil, fmt.Errorf("expected both weather results, got %d", len(weatherResults))
	}
	if airQuality == nil {
		message := schema.AssistantMessage("", []schema.ToolCall{{
			ID:   "call-air-quality-tokyo",
			Type: "function",
			Function: schema.FunctionCall{
				Name:      "get_air_quality",
				Arguments: `{"city":"Tokyo"}`,
			},
		}})
		message.ResponseMeta = responseMeta("tool_calls", 174, 17)
		return message, nil
	}

	message := schema.AssistantMessage(
		"建议东京。东京晴，24°C，降雨概率 10%，空气质量良好（AQI 42）；新加坡有雷阵雨，降雨概率 80%。",
		nil,
	)
	message.ResponseMeta = responseMeta("stop", 236, 48)
	return message, nil
}

func (m *tripPlanningModel) Stream(ctx context.Context, input []*schema.Message, options ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	message, err := m.Generate(ctx, input, options...)
	if err != nil {
		return nil, err
	}
	return schema.StreamReaderFromArray([]*schema.Message{message}), nil
}

func (m *tripPlanningModel) WithTools(_ []*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}

func (m *tripPlanningModel) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.inputs)
}

func responseMeta(reason string, promptTokens, completionTokens int) *schema.ResponseMeta {
	return &schema.ResponseMeta{
		FinishReason: reason,
		Usage: &schema.TokenUsage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
		},
	}
}

func newTripPlanningRunner(ctx context.Context, calls *tripToolCalls, sequential bool) (*adk.Runner, *tripPlanningModel, error) {
	weather, airQuality, err := newTripTools(calls)
	if err != nil {
		return nil, nil, err
	}
	tripModel := &tripPlanningModel{}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "trip-planner",
		Description: "Compare live conditions and recommend an outdoor destination.",
		Instruction: "Compare both cities with tools. Check air quality for the better outdoor option before answering.",
		Model:       tripModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools:               []tool.BaseTool{weather, airQuality},
			ExecuteSequentially: sequential,
		}},
	})
	if err != nil {
		return nil, nil, err
	}
	return adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false}), tripModel, nil
}

func drainRecordedAgent(t *testing.T, iterator *RecordedAgentIterator) []*adk.AgentEvent {
	t.Helper()
	var events []*adk.AgentEvent
	for {
		event, ok := iterator.Next()
		if !ok {
			return events
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		events = append(events, event)
	}
}

func TestRealisticAgentRunUsesMultipleModelTurnsAndTools(t *testing.T) {
	ctx := context.Background()
	calls := &tripToolCalls{}
	runner, tripModel, err := newTripPlanningRunner(ctx, calls, true)
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorder(realisticTripRunID, AgentRecorderOptions{})
	clock := time.UnixMilli(1_789_200_000_000)
	recorder.now = func() time.Time {
		clock = clock.Add(time.Millisecond)
		return clock
	}
	query := "比较新加坡和东京今天的天气，选一个更适合户外活动的城市，并确认空气质量。"
	iterator, err := recorder.Query(ctx, runner, query)
	if err != nil {
		t.Fatal(err)
	}
	events := drainRecordedAgent(t, iterator)

	if tripModel.callCount() != 3 {
		t.Fatalf("model turns = %d, want 3", tripModel.callCount())
	}
	weatherCalls, airQualityCalls := calls.snapshot()
	if fmt.Sprint(weatherCalls) != "[Singapore Tokyo]" || fmt.Sprint(airQualityCalls) != "[Tokyo]" {
		t.Fatalf("tool calls weather=%v airQuality=%v", weatherCalls, airQualityCalls)
	}
	if len(events) < 5 {
		t.Fatalf("Agent events = %d, want a multi-turn run", len(events))
	}
	last := events[len(events)-1]
	if last.Output == nil || last.Output.MessageOutput == nil || last.Output.MessageOutput.Message == nil {
		t.Fatalf("last event has no message: %#v", last)
	}
	if got := last.Output.MessageOutput.Message.Content; got != "建议东京。东京晴，24°C，降雨概率 10%，空气质量良好（AQI 42）；新加坡有雷阵雨，降雨概率 80%。" {
		t.Fatalf("final answer = %q", got)
	}

	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	record.Metadata = JSONMap{
		"scenario":      "multi-city-outdoor-trip",
		"runtime":       "eino-adk-runner",
		"modelMode":     "deterministic-test-double",
		"toolExecution": "sequential-for-reproducible-fixture",
	}
	kinds := map[string]int{}
	for index := range record.Evidence {
		removeGeneratedMessageIDs(t, &record.Evidence[index])
		observedAt := int64(1_789_200_000_001 + index)
		record.Evidence[index].ObservedAtMS = &observedAt
		kinds[record.Evidence[index].Kind]++
	}
	if kinds["schema.message"] != 2 || kinds["agent.event"] < 5 || kinds["component.io"] < 10 {
		t.Fatalf("RunRecord lacks realistic evidence: %#v", kinds)
	}
	assertLifecycle(t, record.Evidence, "success", "complete")
	assertCompletedRunFixture(t, record, "eino-agent-recorder-trip-planner-completed-v1.json")
	fixture, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	const fixturePath = "../../fixtures/eino-agent-recorder-trip-planner-v1.json"
	if os.Getenv("WRITE_REALISTIC_AGENT_FIXTURE") != "" {
		if err := os.WriteFile(fixturePath, fixture, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("%v\nactual:\n%s", err, fixture)
	}
	if !equivalentRunRecordFixture(t, record, expected) {
		t.Fatalf("realistic Agent RunRecord does not match fixture\nactual:\n%s", fixture)
	}
}

func TestRealisticAgentUsesEinoParallelToolDispatch(t *testing.T) {
	ctx := context.Background()
	calls := &tripToolCalls{barrier: make(chan struct{})}
	runner, tripModel, err := newTripPlanningRunner(ctx, calls, false)
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorder("run-realistic-parallel-tools", AgentRecorderOptions{})
	iterator, err := recorder.Query(ctx, runner, "比较新加坡和东京，并检查最佳城市的空气质量。")
	if err != nil {
		t.Fatal(err)
	}
	drainRecordedAgent(t, iterator)
	if tripModel.callCount() != 3 {
		t.Fatalf("model turns = %d, want 3", tripModel.callCount())
	}
	if peak := atomic.LoadInt32(&calls.weatherPeak); peak != 2 {
		t.Fatalf("peak concurrent weather calls = %d, want 2", peak)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateRunRecord(record); err != nil {
		t.Fatal(err)
	}
}

func TestRealisticAgentPreservesLateToolFailure(t *testing.T) {
	ctx := context.Background()
	calls := &tripToolCalls{failAQ: true}
	runner, tripModel, err := newTripPlanningRunner(ctx, calls, true)
	if err != nil {
		t.Fatal(err)
	}
	recorder := NewAgentRecorder(realisticTripFailureRunID, AgentRecorderOptions{})
	clock := time.UnixMilli(1_789_200_100_000)
	recorder.now = func() time.Time {
		clock = clock.Add(time.Millisecond)
		return clock
	}
	iterator, err := recorder.Query(ctx, runner, "比较新加坡和东京，并检查最佳城市的空气质量。")
	if err != nil {
		t.Fatal(err)
	}
	var runErr error
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			runErr = event.Err
		}
	}
	if runErr == nil || !errors.Is(runErr, context.DeadlineExceeded) && !containsError(runErr, "air quality provider timed out") {
		t.Fatalf("run error = %v", runErr)
	}
	if tripModel.callCount() != 2 {
		t.Fatalf("model turns after late failure = %d, want 2", tripModel.callCount())
	}
	weatherCalls, airQualityCalls := calls.snapshot()
	if len(weatherCalls) != 2 || len(airQualityCalls) != 1 {
		t.Fatalf("late failure happened at wrong stage: weather=%v airQuality=%v", weatherCalls, airQualityCalls)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	hasError := false
	assistantMessages := 0
	for _, envelope := range record.Evidence {
		if envelope.Kind == "schema.message" {
			assistantMessages++
		}
		if envelope.Kind == "agent.event" {
			var payload AgentEventPayload
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			hasError = hasError || payload.Error != nil
		}
	}
	if !hasError || assistantMessages != 1 {
		t.Fatalf("failed run error=%v schema.message count=%d", hasError, assistantMessages)
	}
	record.Metadata = JSONMap{
		"scenario":      "multi-city-outdoor-trip-late-failure",
		"runtime":       "eino-adk-runner",
		"modelMode":     "deterministic-test-double",
		"toolExecution": "sequential-for-reproducible-fixture",
	}
	for index := range record.Evidence {
		removeGeneratedMessageIDs(t, &record.Evidence[index])
		observedAt := int64(1_789_200_100_001 + index)
		record.Evidence[index].ObservedAtMS = &observedAt
	}
	assertLifecycle(t, record.Evidence, "failed", "complete")
	assertCompletedRunFixture(t, record, "eino-agent-recorder-trip-planner-failure-completed-v1.json")
	fixture, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	const fixturePath = "../../fixtures/eino-agent-recorder-trip-planner-failure-v1.json"
	if os.Getenv("WRITE_REALISTIC_AGENT_FAILURE_FIXTURE") != "" {
		if err := os.WriteFile(fixturePath, fixture, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("%v\nactual:\n%s", err, fixture)
	}
	if !equivalentRunRecordFixture(t, record, expected) {
		t.Fatalf("realistic failed Agent RunRecord does not match fixture\nactual:\n%s", fixture)
	}
}

func containsError(err error, fragment string) bool {
	for err != nil {
		if len(fragment) == 0 || containsString(err.Error(), fragment) {
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}

func containsString(value, fragment string) bool {
	if len(fragment) > len(value) {
		return false
	}
	for index := 0; index+len(fragment) <= len(value); index++ {
		if value[index:index+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
