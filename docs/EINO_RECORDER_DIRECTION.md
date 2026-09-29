# Eino Recorder direction

> Product framing has moved to
> [`EINO_RUN_VIEWING_PRODUCT.md`](./EINO_RUN_VIEWING_PRODUCT.md). This document
> retains capture constraints and compatibility details. The Recorder's primary
> product output is now one ready-to-view Eino Run Record rather than a set of
> source-specific artifacts callers must assemble.

Status: Canonical Eino Run Record implementation and release gates complete;
publication is not yet approved, 2026-09-16.

## Decision

`eino-viewer` has two deliberately separate halves:

```text
Eino runtime -> Recorder (Go) -> stable JSON -> Viewer (JavaScript)
```

The Recorder captures source facts from Eino. The Viewer selects and presents
those facts. Neither layer invents Agent decisions, summaries, skipped nodes,
assistant output, or causal relationships that were not observed.

The Go module now lives with the viewer at
`github.com/silicon-nora/eino-viewer/integrations/go`. It retains the existing
Workflow APIs while adding Agent and Graph Recorder APIs.

## Recorder surface

### Workflow

`WorkflowRecorder` combines the existing, production-used mechanisms:

- a compile callback captures `compose.GraphInfo` and projects the Workflow
  definition;
- invocation callbacks capture final node outcomes and timing;
- explicit `MarkSkipped` calls remain the only way to record a skip that Eino's
  generic callbacks do not expose.

Its default product result is the same `RunRecord` returned by the Agent and
Graph Recorders, carrying the schema-version-1 `WorkflowSnapshot` plus observed
component I/O as source evidence. The established `Snapshot`, `Project*`, and
`ExecutionRecorder` APIs remain compatible and are not replaced.

### Agent

`AgentRecorder` wraps the default Eino ADK `Runner` without changing its pull
iterator contract. It records:

- the last user input supplied to the run;
- observed ChatModel, AgenticModel, and Tool callback input/output records;
- every `AgentEvent` returned to the application;
- a final `schema.message` only when a non-streaming assistant message was
  actually observed.

Tool definitions are optional. Actual tool invocations can be reconstructed
from Agent events and component I/O alone. Concurrent callback and iterator
delivery is normalized into deterministic causal order without changing source
payloads or timestamps.

### Graph

`GraphRecorder` captures the compiled `compose.Graph` definition and callback
events for an invocation. The definition remains a Graph and retains back
edges; it is never coerced into a Workflow or declared acyclic. Repeated visits
may later be presented as invocation instances while the original cyclic
definition remains available as evidence.

## Operating constraints

- A Recorder instance belongs to one run and installs callbacks only through
  that run's compile/invoke options. There are no global hooks.
- Returned documents are defensive copies and JSON-safe.
- Stream readers remain application-owned. Recorder callbacks only observe the
  private copies supplied by Eino.
- Projection failures are Recorder errors. Runtime Agent failures remain
  observed Agent evidence and are not relabeled as Recorder failures.
- Redaction and document-size policy are applied before records leave Go.
- `runId`, source timestamps, Eino addresses, component identities, and tool
  call IDs are retained for correlation.

## Compatibility

The cloud-focus integration is the compatibility reference. Its existing
compile callback plus `ProjectWithOptions`, `ExecutionRecorder`, and
`compose.WithCallbacks` path must continue to compile and behave unchanged.
Adopting `WorkflowRecorder` is optional and mechanical; Agent and Graph support
does not add a migration requirement to Workflow consumers. The release audit
compiles and tests those cloud-focus packages against the local Go module
through a temporary Go workspace; it does not modify the consumer repository.

## Release gates

A releasable Recorder change must pass all of the following:

1. real compiled and invoked Eino Workflow tests, including success, failure,
   explicit skip, nested address, and invalid projection cases;
2. a production-shaped deterministic ADK Agent run with three model turns,
   multi-call weather lookup, follow-up tool use, parallel dispatch, and a late
   tool failure without fabricated final output;
3. repeated Agent runs under the race detector to expose callback/iterator
   ordering bugs;
4. a real cyclic Pregel Graph run that preserves the definition's back edge;
5. exact Go-generated fixtures consumed by the JavaScript Viewer tests;
6. the existing cloud-focus packages compiling against the local Go module;
7. the complete package, type, browser, documentation, and release checks.

The deterministic gate proves the Eino runtime and Recorder contract without
network variance. An isolated, credential-gated live module runs the same
multi-tool contract through Eino's OpenAI-compatible ChatModel. The live gate
is required for provider certification, not for repeatable pull-request CI;
skipping it must never be described as proof of a real external LLM call.

Publication remains a separate maintainer action after these gates pass.
