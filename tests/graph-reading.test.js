import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGraphReading } from "../site/graph-reading.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { executionDAGToWorkflowSnapshot } from "../src/execution-dag.js";
import { parseWorkflowSnapshot } from "eino-workflow-dag/validation";

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(outcome) {
  const record = freeze(JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/graph-multistep-loop-${outcome}.json`, import.meta.url), "utf8")));
  const result = projectEinoViewerDocument(record);
  assert.equal(result.ok, true);
  return { record, execution: result.document.execution };
}
function assertMappings(reading, original) {
  assert.deepEqual([...reading.nodeIdByExecutionId.keys()].sort(), original.nodes.map(({ id }) => id).sort());
  assert.deepEqual([...reading.memberIdsByNodeId.values()].flat().sort(), original.nodes.map(({ id }) => id).sort());
  for (const node of reading.execution.nodes) {
    const ids = reading.memberIdsByNodeId.get(node.id);
    assert.deepEqual(node.metadata.graphReading.memberIds, ids);
    ids.forEach((id) => assert.equal(reading.nodeIdByExecutionId.get(id), node.id));
  }
  const originalEdges = new Map(original.edges.map((edge) => [edge.id, edge]));
  assert.deepEqual(reading.execution.edges.flatMap((edge) => edge.metadata.graphReading.edgeIds).sort(), [...originalEdges.keys()].sort());
  for (const edge of reading.execution.edges) for (const id of edge.metadata.graphReading.edgeIds) {
    const source = originalEdges.get(id);
    assert.equal(edge.from, reading.nodeIdByExecutionId.get(source.from));
    assert.equal(edge.to, reading.nodeIdByExecutionId.get(source.to));
    assert.equal(edge.kind, source.kind);
    const { graphReading, ...metadata } = edge.metadata;
    assert.deepEqual(metadata, source.metadata);
  }
}

for (const outcome of ["success", "failed"]) {
  const { record, execution } = fixture(outcome), before = JSON.stringify({ record, execution });
  const reading = buildGraphReading(execution, record.evidence);
  const evaluations = execution.nodes.filter(({ label }) => label === "evaluate");
  const revisions = execution.nodes.filter(({ label }) => label === "revise");
  assert.equal(reading.execution.nodes.length, outcome === "success" ? 5 : 4);
  assert.equal(reading.execution.edges.length, outcome === "success" ? 4 : 3);
  assertMappings(reading, execution);
  for (const visits of [evaluations, revisions]) {
    const node = reading.execution.nodes.find(({ id }) => id === visits[0].id);
    assert.deepEqual(reading.memberIdsByNodeId.get(node.id), visits.map(({ id }) => id));
    assert.equal(node.status, visits.some(({ status }) => status === "failed") ? "failed" : "success");
    assert.deepEqual(node.metadata.graphReading.statusCounts, visits.reduce((counts, { status }) => ({ ...counts, [status]: (counts[status] || 0) + 1 }), {}));
    assert.deepEqual(node.evidence, visits.flatMap(({ evidence }) => evidence).sort((a, b) => a.envelopeIndex - b.envelopeIndex));
    if (visits.length > 1) {
      for (const field of ["startedAtMs", "finishedAtMs", "durationMs", "errorMessage"]) assert.equal(Object.hasOwn(node, field), false);
      assert.equal(Object.hasOwn(node.correlation, "invocationId"), false, "a diagram group is not its first invocation");
    }
  }
  assert.ok(reading.execution.edges.every((edge) => edge.kind === "parent-child" && edge.from === execution.nodes[0].id), "the execution star is not replaced with declared or guessed transitions");
  const snapshot = parseWorkflowSnapshot(executionDAGToWorkflowSnapshot(reading.execution));
  assert.equal(snapshot.workflow.nodes.length, reading.execution.nodes.length);
  assert.equal(snapshot.workflow.edges.filter((edge) => !edge.metadata.synthetic).length, reading.execution.edges.length);
  if (outcome === "failed") {
    assert.equal(evaluations[1].errorMessage, "route evaluation unavailable at round 2");
    assert.equal(reading.execution.nodes.find(({ id }) => id === evaluations[0].id).status, "failed");
  }
  assert.equal(JSON.stringify({ record, execution }), before, "all source values, errors, evidence and IDs remain canonical");
  const mutable = buildGraphReading(execution, record.evidence);
  mutable.execution.nodes[0].correlation.runId = "changed clone";
  mutable.execution.nodes[0].evidence[0].envelopeIndex = -1;
  mutable.execution.edges[0].metadata.graphReading.edgeIds.push("changed clone");
  mutable.memberIdsByNodeId.values().next().value.push("changed map");
  assert.equal(JSON.stringify({ record, execution }), before, "projection and maps do not alias saved facts");
}
console.log("OK: real Graph loops collapse only repeated sources, retain every original visit and edge, and preserve failure");

{
  const { record, execution } = fixture("success");
  const evaluations = execution.nodes.filter(({ label }) => label === "evaluate");
  for (const nodes of [[evaluations[2], evaluations[1]], [evaluations[1]], []]) {
    const visibleExecution = freeze({ schemaVersion: 1, runId: execution.runId, nodes, edges: [] });
    const reading = buildGraphReading(execution, record.evidence, { visibleExecution });
    assertMappings(reading, visibleExecution);
    assert.equal(reading.execution.nodes.length, nodes.length ? 1 : 0);
    assert.equal(Object.hasOwn(reading.execution, "completion"), false, "child scopes do not inherit whole-run completion");
    if (nodes.length) {
      assert.equal(reading.execution.nodes[0].id, evaluations[0].id, "representative identity is stable even when its original visit is outside this scope");
      assert.deepEqual(reading.memberIdsByNodeId.get(evaluations[0].id), evaluations.filter((node) => nodes.includes(node)).map(({ id }) => id));
      if (nodes.length === 1) assert.deepEqual(reading.execution.nodes[0].evidence, evaluations[1].evidence, "a subset cannot borrow the first visit's evidence");
    }
  }
  const renamed = structuredClone(execution);
  renamed.nodes.forEach((node) => { node.label = "Identical display name"; });
  const reading = buildGraphReading(renamed, record.evidence);
  assert.equal(reading.execution.nodes.length, 5, "same display names never merge distinct source nodes");
  const bodiesUnread = structuredClone(record.evidence);
  for (const envelope of bodiesUnread) if (envelope.kind === "component.io") Object.defineProperty(envelope.payload, "body", {
    get() { throw new Error("Presentation grouping must not read business bodies"); },
  });
  assert.deepEqual(buildGraphReading(execution, bodiesUnread).execution, buildGraphReading(execution, record.evidence).execution);
}
console.log("OK: scoped views retain full-run identity and source visit order; names and bodies do not determine grouping");

// Small boundary-only unit inputs exercise ambiguous identity and edge semantics;
// they are not Recorder fixtures or additions to the supported scenario matrix.
function callbacks(specifications) {
  const runId = "graph-reading-unit", nodes = [], edges = [], envelopes = [];
  const emit = (specification, parent) => {
    const { id, entity = "repeated", path = [entity], children = [], status = "success" } = specification;
    const node = { id, kind: "component", label: "Same label", component: children.length ? "Graph" : "Lambda", status,
      sequence: nodes.length, correlation: { runId, entityId: entity, invocationId: `invocation:${id}` }, evidence: [], metadata: {} };
    if (parent) node.correlation.parentEntityId = parent.correlation.entityId;
    nodes.push(node);
    if (parent) edges.push({ id: `edge:${id}`, from: parent.id, to: id, kind: "parent-child", sequence: edges.length, metadata: {} });
    const append = (phase) => {
      const envelopeIndex = envelopes.length;
      envelopes.push({ kind: "callback.event", correlation: { ...node.correlation }, payload: { phase, streaming: false,
        address: [{ type: "runnable", id: "graph" }, ...path.map((part) => ({ type: "node", id: part }))], nodePath: path, run: { component: node.component } } });
      node.evidence.push({ envelopeIndex, kind: "callback.event", role: phase });
    };
    append("start");
    children.forEach((child) => emit(child, node));
    append(status === "failed" ? "error" : "end");
  };
  specifications.forEach((specification) => emit(specification));
  return { execution: { schemaVersion: 1, runId, nodes, edges }, envelopes };
}

{
  const source = callbacks([
    { id: "parent-1", entity: "parent", children: [{ id: "child-1" }, { id: "child-2" }] },
    { id: "parent-2", entity: "parent", children: [{ id: "child-3" }, { id: "child-4" }] },
  ]);
  freeze(source);
  const reading = buildGraphReading(source.execution, source.envelopes);
  assertMappings(reading, source.execution);
  assert.deepEqual([...reading.memberIdsByNodeId], [["parent-1", ["parent-1", "parent-2"]], ["child-1", ["child-1", "child-2"]], ["child-3", ["child-3", "child-4"]]]);
  assert.deepEqual(reading.execution.edges.map(({ from, to }) => [from, to]), [["parent-1", "child-1"], ["parent-1", "child-3"]], "different parent invocations stay separate even if the parent diagram node merges");
  const locations = callbacks([{ id: "left-1", path: ["left"] }, { id: "right-1", path: ["right"] }, { id: "left-2", path: ["left"] }, { id: "right-2", path: ["right"] }]);
  assert.deepEqual([...buildGraphReading(locations.execution, locations.envelopes).memberIdsByNodeId], [["left-1", ["left-1", "left-2"]], ["right-1", ["right-1", "right-2"]]]);
}
console.log("OK: identical source names and entity IDs cannot merge distinct locations or parent invocations");

for (const [name, damage] of [
  ["missing terminal", ({ execution }) => execution.nodes[1].evidence.pop()],
  ["missing invocation identity", ({ execution }) => { delete execution.nodes[1].correlation.invocationId; }],
  ["unresolved callback", ({ execution }) => { execution.nodes[1].metadata.callbackCorrelation = "unresolved"; }],
  ["missing enclosing parent", ({ execution }) => { execution.edges = execution.edges.filter(({ to }) => to !== "first"); }],
  ["ambiguous enclosing parent", ({ execution }) => { execution.edges.push({ ...execution.edges[0], id: "duplicate-parent-edge" }); }],
  ["overlapping calls", ({ execution, envelopes }) => {
    [envelopes[2], envelopes[3]] = [envelopes[3], envelopes[2]];
    execution.nodes.forEach((node) => node.evidence.forEach((reference) => {
      if (reference.envelopeIndex === 2) reference.envelopeIndex = 3;
      else if (reference.envelopeIndex === 3) reference.envelopeIndex = 2;
    }));
  }],
]) {
  const source = callbacks([{ id: "parent", entity: "parent", children: [{ id: "first" }, { id: "second" }] }]);
  damage(source);
  freeze(source);
  const reading = buildGraphReading(source.execution, source.envelopes);
  assert.equal(reading.execution.nodes.length, 3, name);
  assert.deepEqual([...reading.nodeIdByExecutionId], source.execution.nodes.map(({ id }) => [id, id]), name);
}
console.log("OK: incomplete, ambiguous or overlapping callback evidence keeps original nodes separate");

{
  const source = callbacks([{ id: "first", status: "failed" }, { id: "second" }, { id: "third" }]);
  const reading = buildGraphReading(source.execution, source.envelopes);
  assert.equal(reading.execution.nodes.length, 1);
  assert.equal(reading.execution.edges.length, 0, "repeated visits alone never invent a self-loop or traversal edge");
  assert.equal(reading.execution.nodes[0].status, "failed", "later successes cannot cover an earlier failure");
  assert.deepEqual(reading.execution.nodes[0].metadata.graphReading.statusCounts, { failed: 1, success: 2 });
  assert.doesNotThrow(() => parseWorkflowSnapshot(executionDAGToWorkflowSnapshot(reading.execution)));
}
{
  const source = callbacks([{ id: "first" }, { id: "second" }, { id: "sink", entity: "sink" }]);
  source.execution.edges = [
    { id: "control-1", from: "first", to: "sink", kind: "control", sequence: 0, metadata: { source: { a: 1, b: 2 } } },
    { id: "control-2", from: "second", to: "sink", kind: "control", sequence: 1, metadata: { source: { b: 2, a: 1 } } },
  ];
  freeze(source);
  const reading = buildGraphReading(source.execution, source.envelopes);
  assertMappings(reading, source.execution);
  assert.equal(reading.execution.nodes.length, 2);
  assert.equal(reading.execution.edges.length, 1, "only equivalent source relations collapse");
  assert.deepEqual(reading.execution.edges[0].metadata.graphReading.edgeIds, ["control-1", "control-2"]);
  assert.doesNotThrow(() => parseWorkflowSnapshot(executionDAGToWorkflowSnapshot(reading.execution)));
}
console.log("OK: isolated repetitions and equivalent source relations collapse into renderer-compatible diagrams");

for (const [name, relations] of [
  ["self edge", [["first", "second", "control", {}]]],
  ["directed cycle", [["first", "bridge", "control", {}], ["bridge", "second", "control", {}]]],
  ["duplicate endpoints with different kinds", [["first", "bridge", "control", {}], ["second", "bridge", "data", {}]]],
  ["duplicate endpoints with different metadata", [["first", "bridge", "control", { relation: "a" }], ["second", "bridge", "control", { relation: "b" }]]],
]) {
  const source = callbacks([{ id: "first" }, { id: "bridge", entity: "bridge" }, { id: "second" }]);
  source.execution.edges = relations.map(([from, to, kind, metadata], sequence) => ({ id: `edge-${sequence}`, from, to, kind, sequence, metadata }));
  freeze(source);
  const before = JSON.stringify(source);
  assert.doesNotThrow(() => parseWorkflowSnapshot(executionDAGToWorkflowSnapshot(source.execution)), `original ${name} case must be renderer-compatible`);
  const reading = buildGraphReading(source.execution, source.envelopes);
  assertMappings(reading, source.execution);
  assert.deepEqual([...reading.nodeIdByExecutionId], source.execution.nodes.map(({ id }) => [id, id]), `avoid introducing ${name}`);
  assert.doesNotThrow(() => parseWorkflowSnapshot(executionDAGToWorkflowSnapshot(reading.execution)), `fallback for ${name} must remain renderer-compatible`);
  const visibleExecution = { schemaVersion: 1, runId: source.execution.runId, nodes: [source.execution.nodes[2]], edges: [] };
  const scoped = buildGraphReading(source.execution, source.envelopes, { visibleExecution });
  assert.equal(scoped.nodeIdByExecutionId.get("second"), "second", "even a conflict-free visible subset retains the full-run fallback identity");
  assert.doesNotThrow(() => parseWorkflowSnapshot(executionDAGToWorkflowSnapshot(scoped.execution)));
  assert.equal(JSON.stringify(source), before, "compatibility fallback cannot rewrite recorded facts");
}
console.log("OK: merging cannot introduce self edges, directed cycles or duplicate endpoint relations; scope identities remain stable");

for (const relations of [
  [["first", "first", "control"]],
  [["first", "second", "control"], ["second", "first", "control"]],
  [["first", "second", "control"], ["first", "second", "data"]],
]) {
  const source = callbacks([{ id: "first" }, { id: "second" }]);
  source.execution.edges = relations.map(([from, to, kind], sequence) => ({ id: `edge-${sequence}`, from, to, kind, sequence, metadata: {} }));
  freeze(source);
  const before = JSON.stringify(source);
  const reading = buildGraphReading(source.execution, source.envelopes);
  assertMappings(reading, source.execution);
  assert.deepEqual([...reading.nodeIdByExecutionId], [["first", "first"], ["second", "second"]]);
  assert.deepEqual(reading.execution.edges.map(({ from, to, kind }) => [from, to, kind]), relations, "pre-existing unsupported relations remain intact, not rejected or silently repaired");
  assert.equal(JSON.stringify(source), before);
}
console.log("OK: pre-existing self edges, cycles and multiedges add no new input restriction and retain all original relations");

{
  const { execution, envelopes } = callbacks([{ id: "first" }, { id: "second" }]);
  assert.throws(() => buildGraphReading(execution, envelopes, { visibleExecution: { ...execution, runId: "other" } }), /same run/);
  assert.throws(() => buildGraphReading(execution, envelopes, { visibleExecution: { ...execution, nodes: [{ ...execution.nodes[0], status: "failed" }] } }), /original execution facts/);
  assert.throws(() => buildGraphReading({ ...execution, nodes: [...execution.nodes, execution.nodes[0]] }, envelopes), /unique execution node IDs/);
  assert.throws(() => buildGraphReading(execution, envelopes, { visibleExecution: { ...execution, nodes: [execution.nodes[0]], edges: [{ id: "outside", from: "first", to: "second", kind: "control" }] } }), /visible scope/);
}
console.log("OK: visible projections reject a different run, altered node facts, duplicate IDs and out-of-scope edges");
