import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { buildGraphTopology } from "../site/graph-topology.js";

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(path) {
  const record = freeze(JSON.parse(readFileSync(new URL(`../fixtures/${path}.json`, import.meta.url), "utf8")));
  const result = projectEinoViewerDocument(record);
  assert.equal(result.ok, true);
  assert.equal(result.document.kind, "graph");
  return { record, document: result.document };
}
function assertSourceTopology(model, definition) {
  assert.equal(model.edges.length, definition.edges.length + (definition.branches || []).reduce((count, branch) => count + branch.targets.length, 0));
  assert.equal(new Set(model.edges.map(({ id }) => id)).size, model.edges.length);
  for (const edge of model.edges) {
    assert.equal(edge.basis, "declared");
    assert.equal(Object.hasOwn(edge, "status"), false, "declared connectivity is not observed traversal");
    if (edge.kind === "edge") {
      const { id, kind, basis, sourceIndex, ...source } = edge;
      assert.deepEqual(source, definition.edges[sourceIndex]);
    } else {
      const source = definition.branches[edge.sourceIndex];
      assert.equal(edge.from, source.from);
      assert.equal(edge.to, source.targets[edge.targetIndex]);
      assert.deepEqual(edge.metadata, source.metadata);
    }
  }
}

for (const outcome of ["success", "failed"]) {
  const { record, document } = fixture(`recorder-matrix/graph-multistep-loop-${outcome}`);
  const before = JSON.stringify({ record, document });
  const model = buildGraphTopology(document);
  assert.equal(model.nodes.length, 7);
  assertSourceTopology(model, document.definition);
  assert.ok(model.edges.some(({ from, to, kind }) => from === "evaluate" && to === "revise" && kind === "branch"));
  assert.ok(model.edges.some(({ from, to, kind }) => from === "revise" && to === "evaluate" && kind === "edge"));
  const visits = document.execution.nodes.filter(({ label }) => label === "evaluate");
  const evaluate = model.nodes.find(({ id }) => id === "evaluate");
  assert.deepEqual(evaluate.memberIds, visits.map(({ id }) => id));
  assert.deepEqual(model.memberIdsByNodeId.get("evaluate"), evaluate.memberIds);
  visits.forEach(({ id }) => assert.equal(model.nodeIdByExecutionId.get(id), "evaluate"));
  assert.equal(evaluate.status, outcome);
  assert.deepEqual(evaluate.statusCounts, outcome === "success" ? { success: 3 } : { success: 1, failed: 1 });
  assert.equal(model.nodes.find(({ id }) => id === "fallback").status, "not-observed");
  assert.equal(model.nodes.find(({ id }) => id === "finish").status, outcome === "success" ? "success" : "not-observed");
  for (const id of ["start", "end"]) {
    assert.equal(model.nodes.find((node) => node.id === id).status, "structural");
    assert.deepEqual(model.memberIdsByNodeId.get(id), []);
  }
  assert.deepEqual(model.unmappedExecutionIds, [document.execution.nodes[0].id], "the root call is neither a definition node nor a structural endpoint");
  assert.deepEqual([...model.nodeIdByExecutionId.keys()].sort(), document.execution.nodes.slice(1).map(({ id }) => id).sort());
  assert.equal(Object.hasOwn(evaluate, "input"), false);
  assert.equal(Object.hasOwn(evaluate, "output"), false);
  assert.equal(Object.hasOwn(evaluate, "errorMessage"), false, "individual visits retain their own body and error");
  const visibleExecution = { schemaVersion: 1, runId: document.execution.runId, nodes: [visits.at(-1)], edges: [] };
  const scoped = buildGraphTopology(document, { visibleExecution });
  assert.deepEqual(scoped.nodes.map(({ id }) => id), model.nodes.map(({ id }) => id));
  assert.deepEqual(scoped.edges, model.edges, "a visit subset never invents or removes definition routes");
  assert.deepEqual(scoped.memberIdsByNodeId.get("evaluate"), [visits.at(-1).id]);
  assert.equal(scoped.nodeIdByExecutionId.get(visits.at(-1).id), "evaluate");
  const reordered = { ...document, execution: { ...document.execution, nodes: [...document.execution.nodes].reverse() } };
  assert.deepEqual(buildGraphTopology(reordered).memberIdsByNodeId.get("evaluate"), evaluate.memberIds, "source references, not node array order, retain visit order");
  assert.equal(JSON.stringify({ record, document }), before);
  model.nodes.find(({ id }) => id === "evaluate").definition.name = "changed view";
  model.edges[0].channels.push("changed view");
  model.memberIdsByNodeId.get("evaluate").push("changed map");
  assert.equal(JSON.stringify({ record, document }), before, "model objects cannot mutate canonical identities, bodies, outcomes or definitions");
}
console.log("OK: real Graph topology retains declared loops and branches, exact visit membership, failures and unobserved alternatives");

{
  const { document } = fixture("eino-graph-recorder-cyclic-completed-v1");
  assert.ok(document.evidence.filter(({ kind }) => kind === "callback.event").every(({ correlation }) => correlation.invocationId === undefined));
  const before = JSON.stringify(document);
  const model = buildGraphTopology(document);
  assert.equal(model.memberIdsByNodeId.get("model").length, 2, "exact source paths bind legacy visits without requiring or adding source invocation IDs");
  assert.ok(model.edges.some(({ from, to, kind }) => from === "model" && to === "model" && kind === "branch"));
  assert.ok(model.edges.some(({ from, to, kind }) => from === "model" && to === "end" && kind === "branch"));
  const partial = structuredClone(document), visit = partial.execution.nodes[1];
  visit.evidence = visit.evidence.filter(({ role }) => role === "start");
  visit.status = "incomplete";
  const partialModel = buildGraphTopology(freeze(partial));
  assert.deepEqual(partialModel.memberIdsByNodeId.get("model"), model.memberIdsByNodeId.get("model"));
  assert.equal(partialModel.nodes.find(({ id }) => id === "model").status, "incomplete", "a confident partial visit is not made successful by a different visit");
  assert.equal(JSON.stringify(document), before);
}
console.log("OK: legacy and partial callbacks map by actual location; no invocation identity or completed boundary is fabricated");

{
  const { document } = fixture("eino-compose-cyclic-graph-envelope-v1");
  const model = buildGraphTopology(document);
  assertSourceTopology(model, document.definition);
  assert.ok(model.nodes.filter(({ kind }) => kind === "node").every(({ status, memberIds }) => status === "definition-only" && !memberIds.length));
  assert.equal(model.nodeIdByExecutionId.size, 0);
  assert.deepEqual(model.unmappedExecutionIds, []);
  assert.equal(model.edges.filter(({ from, to }) => from === "model" && to === "tools").length, 2, "an edge and a branch with the same endpoints remain distinct declarations");
  assert.deepEqual(buildGraphTopology(document), model, "cyclic topology generation is deterministic and does not attempt a DAG sort");
}
console.log("OK: definition-only cyclic graphs preserve branch/edge distinctions without invented observation or skip status");

// Boundary-only unit inputs test private association rules, not new Recorder
// fixtures. Each callback is a partial visit with an exact structural location.
function documentFor(definition, specifications) {
  const runId = "topology-unit";
  const evidence = [{ kind: "compose.graph", correlation: { runId }, payload: structuredClone(definition) }];
  const nodes = (specifications || []).map(({ id, path, root = definition.name || "unit-root", component = "Lambda", status = "incomplete" }, sequence) => {
    const entityId = `source:${JSON.stringify([root, path])}`, envelopeIndex = evidence.length;
    const correlation = { runId, entityId, eventId: `event:${id}` };
    evidence.push({ kind: "callback.event", correlation, payload: { phase: "start", streaming: false,
      nodePath: path, address: [{ type: "runnable", id: root }, ...path.map((part) => ({ type: "node", id: part }))], run: { component } } });
    return { id, label: "Identical name", kind: "component", component, status, sequence,
      correlation: { runId, entityId, invocationId: correlation.eventId }, metadata: {}, evidence: [{ envelopeIndex, kind: "callback.event", role: "start" }] };
  });
  return { kind: "graph", definition: structuredClone(definition), evidence,
    ...(specifications ? { execution: { schemaVersion: 1, runId, nodes, edges: [] } } : {}) };
}
const leaf = { name: "root", nodes: [{ id: "item", name: "Identical name", component: "Lambda" }], edges: [] };

{
  const definition = { ...leaf, branches: [{ from: "start", targets: ["item"] }, { from: "item", targets: ["item", "end"] }] };
  const model = buildGraphTopology(freeze(documentFor(definition)));
  assert.deepEqual(model.nodes.map(({ id }) => id), ["start", "item", "end"], "branch-only endpoint references count as structural references");
  assertSourceTopology(model, definition);
  assert.deepEqual(buildGraphTopology(documentFor(leaf)).nodes.map(({ id }) => id), ["item"], "no unreferenced start/end nodes are invented");
  const skipped = buildGraphTopology(documentFor(leaf, [{ id: "skip", path: ["item"], status: "skipped" }]));
  assert.equal(skipped.nodes[0].status, "skipped");
  assert.deepEqual(skipped.nodes[0].statusCounts, { skipped: 1 });
  assert.equal(buildGraphTopology(documentFor(leaf, [])).nodes[0].status, "not-observed", "an empty observation set never means skipped");
}
console.log("OK: structural endpoints are reference-driven, and explicit skip differs from missing observation and definition-only data");

for (const [name, mutate] of [
  ["mismatched nodePath", (document) => { document.evidence[1].payload.nodePath = ["different"]; }],
  ["different runnable", (document) => { document.evidence[1].payload.address[0].id = "other-root"; }],
  ["extra nested scope", (document) => { document.evidence[1].payload.nodePath = ["nested", "item"]; document.evidence[1].payload.address.splice(1, 0, { type: "node", id: "nested" }); }],
  ["different run", (document) => { document.evidence[1].correlation.runId = "other-run"; }],
  ["different component", (document) => { document.evidence[1].payload.run.component = "Tool"; }],
  ["contradictory source invocation", (document) => { document.evidence[1].correlation.invocationId = "other-call"; }],
  ["unresolved source", (document) => { document.execution.nodes[0].metadata.callbackCorrelation = "unresolved"; }],
  ["contradictory callback locations", (document) => {
    const second = structuredClone(document.evidence[1]);
    second.payload.address[0].id = "other-root";
    document.evidence.push(second);
    document.execution.nodes[0].evidence.push({ envelopeIndex: 2, kind: "callback.event", role: "end" });
  }],
]) {
  const document = documentFor(leaf, [{ id: "visit", path: ["item"] }]);
  mutate(document);
  freeze(document);
  const model = buildGraphTopology(document);
  assert.equal(model.nodes[0].status, "not-observed", name);
  assert.equal(model.nodeIdByExecutionId.size, 0, name);
  assert.deepEqual(model.unmappedExecutionIds, ["visit"], name);
}
console.log("OK: ambiguous or contradictory source locations remain unmapped instead of joining same-name definition nodes");

{
  const definition = { name: "root", nodes: [{ id: "item", component: "Lambda" }, { id: "left", workflow: leaf }, { id: "right", workflow: leaf }], edges: [] };
  const document = freeze(documentFor(definition, [{ id: "top", path: ["item"] }, { id: "left-visit", path: ["left", "item"] }, { id: "right-visit", path: ["right", "item"] }]));
  const top = buildGraphTopology(document), left = buildGraphTopology(document, { definitionPath: ["left"] }), right = buildGraphTopology(document, { definitionPath: ["right"] });
  assert.deepEqual([...top.nodeIdByExecutionId], [["top", "item"]]);
  assert.deepEqual([...left.nodeIdByExecutionId.keys()], ["left-visit"]);
  assert.deepEqual([...right.nodeIdByExecutionId.keys()], ["right-visit"]);
  assert.notEqual(left.nodes[0].id, right.nodes[0].id);
  assert.deepEqual(left.nodes[0].path, ["left", "item"]);
  assert.equal(left.nodes[0].id, `graph:${encodeURIComponent(JSON.stringify(["left", "item"]))}`);
  assert.equal(buildGraphTopology(document, { definitionPath: ["missing"] }), undefined);
  const unnamed = documentFor({ nodes: leaf.nodes, edges: [] }, [{ id: "root-call", path: [], component: "Graph" }, { id: "visit", path: ["item"] }]);
  assert.equal(buildGraphTopology(unnamed).nodeIdByExecutionId.get("visit"), "item", "an unnamed definition can use one exact observed Graph root");
  const ambiguous = documentFor({ nodes: leaf.nodes, edges: [] }, [{ id: "root-1", path: [], component: "Graph", root: "a" }, { id: "root-2", path: [], component: "Graph", root: "b" }, { id: "visit", path: ["item"], root: "a" }]);
  assert.equal(buildGraphTopology(ambiguous).nodeIdByExecutionId.size, 0, "multiple unnamed runnable roots cannot be resolved by source order");
}
console.log("OK: exact nested paths isolate identical node IDs; unnamed and missing definitions use conservative fallback");

{
  const document = documentFor(leaf, [{ id: "visit", path: ["item"] }]);
  assert.equal(buildGraphTopology(undefined), undefined);
  assert.equal(buildGraphTopology({ ...document, kind: "agent" }), undefined);
  assert.equal(buildGraphTopology({ ...document, definition: undefined }), undefined);
  assert.equal(buildGraphTopology({ ...document, definition: { ...leaf, name: "not-source" } }), undefined);
  assert.equal(buildGraphTopology({ ...document, evidence: [...document.evidence, document.evidence[0]] }), undefined);
  assert.equal(buildGraphTopology(document, { visibleExecution: { ...document.execution, runId: "other" } }), undefined);
  assert.equal(buildGraphTopology(document, { visibleExecution: { ...document.execution, nodes: [{ ...document.execution.nodes[0], status: "failed" }] } }), undefined);
  const source = structuredClone(document);
  Object.defineProperty(source.evidence[1].payload, "body", { get() { throw new Error("Business bodies are not topology or identity"); } });
  assert.equal(buildGraphTopology(source).nodeIdByExecutionId.get("visit"), "item");
}
console.log("OK: unreliable definition/scope inputs return no invented topology; association does not read business values");
