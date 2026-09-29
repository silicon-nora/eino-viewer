package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/components/model"
	toolcomponent "github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

const weatherScenarioRunID = "run-weather-agent-1"

type deterministicWeatherModel struct {
	mu            sync.Mutex
	inputs        [][]*schema.Message
	toolArguments string
}

func (m *deterministicWeatherModel) GetType() string { return "DeterministicWeather" }

func (m *deterministicWeatherModel) Generate(_ context.Context, input []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	m.mu.Lock()
	m.inputs = append(m.inputs, append([]*schema.Message(nil), input...))
	m.mu.Unlock()

	for _, message := range input {
		if message.Role == schema.Tool {
			return schema.AssistantMessage("新加坡当前晴，31°C，湿度 68%。适合出行，注意防晒。", nil), nil
		}
	}
	arguments := m.toolArguments
	if arguments == "" {
		arguments = `{"city":"Singapore"}`
	}
	return schema.AssistantMessage("我来查询天气工具。", []schema.ToolCall{{
		ID:   "call-weather-1",
		Type: "function",
		Function: schema.FunctionCall{
			Name:      "get_weather",
			Arguments: arguments,
		},
	}}), nil
}

func (m *deterministicWeatherModel) Stream(ctx context.Context, input []*schema.Message, options ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	message, err := m.Generate(ctx, input, options...)
	if err != nil {
		return nil, err
	}
	return schema.StreamReaderFromArray([]*schema.Message{message}), nil
}

func (m *deterministicWeatherModel) WithTools(_ []*schema.ToolInfo) (model.ToolCallingChatModel, error) {
	return m, nil
}

func (m *deterministicWeatherModel) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.inputs)
}

type deterministicWeatherTool struct {
	mu   sync.Mutex
	city string
}

func (t *deterministicWeatherTool) GetType() string { return "DeterministicWeather" }

func (t *deterministicWeatherTool) Info(context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "get_weather",
		Desc: "查询指定城市的当前天气",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"city": {
				Type:     schema.String,
				Desc:     "城市英文名",
				Required: true,
			},
		}),
	}, nil
}

func (t *deterministicWeatherTool) InvokableRun(_ context.Context, argumentsJSON string, _ ...toolcomponent.Option) (string, error) {
	var input struct {
		City string `json:"city"`
	}
	if err := json.Unmarshal([]byte(argumentsJSON), &input); err != nil {
		return "", err
	}
	if input.City != "Singapore" {
		return "", fmt.Errorf("unexpected city %q", input.City)
	}
	t.mu.Lock()
	t.city = input.City
	t.mu.Unlock()
	return `{"city":"Singapore","condition":"晴","temperatureC":31,"humidityPercent":68}`, nil
}

func (t *deterministicWeatherTool) calledCity() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.city
}

type weatherComponentCapture struct {
	mu        sync.Mutex
	envelopes []Envelope
	err       error
}

func (capture *weatherComponentCapture) Handler() callbacks.Handler {
	return callbacks.NewHandlerBuilder().
		OnStartFn(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
			capture.project(ctx, info, ComponentIOInput, input)
			return ctx
		}).
		OnEndFn(func(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
			capture.project(ctx, info, ComponentIOOutput, output)
			return ctx
		}).
		Build()
}

func (capture *weatherComponentCapture) project(ctx context.Context, info *callbacks.RunInfo, direction ComponentIODirection, value any) {
	if info == nil || (info.Component != components.ComponentOfChatModel && info.Component != components.ComponentOfTool) {
		return
	}
	options := EnvelopeOptions{Correlation: map[string]string{"runId": weatherScenarioRunID}}
	var envelope Envelope
	var diagnostics []Diagnostic
	var err error
	if direction == ComponentIOInput {
		envelope, diagnostics, err = ProjectComponentInputEnvelope(ctx, info, value, options)
	} else {
		envelope, diagnostics, err = ProjectComponentOutputEnvelope(ctx, info, value, options)
	}
	capture.mu.Lock()
	defer capture.mu.Unlock()
	if err != nil && capture.err == nil {
		capture.err = err
	}
	if len(diagnostics) != 0 && capture.err == nil {
		capture.err = fmt.Errorf("unexpected component diagnostics: %#v", diagnostics)
	}
	if err == nil {
		capture.envelopes = append(capture.envelopes, envelope)
	}
}

func (capture *weatherComponentCapture) selectEnvelopes(t *testing.T, component string, direction ComponentIODirection) []Envelope {
	t.Helper()
	capture.mu.Lock()
	defer capture.mu.Unlock()
	if capture.err != nil {
		t.Fatal(capture.err)
	}
	var result []Envelope
	for _, envelope := range capture.envelopes {
		var payload ComponentIOPayload
		if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Component == component && payload.Direction == direction {
			result = append(result, envelope)
		}
	}
	return result
}

func projectWeatherMessage(t *testing.T, message *schema.Message) Envelope {
	t.Helper()
	envelope, diagnostics, err := ProjectSchemaMessageEnvelope(message, EnvelopeOptions{
		Correlation: map[string]string{"runId": weatherScenarioRunID},
	})
	if err != nil || len(diagnostics) != 0 {
		t.Fatalf("unexpected message projection: %v %#v", err, diagnostics)
	}
	return envelope
}

func projectWeatherAgentEvents(t *testing.T, events []*adk.AgentEvent) []Envelope {
	t.Helper()
	result := make([]Envelope, 0, len(events))
	for _, event := range events {
		envelope, diagnostics, err := ProjectAgentEventEnvelope(event, EnvelopeOptions{
			Correlation: map[string]string{"runId": weatherScenarioRunID},
		})
		if err != nil || len(diagnostics) != 0 {
			t.Fatalf("unexpected agent projection: %v %#v", err, diagnostics)
		}
		result = append(result, envelope)
	}
	return result
}

func removeGeneratedMessageIDs(t *testing.T, envelope *Envelope) {
	t.Helper()
	var payload any
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	var visit func(any)
	visit = func(value any) {
		switch current := value.(type) {
		case map[string]any:
			delete(current, "_eino_msg_id")
			for _, child := range current {
				visit(child)
			}
		case []any:
			for _, child := range current {
				visit(child)
			}
		}
	}
	visit(payload)
	normalized, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	envelope.Payload = normalized
}

func TestRealWeatherAgentScenarioMatchesSharedFixture(t *testing.T) {
	ctx := context.Background()
	weatherModel := &deterministicWeatherModel{}
	weatherTool := &deterministicWeatherTool{}
	capture := &weatherComponentCapture{}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "weather-agent",
		Description: "调用天气工具并回答用户问题",
		Instruction: "你是天气助手。需要实时天气时调用 get_weather，然后根据工具结果回答。",
		Model:       weatherModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools: []toolcomponent.BaseTool{weatherTool},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	query := schema.UserMessage("新加坡现在天气怎么样？")
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
	iterator := runner.Run(ctx, []*schema.Message{query}, adk.WithCallbacks(capture.Handler()))
	var events []*adk.AgentEvent
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		events = append(events, event)
	}
	if weatherModel.callCount() != 2 {
		t.Fatalf("expected two model turns, got %d", weatherModel.callCount())
	}
	if weatherTool.calledCity() != "Singapore" {
		t.Fatalf("weather tool received %q", weatherTool.calledCity())
	}
	if len(events) != 3 {
		t.Fatalf("expected model, tool, and final agent events, got %d", len(events))
	}
	roles := []schema.RoleType{schema.Assistant, schema.Tool, schema.Assistant}
	for index, event := range events {
		if event.Output == nil || event.Output.MessageOutput == nil || event.Output.MessageOutput.Role != roles[index] {
			t.Fatalf("unexpected event %d: %#v", index, event)
		}
	}
	finalMessage := events[2].Output.MessageOutput.Message
	if finalMessage.Content != "新加坡当前晴，31°C，湿度 68%。适合出行，注意防晒。" {
		t.Fatalf("unexpected final answer %q", finalMessage.Content)
	}

	modelInputs := capture.selectEnvelopes(t, string(components.ComponentOfChatModel), ComponentIOInput)
	toolInputs := capture.selectEnvelopes(t, string(components.ComponentOfTool), ComponentIOInput)
	toolOutputs := capture.selectEnvelopes(t, string(components.ComponentOfTool), ComponentIOOutput)
	if len(modelInputs) != 2 || len(toolInputs) != 1 || len(toolOutputs) != 1 {
		t.Fatalf("unexpected callback capture counts: model=%d tool-in=%d tool-out=%d", len(modelInputs), len(toolInputs), len(toolOutputs))
	}
	toolInfo, err := weatherTool.Info(ctx)
	if err != nil {
		t.Fatal(err)
	}
	toolEnvelope, diagnostics, err := ProjectSchemaToolEnvelope(toolInfo, EnvelopeOptions{
		Correlation: map[string]string{"runId": weatherScenarioRunID},
	})
	if err != nil || len(diagnostics) != 0 {
		t.Fatalf("unexpected tool projection: %v %#v", err, diagnostics)
	}
	agentEnvelopes := projectWeatherAgentEvents(t, events)
	envelopes := []Envelope{
		projectWeatherMessage(t, query),
		toolEnvelope,
		modelInputs[0],
		agentEnvelopes[0],
		toolInputs[0],
		toolOutputs[0],
		agentEnvelopes[1],
		modelInputs[1],
		agentEnvelopes[2],
		projectWeatherMessage(t, finalMessage),
	}
	steps := []string{
		"schema-message-user",
		"schema-tool-get-weather",
		"component-io-chat-model-input-1",
		"agent-event-assistant-1",
		"component-io-tool-input",
		"component-io-tool-output",
		"agent-event-tool",
		"component-io-chat-model-input-2",
		"agent-event-assistant-2",
		"schema-message-assistant",
	}
	for index := range envelopes {
		// Eino assigns internal message IDs while the runner executes. They are
		// useful at runtime but deliberately excluded from this reproducible fixture.
		removeGeneratedMessageIDs(t, &envelopes[index])
		observedAt := int64(1_789_000_100_000 + index*100)
		envelopes[index].ObservedAtMS = &observedAt
		metadata, err := json.Marshal(map[string]string{
			"scenario": "weather-agent-v1",
			"step":     steps[index],
		})
		if err != nil {
			t.Fatal(err)
		}
		envelopes[index].Metadata = metadata
	}

	actual, err := json.MarshalIndent(envelopes, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	if outputPath := os.Getenv("WRITE_WEATHER_SCENARIO_FIXTURE"); outputPath != "" {
		if err := os.WriteFile(outputPath, actual, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile("../../fixtures/eino-agent-weather-scenario-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("real weather Agent scenario does not match shared fixture\nactual:\n%s", actual)
	}

	workflow, err := ProjectAgentRunToWorkflow(query, events, AgentWorkflowOptions{
		RunID:        weatherScenarioRunID,
		WorkflowName: "天气 Agent · 查询新加坡",
	})
	if err != nil {
		t.Fatal(err)
	}
	workflow.Metadata["evidenceFixture"] = "eino-agent-weather-scenario-v1.json"
	workflowActual, err := json.MarshalIndent(workflow, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	workflowActual = append(workflowActual, '\n')
	if outputPath := os.Getenv("WRITE_WEATHER_WORKFLOW_FIXTURE"); outputPath != "" {
		if err := os.WriteFile(outputPath, workflowActual, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	workflowExpected, err := os.ReadFile("../../fixtures/eino-agent-weather-workflow-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(workflowActual) != string(workflowExpected) {
		t.Fatalf("Agent-to-Workflow projection does not match shared fixture\nactual:\n%s", workflowActual)
	}
}

func TestWeatherAgentSurfacesToolFailure(t *testing.T) {
	ctx := context.Background()
	weatherModel := &deterministicWeatherModel{toolArguments: `{"city":"Atlantis"}`}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "weather-agent",
		Instruction: "需要实时天气时调用 get_weather。",
		Model:       weatherModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools: []toolcomponent.BaseTool{&deterministicWeatherTool{}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
	iterator := runner.Run(ctx, []*schema.Message{schema.UserMessage("查询 Atlantis 天气")})
	var runError error
	var events []*adk.AgentEvent
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		events = append(events, event)
		if event.Err != nil {
			runError = event.Err
			break
		}
	}
	if runError == nil || !strings.Contains(runError.Error(), `unexpected city "Atlantis"`) {
		t.Fatalf("expected the Runner to surface the tool failure, got %v", runError)
	}
	if weatherModel.callCount() != 1 {
		t.Fatalf("model must stop after the failed tool call, got %d turns", weatherModel.callCount())
	}
	failedWorkflow, err := ProjectAgentRunToWorkflow(schema.UserMessage("查询 Atlantis 天气"), events, AgentWorkflowOptions{RunID: "run-weather-failure"})
	if err != nil {
		t.Fatal(err)
	}
	last := failedWorkflow.Execution.Nodes[len(failedWorkflow.Execution.Nodes)-1]
	if last.Status != NodeStatusFailed || !strings.Contains(last.ErrorMessage, `unexpected city "Atlantis"`) {
		t.Fatalf("failed Agent workflow did not preserve the error: %#v", last)
	}
	if failedWorkflow.Workflow.Nodes[len(failedWorkflow.Workflow.Nodes)-1].ID == "final-output" {
		t.Fatal("failed Agent workflow must not invent a final output")
	}
}

func TestAgentWorkflowDoesNotInventMissingAssistantOutput(t *testing.T) {
	events := []*adk.AgentEvent{{
		AgentName: "weather-agent",
		Action:    &adk.AgentAction{CustomizedAction: map[string]any{"phase": "waiting"}},
	}}
	workflow, err := ProjectAgentRunToWorkflow(
		schema.UserMessage("查询新加坡天气"),
		events,
		AgentWorkflowOptions{RunID: "run-weather-incomplete"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(workflow.Workflow.Nodes) != 1 || workflow.Workflow.Nodes[0].ID != "user-input" {
		t.Fatalf("incomplete Agent run must expose only its recorded user input: %#v", workflow.Workflow.Nodes)
	}
	if indexes, ok := workflow.Workflow.Nodes[0].Metadata["sourceEventIndexes"].([]int); !ok || len(indexes) != 1 || indexes[0] != 1 {
		t.Fatalf("hidden Agent event must remain evidence on the nearest visible node: %#v", workflow.Workflow.Nodes[0].Metadata)
	}
	for _, node := range workflow.Workflow.Nodes {
		if node.ID == "final-output" {
			t.Fatal("incomplete Agent run must not invent a final output")
		}
	}
}
