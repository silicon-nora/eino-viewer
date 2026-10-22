# Go Recorder and projection

This module records one Eino Agent, Graph or Workflow run as an `EinoRunRecord`
that can be saved and opened directly by `eino-viewer`. The supported viewing
flow is a saved, completed **non-streaming** run, not live or streaming capture.

It also provides the compatibility-first `eino-dag` envelope used to carry
independently versioned Eino information domains. Existing snapshot functions
remain unchanged.

## Native RunRecord v2

The current checkout also provides **native v2 capture**. Use the explicit v2
constructors before execution; `RunRecordV2()` never upgrades or guesses facts
from a v1 `RunRecord`. The older constructors and APIs described below retain
their existing behavior. Go releases use the `integrations/go/vX.Y.Z` tag prefix;
see [release instructions](../../RELEASING.md) for the independent SDK gate.

`RunRecorderV2Options.ExplicitContentRedactor` optionally applies a separate
redactor to caller-projected content, event attributes and annotations. Automatic
callback I/O continues using `Envelope.Policy.Redact`; all safe serialization and
size limits remain in force. Leave it nil to apply the same policy everywhere.

```go
recorder := workflowdag.NewAgentRecorderV2("agent-run-42", workflowdag.AgentRecorderOptions{})
iterator, err := recorder.Run(ctx, runner, messages)
if err != nil { return err }
for {
    event, ok := iterator.Next()
    if !ok { break }
    // Handle the original event, including errors, then keep draining.
    handleEvent(event)
}
encoded, err := recorder.MarshalRunRecordV2()
if err != nil { return err }
// Save encoded, then read it with the v2 Viewer. RunRecord() still returns v1.
```

For an existing Graph or Workflow, use `NewGraphRecorderV2` or
`NewWorkflowRecorderV2`, pass `CompileOption()` and `InvokeOption()` exactly as
in the existing examples, and export with `RunRecordV2()` /
`MarshalRunRecordV2()`. Each constructor still takes its existing options type.
An old constructor followed by `RunRecordV2()` returns `ErrV2NotEnabled`.

V2 observes each callback invocation with its own ID and propagates that ID
through Eino's per-handler context. Repeated graph nodes stay distinct and
same-name concurrent AgentTools keep separate parents. Definitions and their
candidate edges do not create executed invocations. Root outcomes come from
the actual non-streaming Graph/Workflow boundary or the exhausted Runner
iterator, including orchestration errors absent from Agent callback copies.
Content is copied at observation time through the existing bounded JSON and
redaction policy. Empty strings and explicit null remain actual values.

Every actual model invocation has one usage row. Actual callback configuration
and supplied token counts are used; absent usage is explicitly unknown, and a
supplied zero is preserved. Invalid counts produce capture issues and unknown
usage. Numbers outside the reader's exact range are retained as sanitized JSON
**text in a diagnostic content**, with a missing-body descriptor instead of
silently rounding the original payload. Application-owned model clients can
supply their observed usage through the explicit API below.

### Application boundaries and extension points

`NewRunRecorderV2` puts an application boundary, Eino children, and explicitly
instrumented operations/model calls in one document. Pass each returned context
to its actual child work; names are never used to discover parents.

```go
recorder, err := workflowdag.NewRunRecorderV2("generate-42", workflowdag.RunRecorderV2Options{
    Source: "application", Scope: "recommendation-engine",
})
if err != nil { return err }
runCtx, _, err := recorder.Begin(ctx, workflowdag.InvocationStartV2{
    Kind: "application", Name: "Generate", HasInput: true, Input: request,
})
if err != nil { return err }
runnable, err := workflow.Compile(runCtx, recorder.CompileOption())
if err != nil {
    _ = recorder.End(runCtx, workflowdag.InvocationEndV2{Status: "failed", Error: err})
} else {
    result, runErr := runnable.Invoke(runCtx, request, recorder.InvokeOption())
    outcome := workflowdag.InvocationEndV2{Status: "succeeded", HasOutput: true, Output: result}
    if runErr != nil { outcome = workflowdag.InvocationEndV2{Status: "failed", Error: runErr} }
    if err := recorder.End(runCtx, outcome); err != nil { return err }
}
encoded, captureErr := recorder.MarshalRunRecordV2()
```

Use another `Begin(runCtx, ...)` / `End(childCtx, ...)` for a real
application-owned operation or model request. `HasInput` / `HasOutput` distinguish
an absent observation from an observed nil value. `RecordModelUsage(childCtx,
ModelUsageV2{...})` only accepts a model invocation and validates the observed
nonnegative counts, totals, subsets and numeric bounds. Repeated observations
merge into the same ledger row: non-nil counters replace that counter, nil
preserves a known value, and counters are never summed. Invalid merged totals
are rejected without changing the prior row; an unknown observation never
erases known counts. `Annotate(childCtx, "namespace.type", 1, payload)` takes a bounded,
redacted snapshot of a business extension. The authoritative JS validator must
still validate registered annotation payloads and cross-record semantics.

`RecordContent(ctx, ContentV2{Content: protocolv2.Content{...}, InputOf: ..., OutputOf: ...})`
records an explicit wire descriptor and returns its allocated content ID. The
descriptor retains `schemaRef`, availability (`inline`, `reference`, `missing`),
provenance, completeness and redacted/truncated transforms. An inline
`json.RawMessage("null")` is an observed null; an absent body needs a missing
descriptor with a reason and unknown completeness. Inline bodies use the same
bounded safe-body/redaction policy. `InputOf` and `OutputOf` attach the immutable
content to existing invocation IDs, including shared state and root results.

`RecordEvent(ctx, protocolv2.Event{...})` and
`RecordRelation(protocolv2.Relation{...})` allocate IDs and retain explicit
content/definition references and evidenced relationships. Events receive the
recorder's increasing observation sequence; source timestamps remain optional.
Content/event owners default to the invocation in `ctx`. Use
`AnnotateOwner(protocolv2.Ref{...}, type, version, payload)` for an explicit run,
event, invocation or other local owner. Unknown extension types/versions and
unknown content schemas remain preserved for the shared validator to report.

`CurrentInvocationID(ctx)` returns the actual Eino or manual invocation identity.
`DefinitionID(fullPath)` resolves IDs from this recorder's compile callback;
names and unrelated GraphInfo documents are not identity keys.
`SetCorrelation(map[string]string)` and `SetLabels(map[string]string)` copy
external identifiers and producer labels. `SetCapture(protocolv2.Capture{...})`
replaces declared coverage and adds caller-observed gaps while retaining any
previous recorder issues. `SkipChatModelCallbacks(ctx)` suppresses all five
native model callback timings in an explicitly recorded model call, preserving
legacy handlers and preventing a second usage ledger row for the same request.

The first successful `RunRecordV2()` or `MarshalRunRecordV2()` seals the static
document, including its seal timestamp. Finish observations before exporting.
Subsequent exports have identical bytes and return defensive copies; explicit
write APIs return `ErrV2Sealed`. Late Eino callbacks and compile callbacks cannot
change the native document, and configured legacy callbacks still run.

### V2 capture limits

- Supported automatic Agent entry points are **Run and Query**. Legacy
  `Wrap`-only recording, standalone `RecordMessage` / `RecordEvent`, and
  `RecordTool` source injection do not define complete v2 boundaries; unsupported
  manual entry paths fail v2 export explicitly. Use Run/Query or the explicit
  application collector. V1 source APIs remain available on ordinary recorders.
- Recorder observes independent Agent callback iterator copies asynchronously.
  It never consumes application-owned model/message streams. A live stream or
  incomplete invocation retains running/unknown state, missing content and
  capture issues. Draining the application's stream does not automatically
  backfill its body, final usage, or a missing terminal callback into this
  collector. Static exports of running, interrupted, or streaming runs do
  not wait for those streams. After an exhausted non-streaming root, export
  synchronizes already registered Agent copies for at most 250 ms; any missing
  terminal boundary is reported as partial capture.
- Tool requests are linked to tool callbacks only when the observed external
  call ID and name resolve uniquely within the actual Agent invocation scope.
  Missing or ambiguous identity remains an issue, not a guessed relationship.
  Transfer requests are retained; actual transfers are not inferred from names.
- Model coverage concerns Eino callbacks or explicit Begin/End instrumentation.
  Hidden provider activity, application state and business outcomes are not
  discovered automatically. No provider/model identity is guessed from defaults.
- V2 constructors retain legacy APIs, so applications choosing them may invoke
  the configured redactor for both projections. Redactors should be pure and
  thread-safe. Ordinary v1 constructors do not activate the v2 collector.
- These APIs do not implement persistence, external reference storage, live
  streaming reconstruction, checkpoint resume, or cloud-focus integration.
  Go wire types and producer checks do not replace the complete JS contract
  validator.

### Generate and validate real Eino recordings

Tests use the actual Eino Runner/Graph/Workflow and deterministic external model
and tool implementations. They assert execution, invocation identities, usage,
capture loss, cancellation, stream ownership and outer Runner failure. No
network or real model credentials are needed.

```sh
# From integrations/go; emits fresh runtime records into the given directory.
WRITE_NATIVE_V2_FIXTURES=/tmp/eino-native-v2 go test -count=1 -run TestNativeV2 ./...
# From the repository root; use the same output directory.
node protocol/v2/validate.js /tmp/eino-native-v2/*.json
# Explicitly update the checked-in real-run examples instead:
WRITE_NATIVE_V2_FIXTURES=1 go test -count=1 -run TestNativeV2 ./...
```

Without the environment variable, tests do not write fixtures. Current example
records live in [testdata/v2](./testdata/v2); their timestamps are observations,
not deterministic golden values. The same producer tests can generate fresh
inputs for Viewer validation on every run.

`TestNativeV2ApplicationWorkflowExplicitFacts` executes a real Workflow with a
manual callback-enabled model, one merged usage row, partial/missing content,
cloud-focus route/result/evaluation references and an unknown extension.
`TestNativeV2SealedWritesAndLegacyCallbacks` covers all write APIs, repeated
byte-identical exports and five legacy callback timings; concurrent observations
and preserved caller gaps are covered separately. Run
`node scripts/check-protocol-v2-recorders.js` from the repository root to validate
fresh output from these tests through the shared JS and business-profile
validator and Viewer projection. The SDK release workflow repeats these checks
for the exact module tag before a GitHub release is published.

## Start here

1. Attach the [Agent](#agentrecorder), [Graph](#graphrecorder) or
   [Workflow](#workflowrecorder) Recorder to the corresponding existing run.
2. Finish the non-streaming invocation; for Agent, drain the wrapped iterator.
   Preserve a failed run too: do not return on `runErr` before saving its record.
3. [Save and open the Run Record](#save-and-open-a-run-record). Use the offline
   HTML to read JSON, or `createEinoRunViewer` to embed
   the complete reader. No manual projection or envelope assembly is required.

Already have a JSON file? Skip Recorder setup and follow the
[English viewing guide](../../README.md#open-a-saved-record) or
[中文查看说明](../../README.zh-CN.md#打开已保存的记录).

## Install

```bash
go get github.com/silicon-nora/eino-viewer/integrations/go@v0.1.0
```

The module is versioned independently from the npm package. Because its
`go.mod` lives in this repository subdirectory, Go releases use tags prefixed
with the module directory, such as `integrations/go/v0.1.0`.

## Recorder overview

Each Recorder belongs to one run. It installs Eino callbacks through explicit
compile or invocation options; it does not register global hooks.

The snippets below fit inside an existing Eino application: `ctx`, the
Graph/Workflow or Runner, its input, and application event handling are supplied
by the caller. Continue the chosen snippet with the shared
[save block](#save-and-open-a-run-record), then handle its business result/error.
Import this module with the alias used in the examples:

```go
import workflowdag "github.com/silicon-nora/eino-viewer/integrations/go"
```

### Completion and capture completeness

New records carry additive `run.lifecycle@1` evidence inside the existing
schema-v1 Run Record; no second pre-interpreted step model is stored.

- `started` records an observed run boundary. It does not imply that the run
  is still executing now: it means its end has not been recorded.
- `ended` records an observed termination, with `outcome` (`success`, `failed`,
  `cancelled`, or `unknown`) and independent `capture` (`complete` or `partial`).
- Agent records end only when the wrapped, non-streaming iterator is exhausted.
  Breaking after an output or error event does not record the end; drain the
  iterator before exporting the final record.
- Graph/Workflow non-streaming root callbacks establish termination. A nested
  node error alone does not determine the whole run's result.
- Returning a stream reader does not establish that its execution has ended.
  Streaming Agent and root streaming Graph/Workflow runs remain without a
  recorded end; Recorder does not consume application-owned streams to fill
  this gap. Streaming capture/completion is unsupported; use completed
  non-streaming runs.
- Redaction, omitted stream content, or capture errors can make capture partial
  without changing execution success into failure. `complete` describes the
  recorder's supported capture surface, not hidden reasoning or unobserved data.

Older records remain readable with an unknown-completion warning. A recorded
end distinguishes a known outcome from an incomplete or unknown run.

### WorkflowRecorder

`WorkflowRecorder` is a facade over the existing compile-time topology
projection and runtime `ExecutionRecorder`:

```go
recorder := workflowdag.NewWorkflowRecorder("run-42", workflowdag.WorkflowRecorderOptions{})
runnable, err := workflow.Compile(ctx, recorder.CompileOption())
if err != nil {
	return err
}

result, runErr := runnable.Invoke(ctx, input, recorder.InvokeOption())
```

`runErr` is the Workflow's runtime result. `recordErr` reports only collection
or projection problems. The snapshot combines the exact compiled definition
with the final node outcomes observed for that invocation. Call
`recorder.MarkSkipped(path)` only when application routing authoritatively
identifies a skipped node; generic Eino callbacks cannot infer it.

`RunRecord` is the default product result: one portable artifact containing the
Workflow definition and the real `component.io` input/output observed for the
root call and each node. Root I/O follows the safe capture policy below;
`DisableRootIO: true` explicitly retains legacy node-only collection.
Pass it directly to `eino-viewer` or serialize it with
`MarshalRunRecord`. `Snapshot`, `MarshalSnapshot`, `Envelopes`, and
`MarshalEnvelopes` keep their original contracts for existing and advanced
consumers.

The original `Project*` and `ExecutionRecorder` APIs remain supported for
existing applications.

### AgentRecorder

`AgentRecorder` wraps the default ADK Runner and preserves its pull iterator:

```go
recorder := workflowdag.NewAgentRecorder("agent-run-42", workflowdag.AgentRecorderOptions{})
events, err := recorder.Run(ctx, runner, messages)
if err != nil {
	return err
}
for {
	event, ok := events.Next()
	if !ok {
		break
	}
	use(event) // the original *adk.AgentEvent
}
```

The evidence contains the user input, observed model/tool component I/O, every
Runner event, and an assistant `schema.message` only when the run actually
produced a final non-streaming assistant message. Tool definitions are optional:
actual tool calls are correlated from source events and component I/O. A failed
run therefore cannot acquire an invented assistant output.

`RunRecord` is also the default Agent result. `Envelopes` remains available
when an advanced consumer needs the independently versioned source records.

#### Realistic and live Agent gates

The default Go suite includes a production-shaped, deterministic Agent run:
three model turns, two city weather calls, a follow-up air-quality call, Eino's
parallel tool dispatch, a late tool failure, and a golden `RunRecord`. The model
is deliberately a test double; Eino still owns the real ADK turn loop,
ToolNode execution, callbacks, events, and Recorder integration.

An isolated live module verifies the same contract with Eino's OpenAI-compatible
ChatModel. It is opt-in because it uses network access, credentials, and billable
tokens, and because provider output cannot be a deterministic CI fixture:

```bash
cd integrations/go/live
EINO_LIVE=1 \
OPENAI_API_KEY='...' \
OPENAI_MODEL='your-tool-capable-model' \
go test -run TestLiveAgentRecorderWithProvider -v
```

Set `OPENAI_BASE_URL` for a compatible endpoint. Without `EINO_LIVE=1` the test
skips; with live mode enabled, missing credentials fail instead of silently
passing. The test never writes provider output or credentials to a fixture.

### GraphRecorder

`GraphRecorder` records a compiled Graph definition, callback events, and safe
root/node input and output bodies:

```go
recorder := workflowdag.NewGraphRecorder("graph-run-42", workflowdag.GraphRecorderOptions{})
runnable, err := graph.Compile(ctx, recorder.CompileOption())
if err != nil {
	return err
}

result, runErr := runnable.Invoke(ctx, input, recorder.InvokeOption())
```

The `compose.graph` definition remains possibly cyclic. Back edges are retained
instead of forcing the Graph into Workflow or DAG semantics.

#### Safe body capture (current checkout)

Graph I/O is enabled by default. `GraphRecorderOptions.IO` accepts an
`*EnvelopeOptions`; nil inherits `Events`, including its policy. Use
`DisableIO: true` for metadata-only legacy recording. Workflow root and node I/O use
`WorkflowRecorderOptions.Envelope.Policy`. These changes are not a published
release by themselves.

Configure `Policy.Redact` for private application data before exporting a
record. **Bodies are not automatically scrubbed of secrets.** Safe capture
copies plain JSON-compatible data, applies the redactor, then serializes and
checks `MaxDocumentBytes` (default 4 MiB per envelope). It does not execute
application `MarshalJSON` or `MarshalText` methods. Depth (64), traversal (100,000 values), and
byte-buffer copy (16 MiB) bounds also apply. Unsupported values, including
`json.Number`, custom marshalers, ambiguous JSON fields and non-finite numbers,
are reported as omitted rather than silently converted.

Each body has `metadata.io.scope` (`root` or `node`) and `metadata.capture`:
`status: "captured"` optionally with `redacted: true`, or `status: "omitted"`
with `reason: "size_limit"`, `"unsupported_value"`, or `"stream_not_consumed"`.
Omitted bodies have no `body` property; a real null remains `"body": null`.
Empty strings, false and zero remain values. Omissions/redaction make capture
partial without changing the business outcome or dropping lifecycle evidence.
Stream callbacks never consume readers to manufacture a final output.

Graph `eventId` connects a body to its exact callback boundary;
`invocationId` connects the observed start and terminal of the same visit.
Repeated visits therefore keep their own input/output. Root values are distinct
from child values and are never inferred from the last executed node.

This safe policy applies to Graph and Workflow runtime root/node I/O, Agent
component callbacks, captured Agent events, input/derived messages, tool
definitions, and runtime envelope metadata. Agent uses
`AgentRecorderOptions.Envelope.Policy`. An unsafe or oversized Agent message
retains its role and available tool-call identity, but not a fabricated empty
answer. An unsafe event retains structural action/identity facts; arbitrary
customized output and interruption data may be explicitly omitted. Capture
remains partial even when the underlying execution succeeds.

Tool definitions retain safe names, descriptions, and extensions. A non-nil
Eino `ParamsOneOf` requires custom serialization or recursive conversion, so
Recorder omits that parameter definition with a
`projection.runtime_field_omitted` diagnostic and partial capture. It does not
invoke Eino's custom serializer. Plain official model and tool callback bodies,
including empty responses, are covered by tests.

Public explicit `Project*` helpers and compile-time Graph/Workflow topology
projection keep their existing `encoding/json` behavior for compatibility;
their caller-provided objects and metadata are not covered by this runtime
safe-copy guarantee. Error strings are still source error descriptions, not a
claim to sandbox arbitrary application `Error()` methods. Configure redaction
for sensitive error descriptions too. Recorder does not support live replay
or consuming streams; use completed non-streaming runs.

See [`EINO_RECORDER_DIRECTION.md`](../../docs/EINO_RECORDER_DIRECTION.md) for the
source-fidelity and release requirements.

## Save and open a Run Record

After non-streaming `Invoke` returns, or the Agent's wrapped iterator reaches
`Next() == false`, serialize the same recorder's result. Save before handling an
early return for an execution failure, so the failed run remains inspectable.
Execution errors (`runErr` or Agent events) and capture errors (`recordErr`) are
different; neither a local tool error nor capture completeness alone establishes
the whole run's outcome.

```go
runRecord, recordErr := recorder.RunRecord()
if recordErr != nil {
	log.Printf("record capture: %v", recordErr)
}
encoded, err := workflowdag.MarshalRunRecord(runRecord)
if err != nil {
	return err // no usable artifact was produced
}
if err := os.WriteFile("run-record.json", encoded, 0o600); err != nil {
	return err
}
```

The surrounding application imports `log`, `os`, and the `workflowdag` alias
above. A capture error can accompany a useful partial record; serialization
still validates the record and can fail. Review redaction policy before sharing
the file: it contains captured inputs, outputs and error descriptions, and the
viewer does not automatically remove secrets.

Choose a viewing route:

- **Offline:** open an existing `eino-viewer.html` in a browser and select, drop
  or paste `run-record.json`. To prepare the package from the repository root
  with dependencies installed, run `npm run build:portable`; distribute
  `.artifacts/portable/eino-viewer.html` with its adjacent `LICENSES.txt`.
  The recipient needs no source checkout, server or network connection.
- **Repository examples:** from the repository root with dependencies
  installed, run `npm run build:site`, then
  `python3 -m http.server 4173 --bind 127.0.0.1`. Open
  `http://127.0.0.1:4173/.artifacts/pages/?lang=en` and choose an Agent, Graph or
  Workflow card. The record dropdown lists only that type's examples; return
  home to choose another type. The workbench does not open files. Use the
  offline or embedded reader for your own saved records; `?lang=zh` selects Chinese.
- **Embedded:** pass the record object to `createEinoRunViewer`; the
  [complete-reader example](../../README.md#embed-the-complete-reader) includes
  its container and renderer stylesheet. `createEinoViewer` is the separate
  low-level canvas entry, not the complete result UI.

All routes detect Agent/Graph/Workflow from the record and keep it local. Select
a step to inspect its input/output and original evidence. Choosing a call scope
also changes the local trajectory or path and call result; the overall final
result remains separate. Agent uses a trajectory, without a path diagram;
the workbench lays it out in full, while embedded and offline readers retain pagination.
Graph/Workflow scopes of up to 500 nodes draw automatically;
larger ones require a draw action. Search uses names, statuses and structural identities,
not business bodies or body summaries.

The workbench starts with directly selectable Agent/Graph/Workflow examples;
no saved record or hand-authored JSON is required to try it.

The workbench presents the saved Agent trajectory directly, without playback
controls or calling models and tools again. Legacy records without explicit
completion evidence remain viewable without claiming a completed outcome.

## Manual Workflow projection

```go
package main

import (
	"context"
	"encoding/json"
	"os"

	workflowdag "github.com/silicon-nora/eino-viewer/integrations/go"
	"github.com/cloudwego/eino/compose"
)

type compileCallback func(context.Context, *compose.GraphInfo)

func (callback compileCallback) OnFinish(ctx context.Context, info *compose.GraphInfo) {
	callback(ctx, info)
}

func writeSnapshot(ctx context.Context, workflow *compose.Workflow[string, string]) error {
	var info *compose.GraphInfo
	_, err := workflow.Compile(
		ctx,
		compose.WithGraphCompileCallbacks(compileCallback(
			func(_ context.Context, graph *compose.GraphInfo) { info = graph },
		)),
	)
	if err != nil {
		return err
	}

	snapshot, err := workflowdag.ProjectWithOptions(info, workflowdag.ProjectOptions{
		ResolveNodeKind: func(
			path []string,
			_ compose.GraphNodeInfo,
		) (workflowdag.NodeKind, bool) {
			switch {
			case len(path) == 1 && path[0] == "prepare":
				return workflowdag.NodeKindIO, true
			case len(path) == 1 && path[0] == "route":
				return workflowdag.NodeKindBranch, true
			case len(path) == 2 && path[0] == "answer" && path[1] == "invoke":
				return workflowdag.NodeKindLLM, true
			default:
				return "", false
			}
		},
	})
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(snapshot)
}
```

`ProjectWithOptions` emits schema version 1 with optional node kinds. Its
resolver receives a full node path so nested graphs can reuse local node IDs
without collisions. Nested graph
nodes are always emitted with `kind: "graph"`; leaf nodes for which the
resolver returns `false` omit `kind` and retain the renderer's component-based
fallback. A resolver may return `llm`, `io`, `cpu`, `branch`, or `merge`;
`graph` is assigned automatically to nodes containing a nested workflow.

The original `Project` and `Marshal` functions continue to omit `kind`. This
keeps their existing output stable. New producers that need explicit visual
semantics should use `ProjectWithOptions` or `MarshalWithOptions` and upgrade
the JavaScript renderer at the same time.

## Eino DAG protocol

`ProjectComposeGraphEnvelope` emits the same deterministic graph topology as a
`compose.graph` version-1 payload without adding the legacy snapshot wrapper:

```go
envelope, diagnostics, err := workflowdag.ProjectComposeGraphEnvelope(
	info,
	workflowdag.ComposeGraphEnvelopeOptions{
		Envelope: workflowdag.EnvelopeOptions{
			Source: map[string]string{"einoVersion": "0.9.19"},
		},
	},
)
```

The projector supplies `source.module = "compose"` and
`source.format = "GraphInfo"`; caller keys such as `einoVersion` are retained.
Use `MarshalComposeGraphEnvelope` for encoded JSON and `ParseEnvelope` for
strict decoding of received documents.

`EnvelopeOptions.Policy.MaxDocumentBytes` limits intermediate payload JSON and
the final envelope. Its default is 4 MiB. `Policy.Redact` receives a stable path
starting with `payload` or `metadata`; replacing a value produces a
`projection.redacted` warning. Function values, cycles, unsupported JSON values,
unknown envelope fields, and invalid raw JSON are rejected instead of being
silently dropped.

Both projection APIs emit deterministic node, edge, branch, and field-mapping
arrays. They combine Eino control and data dependencies between the same
endpoints into one edge. Static-value mapping records have no predecessor and
are omitted.

Execution state is intentionally not inferred from `GraphInfo`. Use one
`ExecutionRecorder` for each invocation and attach its result separately:

```go
recorder := workflowdag.NewExecutionRecorder("run-42")
_, err := runnable.Invoke(
	ctx,
	input,
	compose.WithCallbacks(recorder.Handler()),
)

execution := recorder.Execution()
snapshot.Execution = &execution
```

The recorder uses Eino's hierarchical execution address to produce node paths,
including nested paths such as `[]string{"answer", "invoke"}`. It emits only
final `success` and `failed` node records plus start, finish, duration, and error
message fields. A node that has started but not finished is omitted from the
returned execution snapshot.

Eino's generic callbacks do not expose skipped nodes. When routing or
observability data authoritatively identifies one, call
`recorder.MarkSkipped([]string{"path", "to", "node"})`; it emits `skipped`
with `durationMs: null`. An error raised later while consuming a returned stream
is not visible through Eino's `OnError` callback and must be added by the stream
consumer.

For event-level observability, use a separate `CallbackEventRecorder` alongside
the legacy final-outcome recorder:

```go
events := workflowdag.NewCallbackEventRecorder("run-42")
_, err := runnable.Invoke(
	ctx,
	input,
	compose.WithCallbacks(recorder.Handler(), events.Handler()),
)

envelopes, diagnostics, projectionErr := events.Envelopes(
	workflowdag.EnvelopeOptions{
		Source: map[string]string{"einoVersion": "0.9.19"},
	},
)
```

Each `callback.event` carries a run-local sequence, `start`, `end`, or `error`
phase, stream flag, timestamp, complete Eino address, projected `RunInfo`, and a
node-only path that resolves against `compose.graph`. Correlation adds `runId`,
`eventId`, `entityId`, and `parentEntityId`. Callback input and output bodies are
not captured implicitly; they require a component-specific projector and the
same explicit redaction and size policy used by other payloads.

ADK and Schema values use dedicated projectors:

```go
agentEnvelope, warnings, err := workflowdag.ProjectAgentEventEnvelope(
	 event,
	 workflowdag.EnvelopeOptions{
		 Source: map[string]string{"einoVersion": "0.9.19"},
		 Correlation: map[string]string{"runId": "run-42"},
	 },
)

messageEnvelope, _, err := workflowdag.ProjectSchemaMessageEnvelope(
	 message,
	 workflowdag.EnvelopeOptions{},
)
```

`ProjectAgenticEventEnvelope` supports
`adk.TypedAgentEvent[*schema.AgenticMessage]`. Schema counterparts are
`ProjectSchemaAgenticMessageEnvelope`, `ProjectSchemaToolEnvelope`, and
`ProjectSchemaDocumentEnvelope`; every projector has a `Marshal...` variant.
They retain the public JSON representation produced by Eino so optional fields
added within the supported minor line are not lost.

Agent event projection never calls `Recv`, `GetMessage`, or `Close`. For a live
message stream it emits metadata with `streaming: true`, omits `value`, and
returns a `projection.stream_omitted` warning. Consume and materialize the
stream in application-owned code before projecting content. Custom outputs,
actions, interrupt data, message extensions, tool metadata, and document
metadata must be JSON-encodable and remain subject to the envelope redactor and
size limit.

Official callback bodies require an explicit component projection call:

```go
inputEnvelope, diagnostics, err := workflowdag.ProjectComponentInputEnvelope(
	ctx,
	runInfo,
	callbackInput,
	workflowdag.EnvelopeOptions{
		Correlation: map[string]string{"runId": "run-42"},
	},
)
```

`ProjectComponentOutputEnvelope` handles outputs. The version-1 projector
normalizes ChatModel, AgenticModel, ChatTemplate, AgenticChatTemplate,
Embedding, Indexer, Retriever, Loader, DocumentTransformer, and Tool callback
types. Runtime template instances are omitted with a
`projection.runtime_field_omitted` warning. Unknown component bodies are kept
only when JSON-safe and receive `projection.custom_component`.

For a streaming callback call `ProjectComponentStreamEnvelope` with only the
context, RunInfo, and direction. Its API deliberately accepts no stream reader,
so it can neither consume nor close one; the body is absent and a
`projection.stream_omitted` warning is returned.

`fixtures/eino-component-io-v1.json` is the standard browser catalog: ten
official component inputs, ten outputs, and one non-consuming stream boundary.
`TestComponentIOFixtureAndStreamBoundary` verifies its exact bytes. Maintainers
may deliberately regenerate it with
`UPDATE_EINO_FIXTURES=1 go test -run TestComponentIOFixtureAndStreamBoundary`;
ordinary test runs are read-only.

`TestRealWeatherAgentScenarioMatchesSharedFixture` executes a real
`adk.ChatModelAgent` through Eino's `adk.Runner`. Its deterministic chat model
requests `get_weather`, the invokable tool returns a structured Singapore
weather response, and the second model turn produces the final answer. Callback
input/output bodies and Runner AgentEvents are projected into the ten-envelope
`fixtures/eino-agent-weather-scenario-v1.json` evidence story.
The JavaScript `buildExecutionDAG` correlator consumes those ten source
envelopes directly and folds them into three user-visible execution instances:
user input, the actual `get_weather` invocation, and assistant output. The
browser then uses `executionDAGToWorkflowSnapshot` only as a compatibility
adapter for the established renderer. `ProjectAgentRunToWorkflow` produces the
same three-node shape for legacy consumers. ReAct events remain source evidence
on these nodes instead of becoming decisions, summaries, or extra canvas nodes.
No network or API key is used. Companion negative tests cover malformed tool
arguments and a weather backend rejection, including propagation of the tool
error into a failed Workflow node without inventing a final output. To
deliberately regenerate the success fixtures, write to temporary files and
review the diffs before replacing them:

```sh
WRITE_WEATHER_SCENARIO_FIXTURE=/tmp/eino-agent-weather-scenario-v1.json \
  go test -run TestRealWeatherAgentScenarioMatchesSharedFixture

WRITE_WEATHER_WORKFLOW_FIXTURE=/tmp/eino-agent-weather-workflow-v1.json \
  go test -run TestRealWeatherAgentScenarioMatchesSharedFixture
```

The supported Eino range is `>=0.9.0 <0.10.0`. CI tests the oldest supported
release and `v0.9.19`, the stable release used by this module. A real compiled
and invoked Workflow produces the topology and execution state consumed by the
JavaScript validator through the shared fixture in
`fixtures/eino-workflow-v1.json`. The public workbench's weather Workflow is
independently compiled and invoked by `TestRealWeatherWorkflowMatchesSharedFixture`;
its reviewed output is stored in `fixtures/eino-weather-workflow-v1.json`.

## Static-result Recorder matrix

`TestStaticAgentRecorderMatrix`, `TestStaticGraphWorkflowMatrix`,
`TestGraphIOSafeRecorderMatrix`, `TestWorkflowRootIORecorderMatrix`,
`TestComplexAgentRecorderMatrix`, `TestNestedAgentRecorderMatrix`,
`TestDeepNestedAgentRecorderMatrix`, `TestGraphLoopRecorderMatrix` and
`TestParallelWorkflowRecorderMatrix` cover thirty-two real Eino cases:
thirty-one actual runs and one compile-only Workflow. They exercise
direct answers, real tool errors recovered by test middleware, native ADK
cancellation, tool interruption, redaction, Graph step limits and cancellation,
failed Workflow successors, nested nodes with the same local name, structured
values, empty strings/null, long text, oversized bodies, root I/O, parallel
same-name tools returning out of order, repeated calls across model turns,
Agent-as-tool parent/child answers, parallel child invocations reusing a local
tool-call ID, a child failure handled by its parent, propagated child failure,
three-level nested calls, multi-node Graph loops, and Workflow parallel joins
with successful or failed branches.
The model double is deterministic; Runner, tool dispatch, callbacks, compile,
and invocation use Eino itself. No network model or API key is needed.

From the repository root, run `npm run test:recorder-matrix`. It runs the Go
cases, JS fixture checks, and a display assessment. The separate
`npm run inspect:recorder-matrix -- --strict` gate now passes the four repaired
display-state/attribution regressions; passing it is not exhaustive coverage.
The two original Graph fixtures intentionally retain metadata-only recording;
new fixtures exercise body capture. `capture=complete` never promises that an
older file contains unsupported business data. Other Go tests cover safe
serialization rejection, redaction failures, repeated visits and unconsumed streams.

### Nested Agent-as-tool evidence

The four `agent-nested-*.json` fixtures use real `adk.NewAgentTool`, ADK Runner,
model/tool callbacks and `EmitInternalEvents: true`, with streaming disabled.
Internal events are collected only for the completed static record; they do not
enable realtime viewing. Parent and child answers intentionally differ. The
parallel fixture plans slow then fast, observes fast then slow, and legally uses
`shared-inner-call` inside both independent child invocations.

The parallel case uses one logical `worker` AgentTool and constructs an
independent real ChatModelAgent for each simultaneous call. Sharing the same
ChatModelAgent instance exposed an upstream `v0.9.19` data race in its captured
cancellation configuration (`adk/chatmodel.go:1145–1147`); neither Recorder nor
these tests claim to repair that dependency or prove shared-instance safety.
The original failure remains in
`.artifacts/iteration-4-upstream-shared-agent-race.log` at the repository root.
For an explicit diagnostic reproduction, run
`EINO_REPRO_SHARED_AGENT_RACE=1 go test -race -run TestNestedAgentRecorderMatrix/agent-nested-parallel-scopes -count=5 .`.
The normal matrix retains actual overlap, deterministic out-of-order completion,
and reused inner IDs rather than serializing the child executions.

`component.io.payload.address` retains the full parent-tool `subId` and child
agent address; this distinguishes those local IDs. Eino's forwarded
`agent.event.payload.runPath` contains only agent names, not the parent-tool
call ID. A viewer must leave an ambiguous child event unassigned instead of
guessing from arrival order. Envelopes and all original messages remain in the
record. Only a root assistant event (or the legacy no-path case) derives an
additional `schema.message`; nested answers do not become a run result.

AgentTool does not forward child error events. `AgentRecorder` therefore keeps
the actual nested component error as an existing `callback.event` envelope,
including its full source address, callback error, observed time and unique
event ID. It uses the same bounded safe-copy and configured-redaction policy as
other Recorder data. Oversized or unsupported error bodies remain explicitly
omitted, with a clearly marked recorder-owned error-details-omitted notice to
preserve the callback protocol's required string field. The notice is not the
business error text. A nested failure is a local execution fact, not a Recorder diagnostic
or an assertion that a successfully recovered parent run failed. Single-agent
legacy recordings are unchanged. This does not add automatic secret detection,
checkpoint/resume support, streaming, or arbitrary multi-agent coverage.

See the [fixture maintenance instructions](../../fixtures/recorder-matrix/README.md),
[results](../../docs/RECORDER_MATRIX_RESULTS.md), and
[static-result roadmap](../../docs/STATIC_RESULT_ROADMAP.md).
