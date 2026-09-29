# Eino run viewing product

Status: Product baseline, 2026-09-16.

This document defines why Eino Recorder and Eino Viewer exist. It supersedes
the product framing in `EINO_VIEWER_DIRECTION.md` and
`EINO_RECORDER_DIRECTION.md`; their protocol, compatibility, and implementation
decisions remain valid only when they support this goal.

The additive Path / Trajectory / Raw projection design is defined in
[`EINO_TRAJECTORY_DESIGN.md`](./EINO_TRAJECTORY_DESIGN.md).

The current iteration order and acceptance gates are maintained in the
[static-result roadmap](./STATIC_RESULT_ROADMAP.md), updated 2026-09-22 after
the [real Recorder matrix assessment](./RECORDER_MATRIX_RESULTS.md).
Its four known display-fidelity defects have since been repaired; see the
[P0 acceptance report](./STATIC_RESULT_P0_ACCEPTANCE.md). Graph I/O was added in
[iteration 2](./STATIC_RESULT_ITERATION_2.md). This document states the product
contract, not a claim of exhaustive coverage.
The user-confirmed scope is completed non-streaming results. Streaming capture
and realtime playback are unsupported, not a planned next milestone. Publication
work is deferred; see [iteration 3](./STATIC_RESULT_ITERATION_3.md).

## Product goal

> Let an Eino developer see one real Eino run with the lowest possible setup
> and comprehension cost.

The product turns one execution into one portable visual record. A user should
not need to understand Eino callbacks, protocol domains, correlation IDs, or
the recorder implementation before they can answer:

1. What input entered this run?
2. What actually ran?
3. What did each step receive and produce?
4. Where did the run fail, if it failed?

The product does not explain why an Agent reasoned a certain way. It shows the
most useful facts Eino actually emitted.

## Primary user and moment

The primary user is an Eino application developer who has just run an Agent,
Graph, or Workflow while developing, integrating, reviewing, or reproducing a
problem.

Their job is not “inspect every Eino data type.” Their job is:

> I ran this Eino program. Show me what happened without making me assemble a
> trace, read callback logs, or build a visualization.

Production monitoring, aggregate analytics, alerting, and historical run
management may consume the same record later, but they do not define the first
release.

## Product unit: one run

The canonical product object is an **Eino Run Record**.

One record is self-contained and JSON-safe. It contains the lossless facts from
which Viewer derives the run path:

- run identity and source type;
- the original source evidence carrying input, executed callbacks, component
  I/O, errors, and final output when Eino emitted them;
- an optional declared Graph or Workflow definition carried as source evidence;
- capture diagnostics, redaction markers, and truncation markers.

The record does not duplicate a second, pre-interpreted step model. Viewer
derives status, meaningful steps, and their input/output from the evidence so
the transport remains small and cannot contradict its source facts.

Agent, Graph, and Workflow describe where a run came from. They are supported
source types, not three separate product experiences. `schema.*`,
`component.io`, `callback.event`, and `agent.event` are evidence inside a run,
not user-facing product areas.

A definition without execution remains supported for compatibility and design
review, but it is a secondary structure view rather than the product's default
state.

## Product contract

```text
unchanged Eino execution
        │
        ▼
Eino Recorder
        │  one self-contained Eino Run Record
        ▼
saved file / JSON
        │
        ▼
Eino Viewer
        │
        ├─ run overview
        ├─ actual execution path
        ├─ selected step input/output
        └─ original evidence on demand
```

### Recorder promise

Recorder makes capture cheap and trustworthy.

- It attaches to a real Eino run without changing application behavior.
- It produces one ready-to-view record; callers do not assemble envelopes.
- It captures only observed facts and never invents missing steps or outputs.
- It applies redaction and size policy before data leaves the Go process.
- It records partial and failed runs as useful records.
- Agent, Graph, and Workflow integrations converge on the same output model.

Recorder internals may continue to use versioned evidence envelopes. Those
envelopes are an implementation and extension boundary, not the primary result
developers must compose themselves.

### Viewer promise

Viewer makes understanding cheap.

- Opening one Run Record renders immediately without asking for its type.
- The first screen shows the run input, status, actual path, and final output or
  failure.
- The canvas shows observed execution steps by default, not protocol records.
- Selecting a step shows its most useful original input and output side by side.
- Declared Graph or Workflow structure is available as context, not confused
  with what actually ran.
- Raw evidence, timing, addresses, and correlation metadata remain one explicit
  level deeper.
- Viewer never generates business labels, reasoning narratives, or causal
  claims that the record does not contain.

## Minimum-cost experience

### Capture

The target integration requires no manual event projection, fixture assembly,
or knowledge of protocol kinds. Adding recording to an existing run should be
mechanical and local to the run invocation.

The release target is:

- at most one Recorder construction;
- at most one compile/run attachment appropriate to the Eino source;
- one call to obtain or write the Run Record;
- no application-owned correlation logic.

The exact Go API may differ across Agent, Graph, and Workflow where Eino's own
execution APIs differ, but all three must return the same product object.

### View

The target viewing flow is:

1. give Viewer one Run Record;
2. see the actual run;
3. select a step;
4. see the recorded input and output.

The user must not choose an adapter, protocol domain, view registry entry, or
object kind in the default flow.

### Share

One Run Record can be saved as JSON, passed to an embedded Viewer, or opened in
the reference workbench. The first release is local-first: viewing does not
upload the record or require a service.

## Default information architecture

### Run overview

Show only:

- input;
- success, failure, or incomplete state;
- elapsed time when observed;
- final output or failure;
- number of executed steps.

### Execution canvas

Show one node per meaningful observed step. Preserve repeated invocations as
separate instances. Show the actual path; do not add nodes merely because they
exist in a definition.

The source type may influence visual vocabulary, but not navigation:

- Agent runs may show messages, tool calls, transfers, and failures;
- Graph runs may show repeated visits caused by cycles;
- Workflow runs may use the compiled definition to name observed nodes.

### Step detail

The default detail contains:

- source-provided step name;
- observed input;
- observed output or error.

Status and duration may appear when they help locate a failure or bottleneck.
Full JSON, callback boundaries, evidence indexes, addresses, and correlation
fields belong under technical details.

### Structural context

When a Graph or Workflow definition is present, Viewer may use it to name and
connect observed steps. The standard run view does not add a structure toggle:
the declared definition is available under technical evidence, while a bare
definition remains supported by the compatibility API for design review.
Cycles, branches, skipped possibilities, and nested definitions never replace
or alter the observed run.

## Product boundaries

The first release is not:

- an Eino editor or execution environment;
- an APM, logging backend, or hosted trace store;
- a protocol-domain explorer;
- an AI explanation or diagnosis system;
- a reconstruction engine for data Eino did not emit;
- a promise to serialize arbitrary Go runtime values or live streams;
- three unrelated viewers for Agent, Graph, and Workflow.

Advanced protocol and domain tools may remain exported for integrators and
tests. They must not determine the default product experience.

## Product acceptance criteria

### Ten-second comprehension

Given a successful weather run, a developer unfamiliar with the record format
can identify the original question, actual executed path, weather result, and
final answer from the first screen and one node selection.

Given a failed weather run, the same developer can identify the failing step,
its observed input, and its original error without reading raw JSON.

### End-to-end truth

- A real Eino execution produces one Run Record directly from Recorder.
- The reference Viewer opens that exact record without combining fixtures in
  browser code.
- Every visible input, output, label, status, and error is traceable to the
  record or its declared definition.
- Missing values are visibly absent; they are never replaced with guesses.

### Low setup cost

- The documented Agent, Graph, and Workflow quick starts each fit in one short
  example and return the same Run Record type.
- No quick start asks users to construct envelopes, execution DAGs, or viewer
  documents.
- Recorder can write a portable record without a browser or hosted service.

### Compatibility and safety

- Existing `eino-workflow-dag` consumers and WorkflowSnapshot v1 rendering
  remain unchanged.
- Existing evidence envelopes remain accepted through adapters.
- Redaction, document-size limits, stream ownership, defensive copies, stable
  diagnostics, and rejected-update preservation remain enforced.

### Release evidence

- One production-shaped Agent run, cyclic Graph run, and Workflow run produce
  Run Records consumed unchanged by JavaScript tests.
- The Agent gate includes multiple model turns, multiple tool calls, a fan-out
  and join, Eino's parallel tool dispatch, and a failure after earlier success.
- A separate credential-gated live test distinguishes real external model
  execution from the deterministic model used for repeatable fixtures.
- At least one failed and one incomplete run prove that no output is invented.
- Browser tests cover overview, step selection, input/output, failure, repeated
  cyclic visits, accessibility, and narrow layouts.
- The public workbench defaults to opening a run, not browsing protocol kinds.

## Implementation sequence

1. **Run Record contract**
   - Define the smallest stable product model around one run.
   - Keep evidence envelopes internally and add compatibility adapters.
   - Decide how partial, failed, repeated, nested, and cyclic execution appears.
2. **Recorder convergence**
   - Make Agent, Graph, and Workflow Recorders return the same Run Record.
   - Add file/JSON output and redaction examples.
   - Remove fixture assembly from the normal consumer path.
3. **Run-first Viewer**
   - Render overview, actual path, and step input/output from one record.
   - Move source type, definition, and raw evidence to secondary views.
   - Keep legacy WorkflowSnapshot rendering behind its compatible entry.
4. **Real end-to-end examples**
   - Generate success and failure records from executable Go scenarios.
   - Serve those exact artifacts in the workbench without browser-side joining.
   - Test the ten-second comprehension tasks in all supported browsers.
5. **Release review**
   - Remove APIs and UI that do not serve the product goal from the default
     surface.
   - Run compatibility, package, Go, browser, accessibility, and reader tests.
   - Publish only with explicit maintainer authorization.

## Decision rule

For every proposed feature, ask:

> Does this reduce the cost of capturing or understanding one real Eino run?

If the answer is no, it is not part of the default product, even when the
underlying Eino information is technically supportable.
