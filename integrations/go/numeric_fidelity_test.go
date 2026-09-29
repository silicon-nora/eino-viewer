package einoworkflowsnapshot

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/cloudwego/eino/compose"
)

// These are real Graph Invoke records, not handcrafted JSON parser fixtures.
// Keep numbers as Go integers through capture and serialization: the viewer
// must reject an unsafe numeric token rather than silently rounding its value.
func TestGraphRecorderNumericFidelity(t *testing.T) {
	for _, scenario := range []struct {
		name string
		body map[string]any
		want map[string]string
	}{
		{
			name: "graph-safe-integers",
			body: map[string]any{
				"signedMin":     int64(-9007199254740991),
				"signedMax":     int64(9007199254740991),
				"unsignedMax":   uint64(9007199254740991),
				"zero":          int64(0),
				"signedMinText": "-9223372036854775808",
				"signedMaxText": "9223372036854775807",
				"unsignedText":  "18446744073709551615",
			},
			want: map[string]string{
				"signedMin":     "-9007199254740991",
				"signedMax":     "9007199254740991",
				"unsignedMax":   "9007199254740991",
				"zero":          "0",
				"signedMinText": `"-9223372036854775808"`,
				"signedMaxText": `"9223372036854775807"`,
				"unsignedText":  `"18446744073709551615"`,
			},
		},
		{
			name: "graph-unsafe-integers",
			body: map[string]any{
				"firstUnsafePositive": int64(9007199254740992),
				"firstUnsafeNegative": int64(-9007199254740992),
				"firstUnsafeUnsigned": uint64(9007199254740992),
				"signedMin":           int64(-9223372036854775808),
				"signedMax":           int64(9223372036854775807),
				"unsignedMax":         uint64(18446744073709551615),
				"positiveUnsafe":      int64(9007199254740993),
				"negativeUnsafe":      int64(-9007199254740993),
				"unsignedUnsafe":      uint64(9007199254740993),
				"zero":                int64(0),
				"signedMinText":       "-9223372036854775808",
				"signedMaxText":       "9223372036854775807",
				"unsignedText":        "18446744073709551615",
			},
			want: map[string]string{
				"firstUnsafePositive": "9007199254740992",
				"firstUnsafeNegative": "-9007199254740992",
				"firstUnsafeUnsigned": "9007199254740992",
				"signedMin":           "-9223372036854775808",
				"signedMax":           "9223372036854775807",
				"unsignedMax":         "18446744073709551615",
				"positiveUnsafe":      "9007199254740993",
				"negativeUnsafe":      "-9007199254740993",
				"unsignedUnsafe":      "9007199254740993",
				"zero":                "0",
				"signedMinText":       `"-9223372036854775808"`,
				"signedMaxText":       `"9223372036854775807"`,
				"unsignedText":        `"18446744073709551615"`,
			},
		},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := context.Background()
			graph := compose.NewGraph[map[string]any, map[string]any]()
			calls := 0
			if err := graph.AddLambdaNode("echo", compose.InvokableLambda(func(_ context.Context, value map[string]any) (map[string]any, error) {
				calls++
				return value, nil
			})); err != nil {
				t.Fatal(err)
			}
			if err := graph.AddEdge(compose.START, "echo"); err != nil {
				t.Fatal(err)
			}
			if err := graph.AddEdge("echo", compose.END); err != nil {
				t.Fatal(err)
			}
			recorder := NewGraphRecorder("run-"+scenario.name, GraphRecorderOptions{})
			clock := func() time.Time { return time.UnixMilli(1790000000000) }
			recorder.now, recorder.events.now = clock, clock
			runnable, err := graph.Compile(ctx, compose.WithGraphName(scenario.name), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			output, err := runnable.Invoke(ctx, scenario.body, recorder.InvokeOption())
			if err != nil || calls != 1 || !reflect.DeepEqual(output, scenario.body) {
				t.Fatalf("real Invoke changed business values: calls=%d output=%#v error=%v", calls, output, err)
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			assertLifecycle(t, record.Evidence, "success", "complete")
			assertGraphIOIdentity(t, record)
			encoded, err := MarshalRunRecord(record)
			if err != nil {
				t.Fatal(err)
			}
			assertNumericBodyTokens(t, encoded, scenario.want)
			var formatted bytes.Buffer
			if err := json.Indent(&formatted, encoded, "", "  "); err != nil {
				t.Fatal(err)
			}
			formatted.WriteByte('\n')
			path := filepath.Join("../../fixtures/input-boundaries", scenario.name+".json")
			if os.Getenv("UPDATE_FIXTURES") == "1" {
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, formatted.Bytes(), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			golden, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			assertNumericBodyTokens(t, golden, scenario.want)
			if !bytes.Equal(golden, formatted.Bytes()) {
				t.Fatalf("%s differs from real GraphRecorder output; regenerate deliberately with UPDATE_FIXTURES=1", path)
			}
		})
	}
}

// RawMessage assertions check the source token, including string quotes. A
// float64 decode could make a rounded actual number equal a rounded expected
// number, incorrectly passing the exactness test this boundary needs.
func assertNumericBodyTokens(t *testing.T, encoded []byte, want map[string]string) {
	t.Helper()
	var record struct {
		Evidence []struct {
			Kind    string `json:"kind"`
			Payload struct {
				Direction string                     `json:"direction"`
				Body      map[string]json.RawMessage `json:"body"`
			} `json:"payload"`
			Metadata struct {
				IO struct {
					Scope string `json:"scope"`
				} `json:"io"`
			} `json:"metadata"`
		} `json:"evidence"`
	}
	if err := json.Unmarshal(encoded, &record); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, envelope := range record.Evidence {
		if envelope.Kind != string(ComponentIOKind) {
			continue
		}
		key := envelope.Metadata.IO.Scope + "/" + envelope.Payload.Direction
		counts[key]++
		if len(envelope.Payload.Body) != len(want) {
			t.Fatalf("%s field count = %d, want %d", key, len(envelope.Payload.Body), len(want))
		}
		for field, token := range want {
			if got := string(envelope.Payload.Body[field]); got != token {
				t.Fatalf("%s/%s source token = %s, want %s", key, field, got, token)
			}
		}
	}
	if !reflect.DeepEqual(counts, map[string]int{"root/input": 1, "root/output": 1, "node/input": 1, "node/output": 1}) {
		t.Fatalf("root/node capture counts = %#v", counts)
	}
}
