# eino-viewer

A read-only visual viewer for one real Eino run.

`eino-viewer` shows the input, Agent trajectory or Graph/Workflow path, step input/output, and
final output or failure without executing the program or inventing missing
relationships. Agent, Graph, and Workflow are supported run sources, detected
from the record.

Protocol development: the [RunRecord v2 contract package](./protocol/v2/README.md) contains the next schema, generated types, validator and synthetic business fixtures. It is not yet supported by the current Viewer or Recorder.

The product reads saved **non-streaming** results only. It does not execute
runs, consume streams, subscribe to live events, or upload records. Older,
incomplete and definition-only records remain readable without invented results.

## Choose an entry

- **Try it without a record:** open the [repository workbench](#repository-workbench) and choose an Agent, Graph or Workflow example.
- **Already have a saved record:** [open it locally](#open-a-saved-record); no application integration is needed.
- **Embed the complete reading experience:** use [`createEinoRunViewer`](#embed-the-complete-reader).
- **Only need a canvas and will build your own details:** use the existing [`createEinoViewer`](#low-level-canvas-and-compatibility).
- **Need to produce a record:** attach the [Go Recorder](https://github.com/silicon-nora/eino-viewer/blob/main/integrations/go/README.md#recorder-overview) to your existing Agent, Graph or Workflow, then [save the completed run](https://github.com/silicon-nora/eino-viewer/blob/main/integrations/go/README.md#save-and-open-a-run-record). No manual envelope assembly is needed.

## Open a saved record

### Offline HTML

If you already have `eino-viewer.html`, open it directly in a browser, then
choose, drop or paste your Run Record JSON. The viewer detects its source and
shows the Agent trajectory or Graph/Workflow result and path. Select a step to
read its input/output; Graph/Workflow also provide source links to the original evidence.

To prepare the offline package from a checkout with dependencies installed, run:

```sh
npm run build:portable
```

Give the recipient `.artifacts/portable/eino-viewer.html` together with
`LICENSES.txt` from the same directory. The recipient needs no checkout,
Node.js, Python, server, account or network connection. Export preserves the
accepted JSON text. The viewer does not automatically redact it: check private
content before sharing a record.

### Repository workbench

From the repository root with dependencies installed (Node.js 20 or newer):

```sh
npm run build:site
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/.artifacts/pages/?lang=en` and choose one of the
Agent, Graph or Workflow example cards to explore a real recorded run. No record
opens before your choice. Once a record is open, **Change record** is a single
dropdown containing examples of its current type, with the current record selected.
Return to the homepage to choose another type; the current language is retained.

**Connect your Eino application** links to the Go Recorder integration. It
produces the saved record; users do not need to author a JSON schema. The workbench
does not open or accept dropped files. Use the [offline HTML](#offline-html) for
existing saved records, or pass them to the [embedded reader](#embed-the-complete-reader).

An invalid example preserves the last accepted record and selection. The workbench
has no Raw editor or technical directory.

- **Agent: trajectory and details.** The complete trajectory flows down the page,
  with its first item selected. Click a full row to read input/output; only exceptional states are marked.
- **Graph: steps, flow and details.** The flow combines repeated visits to a node,
  while the steps and details retain every original visit and value. Definitions govern
  connections, branches, cycles and layout independently of execution success or failure.
  Nodes add confirmed visit and exception counts. Connections are selectable, but do not
  claim observed traversal; unobserved nodes are not marked skipped. Read the overall result
  through its root invocation step, without a duplicate result card. Missing definitions or
  unmatched scopes retain a labeled call-relationship view; the root invocation is not a structural start node.
- **Workflow: flow and details.** There is no step sidebar or search. The initial detail
  shows the overall result; click a node to read its input/output, then use **Run result**
  beside the detail heading to return. Flow defaults left-to-right using the existing
  four-direction `eino-workflow-dag` renderer. Subflows retain scope-return navigation.

Graph/Workflow flow panels stay open, with zoom and fit controls in their headings.
Details show input before output with complete input/output bodies. These workbench designs are owner-accepted;
embedded/offline Graph and Workflow have not adopted this UI revision. Agent already shares
one reading core across all three entries. Records, public APIs and drawing safeguards are
unchanged; Graph definitions exceeding 500 diagram nodes also require explicit drawing.

See the [local version-control and acceptance baseline](docs/LOCAL_VERSION_CONTROL.md).
The original Agent tag and the full subsequent commit history are preserved.

## Embed the complete reader

In an application with a bundler, install the packages:

```sh
npm install eino-viewer eino-workflow-dag
```

Provide a container in the page:

```html
<div id="viewer"></div>
```

Pass the Recorder-produced `runRecord` object to the complete reader; import the
renderer stylesheet once:

```js
import { createEinoRunViewer } from "eino-viewer";
import "eino-workflow-dag/styles.css";

const viewer = createEinoRunViewer(
  document.querySelector("#viewer"),
  runRecord,
  { locale: "en" },
);
```

Agent uses the same trajectory, detail panel, interaction and styles as the
workbench and offline viewer. Graph/Workflow retain their result, recorded
duration, path, call directory, step search and paged source evidence.
The reader is also exported from
`eino-viewer/run-viewer`. You do not need to select an adapter or source type.

When another saved run is ready, update the existing instance; destroy it when
the host removes the reader:

```js
viewer.update(nextRunRecord);
// On unmount:
viewer.destroy();
```

`selectStep(id)` selects an explained step; `selectEvidence(index)` uses a
zero-based original envelope index. `selectGroup(id)` selects a scope and its
descendants; `selectGroup(null)` returns to all steps. Unknown selections return
`false`. Invalid input throws `EinoViewerError` with `diagnostics`; a rejected
update keeps the valid view. `destroy()` is idempotent, and a destroyed instance
cannot be updated or selected again.

The object API cannot recover precision already lost by a caller's JSON parser.
The offline file/paste entry and workbench example loading also validate original
number tokens before parsing. The workbench has no Raw-copy editor; see [input boundaries](#input-fidelity-boundaries).

## Reading rules

- Root results stay separate from intermediate and child outputs. Failures retain
  their original reasons and supported node links. Execution outcome and
  capture completeness are independent; a successful run can be partially captured.
- Embedded/offline Graph/Workflow call directories and breadcrumbs change the local path, step/evidence lists
  and call input/return/error together. The overall result remains available in
  a collapsible summary above the local result; the original record is unchanged.
- Agent scopes use complete source addresses; Workflow levels use recorded
  paths; Graph revisits remain distinct. Ambiguous events stay unassigned.
  A failed child can coexist with a successful parent without rewriting either.
- All three Agent entries share one continuous, unpaged trajectory and default
  to the first recorded item. There is no path diagram, directory or search toolbar.
  Input/output details are fully expanded, input first, without copy buttons;
  copying the main trajectory's boundary content remains available. Only exceptional
  states are marked. Different calls keep separate turns and source-backed nesting.
  A call's scope path opens its local trajectory; breadcrumbs and the overall-result
  action return to the parent or whole run. No playback controls are provided.
- Graph and Workflow scopes of **up to 500 nodes draw automatically** in all
  three reading entries. Larger scopes require an explicit draw action; empty
  scopes create no graph. The threshold uses the full selected scope, not search matches.
- Workbench Graph and embedded/offline Graph/Workflow step search cover structural fields: displayed names, IDs, statuses, paths,
  invocation identities and evidence-backed call numbers. Evidence search covers
  envelope kinds and structural metadata. Neither indexes business bodies or
  body summaries; it is not full-text search.
- Available expansion, copy and source actions preserve original values. Agent
  hides technical directories by default; the explicit `selectEvidence` API remains.
  A folded error preview is not source truncation. Empty strings, null, missing, redacted and
  truncated content remain distinct. Duration uses observed boundaries, not a
  sum of parallel step durations.

## Low-level canvas and compatibility

`createEinoViewer` remains the low-level canvas entry for consumers that arrange
their own result, detail and evidence UI. It is not an alias for the complete
reader; its API has not changed:

```js
import { createEinoViewer } from "eino-viewer";
import "eino-workflow-dag/styles.css";

const canvas = createEinoViewer(document.querySelector("#viewer"), runRecord, {
  onNodeClick({ id, node }) {
    console.log(id, node);
  },
});
```

It also supports `update(input)` and idempotent `destroy()`; invalid updates
preserve the valid canvas. Node clicks return `{ id, node }`: Run Records use
canonical `ExecutionDAG` nodes, and definition-only inputs use source nodes.

The primary input is one `EinoRunRecord`. Compatibility inputs include
schema-v1 `EinoWorkflowSnapshot`, supported envelopes from one run, and validated
`EinoViewerDocument` objects. `projectEinoViewerDocument()` returns stable
`code`/`path` diagnostics instead of throwing input errors. Mixed runs,
conflicting source anchors and missing anchors are not resolved by guessing.

`eino-viewer` depends one-way on `eino-workflow-dag@^1.3.1`; its existing
imports, snapshots, React/Vue adapters and rendering remain unchanged.
`eino-viewer/workflow` re-exports that renderer. Advanced `/protocol`, `/views`,
`/execution-dag`, `/trajectory` and `/explanation` entries remain available.
The append-only trajectory builder is a compatibility API, not a live-viewing
product. Protocol records remain evidence, not extra top-level product areas.

## Input fidelity boundaries

The viewer rejects data it cannot read reliably rather than rewriting it.
Integers must be between `-9007199254740991` and `9007199254740991`; larger
numbers are not rounded or converted to strings. Workbench example loading and offline text
imports reject discarded decimal precision and underflow. Ordinary decimals
and equivalent exponent forms remain supported. Numeric-looking strings stay
strings; unsafe embedded tool-argument JSON stays verbatim.
Object APIs cannot recover precision already lost before the viewer receives
the value; the text-import checks do not retroactively validate that source JSON.

Inputs are bounded to 64 MiB, depth 128 and 1,000,000 values. Object input size
uses the expanded compact JSON UTF-8 representation. Accessors, sparse arrays
and other non-plain JSON values are rejected without reading getters.

## Coverage and maintenance

The [32 real Recorder scenarios](https://github.com/silicon-nora/eino-viewer/blob/main/fixtures/recorder-matrix/README.md)
cover real Eino Runner/compile/Invoke execution with deterministic model doubles,
including repeated and parallel calls, nested failures, cancellation, interruption,
redaction and missing bodies. Run `npm run test:recorder-matrix` to check the
collection/projection chain, or `npm run inspect:recorder-matrix -- --strict`
for the static assessment. No external model service is needed.

Four capture/attribution limits remain: two older Graph fixtures lack node
bodies; an oversized Graph fixture deliberately omits bodies; some parallel
child-Agent events lack enough identity to assign to a call. Capture completeness
does not invent missing data. Interrupt/resume and arbitrary multi-Agent coverage
are not promised.

See the [example-first and Agent trajectory acceptance](https://github.com/silicon-nora/eino-viewer/blob/main/docs/AGENT_TRAJECTORY_ACCEPTANCE.md),
[static-result roadmap](https://github.com/silicon-nora/eino-viewer/blob/main/docs/STATIC_RESULT_ROADMAP.md)
and [test maintenance guide](tests/README.md). `npm run benchmark:static`
measures synthetic 100/1,000/10,000-record inputs on the local machine; it is not
business coverage or a performance SLA. Publication is outside the current work.
