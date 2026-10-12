import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { projectEinoViewerDocument, EinoViewerError } from "../src/viewer.js";
import { createEinoRunViewer } from "../src/run-viewer.js";
import { captureRunViewerReading, setRunViewerLocale } from "../src/run-viewer-state.js";
import { contentReadingV2, invocationScopeV2, timingReadingV2 } from "../src/viewer-v2.js";
import { dom } from "./helpers/dom-double.js";

const directory = new URL("../protocol/v2/fixtures/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, directory), "utf8"));
const host = () => dom.createElement("div");
const click = (node) => node.listeners.click?.({ target: node });

for (const file of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
  test(`native v2 projects and reads ${file}`, () => {
    const record = load(file.replace(/\.json$/, "")), before = JSON.stringify(record);
    const projected = projectEinoViewerDocument(record);
    assert.equal(projected.ok, true, JSON.stringify(projected.diagnostics));
    assert.equal(projected.document.schemaVersion, 2);
    assert.equal(projected.document.nodes.length, record.invocations.length);
    assert.equal(Object.hasOwn(projected.document, "evidence"), false, "No fabricated v1 evidence");
    assert.deepEqual(projected.document.record, record);
    assert.deepEqual(projectEinoViewerDocument(projected.document).document.record, record);
    const container = host(), viewer = createEinoRunViewer(container, record, { locale: "zh" });
    assert.equal(container.querySelector("[data-record-version]").dataset.recordVersion, "2");
    assert.equal(viewer.explanation.run.status, record.run.status);
    assert.equal(viewer.document.record, viewer.document.record);
    assert.equal(JSON.stringify(record), before, "Projection and rendering do not freeze/mutate caller values");
    assert.equal(Object.isFrozen(record.run), false);
    viewer.destroy(); assert.equal(container.children.length, 0);
  });
}

test("root null and final result are explicit; repeated visits never collapse", () => {
  const record = load("graph-loop-repeated-definition"), container = host();
  const viewer = createEinoRunViewer(container, record);
  assert.equal(viewer.explanation.run.input[0].value, null);
  assert.deepEqual(viewer.explanation.run.output[0].value, { counter: 3 });
  assert.equal(viewer.document.nodes.filter((node) => node.definitionId === "d:step").length, 3);
  for (const id of ["i:step:1", "i:step:2", "i:step:3"]) {
    assert.equal(viewer.selectStep(id), true);
    assert.equal(container.querySelector("[data-step-detail]").dataset.stepId, id);
  }
  assert.equal(viewer.selectEntity({ kind: "definition", id: "d:step" }), true);
  assert.equal(container.querySelectorAll("[data-definition-invocation]").length, 3);
});

test("Agent requested tools stay event rows and do not create invocations", () => {
  const record = load("agent-parallel-interrupted"), container = host();
  const viewer = createEinoRunViewer(container, record, { locale: "zh" });
  assert.equal(container.querySelectorAll("[data-scope-diagram]").length, 0);
  assert.equal(viewer.document.nodes.filter((node) => node.kind === "tool").length, 2);
  const pending = container.querySelectorAll("[data-event-id]").find((node) => node.dataset.eventId === "ev:request:not-dispatched");
  assert.match(pending.textContent, /已请求.*未观察到执行/);
  click(pending);
  assert.equal(viewer.selectedEntity.kind, "event");
  assert.equal(viewer.document.nodes.length, record.invocations.length);
  assert.ok(container.querySelectorAll("[data-trajectory-preview]").length > 0);
  viewer.selectGroup("i:left");
  assert.equal(container.querySelectorAll("[data-invocation-id]").some((node) => node.dataset.invocationId === "i:right:lookup"), false);
  assert.deepEqual([...invocationScopeV2(viewer.document, "i:left")].sort(), ["i:left", "i:left:lookup", "i:model:left"].sort());
});

test("definition-only nesting, four directions, zoom, selection and locale retain context", () => {
  const record = load("definition-only-workflow"), container = host(), viewer = createEinoRunViewer(container, record);
  assert.equal(viewer.document.nodes.length, 0);
  viewer.selectEntity({ kind: "definition", id: "d:week_report_work_items" });
  click(container.querySelector("[data-enter-definition]"));
  assert.equal(captureRunViewerReading(viewer).definitionScopeId, "d:week_report_work_items");
  assert.equal(container.querySelectorAll("[data-layout-direction]").length, 4);
  click(container.querySelectorAll("[data-layout-direction]").find((node) => node.dataset.layoutDirection === "TB"));
  const plus = container.querySelectorAll("button").find((node) => node.textContent === "+"); click(plus);
  const before = captureRunViewerReading(viewer);
  const edge = container.querySelector("[data-edge-id]"); click(edge);
  setRunViewerLocale(viewer, "zh");
  const after = captureRunViewerReading(viewer);
  assert.equal(after.layout, "TB"); assert.deepEqual(after.viewports, before.viewports);
  assert.equal(after.edge.id, edge.dataset.edgeId);
  click(container.querySelector("[data-scope-back]"));
  assert.notEqual(captureRunViewerReading(viewer).definitionScopeId, "d:week_report_work_items");
});

test("v1/v2 replacement is transactional and raw records remain exact", () => {
  const old = JSON.parse(readFileSync(new URL("../fixtures/recorder-matrix/agent-direct-answer.json", import.meta.url), "utf8"));
  const container = host(), viewer = createEinoRunViewer(container, old);
  const record = load("agent-parallel-interrupted"); viewer.update(record);
  const preservedRoot = container.children[0], preservedRecord = viewer.document.record;
  const invalid = structuredClone(record); invalid.invocations[1].id = invalid.invocations[0].id;
  assert.throws(() => viewer.update(invalid), (error) => error instanceof EinoViewerError);
  assert.equal(container.children[0], preservedRoot); assert.equal(viewer.document.record, preservedRecord);
  viewer.update(old); assert.equal(viewer.document.schemaVersion, 1);
  viewer.update(record); assert.deepEqual(viewer.document.record, record);
  record.run.labels.mutated = "caller"; assert.equal(viewer.document.record.run.labels.mutated, undefined);
  viewer.destroy(); assert.throws(() => viewer.update(old), (error) => error.code === "viewer.destroyed");
});

test("content loss, external descriptors, unknown usage and business annotations remain inspectable", () => {
  const record = load("cloud-focus-dependency-degraded-partial"), container = host(), viewer = createEinoRunViewer(container, record);
  for (const content of record.contents) {
    viewer.selectEntity({ kind: "content", id: content.id });
    const reading = contentReadingV2(content);
    assert.equal(container.querySelector("[data-step-detail]").dataset.entityId, content.id);
    if (content.data.availability === "missing") assert.match(container.querySelector("[data-step-detail]").textContent, new RegExp(content.data.reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (content.data.availability === "reference") assert.equal(reading.key, content.data.key);
  }
  for (const entry of record.annotations) { assert.equal(viewer.selectEntity({ kind: "annotation", id: entry.id }), true); assert.deepEqual(viewer.document.annotations.find((a) => a.id === entry.id), entry); }
  assert.deepEqual(timingReadingV2({ basis: "monotonic", startedAtMs: 20, endedAtMs: 10, durationMs: 3 }), { basis: "monotonic", startedAtMs: 20, endedAtMs: 10, durationMs: 3, clockReversed: true, availability: "available" });
});

function definitionRecord(definitions) {
  const record = load("definition-only-workflow");
  record.definitions = definitions;
  for (const key of ["events", "contents", "relations", "annotations", "usage"]) record[key] = [];
  delete record.sourceRecords;
  return record;
}

test("repeated definition calls are paged and exact late calls remain selectable", () => {
  const record = load("graph-loop-repeated-definition");
  for (const key of ["events", "contents", "relations", "annotations", "usage"]) record[key] = [];
  delete record.sourceRecords;
  const root = record.invocations[0]; root.inputRefs = []; root.outputRefs = [];
  record.invocations = [root, ...Array.from({ length: 3000 }, (_, index) => ({
    id: `repeat:${index}`, name: "repeat", kind: "node", definitionId: "d:step",
    parent: { state: "known", invocationId: root.id }, status: "succeeded", timing: { basis: "unknown" },
    inputRefs: [], outputRefs: [], metrics: [],
  }))];
  const container = host(), viewer = createEinoRunViewer(container, record);
  viewer.selectEntity({ kind: "definition", id: "d:step" });
  assert.equal(container.querySelectorAll("[data-definition-invocation]").length, 30);
  assert.match(container.querySelector("[data-step-detail]").textContent, /1–30 \/ 3000/);
  click(container.querySelector("[data-step-detail]").querySelector("[data-collection-next]"));
  assert.equal(container.querySelectorAll("[data-definition-invocation]")[0].dataset.definitionInvocation, "repeat:30");
  viewer.selectStep("repeat:2999");
  assert.equal(viewer.selectedStepId, "repeat:2999");
  assert.ok(container.querySelector("[data-step-list]").querySelectorAll("[data-step-id]").some((node) => node.dataset.stepId === "repeat:2999"));
  assert.deepEqual(viewer.document.record, record);
  viewer.update(load("graph-loop-repeated-definition"));
  assert.equal(viewer.selectStep("repeat:2999"), false, "A replacement clears indexes and scope caches");
});

test("large definition scopes keep searchable paged facts within the drawing budget", () => {
  const definitions = [{ id: "root", kind: "workflow", name: "wide" }, ...Array.from({ length: 2001 }, (_, index) => ({ id: `node:${index}`, name: `step ${index}`, kind: "node", parentId: "root" }))];
  const record = definitionRecord(definitions), container = host(), viewer = createEinoRunViewer(container, record);
  assert.equal(container.querySelectorAll("svg").length, 0);
  assert.match(container.querySelector("[data-scope-diagram]").textContent, /2001/);
  assert.match(container.querySelector("[data-scope-diagram]").textContent, /drawing budget/);
  assert.equal(container.querySelectorAll("[data-definition-entry]").length, 30);
  const query = container.querySelector("[data-definition-search]"); query.value = "node:2000"; query.listeners.input();
  assert.equal(container.querySelectorAll("[data-definition-entry]").length, 1);
  click(container.querySelector("[data-definition-entry]"));
  assert.equal(viewer.selectedEntity.id, "node:2000");
  assert.equal(container.querySelectorAll("svg").length, 0);
  assert.deepEqual(viewer.document.record, record);
});

test("permission to draw 501 definitions never carries into another scope", () => {
  const definitions = [{ id: "root", kind: "workflow", name: "root" }, ...["a", "b"].flatMap((id) => [
    { id, kind: "workflow", name: id, parentId: "root" },
    ...Array.from({ length: 501 }, (_, index) => ({ id: `${id}:${index}`, name: "node", kind: "node", parentId: id })),
  ])];
  const container = host(), viewer = createEinoRunViewer(container, definitionRecord(definitions));
  viewer.selectEntity({ kind: "definition", id: "a" }); click(container.querySelector("[data-enter-definition]"));
  const flow = () => container.querySelector("[data-scope-diagram]");
  assert.equal(flow().querySelectorAll("svg").length, 0);
  click(flow().querySelector("button"));
  assert.equal(flow().querySelectorAll("[data-definition-id]").length, 501);
  viewer.selectGroup(null); viewer.selectEntity({ kind: "definition", id: "b" }); click(container.querySelector("[data-enter-definition]"));
  assert.equal(flow().querySelectorAll("svg").length, 0);
  assert.match(flow().textContent, /501/);
  assert.equal(captureRunViewerReading(viewer).drawLarge, false);
});

test("cross-scope definition edges retain their source owner and reveal both endpoints", () => {
  const record = load("definition-only-workflow");
  record.definitions.find((definition) => definition.id === "d:workflow").edges.push({
    id: "edge:cross", kind: "dependency", from: "d:discover_events", to: "d:week_report_rank_docs",
  });
  const container = host(), viewer = createEinoRunViewer(container, record);
  const boundary = () => container.querySelectorAll("[data-boundary-edge-id]").find((node) => node.dataset.boundaryEdgeId === "edge:cross");
  assert.equal(boundary().dataset.edgeScopeId, "d:workflow");
  click(boundary().querySelector("[data-inspect-edge]"));
  assert.equal(container.querySelector("[data-step-detail]").dataset.edgeId, "edge:cross");
  assert.match(container.querySelector("[data-step-detail]").textContent, /d:discover_events.*d:week_report_rank_docs/s);
  click(boundary().querySelectorAll("[data-edge-endpoint]").find((node) => node.dataset.edgeEndpoint === "d:week_report_rank_docs"));
  assert.equal(captureRunViewerReading(viewer).definitionScopeId, "d:week_report_work_items");
  assert.equal(viewer.selectedEntity.id, "d:week_report_rank_docs");
  assert.ok(container.querySelectorAll("[data-definition-id]").some((node) => node.dataset.definitionId === "d:week_report_rank_docs"));
  assert.ok(boundary(), "The same incoming edge is readable inside the child scope");
  assert.deepEqual(viewer.document.record, record);
});

test("locale preserves actual detail closure, disclosure pages, folds and scroll", () => {
  const record = load("graph-loop-repeated-definition"), container = host(), viewer = createEinoRunViewer(container, record);
  viewer.selectStep("i:step:1");
  container.querySelector("[data-step-detail]").scrollTop = 64;
  const original = container.querySelectorAll("details").find((node) => node.children[0].textContent === "Original record");
  original.open = true; original.listeners.toggle();
  container.querySelector("[data-original-record]").scrollTop = 120;
  click(container.querySelector("[data-close-step]"));
  const before = captureRunViewerReading(viewer);
  setRunViewerLocale(viewer, "zh");
  assert.equal(container.querySelector("[data-step-detail]").hidden, true);
  assert.equal(container.querySelector("[data-original-record]").scrollTop, 120);
  assert.deepEqual(captureRunViewerReading(viewer), before);
});

test("cross-scope selection restores a visible global row without a synthetic click", () => {
  const container = host(); let clicks = 0;
  const viewer = createEinoRunViewer(container, load("agent-parallel-interrupted"), { onNodeClick() { clicks++; } });
  viewer.selectGroup("i:left"); viewer.selectStep("i:right:lookup");
  assert.equal(viewer.selectedGroupId, null);
  assert.equal(viewer.selectedStepId, "i:right:lookup");
  assert.ok(container.querySelector("[data-agent-trajectory]").querySelectorAll("[data-step-id]").some((node) => node.dataset.stepId === "i:right:lookup"));
  assert.equal(clicks, 0);
  const row = container.querySelector("[data-agent-trajectory]").querySelectorAll("[data-step-id]").find((node) => node.dataset.stepId === "i:right:lookup");
  click(row); assert.equal(clicks, 1);
});

test("entity indexes reject unknown prototype names and preserve literal prototype-looking IDs", () => {
  const container = host(), viewer = createEinoRunViewer(container, definitionRecord([
    { id: "constructor", name: "root", kind: "workflow" },
    { id: "__proto__", name: "literal node", kind: "node", parentId: "constructor" },
  ]));
  for (const kind of ["constructor", "__proto__", "toString", "missing"]) assert.equal(viewer.selectEntity({ kind, id: "__proto__" }), false);
  assert.equal(viewer.selectEntity({ kind: "definition", id: "__proto__" }), true);
  assert.equal(viewer.selectedEntity.id, "__proto__");
  assert.equal(container.querySelector("[data-step-detail]").dataset.entityId, "__proto__");
});
