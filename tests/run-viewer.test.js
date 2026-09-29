import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createEinoRunViewer } from "../src/run-viewer.js";
import { buildExecutionTrajectory } from "../src/trajectory.js";
import { EinoViewerError, createEinoViewer } from "../src/viewer.js";
import { registerViewerState, selectViewerGraphPath, captureViewerViewport, restoreViewerViewport, revealViewerSelection, captureViewerLayout, restoreViewerLayout } from "../src/viewer-state.js";
import { captureRunViewerReading, setRunViewerLocale } from "../src/run-viewer-state.js";
import { syntheticGraphRecord } from "./helpers/synthetic-record.js";
import { createRunInspectionIndex } from "../src/inspection.js";

// A minimal DOM double checks synchronous ownership/lifecycle contracts only.
// Rendering, file://, clipboard, keyboard and layout are checked in Playwright.
class ElementDouble {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.nodeType = 1;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.checked = false;
    this._text = "";
    this.className = "";
    const properties = new Map();
    this.style = { setProperty: (name, value) => properties.set(name, String(value)), getPropertyValue: (name) => properties.get(name) || "" };
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? "add" : "remove"](name); return enabled; },
    };
  }
  get parentElement() { return this.parent; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  get textContent() { return this._text + this.children.map((item) => item.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...children) {
    for (const child of children) { child.remove(); child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) { this.children.forEach((child) => { child.parent = undefined; }); this.children = []; this._text = ""; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = undefined; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())];
    return this.attributes[name];
  }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  matches(selector) {
    return selector.split(",").some((part) => {
      const trimmed = part.trim();
      if (/^[a-z-]+$/i.test(trimmed)) return this.tagName.toLowerCase() === trimmed.toLowerCase();
      if (/^\.[\w-]+$/.test(trimmed)) return this.classList.contains(trimmed.slice(1));
      const attribute = trimmed.match(/^\[([a-z-]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      if (!attribute) return false;
      const value = this.getAttribute(attribute[1]);
      return value !== undefined && (attribute[2] === undefined || value === attribute[2]);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
const dom = {
  createElement(tag) { return new ElementDouble(tag, dom); },
  createTextNode(text) { const node = new ElementDouble("#text", dom); node.textContent = text; return node; },
};
const load = (id) => JSON.parse(readFileSync(new URL(`../fixtures/recorder-matrix/${id}.json`, import.meta.url), "utf8"));
const host = () => dom.createElement("div");
const detailChannel = (panel, direction) => panel.querySelectorAll("[data-business-channel]").find((entry) => entry.dataset.businessChannel === direction)
  || panel.querySelectorAll("[data-run-channel]").find((entry) => entry.dataset.runChannel === direction);

for (const invalid of [null, {}, { nodeType: 1, replaceChildren() {} }]) {
  assert.throws(() => createEinoRunViewer(invalid, {}), (error) => error instanceof EinoViewerError && error.code === "viewer.invalid_container");
}
assert.throws(() => createEinoRunViewer(host(), load("agent-direct-answer"), { locale: "xx" }), /Expected locale/);

const input = load("graph-io-structured");
const original = structuredClone(input);
const container = host();
const clicks = [];
const viewer = createEinoRunViewer(container, input, { locale: "zh", onNodeClick: (event) => clicks.push(event) });
assert.equal(viewer.kind, "graph");
assert.equal(container.querySelectorAll("[data-scope-diagram]").length, 1, "Graph retains its diagram reading surface");
assert.equal(container.querySelectorAll("[data-agent-trajectory]").length, 0);
assert.equal(viewer.explanation.run.result.state, "success");
assert.equal(viewer.explanation.run.capture.status, "complete");
assert.equal(container.children.length, 1);
assert.deepEqual(input, original);
const renderedTitle = container.querySelectorAll("[data-run-title]")[0];
assert.equal(renderedTitle.textContent, "Graph · 运行结果", "record IDs are not promoted to the reading title");
const runIdentity = container.querySelectorAll("[data-run-identity]")[0];
assert.notEqual(runIdentity.open, true, "full record identity is available on demand");
assert.equal(runIdentity.querySelectorAll("[data-run-capture]")[0].dataset.runCapture, "complete", "normal completeness belongs to run details");
assert.ok(container.querySelectorAll("[data-evidence-sources]").every((entry) => entry.open !== true), "source references are available on demand");
const rootChannels = container.querySelectorAll("[data-run-summary]")[0].querySelectorAll("[data-run-channel]");
assert.deepEqual(rootChannels.map((channel) => channel.dataset.runChannel), ["output", "input"], "output is first in DOM and assistive reading order");
assert.equal(rootChannels[0].querySelectorAll("[data-run-value]")[0].tagName, "pre", "structured values retain a code representation");
const structuredValue = rootChannels[0].querySelectorAll("[data-run-value]")[0];
const structuredBox = structuredValue.parent.tagName === "details" ? structuredValue.parent.parent : structuredValue.parent;
const structuredPreviewFrame = structuredBox.children.find((entry) => entry.className === "erv-preview-frame");
assert.equal(structuredPreviewFrame.children[0].tagName, "pre", "structured preview padding belongs to a separate frame, not the clamped text");
assert.notEqual(structuredValue.parent, structuredPreviewFrame, "the complete source value is never put inside the preview frame");
assert.doesNotMatch(rootChannels[0].textContent, /已记录运行输出|运行级原始输出/);
input.evidence[0].payload = { damaged: true };
assert.deepEqual(viewer.document.evidence[0], original.evidence[0], "accepted evidence is owned by the instance");
const selected = viewer.explanation.nodes[0];
assert.equal(viewer.selectStep(selected.id), true);
assert.equal(viewer.selectedStepId, selected.id);
const detailPanel = container.querySelectorAll("[data-step-panel]")[0];
assert.equal(detailPanel.open, true);
detailPanel.open = false;
detailPanel.listeners.toggle();
assert.equal(viewer.selectedStepId, selected.id, "folding detail does not discard the selected canonical step");
assert.equal(clicks[0].node.id, selected.id);
assert.equal(viewer.selectStep("missing"), false);
assert.equal(viewer.selectEvidence(1), true);
assert.equal(viewer.selectEvidence(-1), false);
assert.equal(viewer.selectEvidence(50000), false);
const validRoot = container.children[0];
const validDocument = viewer.document;
const validText = container.textContent;
assert.throws(() => viewer.update({ schemaVersion: 7 }), EinoViewerError);
let getterCalls = 0;
const unsafe = { get schemaVersion() { getterCalls += 1; return 1; } };
assert.throws(() => viewer.update(unsafe), EinoViewerError);
assert.equal(getterCalls, 0, "validation never invokes application getters");
assert.equal(container.children[0], validRoot);
assert.equal(container.textContent, validText);
assert.equal(viewer.document, validDocument);
assert.equal(viewer.selectedStepId, selected.id);
assert.equal(viewer.selectedEnvelopeIndex, 1);

// Boundary failures are transactional just like ordinary schema failures.
for (const value of [
  JSON.parse('{"nested":'.repeat(8000) + "0" + "}".repeat(8000)),
  Number.MAX_SAFE_INTEGER + 1,
  Object.defineProperty({}, "hidden", { value: "hidden", enumerable: false }),
  [1, , 3],
]) {
  const rejected = load("graph-io-structured");
  rejected.metadata = { value };
  assert.throws(() => viewer.update(rejected), EinoViewerError);
  assert.equal(container.children[0], validRoot);
  assert.equal(container.textContent, validText);
  assert.equal(viewer.document, validDocument);
  assert.equal(viewer.selectedStepId, selected.id);
  assert.equal(viewer.selectedEnvelopeIndex, 1);
}

const secondHost = host();
const second = createEinoRunViewer(secondHost, load("agent-tool-interrupted"));
assert.equal(second.explanation.run.result.state, "interrupted");
assert.equal(captureRunViewerReading(second).selectedTrajectoryRecordId, buildExecutionTrajectory(second.document.evidence).trajectory.records[0].id,
  "Agent opens its first real trajectory entry without fabricating a click");
const foreignInput = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(load("graph-io-structured")))})`);
const foreignViewer = createEinoRunViewer(host(), foreignInput);
assert.equal(foreignViewer.kind, "graph", "owned copies keep cross-realm plain JSON usable in embedded viewers");
assert.deepEqual(foreignViewer.document.evidence, load("graph-io-structured").evidence);
foreignViewer.destroy();
viewer.update(load("workflow-io-success"));
assert.equal(viewer.kind, "workflow");
assert.equal(container.querySelectorAll("[data-scope-diagram]").length, 1, "Workflow retains its diagram reading surface");
assert.equal(container.querySelectorAll("[data-agent-trajectory]").length, 0);
assert.equal(viewer.selectedStepId, null);
assert.equal(viewer.selectedEnvelopeIndex, null);
assert.equal(second.explanation.run.result.state, "interrupted");
assert.equal(secondHost.children.length, 1);

for (const id of ["graph-io-empty", "graph-io-null", "graph-io-oversized", "agent-cancelled", "workflow-definition-only"]) {
  viewer.update(load(id));
  assert.equal(container.children.length, 1, id);
  for (const node of viewer.explanation.nodes) assert.equal(viewer.selectStep(node.id), true, `${id}: ${node.id}`);
}
assert.equal(viewer.explanation.run.result.state, "definition-only");
assert.equal(viewer.explanation.run.timing?.durationMs, undefined);
assert.equal(container.querySelectorAll("[data-run-timing]")[0].textContent, "耗时未记录", "missing duration never appears as a generic missing record or zero");

// Group selection only navigates canonical data; it cannot rewrite outcomes,
// count folded nodes as absent, or select a result by the group's display name.
const nested = load("agent-nested-parallel-scopes");
viewer.update(nested);
const nestedExplanation = viewer.explanation;
const nestedDocument = viewer.document;
const nestedTrajectory = buildExecutionTrajectory(nested.evidence).trajectory;
assert.equal(container.querySelectorAll("[data-scope-diagram]").length, 0, "Agent results are read as a trajectory, not an execution diagram");
assert.equal(container.querySelectorAll("[data-run-graph]").length, 0);
assert.equal(container.querySelectorAll("[data-draw-graph]").length, 0);
assert.deepEqual(container.querySelectorAll("[data-trajectory-record]").map((entry) => entry.dataset.trajectoryRecord),
  nestedTrajectory.records.map(({ id }) => id), "the Agent reading surface retains every original trajectory record in order");
const childGroups = nestedExplanation.groups.filter((group) => group.parentId && group.basis === "observed");
assert.equal(childGroups.length, 2, "parallel children have distinct recorded scopes");
assert.equal(new Set(childGroups.map((group) => group.id)).size, 2);
assert.equal(viewer.selectGroup("not-a-group"), false);
const localNodes = childGroups.map((group) => {
  const result = nestedExplanation.nodes.find((node) => group.nodeIds.includes(node.id) && node.output.items.some((item) =>
    item.evidenceEnvelopeIndexes.some((index) => nested.evidence[index].payload?.body?.response?.startsWith("lookup:"))));
  assert.ok(result, "each child retains its own exact tool output");
  return result;
});
assert.equal(viewer.selectGroup(childGroups[0].id), true);
assert.equal(viewer.selectedGroupId, childGroups[0].id);
assert.deepEqual(container.querySelectorAll("[data-trajectory-record]").map((entry) => entry.dataset.trajectoryRecord),
  nestedTrajectory.records.filter(({ metadata }) => metadata.agentScopeId === childGroups[0].id).map(({ id }) => id),
  "a child scope reads only that invocation's original trajectory, never its same-name sibling or unresolved events");
const localResult = container.querySelectorAll("[data-local-result]")[0];
assert.notEqual(localResult.hidden, true);
assert.equal(localResult.dataset.groupId, childGroups[0].id);
assert.match(localResult.textContent, /child result:slow/);
assert.doesNotMatch(localResult.textContent, /child result:fast|parent final: combined/);
assert.equal(viewer.explanation.run.output.items[0].value, "parent final: combined slow and fast");
const localReturnIndex = nested.evidence.findIndex((envelope) => envelope.payload?.body?.response === "child result:slow");
assert.equal(viewer.selectEvidence(localReturnIndex), true);
assert.equal(viewer.selectedGroupId, childGroups[0].id, "the explicitly verified call-boundary reference remains in its local scope");
assert.deepEqual(viewer.document.evidence[viewer.selectedEnvelopeIndex], nested.evidence[localReturnIndex]);
assert.equal(container.querySelectorAll("[data-evidence-list]").length, 0, "Agent keeps source APIs without a technical evidence directory");
container.querySelectorAll("[data-global-result]")[0].listeners.click();
assert.equal(viewer.selectedGroupId, null, "the explicit whole-run action returns to the complete trajectory");
assert.match(container.querySelectorAll("[data-run-summary]")[0].textContent, /parent final: combined slow and fast/);
viewer.selectGroup(childGroups[0].id);
assert.equal(viewer.selectStep(localNodes[0].id), true);
assert.equal(viewer.selectedGroupId, childGroups[0].id);
const firstChildEvidence = localNodes[0].output.items[0].evidenceEnvelopeIndexes[0];
assert.equal(viewer.selectEvidence(firstChildEvidence), true);
assert.equal(viewer.selectGroup(childGroups[1].id), true);
assert.notEqual(viewer.selectedStepId, localNodes[0].id, "switching to a disjoint scope cannot retain the previous child selection");
assert.equal(viewer.selectedEnvelopeIndex, null, "outside raw evidence cannot remain under a different reading scope");
assert.equal(viewer.selectEvidence(firstChildEvidence), true);
assert.equal(viewer.selectedGroupId, null, "an explicit cross-scope evidence reference restores the all-steps view");
assert.equal(viewer.selectedEnvelopeIndex, firstChildEvidence);
assert.equal(viewer.selectGroup(childGroups[1].id), true);
assert.equal(viewer.selectStep(localNodes[0].id), true);
assert.equal(viewer.selectedGroupId, null, "external selection outside a scope returns to the truthful all-steps view");
assert.equal(viewer.explanation, nestedExplanation);
assert.equal(viewer.document, nestedDocument);
assert.deepEqual(viewer.document.evidence, nested.evidence);
assert.equal(viewer.explanation.run.result.state, "success");
assert.equal(viewer.selectGroup(childGroups[0].id), true);
assert.throws(() => viewer.update({ broken: true }), EinoViewerError);
assert.equal(viewer.selectedGroupId, childGroups[0].id, "invalid updates retain the reading scope");
assert.equal(viewer.selectGroup(null), true);
assert.equal(viewer.selectedGroupId, null);
assert.ok(container.querySelectorAll("[data-scope-result]").every((entry) => entry.hidden), "all-records mode has no competing local result");
assert.equal(container.querySelectorAll("[data-run-summary]")[0].dataset.scopeMode, "all");
assert.deepEqual(container.querySelectorAll("[data-trajectory-record]").map((entry) => entry.dataset.trajectoryRecord),
  nestedTrajectory.records.map(({ id }) => id));
viewer.update(load("agent-nested-failure-recovered"));
assert.notEqual(container.querySelectorAll("[data-run-issues]")[0].parent.open, true, "handled errors do not displace a successful final result");
const recoveredGroup = viewer.explanation.groups.find((group) => group.parentId);
viewer.selectGroup(recoveredGroup.id);
assert.equal(viewer.explanation.run.result.state, "success");
assert.match(container.querySelectorAll("[data-scope-issues]")[0].textContent, /lookup rejected: failure/);
assert.doesNotMatch(container.querySelectorAll("[data-local-result]")[0].textContent, /parent final: recovered with fallback/);
viewer.update(load("agent-deep-nested-failure-recovered"));
const deepExplanation = viewer.explanation;
const failureLeaf = deepExplanation.groups.find((group) => group.parentId && deepExplanation.groups.find((parent) => parent.id === group.parentId)?.parentId);
viewer.selectGroup(failureLeaf.id);
const callerBoundary = container.querySelectorAll("[data-scope-issue-role]").find((entry) => entry.dataset.scopeIssueRole === "caller-boundary");
assert.match(callerBoundary.textContent, /调用方已处理/);
assert.doesNotMatch(callerBoundary.textContent, /不代表子调用内部成功/);
assert.ok(callerBoundary.querySelectorAll("[data-issue-step]").some((entry) => !failureLeaf.nodeIds.includes(entry.dataset.issueStep)), "the caller issue locates its own canonical step");
assert.equal(container.querySelectorAll("[data-scope-outcome]")[0].dataset.scopeOutcome, "failed");
assert.equal(viewer.explanation, deepExplanation, "caller recovery labels never rewrite canonical issues or child outcomes");
viewer.update(load("workflow-definition-only"));
assert.equal(viewer.selectedGroupId, null);
viewer.selectGroup(viewer.explanation.groups[0].id);
assert.equal(container.querySelectorAll("[data-run-result]")[0].dataset.runResult, "definition-only");
assert.equal(container.querySelectorAll("[data-scope-result]")[0].hidden, true, "the top-level scope does not duplicate the whole-run result");
assert.equal(container.querySelectorAll("[data-scope-result]")[0].querySelectorAll("[data-run-value]").length, 0, "declarations do not create call results");
assert.equal(container.querySelectorAll("[data-ungrouped-scope]").length, 0, "an empty unassigned partition has no navigation entry");
viewer.update(load("agent-direct-answer"));
const answer = container.querySelectorAll("[data-run-summary]")[0].querySelectorAll("[data-run-channel]")
  .find((entry) => entry.dataset.runChannel === "output").querySelectorAll("[data-run-value]")[0];
assert.equal(answer.tagName, "div", "ordinary text is readable prose, not a JSON code box");
assert.equal(answer.dataset.valueFormat, "text");
assert.equal(answer.textContent, viewer.explanation.run.output.items[0].value);
viewer.selectGroup(viewer.explanation.groups[0].id);
assert.ok(container.querySelectorAll("[data-scope-result]").every((entry) => entry.hidden));
assert.equal(container.querySelectorAll("[data-scope-outcome]").length, 0);
viewer.update(load("graph-io-oversized"));
assert.match(container.querySelectorAll("[data-run-summary]")[0].textContent, /未记录 · 超出大小限制/);
assert.equal(container.querySelectorAll("[data-capture-reason]")[0].dataset.captureReason, "size_limit");
assert.equal(container.querySelectorAll("[data-run-capture]")[0].parent.className, "erv-statuses", "partial capture remains visible next to the outcome");
for (const value of ["null", "0", "false", null, 0, false]) {
  const scalar = load("graph-io-empty");
  for (const envelope of scalar.evidence) if (envelope.kind === "component.io" && envelope.payload.direction === "output") envelope.payload.body = value;
  viewer.update(scalar);
  const output = container.querySelectorAll("[data-run-summary]")[0].querySelectorAll("[data-run-channel]")[0];
  const rendered = output.querySelectorAll("[data-run-value]")[0];
  assert.equal(rendered.dataset.valueType, value === null ? "null" : typeof value);
  if (typeof value === "string") assert.match(output.textContent, /文本/);
  else assert.doesNotMatch(output.textContent, /文本/);
}
for (const id of ["workflow-io-failed", "agent-nested-failure-recovered"]) {
  viewer.update(load(id));
  const explained = viewer.explanation;
  const failed = explained.nodes.find((node) => node.status === "failed");
  const issue = explained.run.issues.find((entry) => entry.nodeId === failed.id);
  viewer.selectStep(failed.id);
  const detail = container.querySelectorAll("[data-step-detail]")[0];
  const output = detailChannel(detail, "output");
  assert.equal(output.querySelectorAll("[data-run-value]").length, 0, `${id}: execution errors are not ordinary output values`);
  const errors = detail.querySelectorAll("[data-step-errors]");
  assert.equal(errors.length, 1);
  assert.match(errors[0].textContent, /错误/);
  assert.equal(detail.textContent.split(issue.message).length - 1, 1, `${id}: the same recorded error is not repeated as an issue paragraph`);
  assert.equal(errors[0].querySelectorAll("[data-run-value]")[0].textContent, typeof failed.output.items[0].value === "string" ? failed.output.items[0].value : JSON.stringify(failed.output.items[0].value, null, 2));
  assert.ok(errors[0].querySelectorAll("[data-copy-value]").length > 0);
  assert.equal(viewer.explanation, explained, "role separation is presentation-only");
}
const errorShapedBusinessValue = load("graph-io-empty");
for (const envelope of errorShapedBusinessValue.evidence) if (envelope.kind === "component.io" && envelope.payload.direction === "output") envelope.payload.body = { message: "workflow upstream unavailable", error: true };
viewer.update(errorShapedBusinessValue);
viewer.selectStep(viewer.explanation.nodes.at(-1).id);
assert.equal(container.querySelectorAll("[data-step-errors]").length, 0, "business objects with error-like keys are not execution errors");
for (const value of ["null", "0", "false"]) {
  // Source-type stress derived from a real Recorder Tool message, not a new run.
  const scalar = load("agent-tool-recovered");
  const index = scalar.evidence.findIndex((envelope) => envelope.kind === "agent.event" && envelope.payload.output?.message?.value?.role === "tool");
  scalar.evidence[index].payload.output.message.value.content = value;
  viewer.update(scalar);
  const tool = viewer.explanation.nodes.find((node) => node.output.items.some((item) => item.evidenceEnvelopeIndexes.includes(index)));
  const canonicalValue = tool.output.items.find((item) => item.evidenceEnvelopeIndexes.includes(index)).value;
  assert.equal(canonicalValue, JSON.parse(value), "the existing explanation is unchanged");
  viewer.selectStep(tool.id);
  const output = detailChannel(container.querySelectorAll("[data-step-detail]")[0], "output");
  const rendered = output.querySelectorAll("[data-run-value]")[0];
  assert.equal(rendered.dataset.valueType, "string", "the source Tool message string retains its original type");
  assert.equal(rendered.dataset.availability, "available");
  assert.equal(rendered.textContent, value);
  assert.equal(tool.output.items.find((item) => item.evidenceEnvelopeIndexes.includes(index)).value, canonicalValue);
}
viewer.update(load("graph-io-null"));
viewer.selectStep(viewer.explanation.nodes.at(-1).id);
const nullOutput = container.querySelectorAll("[data-step-detail]")[0].querySelectorAll("[data-run-channel]").find((entry) => entry.dataset.runChannel === "output");
assert.equal(nullOutput.querySelectorAll("[data-run-value]")[0].dataset.valueType, "null", "a real component body null stays null");
const errorAndBusiness = load("agent-tool-recovered");
const mixedIndex = errorAndBusiness.evidence.findIndex((envelope) => envelope.kind === "agent.event" && envelope.payload.output?.message?.value?.role === "tool");
const mixedPayload = errorAndBusiness.evidence[mixedIndex].payload;
mixedPayload.error = { message: `failure for ${mixedPayload.output.message.value.tool_call_id}` };
viewer.update(errorAndBusiness.evidence);
const mixedNode = viewer.explanation.nodes.find((node) => node.evidence.some((entry) => entry.envelopeIndex === mixedIndex));
viewer.selectStep(mixedNode.id);
const mixedDetail = container.querySelectorAll("[data-step-detail]")[0];
const mixedOutput = detailChannel(mixedDetail, "output");
assert.equal(mixedOutput.querySelectorAll("[data-run-value]")[0].textContent, mixedPayload.output.message.value.content, "a Tool message sharing an error envelope remains business output");
assert.equal(mixedDetail.querySelectorAll("[data-step-errors]").length, 0, "the message value does not equal the envelope error value");
assert.match(mixedDetail.textContent, /failure for call-tool-recovered/, "the independent execution error remains visible");

// Long failures retain a bounded preview in both renderers. Agent input/output
// are fully expanded; no reader may add outcome badges to copied source text.
{
  const previousWindow = dom.defaultView;
  const copied = [];
  dom.defaultView = { navigator: { clipboard: { async writeText(text) { copied.push(text); } } } };
  const longError = Array.from({ length: 300 }, (_, index) => `Recorded failure ${index}: 保存原始错误 😀`).join("\n");
  async function assertFoldedError(panel, message) {
    const value = panel.querySelectorAll("[data-run-value]").find((entry) => entry.textContent === message);
    assert.ok(value, "the complete recorded error remains available");
    if (value.classList.contains("run-result-value")) {
      assert.equal(value.parent.tagName, "details", "long Agent errors retain their bounded preview");
      assert.ok(Object.hasOwn(value.parent.dataset, "runExpand"));
      assert.notEqual(value.parent.open, true);
      const box = value.parent.parent;
      const preview = box.querySelectorAll(".run-result-preview")[0];
      assert.ok(preview);
      assert.ok([...preview.textContent].length <= 361);
      assert.ok(preview.textContent.split("\n").length <= 6);
      const copy = box.querySelectorAll("[data-copy-value]")[0];
      assert.ok(copy);
      await copy.listeners.click();
      assert.equal(copied.at(-1), message, "Agent copy keeps the complete original failure");
      return;
    }
    const disclosure = value.parent;
    assert.equal(disclosure.tagName, "details");
    assert.ok(Object.hasOwn(disclosure.dataset, "runExpand"));
    assert.notEqual(disclosure.open, true, "a long error is initially folded");
    const box = disclosure.parent;
    const preview = box.children.flatMap((entry) => [entry, ...entry.children]).find((entry) => entry.className?.includes("erv-value-preview"));
    assert.ok(preview);
    assert.ok([...preview.textContent].length <= 321, "long errors have a bounded code-point preview");
    const copy = box.querySelectorAll("[data-copy-value]")[0];
    assert.ok(copy, "the original error has a copy action");
    await copy.listeners.click();
    assert.equal(copied.at(-1), message, "copy contains only the recorded error, never outcome badges or an ellipsis");
  }
  try {
    const failedRecord = load("graph-io-failed");
    failedRecord.evidence.forEach((envelope, index) => {
      if (envelope.payload.error?.message) envelope.payload.error.message = `failure source ${index}\n${longError}`;
    });
    const failedBefore = structuredClone(failedRecord);
    viewer.update(failedRecord);
    assert.equal(viewer.explanation.run.result.state, "failed");
    const issues = container.querySelectorAll("[data-run-issues]")[0];
    assert.equal(issues.querySelectorAll("[data-run-expand]").length, viewer.explanation.run.issues.length);
    for (const issue of viewer.explanation.run.issues) await assertFoldedError(issues, issue.message);
    const failedOutput = container.querySelectorAll("[data-run-summary]")[0].querySelectorAll("[data-run-channel]").find((entry) => entry.dataset.runChannel === "output");
    assert.equal(failedOutput.querySelectorAll("[data-run-value]").length, 0, "run errors never masquerade as a final result");
    assert.deepEqual(failedRecord, failedBefore);
    assert.deepEqual(viewer.document.evidence, failedBefore.evidence);

    const deepRecord = load("agent-deep-nested-failure-recovered");
    deepRecord.evidence.forEach((envelope, index) => {
      if (envelope.payload.error?.message) envelope.payload.error.message = `nested failure source ${index}\n${longError}`;
    });
    const deepBefore = structuredClone(deepRecord);
    viewer.update(deepRecord);
    const explanation = viewer.explanation;
    assert.equal(explanation.run.result.state, "success");
    assert.notEqual(container.querySelectorAll("[data-run-issues]")[0].parent.open, true);
    const recoveredIssues = container.querySelectorAll("[data-run-issues]")[0];
    assert.match(recoveredIssues.textContent, /已恢复/);
    for (const issue of explanation.run.issues) await assertFoldedError(recoveredIssues, issue.message);
    const leaf = explanation.groups.find((group) => group.parentId && explanation.groups.find((parent) => parent.id === group.parentId)?.parentId);
    viewer.selectGroup(leaf.id);
    const scopedIssues = container.querySelectorAll("[data-scope-issue-role]");
    assert.deepEqual(scopedIssues.map((entry) => entry.dataset.scopeIssueRole).sort(), ["caller-boundary", "local"]);
    for (const entry of scopedIssues) {
      const isCaller = entry.dataset.scopeIssueRole === "caller-boundary";
      const issue = explanation.run.issues.find((candidate) => candidate.recovered === isCaller);
      assert.ok(issue);
      await assertFoldedError(entry, issue.message);
      if (isCaller) {
        assert.match(entry.textContent, /调用方已处理/);
        assert.ok(entry.querySelectorAll("[data-issue-step]").some((action) => !leaf.nodeIds.includes(action.dataset.issueStep)));
      } else assert.doesNotMatch(entry.textContent, /调用方已处理|已恢复/);
    }
    assert.equal(container.querySelectorAll("[data-scope-outcome]")[0].dataset.scopeOutcome, "failed", "caller recovery cannot relabel the failed inner call");
    assert.equal(viewer.explanation, explanation);
    assert.deepEqual(deepRecord, deepBefore);
    assert.deepEqual(viewer.document.evidence, deepBefore.evidence);

    // The shared error envelope also contains an independent Tool result, so
    // this exercises the fallback issue path rather than the error-value path.
    const mixedRecord = load("agent-tool-recovered");
    const mixedEnvelope = mixedRecord.evidence.find((entry) => entry.kind === "agent.event" && entry.payload.output?.message?.value?.role === "tool");
    const mixedError = `failure for ${mixedEnvelope.payload.output.message.value.tool_call_id}\n${longError}`;
    mixedEnvelope.payload.error = { message: mixedError };
    const mixedBefore = structuredClone(mixedRecord);
    viewer.update(mixedRecord);
    const errorNode = viewer.explanation.nodes.find((node) => node.evidence.some((entry) => entry.envelopeIndex === mixedRecord.evidence.indexOf(mixedEnvelope)));
    viewer.selectStep(errorNode.id);
    const detail = container.querySelectorAll("[data-step-detail]")[0];
    assert.equal(detail.querySelectorAll("[data-step-errors]").length, 0);
    await assertFoldedError(detail, mixedError);
    const output = detailChannel(detail, "output");
    assert.equal(output.querySelectorAll("[data-run-value]")[0].textContent, mixedEnvelope.payload.output.message.value.content);
    assert.ok(!output.textContent.includes(longError), "the independent failure is separated from business output");
    assert.deepEqual(mixedRecord, mixedBefore);
    assert.deepEqual(viewer.document.evidence, mixedBefore.evidence);
  } finally {
    if (previousWindow === undefined) delete dom.defaultView;
    else dom.defaultView = previousWindow;
  }
}
// Reading states are derived from each exact callback error, not the parent
// outcome or another error with the same text. These are UI boundary variants
// of saved fixtures, not new Recorder executions.
for (const scenario of ["graph-io-failed", "agent-nested-failure-propagated"]) {
  for (const state of ["redacted", "truncated", "not-observed"]) {
    const record = load(scenario);
    const sourceIndex = record.evidence.findIndex(({ kind, payload }) => kind === "callback.event" && payload.phase === "error"
      && (scenario.startsWith("graph") ? payload.nodePath?.length > 0 : payload.run?.component === "Tool" && payload.address.at(-1)?.id === "lookup_item"));
    assert.ok(sourceIndex >= 0);
    const source = record.evidence[sourceIndex];
    source.payload.error.message = state === "not-observed" ? "[error details omitted by capture policy]" : `${state}: exact recorded error`;
    source.metadata = { ...source.metadata, capture: state === "not-observed" ? { status: "omitted", reason: "size_limit" } : { status: "captured", [state]: true } };
    const before = structuredClone(record);
    viewer.update(record);
    const hasSource = (entry) => entry.querySelectorAll("[data-envelope-index]").some((link) => link.dataset.envelopeIndex === String(sourceIndex))
      || entry.querySelectorAll("[data-evidence-indexes]").some((value) => JSON.parse(value.dataset.evidenceIndexes).includes(sourceIndex));
    const checkIssue = (entry) => {
      const values = entry.querySelectorAll("[data-availability]").filter((value) => value.className === "erv-value" || Object.hasOwn(value.dataset, "evidenceIndexes"));
      assert.equal(values.length, 1, "one error reader, without a duplicate fallback");
      assert.equal(values[0].dataset.availability, state);
      if (state === "not-observed") {
        assert.equal(values[0].querySelectorAll("[data-run-value]").length, 0);
        assert.equal(values[0].querySelectorAll("[data-copy-value]").length, 0);
        assert.match(values[0].textContent, /超出大小限制/);
        assert.ok(!values[0].textContent.includes(source.payload.error.message));
      } else assert.ok(values[0].querySelectorAll("[data-run-value]")[0].textContent.includes(source.payload.error.message));
    };
    const rootIssue = container.querySelectorAll("[data-run-issues]")[0].children.find(hasSource);
    assert.ok(rootIssue);
    checkIssue(rootIssue);
    const step = viewer.explanation.nodes.find((node) => node.output.items.some((item) => item.evidenceEnvelopeIndexes.includes(sourceIndex)));
    assert.ok(step);
    viewer.selectStep(step.id);
    const detail = container.querySelectorAll("[data-step-detail]")[0];
    assert.equal(detail.querySelectorAll("[data-step-errors]").length, 1);
    checkIssue(detail.querySelectorAll("[data-step-errors]")[0]);
    const business = detailChannel(detail, "output");
    assert.ok(!business.textContent.includes(source.payload.error.message));
    if (scenario.startsWith("agent")) {
      const group = viewer.explanation.groups.find((entry) => entry.parentId && entry.nodeIds.includes(step.id));
      assert.ok(group);
      viewer.selectGroup(group.id);
      checkIssue(container.querySelectorAll("[data-scope-issues]")[0].children.find(hasSource));
    }
    assert.deepEqual(record, before);
    assert.deepEqual(viewer.document.evidence, before.evidence);
  }
}
viewer.destroy();
viewer.destroy();
assert.equal(container.children.length, 0);
assert.equal(secondHost.children.length, 1);
assert.throws(() => viewer.update(original), (error) => error.code === "viewer.destroyed");
assert.throws(() => viewer.selectStep("anything"), (error) => error.code === "viewer.destroyed");
assert.throws(() => viewer.selectGroup(null), (error) => error.code === "viewer.destroyed");
second.destroy();

// The offline shell changes only presentation through a private bridge. The
// public instance remains unchanged; restoration does not replay user events.
{
  const localeHost = host();
  const record = load("graph-multistep-loop-success");
  let nodeClicks = 0, evidenceClicks = 0;
  const reader = createEinoRunViewer(localeHost, record, { locale: "zh", pageSize: 2,
    onNodeClick: () => { nodeClicks += 1; }, onEvidenceClick: () => { evidenceClicks += 1; } });
  const control = (attribute) => localeHost.querySelectorAll(`[data-${attribute}]`)[0];
  const visits = reader.explanation.nodes.filter((node) => node.label === "evaluate");
  assert.equal(visits.length, 3);
  control("step-search").value = "evaluate";
  control("step-search").listeners.input();
  reader.selectStep(visits[2].id);
  assert.equal(captureRunViewerReading(reader).stepOffset, 2);
  const source = visits[2].evidence.find((entry) => entry.kind === "callback.event").envelopeIndex;
  reader.selectEvidence(source);
  control("evidence-search").value = "callback";
  control("evidence-search").listeners.input();
  control("evidence-scope").value = "step";
  control("evidence-scope").listeners.change();
  control("step-list").scrollTop = 42;
  control("step-panel").scrollTop = 18;
  control("evidence-list").scrollLeft = 12;
  control("original-record").parent.open = true;
  control("original-record").parent.listeners.toggle();
  control("close-step").listeners.click();
  assert.equal(reader.selectedStepId, visits[2].id, "closing the drawer retains the selected identity");
  const before = captureRunViewerReading(reader);
  const clicksBefore = [nodeClicks, evidenceClicks];
  setRunViewerLocale(reader, "en");
  assert.deepEqual(captureRunViewerReading(reader), before, "locale preserves search, pages, selection, folds and scroll");
  assert.deepEqual([nodeClicks, evidenceClicks], clicksBefore, "restoring locale does not emit selection callbacks");
  assert.match(control("step-detail").textContent, /Call 3/);
  assert.equal(control("step-panel").open, false);
  assert.deepEqual(JSON.parse(control("original-record").textContent), record);
  assert.deepEqual(reader.document.evidence, record.evidence);
  const stableRoot = localeHost.children[0];
  assert.throws(() => setRunViewerLocale(reader, "invalid"), /locale/);
  assert.equal(localeHost.children[0], stableRoot);
  assert.throws(() => reader.update({ wrong: true }), EinoViewerError);
  assert.deepEqual(captureRunViewerReading(reader), before);
  reader.update(load("agent-direct-answer"));
  assert.equal(captureRunViewerReading(reader).selectedTrajectoryRecordId, buildExecutionTrajectory(reader.document.evidence).trajectory.records[0].id);
  assert.equal(control("step-search"), undefined, "Agent has no duplicate step-search directory");
  assert.equal(control("original-record"), undefined, "Agent does not expose an always-mounted raw document");
  assert.equal(Object.hasOwn(reader, "setLocale"), false, "private locale handling does not extend the public instance");
  reader.destroy();
  assert.equal(captureRunViewerReading(reader), undefined);
  assert.throws(() => setRunViewerLocale(reader, "zh"), /not active/);
}

{
  const scopedHost = host();
  const reader = createEinoRunViewer(scopedHost, load("agent-nested-failure-propagated"), { locale: "zh" });
  const control = (attribute) => scopedHost.querySelectorAll("[data-" + attribute + "]")[0];
  const nested = reader.explanation.groups.find((group) => group.parentId);
  reader.selectGroup(nested.id);
  assert.ok(control("local-result"));
  assert.equal(control("run-summary"), undefined, "a child trajectory does not compete with a second whole-run result");
  const step = reader.explanation.nodes.find((node) => nested.nodeIds.includes(node.id));
  reader.selectStep(step.id);
  control("reading-main").scrollTop = 47;
  const before = captureRunViewerReading(reader);
  setRunViewerLocale(reader, "en");
  assert.deepEqual(captureRunViewerReading(reader), before, "local scope, selected step and reading position survive language changes");
  const target = reader.explanation.run.issues.find((issue) => issue.nodeId && !nested.nodeIds.includes(issue.nodeId));
  assert.ok(target);
  control("global-result").listeners.click();
  assert.equal(reader.selectedGroupId, null);
  scopedHost.querySelectorAll("[data-issue-step]").find((entry) => entry.dataset.issueStep === target.nodeId).listeners.click();
  assert.equal(reader.selectedStepId, target.nodeId);
  assert.equal(reader.selectedGroupId, null, "locating a root issue stays in the truthful all-records scope");
  const details = control("step-detail");
  const trajectory = buildExecutionTrajectory(load("agent-nested-failure-propagated").evidence).trajectory.records
    .find((entry) => entry.id === details.dataset.trajectoryDetail);
  assert.equal(trajectory.error.message, target.message, "the issue opens its unique real error trajectory");
  assert.equal(details.querySelectorAll("[data-business-channel]").length, 0, "a pure error trajectory must not invent input or output");
  const errorValues = details.querySelectorAll("[data-run-value]").filter((entry) => entry.dataset.valueFormat === "json"
    ? JSON.parse(entry.textContent)?.message === target.message : entry.textContent === target.message);
  assert.ok(errorValues.length > 0, "the exact failure remains visible in its original trajectory");
  assert.deepEqual(details.querySelectorAll("[data-evidence-indexes]").map((entry) => JSON.parse(entry.dataset.evidenceIndexes)).flat(),
    trajectory.evidence.map(({ envelopeIndex }) => envelopeIndex), "the error retains its exact source association");
  reader.selectStep(target.nodeId);
  const channels = details.querySelectorAll("[data-business-channel]");
  assert.deepEqual(channels.map((entry) => entry.dataset.businessChannel), ["input", "output"], "public canonical selection still reads input before output");
  assert.ok(!detailChannel(details, "output").textContent.includes(target.message), "errors do not become ordinary business output");
  reader.destroy();
}

{
  const scaleHost = host();
  const reader = createEinoRunViewer(scaleHost, syntheticGraphRecord(2003));
  const graph = () => scaleHost.querySelectorAll("[data-run-graph]")[0];
  assert.equal(reader.explanation.nodes.length, 500);
  assert.equal(scaleHost.querySelectorAll("[data-scope-diagram]")[0].open, true);
  assert.equal(graph().dataset.deferred, "false");
  reader.update(syntheticGraphRecord(2007));
  assert.equal(reader.explanation.nodes.length, 501);
  assert.equal(graph().dataset.deferred, "true");
  assert.equal(scaleHost.querySelectorAll("[data-draw-graph]").length, 1);
  scaleHost.querySelectorAll("[data-draw-graph]")[0].listeners.click();
  assert.equal(graph().dataset.deferred, "false");
  setRunViewerLocale(reader, "zh");
  assert.equal(graph().dataset.deferred, "false", "locale preserves an explicit draw request for the same record/scope");
  reader.selectGroup(null);
  assert.equal(graph().dataset.deferred, "true", "scope selection never carries a large-graph permission into another scope");
  reader.update(load("agent-direct-answer"));
  assert.equal(graph(), undefined, "switching to Agent removes the Graph rendering surface entirely");
  assert.equal(scaleHost.querySelectorAll("[data-agent-trajectory]").length, 1);
  assert.equal(scaleHost.querySelectorAll("[data-draw-graph]").length, 0);
  reader.destroy();
}

{
  const orderedHost = host();
  const record = load("workflow-parallel-join-success");
  const reader = createEinoRunViewer(orderedHost, record);
  const originalOrder = ["fast", "finish", "join", "prepare", "slow"];
  assert.deepEqual(reader.explanation.nodes.map((node) => node.id), originalOrder, "public explanation retains source order");
  const controls = orderedHost.querySelectorAll("[data-step-list]")[0].querySelectorAll("[data-step-id]");
  assert.deepEqual(controls.map((entry) => entry.dataset.stepId), ["prepare", "fast", "slow", "join", "finish"], "only the reading list uses trusted dependency order");
  assert.deepEqual(reader.document.evidence, record.evidence);
  reader.update(load("agent-direct-answer"));
  assert.match(orderedHost.querySelectorAll("[data-agent-trajectory]")[0].textContent, /User input/);
  assert.doesNotMatch(orderedHost.querySelectorAll("[data-agent-trajectory]")[0].textContent, /schema\.message|schema\.Message/);
  reader.destroy();
}

{
  const readingHost = host();
  const record = load("agent-parallel-same-tool");
  const reader = createEinoRunViewer(readingHost, record, { locale: "zh" });
  const search = () => readingHost.querySelectorAll("[data-step-search]")[0];
  const rows = () => readingHost.querySelectorAll("[data-step-list]")[0].querySelectorAll("[data-step-id]");
  const find = (query) => {
    if (reader.kind === "agent") return createRunInspectionIndex(reader.explanation, reader.document.evidence).searchSteps(query).items;
    search().value = query;
    search().listeners.input();
    return rows();
  };
  const tools = reader.explanation.nodes.filter((node) => node.kind === "tool");
  assert.deepEqual(find("lookup_item").map((node) => node.id), tools.map((node) => node.id), "source-name inspection retains both equal-named tool identities");
  assert.equal(find("missing_name lookup_item").length, 0, "the public query remains an AND condition");
  assert.equal(find("Tool call 2").length, 0, "a new role alias cannot swallow Call N or invent Agent invocation order");
  reader.selectStep(tools[0].id);
  const identity = readingHost.querySelectorAll("[data-step-identity]")[0];
  assert.equal(identity, undefined, "technical identity controls are not part of the approved Agent reading surface");
  const selected = readingHost.querySelectorAll("[data-trajectory-record]").find((entry) => entry.dataset.trajectoryStep === tools[0].id);
  assert.ok(selected);
  assert.equal(selected.getAttribute("aria-pressed"), "true", "the exact selected tool identity remains linked to its trajectory entry");
  assert.equal(reader.explanation.nodes.find((node) => node.id === tools[0].id).technical.correlation.toolCallId, tools[0].technical.correlation.toolCallId);
  assert.deepEqual(reader.document.evidence, record.evidence);
  reader.update(load("agent-nested-parallel-scopes"));
  const equalNamedGroups = reader.explanation.groups.filter((group) => group.parentId);
  assert.equal(new Set(equalNamedGroups.map((group) => group.id)).size, equalNamedGroups.length, "same-name Agent invocations keep their original distinct identities");
  reader.update(load("graph-multistep-loop-success"));
  assert.equal(find("evaluate Call 2").length, 1);
  assert.equal(find("Call 2").length, 2, "both proven repeated Graph entities retain strict ordinal search");
  reader.destroy();
}

// Agent selection follows the same canonical identities in the flat shared
// trajectory. Default selection and locale restoration never simulate clicks.
{
  const trajectoryHost = host(), nodeClicks = [];
  const record = load("agent-repeated-tool"), original = structuredClone(record);
  const reader = createEinoRunViewer(trajectoryHost, record, { locale: "zh", pageSize: 2, onNodeClick: (event) => nodeClicks.push(event) });
  const control = (name) => trajectoryHost.querySelectorAll("[data-" + name + "]")[0];
  const rows = () => trajectoryHost.querySelectorAll("[data-trajectory-record]");
  const trajectory = buildExecutionTrajectory(reader.document.evidence).trajectory;
  const choose = (id) => {
    const row = rows().find((entry) => entry.dataset.trajectoryRecord === id);
    assert.ok(row, "every original trajectory record remains mounted");
    control("reading-main").listeners.click({ target: row });
    return row;
  };
  const close = () => control("step-panel").listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.deepEqual(rows().map((entry) => entry.dataset.trajectoryRecord), trajectory.records.map(({ id }) => id));
  for (const selector of ["trajectory-pagination", "step-search", "close-step"]) {
    assert.equal(trajectoryHost.querySelectorAll("[data-" + selector + "]").length, 0, "Agent has no redundant directory, pagination or close button");
  }
  assert.equal(captureRunViewerReading(reader).selectedTrajectoryRecordId, trajectory.records[0].id);
  assert.equal(nodeClicks.length, 0);
  const firstPlanning = trajectory.records[1];
  choose(firstPlanning.id);
  assert.equal(reader.selectedStepId, null, "a planning assistant is not the tool inheriting its model evidence");
  assert.equal(nodeClicks.length, 0, "an unmapped planning message emits no fabricated canonical node click");
  assert.equal(control("step-detail").dataset.trajectoryDetail, firstPlanning.id);
  assert.equal(control("step-panel").open, true);
  assert.ok(control("step-detail").querySelectorAll("[data-run-value]").some((entry) => entry.textContent.includes("lookup_item")));
  const tool = trajectory.records[2], planning = trajectory.records[3];
  const canonical = reader.document.execution.nodes.find((node) => node.metadata.toolCallId === tool.toolCallId);
  for (const [selectedRecord, expectedNode] of [[tool, canonical], [planning, null]]) {
    const callbacksBefore = nodeClicks.length;
    const trigger = choose(selectedRecord.id);
    assert.equal(reader.selectedStepId, expectedNode?.id || null);
    assert.equal(nodeClicks.length, callbacksBefore + (expectedNode ? 1 : 0));
    if (expectedNode) assert.equal(nodeClicks.at(-1).node, expectedNode, "callbacks carry the original canonical node");
    assert.equal(control("step-detail").dataset.trajectoryDetail, selectedRecord.id);
    assert.equal(trigger.getAttribute("aria-pressed"), "true");
    assert.deepEqual(captureRunViewerReading(reader).detailReturnSelection, { kind: "trajectory", id: selectedRecord.id });
    const channels = control("step-detail").querySelectorAll("[data-business-channel]").map((entry) => entry.dataset.businessChannel);
    if (channels.includes("input")) assert.ok(channels.indexOf("input") < channels.indexOf("output"), "input precedes output");
    assert.equal(control("step-detail").querySelectorAll("[data-copy-value]").length, 0);
    control("reading-main").scrollTop = 73;
    control("reading-main").scrollLeft = 12;
    close();
    assert.equal(dom.activeElement, trigger, "Escape returns focus to the original trajectory control");
    const before = captureRunViewerReading(reader), countBeforeLocale = nodeClicks.length;
    assert.equal(before.selectedTrajectoryRecordId, selectedRecord.id);
    assert.equal(before.trajectoryDetail, true);
    assert.equal(before.detailOpen, false);
    setRunViewerLocale(reader, "en");
    assert.deepEqual(captureRunViewerReading(reader), before, "locale retains exact identity, closed detail, disclosures and reading scroll");
    assert.equal(nodeClicks.length, countBeforeLocale, "locale restoration never replays canonical clicks");
    assert.equal(control("step-detail").dataset.trajectoryDetail, selectedRecord.id);
    assert.equal(control("step-panel").open, false);
    assert.equal(control("reading-main").scrollTop, 73);
    assert.equal(control("reading-main").scrollLeft, 12);
    close();
    assert.equal(dom.activeElement, rows().find((entry) => entry.dataset.trajectoryRecord === selectedRecord.id), "locale retains the return-trigger identity");
    const mounted = trajectoryHost.children[0], document = reader.document, text = trajectoryHost.textContent;
    assert.throws(() => reader.update({ invalid: true }), EinoViewerError);
    assert.equal(trajectoryHost.children[0], mounted);
    assert.equal(trajectoryHost.textContent, text);
    assert.equal(reader.document, document);
    assert.deepEqual(captureRunViewerReading(reader), before, "invalid updates leave all reading state untouched");
    assert.equal(nodeClicks.length, countBeforeLocale);
  }
  assert.deepEqual(record, original);
  assert.deepEqual(reader.document.evidence, original.evidence);
  assert.equal(trajectoryHost.querySelectorAll("[data-run-graph]").length, 0);
  assert.equal(trajectoryHost.querySelectorAll("[data-draw-graph]").length, 0);
  const staleMain = control("reading-main"), staleRecord = rows()[0], callbacksBeforeDestroy = nodeClicks.length;
  reader.destroy();
  staleMain.listeners.click({ target: staleRecord });
  assert.equal(nodeClicks.length, callbacksBeforeDestroy, "destroyed controls cannot reactivate a detached reader");
  assert.equal(trajectoryHost.children.length, 0);
}

// A scale variant preserves every Agent entry in natural layout. It is not
// an additional real Recorder scenario and does not offer graph controls.
{
  const scaleHost = host(), record = load("agent-direct-answer");
  const userIndex = record.evidence.findIndex(({ kind, payload }) => kind === "schema.message" && payload.role === "user");
  const user = record.evidence[userIndex];
  const repeated = Array.from({ length: 503 }, (_, index) => ({ ...structuredClone(user), payload: { ...user.payload, content: "Synthetic trajectory input " + index } }));
  record.evidence.splice(userIndex + 1, 0, ...repeated);
  record.metadata = { ...record.metadata, synthetic: true, purpose: "trajectory-flat-layout" };
  const reader = createEinoRunViewer(scaleHost, record, { pageSize: 17 });
  const expected = buildExecutionTrajectory(reader.document.evidence).trajectory.records.map(({ id }) => id);
  assert.ok(expected.length > 500);
  assert.deepEqual(scaleHost.querySelectorAll("[data-trajectory-record]").map((entry) => entry.dataset.trajectoryRecord), expected,
    "all entries retain their exact IDs and source order without duplicates or omissions");
  for (const selector of ["trajectory-pagination", "scope-diagram", "run-graph", "draw-graph"]) {
    assert.equal(scaleHost.querySelectorAll("[data-" + selector + "]").length, 0);
  }
  assert.deepEqual(reader.document.evidence, record.evidence);
  reader.destroy();
}

// Execute the offline shell without bundling or launching a browser. File read
// promises remain controlled so rejected attempts can be tested deterministically.
{
  const source = readFileSync(new URL("../scripts/build-portable-viewer.js", import.meta.url), "utf8");
  const definition = source.slice(source.indexOf("function bootstrap("), source.indexOf("\nconst virtualEntry"));
  const selectors = ["#viewer", "#record-file", "#record-json", "#apply-record", "#download-record", "#import-status", "#drop-record", "#locale", "#import-editor", "#import-editor-label", ".portable-shell", "#import-error", "#import-error-text"];
  const controls = new Map(selectors.map((key) => [key, host()]));
  const get = (key) => controls.get(key);
  get("#locale").value = "zh";
  get("#viewer").querySelector = () => undefined;
  const owner = { querySelector: get, querySelectorAll: () => [], documentElement: {} };
  const bootstrap = runInNewContext(`(${definition})`, { document: owner });
  let accepted, languageChanges = 0;
  bootstrap((_host, input) => { accepted = input; return { update(value) { accepted = value; } }; },
    JSON.parse, () => {}, () => undefined, () => { languageChanges += 1; });
  get("#record-json").value = '{"runId":"current"}';
  get("#apply-record").listeners.click();
  assert.equal(accepted.runId, "current");
  get("#record-json").value = "{not valid JSON";
  get("#apply-record").listeners.click();
  assert.equal(get("#import-status").dataset.error, "true");
  const errorDetail = get("#import-error-text").textContent;
  get("#import-error").open = true;
  get("#locale").value = "en";
  get("#locale").listeners.change();
  assert.equal(get("#import-status").dataset.error, "true");
  assert.match(get("#import-status").textContent, /not opened/);
  assert.equal(get("#import-error").hidden, false);
  assert.equal(get("#import-error").open, true);
  assert.equal(get("#import-error-text").textContent, errorDetail);
  assert.equal(get("#record-json").value, "{not valid JSON");
  assert.equal(accepted.runId, "current");
  assert.equal(languageChanges, 1);
  let finishRead;
  get("#record-file").files = [{ name: "older-pending.json", size: 20, text: () => new Promise((resolve) => { finishRead = resolve; }) }];
  get("#record-file").listeners.change();
  get("#drop-record").listeners.drop({ preventDefault() {}, dataTransfer: { files: [{}, {}] } });
  assert.equal(get("#import-status").textContent, "Choose one JSON file.");
  finishRead('{"runId":"stale"}');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(accepted.runId, "current", "a rejected later drop cancels an earlier in-flight file read");
  assert.equal(get("#import-status").dataset.error, "true");
  assert.equal(get("#import-status").textContent, "Choose one JSON file.");
}

// The private graph bridge uses the dependency's actual access pattern, not a
// public resize stub that would hide its unconditional fit behavior.
{
  let zoom = 1.7, pan = { x: 24, y: 35 }, selected = null, resizeCount = 0;
  const graph = {
    destroyed: () => false,
    zoom: () => zoom,
    pan: () => pan,
    viewport(value) { zoom = value.zoom; pan = { ...value.pan }; },
    resize() { resizeCount += 1; },
    width: () => 400, height: () => 300,
    nodes(selector) {
      assert.equal(selector, ".active-node");
      return { length: selected ? 1 : 0, renderedBoundingBox: () => ({ x1: pan.x + 420, x2: pan.x + 500, y1: 70, y2: 150 }) };
    },
    panBy(value) { pan = { x: pan.x + value.x, y: pan.y + value.y }; },
  };
  const native = {
    [Symbol.for("eino-workflow-dag.cytoscape")]: () => graph,
    setActiveNodePath(path) { selected = path; },
    resize() { throw new Error("Public resize would incorrectly fit"); },
  };
  const path = ["outer/with/slash", "inner"];
  assert.equal(selectViewerGraphPath(native, path), true);
  path[0] = "mutated";
  assert.deepEqual(selected, ["outer/with/slash", "inner"], "path parts remain exact and are owned by the bridge");
  const before = captureViewerViewport(native);
  assert.equal(revealViewerSelection(native), true);
  assert.equal(zoom, before.zoom, "navigation pans an off-canvas selection without changing zoom");
  assert.equal(pan.x, -116);
  assert.equal(resizeCount, 1, "only the core viewport dimension cache is refreshed");
  assert.equal(restoreViewerViewport(native, before), true);
  assert.deepEqual(captureViewerViewport(native), before);
  assert.equal(restoreViewerViewport(native, { zoom: Infinity, pan: { x: 0, y: 0 } }), false);
  const wrapper = Object.freeze({ update() {}, destroy() {} });
  const keys = Object.keys(wrapper);
  const unregister = registerViewerState(wrapper, { select: (path) => selectViewerGraphPath(native, path), capture: () => captureViewerViewport(native), restore: (value) => restoreViewerViewport(native, value) });
  assert.equal(selectViewerGraphPath(wrapper, null), true);
  assert.equal(selected, null);
  assert.deepEqual(Object.keys(wrapper), keys, "the bridge adds no public properties");
  unregister();
  assert.equal(selectViewerGraphPath(wrapper, ["inner"]), false);
}

{
  function node(id, x, y) {
    let position = { x, y }, routing = { ports: [{ x: 1, y: 2 }], unrelated: id };
    return { id: () => id, parent: () => ({ id: () => undefined }), isParent: () => false,
      position(value) { if (value) position = value; return position; },
      scratch(_key, value) { if (value) routing = value; return routing; } };
  }
  const nodes = [node("a", 10, 20), node("b", 40, 20)];
  let edgeRouting = { _flowAbsRoute: [{ x: 10, y: 20 }, { x: 40, y: 20 }], sourcePort: "right", targetPort: "left", unrelated: true };
  let edgeStyle = { "curve-style": "segments", "segment-distances": "0" };
  let batches = 0;
  const edge = { id: () => "a-b", source: () => nodes[0], target: () => nodes[1],
    scratch(_key, value) { if (value) edgeRouting = value; return edgeRouting; },
    style(value) { if (typeof value === "string") return edgeStyle[value]; Object.assign(edgeStyle, value); } };
  const graph = { nodes: () => nodes, edges: () => [edge], batch(action) { batches += 1; action(); } };
  const native = { [Symbol.for("eino-workflow-dag.cytoscape")]: () => graph };
  const saved = captureViewerLayout(native);
  nodes[0].position({ x: 11, y: 27 });
  nodes[1].position({ x: 48, y: 27 });
  nodes[0].scratch("einoWorkflowDAG").ports[0].x = 9;
  edgeRouting._flowAbsRoute[0].y = 27;
  edgeStyle["segment-distances"] = "7";
  assert.equal(restoreViewerLayout(native, saved), true);
  assert.equal(batches, 1);
  assert.deepEqual(captureViewerLayout(native), saved, "locale restoration restores node positions and edge routes together");
  assert.equal(nodes[0].scratch("einoWorkflowDAG").unrelated, "a");
  assert.equal(edgeRouting.unrelated, true, "unrelated native state is not replaced");
  nodes.push(node("other-scope", 0, 0));
  assert.equal(restoreViewerLayout(native, saved), false, "a different topology never receives the old layout");
  assert.equal(batches, 1);
}

{
  const oldDocument = globalThis.document;
  const svgDom = { createElement: (tag) => {
    const node = new ElementDouble(tag, svgDom);
    node.style = {};
    return node;
  } };
  svgDom.createElementNS = (_namespace, tag) => svgDom.createElement(tag);
  globalThis.document = svgDom;
  try {
    const svgHost = svgDom.createElement("div");
    const input = JSON.parse(readFileSync(new URL("../fixtures/eino-compose-cyclic-graph-envelope-v1.json", import.meta.url), "utf8"));
    let callbacks = 0;
    const viewer = createEinoViewer(svgHost, input, { onNodeClick: () => { callbacks += 1; } });
    assert.deepEqual(Object.keys(viewer), ["kind", "document", "update", "destroy"]);
    const sourceId = input.payload.nodes[0].id;
    const all = (node) => [node, ...node.children.flatMap(all)];
    const svgNode = () => all(svgHost).find((node) => node.getAttribute("data-node-id") === sourceId);
    assert.equal(selectViewerGraphPath(viewer, [sourceId]), true);
    assert.equal(svgNode().getAttribute("aria-pressed"), "true");
    assert.equal(svgNode().getAttribute("data-active"), "true");
    assert.equal(callbacks, 0, "programmatic selection never fabricates a user click");
    assert.equal(selectViewerGraphPath(viewer, ["missing"]), false);
    assert.equal(svgNode().getAttribute("aria-pressed"), "true");
    viewer.update(input);
    assert.equal(selectViewerGraphPath(viewer, [sourceId]), true, "a wrapper always delegates to its current mounted graph");
    assert.equal(selectViewerGraphPath(viewer, null), true);
    assert.equal(svgNode().getAttribute("aria-pressed"), "false");
    viewer.destroy();
    assert.equal(selectViewerGraphPath(viewer, [sourceId]), false);
    assert.equal(svgHost.children.length, 0);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
}

// Rendering callbacks queued by an old view must remain inert. This double
// deliberately never supplies a measurable graph: actual layout is browser QA.
{
  const readerSource = readFileSync(new URL("../src/run-viewer.js", import.meta.url), "utf8");
  assert.doesNotMatch(readerSource, /state\.graph\??\.resize/, "the compatibility renderer's public resize always fits; defer size changes to its autoResize");
  const frames = new Map(), observers = [];
  let nextFrame = 0, boundsReads = 0;
  const owner = { ...dom, defaultView: {
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    },
  } };
  owner.createElement = (tag) => new ElementDouble(tag, owner);
  owner.createTextNode = (text) => { const node = owner.createElement("#text"); node.textContent = text; return node; };
  const mountedHost = owner.createElement("div");
  const reader = createEinoRunViewer(mountedHost, load("graph-io-structured"));
  const oldGraph = mountedHost.querySelectorAll("[data-run-graph]")[0];
  oldGraph.isConnected = true;
  oldGraph.getBoundingClientRect = () => { boundsReads += 1; return { width: 0, height: 0 }; };
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback());
  assert.equal(boundsReads, 1, "hidden mount does not initialize a zero-sized graph");
  observers[0].callback();
  const stale = [...frames.values()];
  reader.update(load("graph-io-empty"));
  assert.equal(observers[0].disconnected, true);
  stale.forEach((callback) => callback());
  assert.equal(boundsReads, 1, "callbacks for the replaced view cannot touch its graph");
  const last = [...frames.values()];
  reader.destroy();
  last.forEach((callback) => callback());
  assert.equal(observers.at(-1).disconnected, true);
  assert.equal(mountedHost.children.length, 0);
}

console.log("OK: complete static run viewer owns evidence, preserves invalid updates, isolates instances and cleans up deterministically");
