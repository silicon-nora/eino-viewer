package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

func graphIOClock() time.Time { return time.UnixMilli(1_790_000_000_000) }

func graphIOFixture(t *testing.T, record RunRecord, name string) {
	t.Helper()
	if err := ValidateRunRecord(record); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("../../fixtures/recorder-matrix", name+".json")
	if os.Getenv("WRITE_GRAPH_IO_FIXTURES") == "1" {
		if err := os.WriteFile(path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !orderedRecorderFixtureEqual(t, record, want) {
		t.Fatalf("%s differs from real recorder fixture", name)
	}
}

func graphIORecord(t *testing.T, name string, input any, invoke func(context.Context, any) (any, error), policy ProjectionPolicy) (RunRecord, any, error) {
	t.Helper()
	graph := compose.NewGraph[any, any]()
	if err := graph.AddLambdaNode("process", compose.InvokableLambda(invoke)); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge(compose.START, "process"); err != nil {
		t.Fatal(err)
	}
	if err := graph.AddEdge("process", compose.END); err != nil {
		t.Fatal(err)
	}
	recorder := NewGraphRecorder("run-"+name, GraphRecorderOptions{IO: &EnvelopeOptions{Policy: policy}})
	recorder.now, recorder.events.now = graphIOClock, graphIOClock
	runnable, err := graph.Compile(context.Background(), compose.WithGraphName(name), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	output, runErr := runnable.Invoke(context.Background(), input, recorder.InvokeOption())
	record, captureErr := recorder.RunRecord()
	if captureErr != nil {
		t.Fatalf("capture changed successful observation: %v", captureErr)
	}
	assertGraphIOIdentity(t, record)
	return record, output, runErr
}

func graphIOPayload(t *testing.T, envelope Envelope) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func assertGraphIOIdentity(t *testing.T, record RunRecord) {
	t.Helper()
	callbacks := map[string]Envelope{}
	starts := map[string]int{}
	for index, envelope := range record.Evidence {
		if envelope.Kind == CallbackEventKind {
			callbacks[envelope.Correlation["eventId"]] = envelope
			payload := graphIOPayload(t, envelope)
			id := envelope.Correlation["invocationId"]
			if id == "" {
				t.Fatalf("callback %d missing reliable invocation identity", index)
			}
			if payload["phase"] == "start" {
				starts[id] = index
			} else if start, found := starts[id]; !found || start >= index {
				t.Fatalf("terminal callback %d lacks prior matching invocation", index)
			}
		}
	}
	for index, envelope := range record.Evidence {
		if envelope.Kind != ComponentIOKind {
			continue
		}
		callback, found := callbacks[envelope.Correlation["eventId"]]
		if !found || callback.Correlation["entityId"] != envelope.Correlation["entityId"] || callback.Correlation["invocationId"] != envelope.Correlation["invocationId"] {
			t.Fatalf("I/O %d is not tied to exact callback", index)
		}
		payload := graphIOPayload(t, envelope)
		phase := graphIOPayload(t, callback)["phase"]
		if (payload["direction"] == "input") != (phase == "start") {
			t.Fatalf("I/O %d direction mismatch", index)
		}
	}
}

func TestGraphIOSafeRecorderMatrix(t *testing.T) {
	type request struct {
		Query    string  `json:"query"`
		Count    int     `json:"count"`
		Optional *string `json:"optional"`
	}
	tests := []struct {
		name             string
		input            any
		output           any
		policy           ProjectionPolicy
		runErr           error
		outcome, capture string
	}{
		{"structured", request{Query: "查找杭州周末路线", Count: 2}, map[string]any{"answer": "西湖步行路线", "stops": []any{"断桥", "苏堤"}, "count": 2}, ProjectionPolicy{}, nil, "success", "complete"},
		{"empty", "", "", ProjectionPolicy{}, nil, "success", "complete"},
		{"null", (*request)(nil), (*request)(nil), ProjectionPolicy{}, nil, "success", "complete"},
		{"long", "完整长文本", strings.Repeat("静态结果保留全部内容。", 600), ProjectionPolicy{}, nil, "success", "complete"},
		{"oversized", "请生成大结果", strings.Repeat("sensitive-large-value", 300), ProjectionPolicy{MaxDocumentBytes: 1200}, nil, "success", "partial"},
		{"redacted", map[string]any{"query": "账户概览", "secret": strings.Repeat("NEVER_EXPORT_PRIVATE_TOKEN", 1000)}, map[string]any{"answer": "已生成账户概览", "secret": "NEVER_EXPORT_PRIVATE_TOKEN"}, ProjectionPolicy{MaxDocumentBytes: 1600, Redact: func(path []string, value any) (any, bool) {
			if path[len(path)-1] == "secret" {
				return "[REDACTED]", true
			}
			return nil, false
		}}, nil, "success", "partial"},
		{"failed", "失败测试输入", nil, ProjectionPolicy{}, errors.New("upstream service unavailable"), "failed", "complete"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record, output, runErr := graphIORecord(t, "graph-io-"+test.name, test.input, func(_ context.Context, _ any) (any, error) { return test.output, test.runErr }, test.policy)
			if (runErr != nil) != (test.runErr != nil) {
				t.Fatalf("business error = %v", runErr)
			}
			if runErr == nil && !reflect.DeepEqual(output, test.output) {
				t.Fatal("recorder changed application output")
			}
			assertLifecycle(t, record.Evidence, test.outcome, test.capture)
			inputs, outputs := 0, 0
			for _, envelope := range record.Evidence {
				if envelope.Kind != ComponentIOKind {
					continue
				}
				payload := graphIOPayload(t, envelope)
				if payload["direction"] == "input" {
					inputs++
				} else {
					outputs++
				}
				if test.name == "empty" && payload["body"] != "" {
					t.Fatal("empty string was not preserved")
				}
				if test.name == "null" {
					body, present := payload["body"]
					if !present || body != nil {
						t.Fatal("explicit null was lost")
					}
				}
				if test.name == "oversized" && payload["direction"] == "output" {
					if _, found := payload["body"]; found {
						t.Fatal("oversized body retained")
					}
					if !strings.Contains(string(envelope.Metadata), `"reason":"size_limit"`) {
						t.Fatal("missing size omission reason")
					}
				}
			}
			if inputs != 2 || outputs != map[bool]int{true: 0, false: 2}[test.runErr != nil] {
				t.Fatalf("root+node I/O counts = %d/%d", inputs, outputs)
			}
			encoded, _ := json.Marshal(record)
			if test.name == "redacted" && strings.Contains(string(encoded), "NEVER_EXPORT_PRIVATE_TOKEN") {
				t.Fatal("private source data escaped redaction")
			}
			graphIOFixture(t, record, "graph-io-"+test.name)
		})
	}
	t.Run("cancelled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		graph := compose.NewGraph[string, string]()
		graph.AddLambdaNode("process", compose.InvokableLambda(func(context.Context, string) (string, error) { cancel(); return "", ctx.Err() }))
		graph.AddEdge(compose.START, "process")
		graph.AddEdge("process", compose.END)
		recorder := NewGraphRecorder("run-graph-io-cancelled", GraphRecorderOptions{})
		recorder.now, recorder.events.now = graphIOClock, graphIOClock
		runnable, err := graph.Compile(ctx, compose.WithGraphName("graph-io-cancelled"), recorder.CompileOption())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := runnable.Invoke(ctx, "取消测试输入", recorder.InvokeOption()); !errors.Is(err, context.Canceled) {
			t.Fatalf("actual context cancellation = %v", err)
		}
		record, err := recorder.RunRecord()
		if err != nil {
			t.Fatal(err)
		}
		assertLifecycle(t, record.Evidence, "cancelled", "complete")
		assertGraphIOIdentity(t, record)
		graphIOFixture(t, record, "graph-io-cancelled")
	})
}

func TestGraphIOInputSnapshotAndRepeatedVisits(t *testing.T) {
	input := map[string]any{"count": 0, "items": []any{"original"}}
	graph := compose.NewGraph[map[string]any, map[string]any]()
	graph.AddLambdaNode("increment", compose.InvokableLambda(func(_ context.Context, value map[string]any) (map[string]any, error) {
		value["count"] = value["count"].(int) + 1
		value["items"].([]any)[0] = "mutated"
		return value, nil
	}))
	graph.AddEdge(compose.START, "increment")
	graph.AddBranch("increment", compose.NewGraphBranch(func(_ context.Context, value map[string]any) (string, error) {
		if value["count"].(int) < 2 {
			return "increment", nil
		}
		return compose.END, nil
	}, map[string]bool{"increment": true, compose.END: true}))
	recorder := NewGraphRecorder("run-repeat", GraphRecorderOptions{})
	runnable, err := graph.Compile(context.Background(), compose.WithGraphName("repeat"), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runnable.Invoke(context.Background(), input, recorder.InvokeOption()); err != nil {
		t.Fatal(err)
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	assertGraphIOIdentity(t, record)
	counts := []float64{}
	ids := map[string]bool{}
	for _, envelope := range record.Evidence {
		if envelope.Kind != ComponentIOKind {
			continue
		}
		payload := graphIOPayload(t, envelope)
		if payload["direction"] != "input" {
			continue
		}
		body := payload["body"].(map[string]any)
		counts = append(counts, body["count"].(float64))
		ids[envelope.Correlation["invocationId"]] = true
	}
	if !reflect.DeepEqual(counts, []float64{0, 0, 1}) || len(ids) != 3 {
		t.Fatalf("mutation/repeated visits corrupted snapshots: %v ids=%v", counts, ids)
	}
	// Returned envelopes do not alias the retained snapshots.
	record.Evidence[0].Payload[0] = '!'
	if _, err := recorder.RunRecord(); err != nil {
		t.Fatal("caller mutated recorder", err)
	}
}

// Keep test counters compatible with the module's Go 1.18 baseline. Typed
// sync/atomic counters were added in Go 1.19; these functions predate Go 1.18.
type recorderAtomicCounter struct{ value int32 }

func (counter *recorderAtomicCounter) Add(delta int32) int32 {
	return atomic.AddInt32(&counter.value, delta)
}

func (counter *recorderAtomicCounter) Load() int32 {
	return atomic.LoadInt32(&counter.value)
}

func (counter *recorderAtomicCounter) Store(value int32) {
	atomic.StoreInt32(&counter.value, value)
}

type graphIOForbiddenMarshaler struct{ calls *recorderAtomicCounter }

type graphIOPrivateText string

func (graphIOPrivateText) MarshalText() ([]byte, error) {
	panic("must not execute application text marshaler")
}

type graphIOForbiddenTextMarshaler struct {
	Calls  *recorderAtomicCounter
	Secret string
}

func (value *graphIOForbiddenTextMarshaler) MarshalText() ([]byte, error) {
	value.Calls.Add(1)
	return []byte("[MASKED]"), nil
}

func (value graphIOForbiddenMarshaler) MarshalJSON() ([]byte, error) {
	value.calls.Add(1)
	panic("must never serialize application marshaler")
}

func TestGraphIORejectsUnsafeValuesWithoutAffectingRun(t *testing.T) {
	var calls recorderAtomicCounter
	cycle := map[string]any{}
	cycle["self"] = cycle
	for name, input := range map[string]any{"cycle": cycle, "nan": math.NaN(), "infinity": math.Inf(1), "function": func() {}, "channel": make(chan int), "marshaler": graphIOForbiddenMarshaler{&calls}, "text-string": graphIOPrivateText("PRIVATE_TEXT_MARSHALER_DATA"), "text-struct": graphIOForbiddenTextMarshaler{&calls, "PRIVATE_TEXT_MARSHALER_DATA"}, "text-pointer": &graphIOForbiddenTextMarshaler{&calls, "PRIVATE_TEXT_MARSHALER_DATA"}} {
		t.Run(name, func(t *testing.T) {
			record, _, err := graphIORecord(t, name, input, func(context.Context, any) (any, error) { return "business unaffected", nil }, ProjectionPolicy{})
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, record.Evidence, "success", "partial")
			encoded, _ := json.Marshal(record)
			if strings.Contains(string(encoded), "PRIVATE_TEXT_MARSHALER_DATA") {
				t.Fatal("custom text representation was bypassed and exposed underlying private value")
			}
			for _, envelope := range record.Evidence {
				if envelope.Kind == ComponentIOKind && graphIOPayload(t, envelope)["direction"] == "input" && !strings.Contains(string(envelope.Metadata), `"reason":"unsupported_value"`) {
					t.Fatal("unsafe body not explicitly omitted")
				}
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("application MarshalJSON was executed")
	}
}

func TestGraphIOStreamIsNotConsumed(t *testing.T) {
	var reads recorderAtomicCounter
	graph := compose.NewGraph[string, string]()
	graph.AddLambdaNode("stream", compose.StreamableLambda(func(context.Context, string) (*schema.StreamReader[string], error) {
		return schema.StreamReaderWithConvert(schema.StreamReaderFromArray([]string{"first", "second"}), func(value string) (string, error) { reads.Add(1); return value, nil }), nil
	}))
	graph.AddEdge(compose.START, "stream")
	graph.AddEdge("stream", compose.END)
	recorder := NewGraphRecorder("run-stream-io", GraphRecorderOptions{})
	runnable, err := graph.Compile(context.Background(), recorder.CompileOption())
	if err != nil {
		t.Fatal(err)
	}
	stream, err := runnable.Stream(context.Background(), "input", recorder.InvokeOption())
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if reads.Load() != 0 {
		t.Fatal("recorder consumed the live stream")
	}
	record, err := recorder.RunRecord()
	if err != nil {
		t.Fatal(err)
	}
	for _, envelope := range record.Evidence {
		if envelope.Kind == RunLifecycleKind && strings.Contains(string(envelope.Payload), `"ended"`) {
			t.Fatal("reader return manufactured a completed run")
		}
	}
	omitted := 0
	for _, envelope := range record.Evidence {
		if strings.Contains(string(envelope.Metadata), `"reason":"stream_not_consumed"`) {
			omitted++
		}
	}
	// Eino adapts this node's input to a stream as well as its output, while
	// the root input remains a plain value: three real stream callbacks.
	if omitted != 3 {
		t.Fatalf("stream omission observations=%d", omitted)
	}
	for _, want := range []string{"first", "second"} {
		got, err := stream.Recv()
		if err != nil || got != want {
			t.Fatalf("caller stream=%q,%v", got, err)
		}
	}
	if _, err := stream.Recv(); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
}

func TestWorkflowRootIORecorderMatrix(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "workflow-io-success"
		if failed {
			name = "workflow-io-failed"
		}
		t.Run(name, func(t *testing.T) {
			workflow := compose.NewWorkflow[string, string]()
			workflow.AddLambdaNode("process", compose.InvokableLambda(func(_ context.Context, input string) (string, error) {
				if failed {
					return "", errors.New("workflow upstream unavailable")
				}
				return "最终答复：" + input, nil
			})).AddInput(compose.START)
			workflow.End().AddInput("process")
			recorder := NewWorkflowRecorder("run-"+name, WorkflowRecorderOptions{})
			recorder.now = graphIOClock
			recorder.execution.now = graphIOClock
			runnable, err := workflow.Compile(context.Background(), compose.WithGraphName(name), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			_, runErr := runnable.Invoke(context.Background(), "请整理行程", recorder.InvokeOption())
			if (runErr != nil) != failed {
				t.Fatalf("run error=%v", runErr)
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			outcome := "success"
			if failed {
				outcome = "failed"
			}
			assertLifecycle(t, record.Evidence, outcome, "complete")
			rootInputs, rootOutputs := 0, 0
			for _, envelope := range record.Evidence {
				if envelope.Kind != ComponentIOKind || !strings.Contains(string(envelope.Metadata), `"scope":"root"`) {
					continue
				}
				if envelope.Correlation["invocationId"] != "run-"+name+":root" {
					t.Fatal("missing root invocation identity")
				}
				if graphIOPayload(t, envelope)["direction"] == "input" {
					rootInputs++
				} else {
					rootOutputs++
				}
			}
			if rootInputs != 1 || rootOutputs != map[bool]int{true: 0, false: 1}[failed] {
				t.Fatalf("root IO=%d/%d", rootInputs, rootOutputs)
			}
			graphIOFixture(t, record, name)
		})
	}
}
