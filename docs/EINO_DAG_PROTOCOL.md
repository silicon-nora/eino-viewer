# Eino DAG protocol reference

The `eino-viewer/protocol` entry and the Go integration provide the technical
evidence format used by `eino-viewer`. They do not change the input
accepted by the existing workflow renderer.

## Envelope

Every document uses protocol version 1 and versions its domain payload
independently:

```json
{
  "protocol": "eino-dag",
  "protocolVersion": 1,
  "kind": "schema.message",
  "kindVersion": 1,
  "payload": { "role": "assistant", "content": "done" },
  "source": { "module": "schema", "format": "Message", "einoVersion": "0.9.19" },
  "correlation": { "runId": "run-42" }
}
```

The envelope is strict: unknown top-level fields, unsupported protocol
versions, invalid JSON values, and invalid source or correlation values are
rejected. `source` and `correlation` are open string records so producers can
add identifiers without revising the envelope. Domain payloads are validated
by their matching validator.

## Version-1 domains

| Kind | Go source | JavaScript validator | Payload policy |
| --- | --- | --- | --- |
| `workflow.snapshot` | Existing `EinoWorkflowSnapshot` | Existing strict snapshot validator through `adaptWorkflowSnapshot` | Lossless; exact payload reference |
| `compose.graph` | `compose.GraphInfo` | `validateComposeGraphEnvelope` | Deterministic topology projection |
| `callback.event` | `callbacks.RunInfo` and address | `validateCallbackEventEnvelope` | Lifecycle metadata; bodies excluded |
| `agent.event` | `adk.AgentEvent` or typed Agentic event | `validateAgentEventEnvelope` | Stable event shape; live streams excluded |
| `schema.message` | `schema.Message` | `validateSchemaMessageEnvelope` | Original public JSON, open to additive fields |
| `schema.agentic_message` | `schema.AgenticMessage` | `validateSchemaAgenticMessageEnvelope` | Original public JSON, open to additive content blocks |
| `schema.tool` | `schema.ToolInfo` | `validateSchemaToolEnvelope` | Original `MarshalJSON` representation |
| `schema.document` | `schema.Document` | `validateSchemaDocumentEnvelope` | Original public JSON and metadata |
| `component.io` | Official or custom component callback body | `validateComponentIOEnvelope` in `eino-viewer/protocol` | Explicit body projection; live streams excluded |

The Schema validators enforce stable discriminators and container types while
allowing unknown payload fields. This is deliberate: Eino may add optional
fields within the supported minor line. The strict legacy WorkflowSnapshot
contract remains unchanged.

`component.io` keeps empty strings and null as actual body values. A
non-streaming body may be absent only with explicit
`metadata.capture = { status: "omitted", reason: "size_limit" | "unsupported_value" }`.
Streaming observations still omit the body and may use `stream_not_consumed`.
An omitted-body marker cannot coexist with a body (even null). Safe Recorder
I/O also records `metadata.io.scope` and `metadata.capture.redacted`.
Graph I/O and callback evidence share `correlation.eventId`; `invocationId`
retains identity across the start and terminal of a repeated visit.

## Execution DAG

`buildExecutionDAG(envelopes)` validates one run and correlates its observed
records into `ExecutionDAG` schema version 1. Node identity represents an
invocation instance, not an Agent or component definition. Each node contains
an ordered `evidence` list of source `envelopeIndex` values. The built-in
correlator uses explicit run IDs, tool-call IDs, callback entity/parent IDs,
Agent names, and observed collection order; it does not infer business
relationships from message text.

Execution edges are typed as `control`, `data`, `tool-call`, `observation`,
`transfer`, or `parent-child`. `buildExecutionDAGs` partitions interleaved runs.
`createExecutionDAGBuilder` accepts records one at a time and preserves stable
node IDs while pending model invocations are completed. Batch and append-only
construction are deterministic.

`executionDAGToWorkflowSnapshot` is a deliberately lossy compatibility adapter
for the existing renderer. It preserves node evidence and edge kinds in
metadata, but maps the richer running state and edge vocabulary into schema-v1
WorkflowSnapshot constraints. The adapter does not make WorkflowSnapshot the
canonical Agent execution model.

## Explanation model

`explainEino(value)` is the universal deterministic explanation entry. It
accepts a supported envelope or envelope collection, an `ExecutionDAG`, or a
legacy `EinoWorkflowSnapshot`. Specialized entry points are available from
`eino-viewer/explanation`:

- `explainEinoEnvelope` explains one validated source record;
- `explainExecutionDAG` explains correlated runtime nodes and accepts the
  source envelope array for exact value and evidence traceability;
- `explainWorkflowSnapshot` explains declared topology and any available
  execution outcomes without inventing runtime values.

Explanation schema version 1 separates `observed`, `declared`, and `inferred`
bases. Each node explanation includes a user-facing headline and summary,
causal rationale, input and output channels, causes and effects, explicit
timing semantics, source evidence claims, technical metadata, and limitations.
An `observed-span` duration is the interval between captured records; it is not
claimed to be precise component execution time.

The explanation layer does not call an LLM and does not infer business intent
from message text. All claims are deterministic consequences of validated
domain fields and correlated identities. Unknown values remain
`not-observed`.

Run explanations additionally expose `run.result`, `run.input`, `run.output`,
`run.issues` and `run.capture`. Result and capture have independent states;
channels preserve exact JSON values and source envelope indexes. Empty, null,
not-observed, redacted and truncated values are distinct. An entirely omitted
body is not a truncated prefix. `options.diagnostics` carries Recorder loss
notices; without an exact envelope index, a notice remains run-level and cannot
mark an arbitrary value as redacted. Root identity is required for final I/O;
intermediate model replies and child outputs do not imply a whole-run result.

## Stream boundary

`ProjectAgentEventEnvelope` and `ProjectAgenticEventEnvelope` never call
`Recv`, `GetMessage`, or `Close` on `MessageStream`. A streaming message output
contains `streaming: true`, its role/source metadata, and no `value`. Projection
returns a `projection.stream_omitted` warning beside the envelope.

Consumers that need content must consume the stream in application-owned code,
apply their own size and redaction policy, and project the resulting complete
Message or AgenticMessage. A live stream is not JSON data and cannot be placed
in an envelope.

When a metadata-only live stream envelope is added to an Execution DAG, its
node remains `running`; the correlator never reads or closes the stream.

## Safety policy

Go projection defaults to a 4 MiB document limit. `ProjectionPolicy.Redact`
can replace values using stable JSON-pointer-like paths rooted at `/payload` or
`/metadata`. Custom outputs, interrupt data, extensions, document metadata,
and tool metadata are accepted only when they are JSON-encodable. Functions,
cycles, invalid numbers, and other unsafe values fail explicitly.

Message content, tool arguments, document bodies, media data URLs/base64, and
custom metadata may contain secrets or large values. Configure redaction and a
deployment-appropriate size limit before exporting untrusted or production
data.

## Compatibility matrix

The Go projectors compile and run their shared fixture suite against Eino
`v0.9.0` and `v0.9.19`. The supported range is `>=0.9.0 <0.10.0`; another Eino
version is not claimed until the same fixtures pass. JavaScript ESM and
CommonJS entries share the same validators and declarations.

The `eino-viewer` package bundles the protocol implementation and exposes the
object-centric viewer from its root. Its `/workflow` entry references
`eino-workflow-dag@^1.3.1`; the dependency is intentionally one-way so existing
renderer consumers remain unchanged.

The shared `eino-component-io-v1.json` catalog contains deterministic input and
output projections for ChatModel, AgenticModel, ChatTemplate,
AgenticChatTemplate, Embedding, Indexer, Retriever, Loader,
DocumentTransformer, and Tool, plus a metadata-only stream boundary. The
browser workbench renders every entry through `component.io-trace-v1`.

Adding a kind is additive. Incompatible payload semantics require a new
`kindVersion`; incompatible envelope semantics require a new
`protocolVersion`. Existing WorkflowSnapshot schema version 1 remains governed
by [CONTRACT.md](./CONTRACT.md).
