import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEinoRunRecord, validateEinoRunRecord } from "../src/run-record.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { buildExecutionDAG, executionDAGToWorkflowSnapshot } from "../src/execution-dag.js";
import { buildExecutionTrajectory } from "../src/trajectory.js";
import { adaptWorkflowSnapshot } from "../src/protocol.js";

const root = resolve(import.meta.dirname, "..");
const record = JSON.parse(readFileSync(resolve(root, "fixtures/eino-agent-recorder-weather-v1.json"), "utf8"));
const evidence = record.evidence;
const fixture = (name) => JSON.parse(readFileSync(resolve(root, `fixtures/${name}`), "utf8"));
const withRunId = (items, runId) => items.map((item) => ({
  ...structuredClone(item),
  correlation: { ...item.correlation, runId },
}));

assert.equal(validateEinoRunRecord(record).valid, true);
assert.equal(parseEinoRunRecord(record), record);
const projected = projectEinoViewerDocument(record);
assert.equal(projected.ok, true);
assert.equal(projected.document.kind, "agent");
assert.equal(projected.document.execution.runId, record.runId);
assert.deepEqual(projected.document.execution.nodes.map(({ kind }) => kind), ["input", "tool", "output"]);

const realisticAgentRecord = fixture("eino-agent-recorder-trip-planner-v1.json");
assert.equal(validateEinoRunRecord(realisticAgentRecord).valid, true);
assert.equal(realisticAgentRecord.metadata.modelMode, "deterministic-test-double");
const projectedRealisticAgent = projectEinoViewerDocument(realisticAgentRecord);
assert.equal(projectedRealisticAgent.ok, true);
assert.deepEqual(projectedRealisticAgent.document.execution.nodes.map(({ kind }) => kind), [
  "input", "tool", "tool", "tool", "output",
]);
assert.equal(projectedRealisticAgent.document.execution.edges.length, 5);

const workflowRecord = JSON.parse(readFileSync(resolve(root, "fixtures/eino-workflow-recorder-weather-v1.json"), "utf8"));
assert.equal(validateEinoRunRecord(workflowRecord).valid, true);
const projectedWorkflow = projectEinoViewerDocument(workflowRecord);
assert.equal(projectedWorkflow.ok, true);
assert.equal(projectedWorkflow.document.kind, "workflow");
assert.equal(projectedWorkflow.document.execution.runId, workflowRecord.runId);
assert.deepEqual(projectedWorkflow.document.execution.nodes.map(({ id }) => id), [
  "build-context", "generate-answer", "get-weather", "parse-city",
]);

const partialEvidence = [structuredClone(evidence[0])];
const partial = { ...record, runId: "run-partial", evidence: partialEvidence };
partial.evidence[0].correlation.runId = partial.runId;
const projectedPartial = projectEinoViewerDocument(partial);
assert.equal(projectedPartial.ok, true);
assert.equal(projectedPartial.document.kind, "agent");
assert.deepEqual(projectedPartial.document.execution.nodes.map(({ kind }) => kind), ["input"]);
assert.equal(projectedPartial.document.execution.status, "running");

const failedEvidence = withRunId(fixture("eino-agent-events-v1.json"), "run-record-failed");
const failed = projectEinoViewerDocument({
  schemaVersion: 1,
  runId: "run-record-failed",
  source: "agent",
  evidence: failedEvidence,
});
assert.equal(failed.ok, true);
assert.equal(failed.document.execution.status, "failed");
assert.equal(failed.document.execution.nodes.at(-1).errorMessage, "weather backend unavailable");

const cyclicRecord = fixture("eino-graph-recorder-cyclic-v1.json");
assert.equal(validateEinoRunRecord(cyclicRecord).valid, true);
const cyclic = projectEinoViewerDocument(cyclicRecord);
assert.equal(cyclic.ok, true);
assert.equal(cyclic.document.kind, "graph");
assert.equal(cyclic.document.definition.branches[0].targets.includes("model"), true);
assert.equal(cyclic.document.execution.nodes.filter(({ correlation }) => correlation.entityId?.endsWith("node:model")).length, 2);

const scenario = fixture("eino-agent-weather-scenario-v1.json");
const repeatedEvidence = withRunId([
  scenario[0], scenario[3], scenario[6], scenario[3], scenario[6], scenario[8], scenario[9],
], "run-record-repeated");
repeatedEvidence[1].payload.output.message.value.tool_calls[0].id = "call-repeat-1";
repeatedEvidence[2].payload.output.message.value.tool_call_id = "call-repeat-1";
repeatedEvidence[3].payload.output.message.value.tool_calls[0].id = "call-repeat-2";
repeatedEvidence[4].payload.output.message.value.tool_call_id = "call-repeat-2";
const repeated = projectEinoViewerDocument({
  schemaVersion: 1,
  runId: "run-record-repeated",
  source: "agent",
  evidence: repeatedEvidence,
});
assert.equal(repeated.ok, true);
assert.equal(repeated.document.execution.nodes.filter(({ kind }) => kind === "tool").length, 2);

const invalidCases = [
  ["run_record.invalid_schema_version", (value) => { value.schemaVersion = 2; }],
  ["run_record.invalid_run_id", (value) => { value.runId = ""; }],
  ["run_record.invalid_source", (value) => { value.source = "callback"; }],
  ["run_record.invalid_evidence", (value) => { value.evidence = []; }],
  ["run_record.mismatched_run_id", (value) => { value.evidence[0].correlation.runId = "another"; }],
  ["run_record.unknown_field", (value) => { value.kind = "agent"; }],
];
for (const [code, mutate] of invalidCases) {
  const value = structuredClone(record);
  mutate(value);
  const result = validateEinoRunRecord(value);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === code), code);
}

{
  const value = structuredClone(record);
  value.diagnostics = [() => {}];
  const result = validateEinoRunRecord(value);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "run_record.invalid_diagnostic"));
}

{
  const value = structuredClone(record);
  const recursive = { severity: "warning", code: "capture.recursive", path: "evidence", message: "recursive" };
  recursive.self = recursive;
  value.diagnostics = [recursive];
  const result = validateEinoRunRecord(value);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "run_record.recursive_reference"));
}

{
  const value = structuredClone(record);
  value.metadata = { capturedAt: new Date(0) };
  const result = validateEinoRunRecord(value);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "run_record.unsafe_json"));
}

assert.equal(projectEinoViewerDocument(record, { kind: "graph" }).diagnostics[0].code, "viewer.kind_mismatch");
assert.equal(projectEinoViewerDocument(record, { runId: "missing" }).diagnostics[0].code, "viewer.run_not_found");
assert.throws(() => parseEinoRunRecord({}), /Invalid Eino Run Record/);

const lifecycle = (payload, runId = record.runId) => ({
  protocol: "eino-dag", protocolVersion: 1, kind: "run.lifecycle", kindVersion: 1,
  correlation: { runId }, payload,
});
const ended = (outcome = "success", capture = "complete") => lifecycle({ state: "ended", outcome, capture });

// Completion is a source fact, not an inference from the last assistant message
// or from a local tool error. Legacy records remain readable but unconfirmed.
assert.deepEqual(projected.document.completion, { state: "unknown", basis: "legacy" });
assert.ok(projected.diagnostics.some(({ code }) => code === "lifecycle.completion_unknown"));
for (const [outcome, capture, status] of [
  ["success", "complete", "success"], ["failed", "complete", "failed"],
  ["cancelled", "partial", "cancelled"], ["unknown", "partial", "incomplete"],
  ["success", "partial", "success"],
]) {
  const value = { ...structuredClone(record), evidence: [...structuredClone(evidence), ended(outcome, capture)] };
  assert.equal(validateEinoRunRecord(value).valid, true);
  const projection = projectEinoViewerDocument(value);
  assert.equal(projection.ok, true);
  assert.equal(projection.document.execution.status, status);
  assert.deepEqual(projection.document.completion, { state: "ended", basis: "recorded", outcome, capture });
  assert.deepEqual(projection.document.execution.completion, projection.document.completion);
  assert.equal(projection.document.execution.nodes.length, projected.document.execution.nodes.length);
  assert.equal(projection.diagnostics.some(({ code }) => code === "lifecycle.partial_capture"), capture === "partial");
  assert.equal(projection.diagnostics.some(({ code }) => code === "lifecycle.unknown_outcome"), outcome === "unknown");
  assert.equal(projectEinoViewerDocument(projection.document).ok, true);
  assert.equal(adaptWorkflowSnapshot(executionDAGToWorkflowSnapshot(projection.document.execution)).ok, true);
  const trajectoryInput = structuredClone(value.evidence);
  const trajectory = buildExecutionTrajectory(trajectoryInput);
  assert.equal(trajectory.ok, true);
  assert.equal(trajectory.trajectory.status, status);
  assert.deepEqual(trajectory.trajectory.completion, projection.document.completion);
  assert.equal(Object.isFrozen(trajectory.trajectory.completion), true);
  assert.equal(Object.isFrozen(trajectoryInput.at(-1)), false);
}

{
  const open = [lifecycle({ state: "started" }), ...structuredClone(evidence)];
  const trajectory = buildExecutionTrajectory(open);
  assert.equal(trajectory.ok, true);
  assert.equal(trajectory.trajectory.records.at(-1).kind, "assistant");
  assert.equal(trajectory.trajectory.status, "running");
  assert.deepEqual(trajectory.trajectory.completion, { state: "open", basis: "recorded" });
  assert.equal(buildExecutionDAG(open).dag.status, "running");
  assert.equal(projectEinoViewerDocument({ ...record, evidence: open }).document.execution.status, "running");
}

{
  const localFailure = withRunId(fixture("eino-agent-recorder-trip-planner-failure-v1.json").evidence, record.runId);
  const recovered = [...localFailure, ended()];
  const trajectory = buildExecutionTrajectory(recovered);
  assert.equal(trajectory.ok, true);
  assert.equal(trajectory.trajectory.status, "success");
  assert.ok(trajectory.trajectory.records.some(({ status }) => status === "failed"));
  const dag = buildExecutionDAG(recovered);
  assert.equal(dag.dag.status, "success");
  assert.ok(dag.dag.nodes.some(({ status }) => status === "failed"));
}

const invalidLifecycleCases = [
  ["lifecycle.invalid_version", [() => ({ ...ended(), kindVersion: 2 })]],
  ["lifecycle.invalid_payload", [() => lifecycle(null)]],
  ["lifecycle.invalid_state", [() => lifecycle({ state: "paused" })]],
  ["lifecycle.invalid_outcome", [() => lifecycle({ state: "ended", capture: "complete" })]],
  ["lifecycle.invalid_outcome", [() => lifecycle({ state: "ended", outcome: "okay", capture: "complete" })]],
  ["lifecycle.invalid_capture", [() => lifecycle({ state: "ended", outcome: "success" })]],
  ["lifecycle.unknown_field", [() => lifecycle({ state: "started", outcome: "success" })]],
  ["lifecycle.missing_run_id", [() => ({ ...ended(), correlation: {} })]],
  ["lifecycle.conflicting_markers", [() => ended(), () => ended("failed")]],
  ["lifecycle.conflicting_markers", [() => ended(), () => lifecycle({ state: "started" })]],
  ["lifecycle.conflicting_markers", [() => lifecycle({ state: "started" }), () => lifecycle({ state: "started" })]],
  ["lifecycle.evidence_after_end", [() => ended(), () => structuredClone(evidence[0])]],
];
for (const [code, markers] of invalidLifecycleCases) {
  const value = { ...structuredClone(record), evidence: [...structuredClone(evidence), ...markers.map((make) => make())] };
  for (const result of [validateEinoRunRecord(value), projectEinoViewerDocument(value), projectEinoViewerDocument(value.evidence), buildExecutionDAG(value.evidence), buildExecutionTrajectory(value.evidence)]) {
    assert.equal(result.valid ?? result.ok, false, code);
    assert.ok(result.diagnostics.some((entry) => entry.code === code), code);
  }
}

{
  const mixed = { ...structuredClone(record), evidence: [...structuredClone(evidence), lifecycle({ state: "ended", outcome: "success", capture: "complete" }, "other-run")] };
  assert.ok(validateEinoRunRecord(mixed).diagnostics.some(({ code }) => code === "run_record.mismatched_run_id"));
  assert.equal(projectEinoViewerDocument(mixed).ok, false);
  assert.equal(buildExecutionTrajectory(mixed.evidence).ok, false);
}

{
  const staticTool = { protocol: "eino-dag", protocolVersion: 1, kind: "schema.tool", kindVersion: 1, correlation: { runId: record.runId }, payload: { name: "weather", desc: "Read weather" } };
  const value = { ...structuredClone(record), evidence: [...structuredClone(evidence), ended(), staticTool] };
  assert.equal(validateEinoRunRecord(value).valid, true);
  assert.equal(projectEinoViewerDocument(value).ok, true);
}

{
  const complete = projectEinoViewerDocument({ ...structuredClone(record), evidence: [...structuredClone(evidence), ended()] }).document;
  const forged = structuredClone(complete);
  forged.completion.outcome = "failed";
  assert.ok(projectEinoViewerDocument(forged).diagnostics.some(({ code }) => code === "viewer.completion_mismatch"));
  const forgedExecution = structuredClone(complete);
  forgedExecution.execution.status = "failed";
  assert.ok(projectEinoViewerDocument(forgedExecution).diagnostics.some(({ code }) => code === "viewer.execution_status_mismatch"));
  const legacyDocument = structuredClone(projected.document);
  delete legacyDocument.completion;
  delete legacyDocument.execution.completion;
  assert.deepEqual(projectEinoViewerDocument(legacyDocument).document.completion, { state: "unknown", basis: "legacy" });
}

{
  const captureDiagnostic = { severity: "error", code: "recorder.capture_error", path: "evidence", message: "A source message could not be captured." };
  const value = { ...structuredClone(record), diagnostics: [captureDiagnostic], evidence: [...structuredClone(evidence), ended("success", "partial")] };
  const projection = projectEinoViewerDocument(value);
  assert.equal(projection.ok, true);
  assert.equal(projection.document.execution.status, "success");
  assert.ok(projection.diagnostics.some(({ code }) => code === captureDiagnostic.code));
}

// These are produced by actual Go Recorder runs, not hand-authored lifecycle
// markers. Keep the old fixtures above as the backward-compatibility contract.
for (const [name, source, outcome] of [
  ["eino-agent-recorder-trip-planner-completed-v1.json", "agent", "success"],
  ["eino-agent-recorder-trip-planner-failure-completed-v1.json", "agent", "failed"],
  ["eino-graph-recorder-cyclic-completed-v1.json", "graph", "success"],
  ["eino-workflow-recorder-weather-completed-v1.json", "workflow", "success"],
]) {
  const captured = fixture(name);
  assert.equal(validateEinoRunRecord(captured).valid, true, name);
  const projection = projectEinoViewerDocument(captured);
  assert.equal(projection.ok, true, name);
  assert.equal(projection.document.kind, source);
  const expected = { state: "ended", basis: "recorded", outcome, capture: "complete" };
  assert.deepEqual(projection.document.completion, expected, name);
  assert.deepEqual(projection.document.execution.completion, expected, name);
  assert.equal(projection.document.execution.status, outcome, name);
  if (source === "agent") {
    const trajectory = buildExecutionTrajectory(captured.evidence);
    assert.equal(trajectory.ok, true, name);
    assert.deepEqual(trajectory.trajectory.completion, expected, name);
    assert.equal(trajectory.trajectory.status, outcome, name);
  }
}

console.log("OK: one Eino Run Record validates and opens directly in Viewer");
