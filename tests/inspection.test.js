import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRunInspectionIndex } from "../src/inspection.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { explainExecutionDAG } from "../src/explanation.js";

const nodes = Array.from({ length: 251 }, (_, index) => ({
  id: `step-${index}`, label: `Lookup ${index}`, component: "Tool", kind: "tool",
  path: ["parent", `step-${index}`], status: index === 145 ? "failed" : "success",
  evidence: [{ envelopeIndex: index }], summary: "Observed call",
}));
const envelopes = Array.from({ length: 254 }, (_, index) => ({
  kind: "component.io", payload: { direction: "output", body: "not a search label" },
  correlation: { invocationId: `call-${index}` },
}));
const explanation = { nodes, run: { result: { evidenceEnvelopeIndexes: [251] }, issues: [{ nodeId: "step-7", scope: "step" }] } };
const before = JSON.stringify({ explanation, envelopes });
const index = createRunInspectionIndex(explanation, envelopes);
assert.equal(index.nodeCount, 251);
assert.equal(index.evidenceCount, 254);
assert.equal(index.getNode("step-10"), nodes[10]);
assert.equal(index.getNode("missing"), undefined);
assert.equal(index.getEvidence(0).scope, "step");
assert.equal(index.getEvidence(251).scope, "run");
assert.equal(index.getEvidence(252).scope, "unassigned");
assert.equal(index.getEvidence(-1), undefined);
assert.equal(index.searchSteps().items.length, 50);
assert.equal(index.searchSteps("", { limit: 1000 }).items.length, 200);
assert.equal(index.searchSteps("LOOKUP 145").items[0].id, "step-145");
assert.deepEqual(index.searchSteps("", { issuesOnly: true }).items.map(({ id }) => id), ["step-7", "step-145"]);
assert.equal(index.searchSteps("", { offset: 99999 }).offset, 250);
assert.equal(index.searchSteps("no match", { offset: 999 }).offset, 0);
assert.equal(index.searchEvidence("call-252").items[0].envelopeIndex, 252);
assert.equal(index.searchEvidence("", { scope: "unassigned" }).total, 2);
assert.equal(index.searchEvidence("not a search label").total, 0, "body contents are not silently indexed");
assert.equal(JSON.stringify({ explanation, envelopes }), before);
assert.equal(Object.isFrozen(nodes[0]), false, "caller-owned data is untouched");
assert.equal(Object.isFrozen(index.getEvidence(0).nodeIds), true);
const shared = createRunInspectionIndex({ nodes: [{ ...nodes[0], evidence: [{ envelopeIndex: 0 }, { envelopeIndex: 0 }] },
  { ...nodes[1], evidence: [{ envelopeIndex: 0 }] }] }, envelopes);
assert.deepEqual(shared.getEvidence(0).nodeIds, ["step-0", "step-1"], "shared evidence is neither merged nor lost");
console.log("OK: static inspection paging, search, issue navigation and unassigned evidence");

{
  const groups = [
    { id: "parent", label: "shared", kind: "agent", nodeIds: ["step-0"], evidenceEnvelopeIndexes: [251], basis: "observed" },
    { id: "child-a", label: "shared", kind: "agent", parentId: "parent", nodeIds: ["step-1", "step-145"], evidenceEnvelopeIndexes: [1], basis: "observed" },
    { id: "child-b", label: "shared", kind: "agent", parentId: "parent", nodeIds: ["step-2"], evidenceEnvelopeIndexes: [2], basis: "observed" },
  ];
  const input = { ...explanation, groups };
  const original = JSON.stringify(input);
  const scoped = createRunInspectionIndex(input, envelopes);
  assert.equal(scoped.groupCount, 3);
  assert.equal(scoped.getGroup("child-a"), groups[1]);
  assert.deepEqual(scoped.getGroupPath("child-a").map(({ id }) => id), ["parent", "child-a"]);
  assert.deepEqual(scoped.getGroupPath("unknown"), []);
  assert.deepEqual(scoped.getNodeGroups("step-1"), [groups[1]]);
  assert.equal(Object.isFrozen(scoped.getNodeGroups("step-1")), true);
  assert.deepEqual(scoped.getNodeGroups("step-3"), []);
  assert.deepEqual(scoped.searchSteps("", { groupId: "parent" }).items.map(({ id }) => id), ["step-0", "step-1", "step-2", "step-145"]);
  assert.deepEqual(scoped.searchSteps("", { groupId: "child-a", issuesOnly: true }).items.map(({ id }) => id), ["step-145"]);
  assert.equal(scoped.searchSteps("", { groupId: "missing" }).total, 0, "unknown scopes do not expose another invocation");
  assert.equal(scoped.searchSteps("", { ungroupedOnly: true }).total, 247);
  assert.deepEqual(scoped.searchEvidence("", { groupId: "child-a" }).items.map(({ envelopeIndex }) => envelopeIndex), [1, 145]);
  assert.equal(scoped.searchEvidence("", { groupId: "parent", scope: "run" }).items[0].envelopeIndex, 251);
  assert.equal(scoped.searchEvidence("", { ungroupedOnly: true }).total, 249);
  assert.equal(scoped.searchSteps("Lookup", { groupId: "parent", offset: 2, limit: 2 }).total, 4);

  // An explicit empty allowlist is different from an omitted filter.
  assert.equal(scoped.searchEvidence("", { evidenceEnvelopeIndexes: [] }).total, 0);
  assert.equal(scoped.searchEvidence("", { groupId: "parent", evidenceEnvelopeIndexes: [] }).total, 0);
  // A local reader may include a verified parent-boundary reference, but the
  // reference retains its original step/run classification and owner IDs.
  const boundary = scoped.getEvidence(0);
  const boundaryPage = scoped.searchEvidence("", { evidenceEnvelopeIndexes: [0, 251] });
  assert.equal(boundaryPage.items[0], boundary);
  assert.equal(boundaryPage.items[0].scope, "step");
  assert.deepEqual(boundaryPage.items[0].nodeIds, ["step-0"]);
  assert.equal(boundaryPage.items[1].scope, "run");
  assert.deepEqual(boundaryPage.items[1].nodeIds, []);
  assert.deepEqual(scoped.getNodeGroups("step-0"), [groups[0]]);
  // The allowlist is an intersection, not a union that overrides explicit
  // group, unassigned-only or evidence-category restrictions.
  const allowed = [0, 1, 2, 145, 251, 252];
  assert.deepEqual(scoped.searchEvidence("", { groupId: "child-a", evidenceEnvelopeIndexes: allowed }).items.map(({ envelopeIndex }) => envelopeIndex), [1, 145]);
  assert.deepEqual(scoped.searchEvidence("", { ungroupedOnly: true, evidenceEnvelopeIndexes: allowed }).items.map(({ envelopeIndex }) => envelopeIndex), [252]);
  assert.deepEqual(scoped.searchEvidence("", { scope: "run", evidenceEnvelopeIndexes: allowed }).items.map(({ envelopeIndex }) => envelopeIndex), [251]);
  assert.equal(scoped.searchEvidence("", { groupId: "child-a", scope: "run", evidenceEnvelopeIndexes: allowed }).total, 0);
  // Search and paging still operate on the filtered source order; repeated
  // allowlist entries do not duplicate results or change ownership.
  const searched = scoped.searchEvidence("call-1", { evidenceEnvelopeIndexes: [145, 1, 145, 2], offset: 999, limit: 1 });
  assert.equal(searched.total, 2);
  assert.equal(searched.offset, 1);
  assert.deepEqual(searched.items.map(({ envelopeIndex }) => envelopeIndex), [145]);
  assert.equal(scoped.searchEvidence("call-251", { evidenceEnvelopeIndexes: [1, 145] }).total, 0);
  assert.deepEqual(allowed, [0, 1, 2, 145, 251, 252], "filtering does not mutate the caller's allowlist");
  assert.equal(JSON.stringify(input), original, "filtering never rewrites canonical nodes or evidence");
  assert.equal(Object.isFrozen(groups[0]), false, "index does not freeze caller-owned groups");
  const cyclic = createRunInspectionIndex({ nodes, groups: [{ ...groups[0], parentId: "child-a" }, groups[1]] }, envelopes);
  assert.equal(cyclic.getGroupPath("parent").length, 2);
  assert.equal(cyclic.searchSteps("", { groupId: "parent" }).total, 3, "defensive navigation cannot loop on malformed group cycles");
}
console.log("OK: canonical hierarchy scope, descendant filtering and ungrouped evidence without name-based inference");

function recorderInspection(name, locale = "en") {
  const record = JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
  const original = JSON.stringify(record);
  const projected = projectEinoViewerDocument(record);
  assert.equal(projected.ok, true, name);
  const explained = explainExecutionDAG(projected.document.execution, record.evidence, { locale });
  assert.equal(explained.ok, true, name);
  const explanation = explained.explanation, before = JSON.stringify(explanation);
  const inspection = createRunInspectionIndex(explanation, record.evidence);
  assert.equal(JSON.stringify(record), original, "indexing never rewrites the original record");
  assert.equal(JSON.stringify(explanation), before, "indexing never rewrites the canonical explanation");
  return { record, explanation, inspection };
}
const ids = (page) => page.items.map(({ id }) => id);

for (const locale of ["en", "zh"]) {
  const { record, explanation, inspection } = recorderInspection("graph-multistep-loop-success", locale);
  const evaluates = explanation.nodes.filter(({ label }) => label === "evaluate");
  const revisions = explanation.nodes.filter(({ label }) => label === "revise");
  for (const query of ["Call 2", "call2", "第 2 次", "第2次"]) {
    assert.deepEqual(ids(inspection.searchSteps(query)), [evaluates[1].id, revisions[1].id], query);
    assert.deepEqual(inspection.searchSteps(`evaluate · ${query}`).items, [evaluates[1]], "results retain canonical object identity");
  }
  assert.equal(inspection.searchSteps("prepare Call 2").total, 0, "callback ID ending in :2 is not a Call 2 display label");
  assert.equal(inspection.searchSteps("evaluate Call 20").total, 0, "ordinal matching has a numeric boundary");
  assert.equal(inspection.searchSteps("Call 2", { offset: 999, limit: 1 }).items[0], revisions[1]);
  for (const query of ["success", "Succeeded", "成功"]) assert.equal(inspection.searchSteps(query).total, explanation.nodes.length);
  assert.equal(inspection.searchSteps(evaluates[1].technical.correlation.invocationId).items[0], evaluates[1], "original invocation ID remains searchable");
  assert.deepEqual(inspection.searchSteps(evaluates[1].technical.correlation.entityId).items, evaluates, "original entity path is not replaced by the encoded display ID");
  assert.equal(inspection.searchSteps("杭州一日路线").total, 0, "recorded input bodies are outside the step index");

  const scoped = createRunInspectionIndex({ ...explanation, groups: [{ id: "only-second", nodeIds: [evaluates[1].id] }] }, record.evidence);
  assert.deepEqual(scoped.searchSteps("Call 2", { groupId: "only-second" }).items, [evaluates[1]]);
  assert.equal(scoped.searchSteps("Call 1", { groupId: "only-second" }).total, 0, "scope filtering cannot renumber the second call");
  const reversed = createRunInspectionIndex({ ...explanation, nodes: [...explanation.nodes].reverse() }, record.evidence);
  assert.deepEqual(ids(reversed.searchSteps("Call 2")), [revisions[1].id, evaluates[1].id], "display-array order changes result order, never source ordinals");

  const missing = structuredClone(explanation);
  const first = missing.nodes.find(({ id }) => id === evaluates[0].id);
  first.evidence = first.evidence.filter(({ role }) => role !== "start");
  assert.equal(createRunInspectionIndex(missing, record.evidence).searchSteps("evaluate Call 2").total, 0, "a missing call boundary blocks inferred numbering");
  const duplicate = structuredClone(explanation);
  duplicate.nodes.find(({ id }) => id === evaluates[1].id).technical.correlation.invocationId = evaluates[0].technical.correlation.invocationId;
  assert.equal(createRunInspectionIndex(duplicate, record.evidence).searchSteps("evaluate 第2次").total, 0, "duplicate invocation identity cannot establish an ordinal");

  // Preserve all source envelopes and references while making the two calls
  // overlap. Arrival order must not be mistaken for serial execution order.
  const overlap = structuredClone(explanation), overlapEvidence = structuredClone(record.evidence);
  const endIndex = evaluates[0].evidence.find(({ kind, role }) => kind === "callback.event" && role === "end").envelopeIndex;
  const startIndex = evaluates[1].evidence.find(({ kind, role }) => kind === "callback.event" && role === "start").envelopeIndex;
  [overlapEvidence[endIndex], overlapEvidence[startIndex]] = [overlapEvidence[startIndex], overlapEvidence[endIndex]];
  for (const node of overlap.nodes) for (const reference of node.evidence) {
    if (reference.envelopeIndex === endIndex) reference.envelopeIndex = startIndex;
    else if (reference.envelopeIndex === startIndex) reference.envelopeIndex = endIndex;
  }
  assert.equal(createRunInspectionIndex(overlap, overlapEvidence).searchSteps("evaluate Call 2").total, 0, "overlapping calls receive no invented sequence");
}
{
  const { explanation, inspection } = recorderInspection("graph-multistep-loop-failed");
  const failed = explanation.nodes.find(({ label, status }) => label === "evaluate" && status === "failed");
  for (const query of ["evaluate Call 2", "evaluate 第2次", "evaluate · 失败", "evaluate Error"]) {
    assert.deepEqual(inspection.searchSteps(query).items, [failed], query);
  }
  assert.equal(inspection.searchSteps("route evaluation unavailable at round 2").total, 0, "error-bearing headlines are not step search text");
  assert.deepEqual(inspection.searchSteps("Call 2", { issuesOnly: true }).items, [failed]);
}
console.log("OK: real Graph ordinal phrases use verified boundaries, preserve identity, filtering and order, and exclude bodies");

for (const locale of ["en", "zh"]) {
  const direct = recorderInspection("agent-direct-answer", locale);
  for (const query of ["用户输入", "User input", "User input · Succeeded"]) {
    assert.deepEqual(ids(direct.inspection.searchSteps(query)), ["input:user:1"], query);
  }
  for (const query of ["助手输出", "Assistant output", "助手输出 · 成功"]) {
    assert.deepEqual(ids(direct.inspection.searchSteps(query)), ["output:assistant:1"], query);
  }
  for (const query of ["请直接打个招呼", "你好，运行已完成"]) assert.equal(direct.inspection.searchSteps(query).total, 0);

  const recovered = recorderInspection("agent-nested-failure-recovered", locale);
  const failed = recovered.explanation.nodes.find(({ kind, status }) => kind === "tool" && status === "failed");
  for (const query of ["lookup_item · 错误", "lookup_item · Error", "lookup_item Failed"]) {
    assert.deepEqual(recovered.inspection.searchSteps(query).items, [failed], query);
  }
  assert.equal(recovered.inspection.searchSteps("lookup rejected: failure").total, 0, "error details stay in the result reader, not the step index");

  const parallel = recorderInspection("agent-parallel-same-tool", locale);
  assert.deepEqual(ids(parallel.inspection.searchSteps("lookup_item · call-fast")), ["tool:lookup_item:call-fast"]);
  for (const query of ["Call 1", "Call 2", "第1次", "第 2 次"]) assert.equal(parallel.inspection.searchSteps(query).total, 0, "parallel tool identity is not an execution ordinal");

  const nested = recorderInspection("agent-nested-parallel-scopes", locale);
  for (const name of ["slow", "fast"]) {
    const result = nested.inspection.searchSteps(`lookup_item · call-child-${name} / shared-inner-call`);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].technical.metadata.toolCallId, "shared-inner-call");
    assert.equal(result.items[0].technical.metadata.agentScopeId.includes(`call-child-${name}`), true);
  }
  const unresolved = nested.explanation.nodes.filter((node) => node.technical.metadata.agentScopeUnresolved);
  assert.ok(unresolved.length > 0);
  for (const query of ["Agent 证据 · 未确认调用归属", "Agent evidence · invocation unconfirmed", "已记录 · 调用归属未确认"]) {
    assert.deepEqual(nested.inspection.searchSteps(query).items, unresolved, query);
  }
  for (const query of ["Success", "Succeeded", "成功"]) {
    assert.equal(nested.inspection.searchSteps(query).items.some((node) => unresolved.includes(node)), false, "unassigned event arrival is not successful execution");
  }
  for (const query of ["child result:slow", "parent final: combined slow and fast", "Call 2", "第2次"]) assert.equal(nested.inspection.searchSteps(query).total, 0);

  const workflow = recorderInspection("workflow-nested-names", locale);
  assert.deepEqual(ids(workflow.inspection.searchSteps("Shared step · left / shared")), ["left-shared"]);
  assert.deepEqual(ids(workflow.inspection.searchSteps("right/shared")), ["right-shared"]);
  assert.equal(workflow.inspection.searchSteps("Shared step Call 2").total, 0, "same workflow names do not imply visit order");
}
{
  const { inspection } = recorderInspection("agent-tool-interrupted");
  for (const query of ["lookup_profile Interrupted", "lookup_profile 已中断"]) assert.equal(inspection.searchSteps(query).total, 1);
  assert.equal(inspection.searchSteps("approval required for booking").total, 0, "interruption reason is body content");
  const cancelled = recorderInspection("agent-cancelled").inspection;
  for (const query of ["lookup_profile Planned · execution not observed", "lookup_profile 仅计划 · 未观察到执行"]) assert.equal(cancelled.searchSteps(query).total, 1);
  for (const query of ["lookup_profile Succeeded", "lookup_profile 成功"]) assert.equal(cancelled.searchSteps(query).total, 0);
}
console.log("OK: real Agent and Workflow visible names, scoped source identities and localized effective states are searchable");

{
  const node = (id, label, technical = {}) => ({ id, label, kind: "tool", component: "Tool", status: "success", path: [id], evidence: [], technical });
  const literalNodes = [
    node("literal-name", "Call 2"), node("literal-compact", "Call20"), node("literal-cn", "第2次"),
    node("original-id", "Lookup", { correlation: { toolCallId: "original/Call 2" } }),
    node("callback:2", "Lookup"), node("callback:20", "Lookup"),
    node("split-word", "Call", { correlation: { toolCallId: "2" } }),
    node("encoded-source", "Lookup", { correlation: { toolCallId: "订单/β:42 ✓", invocationId: "调用→甲:原值", entityId: "根/处理器·甲" }, metadata: { sourceNodeId: "原步骤:乙" } }),
  ];
  const original = JSON.stringify(literalNodes);
  const literal = createRunInspectionIndex({ nodes: literalNodes });
  for (const query of ["Call 2", "call2"]) assert.deepEqual(ids(literal.searchSteps(query)), ["literal-name", "original-id"]);
  assert.deepEqual(ids(literal.searchSteps("Call20")), ["literal-compact"], "a literal digit suffix is not a shorter ordinal");
  assert.deepEqual(ids(literal.searchSteps("第 2 次")), ["literal-cn"]);
  assert.deepEqual(ids(literal.searchSteps("第2次")), ["literal-cn"]);
  for (const query of ["订单/β:42 ✓", "调用→甲:原值", "根/处理器·甲", "原步骤:乙"]) {
    assert.deepEqual(ids(literal.searchSteps(query)), ["encoded-source"], "source Unicode and punctuation are not lost to display-ID encoding");
  }
  assert.equal(JSON.stringify(literalNodes), original);

  const stateRows = [
    ["success", {}, ["Success", "Succeeded", "成功"]],
    ["failed", {}, ["Failed", "Error", "失败", "错误"]],
    ["cancelled", {}, ["Cancelled", "已取消"]],
    ["incomplete", {}, ["Incomplete", "Result not recorded", "未完成", "结果未记录"]],
    ["running", {}, ["Running", "End not recorded", "运行中", "结束未记录"]],
    ["declared", {}, ["Declared", "声明"]],
    ["observed", {}, ["Observed", "已观察到"]],
    ["unknown", {}, ["Unknown", "未知"]],
    ["success", { executionState: "planned" }, ["Planned · execution not observed", "仅计划 · 未观察到执行"]],
    ["success", { executionState: "interrupted" }, ["Interrupted", "已中断"]],
    ["success", { executionState: "unrecorded" }, ["Result not recorded", "结果未记录"]],
    ["success", { agentScopeUnresolved: true }, ["Recorded · invocation unconfirmed", "已记录 · 调用归属未确认"]],
    ["failed", { agentScopeUnresolved: true }, ["Failed · invocation unconfirmed", "失败 · 调用归属未确认"]],
  ];
  for (const [status, metadata, queries] of stateRows) {
    const item = { ...node("neutral-id", "neutral-label", { metadata }), status };
    const state = createRunInspectionIndex({ nodes: [item] });
    for (const query of queries) assert.deepEqual(state.searchSteps(query).items, [item], query);
    if (metadata.executionState || metadata.agentScopeUnresolved) {
      for (const query of ["Success", "Succeeded", "成功"]) assert.equal(state.searchSteps(query).total, 0, "display-state metadata takes precedence over generic success");
    }
  }
  const messages = createRunInspectionIndex({ nodes: [node("system", "Message", { metadata: { role: "system" } })] });
  for (const query of ["System message", "系统消息"]) assert.equal(messages.searchSteps(query).total, 1);
  assert.equal(createRunInspectionIndex({ nodes: [node("neutral", "Failed lookup")] }).searchSteps("Failed").total, 1, "ordinary status words are not reserved query syntax");
}
{
  const structural = { nodes: [{
    id: "bounded", label: "Step", status: "success", evidence: [{ envelopeIndex: 0 }, { envelopeIndex: 1 }, { envelopeIndex: 2 }, { envelopeIndex: 3, role: "context" }],
    headline: "private-headline", summary: "private-summary", errorMessage: "private-error",
    input: { items: [{ value: "private-input" }] }, output: { items: [{ value: "private-output" }] },
    technical: { metadata: { argumentsJson: "private-arguments", interruptionReason: "private-reason" } },
  }] };
  const evidence = [
    { kind: "callback.event", payload: { run: { name: "Bounded callback" }, body: "private-callback" } },
    { kind: "component.io", payload: { name: "Bounded component", body: { name: "private-nested-name" } } },
    { kind: "agent.event", payload: { agentName: "Bounded agent", message: { content: "private-message" } } },
    { kind: "component.io", payload: { name: "private-context-name", body: "private-context" } },
  ];
  const before = JSON.stringify({ structural, evidence });
  const bounded = createRunInspectionIndex(structural, evidence);
  for (const query of ["Bounded callback", "Bounded component", "Bounded agent"]) assert.equal(bounded.searchSteps(query).total, 1);
  assert.equal(bounded.searchSteps("private").total, 0, "neither explanatory prose nor business/error bodies enter the index");
  assert.equal(bounded.searchEvidence("private-nested-name").total, 0);
  assert.equal(bounded.searchEvidence("private-context-name").total, 1, "original evidence search semantics are unchanged");
  assert.equal(JSON.stringify({ structural, evidence }), before);
}
console.log("OK: literal ordinal-like names, exact Unicode identities, state precedence and bounded structural indexing");
