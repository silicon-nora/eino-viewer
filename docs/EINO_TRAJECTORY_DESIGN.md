# Eino Viewer trajectory design

Status: Accepted implementation plan, 2026-09-16.

This document defines how `eino-viewer` will add a chronological Trajectory
view without turning the existing execution DAG into a universal trace model.
It extends [`EINO_RUN_VIEWING_PRODUCT.md`](./EINO_RUN_VIEWING_PRODUCT.md); when
the documents appear to conflict, the product baseline remains authoritative.

## Decision

One Eino Run Record is the only source of truth. Viewer may derive several
independent, read-only projections from it:

```text
                         ┌─ Path: causal, minimal ExecutionDAG
Eino Run Record evidence ├─ Trajectory: chronological business records
                         └─ Raw: complete source evidence
```

The default Path view answers **what meaningful steps happened and depended on
what**. Trajectory answers **what happened in time, across turns and attempts**.
Raw answers **what exact evidence supports those claims**.

Trajectory is not constructed from `ExecutionDAG`. Both projections read the
Run Record directly. This prevents a display decision in one view from erasing
facts needed by another, and prevents the two derived models from silently
becoming a second source of truth.

The initial delivery adds an Agent Trajectory projection and workbench view.
Graph and Workflow use the same public model after their runtime records have
equivalent invocation identity and lifecycle coverage.

## Product objective

An Eino developer opening one run should be able to answer, without reading
JSON:

1. What did the user provide?
2. Which model turn requested which tools?
3. Which tool invocations completed, failed, or remained incomplete?
4. Did operations run independently, sequentially, or as a join?
5. Which result or failure ended the run?
6. Which original records prove each displayed fact?

Path remains the ten-second overview. Trajectory is the next level of detail;
it must not make the first screen harder to understand.

## What is adopted from DeepSeek Harness

DeepSeek Harness uses an append-only Session log as the source of truth and
derives Chat and Trajectory as independent browser projections. Its Trajectory
is a turn-aware event ledger: User, Assistant, Tool, and nested Subtool records
are grouped by Turn and Step; the main ledger keeps only index, event, and
content; selection opens a local inspector containing input, output, timing,
usage, and complete payloads. Long histories use backward paging,
virtualization, stable row identity, and tail following. In-flight rows do not
receive fabricated elapsed times.

Relevant upstream references:

- [DeepSeek Harness Trajectory package](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-trajectory/README.md)
- [DeepSeek Harness Web client data paths](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md)
- [DeepSeek Harness Session log](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)
- [Trajectory inspection ledger design](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-27-trajectory-inspection-ledger.md)

We adopt five principles:

1. **One immutable log, multiple projections.**
2. **Business records, not one row per protocol event.**
3. **Dense overview, details only after selection.**
4. **Recorded timing only; no live or inferred duration.**
5. **Streaming and long histories must preserve row identity and inspection
   position.**

## What is deliberately different

DeepSeek Harness owns its Agent loop and Session event vocabulary. Eino Viewer
is a library receiving Eino records after or during execution. It therefore
cannot assume DSH Turn IDs, request headers, attempt events, token cadence, or
tool nesting are available.

We do not copy:

- DSH event names or Session format;
- DSH provider-request model;
- UI styling or component hierarchy;
- token, TTFT, retry, or cancellation claims unless Recorder captured the
  necessary Eino facts;
- a hosted session service, pagination protocol, or persistence backend.

The Eino projection must degrade honestly. Missing turn identity produces an
ungrouped record, missing timing leaves timing absent, and ambiguous error
ownership remains a run-level error rather than being assigned to a tool.

## Information architecture

The reference Viewer exposes three sibling views:

```text
[Path] [Trajectory] [Raw record]
```

### Path

- Default view.
- User input, tool invocations, assistant output, and attributable failure.
- Causal edges only.
- No model-turn, callback, or protocol nodes.
- No evidence-observation span presented as execution duration.

### Trajectory

- Chronological records grouped by observed model Turn.
- User, Assistant, Tool, and Run Error records.
- Shows repetitions and attempts as separate records.
- Shows running, success, failed, cancelled, or incomplete only when evidence
  supports that state.
- Selecting a record opens the same concise input/output/error inspector used
  by Path.
- A run with a recorded termination boundary may be replayed from the final
  projection; an open or legacy-unconfirmed trajectory has no playback controls.

### Raw record

- Complete JSON-safe Run Record.
- No semantic rewriting.
- Direct navigation from a Path node or Trajectory record to supporting
  evidence indexes.

The embeddable library may render only one requested view. The workbench owns
the tabs and cross-view navigation.

## Completed-run replay

Replay is a navigation mode over the final, immutable Trajectory projection.
It is not a live stream, simulated execution, or source of new timing claims.
The complete result remains the default view. Playback begins only after a user
requests it and moves a playhead across the records already present in the
settled run.

- Only a recorded `run.lifecycle@1` ended boundary unlocks replay.
- A started-only record remains open even if it contains assistant output or a
  failed tool. Legacy evidence without lifecycle boundaries remains readable,
  but its inferred status does not unlock replay.
- Termination outcome and capture completeness are independent. Ended runs with
  unknown outcome or partial capture can replay only the records actually
  captured, with a visible warning; missing content is never reconstructed.
- Previous, next, scrub, pause, and final-result actions select the same record
  model used by ordinary Trajectory clicks.
- Every replay position keeps Path, Trajectory, and Raw evidence navigation in
  sync through source envelope indexes.
- Playback speed is presentation-only and must never be described as recorded
  execution duration.

## Public data model

The first public model is intentionally small:

```ts
type TrajectoryRecordKind = "user" | "assistant" | "tool" | "error";
type TrajectoryStatus = "success" | "running" | "failed" | "cancelled" | "incomplete";

interface TrajectoryEvidenceRef {
  envelopeIndex: number;
  kind: string;
  role?: string;
}

interface TrajectoryTiming {
  semantics: "observed-at" | "observed-span" | "component-boundary";
  startedAtMs?: number;
  finishedAtMs?: number;
  durationMs?: number;
}

interface TrajectoryRecord {
  id: string;
  sequence: number;
  kind: TrajectoryRecordKind;
  status: TrajectoryStatus;
  label: string;
  turn?: number;
  step?: number;
  depth: number;
  parentId?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  timing?: TrajectoryTiming;
  evidence: readonly TrajectoryEvidenceRef[];
  metadata: Readonly<Record<string, unknown>>;
}

interface ExecutionTrajectory {
  schemaVersion: 1;
  runId: string;
  status: "success" | "running" | "failed" | "cancelled" | "incomplete";
  completion: {
    state: "ended" | "open" | "unknown";
    basis: "recorded" | "legacy";
    outcome?: "success" | "failed" | "cancelled" | "unknown";
    capture?: "complete" | "partial";
  };
  records: readonly TrajectoryRecord[];
  metadata: {
    envelopeCount: number;
    representedEvidenceCount: number;
    sourceKinds: readonly string[];
  };
}
```

The API follows existing projector conventions:

```ts
buildExecutionTrajectory(envelopes, options?): {
  ok: true;
  trajectory: ExecutionTrajectory;
  diagnostics: readonly Diagnostic[];
} | {
  ok: false;
  diagnostics: readonly Diagnostic[];
};
```

It accepts one ordered run only. Mixed run IDs, invalid envelopes, or an empty
collection fail with stable diagnostics. The initial implementation supports
Agent-anchored evidence and returns `trajectory.missing_agent_anchor` for a
collection that cannot establish an Agent run.

`createExecutionTrajectoryBuilder()` supports applications that collect
evidence incrementally, but does not define the workbench playback model. The
standard workbench requires a recorded run end before offering replay.

## Projection rules

### Turn boundaries

A non-streaming or streaming `component.io` record for `ChatModel` or
`AgenticModel` with `direction: input` starts the next observed model turn.
Records before the first model input, usually the user message, belong to Turn
1. If no model-input boundary is present, records remain ungrouped rather than
receiving an invented Turn.

`turn` is a display-local positive integer, not a source identity. The evidence
reference remains authoritative.

### User records

One `schema.message` or `schema.agentic_message` with role `user` becomes one
User record. Its original content is `input`. System messages remain evidence
for the relevant Assistant turn and do not appear as default rows.

Repeated user messages remain separate. Steering and queued input require
Recorder evidence before they receive specialized labels.

### Assistant records

An Agent event containing an assistant message becomes an Assistant record.
Assistant tool-call intent and final assistant content are both records because
Trajectory explains turns that Path intentionally hides.

The record contains:

- source content when present;
- original tool-call names, IDs, and arguments in `output` or metadata;
- the current observed Turn;
- all matching ChatModel input/output evidence as context.

A final `schema.message` assistant record and the immediately corresponding
Agent event are folded into one Assistant record using message role, content,
tool-call IDs, and local order. They must not appear twice merely because
Recorder captured both the ADK event and public final message.

### Tool records

One source `tool_call_id` creates one Tool record. The projector folds:

- assistant tool-call intent;
- Tool component input;
- Tool component output;
- Agent tool-result message;
- attributable Agent error;

into that record.

Original arguments become `input`. A recorded tool result becomes `output`.
An attributable error becomes `error`, and status is `failed`. An input without
result or error is `running` for a live prefix and `incomplete` for a settled
record explicitly marked incomplete. The first version cannot distinguish a
stalled live stream from a process that disappeared unless the Run Record
carries settlement metadata.

Tool records share the Assistant record's Turn. Multiple tool calls emitted by
one assistant message receive the same Step and remain siblings. A later model
turn consuming their `tool_call_id` values proves a join, but the chronological
ledger does not render a causal edge; Path owns that relationship.

### Errors

An Agent error naming exactly one known tool-call ID attaches to that Tool
record. When only one tool is running, it may be used as a fallback with a
diagnostic noting the weaker correlation. An error that cannot be attributed
becomes one run-level Error record.

Errors keep the complete source message in evidence. The default presentation
may remove Eino wrapper prefixes from the short summary, but Raw and technical
details retain the original message unchanged.

### Component and callback evidence

`component.io` and `callback.event` are lifecycle evidence, not automatically
rows. They enrich a business record when correlation is available. Unknown or
unmatched evidence stays in Raw and contributes a warning; it is never dropped
from the Run Record.

### Definitions

`schema.tool`, `compose.graph`, and `workflow.snapshot` are definitions. They
may enrich labels or schemas but do not create chronological records by
themselves.

## Ordering and identity

Input envelope order is the primary total order. `observedAtMs` is display
metadata and may be equal, synthetic, delayed, or observed after a logically
later ADK event. It never reorders evidence.

Stable record identity follows this precedence:

1. `tool:<tool_call_id>` for a Tool record;
2. a source message or attempt ID when Recorder provides one;
3. `assistant:turn:<turn>:<ordinal>` for Assistant records;
4. `<kind>:evidence:<first-envelope-index>` as the deterministic fallback.

Appending evidence to a live prefix must preserve all existing record IDs.
Finalization may enrich a record but must not replace it with a new identity.

## Timing semantics

Timing is deliberately strict:

- `observed-at` means one source timestamp was captured;
- `observed-span` means the earliest and latest supporting evidence timestamps;
- `component-boundary` requires explicit start/end boundaries from the same
  component invocation.

Only `component-boundary` may be labeled execution duration. An
`observed-span` may be shown in technical details but not as CPU/tool latency.
Running rows leave duration blank. Synthetic fixture clocks remain valid order
evidence but are not performance measurements.

The first UI phase does not draw a proportional time axis. It ships the ledger
and timing contract first; an Overview timeline follows only after Recorder can
distinguish trustworthy component boundaries.

## Failure, retry, cancellation, and parallelism

### Failure

Earlier successful records remain successful. The failing Tool or Assistant is
marked failed, no later assistant output is invented, and the run is failed.

### Retry

Retries require an attempt identity. Reusing a `tool_call_id` without explicit
attempt evidence updates the same record and emits a diagnostic; it does not
invent `attempt #2`. Recorder must capture or synthesize a stable attempt ID at
the boundary where Eino actually retries.

### Cancellation

Cancellation is displayed only when Recorder captures an explicit cancellation
settlement. A context error string is not sufficient by itself because timeout,
caller cancellation, and provider cancellation may have different ownership.

### Parallelism

Adjacent sibling Tool records with the same Turn/Step mean they were requested
together. That does not prove overlapping wall-clock execution. A parallel
badge requires trustworthy overlapping component boundaries. Path may show
independent branches without claiming simultaneity.

## Cross-view navigation

Path and Trajectory share evidence indexes as their join key.

- Selecting a Path node filters or highlights every Trajectory record whose
  evidence set intersects the node's evidence set.
- Selecting a Trajectory record activates a Path node only when there is one
  unambiguous overlap.
- “Open raw record” navigates to the exact envelope index.
- Clearing selection restores the complete view without changing the run.

No view stores another view's private record ID as its canonical link.

## Rendering contract

The first Trajectory UI is a semantic ledger, not a decorative timeline:

```text
TURN 1
01  User       Compare Singapore and Tokyo…
02  Assistant  Calls get_weather ×2
03  Tool       get_weather · Singapore         success
04  Tool       get_weather · Tokyo             success

TURN 2
05  Assistant  Calls get_air_quality · Tokyo
06  Tool       get_air_quality · Tokyo          failed
```

Default row content is limited to index, kind, concise source value, and status
when non-success. Input, output, error, timing, usage, schemas, correlation, and
payloads appear only in the selected-record inspector or technical disclosure.

Accessibility requirements:

- the ledger is a semantic list or table with deterministic reading order;
- Turn boundaries are headings, not color-only separators;
- status has text as well as color;
- selection and disclosure are keyboard operable;
- replay progress announcements describe steps, never streamed tokens;
- virtualization preserves `aria-rowindex` and focus identity.

## Append compatibility and scale

The pure builder initially supports complete arrays and append-only rebuilds.
An incremental builder follows the existing ExecutionDAG pattern:

```ts
const builder = createExecutionTrajectoryBuilder({ runId });
builder.append(envelope);
builder.snapshot();
```

Required invariants:

- previously returned record IDs remain stable after append;
- content-only updates do not reorder rows;
- a rejected update preserves the last valid trajectory.

The workbench does not subscribe to live updates or follow a stream tail.
Measure complete-record load, seek, and memory with 10,000 evidence entries
before choosing paging or virtualization. These optimizations are not part of
the completion/import milestone.

## Compatibility

- `eino-workflow-dag` and WorkflowSnapshot v1 remain unchanged.
- Existing `ExecutionDAG` APIs and Path rendering remain supported.
- Trajectory is additive at `eino-viewer/trajectory` and re-exported from the
  package root.
- The workbench defaults to Path and adds Trajectory beside it.
- Existing Run Records require no migration.
- The protocol domain registry remains an advanced integration surface, not a
  primary navigation model.

## Security and data handling

Trajectory never reads files, executes tools, consumes streams, or uploads a
Run Record. It receives the already-redacted JSON-safe record. Presentation
limits apply independently to row summaries and selected details. Truncation
must be visible, and technical evidence must not imply the unredacted value is
available.

## Test matrix

Every visible claim is tested against Recorder-produced fixtures.

### Required Agent cases

1. Multi-turn success with two weather calls, a join, follow-up air quality,
   and final assistant output.
2. The same run with a late air-quality failure after two successful tools.
3. Incomplete prefix containing user input only.
4. Two tool calls requested in one turn retain sibling Step identity.
5. Repeated calls with distinct tool-call IDs remain distinct.
6. Error correlated by exact tool-call ID attaches to the Tool record.
7. Ambiguous error remains a run-level Error record.
8. Final Agent event plus `schema.message` assistant output is deduplicated.
9. Incremental append preserves record IDs.
10. Mixed run IDs and invalid envelopes fail without partial output.

### Browser acceptance

- Path remains the default.
- Trajectory displays Turn boundaries and the expected business records.
- Selecting a row displays concise input/output/error.
- Success and late failure contain no duplicate assistant output.
- Switching samples clears stale selection.
- Raw navigation opens the supporting envelope.
- Keyboard navigation, narrow layout, and automated accessibility checks pass.

### Future gates

- explicit retry attempts;
- cancellation and timeout ownership;
- parallel overlap from trustworthy boundaries;
- model/provider usage and TTFT;
- Graph repeated visits;
- Workflow node lifecycle.

## Delivery phases

Phases 1–3 describe the existing delivery baseline. The 2026-09-22
[Recorder matrix assessment](./RECORDER_MATRIX_RESULTS.md) exposed additional
fidelity defects; baseline interaction tests passing does not close them.
The [static-result roadmap](./STATIC_RESULT_ROADMAP.md) now owns iteration order
and concrete exit gates, superseding the earlier reusable-replay-first priority.

### Phase 1 — independent Agent Trajectory model

- Add `buildExecutionTrajectory` and types.
- Correlate User, Assistant, Tool, and attributable Error records directly from
  evidence.
- Cover the real success, late-failure, and incomplete fixtures.
- Add stable diagnostics and exact evidence traceability.

Exit: both Path and Trajectory can be derived independently from the same real
Agent Run Record, with every visible record linked to source evidence.

### Phase 2 — workbench Trajectory

- Add Path / Trajectory / Raw tabs.
- Render the turn-aware ledger.
- Reuse the concise source inspector.
- Add evidence-index-based cross-view selection.

Exit: a developer can locate the late tool failure in either Path or
Trajectory and reach the same raw evidence.

### Phase 3 — truthful completed records and local import

- Capture observed run start/end and independent capture completeness.
- Validate lifecycle facts consistently in Go and JavaScript.
- Import local files, drag/drop, or pasted JSON with automatic source detection.
- Preserve the last valid view and linked selection after rejected imports.
- Replay final Agent records with tested pause, seek, EOF, and reset behavior.

Exit: a developer opens their own completed record, inspects final steps, and
replays them without a false claim that missing or open evidence is complete.

### Phase 4 — truthful static results and richer source coverage

- First fix false Workflow execution states, cancellation misattribution, and
  unfinished tool states in ended records, using the real Recorder fixtures.
- Then make input, final result, and capture limitations readable together.
- Capture Graph I/O safely before promising to display its missing bodies.
- Extend repeated, nested, and parallel invocation coverage only with reliable
  source identity and evidence; never infer ambiguous associations.

Exit: the strict fixture assessment and targeted three-browser semantic checks
pass; additional source semantics are displayed only when backed by evidence.

### Phase 5 — measured large-record usability

- Measure complete-record loading, seeking, and memory before optimizing.
- Add search, failure jumps, and long-payload folding.
- Add paging or virtualization only when measurements justify them.

Reusable final-result replay and portable viewing follow these fidelity and
readability milestones, as specified in the current static-result roadmap.

Live subscriptions, tail-follow, and realtime replay are outside this roadmap.

## Acceptance decision

The feature is ready for release only when:

- Path stays minimal and unchanged for existing supported runs;
- Trajectory is independently derived from Run Record evidence;
- success, failure, and incomplete records remain truthful;
- no observed span is labeled execution duration;
- every row links to at least one source envelope;
- no source envelope required to understand a visible row becomes inaccessible;
- public types, ESM/CJS exports, package audits, browser tests, and release
  checks pass.

## Reader questions this document must answer

1. Why is Trajectory not added to ExecutionDAG?
2. Which view owns causality, chronology, and complete evidence?
3. What becomes one Trajectory record?
4. How are model turns and tool calls correlated?
5. What happens when error ownership is ambiguous?
6. Which timing values may be presented as duration?
7. How do Path and Trajectory link without depending on each other?
8. What ships first, and what requires additional Recorder evidence?

The answers are explicit above; an implementation that cannot answer them from
its public contracts does not conform to this design.
