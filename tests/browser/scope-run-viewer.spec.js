import { expect, test } from "@playwright/test";
import { openPasteEditor, ensureDiagramVisible, expectedScopeTrajectoryIds } from "../helpers/run-viewer-ui.js";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG, explainWorkflowSnapshot } from "../../src/explanation.js";
import { buildScopeReading } from "../../src/scope-reading.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { agentReader, agentDetail, agentBoundary, selectAgentReaderStep, openAgentReaderScope, showAgentGlobalResult, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const portableURL = new URL(".artifacts/portable/eino-viewer.html", root).href;
const fixture = (id) => JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${id}.json`, root), "utf8"));
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") entries.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 900 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

function explain(record) {
  const { document } = projectEinoViewerDocument(record);
  const explanation = document.execution ? explainExecutionDAG(document.execution, document.evidence).explanation
    : explainWorkflowSnapshot(document.definition, { envelopes: document.evidence }).explanation;
  return { document, explanation };
}

async function openEmbedded(page, record) {
  await page.route("**/__scope-run-viewer-test__", (route) => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local call reader</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:12px"><main id="viewer"></main><div id="second"></div></body></html>' }));
  await page.goto("/__scope-run-viewer-test__");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (input) => {
    const { createEinoRunViewer } = await import("/src/run-viewer.js");
    window.createRunViewer = createEinoRunViewer;
    window.clicks = [];
    window.viewer = createEinoRunViewer(document.querySelector("#viewer"), input, { locale: "zh", onNodeClick: (entry) => window.clicks.push(entry) });
  }, record);
}

async function openDiagram(page) {
  await ensureDiagramVisible(page.locator("#viewer"));
}

async function graphState(page) {
  return page.locator("#viewer [data-run-graph]").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    if (!cy) return null;
    const sourceId = (node) => node.data("path")?.at(-1) || node.id();
    return {
      nodes: cy.nodes().filter((node) => node.data("metadata")?.executionKind).map(sourceId).sort(),
      edges: cy.edges().map((edge) => ({ from: sourceId(edge.source()), to: sourceId(edge.target()), kind: edge.data("metadata")?.executionEdgeKind })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  });
}

async function expectLocalGraph(page, reading, inputModel) {
  const expected = { nodes: [...reading.nodeIds].sort(), edges: reading.execution.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  // Portable deliberately exposes no viewer global. Its expected model comes
  // from the exact real record imported by the caller, not from a hidden API.
  const { document, explanation } = inputModel || await page.evaluate(() => ({ document: window.viewer.document, explanation: window.viewer.explanation }));
  if (document.kind === "agent") {
    const groups = explanation.groups;
    const trajectory = buildExecutionTrajectory(document.evidence).trajectory;
    const ids = expectedScopeTrajectoryIds(trajectory.records, groups,
      { groupId: reading.group?.id, ungroupedOnly: reading.mode === "unassigned" });
    await expect(page.locator("#viewer [data-agent-trajectory]")).toBeVisible();
    await expect(page.locator("#viewer [data-run-graph] canvas, #viewer [data-draw-graph]")).toHaveCount(0);
    expect(await page.locator("#viewer [data-trajectory-record]").evaluateAll((items) => items.map((item) => item.dataset.trajectoryRecord))).toEqual(ids);
    const selectedIds = await page.locator("#viewer [data-trajectory-step]").evaluateAll((items) => items.map((item) => item.dataset.trajectoryStep));
    expect([...selectedIds].sort()).toEqual(expected.nodes);
    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    const members = new Set(reading.nodeIds);
    expect(expected.edges).toEqual(document.execution.edges.filter(({ from, to }) => members.has(from) && members.has(to))
      .map(({ from, to, kind }) => ({ from, to, kind })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  } else await expect.poll(() => graphState(page)).toEqual(expected);
  if (document.kind === "agent") {
    await expect(page.locator("#viewer [data-reading-scope]")).toHaveAttribute("data-group-id", reading.group?.id || "");
  } else if (reading.boundary.total > 0 && !reading.topLevel) {
    await expect(page.locator("#viewer [data-scope-boundary]")).toHaveAttribute("data-scope-boundary", String(reading.boundary.total));
  } else await expect(page.locator("#viewer [data-scope-boundary]")).toHaveCount(0);
}

async function expandDirectory(page) {
  const directory = page.locator("#viewer [data-group-directory]");
  if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
  await expect(directory.locator("[data-group-select]").first()).toBeVisible();
  for (let level = 0; level < 8; level += 1) {
    const branch = directory.locator("[data-group-children]:not([open])").first();
    if (!await branch.count()) break;
    const id = await branch.getAttribute("data-group-children");
    await branch.locator(":scope > summary").click();
    await expect(directory.locator(`[data-group-children=${JSON.stringify(id)}] [data-group-select]`).first()).toBeVisible();
  }
}

async function screenshot(page, testInfo, name) {
  if (testInfo.project.name !== "chromium") return;
  const directory = fileURLToPath(new URL(".artifacts/iteration-6/", root));
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: `${directory}${name}.png`, fullPage: true });
}

test("embedded parallel calls synchronize exact local trajectory, boundary return, source and final result", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-nested-parallel-scopes");
  const { document, explanation } = explain(record);
  await openEmbedded(page, record);
  const before = await page.evaluate(() => ({ document: window.viewer.document, explanation: window.viewer.explanation }));
  await openDiagram(page);
  const reader = agentReader(page);
  for (const name of ["slow", "fast"]) {
    const group = explanation.groups.find((entry) => entry.label.endsWith(`call-child-${name}`));
    const reading = buildScopeReading(document, explanation, { groupId: group.id });
    await openAgentReaderScope(reader, group.id);
    await expectLocalGraph(page, reading);
    const output = agentBoundary(reader, "output", { local: true });
    await expect(output).toContainText(`child result:${name}`);
    await expect(output).not.toContainText(`child result:${name === "slow" ? "fast" : "slow"}`);
    const boundaryIndex = reading.output.items[0].evidenceEnvelopeIndexes[0];
    await expectAgentAPIEvidence(page, reader, boundaryIndex, record.evidence[boundaryIndex]);
    await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", group.id);
    await showAgentGlobalResult(reader);
    await expect(agentBoundary(reader, "output")).toContainText("parent final: combined slow and fast");
  }
  await screenshot(page, testInfo, "embedded-local-parallel");
  await showAgentGlobalResult(reader);
  await expect(page.locator("[data-local-result]")).toBeHidden();
  await expectLocalGraph(page, buildScopeReading(document, explanation));
  expect(await page.evaluate(() => ({ document: window.viewer.document, explanation: window.viewer.explanation }))).toEqual(before);
});

test("embedded unconfirmed scope never invents a local result or crosses into confirmed nodes", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-nested-parallel-scopes");
  const { document, explanation } = explain(record);
  await openEmbedded(page, record);
  await openDiagram(page);
  const reader = agentReader(page);
  const unknown = explanation.nodes.filter((node) => node.technical.metadata.agentScopeUnresolved);
  expect(unknown.length).toBeGreaterThan(0);
  for (const node of unknown) {
    await selectAgentReaderStep(reader, node.id);
    await expect(agentDetail(reader)).toContainText("归属未确认");
    await expect(agentDetail(reader).locator("[data-hierarchy-group]")).toHaveCount(0);
    await expect(reader.locator("[data-local-result] [data-run-channel]")).toHaveCount(0);
    const row = reader.locator(`[data-trajectory-step=${JSON.stringify(node.id)}]`);
    await expect(row.locator("..")).not.toHaveAttribute("data-trajectory-parent");
  }
  await expect(page.locator("[data-agent-trajectory]")).toContainText(/归属未确认/);
  await page.evaluate((input) => window.viewer.update(input), fixture("workflow-definition-only"));
  await openDiagram(page);
  await expect(page.locator("[data-ungrouped-scope]")).toHaveCount(0);
  await expect(page.locator("[data-run-graph] canvas").first()).toBeVisible();
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
});

test("embedded Workflow scope preserves manual zoom through detail selection, closing and container resize", { tag: "@P1" }, async ({ page }) => {
  const record = fixture("workflow-parallel-join-success");
  const { explanation } = explain(record);
  await openEmbedded(page, record);
  const group = explanation.groups.find((entry) => !entry.parentId);
  await page.evaluate((id) => window.viewer.selectGroup(id), group.id);
  await openDiagram(page);
  const steps = page.locator("[data-step-list] [data-step-id]");
  expect(await steps.count()).toBeGreaterThan(1);
  const ids = await steps.evaluateAll((buttons) => buttons.map((button) => button.dataset.stepId));
  await steps.first().click();
  const graph = page.locator("#viewer [data-run-graph]");
  const zoom = () => graph.evaluate((host) => [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean).zoom());
  const active = () => graph.evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    return cy.nodes(".active-node").map((node) => node.id().split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~")));
  });
  await expect.poll(active).toEqual([[ids[0]]]);
  expect(await page.evaluate(() => window.clicks.map(({ id }) => id))).toEqual([ids[0]]);
  await graph.evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    cy.zoom(cy.zoom() * 0.7);
  });
  const manual = await zoom();
  await steps.nth(1).click();
  await expect.poll(zoom).toBeCloseTo(manual, 8);
  await expect.poll(active).toEqual([[ids[1]]]);
  expect(await page.evaluate(() => window.clicks.map(({ id }) => id))).toEqual([ids[0], ids[1]]);
  await page.locator("[data-close-step]").click();
  await steps.first().click();
  await expect.poll(zoom).toBeCloseTo(manual, 8);
  await page.locator("#viewer").evaluate((host) => { host.style.width = "900px"; });
  await expect.poll(() => graph.evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    return Math.abs(cy.width() - host.clientWidth);
  })).toBeLessThanOrEqual(1);
  expect(await zoom()).toBeCloseTo(manual, 8);
  await expect.poll(active).toEqual([[ids[0]]]);
  const pan = await graph.evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    cy.pan({ x: cy.pan().x + 8, y: cy.pan().y + 11 });
    return cy.pan();
  });
  await page.evaluate(async () => {
    const { setRunViewerLocale } = await import("/src/run-viewer-state.js");
    setRunViewerLocale(window.viewer, "en");
  });
  await expect.poll(active).toEqual([[ids[0]]]);
  await expect.poll(zoom).toBeCloseTo(manual, 8);
  await expect.poll(() => graph.evaluate((host) => [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean)?.pan())).toEqual(pan);
  await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", group.id);
  expect(await page.evaluate(() => window.clicks.map(({ id }) => id))).toEqual([ids[0], ids[1], ids[0]]);
  expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(record.evidence);
});

test("embedded Workflow same-name nodes stay in their exact local path and graph clicks return canonical nodes", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("workflow-nested-names");
  const { document, explanation } = explain(record);
  await openEmbedded(page, record);
  await openDiagram(page);
  for (const name of ["left", "right"]) {
    const group = explanation.groups.find((entry) => entry.parentId && entry.label === name);
    const reading = buildScopeReading(document, explanation, { groupId: group.id });
    await page.evaluate((id) => window.viewer.selectGroup(id), group.id);
    await expectLocalGraph(page, reading);
    const targetId = reading.nodeIds[0];
    await page.locator("[data-run-graph]").evaluate((host, id) => {
      const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
      cy.nodes().filter((node) => (node.data("path")?.at(-1) || node.id()) === id).first().emit("tap");
    }, targetId);
    await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", targetId);
    expect(await page.evaluate(() => window.clicks.at(-1).node)).toEqual(document.execution.nodes.find((node) => node.id === targetId));
    await expect(page.locator('[data-scope-result] [data-run-channel="output"]')).toContainText(name === "left" ? "request/left" : "request/left/right");
    if (name === "left") await expect(page.locator('[data-scope-result] [data-run-channel="output"]')).not.toContainText("request/left/right");
  }
  // A derived declaration-only view is not counted as another real run. The
  // selected subtree must keep its complete source path for click ownership.
  const definition = structuredClone(record.evidence.filter((envelope) => envelope.kind === "workflow.snapshot"));
  delete definition[0].payload.execution;
  const declaredModel = explain(definition);
  const declaredLeft = declaredModel.explanation.groups.find((group) => group.parentId && group.label === "left");
  await page.evaluate((input) => window.viewer.update(input), definition);
  await page.evaluate((id) => window.viewer.selectGroup(id), declaredLeft.id);
  await openDiagram(page);
  await page.locator("[data-run-graph]").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    // Published renderer Cytoscape data exposes id/key; path is only supplied
    // by its public click callback, not stored as node.data("path").
    const node = cy.getElementById("shared");
    if (node.length !== 1) throw new Error("Expected the exact declared local node shared");
    node.emit("tap");
  });
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", declaredLeft.nodeIds[0]);
  await expect(page.locator("[data-step-detail] > .erv-badge")).toHaveText("声明");
  await expect(page.locator("[data-scope-result] [data-run-value]")).toHaveCount(0);
  await page.evaluate((input) => window.viewer.update(input), fixture("workflow-definition-only"));
  const declaredId = await page.evaluate(() => window.viewer.explanation.groups[0].id);
  await page.evaluate((id) => window.viewer.selectGroup(id), declaredId);
  await openDiagram(page);
  await expect(page.locator("[data-scope-result]")).toBeHidden();
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  await expect(page.locator("[data-scope-result] [data-run-value]")).toHaveCount(0);
  await page.locator("[data-run-graph]").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  // The graph can focus a structural port first; explicit canonical selection
  // still remains a declaration and cannot supply a fabricated duration.
  await page.locator("[data-step-list] [data-step-id]").first().click();
  await expect(page.locator("[data-step-detail] > .erv-badge")).toHaveText("声明");
});

test("embedded cyclic Graph declarations keep their original cycle-aware path when selecting the top-level scope", { tag: "@P0" }, async ({ page }) => {
  const definition = fixture("graph-step-limit").evidence.filter((envelope) => envelope.kind === "compose.graph");
  await openEmbedded(page, definition);
  const scope = await page.evaluate(() => window.viewer.explanation.groups[0].id);
  await page.evaluate((id) => window.viewer.selectGroup(id), scope);
  await openDiagram(page);
  await expect(page.locator("[data-run-graph] svg")).toBeVisible();
  await expect(page.locator("[data-run-graph] [data-edge-index]")).toHaveCount(definition[0].payload.edges.length);
  await page.locator('[data-run-graph] [data-node-id="retry"]').click();
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", "graph:1:retry");
  await expect(page.locator("[data-step-detail] > .erv-badge")).toHaveText("声明");
  await expect(page.locator("[data-scope-result]")).toBeHidden();
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  await expect(page.locator("[data-scope-result] [data-run-value]")).toHaveCount(0);
});

test("embedded three-level repeated names keep leaf returns separate and breadcrumbs restore the exact parent trajectory", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-deep-nested-distinct-results");
  const { document, explanation } = explain(record);
  const scopes = explanation.groups.map((group) => buildScopeReading(document, explanation, { groupId: group.id }));
  const middle = scopes.find((reading) => reading.path.length === 2);
  const leaf = scopes.find((reading) => reading.path.length === 3);
  expect(middle.group.label).toBe(leaf.group.label);
  await openEmbedded(page, record);
  const reader = agentReader(page);
  await openAgentReaderScope(reader, leaf.group.id);
  await openDiagram(page);
  await expectLocalGraph(page, leaf);
  await expect(agentBoundary(reader, "output", { local: true })).toContainText("leaf result: verified single");
  await expect(agentBoundary(reader, "output", { local: true })).not.toContainText("middle result:");
  await expect(reader.locator('[data-reading-scope] [data-hierarchy-group]:not([data-hierarchy-group=""])')).toHaveCount(3);
  await reader.locator(`[data-reading-scope] [data-hierarchy-group=${JSON.stringify(middle.group.id)}]`).focus();
  await page.keyboard.press("Enter");
  await expectLocalGraph(page, middle);
  await expect(agentBoundary(reader, "output", { local: true })).toContainText("middle result: reviewed single");
  await expect(agentBoundary(reader, "output", { local: true })).not.toContainText("leaf result:");
  await expectLocalGraph(page, middle);
  await screenshot(page, testInfo, "embedded-local-three-level");
  await showAgentGlobalResult(reader);
  await expect(agentBoundary(reader, "output")).toContainText("parent final: accepted single");
  expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(record.evidence);
});

test("embedded deep failure stays failed at the leaf while middle return and overall success remain independent", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-deep-nested-failure-recovered");
  const { document, explanation } = explain(record);
  const scopes = explanation.groups.map((group) => buildScopeReading(document, explanation, { groupId: group.id }));
  const leaf = scopes.find((reading) => reading.path.length === 3);
  const middle = scopes.find((reading) => reading.path.length === 2);
  await openEmbedded(page, record);
  const reader = agentReader(page);
  await page.evaluate((id) => window.viewer.selectGroup(id), leaf.group.id);
  await openDiagram(page);
  await expectLocalGraph(page, leaf);
  await expect(page.locator("[data-scope-outcome]")).toHaveAttribute("data-scope-outcome", "failed");
  await expect(agentBoundary(reader, "output", { local: true }).locator("[data-run-value]")).toHaveCount(0);
  await expect(page.locator("[data-scope-issues]")).toContainText("deep lookup rejected: failure");
  await expect(page.locator('[data-scope-issue-role="caller-boundary"]')).toContainText("调用方已处理");
  await expect(page.locator('[data-scope-issue-role="caller-boundary"]')).not.toContainText("不代表子调用内部成功");
  await expect(page.locator('[data-scope-issue-role="caller-boundary"] [data-run-issue-step]')).toBeVisible();
  await expect(page.locator("[data-scope-outcome]")).toHaveAttribute("data-scope-outcome", "failed");
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  await reader.locator(`[data-reading-scope] [data-hierarchy-group=${JSON.stringify(middle.group.id)}]`).click();
  await expectLocalGraph(page, middle);
  await expect(page.locator("[data-scope-outcome]")).toHaveAttribute("data-scope-outcome", "success");
  await expect(agentBoundary(reader, "output", { local: true })).toContainText("middle result: recovered with local fallback");
  await expect(page.locator("[data-scope-issues]")).toContainText("deep lookup rejected: failure");
  await showAgentGlobalResult(reader);
  await expect(agentBoundary(reader, "output")).toContainText("parent final: accepted middle fallback");
});

test("embedded local failures, updates and multiple mounted trajectories preserve canonical ownership", { tag: "@P0" }, async ({ page }) => {
  const first = fixture("agent-nested-failure-recovered");
  await openEmbedded(page, first);
  await page.evaluate((record) => { window.second = window.createRunViewer(document.querySelector("#second"), record); }, fixture("agent-direct-answer"));
  await openDiagram(page);
  for (const [id, global] of [["agent-nested-failure-recovered", "success"], ["agent-nested-failure-propagated", "failed"]]) {
    const record = fixture(id);
    const { document, explanation } = explain(record);
    const group = explanation.groups.find((entry) => entry.parentId);
    const reading = buildScopeReading(document, explanation, { groupId: group.id });
    await page.evaluate((input) => window.viewer.update(input), record);
    await page.evaluate((id) => window.viewer.selectGroup(id), group.id);
    await openDiagram(page);
    await expectLocalGraph(page, reading);
    await expect(page.locator("#viewer [data-run-result]")).toHaveAttribute("data-run-result", global);
    await expect(page.locator("#viewer [data-scope-issues]")).toContainText("lookup rejected: failure");
    await expect(page.locator("#viewer [data-local-result]")).not.toContainText("parent final:");
    await expect(page.locator("#second [data-run-result]")).toHaveAttribute("data-run-result", "success");
    const before = await page.locator("#viewer").innerHTML();
    const error = await page.evaluate(() => { try { window.viewer.update({ broken: true }); } catch (error) { return error.code; } });
    expect(error).toBeTruthy();
    expect(await page.locator("#viewer").innerHTML()).toBe(before);
    await expectLocalGraph(page, reading);
    // Replace a selected trajectory and immediately dispatch on its old button.
    // A detached old view cannot reselect evidence in the replacement instance.
    await page.evaluate((input) => {
      const previous = document.querySelector("#viewer [data-trajectory-record]");
      window.viewer.update(input);
      previous?.click();
    }, record);
    expect(await page.evaluate(() => window.viewer.selectedStepId)).toBe("input:user:1");
    await page.evaluate((id) => window.viewer.selectGroup(id), group.id);
    await openDiagram(page);
    await expectLocalGraph(page, reading);
  }
  await page.evaluate(() => {
    const previous = document.querySelector("#viewer [data-trajectory-record]");
    window.viewer.destroy();
    window.viewer.destroy();
    previous?.click();
  });
  await expect(page.locator("#viewer [data-eino-run-viewer]")).toHaveCount(0);
  await expect(page.locator("#second [data-eino-run-viewer]")).toBeVisible();
  await page.evaluate(() => window.second.destroy());
});

test("portable narrow local results are keyboard readable, offline and unchanged by invalid imports", { tag: "@P1" }, async ({ page }, testInfo) => {
  const requests = [];
  page.on("request", (request) => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(portableURL);
  await page.waitForLoadState("networkidle");
  const record = fixture("agent-nested-parallel-scopes");
  const source = ` \n${JSON.stringify(record, null, 3)}\n`;
  const { document, explanation } = explain(record);
  await page.locator("#record-file").setInputFiles({ name: "local-reading.json", mimeType: "application/json", buffer: Buffer.from(source) });
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  await page.locator("#locale").selectOption("en");
  const reader = agentReader(page);
  const group = explanation.groups.find((entry) => entry.label.endsWith("call-child-fast"));
  const reading = buildScopeReading(document, explanation, { groupId: group.id });
  await openAgentReaderScope(reader, group.id, { keyboard: true });
  await openDiagram(page);
  await expectLocalGraph(page, reading, { document, explanation });
  await page.locator("[data-trajectory-record]").last().focus();
  await page.keyboard.press("Enter");
  const selectedStep = await page.locator("[data-step-detail]").getAttribute("data-step-id");
  expect(selectedStep).toBeTruthy();
  await expect(agentBoundary(reader, "output", { local: true })).toContainText("child result:fast");
  const index = reading.output.items[0].evidenceEnvelopeIndexes[0];
  expect(reading.output.items[0].value).toEqual({ response: "child result:fast" });
  expect(record.evidence[index].payload.body.response).toBe("child result:fast");
  const detailBefore = await agentDetail(reader).innerHTML();
  const selected = await page.locator("[data-reading-scope]").getAttribute("data-group-id");
  await openPasteEditor(page);
  await page.locator("#record-json").fill('{"invalid":');
  await page.locator("#apply-record").click();
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", selected);
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", selectedStep);
  await expectLocalGraph(page, reading, { document, explanation });
  expect(await agentDetail(reader).innerHTML()).toBe(detailBefore);
  const download = page.waitForEvent("download");
  await page.locator("#download-record").click();
  expect(readFileSync(await (await download).path(), "utf8")).toBe(source);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toEqual([]);
  await screenshot(page, testInfo, "portable-local-narrow");
});
