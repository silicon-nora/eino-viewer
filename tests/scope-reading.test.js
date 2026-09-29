import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { explainExecutionDAG, explainWorkflowSnapshot, explainEino } from "../src/explanation.js";
import { buildScopeReading } from "../src/scope-reading.js";
import { createRunInspectionIndex } from "../src/inspection.js";

const directory = new URL("../fixtures/recorder-matrix/", import.meta.url);
const load = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, directory), "utf8"));
function prepare(input, locale = "en") {
  const projected = projectEinoViewerDocument(input);
  assert.equal(projected.ok, true, JSON.stringify(projected.diagnostics));
  const { document } = projected;
  const options = { locale, diagnostics: projected.diagnostics, envelopes: document.evidence };
  const explained = document.execution ? explainExecutionDAG(document.execution, document.evidence, options)
    : document.kind === "workflow" ? explainWorkflowSnapshot(document.definition, options) : explainEino(document.evidence, options);
  assert.equal(explained.ok, true);
  return { document, explanation: explained.explanation };
}
const scoped = ({ document, explanation }, options) => buildScopeReading(document, explanation, options);
const child = (model, part) => model.explanation.groups.find((group) => group.parentId && (!part || group.label.includes(part)));

// The original matrix plus any new real Recorder cases must preserve every
// canonical identity, edge, original body, outcome, and root result in both UIs.
let fixtures = 0;
for (const filename of readdirSync(directory).filter((name) => name.endsWith(".json") && name !== "manifest.json")) {
  const input = load(filename.slice(0, -5)), original = JSON.stringify(input);
  for (const locale of ["en", "zh"]) {
    const model = prepare(structuredClone(input), locale);
    const before = JSON.stringify(model);
    const inspection = createRunInspectionIndex(model.explanation, model.document.evidence);
    const all = scoped(model, { locale });
    assert.equal(all.execution, model.document.execution);
    assert.equal(all.input, model.explanation.run.input);
    assert.equal(all.output, model.explanation.run.output);
    assert.equal(all.result, model.explanation.run.result);
    assert.equal(all.boundary.total, 0);
    for (const group of model.explanation.groups) {
      const local = scoped(model, { groupId: group.id, locale });
      assert.equal(local.group, group);
      assert.equal(local.path.at(-1), group);
      assert.deepEqual(local.nodeIds, inspection.searchSteps("", { groupId: group.id, limit: 200 }).items.map(({ id }) => id));
      for (const node of local.execution?.nodes || []) assert.equal(node, model.document.execution.nodes.find(({ id }) => id === node.id));
      for (const edge of local.execution?.edges || []) {
        assert.equal(edge, model.document.execution.edges.find(({ id }) => id === edge.id));
        assert.ok(local.nodeIds.includes(edge.from) && local.nodeIds.includes(edge.to));
      }
      if (local.execution) {
        assert.equal(Object.hasOwn(local.execution, "completion"), false, "local diagram must not inherit whole-run completion");
        assert.equal(Object.hasOwn(local.execution, "status"), false);
        assert.equal(Object.hasOwn(local.execution, "startedAtMs"), false);
      }
      const expectedCrossing = (model.document.execution?.edges || []).filter(({ from, to }) => local.nodeIds.includes(from) !== local.nodeIds.includes(to));
      assert.equal(local.boundary.total, expectedCrossing.length);
      assert.deepEqual(new Set(local.boundary.edges), new Set(expectedCrossing));
      for (const channel of [local.input, local.output]) for (const item of channel.items) {
        for (const index of item.evidenceEnvelopeIndexes) {
          assert.ok(model.document.evidence[index], "every displayed local value refers to original evidence");
          assert.ok(local.evidenceEnvelopeIndexes.includes(index), "boundary values remain discoverable even when their caller node belongs to the parent");
        }
      }
    }
    const unassigned = scoped(model, { ungroupedOnly: true, locale });
    assert.deepEqual(unassigned.nodeIds, inspection.searchSteps("", { ungroupedOnly: true, limit: 200 }).items.map(({ id }) => id));
    assert.equal(unassigned.result.state, "unknown");
    assert.equal(unassigned.output.items.length, 0);
    assert.equal(JSON.stringify(model), before, `${filename}: read scope never mutates canonical data`);
  }
  assert.equal(JSON.stringify(input), original);
  fixtures++;
}
assert.ok(fixtures >= 26);
console.log(`OK: scope model preserves ${fixtures} real Recorder fixtures in both locales`);

{
  const model = prepare(load("agent-nested-parallel-scopes"));
  const slow = scoped(model, { groupId: child(model, "slow").id });
  const fast = scoped(model, { groupId: child(model, "fast").id });
  assert.deepEqual(slow.output.items.map(({ value }) => value), [{ response: "child result:slow" }]);
  assert.deepEqual(fast.output.items.map(({ value }) => value), [{ response: "child result:fast" }]);
  assert.deepEqual(slow.input.items[0].value, { argumentsJson: '{"request":"slow"}' });
  assert.equal(slow.nodeIds.some((id) => fast.nodeIds.includes(id)), false);
  assert.equal(slow.result.state, "success");
  assert.equal(fast.result.state, "success");
  assert.ok(slow.boundary.incoming.length > 0);
  assert.equal(slow.execution.nodes.some(({ metadata }) => metadata.agentScopeUnresolved), false);
  const unknown = scoped(model, { groupId: "not-recorded" });
  assert.equal(unknown.mode, "group");
  assert.deepEqual(unknown.nodeIds, []);
  assert.deepEqual(unknown.execution.nodes, []);
  assert.equal(unknown.output.items.length, 0, "an unknown scope cannot fall back to the overall result");
}

{
  const model = prepare(load("agent-deep-nested-distinct-results"));
  const middleGroup = model.explanation.groups.find(({ parentId }) => parentId === model.explanation.groups[0].id);
  const leafGroup = model.explanation.groups.find(({ parentId }) => parentId === middleGroup.id);
  const middle = scoped(model, { groupId: middleGroup.id });
  const leaf = scoped(model, { groupId: leafGroup.id });
  assert.equal(middle.group.label, leaf.group.label, "same name and tool ID do not identify the level");
  assert.equal(middle.output.items[0].value.response, "middle result: reviewed single");
  assert.equal(leaf.output.items[0].value.response, "leaf result: verified single");
  assert.equal(model.explanation.run.output.items[0].value, "parent final: accepted single");
  assert.equal(leaf.path.length, 3);
  assert.ok(leaf.nodeIds.every((id) => middle.nodeIds.includes(id)));
  assert.equal(middle.nodeIds.length > leaf.nodeIds.length, true);
  const failure = prepare(load("agent-deep-nested-failure-recovered"));
  const failureLeaf = failure.explanation.groups.find((group) => group.parentId && failure.explanation.groups.find(({ id }) => id === group.parentId)?.parentId);
  const failed = scoped(failure, { groupId: failureLeaf.id });
  assert.equal(failed.result.state, "failed");
  assert.equal(failed.output.items.length, 0, "a parent's error-handled reply is not a successful child return");
  assert.ok(failed.issues.some(({ recovered }) => recovered === false));
  assert.equal(failure.explanation.run.result.state, "success");
  const parent = scoped(failure, { groupId: failureLeaf.parentId });
  assert.equal(parent.output.items[0].value.response, "middle result: recovered with local fallback");
}

// Falsy values and source capture policies are not missing values.
for (const [value, capture, expected, reason] of [
  [0, {}, "available"], [null, {}, "null"], ["", {}, "empty"],
  [{ response: "[REDACTED]" }, { redacted: true }, "redacted"],
  ["prefix", { truncated: true }, "truncated"],
  [undefined, { status: "omitted", reason: "unsupported_value" }, "not-observed", "unsupported_value"],
]) {
  const input = load("agent-nested-distinct-results");
  const returned = input.evidence.find(({ kind, payload }) => kind === "component.io" && payload.direction === "output" && payload.component === "Tool" && payload.address.at(-1).subId === "call-child-one");
  if (value === undefined) delete returned.payload.body; else returned.payload.body = value;
  returned.metadata = { ...returned.metadata, capture: { status: "captured", ...capture } };
  const model = prepare(input), local = scoped(model, { groupId: child(model).id });
  assert.equal(local.output.items[0].availability, expected);
  assert.equal(local.output.items[0].reason, reason);
  assert.equal(Object.hasOwn(local.output.items[0], "value"), value !== undefined && capture.status !== "omitted");
  if (Object.hasOwn(local.output.items[0], "value")) assert.deepEqual(local.output.items[0].value, value);
}

{
  const record = load("agent-nested-distinct-results");
  const noInput = structuredClone(record);
  noInput.evidence = noInput.evidence.filter(({ kind, payload }) => !(kind === "component.io" && payload.component === "Tool" && payload.direction === "input" && payload.address.at(-1).subId === "call-child-one"));
  const partial = prepare(noInput), outputOnly = scoped(partial, { groupId: child(partial).id });
  assert.equal(outputOnly.input.availability, "not-observed");
  assert.equal(outputOnly.output.items[0].value.response, "child result:single", "exact invocation-address output is usable even without an input body");
  const missing = structuredClone(record);
  missing.evidence = missing.evidence.filter(({ kind, payload }) => !(kind === "component.io" && payload.component === "Tool" && payload.direction === "output" && payload.address.at(-1).subId === "call-child-one"));
  const noReturn = prepare(missing), local = scoped(noReturn, { groupId: child(noReturn).id });
  assert.equal(local.result.state, "unknown");
  assert.equal(local.output.items.length, 0, "the last model response and name-only Agent event never substitute for a missing explicit return");
  const noAddress = structuredClone(record);
  const returnWithoutAddress = noAddress.evidence.find(({ kind, payload }) => kind === "component.io" && payload.component === "Tool" && payload.direction === "output" && payload.address.at(-1).subId === "call-child-one");
  returnWithoutAddress.payload.address = [];
  const anonymous = prepare(noAddress);
  assert.equal(scoped(anonymous, { groupId: child(anonymous).id }).output.items.length, 0);
  const badEvent = structuredClone(record);
  badEvent.evidence.find(({ kind, payload }) => kind === "component.io" && payload.component === "Tool" && payload.direction === "output" && payload.address.at(-1).subId === "call-child-one").correlation.eventId = "unrecorded-callback";
  const unknownEvent = prepare(badEvent);
  assert.equal(scoped(unknownEvent, { groupId: child(unknownEvent).id }).output.items.length, 0, "an explicit unresolved callback ID cannot be rescued by its matching address");
}

{
  const original = prepare(load("agent-nested-parallel-scopes"));
  const selected = child(original, "slow");
  const changed = structuredClone(original);
  const returning = changed.document.evidence.find(({ kind, payload }) => kind === "component.io" && payload.direction === "output" && payload.component === "Tool" && payload.address.at(-1).subId === "call-child-slow");
  returning.correlation.runId = "a-foreign-run";
  const result = scoped(changed, { groupId: selected.id });
  assert.equal(result.output.items.length, 0, "defensive checks do not import a matching address from a foreign run");
  const foreignIndex = changed.document.evidence.indexOf(returning);
  assert.equal(result.evidenceEnvelopeIndexes.includes(foreignIndex), false);
  const ambiguous = structuredClone(original);
  const duplicated = structuredClone(ambiguous.document.evidence.find(({ kind, payload }) => kind === "component.io" && payload.direction === "output" && payload.component === "Tool" && payload.address.at(-1).subId === "call-child-slow"));
  duplicated.payload.body = { response: "unproven second result" };
  ambiguous.document.evidence.push(duplicated);
  assert.equal(scoped(ambiguous, { groupId: selected.id }).output.items.length, 0, "reused invocation identity never chooses whichever return came last");
  const mismatched = structuredClone(original);
  mismatched.document.evidence.find(({ kind, payload }) => kind === "component.io" && payload.direction === "output" && payload.component === "Tool" && payload.address.at(-1).subId === "call-child-slow").correlation.invocationId = "contradictory";
  assert.equal(scoped(mismatched, { groupId: selected.id }).output.items.length, 0);
}

{
  const model = prepare(load("workflow-nested-names"));
  const left = child(model, "left"), right = child(model, "right");
  assert.equal(scoped(model, { groupId: left.id }).output.items[0].value, "request/left");
  assert.equal(scoped(model, { groupId: right.id }).output.items[0].value, "request/left/right");
  const record = load("workflow-nested-names");
  record.evidence = record.evidence.filter(({ kind, payload }) => !(kind === "component.io" && payload.component === "Workflow"));
  const missingBoundary = prepare(record);
  const missing = scoped(missingBoundary, { groupId: child(missingBoundary, "left").id });
  assert.equal(missing.output.items.length, 0, "a nested Lambda output is not its enclosing Workflow's boundary result");
  assert.equal(missing.result.state, "unknown");
  const definition = load("workflow-nested-names").evidence[0];
  delete definition.payload.execution;
  const declared = prepare(definition);
  const local = scoped(declared, { groupId: child(declared, "left").id });
  assert.equal(local.execution, undefined);
  assert.equal(local.result.state, "definition-only");
  assert.equal(local.definitionSnapshot.execution, undefined);
  assert.equal(local.definitionSnapshot.workflow, declared.document.definition.workflow.nodes[0].workflow);
  assert.deepEqual(local.definitionPathPrefix, ["left"]);
  assert.deepEqual(local.nodeIds, ["left/shared"]);
  assert.deepEqual(local.definitionSnapshot.workflow.nodes.map(({ id }) => id), ["shared"]);
  const empty = scoped(declared, { ungroupedOnly: true });
  assert.equal(empty.definitionSnapshot, undefined);
  assert.equal(empty.execution, undefined);
}

{
  const model = prepare(load("graph-step-limit"));
  const group = model.explanation.groups[0];
  const local = scoped(model, { groupId: group.id });
  const visits = local.execution.nodes.filter(({ component }) => component === "Lambda");
  assert.ok(visits.length > 1);
  assert.equal(new Set(visits.map(({ id }) => id)).size, visits.length, "repeated Graph visits remain separate canonical identities");
  assert.deepEqual(visits, model.document.execution.nodes.filter(({ component }) => component === "Lambda"));
}
console.log("OK: exact nested call returns, uncertainty, falsy/capture semantics, crossing edges and declared subtrees");

// Root, node and local-call readers must agree about the same captured body.
for (const [name, capture, diagnosticPath, diagnosticCode, expected] of [
  ["metadata-only", { truncated: true }, undefined, undefined, "truncated"],
  ["diagnostic-only", {}, "/payload/body", "projection.truncated", "truncated"],
  ["both", { truncated: true }, "/payload/body/response", "projection.truncated", "truncated"],
  ["unrelated", {}, "/payload/name", "projection.truncated", "available"],
  ["similar-prefix", {}, "/payload/bodyName", "projection.redacted", "available"],
  ["redaction-first", { truncated: true }, "/payload/body", "projection.redacted", "redacted"],
]) {
  for (const id of ["graph-io-structured", "agent-nested-distinct-results"]) {
    const record = load(id);
    const indexes = record.evidence.flatMap((envelope, index) => envelope.kind === "component.io" ? [index] : []);
    for (const index of indexes) record.evidence[index].metadata = { ...record.evidence[index].metadata, capture: { status: "captured", ...capture } };
    const diagnostics = diagnosticPath ? indexes.map((envelopeIndex) => ({ envelopeIndex, path: diagnosticPath, code: diagnosticCode, severity: "warning", message: name })) : [];
    const original = JSON.stringify(record);
    const { document } = projectEinoViewerDocument(record);
    const result = explainExecutionDAG(document.execution, document.evidence, { diagnostics });
    assert.equal(result.ok, true);
    const explanation = result.explanation;
    const channels = id === "graph-io-structured" ? [explanation.run]
      : [buildScopeReading(document, explanation, { groupId: child({ explanation }).id })];
    for (const channelsSource of channels) for (const direction of ["input", "output"]) {
      assert.equal(channelsSource[direction].items.length, 1, `${id}/${name}/${direction}: expected a known boundary`);
      const item = channelsSource[direction].items[0];
      const sourceIndex = item.evidenceEnvelopeIndexes[0];
      assert.equal(item.availability, expected, `${id}/${name}/${direction}: boundary state`);
      assert.deepEqual(item.value, record.evidence[sourceIndex].payload.body);
      const peers = explanation.nodes.flatMap((node) => node[direction].items).filter((peer) => peer.evidenceEnvelopeIndexes.includes(sourceIndex));
      assert.ok(peers.length, `${id}/${name}/${direction}: step must retain the boundary source`);
      for (const peer of peers) {
        assert.equal(peer.availability, expected, `${id}/${name}/${direction}: same source, same state`);
        assert.deepEqual(peer.value, item.value);
      }
    }
    assert.equal(JSON.stringify(record), original, "capture presentation never changes original records");
  }
}
console.log("OK: root, step and local-call body flags agree for metadata and correctly scoped diagnostics");

{
  const record = load("graph-io-structured");
  // Recorder diagnostics carry a relative path but no source envelope index.
  // That legal wire format remains diagnostic context, not proof about a body.
  record.diagnostics = [{ severity: "warning", code: "projection.truncated", path: "/payload/body/answer", message: "A recorded answer was shortened." }];
  const original = JSON.stringify(record);
  const projected = projectEinoViewerDocument(record);
  assert.equal(projected.ok, true, "the browser contract uses valid saved-record diagnostics");
  const result = explainExecutionDAG(projected.document.execution, projected.document.evidence, { diagnostics: record.diagnostics });
  assert.equal(result.ok, true);
  for (const direction of ["input", "output"]) {
    const item = result.explanation.run[direction].items[0];
    assert.equal(item.availability, "available", "unscoped saved diagnostics cannot mark a specific root body");
    const index = item.evidenceEnvelopeIndexes[0];
    for (const peer of result.explanation.nodes.flatMap((node) => node[direction].items).filter((entry) => entry.evidenceEnvelopeIndexes.includes(index))) {
      assert.equal(peer.availability, "available", "step readers make the same source-identity decision");
    }
  }
  assert.equal(JSON.stringify(record), original);
}
console.log("OK: valid unscoped saved diagnostics never become invented per-body capture flags");
