import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { explainEino, explainExecutionDAG } from "../src/explanation.js";
import { executionDAGToWorkflowSnapshot } from "../src/execution-dag.js";
import { createRunInspectionIndex } from "../src/inspection.js";
import { buildRepeatedInvocationLabels, buildStepIdentityLabels, workflowPresentationSnapshot } from "../src/renderer-presentation.js";
import { buildReadingStepPresentation, buildWorkflowReadingOrder, readingTerms } from "../src/reading-presentation.js";

assert.deepEqual(readingTerms("en"), {
  runResult: "Run result", finalResult: "Final result", stepOutput: "Output", callResult: "Call result",
  callInput: "Call input", callOutput: "Call output", graphCalls: "Graph calls", workflowHierarchy: "Workflow hierarchy",
  duration: "Duration", rawRecord: "Original record",
});
assert.deepEqual(readingTerms("zh"), {
  runResult: "运行结果", finalResult: "最终结果", stepOutput: "输出", callResult: "调用结果",
  callInput: "调用输入", callOutput: "调用输出", graphCalls: "Graph 调用", workflowHierarchy: "Workflow 层级",
  duration: "耗时", rawRecord: "原始记录",
});
assert.equal(readingTerms(), readingTerms("en"));
assert.equal(readingTerms("unknown"), readingTerms("en"));
assert.equal(readingTerms({ statuses: { success: "成功" } }), readingTerms("zh"));
for (const locale of ["en", "zh"]) {
  assert.equal(Object.isFrozen(readingTerms(locale)), true, "one consumer cannot modify another entry point's terms");
  assert.throws(() => { readingTerms(locale).duration = "Changed"; }, TypeError);
}
console.log("OK: all reading entry points share exact immutable bilingual UI terms without changing source names");

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(name) {
  const record = JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
  const result = projectEinoViewerDocument(record);
  assert.equal(result.ok, true, name);
  const document = result.document;
  const explained = document.execution ? explainExecutionDAG(document.execution, document.evidence) : explainEino(document.evidence);
  assert.equal(explained.ok, true, name);
  return { record, document, explanation: explained.explanation };
}
function readIDs(explanation, kind = "workflow") {
  const order = buildWorkflowReadingOrder(explanation, { kind });
  return [...explanation.nodes].sort((a, b) => order.get(a.id) - order.get(b.id)).map(({ id }) => id);
}

for (const name of ["agent-direct-answer", "agent-repeated-tool", "agent-parallel-same-tool", "agent-nested-parallel-scopes", "agent-deep-nested-distinct-results", "workflow-nested-names", "graph-multistep-loop-success"]) {
  const value = freeze(fixture(name)), { document, explanation } = value;
  const before = JSON.stringify(value);
  const identityLabels = buildStepIdentityLabels(document.execution, document.evidence);
  for (const locale of ["en", "zh"]) {
    const invocationLabels = buildRepeatedInvocationLabels(document.execution, document.evidence, locale);
    const options = { locale, envelopes: document.evidence, identityLabels, invocationLabels };
    const snapshot = executionDAGToWorkflowSnapshot(document.execution);
    const view = workflowPresentationSnapshot(snapshot, locale, undefined, invocationLabels, identityLabels);
    for (const node of document.execution.nodes) {
      const result = buildReadingStepPresentation(node, options);
      const explained = explanation.nodes.find(({ id }) => id === node.id);
      const rendered = view.workflow.nodes.find(({ id }) => id === node.id);
      assert.deepEqual(buildReadingStepPresentation(explained, options), result, `${name}: explanation/canonical parity`);
      assert.deepEqual(buildReadingStepPresentation(rendered, options), result, `${name}: rendered/canonical parity`);
      assert.equal(rendered.metadata.einoViewerPresentation.name, result.name);
      assert.equal(rendered.metadata.einoViewerPresentation.sourceName, node.label);
      if (node.kind === "tool") {
        assert.equal(result.name, node.metadata.toolName);
        assert.equal(result.role, locale === "zh" ? "工具调用" : "Tool call");
      }
      if (node.kind === "input") assert.equal(result.name, locale === "zh" ? "用户输入" : "User input");
      if (node.kind === "output") assert.equal(result.name, locale === "zh" ? "助手输出" : "Assistant output");
      if (node.metadata.agentScopeUnresolved) {
        assert.equal(result.name, "worker");
        assert.equal(result.role, locale === "zh" ? "Agent 证据" : "Agent evidence");
      }
      const expectedTags = [invocationLabels.get(node.id), identityLabels.get(node.id)].filter(Boolean);
      assert.equal(result.title, [result.name, ...expectedTags].join(" · "));
    }
    assert.deepEqual(workflowPresentationSnapshot(view, locale, undefined, invocationLabels, identityLabels), view);
    const other = locale === "en" ? "zh" : "en";
    for (const node of view.workflow.nodes) assert.equal(buildReadingStepPresentation(node, { ...options, locale: other }).name,
      buildReadingStepPresentation(document.execution.nodes.find(({ id }) => id === node.id), { ...options, locale: other }).name,
      "switching language reads sourceName, not the already formatted label");
  }
  assert.equal(JSON.stringify(value), before, `${name}: no source, identity, value, or evidence mutation`);
}
console.log("OK: shared step names, roles and existing identity/visit labels agree across real Agent, Graph and Workflow views");

for (const [role, kind, en, zh] of [
  ["user", "input", "User input", "用户输入"], ["assistant", "input", "Assistant message", "助手消息"],
  ["assistant", "output", "Assistant output", "助手输出"], ["system", "input", "System message", "系统消息"],
  ["tool", "input", "Tool message", "工具消息"],
]) {
  for (const [component, prefix] of [["schema.Message", "schema.message"], ["schema.AgenticMessage", "schema.agentic_message"]]) {
    const node = freeze({ id: role, label: `${prefix} · ${role}`, component, kind, metadata: { role } });
    assert.deepEqual(buildReadingStepPresentation(node), { name: en, title: en });
    assert.deepEqual(buildReadingStepPresentation(node, { locale: "zh" }), { name: zh, title: zh });
  }
}
for (const label of ["tool · quote", "schema.message · user", "agent.event · worker", "component.io · ChatModel · input"]) {
  for (const node of [
    { id: "custom", label, kind: "workflow", component: "Lambda", metadata: { sourceKind: "workflow.snapshot" } },
    { id: "custom", label, kind: "component", component: "Lambda", metadata: {} },
  ]) assert.deepEqual(buildReadingStepPresentation(freeze(node), { locale: "zh" }), { name: label, title: label },
    "a business name that resembles protocol syntax is not stripped");
}
for (const [node, expected] of [
  [{ id: "literal-tool", label: "tool · tool · lookup", kind: "tool", component: "components.Tool", metadata: { toolName: "tool · lookup" } }, "tool · lookup"],
  [{ id: "custom-tool", label: "tool · quote", kind: "tool", component: "components.Tool", metadata: { toolName: "lookup" } }, "tool · quote"],
  [{ id: "literal-agent", label: "agent.event · agent.event · worker", kind: "agent", component: "adk.AgentEvent", metadata: { agentName: "agent.event · worker" } }, "agent.event · worker"],
  [{ id: "custom-agent", label: "agent.event · custom", kind: "agent", component: "adk.AgentEvent", metadata: { agentName: "worker" } }, "agent.event · custom"],
  [{ id: "custom-message", label: "schema.message · custom", kind: "input", component: "schema.Message", metadata: { role: "user" } }, "schema.message · custom"],
  [{ id: "unknown-tool", label: "tool · lookup", kind: "tool", component: "components.Tool", metadata: {} }, "tool · lookup"],
  [{ id: "unknown-role", label: "schema.message · user", kind: "input", component: "schema.Message", metadata: {} }, "schema.message · user"],
  [{ id: "unknown-agent", label: "agent.event · worker", kind: "agent", component: "adk.AgentEvent", metadata: {} }, "agent.event · worker"],
]) assert.equal(buildReadingStepPresentation(freeze(node)).name, expected);
{
  const payload = { agentName: "worker" };
  Object.defineProperty(payload, "body", { get() { throw new Error("body must not be read"); } });
  Object.defineProperty(payload, "output", { get() { throw new Error("output must not be read"); } });
  const node = { id: "event", label: "agent.event · worker", kind: "event", component: "adk.AgentEvent", evidence: [{ envelopeIndex: 0, role: "event", kind: "agent.event" }] };
  assert.deepEqual(buildReadingStepPresentation(node, { envelopes: [{ kind: "agent.event", payload }] }),
    { name: "worker", title: "worker", role: "Agent message" });
  assert.equal(buildReadingStepPresentation({ ...node, evidence: [{ ...node.evidence[0], role: "context" }] }, { envelopes: [{ kind: "agent.event", payload }] }).name, node.label,
    "contextual/forwarded names do not replace an unproven source name");
  assert.equal(buildReadingStepPresentation({ ...node, evidence: [{ ...node.evidence[0], kind: "component.io" }] }, { envelopes: [{ kind: "agent.event", payload }] }).name, node.label);
  const ambiguous = { ...node, evidence: [...node.evidence, { envelopeIndex: 1, role: "event", kind: "agent.event" }] };
  assert.equal(buildReadingStepPresentation(ambiguous, { envelopes: [{ kind: "agent.event", payload }, { kind: "agent.event", payload: { agentName: "other" } }] }).name, node.label);
}
console.log("OK: localized role names use structural facts; custom/protocol-looking business names and business bodies are untouched");

for (const [name, expected] of [
  ["workflow-parallel-join-success", ["prepare", "fast", "slow", "join", "finish"]],
  ["workflow-parallel-join-failed", ["prepare", "fast", "slow"]],
  ["workflow-failed-successor", ["prepare", "fail"]],
  ["workflow-nested-names", ["left", "right", "left-shared", "right-shared"]],
]) {
  const value = freeze(fixture(name)), { explanation, document } = value;
  const before = JSON.stringify(value), sourceOrder = explanation.nodes.map(({ id }) => id);
  assert.deepEqual(readIDs(explanation), expected, `${name}: prerequisites precede dependents`);
  for (const kind of [undefined, "agent", "graph"]) assert.deepEqual(readIDs(explanation, kind ?? "unknown"), sourceOrder, "Workflow is an explicit gate");
  assert.deepEqual([...buildWorkflowReadingOrder(explanation).keys()], sourceOrder);
  assert.deepEqual(createRunInspectionIndex(explanation, document.evidence).searchSteps().items.map(({ id }) => id), sourceOrder,
    "the public inspection API retains canonical source order");
  assert.deepEqual(readIDs({ ...explanation, groups: [...explanation.groups].reverse().map((group) => ({ ...group, nodeIds: [...group.nodeIds].reverse() })) }), expected,
    "group/member array order does not override stable source order inside a dependency layer");
  assert.equal(JSON.stringify(value), before);
}
{
  const { explanation } = freeze(fixture("workflow-parallel-join-success"));
  const order = buildWorkflowReadingOrder(explanation, { kind: "workflow" });
  const filtered = explanation.nodes.filter(({ id }) => ["finish", "join", "slow"].includes(id));
  assert.deepEqual(filtered.sort((a, b) => order.get(a.id) - order.get(b.id)).map(({ id }) => id), ["slow", "join", "finish"]);
  assert.equal(order.get("finish"), 4, "filtering does not create a new rank or mutate the full-run map");
}
for (const name of ["graph-multistep-loop-success", "agent-nested-parallel-scopes", "workflow-definition-only"]) {
  const { document, explanation } = freeze(fixture(name));
  assert.deepEqual(readIDs(explanation, document.kind), explanation.nodes.map(({ id }) => id), `${name}: not a sortable observed Workflow scope`);
}
console.log("OK: real Workflow branches read by dependency with stable sibling order; Graph/Agent and public inspection source order stay unchanged");

function orderedScope(prefix = "") {
  const path = (id) => prefix ? [prefix, id] : [id];
  const nodes = ["finish", "slow", "prepare", "fast"].map((id) => ({ id: `${prefix}${id}`, label: id, kind: "workflow", basis: "observed",
    technical: { metadata: { sourceKind: "workflow.snapshot", sourceNodePath: path(id) } }, causes: [], effects: [] }));
  const add = (from, to, relation = "data") => {
    nodes.find(({ id }) => id === `${prefix}${from}`).effects.push({ nodeId: `${prefix}${to}`, relation, basis: "observed" });
    nodes.find(({ id }) => id === `${prefix}${to}`).causes.push({ nodeId: `${prefix}${from}`, relation, basis: "observed" });
  };
  add("prepare", "slow", "control"); add("prepare", "fast"); add("slow", "finish"); add("fast", "finish");
  return { nodes, groups: [{ id: `scope-${prefix}`, kind: "workflow", basis: "observed", nodeIds: nodes.map(({ id }) => id) }] };
}
assert.deepEqual(readIDs(orderedScope()), ["prepare", "slow", "fast", "finish"], "same dependency layer preserves source order, not alphabetical or finish-time order");
for (const [scenario, mutate] of [
  ["no groups", (value) => { value.groups = []; }],
  ["wrong group kind", (value) => { value.groups[0].kind = "graph"; }],
  ["declared group", (value) => { value.groups[0].basis = "declared"; }],
  ["duplicate node ID", (value) => value.nodes.push(structuredClone(value.nodes[0]))],
  ["duplicate membership", (value) => value.groups.push(structuredClone(value.groups[0]))],
  ["duplicate group member", (value) => value.groups[0].nodeIds.push(value.nodes[0].id)],
  ["missing group member", (value) => value.groups[0].nodeIds.push("missing")],
  ["missing endpoint", (value) => { value.nodes[0].causes[0].nodeId = "missing"; }],
  ["missing reverse edge", (value) => { value.nodes[0].causes.pop(); }],
  ["inferred dependency", (value) => { value.nodes[0].causes[0].basis = "inferred"; }],
  ["missing causal lists", (value) => { delete value.nodes[0].effects; }],
  ["unreliable node", (value) => { value.nodes[0].basis = "declared"; }],
  ["wrong source kind", (value) => { value.nodes[0].technical.metadata.sourceKind = "callback.event"; }],
  ["missing source path", (value) => { delete value.nodes[0].technical.metadata.sourceNodePath; }],
  ["ambiguous source path", (value) => { value.nodes[0].technical.metadata.sourceNodePath = value.nodes[1].technical.metadata.sourceNodePath; }],
  ["mixed scope", (value) => { value.nodes[0].technical.metadata.sourceNodePath = ["nested", "finish"]; }],
  ["cycle", (value) => { value.nodes[0].effects.push({ nodeId: "prepare", relation: "data", basis: "observed" }); value.nodes[2].causes.push({ nodeId: "finish", relation: "data", basis: "observed" }); }],
  ["only non-dependency edges", (value) => value.nodes.forEach((node) => [...node.causes, ...node.effects].forEach((edge) => { edge.relation = "sequence"; }))],
  ["isolated member", (value) => { const node = structuredClone(value.nodes[0]); node.id = "isolated"; node.technical.metadata.sourceNodePath = ["isolated"]; node.causes = []; node.effects = []; value.nodes.push(node); value.groups[0].nodeIds.push(node.id); }],
]) {
  const value = orderedScope(); mutate(value);
  const before = JSON.stringify(value);
  assert.deepEqual(readIDs(value), value.nodes.map(({ id }) => id), `${scenario}: conservative source order`);
  assert.equal(JSON.stringify(value), before, scenario);
}
{
  const left = orderedScope("left"), right = orderedScope("right");
  const value = freeze({ nodes: left.nodes.flatMap((node, index) => [node, right.nodes[index]]), groups: [...right.groups, ...left.groups] });
  assert.deepEqual(readIDs(value), ["leftprepare", "rightprepare", "leftslow", "rightslow", "leftfast", "rightfast", "leftfinish", "rightfinish"],
    "same local names in separate scopes only reorder their own slots");
}
console.log("OK: incomplete, ambiguous, cross-scope and cyclic dependencies never invent a reading order");
