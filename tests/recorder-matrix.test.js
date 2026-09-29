import assert from "node:assert/strict";
import { recorderMatrix, loadRecorderMatrixRecord, assessRecorderCase, findRecorderDisplayIssues, findRecorderSummaryIssues, findRecorderStepIssues } from "../scripts/recorder-matrix.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { buildExecutionTrajectory } from "../src/trajectory.js";
import { explainExecutionDAG } from "../src/explanation.js";

// Capture, transport and known semantic-regression gates. These do not claim
// exhaustive display coverage; capability limitations remain in the assessment.
const noFindingCases = new Set([
  "graph-multistep-loop-success", "graph-multistep-loop-failed",
  "workflow-parallel-join-success", "workflow-parallel-join-failed",
]);
for (const id of noFindingCases) {
  assert.ok(recorderMatrix.some((scenario) => scenario.id === id), `${id}: strict baseline must remain registered`);
}
for (const scenario of recorderMatrix) {
  const record = loadRecorderMatrixRecord(scenario.id);
  const before = JSON.stringify(record);
  const assessment = assessRecorderCase(scenario, record);
  assert.equal(assessment.accepted, true, scenario.id);
  const findings = noFindingCases.has(scenario.id)
    ? assessment.findings : assessment.findings.filter(({ severity }) => severity === "error");
  assert.deepEqual(findings, [], `${scenario.id}: static fidelity regression`);
  assert.equal(record.source, scenario.source, scenario.id);
  const projection = projectEinoViewerDocument(record);
  const document = projection.document;
  if (scenario.definitionOnly) {
    assert.deepEqual(document.completion, { state: "unknown", basis: "legacy" });
    assert.equal(document.execution, undefined);
    assert.equal(record.evidence.some(({ kind }) => kind === "run.lifecycle"), false);
  } else {
    assert.deepEqual(document.completion, {
      state: "ended", basis: "recorded", outcome: scenario.outcome, capture: scenario.capture,
    }, scenario.id);
    assert.equal(document.execution.status, scenario.outcome === "unknown" ? "incomplete" : scenario.outcome);
    const explained = explainExecutionDAG(document.execution, record.evidence);
    assert.equal(explained.ok, true, scenario.id);
    for (const node of document.execution.nodes) {
      assert.ok(node.evidence.length, `${scenario.id}: ${node.id} has no source evidence`);
      for (const ref of node.evidence) {
        assert.equal(record.evidence[ref.envelopeIndex]?.kind, ref.kind, scenario.id);
      }
    }
  }
  if (scenario.source === "agent") {
    const result = buildExecutionTrajectory(record.evidence);
    assert.equal(result.ok, true, scenario.id);
    assert.deepEqual(result.trajectory.completion, document.completion);
    assert.equal(new Set(result.trajectory.records.map(({ id }) => id)).size, result.trajectory.records.length);
    for (const row of result.trajectory.records) {
      assert.ok(row.evidence.length);
      for (const ref of row.evidence) assert.equal(record.evidence[ref.envelopeIndex]?.kind, ref.kind);
    }
  }
  assert.equal(JSON.stringify(record), before, `${scenario.id}: projection mutated the record`);
  console.log(`OK: ${scenario.id} — capture/transport accepted; ${assessment.findings.length} display finding(s)`);
}

const loop = assessRecorderCase(recorderMatrix.find(({ id }) => id === "graph-step-limit"));
assert.deepEqual(loop.callbackVisits, [["retry"], ["retry"], ["retry"]]);
const loopDocument = projectEinoViewerDocument(loadRecorderMatrixRecord("graph-step-limit")).document;
assert.equal(loopDocument.execution.nodes.filter(({ correlation }) => correlation.entityId?.endsWith("node:retry")).length, 3);

for (const id of ["agent-direct-answer", "agent-cancelled"]) {
  const record = loadRecorderMatrixRecord(id);
  assert.equal(record.evidence.some(({ kind, payload }) => kind === "component.io" && payload.component === "Tool"), false);
}
const recoveredText = JSON.stringify(loadRecorderMatrixRecord("agent-tool-recovered"));
assert.ok(recoveredText.includes("quote provider unavailable"));
assert.ok(recoveredText.includes("缓存报价 120 元"));
const redactedText = JSON.stringify(loadRecorderMatrixRecord("agent-redacted-tool"));
assert.ok(redactedText.includes("[REDACTED]"));
assert.equal(redactedText.includes("private@example.test"), false);

const failed = assessRecorderCase(recorderMatrix.find(({ id }) => id === "workflow-failed-successor"));
assert.deepEqual(failed.workflowOutcomes, [{ path: ["fail"], status: "failed" }, { path: ["prepare"], status: "success" }]);
assert.equal(failed.workflowOutcomes.some(({ path }) => path.includes("after")), false);
const failedProjection = projectEinoViewerDocument(loadRecorderMatrixRecord("workflow-failed-successor")).document;
for (const { path } of failed.workflowOutcomes) {
  assert.equal(failedProjection.execution.nodes.filter(({ metadata }) => JSON.stringify(metadata.sourceNodePath) === JSON.stringify(path)).length, 1);
}

const nestedRecord = loadRecorderMatrixRecord("workflow-nested-names");
const nested = projectEinoViewerDocument(nestedRecord).document.execution;
for (const path of [["left", "shared"], ["right", "shared"]]) {
  const node = nested.nodes.find(({ metadata }) => JSON.stringify(metadata.sourceNodePath) === JSON.stringify(path));
  assert.ok(node, path.join("/"));
  const io = node.evidence.map(({ envelopeIndex }) => nestedRecord.evidence[envelopeIndex]).filter(({ kind }) => kind === "component.io");
  assert.equal(io.length, 2);
  assert.ok(io.every(({ payload }) => JSON.stringify(payload.nodePath) === JSON.stringify(path)));
}

// Mutation tests for the assessment itself, not repaired fixtures or product
// acceptance. Damaged copies must not evade the gate by dropping evidence/nodes
// or fixing only one view. The original records and projectors stay untouched.
{
  const scenario = recorderMatrix.find(({ id }) => id === "workflow-failed-successor");
  const record = loadRecorderMatrixRecord(scenario.id);
  const document = structuredClone(failedProjection);
  document.execution.nodes = document.execution.nodes.filter(({ metadata }) => metadata.sourceNodePath?.[0] !== "after");
  for (const node of document.execution.nodes) node.status = failed.workflowOutcomes.find(({ path }) => JSON.stringify(path) === JSON.stringify(node.metadata.sourceNodePath)).status;
  assert.equal(findRecorderDisplayIssues(scenario, record, document).length, 0);
  const missing = structuredClone(document);
  missing.execution.nodes = missing.execution.nodes.filter(({ metadata }) => metadata.sourceNodePath[0] !== "fail");
  assert.ok(findRecorderDisplayIssues(scenario, record, missing).some(({ code }) => code === "workflow.executed_step_missing_or_duplicated"));
  const unlinked = structuredClone(document);
  unlinked.execution.nodes[0].evidence = [];
  assert.ok(findRecorderDisplayIssues(scenario, record, unlinked).some(({ code }) => code === "workflow.execution_evidence_missing"));
  const anonymous = structuredClone(document);
  delete anonymous.execution.nodes[0].metadata.sourceNodePath;
  assert.ok(findRecorderDisplayIssues(scenario, record, anonymous).some(({ code }) => code === "workflow.source_path_missing"));

  const noDependencies = structuredClone(document);
  noDependencies.execution.edges = [];
  assert.ok(findRecorderDisplayIssues(scenario, record, noDependencies).some(({ code }) => code === "workflow.dependency_missing_or_duplicated"));
  const reversed = structuredClone(document);
  for (const edge of reversed.execution.edges) [edge.from, edge.to] = [edge.to, edge.from];
  const reversedIssues = findRecorderDisplayIssues(scenario, record, reversed);
  assert.ok(reversedIssues.some(({ code }) => code === "workflow.dependency_missing_or_duplicated"));
  assert.ok(reversedIssues.some(({ code }) => code === "workflow.unverified_dependency"));
  const fabricated = structuredClone(document);
  const failId = fabricated.execution.nodes.find(({ metadata }) => metadata.sourceNodePath[0] === "fail").id;
  fabricated.execution.edges.push({ id: "invented-self-dependency", from: failId, to: failId, kind: "control" });
  assert.ok(findRecorderDisplayIssues(scenario, record, fabricated).some(({ code }) => code === "workflow.unverified_dependency"));
  const dangling = structuredClone(document);
  dangling.execution.edges.push({ id: "invented-endpoint", from: failId, to: "not-an-execution-node", kind: "data" });
  assert.ok(findRecorderDisplayIssues(scenario, record, dangling).some(({ code }) => code === "workflow.unverified_dependency"));
  const duplicated = structuredClone(document);
  duplicated.execution.edges.push({ ...duplicated.execution.edges[0], id: "duplicated-dependency" });
  assert.ok(findRecorderDisplayIssues(scenario, record, duplicated).some(({ code }) => code === "workflow.dependency_missing_or_duplicated"));
  const wrongKind = structuredClone(document);
  wrongKind.execution.edges[0].kind = "control";
  assert.ok(findRecorderDisplayIssues(scenario, record, wrongKind).some(({ code }) => code === "workflow.unverified_dependency"));

  // Generated IDs and arrival/array order are not evidence of causality.
  const renamed = structuredClone(document);
  const ids = new Map(renamed.execution.nodes.map((node, index) => [node.id, `opaque-node-${index}`]));
  for (const node of renamed.execution.nodes) node.id = ids.get(node.id);
  renamed.execution.nodes.reverse();
  for (const edge of renamed.execution.edges) {
    edge.from = ids.get(edge.from);
    edge.to = ids.get(edge.to);
  }
  assert.deepEqual(findRecorderDisplayIssues(scenario, record, renamed), []);

  const controlRecord = structuredClone(record);
  const sourceEdge = controlRecord.evidence.find(({ kind }) => kind === "workflow.snapshot").payload.workflow.edges
    .find(({ from, to }) => from === "prepare" && to === "fail");
  sourceEdge.channels = ["control"];
  const controlDocument = projectEinoViewerDocument(controlRecord).document;
  assert.deepEqual(findRecorderDisplayIssues(scenario, controlRecord, controlDocument), []);
  assert.equal(controlDocument.execution.edges[0].kind, "control");
}
{
  const scenario = recorderMatrix.find(({ id }) => id === "workflow-nested-names");
  const document = structuredClone(projectEinoViewerDocument(nestedRecord).document);
  const findPath = (path) => document.execution.nodes.find(({ metadata }) => JSON.stringify(metadata.sourceNodePath) === JSON.stringify(path)).id;
  // A declared left → right parent dependency does not authorize an edge
  // between equally named children, even if their actual callbacks are ordered.
  document.execution.edges.push({
    id: "invented-child-dependency", from: findPath(["left", "shared"]), to: findPath(["right", "shared"]), kind: "data",
  });
  assert.ok(findRecorderDisplayIssues(scenario, nestedRecord, document).some(({ code }) => code === "workflow.unverified_dependency"));
}
for (const [id, invalidStatus, code] of [
  ["agent-cancelled", "failed", "agent.cancel_misattributed_to_unexecuted_tool"],
  ["agent-tool-interrupted", "running", "agent.unsettled_step_after_end"],
]) {
  const scenario = recorderMatrix.find((entry) => entry.id === id);
  const record = loadRecorderMatrixRecord(id);
  for (const wrongView of ["path", "trajectory", "both"]) {
    const document = structuredClone(projectEinoViewerDocument(record).document);
    const trajectory = structuredClone(buildExecutionTrajectory(record.evidence).trajectory);
    for (const node of document.execution.nodes.filter(({ kind }) => kind === "tool")) node.status = wrongView === "trajectory" ? "incomplete" : invalidStatus;
    for (const row of trajectory.records.filter(({ kind }) => kind === "tool")) row.status = wrongView === "path" ? "incomplete" : invalidStatus;
    const issues = findRecorderDisplayIssues(scenario, record, document, trajectory).filter((issue) => issue.code === code);
    assert.equal(issues.length, 1, `${id}: count the source defect once`);
    assert.deepEqual(issues[0].affectedViews, wrongView === "both" ? ["path", "trajectory"] : [wrongView]);
  }
  const document = structuredClone(projectEinoViewerDocument(record).document);
  const trajectory = structuredClone(buildExecutionTrajectory(record.evidence).trajectory);
  document.execution.nodes = document.execution.nodes.filter(({ kind }) => kind !== "tool");
  trajectory.records = [];
  const issues = findRecorderDisplayIssues(scenario, record, document, trajectory);
  assert.ok(issues.some(({ code }) => code === (id === "agent-cancelled" ? "agent.tool_plan_missing" : "agent.executed_tool_missing")));
}

const ioCases = ["graph-io-structured", "graph-io-empty", "graph-io-null", "graph-io-long", "graph-io-oversized", "graph-io-redacted", "graph-io-failed", "graph-io-cancelled", "workflow-io-success", "workflow-io-failed"];
for (const id of ioCases) {
  const scenario = recorderMatrix.find((entry) => entry.id === id);
  assert.ok(scenario, `${id}: real I/O fixture must be registered, not silently skipped`);
  const record = loadRecorderMatrixRecord(id);
  const document = projectEinoViewerDocument(record).document;
  const summary = explainExecutionDAG(document.execution, record.evidence, { diagnostics: record.diagnostics }).explanation.run;
  assert.deepEqual(findRecorderSummaryIssues(scenario, record, summary), [], id);
  const roots = record.evidence.map((envelope, index) => ({ envelope, index }))
    .filter(({ envelope }) => envelope.kind === "component.io" && envelope.metadata?.io?.scope === "root");
  assert.ok(roots.some(({ envelope }) => envelope.payload.direction === "input"), `${id}: actual root input is required`);
  assert.equal(roots.some(({ envelope }) => envelope.payload.direction === "output"), scenario.outcome === "success", id);
  for (const { envelope, index } of roots) {
    const direction = envelope.payload.direction;
    const items = summary[direction].items;
    const item = items.find(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(index));
    assert.ok(item, `${id}: missing root ${direction} summary`);
    assert.equal(Object.hasOwn(item, "value"), Object.hasOwn(envelope.payload, "body"));
    assert.deepEqual(item.value, envelope.payload.body);
    // A damaged copied projection must not pass by dropping a value, moving it
    // to another source, or duplicating an otherwise correct root item.
    const missing = structuredClone(summary);
    missing[direction].items = missing[direction].items.filter((entry) => !entry.evidenceEnvelopeIndexes.includes(index));
    assert.ok(findRecorderSummaryIssues(scenario, record, missing).some(({ code }) => code === "summary.root_io_missing_or_duplicated"));
    const changed = structuredClone(summary);
    changed[direction].items.find((entry) => entry.evidenceEnvelopeIndexes.includes(index)).value = { invented: true };
    assert.ok(findRecorderSummaryIssues(scenario, record, changed).some(({ code }) => code === "summary.root_value_mismatch"));
    const duplicated = structuredClone(summary);
    duplicated[direction].items.push(structuredClone(item));
    assert.ok(findRecorderSummaryIssues(scenario, record, duplicated).some(({ code }) => code === "summary.root_io_missing_or_duplicated"));
    const mislabeled = structuredClone(summary);
    mislabeled[direction].items.find((entry) => entry.evidenceEnvelopeIndexes.includes(index)).availability = item.availability === "available" ? "not-observed" : "available";
    assert.ok(findRecorderSummaryIssues(scenario, record, mislabeled).some(({ code }) => code === "summary.root_availability_mismatch"));
    const wrongChannel = structuredClone(summary);
    wrongChannel[direction].availability = summary[direction].availability === "available" ? "not-observed" : "available";
    assert.ok(findRecorderSummaryIssues(scenario, record, wrongChannel).some(({ code }) => code === "summary.channel_availability_mismatch"));
    if (envelope.metadata.capture.status === "omitted") {
      const unexplained = structuredClone(summary);
      delete unexplained[direction].items.find((entry) => entry.evidenceEnvelopeIndexes.includes(index)).reason;
      assert.ok(findRecorderSummaryIssues(scenario, record, unexplained).some(({ code }) => code === "summary.root_omission_reason_missing"));
    }
  }
  const wrongCapture = structuredClone(summary);
  wrongCapture.capture.status = summary.capture.status === "partial" ? "complete" : "partial";
  assert.ok(findRecorderSummaryIssues(scenario, record, wrongCapture).some(({ code }) => code === "summary.capture_mismatch"));
  if (scenario.source === "graph") {
    const index = record.evidence.findIndex(({ kind, metadata }) => kind === "component.io" && metadata?.io?.scope === "node");
    const owner = document.execution.nodes.find((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
    assert.ok(owner, `${id}: the actual node I/O must have an owner`);
    const missing = structuredClone(document);
    missing.execution.nodes.find(({ id }) => id === owner.id).evidence = owner.evidence.filter(({ envelopeIndex }) => envelopeIndex !== index);
    assert.ok(findRecorderDisplayIssues(scenario, record, missing).some(({ code }) => code === "graph.io_step_missing_or_duplicated"));
    const unbound = structuredClone(document);
    unbound.execution.nodes.find(({ id }) => id === owner.id).evidence = owner.evidence.filter(({ kind }) => kind !== "callback.event");
    assert.ok(findRecorderDisplayIssues(scenario, record, unbound).some(({ code }) => code === "graph.io_callback_mismatch"));
  }
}
for (const [id, value, availability] of [["graph-io-empty", "", "empty"], ["graph-io-null", null, "null"]]) {
  const record = loadRecorderMatrixRecord(id);
  const document = projectEinoViewerDocument(record).document;
  const summary = explainExecutionDAG(document.execution, record.evidence).explanation.run;
  for (const direction of ["input", "output"]) {
    assert.equal(summary[direction].availability, "available");
    assert.equal(summary[direction].items[0].value, value);
    assert.equal(summary[direction].items[0].availability, availability);
  }
}
{
  const record = loadRecorderMatrixRecord("graph-io-oversized");
  const omitted = record.evidence.filter(({ metadata }) => metadata?.capture?.reason === "size_limit");
  assert.equal(omitted.length, 2, "the real node and root oversized outputs are both marked omitted");
  assert.ok(omitted.every(({ payload }) => !Object.hasOwn(payload, "body")));
  const scenario = recorderMatrix.find(({ id }) => id === "graph-io-oversized");
  assert.equal(assessRecorderCase(scenario).completion.capture, "partial");
}
{
  const serialized = JSON.stringify(loadRecorderMatrixRecord("graph-io-redacted"));
  assert.ok(serialized.includes("[REDACTED]"));
  assert.equal(serialized.includes("NEVER_EXPORT_PRIVATE_TOKEN"), false, "root, node, metadata, and diagnostics must all remain redacted");
  const scenario = recorderMatrix.find(({ id }) => id === "graph-step-limit");
  const record = loadRecorderMatrixRecord(scenario.id);
  const document = projectEinoViewerDocument(record).document;
  const summary = structuredClone(explainExecutionDAG(document.execution, record.evidence).explanation.run);
  summary.output = { availability: "available", items: [{ label: "Invented final value", value: "not captured", availability: "available", evidenceEnvelopeIndexes: [1] }] };
  const issues = findRecorderSummaryIssues(scenario, record, summary);
  assert.ok(issues.some(({ code }) => code === "summary.unverified_root_value"));
  assert.ok(issues.some(({ code }) => code === "summary.unrecorded_root_claimed"));
}
{
  // Derived declaration-only robustness coverage, not an additional real run.
  const record = loadRecorderMatrixRecord("graph-step-limit");
  record.evidence = record.evidence.filter(({ kind }) => kind === "compose.graph");
  const assessment = assessRecorderCase({ id: "derived-graph-definition-only", source: "graph", definitionOnly: true }, record);
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.runStatus, "definition-only");
  assert.equal(assessment.summaryState, "definition-only");
  assert.deepEqual(assessment.findings, []);
}
{
  const scenario = recorderMatrix.find(({ id }) => id === "agent-nested-parallel-scopes");
  const record = loadRecorderMatrixRecord(scenario.id);
  const document = projectEinoViewerDocument(record).document;
  const trajectory = buildExecutionTrajectory(record.evidence).trajectory;
  const innerInputs = record.evidence.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === "component.io"
    && entry.payload.component === "Tool" && entry.payload.direction === "input" && entry.payload.address.at(-1)?.subId === "shared-inner-call");
  assert.equal(innerInputs.length, 2, "the real child scopes legally reuse the same inner tool call ID");
  assert.notDeepEqual(innerInputs[0].entry.payload.address, innerInputs[1].entry.payload.address);
  for (const wrongView of ["path", "trajectory"]) {
    const badDocument = structuredClone(document), badTrajectory = structuredClone(trajectory);
    const items = wrongView === "path" ? badDocument.execution.nodes : badTrajectory.records;
    const owner = items.find((item) => item.kind === "tool" && item.evidence.some(({ envelopeIndex }) => envelopeIndex === innerInputs[0].index));
    const foreign = items.find((item) => item.kind === "tool" && item.evidence.some(({ envelopeIndex }) => envelopeIndex === innerInputs[1].index));
    owner.evidence.push(foreign.evidence.find(({ envelopeIndex }) => envelopeIndex === innerInputs[1].index));
    const findings = findRecorderDisplayIssues(scenario, record, badDocument, badTrajectory);
    assert.ok(findings.some(({ code, affectedViews }) => code === "agent.scoped_tool_crossed" && affectedViews.includes(wrongView)));
    assert.ok(findings.some(({ code }) => code === "agent.scoped_tool_missing_or_duplicated"));
  }
  const summary = explainExecutionDAG(document.execution, record.evidence).explanation.run;
  const childAnswer = record.evidence.find(({ kind, payload }) => kind === "agent.event" && payload.runPath?.length === 2 && payload.output?.message?.value?.content?.startsWith("child result:"));
  const wrongAnswer = structuredClone(summary);
  wrongAnswer.output.items[0].value = childAnswer.payload.output.message.value.content;
  wrongAnswer.output.items[0].evidenceEnvelopeIndexes = [record.evidence.indexOf(childAnswer)];
  assert.ok(findRecorderSummaryIssues(scenario, record, wrongAnswer).some(({ code }) => code === "agent.root_answer_mismatch"));
  assert.ok(findRecorderSummaryIssues(scenario, record, wrongAnswer).some(({ code }) => code === "agent.root_answer_evidence_mismatch"));
}
{
  const scenario = recorderMatrix.find(({ id }) => id === "agent-nested-failure-recovered");
  const record = loadRecorderMatrixRecord(scenario.id);
  const document = projectEinoViewerDocument(record).document;
  const summary = explainExecutionDAG(document.execution, record.evidence).explanation.run;
  assert.equal(summary.result.state, "success");
  const local = summary.issues.find(({ message }) => message === "lookup rejected: failure");
  assert.equal(document.execution.nodes.find(({ id }) => id === local.nodeId).status, "failed");
  assert.equal(local.recovered, false, "child remains failed; the successful parent does not rewrite child history");
  const omitted = structuredClone(summary);
  omitted.issues = [];
  assert.ok(findRecorderSummaryIssues(scenario, record, omitted).some(({ code }) => code === "agent.nested_error_missing"));
  const rewritten = structuredClone(summary);
  rewritten.issues[0].recovered = true;
  assert.ok(findRecorderSummaryIssues(scenario, record, rewritten).some(({ code }) => code === "agent.nested_error_recovery_mismatch"));
}
console.log("OK: scoped invocation identity, root/child answers and parent-success/child-failure mutation gates passed.");
for (const id of ["agent-deep-nested-distinct-results", "agent-deep-nested-failure-recovered"]) {
  const scenario = recorderMatrix.find((entry) => entry.id === id);
  assert.equal(scenario?.agentDepth, 3, `${id}: the new real three-level run must be registered`);
  const record = loadRecorderMatrixRecord(id);
  const before = JSON.stringify(record);
  const document = projectEinoViewerDocument(record).document;
  const explanation = explainExecutionDAG(document.execution, record.evidence).explanation;
  const inputs = record.evidence.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === "component.io"
    && entry.payload.component === "Tool" && entry.payload.direction === "input");
  assert.equal(inputs.length, 3);
  assert.equal(new Set(inputs.map(({ entry }) => JSON.stringify(entry.payload.address))).size, 3);
  assert.deepEqual(inputs.map(({ entry }) => entry.payload.address.at(-1).subId), Array(3).fill("shared-depth-call"));
  assert.deepEqual(inputs.map(({ entry }) => entry.payload.address.filter(({ type }) => type === "agent").map(({ id }) => id)),
    [["coordinator"], ["coordinator", "worker"], ["coordinator", "worker", "worker"]]);
  const owners = inputs.map(({ index }) => document.execution.nodes.find((node) => node.kind === "tool" && node.evidence.some(({ envelopeIndex }) => envelopeIndex === index)));
  assert.equal(new Set(owners.map(({ id }) => id)).size, 3, "reused IDs across levels must not collapse actual invocations");
  const groups = explanation.groups.filter(({ kind }) => kind === "agent");
  assert.equal(groups.length, 3);
  const root = groups.find(({ parentId }) => !parentId);
  const middle = groups.find(({ parentId }) => parentId === root.id);
  const leaf = groups.find(({ parentId }) => parentId === middle.id);
  assert.ok(leaf && leaf.id !== middle.id && leaf.label === middle.label, "same-name groups keep separate source identities and parent links");
  for (let depth = 0; depth < 3; depth++) {
    const group = [root, middle, leaf][depth];
    assert.ok(group.nodeIds.includes(owners[depth].id));
    for (const foreign of owners.filter((_, index) => index !== depth)) assert.equal(group.nodeIds.includes(foreign.id), false);
  }
  const finalEvents = record.evidence.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === "agent.event"
    && entry.payload.output?.message?.value?.role === "assistant" && !entry.payload.output.message.value.tool_calls?.length);
  assert.deepEqual(finalEvents.filter(({ entry }) => entry.payload.runPath.length === 1).map(({ entry }) => entry.payload.output.message.value.content), [scenario.finalAnswer]);
  const expectedLocalAnswers = id.endsWith("distinct-results")
    ? ["middle result: reviewed single", "leaf result: verified single"] : ["middle result: recovered with local fallback"];
  assert.deepEqual(finalEvents.filter(({ entry }) => entry.payload.runPath.length > 1).map(({ entry }) => entry.payload.output.message.value.content).sort(), expectedLocalAnswers.sort());
  for (const answer of finalEvents.filter(({ entry }) => entry.payload.runPath.length > 1)) {
    const crossed = structuredClone(explanation.run);
    crossed.output.items[0].value = answer.entry.payload.output.message.value.content;
    crossed.output.items[0].evidenceEnvelopeIndexes = [answer.index];
    const issues = findRecorderSummaryIssues(scenario, record, crossed);
    assert.ok(issues.some(({ code }) => code === "agent.root_answer_mismatch"));
    assert.ok(issues.some(({ code }) => code === "agent.root_answer_evidence_mismatch"));
  }
  if (id.endsWith("failure-recovered")) {
    const errors = record.evidence.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === "callback.event" && entry.payload.phase === "error");
    assert.equal(errors.length, 2, "both original leaf failure and its AgentTool propagation remain recorded");
    for (const { entry, index } of errors) {
      const depth = entry.payload.address.filter(({ type }) => type === "agent").length;
      const issue = explanation.run.issues.find(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(index));
      const owner = document.execution.nodes.find(({ id }) => id === issue.nodeId);
      assert.equal(issue.recovered, depth === 2, "only the middle layer has an observed handled tool result");
      assert.equal(owner.status, depth === 2 ? "success" : "failed");
      const changed = structuredClone(explanation.run);
      changed.issues.find(({ nodeId }) => nodeId === issue.nodeId).recovered = !issue.recovered;
      assert.ok(findRecorderSummaryIssues(scenario, record, changed).some(({ code }) => code === "agent.nested_error_recovery_mismatch"));
      const omitted = structuredClone(explanation.run);
      omitted.issues = omitted.issues.filter(({ nodeId }) => nodeId !== issue.nodeId);
      assert.ok(findRecorderSummaryIssues(scenario, record, omitted).some(({ code }) => code === "agent.nested_error_missing"));
    }
    // An identically named tool result at the parent's path cannot prove the
    // middle invocation recovered, even though all levels reuse the same ID.
    const moved = structuredClone(record);
    const handled = moved.evidence.find(({ kind, payload }) => kind === "agent.event" && payload.output?.message?.value?.content === "handled leaf failure: deep lookup rejected: failure");
    handled.payload.runPath = ["coordinator"];
    assert.ok(findRecorderSummaryIssues(scenario, moved, explanation.run).some(({ code }) => code === "agent.nested_error_recovery_mismatch"));
    const wrongID = structuredClone(record);
    wrongID.evidence.find(({ kind, payload }) => kind === "agent.event" && payload.output?.message?.value?.content === "handled leaf failure: deep lookup rejected: failure")
      .payload.output.message.value.tool_call_id = "another-call";
    assert.ok(findRecorderSummaryIssues(scenario, wrongID, explanation.run).some(({ code }) => code === "agent.nested_error_recovery_mismatch"));
    const ambiguous = structuredClone(record);
    const secondAddress = structuredClone(inputs[1].entry);
    secondAddress.payload.address.find(({ type }) => type === "tool").subId = "another-outer-call";
    ambiguous.evidence.push(secondAddress);
    assert.ok(findRecorderSummaryIssues(scenario, ambiguous, explanation.run).some(({ code }) => code === "agent.nested_error_recovery_mismatch"),
      "a name-only result cannot establish recovery if another same-path invocation is possible");
    const misplaced = structuredClone(record);
    const handledIndex = misplaced.evidence.findIndex(({ kind, payload }) => kind === "agent.event" && payload.output?.message?.value?.content === "handled leaf failure: deep lookup rejected: failure");
    const earlierModelIndex = misplaced.evidence.findIndex(({ kind, payload }) => kind === "component.io" && payload.component === "ChatModel" && payload.direction === "output");
    [misplaced.evidence[handledIndex], misplaced.evidence[earlierModelIndex]] = [misplaced.evidence[earlierModelIndex], misplaced.evidence[handledIndex]];
    assert.ok(findRecorderSummaryIssues(scenario, misplaced, explanation.run).some(({ code }) => code === "agent.nested_error_recovery_mismatch"),
      "an earlier result cannot recover a later error");
    // Step output may expose the recorded execution error; it is not a final
    // Agent answer or a successful tool return.
    const leafOutput = explanation.nodes.find(({ id }) => id === owners[2].id).output;
    assert.ok(leafOutput.items.length > 0);
    assert.ok(leafOutput.items.every(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.every((index) => record.evidence[index].kind === "callback.event"
      && record.evidence[index].payload.phase === "error")));
    const originalErrorIndex = errors.find(({ entry }) => entry.payload.address.filter(({ type }) => type === "agent").length === 3).index;
    for (const viewName of ["path", "trajectory"]) {
      const badDocument = structuredClone(document);
      const badTrajectory = structuredClone(buildExecutionTrajectory(record.evidence).trajectory);
      const items = viewName === "path" ? badDocument.execution.nodes : badTrajectory.records;
      const local = items.find((item) => item.kind === "tool" && item.evidence.some(({ envelopeIndex }) => envelopeIndex === originalErrorIndex));
      const ancestor = items.find((item) => item.kind === "tool" && item.evidence.some(({ envelopeIndex }) => envelopeIndex === inputs[0].index));
      const reference = local.evidence.find(({ envelopeIndex }) => envelopeIndex === originalErrorIndex);
      local.evidence = local.evidence.filter(({ envelopeIndex }) => envelopeIndex !== originalErrorIndex);
      assert.ok(findRecorderDisplayIssues(scenario, record, badDocument, badTrajectory).some(({ code, affectedViews }) => code === "agent.scoped_error_missing_or_duplicated" && affectedViews.includes(viewName)));
      ancestor.evidence.push(reference);
      assert.ok(findRecorderDisplayIssues(scenario, record, badDocument, badTrajectory).some(({ code, affectedViews }) => code === "agent.scoped_error_crossed" && affectedViews.includes(viewName)));
      ancestor.evidence = ancestor.evidence.filter(({ envelopeIndex }) => envelopeIndex !== originalErrorIndex);
      local.evidence.push(reference);
      local.status = "success";
      assert.ok(findRecorderDisplayIssues(scenario, record, badDocument, badTrajectory).some(({ code, affectedViews }) => code === "agent.failed_call_rewritten" && affectedViews.includes(viewName)));
    }
  }
  assert.equal(JSON.stringify(record), before);
}
console.log("OK: three-level same-name/reused-ID source scopes, distinct answers and exact local-recovery mutation gates passed.");

// These are capture-boundary variants of actual Recorder records, not new
// business-scenario fixtures. Source expectations are asserted independently of
// the production capture helper and then exercised against damaged projections.
function explainCaptureVariant(record, diagnostics = record.diagnostics) {
  const projection = projectEinoViewerDocument(record);
  assert.equal(projection.ok, true, JSON.stringify(projection.diagnostics));
  const explained = explainExecutionDAG(projection.document.execution, record.evidence, { diagnostics });
  assert.equal(explained.ok, true);
  return { document: projection.document, explanation: explained.explanation };
}

const captureVariants = [
  { name: "captured", capture: { status: "captured" }, availability: "available" },
  { name: "truncated", capture: { status: "captured", truncated: true }, availability: "truncated" },
  { name: "redacted", capture: { status: "captured", redacted: true }, availability: "redacted" },
  { name: "redacted-before-truncated", capture: { status: "captured", redacted: true, truncated: true }, availability: "redacted" },
  { name: "false-flags", capture: { status: "captured", redacted: false, truncated: false }, availability: "available" },
  { name: "non-boolean-flags", capture: { status: "captured", redacted: "true", truncated: 1 }, availability: "available" },
  { name: "omission-before-flags", capture: { status: "omitted", reason: "size_limit", redacted: true, truncated: true }, availability: "not-observed" },
];
for (const id of ["graph-io-structured", "workflow-io-success"]) {
  const scenario = recorderMatrix.find((entry) => entry.id === id);
  for (const variant of captureVariants) {
    const record = loadRecorderMatrixRecord(id);
    const outputIndexes = [];
    record.evidence.forEach((envelope, index) => {
      if (envelope.kind !== "component.io" || envelope.payload.direction !== "output") return;
      envelope.metadata = { ...envelope.metadata, capture: structuredClone(variant.capture) };
      if (variant.capture.status === "omitted") delete envelope.payload.body;
      outputIndexes.push(index);
    });
    const before = JSON.stringify(record);
    const { document, explanation } = explainCaptureVariant(record);
    const root = explanation.run.output.items[0];
    assert.equal(root.availability, variant.availability, `${id}/${variant.name}: root capture state`);
    assert.equal(Object.hasOwn(root, "value"), variant.availability !== "not-observed");
    assert.equal(root.reason, variant.capture.status === "omitted" ? variant.capture.reason : undefined);
    const channel = variant.availability === "truncated" ? "partial" : variant.availability;
    assert.equal(explanation.run.output.availability, channel, `${id}/${variant.name}: independent root-channel state`);
    assert.deepEqual(findRecorderSummaryIssues(scenario, record, explanation.run), [], `${id}/${variant.name}: truthful root capture`);
    assert.deepEqual(findRecorderStepIssues(scenario, record, document, explanation), [], `${id}/${variant.name}: truthful node capture`);

    const mislabeled = structuredClone(explanation);
    const wrongState = variant.availability === "available" ? "truncated" : "available";
    mislabeled.run.output.items[0].availability = wrongState;
    mislabeled.run.output.availability = wrongState === "truncated" ? "partial" : "available";
    for (const node of mislabeled.nodes) for (const item of node.output.items) {
      if (item.evidenceEnvelopeIndexes.some((index) => outputIndexes.includes(index))) item.availability = wrongState;
    }
    assert.ok(findRecorderSummaryIssues(scenario, record, mislabeled.run).some(({ code }) => code === "summary.root_availability_mismatch"), `${id}/${variant.name}: removed/invented capture flag must fail`);
    assert.ok(findRecorderStepIssues(scenario, record, document, mislabeled).some(({ code }) => code === "step.source_value_mismatch"));

    const moved = structuredClone(explanation);
    moved.run.output.items[0].evidenceEnvelopeIndexes = [0];
    const firstOutput = moved.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.some((index) => outputIndexes.includes(index)));
    firstOutput.evidenceEnvelopeIndexes = [0];
    assert.ok(findRecorderSummaryIssues(scenario, record, moved.run).some(({ code }) => code === "summary.root_io_missing_or_duplicated"));
    assert.ok(findRecorderStepIssues(scenario, record, document, moved).some(({ code }) => code === "step.source_value_missing_or_duplicated"));

    const wrongReason = structuredClone(explanation);
    wrongReason.run.output.items[0].reason = "unsupported_value";
    const changedItem = wrongReason.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.some((index) => outputIndexes.includes(index)));
    changedItem.reason = "unsupported_value";
    assert.ok(findRecorderSummaryIssues(scenario, record, wrongReason.run).some(({ code }) => code === "summary.root_omission_reason_missing"));
    assert.ok(findRecorderStepIssues(scenario, record, document, wrongReason).some(({ code }) => code === "step.source_capture_reason_mismatch"));
    assert.equal(JSON.stringify(record), before, "capture checks never repair or rewrite Recorder evidence");
  }
}

{
  const scenario = recorderMatrix.find(({ id }) => id === "graph-io-failed");
  const notice = "[error details omitted by capture policy]";
  for (const variant of [...captureVariants, { name: "omitted-default-reason", capture: { status: "omitted" }, availability: "not-observed" }]) {
    const record = loadRecorderMatrixRecord(scenario.id);
    const errorIndexes = [];
    record.evidence.forEach((envelope, index) => {
      if (envelope.kind !== "callback.event" || envelope.payload.phase !== "error") return;
      envelope.metadata = { ...envelope.metadata, capture: structuredClone(variant.capture) };
      if (variant.capture.status === "omitted") envelope.payload.error.message = notice;
      errorIndexes.push(index);
    });
    const before = JSON.stringify(record);
    const { document, explanation } = explainCaptureVariant(record);
    const errors = explanation.nodes.flatMap((node) => node.output.items)
      .filter((item) => item.evidenceEnvelopeIndexes.some((index) => errorIndexes.includes(index)));
    assert.equal(errors.length, errorIndexes.length);
    for (const error of errors) {
      assert.equal(error.availability, variant.availability, `${variant.name}: callback error uses its own capture state`);
      assert.equal(Object.hasOwn(error, "value"), variant.availability !== "not-observed");
      assert.equal(error.reason, variant.capture.status === "omitted" ? variant.capture.reason || "not_captured" : undefined);
      if (variant.capture.status === "omitted") assert.equal(record.evidence[error.evidenceEnvelopeIndexes[0]].payload.error.message, notice, "the required Recorder notice stays in original evidence");
    }
    assert.deepEqual(findRecorderStepIssues(scenario, record, document, explanation), [], `${variant.name}: truthful callback error capture`);
    assert.deepEqual(findRecorderSummaryIssues(scenario, record, explanation.run), []);

    const mislabeled = structuredClone(explanation);
    const errorItem = mislabeled.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.includes(errorIndexes[0]));
    errorItem.availability = variant.availability === "available" ? "truncated" : "available";
    assert.ok(findRecorderStepIssues(scenario, record, document, mislabeled).some(({ code }) => code === "step.source_value_mismatch"), `${variant.name}: missing/invented callback error capture must fail`);

    const moved = structuredClone(explanation);
    moved.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.includes(errorIndexes[0])).evidenceEnvelopeIndexes = [0];
    assert.ok(findRecorderStepIssues(scenario, record, document, moved).some(({ code }) => code === "step.source_value_missing_or_duplicated"));

    const wrongReason = structuredClone(explanation);
    wrongReason.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.includes(errorIndexes[0])).reason = "unsupported_value";
    assert.ok(findRecorderStepIssues(scenario, record, document, wrongReason).some(({ code }) => code === "step.source_capture_reason_mismatch"));
    if (variant.capture.status === "omitted") {
      const leaked = structuredClone(explanation);
      leaked.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.includes(errorIndexes[0])).value = record.evidence[errorIndexes[0]].payload.error;
      assert.ok(findRecorderStepIssues(scenario, record, document, leaked).some(({ code }) => code === "step.source_value_mismatch"), "an omission notice cannot be restored as captured error content");
    }
    assert.equal(JSON.stringify(record), before);
  }
}

// RunRecord diagnostics do not assign relative pointers to one envelope. An
// explicit internal diagnostic index is allowed only in this helper-level
// comparison; the serialized fixture and its validated public shape stay intact.
for (const id of ["graph-io-structured", "workflow-io-success", "graph-io-failed"]) {
  const scenario = recorderMatrix.find((entry) => entry.id === id);
  const record = loadRecorderMatrixRecord(id);
  const error = id === "graph-io-failed";
  const index = record.evidence.findIndex((entry) => error
    ? entry.kind === "callback.event" && entry.payload.phase === "error"
    : entry.kind === "component.io" && entry.payload.direction === "output");
  const pointer = error ? "/payload/error" : "/payload/body";
  const diagnostics = [
    { envelopeIndex: index, path: pointer, applies: true },
    { envelopeIndex: index, path: `${pointer}/message`, applies: true },
    { path: pointer, applies: false },
    { envelopeIndex: index + 1, path: pointer, applies: false },
    { envelopeIndex: index, path: `${pointer}Code`, applies: false },
    { envelopeIndex: index, path: "/metadata", applies: false },
    { envelopeIndex: index, path: error ? "/payload/body" : "/payload/error", applies: false },
  ];
  for (const code of ["projection.redacted", "projection.truncated"]) for (const variant of diagnostics) {
    const { applies, ...location } = variant;
    const diagnostic = { ...location, severity: "warning", code, message: "Explicit source capture annotation" };
    const { document, explanation } = explainCaptureVariant(record, [diagnostic]);
    const oracleRecord = { ...record, diagnostics: [diagnostic] };
    const item = explanation.nodes.flatMap((node) => [...node.input.items, ...node.output.items]).find((entry) => entry.evidenceEnvelopeIndexes.includes(index));
    assert.equal(item.availability, applies ? code === "projection.redacted" ? "redacted" : "truncated" : "available", `${id}: ${JSON.stringify(diagnostic)}`);
    assert.deepEqual(findRecorderStepIssues(scenario, oracleRecord, document, explanation), []);
    assert.deepEqual(findRecorderSummaryIssues(scenario, oracleRecord, explanation.run), []);
    const tampered = structuredClone(explanation);
    const changed = tampered.nodes.flatMap((node) => [...node.input.items, ...node.output.items]).find((entry) => entry.evidenceEnvelopeIndexes.includes(index));
    changed.availability = applies ? "available" : "redacted";
    assert.ok(findRecorderStepIssues(scenario, oracleRecord, document, tampered).some(({ code }) => code === "step.source_value_mismatch"));
  }
}

{
  const scenario = recorderMatrix.find(({ id }) => id === "workflow-io-failed");
  for (const capture of [{ status: "captured", redacted: true }, { status: "captured", truncated: true }, { status: "omitted", reason: "size_limit" }]) {
    const record = loadRecorderMatrixRecord(scenario.id);
    const anchor = record.evidence.findIndex((entry) => entry.kind === "workflow.snapshot");
    record.evidence[anchor].metadata = { ...record.evidence[anchor].metadata, capture };
    const { document, explanation } = explainCaptureVariant(record);
    const errors = explanation.nodes.flatMap((node) => node.output.items).filter((item) => item.evidenceEnvelopeIndexes.includes(anchor));
    assert.ok(errors.length);
    for (const error of errors) assert.equal(error.availability, "available", "anchor-wide flags cannot assign capture state to a nested Workflow error");
    assert.deepEqual(findRecorderStepIssues(scenario, record, document, explanation), []);
    const tampered = structuredClone(explanation);
    tampered.nodes.flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.includes(anchor)).availability = "redacted";
    assert.ok(findRecorderStepIssues(scenario, record, document, tampered).some(({ code }) => code === "step.source_value_mismatch"));
  }
}
console.log("OK: independent source capture oracle checks strict flags, omissions, exact diagnostic paths and callback errors without polluting Workflow anchors.");
console.log("OK: real root/node I/O, null/empty, safe capture, and damaged-summary mutation gates passed.");
console.log(`OK: ${recorderMatrix.length} real Recorder fixtures passed capture/transport and known fidelity gates. Run npm run inspect:recorder-matrix for remaining limitations.`);
