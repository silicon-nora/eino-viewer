# eino-viewer direction

> Product framing has moved to
> [`EINO_RUN_VIEWING_PRODUCT.md`](./EINO_RUN_VIEWING_PRODUCT.md). This document
> retains accepted Viewer protocol, graph-semantics, and compatibility details;
> Agent, Graph, and Workflow are now source types for one run-viewing product,
> not the product goal by themselves.

Status: Run-first implementation and release gates complete; publication is
not yet approved, 2026-09-16.

## Decision

`eino-viewer` is a read-only visualization library for one Eino run. It accepts
runs originating from three Eino source types through one consistent interface:

- **Agent** — source records and identity-backed tool-call, transfer, message,
  and result correlations captured during an Agent run.
- **Graph** — the declared `compose.Graph` topology and, when available, the
  node invocations observed during a run. A Graph may contain cycles.
- **Workflow** — the declared `compose.Workflow` data/control mapping and its
  execution. Workflow uses Eino's DAG execution mode.

The library displays source information. It does not invent narrative
explanations, diagnose user code, or claim that every Eino structure is a DAG.

The product description is:

> See one real Eino run, from input through every observed step to output or
> failure.

Runtime collection is a separate Go concern. See
[`EINO_RECORDER_DIRECTION.md`](./EINO_RECORDER_DIRECTION.md) for the Recorder
boundary, source-fidelity rules, and compatibility requirements.

## Why the direction changed

`eino-dag` was too narrow for the intended product. In Eino, `Graph` supports
both Pregel and DAG execution modes. Pregel graphs may contain cycles, while
Workflow uses DAG mode. Calling the whole product a DAG would make either the
name inaccurate or the data model artificially restrictive.

`explain` and `inspect` were also rejected. The default interface should select
and present the most useful fields from the source record, not generate an
interpretation or lead with debugging metadata.

## Conceptual model

```text
Eino source records
  ├─ Agent events, messages, tool calls/results
  ├─ compose.GraphInfo, callbacks, component I/O
  └─ WorkflowSnapshot or compose.Workflow information
             │
             ▼
       deterministic adapters and explicit classification
             │
             ▼
  ViewerDocument { kind: agent | graph | workflow }
             │
             ├─ Definition graph (may be cyclic)
             └─ Execution view (observed invocation instances)
             │
             ▼
          EinoViewer
```

Agent, Graph, and Workflow are supported source types. `schema.*`,
`callback.event`, `component.io`, and tool records are evidence used to build
one run view. They remain supported inputs and technical details, but neither
the source types nor evidence domains define separate product areas in the
default interface.

### Accepted inputs and classification

`projectEinoViewerDocument` accepts one of:

1. one canonical `EinoRunRecord` produced by the Go Recorder;
2. an `EinoWorkflowSnapshot` schema version 1 value;
3. one supported envelope;
4. an ordered array of supported envelopes from one run;
5. an existing `EinoViewerDocument`, which may contain an advanced
   `ExecutionDAG` together with its source envelopes.

Envelope arrays preserve input order. More than one non-empty `runId` is a
`viewer.mixed_run` error unless the caller selects one run explicitly. Automatic
classification uses source kinds, never graph shape or display text:

1. a raw WorkflowSnapshot or `workflow.snapshot` anchor is `workflow`;
2. otherwise, any `agent.event` anchor makes the run `agent`;
3. otherwise, a `compose.graph` anchor makes the document `graph`;
4. callback, component, and schema records without one of those anchors return
   `viewer.missing_anchor` instead of becoming a fourth top-level kind.

A collection containing both a Workflow anchor and Agent events returns
`viewer.ambiguous_kind` unless `options.kind` is explicit. A Graph included in
an Agent run is evidence or a nested definition and does not override the Agent
anchor. An explicit kind must still be supported by a matching anchor; it cannot
relabel arbitrary data.

## Graph and DAG semantics

The implementation must preserve this distinction:

| Value | May contain cycles | Meaning |
| --- | --- | --- |
| Graph definition | Yes | Declared Eino topology |
| Workflow definition | No | Declared DAG-mode orchestration |
| Execution view | No | Time-ordered, invocation-level projection of one run |

A cyclic Graph definition is rendered with its back edges intact. If runtime
records are available, repeated visits are represented as distinct invocation
instances such as `model#1`, `tool#1`, and `model#2`. This execution projection
may be a DAG without changing or replacing the original Graph definition.

`ExecutionDAG` remains a valid advanced model at `eino-viewer/execution-dag`.
For a conversation-anchored Agent run, its default nodes are user-visible
execution events rather than protocol records: user input, actual tool-call
instances, assistant output, and failures. `agent.event`, component I/O, tool
definitions, transfers, and repeated messages remain indexed evidence on those
nodes. Generated edges never point backward in observed order, and parallel
records without an explicit relationship remain parallel.

Invocation IDs are deterministic within a run: an explicit source invocation
identifier wins, otherwise the projector derives an ID from the object role and
zero-based evidence position. Display suffixes such as `model #2` are labels,
not stable external identifiers.

Missing nonessential evidence produces a warning and a partial document.
Missing or conflicting top-level anchors, invalid definitions, mixed runs, and
relationships that cannot be represented without invention are errors. Unknown
JSON-safe records are retained as evidence with a warning; they do not create
nodes automatically.

## Public interface

The canonical package is `eino-viewer` and its primary API is object-centric
rather than protocol-domain-centric:

```js
import { createEinoViewer } from "eino-viewer";

const viewer = createEinoViewer(container, runRecord);
```

The canonical model is:

```ts
type EinoViewerKind = "agent" | "graph" | "workflow";

interface EinoViewerDocumentBase {
  schemaVersion: 1;
  evidence: readonly EinoEnvelope[];
}

interface AgentViewerDocument extends EinoViewerDocumentBase {
  kind: "agent";
  execution: ExecutionDAG;
  definition?: ComposeGraphDefinition;
}

interface GraphViewerDocument extends EinoViewerDocumentBase {
  kind: "graph";
  definition: ComposeGraphDefinition;
  execution?: ExecutionDAG;
}

interface WorkflowViewerDocument extends EinoViewerDocumentBase {
  kind: "workflow";
  definition: EinoWorkflowSnapshot;
  execution?: ExecutionDAG;
}

type EinoViewerDocument =
  | AgentViewerDocument
  | GraphViewerDocument
  | WorkflowViewerDocument;
```

The first release exposes the framework-neutral `projectEinoViewerDocument`
and `createEinoViewer` entries, the mature Workflow renderer, the Graph
definition view including cycles, and the Agent execution view. It also retains
the advanced `/protocol`, `/views`, `/execution-dag`, and `/workflow` subpaths.
React and Vue adapters remain provided by `eino-workflow-dag` for the first
release; new unified framework wrappers are a later additive feature.

Viewer diagnostics use the stable shape `{ severity, code, path, message }`.
Success may contain warnings; failure contains at least one error and no partial
document. Codes and paths are compatibility surfaces after `1.0.0`.
Deserialized ViewerDocuments are validated with the same rigor as raw input;
they are not a trusted bypass. Rendering failures use `EinoViewerError` and
carry the projector diagnostics. A rejected update preserves the last valid
view, while `destroy()` is idempotent and permanently closes that instance.

Every node click has the framework-neutral `{ id, node }` shape. For Run
Records, `node` is the canonical observed `ExecutionDAG` node. Definition-only
compatibility inputs return their source definition node, never a
renderer-private value.

## Default presentation

The reference workbench opens one recorded run by default. It may offer Agent,
Graph, and Workflow recordings as examples, but the embeddable `EinoViewer`
renders the single run passed to it and does not add a source-type or protocol
switch. The workbench does not ask users to choose among protocol domains.

For a selected node, show only the most useful source fields:

- `schema.message`: role and original content;
- tool call: original tool name and arguments;
- tool result: recorded result;
- error: recorded error;
- Graph/Workflow node: declared node name and component.

Status, timing, correlation identifiers, callback bodies, evidence indexes,
and complete JSON remain available through one technical-details disclosure per
selected node or overview. Records are not renamed as inferred business phases,
and repeated values at different source positions remain separately visible.

Message text and structured JSON are rendered with deterministic size limits;
binary and live stream values are represented by source-provided metadata, not
read or consumed. Truncation is visibly marked and the complete JSON-safe source
value remains available in technical details when within the input size limit.

## Compatibility

`eino-workflow-dag` remains published and supported with its existing package
name, `EinoWorkflowSnapshot` schema, renderer, React/Vue adapters, validation,
styles, and subpaths. The new package depends on it in one direction and accepts
its snapshots without changing their payload.

Because `eino-dag@0.1.0` has not been published, the package directory and
canonical imports will be renamed before release. Temporary `EinoDAG*` aliases
may remain where they prevent churn for code already written in this repository,
but new documentation and examples must use `eino-viewer` names.

The compatibility invariant is:

```text
existing eino-workflow-dag consumer -> no source change
existing WorkflowSnapshot v1       -> identical rendered workflow
new Agent/Graph/Workflow input      -> EinoViewerDocument
```

“Identical rendered workflow” means the same validated snapshot, public
renderer behavior, callbacks, theme/layout options, and framework entry points;
it is enforced by the existing unit, browser, type-surface, and packed-consumer
tests, not by pixel identity across browser engines.

“Read-only” means the library never changes or executes the supplied Eino
program. The reference workbench may edit a local JSON copy and re-render it;
this does not write back to a running Agent, Graph, Workflow, or external store.

## Delivery phases

1. **Direction and naming**
   - Add this decision document.
   - Rename the unreleased package and release tooling to `eino-viewer`.
   - Preserve the legacy package and WorkflowSnapshot contract.
2. **Unified viewer model**
   - Add `EinoViewerDocument`, deterministic classification, and projection.
   - Make Agent, Graph, and Workflow the only automatic top-level kinds.
   - Keep raw envelopes as evidence and return stable diagnostics for ambiguity.
3. **Correct Graph support**
   - Preserve cyclic `compose.Graph` topology.
   - Distinguish definition edges from unfolded execution instances.
   - Add successful, cyclic, repeated-iteration, and invalid Graph fixtures.
4. **Unified browser surface**
   - Replace protocol-domain navigation with Agent/Graph/Workflow scenarios.
   - Retain JSON editing and technical evidence without leading with them.
   - Verify node selection, cyclic edges, failures, responsive layout, and
     accessibility in Chromium, Firefox, and WebKit.
5. **Release readiness**
   - Update English and Chinese documentation, changelogs, package metadata,
     type/API surfaces, workflows, and provenance.
   - Pass unit, Go fixture, type, build, packed-consumer, size,
     reproducibility, browser, and accessibility gates.
   - Publish only with explicit maintainer authorization.

## Acceptance criteria

- One viewer accepts runs originating from Agent, Graph, and Workflow.
- The default embedded UI opens one run without requiring a source-type choice.
- A cyclic Graph remains cyclic in its definition view and is not mislabeled as
  a DAG.
- An observed cyclic run can be unfolded into distinct invocation instances.
- Source records remain traceable without appearing as top-level product areas.
- Node details default to source highlights and never manufacture prose.
- Invalid, ambiguous, mixed-run, and missing-evidence inputs return stable
  diagnostics.
- Deserialized ViewerDocuments cannot bypass definition, evidence, or
  ExecutionDAG validation; failed updates retain the last valid rendering.
- Agent, Graph, and Workflow node clicks expose one canonical `{ id, node }`
  contract, and destroyed viewers cannot be updated.
- `eino-workflow-dag` compatibility tests continue to pass unchanged.
- `eino-viewer` passes exact ESM, CommonJS, TypeScript, bundler, packed-size,
  browser, and accessibility checks.
- No package or repository is published or renamed remotely without explicit
  maintainer authorization.

The executable release gate is `npm run prepublishOnly` plus the full Playwright
browser suite in Chromium, Firefox, and WebKit. The legacy tarball remains under
350 KiB and the new viewer tarball under 100 KiB. Reproducibility is checked by
the repository's SHA-256 build comparison. Fixture provenance means the source
Eino version and producer format recorded in each envelope and package
`PROVENANCE.md`.

## Non-goals

- Editing or executing Eino programs in the browser.
- Treating every Graph as a DAG.
- Reconstructing topology or runtime values that were not observed.
- Making schema, callback, or component records primary navigation concepts.
- Removing or silently changing the existing `eino-workflow-dag` package.
