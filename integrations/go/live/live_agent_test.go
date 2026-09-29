package live_test

import (
	"context"
	"os"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/tool"
	toolutils "github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	workflowdag "github.com/silicon-nora/eino-workflow-dag/integrations/go"
)

type weatherInput struct {
	City string `json:"city" jsonschema:"required" jsonschema_description:"City name in English"`
}

type weatherOutput struct {
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

type callLog struct {
	mu    sync.Mutex
	calls []string
}

func (log *callLog) add(value string) {
	log.mu.Lock()
	log.calls = append(log.calls, value)
	log.mu.Unlock()
}

func (log *callLog) values() []string {
	log.mu.Lock()
	defer log.mu.Unlock()
	values := append([]string(nil), log.calls...)
	sort.Strings(values)
	return values
}

// TestLiveAgentRecorderWithProvider is an explicit, paid/networked release
// gate. It is skipped unless EINO_LIVE=1 and never writes the provider output
// or credentials to a fixture. The deterministic parent-module test remains
// the repeatable CI gate for the same three-tool scenario.
func TestLiveAgentRecorderWithProvider(t *testing.T) {
	if os.Getenv("EINO_LIVE") != "1" {
		t.Skip("set EINO_LIVE=1 to run the external-provider gate")
	}
	apiKey := os.Getenv("OPENAI_API_KEY")
	modelName := os.Getenv("OPENAI_MODEL")
	if apiKey == "" || modelName == "" {
		t.Fatal("EINO_LIVE=1 requires OPENAI_API_KEY and OPENAI_MODEL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	temperature := float32(0)
	chatModel, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		APIKey:      apiKey,
		Model:       modelName,
		BaseURL:     os.Getenv("OPENAI_BASE_URL"),
		Temperature: &temperature,
		Timeout:     75 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}

	calls := &callLog{}
	weather, err := toolutils.InferTool("get_weather", "Get weather for exactly one city.",
		func(_ context.Context, input weatherInput) (weatherOutput, error) {
			calls.add("weather:" + input.City)
			if input.City == "Singapore" {
				return weatherOutput{City: input.City, Condition: "thunderstorms", TemperatureC: 31, RainProbability: 80}, nil
			}
			return weatherOutput{City: input.City, Condition: "clear", TemperatureC: 24, RainProbability: 10}, nil
		})
	if err != nil {
		t.Fatal(err)
	}
	airQuality, err := toolutils.InferTool("get_air_quality", "Get air quality for exactly one city.",
		func(_ context.Context, input airQualityInput) (airQualityOutput, error) {
			calls.add("air:" + input.City)
			return airQualityOutput{City: input.City, AQI: 42, Category: "good"}, nil
		})
	if err != nil {
		t.Fatal(err)
	}

	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name: "live-trip-planner",
		Instruction: `You are running a tool-use conformance test. Follow these phases exactly:
1. Call get_weather once for Singapore and once for Tokyo. You may call both in the same turn.
2. After receiving both results, call get_air_quality once for Tokyo.
3. After receiving that result, answer the user in Chinese. Do not skip or repeat a tool.`,
		Model: chatModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools: []tool.BaseTool{weather, airQuality},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: false})
	recorder := workflowdag.NewAgentRecorder("run-live-trip-agent", workflowdag.AgentRecorderOptions{})
	iterator, err := recorder.Query(ctx, runner, "比较新加坡和东京，推荐更适合户外活动的城市，并确认东京空气质量。")
	if err != nil {
		t.Fatal(err)
	}
	var final *schema.Message
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		if event.Output != nil && event.Output.MessageOutput != nil {
			message := event.Output.MessageOutput.Message
			if message != nil && message.Role == schema.Assistant && len(message.ToolCalls) == 0 {
				final = message
			}
		}
	}
	if ctx.Err() != nil {
		t.Fatal(ctx.Err())
	}
	if final == nil || final.Content == "" {
		t.Fatal("provider run produced no final assistant message")
	}
	if got := calls.values(); len(got) != 3 || got[0] != "air:Tokyo" || got[1] != "weather:Singapore" || got[2] != "weather:Tokyo" {
		t.Fatalf("provider tool calls = %v, want one air-quality and two weather calls", got)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	if err := workflowdag.ValidateRunRecord(record); err != nil {
		t.Fatal(err)
	}
	if record.Source != workflowdag.RunSourceAgent || len(record.Evidence) < 18 {
		t.Fatalf("live RunRecord source=%q evidence=%d", record.Source, len(record.Evidence))
	}
}
