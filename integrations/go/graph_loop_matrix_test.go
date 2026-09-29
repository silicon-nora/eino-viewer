package einoworkflowsnapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/cloudwego/eino/compose"
)

type graphLoopState struct {
	Request string `json:"request"`
	Round   int    `json:"round"`
	Route   string `json:"route"`
	Score   int    `json:"score"`
	Status  string `json:"status"`
}

type graphLoopVisit struct {
	node   string
	input  graphLoopState
	output graphLoopState
	err    string
}

// A real multi-node cycle, with one alternative declared but never selected.
// Each visit has different business values so pairing by node name instead of
// invocation identity cannot accidentally pass the fixture assertions.
func TestGraphLoopRecorderMatrix(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "graph-multistep-loop-success"
		if failed {
			name = "graph-multistep-loop-failed"
		}
		t.Run(name, func(t *testing.T) {
			input := graphLoopState{Request: "杭州一日路线", Status: "queued"}
			prepared := graphLoopState{Request: input.Request, Round: 1, Route: "西湖", Status: "draft"}
			first := graphLoopState{Request: input.Request, Round: 1, Route: "西湖", Score: 60, Status: "revise"}
			secondDraft := graphLoopState{Request: input.Request, Round: 2, Route: "西湖 → 灵隐寺", Status: "draft"}
			second := graphLoopState{Request: input.Request, Round: 2, Route: secondDraft.Route, Score: 80, Status: "revise"}
			thirdDraft := graphLoopState{Request: input.Request, Round: 3, Route: "西湖 → 灵隐寺 → 钱塘江", Status: "draft"}
			third := graphLoopState{Request: input.Request, Round: 3, Route: thirdDraft.Route, Score: 100, Status: "accept"}
			final := graphLoopState{Request: input.Request, Round: 3, Route: thirdDraft.Route, Score: 100, Status: "completed"}
			failure := errors.New("route evaluation unavailable at round 2")
			want := []graphLoopVisit{
				{node: "prepare", input: input, output: prepared},
				{node: "evaluate", input: prepared, output: first},
				{node: "revise", input: first, output: secondDraft},
				{node: "evaluate", input: secondDraft, output: second},
				{node: "revise", input: second, output: thirdDraft},
				{node: "evaluate", input: thirdDraft, output: third},
				{node: "finish", input: third, output: final},
			}
			if failed {
				want = want[:4]
				want[3].output = graphLoopState{}
				want[3].err = failure.Error()
			}

			graph := compose.NewGraph[graphLoopState, graphLoopState]()
			var visitsMu sync.Mutex
			var visits []graphLoopVisit
			add := func(id string, action func(graphLoopState) (graphLoopState, error)) {
				t.Helper()
				err := graph.AddLambdaNode(id, compose.InvokableLambda(func(_ context.Context, value graphLoopState) (graphLoopState, error) {
					output, err := action(value)
					visit := graphLoopVisit{node: id, input: value, output: output}
					if err != nil {
						visit.err = err.Error()
					}
					visitsMu.Lock()
					visits = append(visits, visit)
					visitsMu.Unlock()
					return output, err
				}), compose.WithNodeName(id))
				if err != nil {
					t.Fatal(err)
				}
			}
			add("prepare", func(value graphLoopState) (graphLoopState, error) {
				value.Round, value.Route, value.Status = 1, "西湖", "draft"
				return value, nil
			})
			add("evaluate", func(value graphLoopState) (graphLoopState, error) {
				if failed && value.Round == 2 {
					return graphLoopState{}, failure
				}
				value.Score = 40 + value.Round*20
				value.Status = "revise"
				if value.Score == 100 {
					value.Status = "accept"
				}
				return value, nil
			})
			add("revise", func(value graphLoopState) (graphLoopState, error) {
				value.Round++
				value.Score, value.Status = 0, "draft"
				if value.Round == 2 {
					value.Route += " → 灵隐寺"
				} else {
					value.Route += " → 钱塘江"
				}
				return value, nil
			})
			add("finish", func(value graphLoopState) (graphLoopState, error) {
				value.Status = "completed"
				return value, nil
			})
			add("fallback", func(value graphLoopState) (graphLoopState, error) {
				value.Status = "fallback"
				return value, nil
			})
			for _, edge := range [][2]string{{compose.START, "prepare"}, {"prepare", "evaluate"}, {"revise", "evaluate"}, {"finish", compose.END}, {"fallback", compose.END}} {
				if err := graph.AddEdge(edge[0], edge[1]); err != nil {
					t.Fatal(err)
				}
			}
			if err := graph.AddBranch("evaluate", compose.NewGraphBranch(func(_ context.Context, value graphLoopState) (string, error) {
				switch value.Status {
				case "accept":
					return "finish", nil
				case "revise":
					return "revise", nil
				default:
					return "fallback", nil
				}
			}, map[string]bool{"revise": true, "finish": true, "fallback": true})); err != nil {
				t.Fatal(err)
			}
			recorder := NewGraphRecorder("run-"+name, GraphRecorderOptions{})
			recorder.now, recorder.events.now = graphIOClock, graphIOClock
			runnable, err := graph.Compile(context.Background(), compose.WithGraphName(name), compose.WithMaxRunSteps(16), recorder.CompileOption())
			if err != nil {
				t.Fatal(err)
			}
			output, runErr := runnable.Invoke(context.Background(), input, recorder.InvokeOption())
			if failed {
				if !errors.Is(runErr, failure) || output != (graphLoopState{}) {
					t.Fatalf("failed root Invoke: output=%#v error=%v", output, runErr)
				}
			} else if runErr != nil || output != final {
				t.Fatalf("successful root Invoke: output=%#v error=%v", output, runErr)
			}
			visitsMu.Lock()
			actualVisits := append([]graphLoopVisit(nil), visits...)
			visitsMu.Unlock()
			if !reflect.DeepEqual(actualVisits, want) {
				t.Fatalf("actual invocation order/count/body changed:\nactual=%#v\nwant=%#v", actualVisits, want)
			}
			calls := map[string]int{"prepare": 0, "evaluate": 0, "revise": 0, "finish": 0, "fallback": 0}
			for _, visit := range actualVisits {
				calls[visit.node]++
			}
			wantCalls := map[string]int{"prepare": 1, "evaluate": 3, "revise": 2, "finish": 1, "fallback": 0}
			if failed {
				wantCalls = map[string]int{"prepare": 1, "evaluate": 2, "revise": 1, "finish": 0, "fallback": 0}
			}
			if !reflect.DeepEqual(calls, wantCalls) {
				t.Fatalf("node call counts = %#v, want %#v", calls, wantCalls)
			}
			record, err := recorder.RunRecord()
			if err != nil {
				t.Fatal(err)
			}
			record.Metadata = JSONMap{"fixtureScenario": name, "executionMode": "deterministic-local"}
			assertGraphLoopEvidence(t, record, name, input, output, want, failed)
			assertGraphLoopFixture(t, name, record)
		})
	}
}

func assertGraphLoopEvidence(t *testing.T, record RunRecord, name string, input, output graphLoopState, visits []graphLoopVisit, failed bool) {
	t.Helper()
	if err := ValidateRunRecord(record); err != nil {
		t.Fatal(err)
	}
	if err := validateStaticGraphWorkflowOrder(record); err != nil {
		t.Fatal(err)
	}
	assertGraphIOIdentity(t, record)
	outcome := "success"
	if failed {
		outcome = "failed"
	}
	assertLifecycle(t, record.Evidence, outcome, "complete")
	if len(record.Diagnostics) != 0 {
		t.Fatalf("complete loop capture has diagnostics: %#v", record.Diagnostics)
	}

	var definition Graph
	if record.Evidence[0].Kind != ComposeGraphKind {
		t.Fatal("missing real compiled Graph definition")
	}
	if err := json.Unmarshal(record.Evidence[0].Payload, &definition); err != nil {
		t.Fatal(err)
	}
	nodes := make([]string, 0, len(definition.Nodes))
	for _, node := range definition.Nodes {
		nodes = append(nodes, node.ID)
	}
	sort.Strings(nodes)
	if !reflect.DeepEqual(nodes, []string{"evaluate", "fallback", "finish", "prepare", "revise"}) ||
		!reflect.DeepEqual(definition.Branches, []Branch{{From: "evaluate", Targets: []string{"fallback", "finish", "revise"}}}) {
		t.Fatalf("compiled loop or unvisited fallback lost: %#v", definition)
	}
	wantEdges := []Edge{
		{From: "fallback", To: "end", Channels: []string{"control", "data"}},
		{From: "finish", To: "end", Channels: []string{"control", "data"}},
		{From: "prepare", To: "evaluate", Channels: []string{"control", "data"}},
		{From: "revise", To: "evaluate", Channels: []string{"control", "data"}},
		{From: "start", To: "prepare", Channels: []string{"control", "data"}},
	}
	if !reflect.DeepEqual(definition.Edges, wantEdges) {
		t.Fatalf("static dependency edges changed: %#v", definition.Edges)
	}

	type expectedObservation struct {
		node         string
		phase        CallbackPhase
		invocationID string
		body         graphLoopState
		err          string
	}
	rootID := record.RunID + ":1"
	want := []expectedObservation{{phase: CallbackPhaseStart, invocationID: rootID, body: input}}
	for index, visit := range visits {
		id := fmt.Sprintf("%s:%d", record.RunID, 2+index*2)
		want = append(want, expectedObservation{node: visit.node, phase: CallbackPhaseStart, invocationID: id, body: visit.input})
		phase := CallbackPhaseEnd
		if visit.err != "" {
			phase = CallbackPhaseError
		}
		want = append(want, expectedObservation{node: visit.node, phase: phase, invocationID: id, body: visit.output, err: visit.err})
	}
	rootEnd := expectedObservation{phase: CallbackPhaseEnd, invocationID: rootID, body: output}
	if failed {
		rootEnd.phase, rootEnd.err = CallbackPhaseError, visits[len(visits)-1].err
	}
	want = append(want, rootEnd)
	callbackCount, ioCount := 0, 0
	seenInputs := map[string]bool{}
	seenOutputs := map[string]bool{}
	for index, envelope := range record.Evidence {
		switch envelope.Kind {
		case CallbackEventKind:
			if callbackCount >= len(want) {
				t.Fatalf("unexpected callback at evidence[%d]", index)
			}
			expected := want[callbackCount]
			var event CallbackEvent
			if err := json.Unmarshal(envelope.Payload, &event); err != nil {
				t.Fatal(err)
			}
			path := []string(nil)
			entityID := "runnable:" + name
			if expected.node != "" {
				path = []string{expected.node}
				entityID += "/node:" + expected.node
			}
			if event.Sequence != uint64(callbackCount+1) || event.Phase != expected.phase || event.Streaming || !reflect.DeepEqual(event.NodePath, path) ||
				envelope.Correlation["eventId"] != fmt.Sprintf("%s:%d", record.RunID, callbackCount+1) ||
				envelope.Correlation["invocationId"] != expected.invocationID || envelope.Correlation["entityId"] != entityID {
				t.Fatalf("callback %d visit boundary/identity mismatch: %#v / %#v", callbackCount, event, envelope.Correlation)
			}
			if expected.err != "" {
				if event.Error == nil || !strings.Contains(event.Error.Message, expected.err) {
					t.Fatalf("callback %d lost real error: %#v", callbackCount, event)
				}
			} else if event.Error != nil {
				t.Fatalf("callback %d invented error: %#v", callbackCount, event)
			}
			callbackCount++
		case ComponentIOKind:
			if callbackCount == 0 {
				t.Fatal("I/O precedes its callback")
			}
			expected := want[callbackCount-1]
			if expected.phase == CallbackPhaseError {
				t.Fatalf("failed invocation invented output at evidence[%d]", index)
			}
			var payload struct {
				Direction string          `json:"direction"`
				Streaming bool            `json:"streaming"`
				NodePath  []string        `json:"nodePath"`
				Body      json.RawMessage `json:"body"`
			}
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			direction, scope := "input", "node"
			path := []string{expected.node}
			if expected.phase == CallbackPhaseEnd {
				direction = "output"
			}
			if expected.node == "" {
				scope, path = "root", nil
			}
			body, err := json.Marshal(expected.body)
			if err != nil {
				t.Fatal(err)
			}
			if payload.Direction != direction || payload.Streaming || !reflect.DeepEqual(payload.NodePath, path) ||
				string(canonicalRecorderJSON(t, payload.Body)) != string(canonicalRecorderJSON(t, body)) ||
				envelope.Correlation["invocationId"] != expected.invocationID ||
				envelope.Correlation["eventId"] != fmt.Sprintf("%s:%d", record.RunID, callbackCount) {
				t.Fatalf("I/O paired with wrong visit at evidence[%d]: %s / %#v", index, envelope.Payload, envelope.Correlation)
			}
			var metadata struct {
				IO struct {
					Scope string `json:"scope"`
				} `json:"io"`
				Capture struct {
					Status string `json:"status"`
				} `json:"capture"`
			}
			if err := json.Unmarshal(envelope.Metadata, &metadata); err != nil {
				t.Fatal(err)
			}
			if metadata.IO.Scope != scope || metadata.Capture.Status != "captured" {
				t.Fatalf("I/O scope/capture mismatch at evidence[%d]: %s", index, envelope.Metadata)
			}
			seen := seenInputs
			if direction == "output" {
				seen = seenOutputs
			}
			if seen[expected.invocationID] {
				t.Fatalf("duplicate %s for invocation %s", direction, expected.invocationID)
			}
			seen[expected.invocationID] = true
			ioCount++
		}
	}
	wantIO := len(want)
	if failed {
		wantIO -= 2 // Failed node and failed root have errors, never fabricated output.
	}
	if callbackCount != len(want) || ioCount != wantIO || len(seenInputs) != len(visits)+1 || len(seenOutputs) != wantIO-len(visits)-1 {
		t.Fatalf("complete callback/I/O capture lost: callbacks=%d io=%d inputs=%d outputs=%d", callbackCount, ioCount, len(seenInputs), len(seenOutputs))
	}
}

func assertGraphLoopFixture(t *testing.T, name string, record RunRecord) {
	t.Helper()
	if name != "graph-multistep-loop-success" && name != "graph-multistep-loop-failed" {
		t.Fatalf("fixture writer cannot target %q", name)
	}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("../../fixtures/recorder-matrix", name+".json")
	if os.Getenv("WRITE_GRAPH_LOOP_FIXTURES") == "1" {
		if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// This serial cycle has no unrelated arrivals to normalize. The existing
	// ordered comparator retains all visit ordering, identities and business I/O.
	if !orderedRecorderFixtureEqual(t, record, expected) {
		t.Fatalf("%s differs from actual GraphRecorder output; regenerate explicitly with WRITE_GRAPH_LOOP_FIXTURES=1", path)
	}
}
