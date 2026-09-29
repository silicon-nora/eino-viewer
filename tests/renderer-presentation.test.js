import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { executionDAGToWorkflowSnapshot } from "../src/execution-dag.js";
import { buildRepeatedInvocationLabels, buildStepIdentityLabels, workflowAccessibilityLabel, workflowNodeLabel, workflowPresentationSnapshot } from "../src/renderer-presentation.js";

function snapshot(nodes, outcomes = []) {
  return { schemaVersion: 1, workflow: { name: "run", nodes, edges: [] }, execution: { id: "run", nodes: outcomes } };
}
const tool = (id = "lookup", metadata = {}) => ({ id, name: `tool · ${id}`, component: "components.Tool", kind: "tool",
  metadata: { executionKind: "tool", executionStatus: "success", toolName: id, ...metadata } });
const boundary = (start, end, extra = {}) => ({ semantics: "recorded-boundaries", availability: "available",
  basis: "callback", startedAtMs: start, finishedAtMs: end, durationMs: end - start, ...extra });
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const projectedNode = (source, timing, locale = "en") => workflowPresentationSnapshot(source, locale, timing).workflow.nodes[0];

for (const locale of ["en", "zh"]) {
  const source = freeze(snapshot([
    tool(),
    { id: "message", name: "schema.message · user", component: "schema.Message", kind: "data", metadata: { executionKind: "input", executionStatus: "success", role: "user" } },
    { id: "turn", name: "component.io · ChatModel · input", component: "components.ChatModel", kind: "llm", metadata: { executionKind: "agent", executionStatus: "success", correlation: { agentName: "researcher" } } },
  ], [{ path: ["lookup"], status: "success" }, { path: ["message"], status: "success" }, { path: ["turn"], status: "success" }]));
  const before = JSON.stringify(source), view = workflowPresentationSnapshot(source, locale);
  assert.equal(workflowNodeLabel(view.workflow.nodes[0]), "lookup\nTool");
  assert.equal(workflowNodeLabel(view.workflow.nodes[1]), `${locale === "zh" ? "用户输入" : "User input"}\nMessage`);
  assert.equal(workflowNodeLabel(view.workflow.nodes[2]), "researcher\nChatModel");
  assert.ok(view.workflow.nodes.every((node) => !Object.hasOwn(node.metadata.einoViewerPresentation, "timing")));
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(workflowPresentationSnapshot(view, locale), view, "display labels are idempotent");
  const changedLocale = locale === "zh" ? "en" : "zh";
  assert.equal(workflowPresentationSnapshot(view, changedLocale).workflow.nodes[1].metadata.einoViewerPresentation.name,
    changedLocale === "zh" ? "用户输入" : "User input", "locale changes re-read the original generated label");
  const summary = workflowAccessibilityLabel({ nodeCount: 3, edgeCount: 0 }, { nodes: view.workflow.nodes }, locale);
  assert.match(summary, locale === "zh" ? /成功: 3/ : /Succeeded: 3/);
  assert.doesNotMatch(summary, /Duration not recorded|耗时未记录/);
}
console.log("OK: graph nodes keep concise names and types without repeated missing-time prose");

for (const locale of ["en", "zh"]) {
  const source = freeze(snapshot([
    { id: "uncertain", name: "agent.event · worker", component: "adk.AgentEvent", kind: "data", metadata: { executionKind: "event", executionStatus: "success", agentScopeUnresolved: true, runPath: ["worker"] } },
    { id: "error", name: "agent.event · worker", component: "adk.AgentEvent", kind: "data", metadata: { executionKind: "event", executionStatus: "failed", agentScopeUnresolved: true, runPath: ["worker"] } },
    tool("planned", { executionState: "planned", executionStatus: "incomplete" }),
    tool("failed", { executionStatus: "failed" }),
    tool("cancelled", { executionStatus: "cancelled" }),
    tool("interrupted", { executionState: "interrupted", executionStatus: "incomplete" }),
    tool("unfinished", { executionStatus: "running" }),
    tool("skipped", { executionStatus: "skipped" }),
  ], [{ path: ["uncertain"], status: "success" }, { path: ["error"], status: "failed", errorMessage: "original error" },
    { path: ["failed"], status: "failed" }, { path: ["unfinished"], status: "skipped" }]));
  const timings = new Map(source.workflow.nodes.map(({ id }) => [id, boundary(10, 20)]));
  const view = workflowPresentationSnapshot(source, locale, timings);
  assert.equal(view.execution.nodes.some(({ path }) => path[0] === "uncertain"), false, "no successful-call color for uncertain evidence");
  assert.equal(view.execution.nodes.some(({ path }) => path[0] === "unfinished"), false, "keyboard descriptions cannot call an unfinished step skipped");
  assert.equal(view.execution.nodes.find(({ path }) => path[0] === "error").errorMessage, "original error");
  for (const node of view.workflow.nodes.slice(0, 2)) {
    const label = workflowNodeLabel(node);
    assert.equal((label.match(locale === "zh" ? /调用归属未确认/g : /invocation unconfirmed/gi) || []).length, 1);
    assert.match(label, locale === "zh" ? /调用归属未确认/ : /invocation unconfirmed/i);
    assert.match(node.name, locale === "zh" ? /调用归属未确认/ : /invocation unconfirmed/i, "keyboard source name preserves uncertainty");
    assert.equal(node.metadata.einoViewerPresentation.name, "worker");
    assert.equal(node.metadata.einoViewerPresentation.timing, undefined, "unassigned evidence has no confirmed call duration");
  }
  const expected = locale === "zh" ? ["仅计划", "失败", "已取消", "已中断", "结束未记录", "已跳过"]
    : ["Planned only", "Failed", "Cancelled", "Interrupted", "End not recorded", "Skipped"];
  view.workflow.nodes.slice(2).forEach((node, index) => {
    assert.equal(node.metadata.einoViewerPresentation.state, expected[index]);
    assert.ok(workflowNodeLabel(node).includes(expected[index]));
    assert.ok(node.name.includes(expected[index]), "keyboard source name preserves exceptional status");
  });
  assert.equal(view.workflow.nodes[2].metadata.einoViewerPresentation.timing, undefined, "planned work has no execution duration");
  assert.equal(source.workflow.nodes[0].metadata.executionStatus, "success", "canonical state is unchanged");
}
console.log("OK: uncertain, failed, planned and incomplete states remain visible and keyboard-readable");

const untimed = freeze(snapshot([tool()], [{ path: ["lookup"], status: "success", durationMs: 99 }]));
const timed = (timing) => projectedNode(untimed, new Map([["lookup", timing]]));
assert.equal(timed(boundary(12, 12)).metadata.einoViewerPresentation.timing, "0 ms");
assert.equal(timed(boundary(0, 25)).metadata.einoViewerPresentation.timing, "25 ms");
for (const value of [
  { durationMs: 0 },
  { semantics: "recorded-boundaries", availability: "available", durationMs: 9 },
  boundary(0, 15, { semantics: "observed-span" }),
  boundary(0, 15, { semantics: "observed-at" }),
  boundary(0, 15, { semantics: "declared-duration" }),
  boundary(0, 15, { availability: "partial" }),
  boundary(0, 15, { availability: "invalid" }),
  boundary(0, 15, { durationMs: 17 }),
  boundary(15, 0),
  boundary(-1, 15),
  boundary(0.5, 15),
  boundary(0, NaN),
  boundary(0, Infinity),
]) {
  assert.equal(timed(value).metadata.einoViewerPresentation.timing, undefined, JSON.stringify(value));
  assert.doesNotMatch(workflowNodeLabel(timed(value)), /\bms\b/);
}
assert.equal(projectedNode(untimed).metadata.einoViewerPresentation.timing, undefined, "duration-only workflow values do not establish boundaries");
const recorded = freeze(snapshot([tool()], [{ path: ["lookup"], status: "success", startedAtMs: 10, finishedAtMs: 10, durationMs: 99 }]));
assert.equal(projectedNode(recorded).metadata.einoViewerPresentation.timing, "0 ms", "recorded snapshot boundaries take precedence over supplied duration");
assert.equal(projectedNode(recorded, new Map([["lookup", { availability: "invalid", semantics: "not-observed" }]])).metadata.einoViewerPresentation.timing, undefined,
  "invalid authoritative timing cannot fall back to snapshot timestamps");
console.log("OK: only valid recorded boundary pairs display duration; zero is preserved and unknown is never zero");

const nested = freeze(snapshot([
  { id: "left", name: "Left", component: "Workflow", kind: "workflow", workflow: { nodes: [tool("shared")], edges: [] } },
  { id: "right", name: "Right", component: "Workflow", kind: "workflow", workflow: { nodes: [tool("shared")], edges: [] } },
], [{ path: ["left", "shared"], status: "success", startedAtMs: 100, finishedAtMs: 103 },
  { path: ["right", "shared"], status: "success", startedAtMs: 100, finishedAtMs: 109 }]));
const scopedTimes = new Map([["left/shared", boundary(0, 2)], ["right/shared", boundary(0, 7)], ["shared", boundary(0, 99)]]);
const nestedView = workflowPresentationSnapshot(nested, "en", scopedTimes);
assert.equal(nestedView.workflow.nodes[0].workflow.nodes[0].metadata.einoViewerPresentation.timing, "2 ms");
assert.equal(nestedView.workflow.nodes[1].workflow.nodes[0].metadata.einoViewerPresentation.timing, "7 ms");
assert.deepEqual(workflowPresentationSnapshot(nestedView, "en", scopedTimes), nestedView);
const withoutPathMatch = workflowPresentationSnapshot(nested, "en", new Map([["shared", boundary(0, 99)]]));
assert.equal(withoutPathMatch.workflow.nodes[0].workflow.nodes[0].metadata.einoViewerPresentation.timing, "3 ms");
assert.equal(withoutPathMatch.workflow.nodes[1].workflow.nodes[0].metadata.einoViewerPresentation.timing, "9 ms");
const definition = freeze({ schemaVersion: 1, workflow: { nodes: [{ id: "plain", name: "components.Tool · custom", component: "components.Tool", kind: "tool" }], edges: [] } });
assert.deepEqual(workflowPresentationSnapshot(definition), definition, "declarations gain no outcome or execution timing");
assert.equal(workflowNodeLabel(definition.workflow.nodes[0]), "components.Tool · custom\nTool");
assert.equal(workflowNodeLabel({ id: "same", name: "ChatModel", component: "components.ChatModel" }), "ChatModel", "identical name and type are not repeated");
console.log("OK: same-name nested nodes use full paths; declared names and canonical snapshots remain unchanged");

for (const name of ["graph-multistep-loop-success", "graph-multistep-loop-failed"]) {
  const record = freeze(JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8")));
  const projected = projectEinoViewerDocument(record);
  assert.equal(projected.ok, true);
  const execution = projected.document.execution;
  const original = JSON.stringify({ record, execution });
  const evaluations = execution.nodes.filter(({ label }) => label === "evaluate");
  const revisions = execution.nodes.filter(({ label }) => label === "revise");
  const expectedEvaluations = name.endsWith("success") ? 3 : 2;
  assert.equal(evaluations.length, expectedEvaluations);
  const canonical = executionDAGToWorkflowSnapshot(execution);
  for (const language of ["zh", "en"]) {
    const labels = buildRepeatedInvocationLabels(execution, record.evidence, language);
    const expected = (index) => language === "zh" ? `第 ${index + 1} 次` : `Call ${index + 1}`;
    evaluations.forEach(({ id }, index) => assert.equal(labels.get(id), expected(index)));
    revisions.forEach(({ id }, index) => assert.equal(labels.get(id), revisions.length > 1 ? expected(index) : undefined));
    assert.equal(labels.size, expectedEvaluations + (revisions.length > 1 ? revisions.length : 0));
    const view = workflowPresentationSnapshot(canonical, language, undefined, labels);
    evaluations.forEach(({ id }, index) => {
      const node = view.workflow.nodes.find((entry) => entry.id === id);
      assert.equal(node.metadata.einoViewerPresentation.sourceName, "evaluate");
      assert.equal(node.metadata.einoViewerPresentation.name, "evaluate");
      assert.equal(node.metadata.einoViewerPresentation.invocation, expected(index));
      assert.equal(workflowNodeLabel(node).split("\n")[0], "evaluate");
      assert.ok(workflowNodeLabel(node).split("\n")[1].includes(expected(index)), "visit tag belongs on the secondary line");
      assert.ok(node.name.includes(expected(index)), "renderer keyboard name identifies the same visit");
    });
    assert.deepEqual(workflowPresentationSnapshot(view, language, undefined, labels), view);
    assert.deepEqual(workflowPresentationSnapshot(view, language), view, "repeat formatting retains presentation-only visit labels");
    const finalEvaluation = evaluations.at(-1);
    const subset = { ...canonical, workflow: { ...canonical.workflow, nodes: canonical.workflow.nodes.filter(({ id }) => id === finalEvaluation.id) } };
    const scoped = workflowPresentationSnapshot(subset, language, undefined, labels);
    assert.equal(scoped.workflow.nodes[0].metadata.einoViewerPresentation.invocation, expected(expectedEvaluations - 1), "scope/search subsets keep full-run visit numbering");
    const reversed = { ...execution, nodes: [...execution.nodes].reverse(), edges: [...execution.edges].reverse() };
    assert.deepEqual([...buildRepeatedInvocationLabels(reversed, record.evidence, language)].sort(), [...labels].sort(), "node/edge array order does not establish invocation order");
    const opposite = language === "zh" ? "en" : "zh";
    const translated = workflowPresentationSnapshot(view, opposite, undefined, buildRepeatedInvocationLabels(execution, record.evidence, opposite));
    assert.equal(translated.workflow.nodes.find(({ id }) => id === evaluations[0].id).metadata.einoViewerPresentation.invocation, opposite === "zh" ? "第 1 次" : "Call 1");
  }
  if (evaluations.length === 3) {
    for (const damage of ["boundary", "parent"]) {
      const partial = structuredClone(execution);
      if (damage === "boundary") partial.nodes.find(({ id }) => id === evaluations[0].id).evidence = evaluations[0].evidence.filter(({ role }) => role !== "end");
      else partial.edges = partial.edges.filter((edge) => !(edge.kind === "parent-child" && edge.to === evaluations[0].id));
      const labels = buildRepeatedInvocationLabels(partial, record.evidence);
      assert.ok(evaluations.every(({ id }) => !labels.has(id)), `a missing ${damage} cannot make the remaining calls become Call 1/2`);
      assert.equal(labels.size, 2, "an unrelated intact repetition group remains readable");
    }
  }
  assert.equal(JSON.stringify({ record, execution }), original, "numbering cannot modify canonical labels, values, evidence or identities");
}
console.log("OK: real Graph loops have evidence-backed per-source visit labels, stable through filtering, localization and re-rendering");

function repeatedCallbacks({ parallel = false, paths = [["repeat"], ["repeat"]] } = {}) {
  const runId = "invocation-label-test";
  const root = { id: "root", kind: "component", label: "Graph", component: "Graph", status: "success",
    correlation: { runId, entityId: "runnable:graph", invocationId: "root-call" }, evidence: [], metadata: {} };
  const nodes = [root, ...paths.map((path, index) => ({ id: `visit-${index}`, kind: "component", label: "Same name", component: "Lambda", status: "success",
    correlation: { runId, entityId: `entity:${JSON.stringify(path)}`, invocationId: `call-${index}`, parentEntityId: root.correlation.entityId }, evidence: [], metadata: {} }))];
  const envelopes = [];
  const append = (index, phase) => {
    const node = nodes[index], envelopeIndex = envelopes.length;
    const path = index === 0 ? [] : paths[index - 1];
    envelopes.push({ kind: "callback.event", correlation: { ...node.correlation, eventId: `event-${envelopeIndex}` },
      payload: { phase, streaming: false, sequence: envelopeIndex + 1, timestampMs: 0,
        address: [{ type: "runnable", id: "graph" }, ...path.map((id) => ({ type: "node", id }))], nodePath: path, run: { component: node.component } } });
    node.evidence.push({ kind: "callback.event", role: phase, envelopeIndex });
  };
  for (const [index, phase] of parallel
    ? [[0, "start"], [1, "start"], [2, "start"], [2, "end"], [1, "end"], [0, "end"]]
    : [[0, "start"], [1, "start"], [1, "end"], [2, "start"], [2, "end"], [0, "end"]]) append(index, phase);
  return { execution: { schemaVersion: 1, runId, nodes, edges: nodes.slice(1).map(({ id }) => ({ from: root.id, to: id, kind: "parent-child" })) }, envelopes };
}
const repeated = repeatedCallbacks();
assert.deepEqual([...buildRepeatedInvocationLabels(repeated.execution, repeated.envelopes)], [["visit-0", "Call 1"], ["visit-1", "Call 2"]]);
for (const [scenario, mutate] of [
  ["missing start", ({ execution }) => execution.nodes[1].evidence.shift()],
  ["missing terminal", ({ execution }) => execution.nodes[1].evidence.pop()],
  ["missing explicit terminal invocation identity", ({ envelopes }) => delete envelopes[2].correlation.invocationId],
  ["duplicate invocation identity", ({ execution, envelopes }) => {
    execution.nodes[2].correlation.invocationId = "call-0";
    envelopes[3].correlation.invocationId = envelopes[4].correlation.invocationId = "call-0";
  }],
  ["duplicate projected node identity", ({ execution }) => execution.nodes.push(structuredClone(execution.nodes[1]))],
  ["duplicate source terminal", ({ envelopes }) => envelopes.push(structuredClone(envelopes[2]))],
  ["duplicate node boundary reference", ({ execution }) => execution.nodes[1].evidence.push({ ...execution.nodes[1].evidence[1] })],
  ["unresolved callback identity", ({ execution }) => { execution.nodes[1].metadata.callbackCorrelation = "unresolved"; }],
  ["unresolved source scope", ({ execution }) => { execution.nodes[1].metadata.agentScopeUnresolved = true; }],
  ["stream callback", ({ envelopes }) => { envelopes[1].payload.streaming = true; }],
  ["terminal source address mismatch", ({ envelopes }) => { envelopes[2].payload.address[1].id = "other"; }],
  ["terminal source path mismatch", ({ envelopes }) => { envelopes[2].payload.nodePath = ["other"]; }],
  ["terminal component mismatch", ({ envelopes }) => { envelopes[2].payload.run.component = "Tool"; }],
  ["terminal entity mismatch", ({ envelopes }) => { envelopes[2].correlation.entityId = "another-entity"; }],
  ["terminal run mismatch", ({ envelopes }) => { envelopes[2].correlation.runId = "another-run"; }],
  ["missing direct parent call", ({ execution }) => { execution.edges = execution.edges.filter(({ to }) => to !== "visit-0"); }],
  ["ambiguous direct parent call", ({ execution }) => execution.edges.push({ from: "root", to: "visit-0", kind: "parent-child" })],
  ["parent without terminal boundary", ({ execution }) => execution.nodes[0].evidence.pop()],
  ["terminal after parent terminal", ({ execution, envelopes }) => {
    [envelopes[4], envelopes[5]] = [envelopes[5], envelopes[4]];
    execution.nodes[0].evidence[1].envelopeIndex = 4;
    execution.nodes[2].evidence[1].envelopeIndex = 5;
  }],
]) {
  const value = repeatedCallbacks();
  mutate(value);
  assert.equal(buildRepeatedInvocationLabels(value.execution, value.envelopes).size, 0, scenario);
}
const overlapping = repeatedCallbacks({ parallel: true });
assert.equal(buildRepeatedInvocationLabels(overlapping.execution, overlapping.envelopes).size, 0, "overlapping calls cannot acquire a sequential visit number");
const differentPaths = repeatedCallbacks({ paths: [["left", "shared"], ["right", "shared"]] });
assert.equal(buildRepeatedInvocationLabels(differentPaths.execution, differentPaths.envelopes).size, 0, "same name/local ID in different full paths is not repetition");
const sameEntityDifferentPath = repeatedCallbacks();
for (const index of [3, 4]) sameEntityDifferentPath.envelopes[index].payload.nodePath = ["other"];
assert.equal(buildRepeatedInvocationLabels(sameEntityDifferentPath.execution, sameEntityDifferentPath.envelopes).size, 0, "entity ID alone is not complete source identity");
const sameEntityDifferentAddress = repeatedCallbacks();
for (const index of [3, 4]) sameEntityDifferentAddress.envelopes[index].payload.address[0].subId = "another-source";
assert.equal(buildRepeatedInvocationLabels(sameEntityDifferentAddress.execution, sameEntityDifferentAddress.envelopes).size, 0, "the full address includes outer invocation subIds");
const differentParents = repeatedCallbacks();
const outer = structuredClone(differentParents.execution.nodes[0]);
outer.id = "other-parent";
outer.correlation.invocationId = "other-parent-call";
const outerStart = structuredClone(differentParents.envelopes[0]), outerEnd = structuredClone(differentParents.envelopes.at(-1));
outerStart.correlation.invocationId = outerEnd.correlation.invocationId = outer.correlation.invocationId;
differentParents.execution.nodes.forEach((node) => node.evidence.forEach((reference) => { reference.envelopeIndex++; }));
differentParents.envelopes.unshift(outerStart);
differentParents.envelopes.push(outerEnd);
outer.evidence = [{ kind: "callback.event", role: "start", envelopeIndex: 0 }, { kind: "callback.event", role: "end", envelopeIndex: differentParents.envelopes.length - 1 }];
differentParents.execution.nodes.push(outer);
differentParents.execution.edges[1].from = outer.id;
const parentLabels = buildRepeatedInvocationLabels(differentParents.execution, differentParents.envelopes);
assert.equal(parentLabels.has("visit-0"), false);
assert.equal(parentLabels.has("visit-1"), false, "same source under different direct parent invocations is not one repetition group");
console.log("OK: parallel, incomplete, ambiguous, different-path and different-parent callbacks receive no invented invocation order");

function identityFixture(name) {
  const record = JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
  const projected = projectEinoViewerDocument(record);
  assert.equal(projected.ok, true);
  return { execution: structuredClone(projected.document.execution), envelopes: structuredClone(record.evidence) };
}

for (const [name, expected] of [
  ["agent-repeated-tool", [["tool:lookup_item:call-repeat-1", "call-repeat-1"], ["tool:lookup_item:call-repeat-2", "call-repeat-2"]]],
  ["agent-parallel-same-tool", [["tool:lookup_item:call-slow", "call-slow"], ["tool:lookup_item:call-fast", "call-fast"]]],
  ["agent-nested-parallel-scopes", [["tool:worker:call-child-slow", "call-child-slow"], ["tool:worker:call-child-fast", "call-child-fast"],
    ["nested:2:tool:lookup_item:shared-inner-call", "call-child-slow / shared-inner-call"], ["nested:3:tool:lookup_item:shared-inner-call", "call-child-fast / shared-inner-call"]]],
  ["agent-deep-nested-distinct-results", [["tool:worker:shared-depth-call", "shared-depth-call"], ["nested:2:tool:worker:shared-depth-call", "shared-depth-call / shared-depth-call"]]],
  ["workflow-nested-names", [["left-shared", "left / shared"], ["right-shared", "right / shared"]]],
]) {
  const value = freeze(identityFixture(name)), before = JSON.stringify(value);
  assert.equal(buildRepeatedInvocationLabels(value.execution, value.envelopes).size, 0,
    `${name}: names, tool-call IDs, paths and model turns without Graph callback boundaries do not justify visit numbering`);
  const labels = buildStepIdentityLabels(value.execution, value.envelopes);
  assert.deepEqual([...labels], expected, name);
  assert.ok([...labels.values()].every((label) => !/^(?:Call \d|第 \d)/.test(label)), "IDs and paths are not invocation ordinals");
  assert.deepEqual([...buildStepIdentityLabels({ ...value.execution, nodes: [...value.execution.nodes].reverse() }, value.envelopes)].sort(), [...labels].sort(), "source identity is independent of node order");
  const canonical = executionDAGToWorkflowSnapshot(value.execution);
  for (const language of ["en", "zh"]) {
    const view = workflowPresentationSnapshot(canonical, language, undefined, undefined, labels);
    for (const [id, label] of labels) {
      const original = canonical.workflow.nodes.find((node) => node.id === id), rendered = view.workflow.nodes.find((node) => node.id === id);
      assert.equal(rendered.metadata.einoViewerPresentation.sourceName, original.name);
      assert.equal(rendered.metadata.einoViewerPresentation.identity, label);
      assert.ok(workflowNodeLabel(rendered).split("\n")[1].includes(label), "identity is on the secondary diagram line");
      assert.ok(rendered.name.includes(label), "keyboard node names identify the same source");
    }
    assert.deepEqual(workflowPresentationSnapshot(view, language, undefined, undefined, labels), view);
    assert.deepEqual(workflowPresentationSnapshot(view, language), view, "formatting twice retains source identity without appending it twice");
    const selected = expected.at(-1)[0];
    const subset = { ...canonical, workflow: { ...canonical.workflow, nodes: canonical.workflow.nodes.filter(({ id }) => id === selected) } };
    assert.equal(workflowPresentationSnapshot(subset, language, undefined, undefined, labels).workflow.nodes[0].metadata.einoViewerPresentation.identity, labels.get(selected), "full-run labels survive a one-node filtered view");
    const opposite = language === "en" ? "zh" : "en";
    assert.equal(workflowPresentationSnapshot(view, opposite, undefined, undefined, labels).workflow.nodes.find(({ id }) => id === selected).metadata.einoViewerPresentation.identity, labels.get(selected), "localization never translates raw identity facts");
    const cleared = workflowPresentationSnapshot(view, language, undefined, undefined, new Map());
    assert.ok(cleared.workflow.nodes.every((node) => !node.metadata.einoViewerPresentation?.identity), "a new full-run map clears stale identity hints");
  }
  assert.equal(JSON.stringify(value), before, "identity labels never mutate original business values, paths or canonical labels");
}
console.log("OK: real same-name Agent tools and Workflow steps display source call IDs and full paths without inventing order");

function toolSources(value, node) {
  return node.evidence.map(({ envelopeIndex }) => value.envelopes[envelopeIndex]).filter((envelope) => envelope.kind === "component.io" && envelope.payload.component === "Tool");
}
for (const [scenario, mutate] of [
  ["missing call ID", (value, first) => { delete first.correlation.toolCallId; delete first.metadata.toolCallId; }],
  ["conflicting metadata ID", (value, first) => { first.metadata.toolCallId = "another-call"; }],
  ["explicit empty correlation ID", (value, first) => { first.correlation.toolCallId = ""; }],
  ["wrong addressed Tool ID", (value, first) => { toolSources(value, first)[0].payload.address.at(-1).subId = "another-call"; }],
  ["wrong addressed Tool name", (value, first) => { toolSources(value, first)[0].payload.address.at(-1).id = "another-tool"; }],
  ["wrong recorded Tool name", (value, first) => { toolSources(value, first)[0].payload.name = "another-tool"; }],
  ["multiple complete source addresses", (value, first) => { toolSources(value, first)[0].payload.address[2].id = "another-location"; }],
  ["foreign run source", (value, first) => { toolSources(value, first)[0].correlation.runId = "another-run"; }],
  ["unconfirmed scope", (value, first) => { first.metadata.agentScopeUnresolved = true; }],
  ["forged confirmed scope", (value, first) => { first.metadata.agentScopeId = "agent:some-other-scope"; }],
  ["forged Agent path", (value, first) => { first.metadata.agentScopePath = ["not-the-observed-agent"]; }],
  ["no own addressed Tool I/O", (value, first) => { first.evidence = first.evidence.filter(({ envelopeIndex }) => value.envelopes[envelopeIndex].payload?.component !== "Tool"); }],
  ["duplicate projected ID", (value, first) => { value.execution.nodes.push(structuredClone(first)); }],
  ["duplicate complete source identity", (value, first, second) => {
    second.correlation.toolCallId = second.metadata.toolCallId = first.correlation.toolCallId;
    for (const source of toolSources(value, second)) source.payload.address.at(-1).subId = first.correlation.toolCallId;
  }],
  ["different source names need no disambiguation", (value, first, second) => {
    second.metadata.toolName = "different_tool";
    second.label = "tool · different_tool";
    for (const source of toolSources(value, second)) { source.payload.name = "different_tool"; source.payload.address.at(-1).id = "different_tool"; }
  }],
]) {
  const value = identityFixture("agent-parallel-same-tool"), tools = value.execution.nodes.filter(({ kind }) => kind === "tool");
  mutate(value, tools[0], tools[1]);
  assert.equal(buildStepIdentityLabels(value.execution, value.envelopes).size, 0, scenario);
}
const arbitraryBody = identityFixture("agent-parallel-same-tool");
for (const node of arbitraryBody.execution.nodes.filter(({ kind }) => kind === "tool")) for (const source of toolSources(arbitraryBody, node)) {
  source.payload.body = { tool_call_id: "not-source-identity", path: "not-source-path", order: 99 };
}
assert.deepEqual([...buildStepIdentityLabels(arbitraryBody.execution, arbitraryBody.envelopes)], [["tool:lookup_item:call-slow", "call-slow"], ["tool:lookup_item:call-fast", "call-fast"]], "business fields cannot override source identity");
for (const distinguishable of [true, false]) {
  const value = identityFixture("agent-parallel-same-tool"), tools = value.execution.nodes.filter(({ kind }) => kind === "tool");
  tools.forEach((node, index) => {
    node.correlation.toolCallId = node.metadata.toolCallId = "shared-call";
    for (const source of toolSources(value, node)) {
      source.payload.address.at(-1).subId = "shared-call";
      if (distinguishable) source.payload.address[0].id = index === 0 ? "left-agent" : "right-agent";
      else source.payload.address[2].id = index === 0 ? "left-location" : "right-location";
    }
  });
  const labels = buildStepIdentityLabels(value.execution, value.envelopes);
  if (distinguishable) assert.deepEqual([...labels.values()], ["left-agent / shared-call", "right-agent / shared-call"], "same call IDs use verified Agent paths when caller IDs alone do not distinguish them");
  else assert.equal(labels.size, 0, "still-colliding scope text is left unqualified, never assigned an invented index");
}
for (const name of ["agent-redacted-tool", "graph-multistep-loop-success", "graph-multistep-loop-failed", "workflow-parallel-join-success"]) {
  const value = identityFixture(name);
  assert.equal(buildStepIdentityLabels(value.execution, value.envelopes).size, 0, `${name}: unique names and Graph visits keep their existing display semantics`);
}
console.log("OK: unknown, conflicting and duplicate Tool identities are not assigned fabricated scope or suffixes");

for (const [scenario, mutate] of [
  ["missing source path", (value, node) => { delete node.metadata.sourceNodePath; }],
  ["forged source path", (value, node) => { node.metadata.sourceNodePath = ["right", "shared"]; }],
  ["no linked definition", (value, node) => { node.evidence = node.evidence.filter(({ kind }) => kind !== "workflow.snapshot"); }],
  ["conflicting definition name", (value) => { value.envelopes[0].payload.workflow.nodes.find(({ id }) => id === "left").workflow.nodes[0].name = "Different name"; }],
  ["conflicting own I/O path", (value, node) => { value.envelopes[node.evidence.find(({ kind }) => kind === "component.io").envelopeIndex].payload.nodePath = ["right", "shared"]; }],
]) {
  const value = identityFixture("workflow-nested-names"), node = value.execution.nodes.find(({ id }) => id === "left-shared");
  mutate(value, node);
  assert.equal(buildStepIdentityLabels(value.execution, value.envelopes).size, 0, scenario);
}
function workflowIdentityPaths(paths) {
  const runId = "identity-path-run", workflow = { nodes: [], edges: [] };
  const nodes = paths.map((path, index) => {
    let graph = workflow;
    for (const [partIndex, id] of path.entries()) {
      let node = graph.nodes.find((entry) => entry.id === id);
      if (!node) { node = { id, name: partIndex === path.length - 1 ? "Same step" : id, component: partIndex === path.length - 1 ? "Lambda" : "Workflow" }; graph.nodes.push(node); }
      if (partIndex !== path.length - 1) { node.workflow ||= { nodes: [], edges: [] }; graph = node.workflow; }
    }
    return { id: `step-${index}`, kind: "workflow", label: "Same step", component: "Lambda", correlation: { runId },
      metadata: { sourceKind: "workflow.snapshot", sourceNodePath: path }, evidence: [{ kind: "workflow.snapshot", envelopeIndex: 0 }] };
  });
  return { execution: { runId, nodes, edges: [] }, envelopes: [{ kind: "workflow.snapshot", correlation: { runId }, payload: { workflow } }] };
}
const collidingPaths = workflowIdentityPaths([["left / shared"], ["left", "shared"]]);
assert.deepEqual([...buildStepIdentityLabels(collidingPaths.execution, collidingPaths.envelopes)], [["step-0", '["left / shared"]'], ["step-1", "left / shared"]], "paths with separators retain their segment boundaries");
const duplicatedPaths = workflowIdentityPaths([["left", "shared"], ["left", "shared"]]);
assert.equal(buildStepIdentityLabels(duplicatedPaths.execution, duplicatedPaths.envelopes).size, 0, "two projected nodes cannot claim one full source path");
console.log("OK: Workflow identity labels require source-backed full paths and preserve path-segment boundaries");
