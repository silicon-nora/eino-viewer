import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adaptWorkflowSnapshot, createEinoDAGEnvelope } from "../src/protocol.js";
import { EinoViewerError, projectEinoViewerDocument } from "../src/viewer.js";
import { executionDAGToWorkflowSnapshot } from "../src/execution-dag.js";
import { workflowAccessibilityLabel, workflowNodeLabel, workflowPresentationSnapshot } from "../src/renderer-presentation.js";

const root = resolve(import.meta.dirname, "..");
const weather = JSON.parse(readFileSync(resolve(root, "fixtures/eino-agent-weather-scenario-v1.json"), "utf8"));
const graphEnvelope = JSON.parse(readFileSync(resolve(root, "fixtures/eino-compose-graph-envelope-v1.json"), "utf8"));
const workflow = {
  schemaVersion: 1,
  workflow: { name: "simple", nodes: [{ id: "model", component: "ChatModel" }], edges: [] },
};

const agent = projectEinoViewerDocument(weather);
assert.equal(agent.ok, true);
assert.equal(agent.document.kind, "agent");
assert.equal(agent.document.execution.nodes.length, 3);
assert.equal(agent.document.evidence.length, 10);

const graph = projectEinoViewerDocument(graphEnvelope);
assert.equal(graph.ok, true);
assert.equal(graph.document.kind, "graph");
assert.equal(graph.document.definition, graphEnvelope.payload);

const workflowDocument = projectEinoViewerDocument(workflow);
assert.equal(workflowDocument.ok, true);
assert.equal(workflowDocument.document.kind, "workflow");
assert.equal(workflowDocument.document.definition, workflow);

const workflowFromEnvelope = projectEinoViewerDocument(adaptWorkflowSnapshot(workflow).envelope);
assert.equal(workflowFromEnvelope.ok, true);
assert.equal(workflowFromEnvelope.document.kind, "workflow");

assert.equal(projectEinoViewerDocument([]).diagnostics[0].code, "viewer.empty_input");
assert.equal(projectEinoViewerDocument(weather, { kind: "unknown" }).diagnostics[0].code, "viewer.invalid_kind");
assert.equal(projectEinoViewerDocument(weather, { runId: "" }).diagnostics[0].code, "viewer.invalid_run_id");
assert.equal(projectEinoViewerDocument(weather, { runId: "missing" }).diagnostics[0].code, "viewer.run_not_found");
assert.equal(projectEinoViewerDocument(weather, { kind: "graph" }).diagnostics[0].code, "viewer.missing_anchor");

const workflowEnvelope = adaptWorkflowSnapshot(workflow, { correlation: { runId: "run-1" } }).envelope;
const agentInWorkflowRun = { ...weather[3], correlation: { ...weather[3].correlation, runId: "run-1" } };
const ambiguous = projectEinoViewerDocument([workflowEnvelope, agentInWorkflowRun]);
assert.equal(ambiguous.ok, false);
assert.equal(ambiguous.diagnostics[0].code, "viewer.ambiguous_kind");
assert.equal(projectEinoViewerDocument([workflowEnvelope, agentInWorkflowRun], { kind: "agent" }).ok, true);

const graphInAgentRun = { ...graphEnvelope, correlation: { runId: weather[0].correlation.runId } };
const agentWithGraph = projectEinoViewerDocument([...weather, graphInAgentRun]);
assert.equal(agentWithGraph.ok, true);
assert.equal(agentWithGraph.document.kind, "agent");
assert.equal(agentWithGraph.document.definition, graphEnvelope.payload);

const messageOnly = createEinoDAGEnvelope({
  kind: "schema.message",
  kindVersion: 1,
  payload: { role: "user", content: "hello" },
});
assert.equal(projectEinoViewerDocument(messageOnly).diagnostics[0].code, "viewer.missing_anchor");

const custom = createEinoDAGEnvelope({
  kind: "custom.telemetry",
  kindVersion: 2,
  payload: { temperature: 31 },
});
const graphWithUnknownEvidence = projectEinoViewerDocument([graphEnvelope, custom]);
assert.equal(graphWithUnknownEvidence.ok, true);
assert.equal(graphWithUnknownEvidence.document.evidence.length, 2);
assert.equal(graphWithUnknownEvidence.diagnostics[0].code, "viewer.unknown_evidence");
assert.equal(graphWithUnknownEvidence.diagnostics[0].severity, "warning");

const duplicateGraph = projectEinoViewerDocument([graphEnvelope, graphEnvelope]);
assert.equal(duplicateGraph.ok, false);
assert.equal(duplicateGraph.diagnostics[0].code, "viewer.ambiguous_definition");

const invalidGraph = structuredClone(graphEnvelope);
invalidGraph.payload.edges[0].to = "missing";
const invalidGraphResult = projectEinoViewerDocument(invalidGraph);
assert.equal(invalidGraphResult.ok, false);
assert.ok(invalidGraphResult.diagnostics.some((entry) => entry.code === "compose.unknown_edge_target"));

const invalidEnvelope = structuredClone(weather[0]);
invalidEnvelope.protocolVersion = 2;
const invalidEnvelopeResult = projectEinoViewerDocument(invalidEnvelope);
assert.equal(invalidEnvelopeResult.ok, false);
assert.ok(invalidEnvelopeResult.diagnostics.some((entry) => entry.path.startsWith("root[0]")));

const mixed = projectEinoViewerDocument([
  { ...weather[3], correlation: { runId: "one" } },
  { ...weather[8], correlation: { runId: "two" } },
]);
assert.equal(mixed.diagnostics[0].code, "viewer.mixed_run");

const selectedRun = projectEinoViewerDocument([
  { ...weather[3], correlation: { ...weather[3].correlation, runId: "one" } },
  { ...weather[3], correlation: { ...weather[3].correlation, runId: "two" } },
], { runId: "two" });
assert.equal(selectedRun.ok, true);
assert.equal(selectedRun.document.evidence.length, 1);
assert.equal(selectedRun.document.execution.runId, "two");

const cyclic = JSON.parse(readFileSync(resolve(root, "fixtures/eino-compose-cyclic-graph-envelope-v1.json"), "utf8"));
const cyclicGraph = projectEinoViewerDocument(cyclic);
assert.equal(cyclicGraph.ok, true);
assert.equal(cyclicGraph.document.definition.edges[2].to, "model");

const existing = projectEinoViewerDocument(cyclicGraph.document);
assert.equal(existing.ok, true);
assert.equal(existing.document, cyclicGraph.document);

const duplicateWorkflow = projectEinoViewerDocument([workflowEnvelope, workflowEnvelope]);
assert.equal(duplicateWorkflow.ok, false);
assert.equal(duplicateWorkflow.diagnostics[0].code, "viewer.ambiguous_definition");

const malformedDocumentCases = [
  ["viewer.invalid_schema_version", (value) => { value.schemaVersion = 2; }],
  ["envelope.unsupported_protocol_version", (value) => { value.evidence[0].protocolVersion = 2; }],
  ["viewer.definition_mismatch", (value) => { value.definition = { ...value.definition, name: "not-the-source-graph" }; }],
];
for (const [code, mutate] of malformedDocumentCases) {
  const value = structuredClone(cyclicGraph.document);
  mutate(value);
  const result = projectEinoViewerDocument(value);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === code), code);
}

const unknownExecutionTarget = structuredClone(agent.document);
unknownExecutionTarget.execution.edges[0].to = "missing";
assert.ok(projectEinoViewerDocument(unknownExecutionTarget).diagnostics.some(
  (entry) => entry.code === "viewer.unknown_execution_edge_target",
));

const cyclicExecution = structuredClone(agent.document);
cyclicExecution.execution.edges.push({
  id: "answer-to-input",
  from: cyclicExecution.execution.nodes.at(-1).id,
  to: cyclicExecution.execution.nodes[0].id,
  kind: "control",
  sequence: cyclicExecution.execution.edges.length + 1,
  metadata: {},
});
assert.ok(projectEinoViewerDocument(cyclicExecution).diagnostics.some(
  (entry) => entry.code === "viewer.execution_cycle",
));

assert.equal(projectEinoViewerDocument(agent.document, { kind: "graph" }).diagnostics[0].code, "viewer.kind_mismatch");
assert.equal(projectEinoViewerDocument(agent.document, { runId: "missing" }).diagnostics[0].code, "viewer.run_not_found");

const recursiveDocument = structuredClone(cyclicGraph.document);
recursiveDocument.definition.metadata.recursive = recursiveDocument;
assert.equal(projectEinoViewerDocument(recursiveDocument).diagnostics[0].code, "viewer.recursive_reference");

const sampleError = new EinoViewerError("viewer.sample", "sample", [
  { severity: "error", code: "viewer.sample", path: "root", message: "sample" },
]);
assert.equal(sampleError.name, "EinoViewerError");
assert.equal(sampleError.code, "viewer.sample");
assert.equal(Object.isFrozen(sampleError.diagnostics), true);

for (const id of ["agent-cancelled", "agent-tool-interrupted", "workflow-failed-successor", "workflow-nested-names"]) {
  const record = JSON.parse(readFileSync(resolve(root, `fixtures/recorder-matrix/${id}.json`), "utf8"));
  const projected = projectEinoViewerDocument(record);
  assert.equal(projected.ok, true, id);
  // Public documents with new incomplete/cancelled step statuses must survive
  // serialization and the full document validator, not only initial projection.
  const roundTrip = projectEinoViewerDocument(JSON.parse(JSON.stringify(projected.document)));
  assert.equal(roundTrip.ok, true, id);
  assert.deepEqual(roundTrip.document.execution, projected.document.execution, id);
}

console.log("OK: eino-viewer classifies Agent, cyclic Graph, and Workflow documents");

const nestedRecord = JSON.parse(readFileSync(resolve(root, "fixtures/recorder-matrix/agent-nested-parallel-scopes.json"), "utf8"));
const nestedDocument = projectEinoViewerDocument(nestedRecord).document;
const canonicalBefore = JSON.stringify(nestedDocument);
const sourceSnapshot = executionDAGToWorkflowSnapshot(nestedDocument.execution);
const snapshotBefore = JSON.stringify(sourceSnapshot);
const uncertain = nestedDocument.execution.nodes.filter((node) => node.metadata.agentScopeUnresolved);
assert.equal(uncertain.length, 6);
for (const locale of ["en", "zh"]) {
  const view = workflowPresentationSnapshot(sourceSnapshot, locale);
  assert.equal(adaptWorkflowSnapshot(view).ok, true, "The rendering copy remains a valid JSON snapshot");
  const nodes = view.workflow.nodes;
  assert.deepEqual(nodes.map((node) => node.id), sourceSnapshot.workflow.nodes.map((node) => node.id));
  assert.equal(view.execution.nodes.length, sourceSnapshot.execution.nodes.length - uncertain.length);
  for (const source of uncertain) {
    const node = nodes.find((item) => item.id === source.id);
    assert.equal(node.component, source.component);
    assert.match(node.name, locale === "zh" ? /调用归属未确认/ : /invocation unconfirmed/i);
    assert.doesNotMatch(workflowNodeLabel(node), /耗时 · 未记录|Duration · Not recorded/);
    assert.equal(node.metadata.einoViewerPresentation.timing, undefined);
    assert.equal(view.execution.nodes.some((item) => item.path[0] === source.id), false);
  }
  const summary = workflowAccessibilityLabel({ nodeCount: nodes.length, edgeCount: view.workflow.edges.length }, { nodes }, locale);
  assert.match(summary, locale === "zh" ? /调用归属未确认: 6/ : /Invocation unconfirmed: 6/);
  assert.doesNotMatch(summary, /耗时未记录|Duration not recorded/);
  // Idempotent when a host reapplies display options to a rendered snapshot.
  assert.deepEqual(workflowPresentationSnapshot(view, locale), view);
}
assert.equal(JSON.stringify(nestedDocument), canonicalBefore);
assert.equal(JSON.stringify(sourceSnapshot), snapshotBefore);
assert.ok(uncertain.every((node) => node.status === "success"), "Presentation never rewrites canonical source states");

const failureSnapshot = structuredClone(sourceSnapshot);
const firstUncertain = uncertain[0].id;
failureSnapshot.workflow.nodes.find((node) => node.id === firstUncertain).metadata.executionStatus = "failed";
failureSnapshot.execution.nodes.find((node) => node.path[0] === firstUncertain).status = "failed";
const failureView = workflowPresentationSnapshot(failureSnapshot);
assert.equal(failureView.execution.nodes.find((node) => node.path[0] === firstUncertain).status, "failed");
assert.match(failureView.workflow.nodes.find((node) => node.id === firstUncertain).name, /Failed · invocation unconfirmed/);

console.log("OK: graph presentation preserves source facts and distinguishes unassigned events from successful calls");

const definitionOnlyRecord = JSON.parse(readFileSync(resolve(root, "fixtures/recorder-matrix/workflow-definition-only.json"), "utf8"));
const definitionOnly = projectEinoViewerDocument(definitionOnlyRecord).document;
assert.equal(definitionOnly.execution, undefined);
assert.equal(Object.hasOwn(definitionOnly.definition.execution, "nodes"), false);
for (const locale of ["en", "zh"]) {
  const view = workflowPresentationSnapshot(definitionOnly.definition, locale);
  assert.deepEqual(view, definitionOnly.definition);
  assert.equal(Object.hasOwn(view.execution, "nodes"), false);
  assert.equal(adaptWorkflowSnapshot(view).ok, true);
}
console.log("OK: declaration-only snapshots preserve an absent execution node list");
