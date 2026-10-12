# Changelog

## Unreleased

### Native RunRecord v2 capture and reading — 2026-10-12

- Read v2 directly in the embedded, workbench and portable viewers, retaining
  definitions, individual calls, root results, requests, content availability,
  usage and business annotations. Keep v1 reading and transactional replacement.
- Add explicit Go v2 Agent/Graph/Workflow constructors and an application
  recorder for custom model/operation boundaries. Capture identities during
  execution; never reconstruct them from v1 envelopes. Preserve unknown facts
  and report unsupported legacy manual entry paths explicitly.
- Ship the `eino-viewer/protocol-v2` validator and types, with schema validation
  compiled ahead of time for browsers and offline use without runtime eval.
  Validate freshly executed Eino recordings through the same consumer contract.
- Tighten partial token-total bounds and verify orchestration failure outcomes,
  concurrent same-name calls, redaction, missing bodies and stream ownership.
  Business host integration and publication remain separate work.

### Owner-accepted reading UI — 2026-09-30

These presentation notes supersede the earlier workbench UI notes below.
This is a local Git acceptance baseline, not a package release.

- Keep the example-first homepage and shared, unpaged Agent trajectory reader.
  Select full rows, show complete input before output, and reserve state labels
  for exceptions without changing recorded statuses or source identities.
- Simplify the Graph workbench to steps, flow and details. Combine repeated
  visits visually while retaining each execution's original values; derive
  structure and cycle layout from definitions independently of outcomes.
  Make connections selectable, bound canvas panning, remove duplicate results
  and keep zoom/fit controls in the fixed flow heading.
- Simplify the Workflow workbench to flow and details, without a step sidebar
  or search. Open on the whole-run result, select nodes directly, preserve
  subflow navigation and keyboard focus, and default to left-to-right using
  the existing four-direction renderer.
- Keep embedded/offline Graph and Workflow interfaces unchanged. Preserve
  public APIs, original records, Recorder behavior and drawing safeguards;
  no streaming, live execution, publishing or upstream repository changes.

### Earlier implementation changes

- Synchronize call breadcrumbs, local path diagrams and source-backed call
  input/return/errors across the workbench, embedded and offline viewers.
  Preserve the overall final result, original IDs and edges, uncertain returns,
  declared subtrees and cycle-capable Graph definitions. Add two real three-level
  Agent Recorder scenarios and scoped error-recovery mutation checks; no new
  public API, runtime dependency, streaming, live subscription or publishing.
- Make completed results the primary reading surface across the workbench,
  embedded inspector and offline HTML. Fold details and import controls without
  losing scope, selection or unapplied Raw drafts; expose path zoom controls.
- Use complete, source-backed default Agent, Graph and Workflow recordings.
  Unconfirmed Agent events retain neutral visual states and truthful keyboard
  descriptions, without changing canonical statuses or evidence. Preserve
  definition-only snapshots that have no execution node list.
- Add evidence-backed call groups and scoped step/evidence navigation across the
  workbench, embedded inspector and offline viewer. Preserve Graph visits,
  Workflow nesting and declaration-only semantics without adding fake steps.
- Isolate nested Agent tool IDs by complete source address. Keep ambiguous
  name-only events unassigned, including partial records missing a sibling's
  entire callback address. Do not infer cross-scope failures from error text.
- Capture nested component failures safely and stop deriving root assistant
  messages from child answers. Add four real Agent-as-tool fixtures, independent
  source comparisons and damaged-projection regression gates.
- Add `createEinoRunViewer` as a complete embedded static result inspector and a
  standalone offline HTML build. Both reuse canonical summaries and evidence;
  no streaming capture, live playback, execution or cloud upload is supported.
- Add source-backed run/step timing, preserving unknown and invalid boundaries
  instead of inventing zero durations or summing parallel steps.
- Add a shared metadata inspection index, paged step/evidence search, issue
  navigation and explicit unassigned evidence. Large workbench paths are drawn
  on demand; synthetic 100/1,000/10,000-record benchmarks are separate from
  real Recorder acceptance scenarios.

- Add source-backed `explanation.run` summaries and a persistent workbench
  result section for Agent, Graph and Workflow. Keep execution, capture, empty
  values, missing bodies, redaction and preview folding distinct.
- Capture Graph root/node I/O and Workflow root I/O with pre-serialization
  redaction, finite limits, explicit omission reasons and per-invocation identity.
  Add ten more real Recorder fixtures and cross-layer value/evidence checks.
- Correct completed-record step semantics: retain source Workflow outcomes,
  omit unexecuted successors, separate tool plans from execution, and preserve
  precisely correlated interruptions and run-level cancellation in both views.
  Add `incomplete` and `cancelled` ExecutionDAG node statuses; never map them to
  fake success/skipped outcomes in the compatibility renderer.
- Render Workflow runs from observed steps with canonical click data; preserve
  original definitions in evidence and fix flattened Workflow snapshot validity.
- Add the original ten real Recorder scenarios, strict static-fidelity checks,
  and cross-view browser regressions. Legacy Graph records without node I/O
  remain readable with an explicit limitation.
- Record explicit run lifecycle boundaries separately from capture completeness;
  derive whole-run outcome from those facts instead of local step failures or
  intermediate assistant messages. Preserve legacy records with an explicit
  unknown-completion warning.
- Import local Run Records by file, drop, or pasted JSON with automatic source
  detection and atomic rejection that preserves the last valid view.
- Locate complete raw envelopes structurally, including compact JSON and
  duplicate timestamps, and preserve unapplied drafts during evidence navigation.
- Gate final-result replay on recorded termination and cover timer advance,
  pause/resume, EOF, run switching, and restoration of the final overview.

## [0.1.0] - 2026-09-15

- Establish Agent, Graph, and Workflow as the only top-level viewer kinds and
  add `projectEinoViewerDocument` plus `createEinoViewer`.
- Preserve cyclic Pregel Graph definitions while keeping invocation-level
  `ExecutionDAG` as an advanced, acyclic run projection.
- Add the unified bilingual workbench with a real deterministic Eino weather
  Agent run, a cyclic Graph, a compatible Workflow, and failure recovery.
- Introduce the versioned Eino DAG envelope, domain validators, diagnostics,
  and adapter registry.
- Add workflow.snapshot, compose.graph, callback.event, agent.event,
  schema.message, schema.agentic_message, schema.tool, and schema.document
  version-1 support.
- Add deterministic workflow view projection with explicit ambiguity handling.
- Add callback trace, agent execution, conversation, tool inspector, document
  data-flow, component I/O, and opt-in generic inspector views.
- Add ordered multi-envelope projection with explicit run correlation and
  per-envelope diagnostics.
- Validate `component.io` fixtures produced from all official Eino component
  callback families without consuming live streams.
- Re-export the compatible `eino-workflow-dag` renderer from `/workflow`.
- Add `ExecutionDAG` schema v1 with batch, multi-run, and append-only live
  construction from real Agent, callback, component, tool, message, graph, and
  custom envelopes.
- Preserve causal tool-call, observation, transfer, data, control, and
  parent-child edges while keeping source-envelope evidence on every node.
- Add `/execution-dag` plus a lossy `executionDAGToWorkflowSnapshot` adapter so
  existing `eino-workflow-dag` rendering remains compatible.
- Add `/explanation` with deterministic Agent, Workflow, component, message,
  tool, callback, document, graph, custom-envelope, failure, and streaming
  explanations. Inputs, outputs, causal rationale, limitations, timing
  semantics, and claims retain source-envelope evidence indexes.
- Present source-record highlights in the standard workbench, with direct
  `schema.message` role/content and recorded tool values in the default layer;
  keep the complete technical explanation model available on demand.
- Fully validate deserialized ViewerDocument definitions, evidence, and
  ExecutionDAG references; add stable `EinoViewerError` failures and a final,
  idempotent viewer lifecycle that preserves the last valid view on rejection.
- Normalize Agent, Graph, and Workflow node-click callbacks to the same
  `{ id, node }` shape backed by each ViewerDocument's canonical node data.
- Replace inferred Agent-stage labels such as decision, summary, and final
  answer with source-backed kind, name, and role labels; preserve repeated
  records instead of deduplicating matching message content.
- Rename the explanation statistic `agentDecisionCount` to
  `agentToolCallNodeCount` so the public API no longer claims an inferred Agent
  decision phase.
- Project conversation-anchored Agent runs into user-visible nodes only: user
  input, actual tool invocations, assistant output, and failures. Keep
  `agent.event`, component I/O, tool definitions, and repeated records as
  attached evidence instead of canvas nodes.
- Add `/trajectory` and `buildExecutionTrajectory()` as an independent,
  turn-aware projection of the original Run Record. Fold model/component/Agent
  evidence into User, Assistant, Tool, and Error records with stable IDs,
  explicit observed-time semantics, and attributable late failures.
- Add `createExecutionTrajectoryBuilder()` for append-only live evidence with
  stable prefix IDs, owned inputs, atomic rejection, and last-valid snapshots.
- Add Path/Trajectory switching to the standard Agent workbench while keeping
  Path as the default. Record selection exposes only recorded input, output,
  error, and links back to the raw evidence.
- Add opt-in completed-run replay for terminal Agent trajectories with
  play/pause, step, scrub, final-result restoration, and synchronized evidence
  inspection. Incomplete runs intentionally expose no playback controls.
