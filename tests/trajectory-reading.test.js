import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { explainExecutionDAG } from "../src/explanation.js";
import { buildExecutionTrajectory } from "../src/trajectory.js";
import { buildTrajectoryHierarchy, buildTrajectoryReading, trajectoryRecordPresentation, trajectoryRecordValue } from "../src/trajectory-reading.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function prepare(name) {
  const source = fixture(name);
  const projected = projectEinoViewerDocument(source);
  assert.equal(projected.ok, true, `${name}: document`);
  const { document } = projected;
  const explained = explainExecutionDAG(document.execution, document.evidence);
  assert.equal(explained.ok, true, `${name}: explanation`);
  const built = buildExecutionTrajectory(document.evidence);
  assert.equal(built.ok, true, `${name}: trajectory`);
  return freeze({ source, document, explanation: explained.explanation, trajectory: built.trajectory });
}
function reading(model, execution = model.document.execution) {
  return buildTrajectoryReading(model.trajectory, execution, model.document.evidence, model.explanation.groups);
}
function sameRecords(actual, expected, message) {
  assert.deepEqual(actual.map(({ id }) => id), expected.map(({ id }) => id), message);
  actual.forEach((record, index) => assert.equal(record, expected[index], `${message}: original record reference`));
}
function expectHierarchy(records, depths, parentIndexes, message) {
  const before = JSON.stringify(records), references = records.slice();
  const hierarchy = buildTrajectoryHierarchy(records);
  assert.ok(hierarchy.depthByRecordId instanceof Map, `${message}: depth map`);
  assert.ok(hierarchy.parentByRecordId instanceof Map, `${message}: parent map`);
  assert.deepEqual(records.map(({ id }) => hierarchy.depthByRecordId.get(id)), depths, `${message}: full parent-chain depths`);
  assert.deepEqual(records.map(({ id }) => hierarchy.parentByRecordId.get(id)),
    parentIndexes.map((index) => index === null ? undefined : records[index].id), `${message}: exact visible parent identities`);
  assert.equal(hierarchy.depthByRecordId.size, new Set(records.map(({ id }) => id)).size, `${message}: no invented records`);
  assert.equal(JSON.stringify(records), before, `${message}: source fields remain unchanged`);
  sameRecords(records, references, `${message}: source order and references remain unchanged`);
  return hierarchy;
}
function descendantScopes(groups, selected) {
  const ids = new Set([selected]);
  let previousSize;
  do {
    previousSize = ids.size;
    for (const group of groups) if (ids.has(group.parentId)) ids.add(group.id);
  } while (previousSize !== ids.size);
  return ids;
}

const names = ["agent-direct-answer", "agent-repeated-tool", "agent-parallel-same-tool",
  "agent-nested-distinct-results", "agent-nested-parallel-scopes", "agent-deep-nested-distinct-results",
  "agent-nested-failure-recovered", "agent-deep-nested-failure-recovered"];
for (const name of names) {
  const model = prepare(name), before = JSON.stringify(model);
  const { trajectory, document, explanation } = model;
  const view = reading(model);
  const hierarchy = buildTrajectoryHierarchy(trajectory.records);
  assert.ok(view.nodeIdByRecordId instanceof Map);
  assert.ok(view.scopeIdByRecordId instanceof Map);
  sameRecords(view.recordsForScope(), trajectory.records, `${name}: full source order`);
  sameRecords(view.recordsForScope({ groupId: "missing-scope" }), [], `${name}: unknown scope never falls back to all`);
  for (const record of trajectory.records) {
    const nodeId = view.nodeIdByRecordId.get(record.id);
    const scopeId = view.scopeIdByRecordId.get(record.id);
    const node = document.execution.nodes.find(({ id }) => id === nodeId);
    assert.equal(view.turnKey(record), JSON.stringify([scopeId ?? null, record.turn ?? null]));
    if (record.metadata.agentScopeUnresolved) {
      assert.equal(scopeId, undefined, `${name}: unconfirmed events do not acquire a scope by their Agent name`);
      assert.equal(hierarchy.depthByRecordId.get(record.id), 0, `${name}: unconfirmed events stay at the reading root`);
      assert.equal(hierarchy.parentByRecordId.has(record.id), false, `${name}: no invented parent for unconfirmed events`);
    } else if (record.metadata.agentScopeId) {
      assert.equal(scopeId, record.metadata.agentScopeId, `${name}: full invocation scope is retained`);
    } else {
      assert.equal(scopeId, explanation.groups[0].id, `${name}: direct Agent records share its established root scope`);
    }
    if (!record.metadata.agentScopeUnresolved) {
      const parent = trajectory.records.find(({ id }) => id === record.parentId);
      assert.equal(hierarchy.parentByRecordId.get(record.id), parent?.id, `${name}: only the canonical parent identity establishes nesting`);
      assert.equal(hierarchy.depthByRecordId.get(record.id), parent ? hierarchy.depthByRecordId.get(parent.id) + 1 : 0,
        `${name}: full reading depth follows parent records, not mixed Agent/tool numeric depth`);
    }
    if (record.kind === "tool") {
      const expected = document.execution.nodes.filter((candidate) => candidate.kind === "tool"
        && candidate.metadata.toolCallId === record.toolCallId
        && candidate.metadata.agentScopeId === record.metadata.agentScopeId);
      assert.equal(expected.length, 1, `${name}: fixture has one scoped call identity`);
      assert.equal(node, expected[0], `${name}: tool ${record.id} maps to its exact call, not its planning message`);
      const ownEvidence = record.evidence.filter(({ envelopeIndex, role }) => role !== "tool-call"
        && document.evidence[envelopeIndex]?.kind !== "schema.tool");
      assert.ok(ownEvidence.some(({ envelopeIndex }) => node.evidence.some((entry) => entry.envelopeIndex === envelopeIndex)),
        `${name}: mapping has evidence from this invocation`);
    }
    if (record.kind === "assistant" && record.metadata.toolCallIds?.length) {
      assert.notEqual(node?.kind, "tool", `${name}: planning evidence inherited by a tool does not turn the assistant into that tool`);
    }
    if (record.kind === "user") assert.equal(node?.kind, "input");
    if (record.metadata.publicOutput) assert.equal(node?.kind, "output");
    for (const locale of ["en", "zh"]) {
      const label = trajectoryRecordPresentation(record, { locale, identityLabel: "call identity" });
      assert.equal(label.title, `${label.name} · call identity`);
      if (record.kind === "tool") {
        assert.equal(label.name, record.label, "business tool labels remain literal");
        assert.equal(label.role, locale === "zh" ? "工具调用" : "Tool call");
      }
      if (record.kind === "user") assert.equal(label.name, locale === "zh" ? "用户输入" : "User input");
      if (record.metadata.publicOutput) assert.equal(label.name, locale === "zh" ? "助手输出" : "Assistant output");
      if (record.metadata.agentScopeUnresolved) assert.equal(label.role || label.name, locale === "zh" ? "Agent 证据" : "Agent evidence");
    }
  }
  for (const group of explanation.groups) {
    const scopes = descendantScopes(explanation.groups, group.id);
    const expected = trajectory.records.filter(({ id }) => scopes.has(view.scopeIdByRecordId.get(id)));
    sameRecords(view.recordsForScope({ groupId: group.id }), expected, `${name}: scope includes its full subtree in source order`);
  }
  sameRecords(view.recordsForScope({ ungroupedOnly: true }), trajectory.records.filter(({ id }) => !view.scopeIdByRecordId.has(id)),
    `${name}: only unassigned records are ungrouped`);
  assert.equal(JSON.stringify(model), before, `${name}: reading does not mutate frozen source, canonical execution, explanation or trajectory`);
}
console.log(`OK: trajectory reading retains exact identities, order, references, full scopes and bilingual titles in ${names.length} real Recorder cases`);

{
  const model = prepare("agent-nested-distinct-results"), records = model.trajectory.records;
  expectHierarchy(records, [0, 0, 1, 2, 3, 2, 0], [null, null, 1, 2, 3, 2, null], "real parent/child call chain");
  const child = model.explanation.groups.find(({ parentId }) => parentId);
  const scoped = reading(model).recordsForScope({ groupId: child.id });
  sameRecords(scoped, records.slice(3, 6), "the child scope contains original steps 04, 05 and 06");
  expectHierarchy(scoped, [0, 1, 0], [null, 0, null], "child scope rebases only missing ancestors");
}
{
  const model = prepare("agent-nested-parallel-scopes"), view = reading(model);
  const unknown = model.trajectory.records.filter(({ metadata }) => metadata.agentScopeUnresolved);
  assert.equal(unknown.length, 6, "the real parallel fixture contains name-only ambiguous evidence");
  sameRecords(view.recordsForScope({ ungroupedOnly: true }), unknown, "unassigned events stay separate from confirmed calls");
  for (const record of unknown) {
    const output = trajectoryRecordValue(record, "output", model.document.evidence);
    assert.equal(output.availability, "available", "unconfirmed scope does not erase recorded message content");
    assert.deepEqual(output.evidenceEnvelopeIndexes, record.evidence.map(({ envelopeIndex }) => envelopeIndex));
    if (record.output.role === "tool") {
      assert.deepEqual(output.value, record.output, "a name-only tool message remains an original unassigned message, not a child tool return");
    } else if (record.output.tool_calls?.length) {
      assert.deepEqual(output.value, record.output.tool_calls.map(({ function: call }) => ({ name: call.name, arguments: JSON.parse(call.arguments) })),
        "known assistant tool-call syntax remains readable without claiming which nested call owns it");
    } else assert.equal(output.value, record.output.content);
  }
  for (const record of model.trajectory.records.filter(({ kind, metadata }) => kind === "assistant" && metadata.source === "component.io")) {
    const reference = record.evidence.find(({ role }) => role === "model-output");
    const originalMessage = model.document.evidence[reference.envelopeIndex].payload.body.message;
    const output = trajectoryRecordValue(record, "output", model.document.evidence);
    assert.deepEqual(output.value, originalMessage, "component-only model observations retain the original message object");
    assert.deepEqual(output.evidenceEnvelopeIndexes, [reference.envelopeIndex]);
  }
  const children = model.explanation.groups.filter(({ parentId }) => parentId);
  const turns = children.map(({ id }) => view.recordsForScope({ groupId: id }).find(({ kind, turn }) => kind === "assistant" && turn === 1));
  assert.equal(turns.length, 2);
  assert.notEqual(view.turnKey(turns[0]), view.turnKey(turns[1]), "Turn 1 in sibling invocations is not one turn");
  assert.ok(children.every(({ id }) => view.recordsForScope({ groupId: id }).every(({ metadata }) => !metadata.agentScopeUnresolved)));
  const hierarchy = buildTrajectoryHierarchy(model.trajectory.records);
  for (const [index, child] of children.entries()) {
    const scoped = view.recordsForScope({ groupId: child.id });
    expectHierarchy(scoped, [0, 1, 0], [null, 0, null], "same-name sibling scope remains an independent call chain");
    const tool = scoped.find(({ kind }) => kind === "tool");
    assert.equal(hierarchy.parentByRecordId.get(tool.id), turns[index].id, "reused inner tool IDs retain their own planning message");
    assert.notEqual(hierarchy.parentByRecordId.get(turns[index].id), hierarchy.parentByRecordId.get(turns[1 - index].id),
      "same-name children remain under different parent AgentTool invocations");
    assert.equal(tool.metadata.agentScopeId, turns[index].metadata.agentScopeId, "tool and planning message share one confirmed invocation");
  }
}
{
  const model = prepare("agent-deep-nested-distinct-results"), view = reading(model);
  const middle = model.explanation.groups.find(({ parentId }) => parentId === model.explanation.groups[0].id);
  const leaf = model.explanation.groups.find(({ parentId }) => parentId === middle.id);
  const middleRecords = view.recordsForScope({ groupId: middle.id }), leafRecords = view.recordsForScope({ groupId: leaf.id });
  assert.ok(leafRecords.length > 0 && middleRecords.length > leafRecords.length);
  assert.ok(leafRecords.every((record) => middleRecords.includes(record)), "selecting the middle includes the grandchild, not just direct members");
  const tools = model.trajectory.records.filter(({ kind }) => kind === "tool");
  assert.equal(new Set(tools.map(({ toolCallId }) => toolCallId)).size, 1);
  assert.equal(new Set(tools.map(({ id }) => view.nodeIdByRecordId.get(id))).size, 3,
    "identical call IDs at three depths still map to three canonical nodes");
  expectHierarchy(model.trajectory.records, [0, 0, 1, 2, 3, 4, 5, 4, 2, 0],
    [null, null, 1, 2, 3, 4, 5, 4, 2, null], "three-level same-name Agent calls keep their exact parent chain");
  expectHierarchy(middleRecords, [0, 1, 2, 3, 2, 0], [null, 0, 1, 2, 1, null], "middle scope keeps the full grandchild chain");
  expectHierarchy(leafRecords, [0, 1, 0], [null, 0, null], "leaf scope removes only external ancestors");
}

{
  const records = freeze([
    { id: "root", depth: 98, label: "same" },
    { id: "orphan", parentId: "missing", depth: 99, label: "same" },
    { id: "duplicate", parentId: "root" },
    { id: "duplicate", parentId: "orphan" },
    { id: "ambiguous-child", parentId: "duplicate" },
    { id: "known-grandchild", parentId: "ambiguous-child" },
    { id: "unknown", parentId: "root", metadata: { agentScopeUnresolved: true } },
    { id: "unknown-child", parentId: "unknown" },
    { id: "self", parentId: "self" },
    { id: "valid-child", parentId: "root", depth: 0 },
  ]);
  expectHierarchy(records, [0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    [null, null, null, null, null, 4, null, null, null, 0], "invalid identities never invent visible parents");
  const reversed = buildTrajectoryHierarchy(records.toReversed()), original = buildTrajectoryHierarchy(records);
  for (const { id } of records) {
    assert.equal(reversed.depthByRecordId.get(id), original.depthByRecordId.get(id), "source position does not resolve ambiguous identities");
    assert.equal(reversed.parentByRecordId.get(id), original.parentByRecordId.get(id), "duplicate IDs never use the first or last matching parent");
  }
  expectHierarchy(freeze([]), [], [], "empty reading scope");
}
{
  const records = freeze([
    { id: "descendant", parentId: "cycle-a" },
    { id: "cycle-a", parentId: "cycle-b" },
    { id: "cycle-b", parentId: "cycle-c" },
    { id: "cycle-c", parentId: "cycle-a" },
    { id: "grandchild", parentId: "descendant" },
    { id: "independent" },
  ]);
  expectHierarchy(records, [1, 0, 0, 0, 2, 0], [1, null, null, null, 0, null],
    "cycle edges are removed without discarding independently proven descendants");
  expectHierarchy(records.toReversed(), [0, 2, 0, 0, 0, 1], [null, 5, null, null, null, 4],
    "cycles terminate independently of source order");
}
{
  // Start at the deepest record so a recursive walk would exhaust the stack.
  const records = freeze(Array.from({ length: 20_000 }, (_, index) => ({ id: `chain-${index}`,
    ...(index ? { parentId: `chain-${index - 1}` } : {}), depth: 0 })).reverse());
  expectHierarchy(records, records.map((_, index) => records.length - index - 1),
    records.map((_, index) => index === records.length - 1 ? null : index + 1), "long reversed parent chain is iterative and lossless");
}
console.log("OK: visible trajectory hierarchy preserves exact scoped parents, rebases safely and rejects ambiguous/cyclic ancestry without mutation");

for (const duplicateID of [false, true]) {
  const model = prepare("agent-repeated-tool");
  const record = model.trajectory.records.find(({ kind }) => kind === "tool");
  const original = model.document.execution.nodes.find(({ metadata }) => metadata.toolCallId === record.toolCallId);
  const duplicate = { ...original, id: duplicateID ? original.id : `${original.id}:duplicate` };
  const execution = { ...model.document.execution, nodes: [...model.document.execution.nodes, duplicate] };
  assert.equal(reading(model, execution).nodeIdByRecordId.has(record.id), false,
    `ambiguous ${duplicateID ? "node ID" : "call identity"} does not choose the first matching node`);
}
{
  const model = prepare("agent-repeated-tool");
  const record = model.trajectory.records.find(({ kind }) => kind === "tool");
  const original = model.document.execution.nodes.find(({ metadata }) => metadata.toolCallId === record.toolCallId);
  const other = model.document.execution.nodes.find(({ kind, id }) => kind === "tool" && id !== original.id);
  const execution = { ...model.document.execution, nodes: [...model.document.execution.nodes, { ...other, id: original.id }] };
  assert.equal(reading(model, execution).nodeIdByRecordId.has(record.id), false,
    "a unique call match still cannot target a canonical node ID reused by an unrelated call");
}
{
  const model = prepare("agent-repeated-tool");
  const tools = model.trajectory.records.filter(({ kind }) => kind === "tool");
  const changed = { ...tools[0], evidence: tools[1].evidence };
  const trajectory = { ...model.trajectory, records: [changed] };
  const view = buildTrajectoryReading(trajectory, model.document.execution, model.document.evidence, model.explanation.groups);
  assert.equal(view.nodeIdByRecordId.has(changed.id), false, "a matching call ID without its own evidence is not a jump target");
}
console.log("OK: nested turn identities and ambiguous/mismatched node evidence cannot cross-link unrelated records");

for (const name of ["agent-redacted-tool", "agent-tool-recovered"]) {
  const model = prepare(name), before = JSON.stringify(model);
  const record = model.trajectory.records.find(({ kind }) => kind === "tool");
  const reference = record.evidence.find(({ envelopeIndex }) => {
    const envelope = model.document.evidence[envelopeIndex];
    return envelope.kind === "agent.event" && envelope.payload.output?.message?.value?.role === "tool";
  });
  const envelope = model.document.evidence[reference.envelopeIndex];
  const item = trajectoryRecordValue(record, "output", model.document.evidence);
  assert.equal(typeof record.output, "object", `${name}: fixture distinguishes the parsed trajectory value`);
  assert.equal(typeof item.value, "string", `${name}: display preserves the actual schema content string`);
  assert.equal(item.value, envelope.payload.output.message.value.content);
  assert.deepEqual(item.evidenceEnvelopeIndexes, [reference.envelopeIndex]);
  assert.equal(JSON.stringify(model), before);
}

function valueCase({ content = '{"business":{"answer":42}}', capture, body, kind = "agent.event" } = {}) {
  let envelope;
  if (kind === "component.io") envelope = { kind, payload: { component: "Tool", direction: "output", name: "lookup_item",
    address: [{ type: "tool", id: "lookup_item", subId: "exact-call" }], ...(body !== undefined ? { body } : {}) } };
  else if (kind === "schema.message") envelope = { kind, payload: { role: "tool", tool_call_id: "exact-call", ...(content !== undefined ? { content } : {}) } };
  else envelope = { kind, payload: { agentName: "worker", output: { message: { value: {
    role: "tool", tool_call_id: "exact-call", ...(content !== undefined ? { content } : {}),
  } } } } };
  if (capture) envelope.metadata = { capture };
  const record = { id: "tool:exact-call", kind: "tool", label: "lookup_item", toolCallId: "exact-call",
    metadata: { toolCallId: "exact-call", toolName: "lookup_item" },
    evidence: [{ envelopeIndex: 0, kind, role: kind === "component.io" ? "tool-output" : "tool-result" }],
    output: { synthesized: "this aggregate must not replace original evidence" } };
  return freeze({ record, envelopes: [envelope] });
}
for (const [kind, path] of [["schema.message", "/payload"], ["agent.event", "/payload/output/message/value"], ["component.io", "/payload/body"]]) {
  for (const [name, capture, diagnostic, expected] of [
    ["captured", undefined, undefined, "available"],
    ["metadata redacted", { redacted: true }, undefined, "redacted"],
    ["metadata truncated", { truncated: true }, undefined, "truncated"],
    ["omitted", { status: "omitted", reason: "unsupported_value" }, undefined, "not-observed"],
    ["exact diagnostic", undefined, { envelopeIndex: 0, path, code: "projection.truncated" }, "truncated"],
    ["child diagnostic", undefined, { envelopeIndex: 0, path: `${path}/field`, code: "projection.redacted" }, "redacted"],
    ["wrong source", undefined, { envelopeIndex: 1, path, code: "projection.truncated" }, "available"],
    ["source unspecified", undefined, { path, code: "projection.redacted" }, "available"],
    ["similar path", undefined, { envelopeIndex: 0, path: `${path}Other`, code: "projection.redacted" }, "available"],
    ["other property", undefined, { envelopeIndex: 0, path: "/correlation/name", code: "projection.redacted" }, "available"],
    ["redaction wins", { truncated: true }, { envelopeIndex: 0, path, code: "projection.redacted" }, "redacted"],
  ]) {
    const source = valueCase({ kind, capture, body: { response: '{"answer":42}', role: "assistant", content: "business property" } });
    const before = JSON.stringify(source), diagnostics = diagnostic ? [freeze({ severity: "warning", message: name, ...diagnostic })] : [];
    const item = trajectoryRecordValue(source.record, "output", source.envelopes, diagnostics);
    assert.equal(item.availability, expected, `${kind}/${name}`);
    assert.deepEqual(item.evidenceEnvelopeIndexes, [0], `${kind}/${name}: exact source provenance`);
    if (expected === "not-observed") {
      assert.equal(Object.hasOwn(item, "value"), false, "omitted values cannot be restored from aggregate output");
      assert.equal(item.reason, "unsupported_value");
    } else {
      const original = kind === "component.io" ? source.envelopes[0].payload.body
        : kind === "schema.message" ? source.envelopes[0].payload.content : source.envelopes[0].payload.output.message.value.content;
      assert.deepEqual(item.value, original, `${kind}/${name}: entire recorded value stays intact`);
    }
    assert.equal(JSON.stringify(source), before);
  }
}
for (const [body, availability] of [[null, "null"], ["", "empty"], [false, "available"], [0, "available"]]) {
  const source = valueCase({ kind: "component.io", body });
  const item = trajectoryRecordValue(source.record, "output", source.envelopes);
  assert.equal(item.availability, availability);
  assert.equal(item.value, body, "falsy observed values are not missing values");
}
{
  const source = valueCase({ kind: "component.io" });
  const item = trajectoryRecordValue(source.record, "output", source.envelopes);
  assert.equal(item.availability, "not-observed");
  assert.equal(Object.hasOwn(item, "value"), false, "missing source body does not resurrect a parsed aggregate");
  const absent = trajectoryRecordValue({ ...source.record, evidence: [] }, "output", source.envelopes);
  assert.equal(absent.availability, "not-observed");
  assert.equal(Object.hasOwn(absent, "value"), false, "a source-less aggregate is not original recorded content");
  const foreign = structuredClone(valueCase());
  foreign.envelopes[0].payload.output.message.value.tool_call_id = "another-call";
  assert.equal(trajectoryRecordValue(freeze(foreign.record), "output", freeze(foreign.envelopes)).availability, "not-observed",
    "a referenced message for a different tool call is not this tool's output");
  const foreignComponent = structuredClone(valueCase({ kind: "component.io", body: { response: "another call's result" } }));
  foreignComponent.envelopes[0].payload.address[0].subId = "another-call";
  assert.equal(trajectoryRecordValue(freeze(foreignComponent.record), "output", freeze(foreignComponent.envelopes)).availability, "not-observed",
    "Tool component evidence with a contradictory invocation ID cannot supply another call's body");
  const modelOutput = freeze({ kind: "component.io", payload: { component: "ChatModel", direction: "output" } });
  const assistant = freeze({ id: "assistant", kind: "assistant", metadata: {},
    output: { content: "aggregate without a recorded model body" }, evidence: [{ envelopeIndex: 0, kind: "component.io", role: "model-output" }] });
  const absentModel = trajectoryRecordValue(assistant, "output", [modelOutput]);
  assert.equal(absentModel.availability, "not-observed");
  assert.equal(Object.hasOwn(absentModel, "value"), false, "a missing model message cannot restore an aggregate assistant output");
}
console.log("OK: original schema strings, whole business bodies, capture flags and exact diagnostic paths remain truthful");

{
  const model = prepare("agent-repeated-tool"), record = model.trajectory.records.find(({ kind }) => kind === "tool");
  const input = trajectoryRecordValue(record, "input", model.document.evidence);
  assert.deepEqual(input.value, { key: "first" }, "known schema arguments remain parsed once by the trajectory builder");
  assert.equal(input.availability, "available");
  assert.ok(input.evidenceEnvelopeIndexes.length > 0);
}
for (const [capture, availability] of [[{ redacted: true }, "redacted"], [{ truncated: true }, "truncated"],
  [{ status: "omitted", reason: "input_policy" }, "not-observed"]]) {
  const source = structuredClone(valueCase({ kind: "component.io", capture }));
  source.envelopes[0].payload.direction = "input";
  source.envelopes[0].payload.body = { argumentsJson: '{"key":"first"}' };
  source.record.evidence[0].role = "tool-input";
  source.record.input = { key: "first" };
  freeze(source);
  const input = trajectoryRecordValue(source.record, "input", source.envelopes);
  assert.equal(input.availability, availability, "parsed arguments retain their original input capture state");
  assert.deepEqual(input.evidenceEnvelopeIndexes, [0]);
  if (availability === "not-observed") {
    assert.equal(Object.hasOwn(input, "value"), false);
    assert.equal(input.reason, "input_policy");
  } else assert.deepEqual(input.value, { key: "first" });
}
{
  const model = prepare("agent-deep-nested-failure-recovered");
  const original = model.trajectory.records.find((record) => record.error && record.output !== undefined);
  assert.ok(original, "the real recovery fixture records both an error and independent fallback output");
  const errorReference = original.evidence.find(({ role }) => role === "error");
  const errorDiagnostic = { envelopeIndex: errorReference.envelopeIndex, path: "/payload/error/message", code: "projection.redacted", severity: "warning", message: "redacted error" };
  const before = JSON.stringify(model);
  const error = trajectoryRecordValue(original, "error", model.document.evidence, [errorDiagnostic]);
  const output = trajectoryRecordValue(original, "output", model.document.evidence, [errorDiagnostic]);
  assert.equal(error.availability, "redacted");
  assert.ok(error.evidenceEnvelopeIndexes.includes(errorReference.envelopeIndex));
  assert.equal(output.availability, "available", "error capture is not the independent fallback business result's capture");
  assert.equal(output.value, original.output);
  const wrongPath = trajectoryRecordValue(original, "error", model.document.evidence, [{ ...errorDiagnostic, path: "/payload/errorMessage" }]);
  assert.equal(wrongPath.availability, "available", "error diagnostics also require a complete path segment");
  assert.equal(JSON.stringify(model), before);
}
for (const [capture, availability] of [[{ redacted: true }, "redacted"], [{ truncated: true }, "truncated"],
  [{ status: "omitted", reason: "error_policy" }, "not-observed"]]) {
  const source = structuredClone(valueCase({ capture, content: '{"recovered":true,"price":120}' }));
  source.envelopes[0].payload.error = { message: "provider failed" };
  source.record.error = { message: "provider failed" };
  freeze(source);
  const error = trajectoryRecordValue(source.record, "error", source.envelopes);
  const output = trajectoryRecordValue(source.record, "output", source.envelopes);
  assert.equal(error.availability, availability);
  assert.deepEqual(error.evidenceEnvelopeIndexes, [0]);
  if (availability === "not-observed") {
    assert.equal(Object.hasOwn(error, "value"), false);
    assert.equal(error.reason, "error_policy");
  } else assert.equal(error.value, "provider failed");
  assert.equal(output.availability, "available", "an error's capture policy cannot erase a separately recorded tool fallback on the same envelope");
  assert.equal(output.value, '{"recovered":true,"price":120}');
  const flaggedOutput = trajectoryRecordValue(source.record, "output", source.envelopes, [{ envelopeIndex: 0,
    path: "/payload/output/message/value/content", code: "projection.redacted", severity: "warning", message: "fallback content redacted" }]);
  assert.equal(flaggedOutput.availability, "redacted", "a diagnostic actually identifying fallback content still applies");
}
console.log("OK: parsed invocation input and recovered tool business output remain independent from exact-source error capture");
