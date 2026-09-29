# Eino DAG execution architecture

> Historical execution-model document. The accepted product direction is now
> [EINO_VIEWER_DIRECTION.md](./EINO_VIEWER_DIRECTION.md). `ExecutionDAG` remains
> an advanced run projection inside `eino-viewer`, not the product's top-level
> identity.

Status: Release candidate implemented, 2026-09-15.

## Goal

Turn a real Eino run into a truthful, instance-level execution DAG. `eino-dag`
collects Agent events, component callbacks and I/O, tool calls and results,
transfers, messages, streams, errors, and optional workflow topology; correlates
their shared identities; and exposes a DAG that can be rendered incrementally
or reconstructed offline. It does this without breaking existing
`eino-workflow-dag` consumers.

```text
real Eino run
  -> versioned multi-domain envelopes
  -> causal correlator
  -> ExecutionDAG (observed invocation instances)
  -> deterministic Explanation Model (what / why / input / output / evidence)
  -> native views or WorkflowSnapshot compatibility adapter
  -> renderer
```

A Workflow is one possible source of topology and one compatibility rendering
target. It is not the core execution model. Dynamic Agent loops are unfolded as
source-record and identity-backed tool invocation instances; the library does
not rename those records as inferred business phases or convert an Agent
definition into a fictional static Workflow.

"All Eino information" means all stable, observable Eino domains plus an
extension mechanism for component-defined data. It does not mean serializing
arbitrary Go runtime values. Functions, streams, `reflect.Type`, component
instances, errors, and application objects require an explicit, safe projection
at the producer boundary.

## Compatibility decision

`EinoWorkflowSnapshot` schema version 1 remains unchanged and remains the only
input accepted by the existing workflow renderer. Existing root,
`/validation`, `/react`, `/vue`, `/cytoscape`, and `/styles.css` behavior stays
under the published 1.x compatibility contract.

The new `/protocol` entry is additive and independent. It wraps an existing
snapshot without copying or normalizing the payload:

```js
import { adaptWorkflowSnapshot } from "eino-viewer/protocol";

const result = adaptWorkflowSnapshot(snapshot, {
  correlation: { runId: "run-123", traceId: "trace-456" },
});

if (result.ok) {
  // The legacy payload remains available without transformation.
  render(result.envelope.payload);
}
```

The compatibility invariant is:

```text
legacy WorkflowSnapshot v1 -> workflow.snapshot envelope -> identical payload
```

The independent `eino-dag` package re-exports this protocol and the workflow
view. The existing package does not need to be renamed or deprecated.

## Protocol layers

The cross-domain protocol uses a small stable envelope around independently
versioned payloads:

```text
Eino value
  -> versioned Go/JavaScript adapter
  -> EinoDAGEnvelope
       protocolVersion: envelope compatibility
       kind + kindVersion: domain compatibility
       source: producer and Eino version
       correlation: run, trace, span, session, or entity identifiers
       payload: domain-owned JSON-safe value
       diagnostics: returned beside the envelope
  -> domain validator
  -> causal correlation by run, entity, tool-call, parent, and observed order
  -> ExecutionDAG
  -> workflow compatibility view, trace, conversation, or inspector view
```

The envelope validator verifies transport safety and common semantics only. A
domain adapter owns payload validation. Source and correlation records permit
additional string keys so new Eino identifiers do not require an envelope
revision. New top-level semantics require a protocol revision or belong in
`metadata`.

Adapters are explicit, versioned, and deterministic. Automatic detection
rejects ambiguous input instead of selecting an adapter silently. Every failed
or lossy conversion returns machine-readable diagnostics. The first built-in
adapter, `workflow-snapshot-v1`, is lossless.

## Supported domains

| Order | Envelope kind family | Eino source | First view |
| --- | --- | --- | --- |
| 1 | `workflow.snapshot` | Existing library projection of `compose.GraphInfo` | Workflow DAG |
| 2 | `compose.graph` | `compose.GraphInfo`, nested graphs, branches, field mappings | Topology DAG |
| 3 | `callback.event` | `callbacks.RunInfo` and component callback projections | Trace tree and timeline |
| 4 | `agent.event` | ADK typed events, run paths, outputs, actions, transfer, interrupt/resume | Execution DAG evidence |
| 5 | `schema.message`, `schema.agentic_message`, `schema.tool` | Message and AgenticMessage projections, tool calls/results, media | Conversation flow |
| 6 | `schema.document` | Loader, indexer, retriever, embedding, and reranker projections | Data-flow inspector |

Component callback bodies are open-ended by design. Built-in projectors will
cover official component types; applications register codecs for custom
payloads. Unknown but JSON-safe payloads remain inspectable and are never
silently reinterpreted as a known domain.

## Delivery plan

1. **Complete:** ship the isolated envelope, diagnostics, adapter registry, and
   lossless WorkflowSnapshot adapter while keeping every legacy entry unchanged.
2. **Complete:** add Go producer primitives for redaction, size limits, stable
   correlation IDs, Eino version metadata, and `compose.GraphInfo` envelopes.
3. **Complete:** add callback event adapters and correlate runtime events to
   workflow nodes through stable addresses and node paths.
4. **Complete:** add non-consuming ADK event projection plus Message,
   AgenticMessage, ToolInfo, and Document domains behind independent kind
   versions. Component callback-body adapters continue in the view milestone.
5. **Complete:** establish the independent, release-ready `eino-dag` package and
   deterministic view registration. WorkflowSnapshot remains lossless;
   compose.graph projects into the existing renderer contract.
6. **Complete:** add trace, agent, conversation, data-flow, component I/O, and
   opt-in generic inspector views plus all official component callback-body
   adapters. Ordered collections retain input order and index explicit run IDs.
7. **Complete:** deliver one bilingual standard browser workbench for every
   built-in domain, the custom-envelope fallback, and all official component
   input/output plus stream-boundary fixtures. Preserve the legacy workflow UI
   selectors and public test hook.
8. **Complete:** add the first-class `ExecutionDAG` model, batch correlator,
   append-only live builder, run partitioner, tool-call and transfer edges,
   callback pairing, failure states, and the lossy legacy renderer adapter.
9. **Complete:** make the real weather Agent scenario build its visual DAG in
   the browser from the ten raw Runner envelopes; keep protocol evidence visible
   and test repeated ReAct iterations, transfers, callbacks, and failures.
10. **Complete:** add the versioned Explanation Model and one universal
    `explainEino` entry. Explain every supported domain, distinguish observed
    facts from declared topology and inference, expose inputs, outputs, causal
    rationale, limitations, timing semantics, and exact evidence indexes, and
    render the same model in the bilingual workbench.
11. Publish `eino-dag` only after final registry revalidation and maintainer
   authorization. Keep `eino-workflow-dag` as the one-way compatibility base.

## Acceptance gates

- Existing API and type surface tests remain unchanged except for the new
  independent `/protocol` entry.
- All pre-existing WorkflowSnapshot fixtures retain their strict validation and
  renderer behavior.
- Adapting a valid WorkflowSnapshot preserves the exact payload reference.
- Envelope and adapter errors are diagnostic results; programming errors during
  registration fail immediately.
- Adapter auto-detection rejects zero or multiple matches.
- No lossy conversion can succeed without a warning diagnostic.
- ESM and CommonJS consumers expose equivalent protocol APIs.
- Packed-package, size, reproducibility, browser, and framework gates continue
  to pass.
- One browser interface must cover all built-in kinds and every official
  component I/O fixture, with JSON editing, diagnostics, deterministic view
  selection, responsive layouts, keyboard access, and automated Chromium,
  Firefox, and WebKit checks.
- The independent package must pass exact ESM, CommonJS, TypeScript, and bundler
  consumer tests while remaining below its enforced packed-size budget.
- Every `ExecutionDAG` node retains the indexes of the source envelopes that
  justify it; tool contracts and component I/O are evidence, not duplicate
  execution nodes.
- Repeated tool calls have distinct invocation nodes. Agent transfers remain
  source evidence unless they create a user-visible action, and failed runs do
  not invent a final output.
- Batch and append-only construction produce the same deterministic snapshot.
- Every explanation is deterministic and machine-readable; no model call is
  required to produce it.
- Explanation claims distinguish `observed`, `declared`, and `inferred` bases,
  and missing runtime values appear as limitations instead of invented data.
- Every supported Eino domain and legacy Workflow snapshot can enter through
  `explainEino`; invalid inputs return diagnostics rather than partial claims.
- Browser node details default to the most relevant fields extracted from source
  evidence. `schema.message` uses role/content; tool calls and results use their
  recorded values. Derived explanation prose, causal neighbors, unknowns, and
  protocol metadata remain available through one explicit technical drill-down.

## Non-goals for the first milestone

- Changing workflow renderer defaults or schema-v1 validation.
- Inventing execution steps that were not observed.
- Serializing live Go streams, functions, component instances, or secrets.
- Claiming compatibility with an Eino version before its adapter fixtures pass.
- Renaming the npm package or Go module during the compatibility foundation.
