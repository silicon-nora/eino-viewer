import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { openStepSearch, openReadingDirectory, openRunInformation, openScopeInformation, openAgentScope, openWorkbenchRecord, selectAgentStep, expectSelectedEvidence } from "../helpers/workbench-ui.js";
import { expectedScopeTrajectoryIds } from "../helpers/run-viewer-ui.js";
import { buildScopeReading } from "../../src/scope-reading.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";

const fixture = (id) => JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${id}.json`, import.meta.url), "utf8"));
const errors = new WeakMap();
const scopeBox = (page) => page.locator(":is(#scope-result-summary, .eino-agent-reader [data-local-result])");
const scopeOutput = (page) => scopeBox(page).locator('[data-scope-channel="output"]');
const globalOutput = (page) => page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]');

test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openRecord(page, record, revealSearch = true) {
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
  if (record.source === "agent") {
    await expect(page.locator('.eino-agent-reader')).toBeVisible();
    expect(await page.evaluate(() => window.playground.validation.kind)).not.toBe("invalid");
  } else await expect(page.locator("#validation-result")).not.toHaveClass(/invalid/);
  if (revealSearch && record.source !== "agent") await openStepSearch(page);
}

async function chooseGroup(page, groupId) {
  if (await page.evaluate(() => window.playground.objectKind === "agent")) {
    await openAgentScope(page, groupId);
    await expect(scopeBox(page)).toHaveAttribute("data-scope-id", groupId);
    return;
  }
  await openReadingDirectory(page);
  const path = await page.evaluate((id) => {
    const groups = window.playground.explanation.groups, path = [];
    let group = groups.find((item) => item.id === id);
    while (group) { path.unshift(group.id); group = groups.find((item) => item.id === group.parentId); }
    return path;
  }, groupId);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  if (await page.locator("#hierarchy-directory").getAttribute("open") === null) await page.locator("#hierarchy-directory > summary").click();
  for (const id of path) await page.locator(`#hierarchy-groups [data-hierarchy-group=${JSON.stringify(id)}]`).click();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", groupId);
  await expect(scopeBox(page)).toHaveAttribute("data-scope-id", groupId);
}

async function canonicalState(page) {
  return page.evaluate(() => ({ original: window.playground.document, projection: window.playground.projection.document,
    execution: window.playground.executionDAG, explanation: window.playground.explanation }));
}

async function expectTrajectoryCardHierarchy(page, records, depths) {
  const geometry = await page.locator("[data-trajectory-record]").evaluateAll((buttons) => buttons.map((button) => {
    const item = button.closest("li"), list = item.parentElement.getBoundingClientRect();
    const card = item.getBoundingClientRect(), heading = button.getBoundingClientRect();
    return { id: button.dataset.trajectoryRecord, parent: item.dataset.trajectoryParent,
      left: card.left - list.left, right: card.right - list.right, width: list.width,
      headingLeft: heading.left - card.left, headingRight: heading.right - card.right };
  }));
  expect(geometry.map(({ id }) => id)).toEqual(records.map(({ id }) => id));
  const visibleIds = new Set(records.map(({ id }) => id));
  for (const [index, card] of geometry.entries()) {
    const record = records[index];
    expect(card.parent, `${record.id}: exact confirmed parent within this reading scope`)
      .toBe(visibleIds.has(record.parentId) ? record.parentId : undefined);
    expect(card.left, `${record.id}: actual card indentation`)
      .toBeCloseTo(Math.min(depths[index] * 28, card.width * .3), 0);
    expect(Math.abs(card.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.headingLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.headingRight)).toBeLessThanOrEqual(1);
  }
}

async function graphState(page) {
  return page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    if (!cy) return null;
    const id = (node) => node.data("path")?.at(-1) || node.id();
    return { nodes: cy.nodes().filter((node) => node.data("metadata")?.executionKind).map(id).sort(),
      edges: cy.edges().map((edge) => ({ from: id(edge.source()), to: id(edge.target()), kind: edge.data("metadata")?.executionEdgeKind,
        synthetic: edge.data("metadata")?.synthetic === true })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  });
}

async function expectInducedGraph(page) {
  const expected = await page.evaluate(() => {
    const reading = window.playground.scopeReading, ids = new Set(reading.nodeIds);
    return { nodes: window.playground.executionDAG.nodes.filter(({ id }) => ids.has(id)).map(({ id }) => id).sort(),
      edges: window.playground.executionDAG.edges.filter(({ from, to }) => ids.has(from) && ids.has(to))
        .map(({ from, to, kind }) => ({ from, to, kind, synthetic: false })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  });
  if (await page.evaluate(() => window.playground.objectKind === "agent")) {
    const { records, groups, scope } = await page.evaluate(() => ({ records: window.playground.trajectory.records,
      groups: window.playground.explanation.groups, scope: window.playground.inspectionScope }));
    await expect(page.locator('.eino-agent-reader [data-agent-trajectory]')).toBeVisible();
    await expect(page.locator("#dag canvas, #dag svg")).toHaveCount(0);
    expect(await page.locator("[data-trajectory-record]").evaluateAll((items) => items.map((item) => item.dataset.trajectoryRecord)))
      .toEqual(expectedScopeTrajectoryIds(records, groups, scope));
    // Removing the Agent canvas must not mutate its canonical relationships.
    const edges = await page.evaluate(() => window.playground.scopeReading.execution.edges
      .map(({ from, to, kind }) => ({ from, to, kind, synthetic: false })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(edges).toEqual(expected.edges);
    const nodes = await page.evaluate(() => window.playground.scopeReading.execution.nodes.map(({ id }) => id).sort());
    expect(nodes).toEqual(expected.nodes);
    const represented = await page.locator("[data-trajectory-step]").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryStep));
    for (const id of represented) expect(expected.nodes).toContain(id);
    await expect(page.locator("#reading-sidebar, #inspection-results")).toHaveCount(0);
  } else {
    await expect.poll(() => graphState(page)).toEqual(expected);
    const steps = await page.locator("[data-inspection-node]").evaluateAll((nodes) => nodes.map((node) => node.dataset.inspectionNode).sort());
    expect(steps).toEqual(expected.nodes);
  }
}

async function screenshot(page, testInfo, name) {
  if (testInfo.project.name !== "chromium") return;
  mkdirSync(new URL("../../.artifacts/iteration-6/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`../../.artifacts/iteration-6/${name}.png`, import.meta.url).pathname, fullPage: true });
}

async function expectRecordedModelInput(page, record, nodeId) {
  const items = await page.evaluate((id) => window.playground.explanation.nodes.find((node) => node.id === id).input.items, nodeId);
  expect(items).toHaveLength(1);
  const [item] = items;
  expect(item.evidenceEnvelopeIndexes).toHaveLength(1);
  const index = item.evidenceEnvelopeIndexes[0];
  expect(item.value).toEqual(record.evidence[index].payload.body);
  await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="input"] .business-value-text')).toHaveText(JSON.stringify(item.value, null, 2));
  await expectSelectedEvidence(page, index, record.evidence[index]);
}

test("workbench parallel calls show exact local returns and only original in-scope graph connections", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-nested-parallel-scopes");
  await openRecord(page, record);
  const before = await canonicalState(page);
  const trajectory = buildExecutionTrajectory(record.evidence).trajectory;
  const depths = trajectory.records.map(({ kind, metadata }) => metadata.agentScopeUnresolved ? 0
    : metadata.parentAgentScopeId ? kind === "tool" ? 3 : 2 : kind === "tool" ? 1 : 0);
  await expectTrajectoryCardHierarchy(page, trajectory.records, depths);
  for (const key of ["slow", "fast"]) {
    const id = await page.evaluate((key) => window.playground.explanation.groups.find(({ label }) => label.endsWith(`call-child-${key}`)).id, key);
    const childRecords = trajectory.records.filter(({ metadata }) => metadata.agentScopeId === id);
    const caller = trajectory.records.find(({ toolCallId }) => toolCallId === `call-child-${key}`);
    const tool = childRecords.find(({ kind }) => kind === "tool");
    const planning = childRecords.find(({ id }) => id === tool.parentId);
    expect(tool.toolCallId).toBe("shared-inner-call");
    expect(planning.parentId).toBe(caller.id);
    expect(childRecords.filter(({ kind }) => kind === "assistant").every(({ parentId }) => parentId === caller.id)).toBe(true);
    await chooseGroup(page, id);
    await expectTrajectoryCardHierarchy(page, childRecords, [0, 1, 0]);
    await expectInducedGraph(page);
    await openScopeInformation(page);
    await expect(scopeOutput(page)).toContainText(`child result:${key}`);
    await expect(scopeOutput(page)).not.toContainText(`child result:${key === "slow" ? "fast" : "slow"}`);
    await expect(scopeOutput(page)).not.toContainText("parent final");
    await expect(scopeBox(page).locator("[data-scope-result]")).toHaveAttribute("data-scope-result", "success");
    const boundary = await page.evaluate(() => window.playground.scopeReading.boundary);
    expect(boundary.total).toBeGreaterThan(0);
    await expect(scopeBox(page)).not.toContainText("跨范围连接");
    await expect(scopeBox(page).locator(".step-identity, button[data-envelope-index]")).toHaveCount(0);
    await expect(scopeBox(page)).not.toContainText("不补造连线");
    await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toHaveCount(0);
    await openRunInformation(page);
    await expect(globalOutput(page)).toContainText("parent final: combined slow and fast");
    await expect(scopeBox(page)).toHaveCount(0);
    await expectTrajectoryCardHierarchy(page, trajectory.records, depths);
  }
  await screenshot(page, testInfo, "workbench-local-parallel");
  expect(await canonicalState(page)).toEqual(before);
  expect(await page.evaluate(() => window.playground.trajectory)).toEqual(trajectory);
});

test("local and whole-run results retain exact sources while explicit navigation changes the reading scope", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-nested-parallel-scopes");
  await openRecord(page, record);
  const id = await page.evaluate(() => window.playground.explanation.groups.find(({ label }) => label.endsWith("call-child-slow")).id);
  await chooseGroup(page, id);
  await openScopeInformation(page);
  const local = await page.evaluate(() => {
    const scope = window.playground.scopeReading, item = scope.output.items[0];
    return { item, scopeIndexes: scope.evidenceEnvelopeIndexes,
      sources: item.evidenceEnvelopeIndexes.map((index) => ({ index, envelope: window.playground.document.evidence[index] })) };
  });
  expect(local.sources).toHaveLength(1);
  for (const { index, envelope } of local.sources) {
    expect(local.scopeIndexes).toContain(index);
    expect(envelope).toEqual(record.evidence[index]);
    expect(local.item.value).toEqual(envelope.payload.body);
  }
  expect(local.item.value).toEqual({ response: "child result:slow" });
  await expect(scopeOutput(page).locator("[data-run-value]")).toHaveText(JSON.stringify(local.item.value, null, 2));
  await expect(scopeOutput(page).locator("button[data-envelope-index]")).toHaveCount(0);
  await expect(page.locator("#snapshot-json")).toBeHidden();
  await expect(scopeBox(page)).toHaveAttribute("data-scope-id", id);
  await expectInducedGraph(page);
  const selection = await page.evaluate(() => window.playground.linkedSelection);
  await scopeBox(page).locator("[data-scope-global-result]").click();
  await expect(globalOutput(page).locator("[data-run-value]")).toBeInViewport();
  await expect(globalOutput(page)).toBeFocused();
  await expect(scopeBox(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.playground.scopeReading.mode)).toBe("all");
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selection);
  await expectInducedGraph(page);
  const root = await page.evaluate(() => {
    const item = window.playground.explanation.run.output.items[0];
    return { item, sources: item.evidenceEnvelopeIndexes.map((index) => ({ index, envelope: window.playground.document.evidence[index] })) };
  });
  expect(root.sources.length).toBeGreaterThan(0);
  for (const { index, envelope } of root.sources) expect(envelope).toEqual(record.evidence[index]);
  expect(root.item.value).toBe("parent final: combined slow and fast");
  expect(root.item.evidenceEnvelopeIndexes).not.toEqual(local.item.evidenceEnvelopeIndexes);
  await expect(globalOutput(page).locator("[data-run-value]")).toHaveText(root.item.value);
  await expect(globalOutput(page).locator("button[data-envelope-index]")).toHaveCount(0);
  await expect(scopeBox(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.playground.scopeReading.mode)).toBe("all");
  await expectInducedGraph(page);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("three equal-named Agent levels expose their own boundary returns and breadcrumb navigation", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-deep-nested-distinct-results");
  await openRecord(page, record);
  const before = await canonicalState(page);
  const trajectory = buildExecutionTrajectory(record.evidence).trajectory;
  await expectTrajectoryCardHierarchy(page, trajectory.records, [0, 0, 1, 2, 3, 4, 5, 4, 2, 0]);
  const groups = await page.evaluate(() => window.playground.explanation.groups);
  const middle = groups.find(({ parentId }) => parentId === groups[0].id);
  const leaf = groups.find(({ parentId }) => parentId === middle.id);
  const leafRecords = trajectory.records.filter(({ metadata }) => metadata.agentScopeId === leaf.id);
  const middleRecords = trajectory.records.filter(({ metadata }) => [middle.id, leaf.id].includes(metadata.agentScopeId));
  expect(middle.label).toBe(leaf.label);
  await chooseGroup(page, leaf.id);
  await expectTrajectoryCardHierarchy(page, leafRecords, [0, 1, 0]);
  await expectInducedGraph(page);
  await selectAgentStep(page, leaf.nodeIds[0]);
  await expectRecordedModelInput(page, record, leaf.nodeIds[0]);
  const leafPath = [groups[0].label, middle.label, leaf.label].join(" / ");
  const middlePath = [groups[0].label, middle.label].join(" / ");
  expect(leafPath).not.toBe(middlePath);
  const context = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context.agent-step-scope");
  await expect(context).toContainText(leafPath);
  await expect(context.locator(".agent-scope-path")).toHaveText(leafPath);
  await expect(context.locator("[data-hierarchy-group]")).toHaveCount(0);
  await openScopeInformation(page);
  await expect(scopeOutput(page)).toContainText("leaf result: verified single");
  await expect(scopeOutput(page)).not.toContainText("middle result");
  await expect(scopeOutput(page)).not.toContainText("parent final");
  const leafCount = await page.evaluate(() => window.playground.scopeReading.nodeIds.length);
  await page.locator(`:is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=${JSON.stringify(middle.id)}]`).click();
  await expect(scopeBox(page)).toHaveAttribute("data-scope-id", middle.id);
  await expectTrajectoryCardHierarchy(page, middleRecords, [0, 1, 2, 3, 2, 0]);
  await expectInducedGraph(page);
  await selectAgentStep(page, middle.nodeIds[0]);
  await expectRecordedModelInput(page, record, middle.nodeIds[0]);
  await expect(context).toContainText(middlePath);
  await expect(context).not.toContainText(leafPath);
  await expect(context.locator(".agent-scope-path")).toHaveText(middlePath);
  await expect(context.locator("[data-hierarchy-group]")).toHaveCount(0);
  await openScopeInformation(page);
  await expect(scopeOutput(page)).toContainText("middle result: reviewed single");
  await expect(scopeOutput(page)).not.toContainText("leaf result");
  expect(await page.evaluate(() => window.playground.scopeReading.nodeIds.length)).toBeGreaterThan(leafCount);
  await openRunInformation(page);
  await expect(globalOutput(page)).toContainText("parent final: accepted single");
  await expectTrajectoryCardHierarchy(page, trajectory.records, [0, 0, 1, 2, 3, 4, 5, 4, 2, 0]);
  await chooseGroup(page, leaf.id);
  await expectTrajectoryCardHierarchy(page, leafRecords, [0, 1, 0]);
  await expect(scopeOutput(page)).toContainText("leaf result: verified single");
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  await expectTrajectoryCardHierarchy(page, trajectory.records, [0, 0, 1, 2, 3, 4, 5, 4, 2, 0]);
  expect(await canonicalState(page)).toEqual(before);
  expect(await page.evaluate(() => window.playground.trajectory)).toEqual(trajectory);
});

test("a failed leaf stays failed while its parent's handled return and whole-run success remain separate", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-deep-nested-failure-recovered");
  await openRecord(page, record);
  const before = await canonicalState(page);
  const groups = await page.evaluate(() => window.playground.explanation.groups);
  const middle = groups.find(({ parentId }) => parentId === groups[0].id), leaf = groups.find(({ parentId }) => parentId === middle.id);
  await chooseGroup(page, leaf.id);
  await expectInducedGraph(page);
  await openScopeInformation(page);
  await expect(scopeBox(page).locator("[data-scope-result]")).toHaveAttribute("data-scope-result", "failed");
  await expect(scopeOutput(page)).toHaveAttribute("data-availability", "not-observed");
  await expect(scopeOutput(page).locator("[data-run-value]")).toHaveCount(0);
  await expect(scopeBox(page).locator('[data-scope-issue][data-recovered="false"]').first()).toContainText("lookup rejected: failure");
  const callerIssue = scopeBox(page).locator('[data-scope-issue-origin="caller"][data-recovered="true"]');
  await expect(callerIssue).toHaveCount(1);
  await expect(callerIssue.locator("h3")).toContainText("调用方已处理");
  await expect(callerIssue).not.toContainText("不代表子调用内部成功");
  await expect(scopeBox(page).locator('[data-scope-issue-origin="local"][data-recovered="false"]').first()).toContainText("lookup rejected: failure");
  await expect(scopeBox(page).locator(":scope > .trajectory-view")).toBeVisible();
  await expect(scopeBox(page).locator(":scope > .run-result-issues")).toBeVisible();
  await screenshot(page, testInfo, "workbench-local-failed-leaf");
  await scopeBox(page).locator("[data-scope-global-result]").click();
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  await expect(globalOutput(page).locator("[data-run-value]")).toHaveText("parent final: accepted middle fallback");
  await expect(globalOutput(page).locator("[data-run-value]")).toBeInViewport();
  await expect(globalOutput(page)).toBeFocused();
  await chooseGroup(page, middle.id);
  await openScopeInformation(page);
  await expect(scopeOutput(page)).toContainText("middle result: recovered with local fallback");
  await expect(scopeBox(page)).not.toContainText("不代表子调用内部全部成功");
  await expect(scopeBox(page).locator("[data-scope-issue]")).not.toHaveCount(0);
  expect(await canonicalState(page)).toEqual(before);
});

test("Workflow sibling scopes keep exact boundary IO and missing boundaries never borrow a child result", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("workflow-nested-names");
  await openRecord(page, record);
  const groups = await page.evaluate(() => window.playground.explanation.groups);
  for (const side of ["left", "right"]) {
    await chooseGroup(page, groups.find(({ label }) => label === side).id);
    await expectInducedGraph(page);
    await expect(scopeOutput(page)).toContainText(side === "left" ? 'request/left' : 'request/left/right');
    await page.locator("[data-inspection-node]").click();
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.technical.metadata.sourceNodePath)).toEqual([side, "shared"]);
  }
  const withoutBoundary = fixture("workflow-nested-names");
  withoutBoundary.evidence = withoutBoundary.evidence.filter(({ kind, payload }) => kind !== "component.io" || payload.component !== "Workflow");
  await openRecord(page, withoutBoundary);
  const id = await page.evaluate(() => window.playground.explanation.groups.find(({ label }) => label === "left").id);
  await chooseGroup(page, id);
  await expect(scopeOutput(page)).toHaveAttribute("data-availability", "not-observed");
  await expect(scopeOutput(page).locator("[data-run-value]")).toHaveCount(0);
  await expect(scopeBox(page).locator("[data-scope-result]")).toHaveAttribute("data-scope-result", "unknown");
  await page.locator("[data-inspection-node]").click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("request/left");
});

test("declared nested Workflow draws only its own subtree and maps clicks to the full original path", { tag: "@P0" }, async ({ page }) => {
  const envelope = fixture("workflow-nested-names").evidence[0];
  delete envelope.payload.execution;
  await openRecord(page, envelope);
  const before = await canonicalState(page);
  const id = await page.evaluate(() => window.playground.explanation.groups.find(({ label }) => label === "left").id);
  await chooseGroup(page, id);
  await expect(scopeBox(page).locator("[data-scope-result]")).toHaveAttribute("data-scope-result", "definition-only");
  await expect(page.locator("#dag canvas").first()).toBeVisible();
  const state = await page.evaluate(() => ({ execution: window.playground.scopeReading.execution,
    prefix: window.playground.scopeReading.definitionPathPrefix, definition: window.playground.scopeReading.definitionSnapshot,
    ids: window.playground.scopeReading.nodeIds }));
  expect(state.execution).toBeUndefined();
  expect(state.prefix).toEqual(["left"]);
  expect(state.ids).toEqual(["left/shared"]);
  expect(state.definition.workflow.nodes.map(({ id }) => id)).toEqual(["shared"]);
  expect(state.definition.execution).toBeUndefined();
  const renderedIds = await page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    // Published renderer derives click paths from data.id. Raw Cytoscape data
    // has no path field; only the normalized public click event has one.
    return cy.nodes().map((node) => node.id()).filter((id) => !["start", "end"].includes(id));
  });
  expect(renderedIds).toEqual(["shared"]);
  await page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    cy.getElementById("shared").emit("tap");
  });
  await expect.poll(() => page.evaluate(() => window.playground.selectedNodeDetail?.explanationNode.id)).toBe("left/shared");
  expect(await canonicalState(page)).toEqual(before);
});

test("flat Graph loop visits stay separate and graph clicks retain canonical identities", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("graph-step-limit");
  await openRecord(page, record);
  const before = await canonicalState(page);
  expect(await page.evaluate(() => window.playground.explanation.groups.length)).toBe(1);
  await expect(page.locator("#hierarchy-directory")).toBeHidden();
  await expectInducedGraph(page);
  const visits = await page.evaluate(() => window.playground.scopeReading.execution.nodes.filter(({ component }) => component === "Lambda"));
  expect(visits).toHaveLength(3);
  expect(new Set(visits.map(({ id }) => id)).size).toBe(3);
  for (const node of visits) {
    await page.locator("#dag").evaluate((host, id) => {
      const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
      cy.getElementById(id).emit("tap");
    }, node.id);
    await expect.poll(() => page.evaluate(() => window.playground.selectedNodeDetail?.executionNode.id)).toBe(node.id);
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode.evidence)).toEqual(node.evidence);
  }
  expect(await canonicalState(page)).toEqual(before);
});

test("unassigned evidence stays visible without becoming one successful call and empty scopes never draw fabricated endpoints", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-nested-parallel-scopes");
  await openRecord(page, record);
  const model = await canonicalState(page);
  const unassigned = buildScopeReading(model.projection, model.explanation, { ungroupedOnly: true, locale: "zh" });
  expect(unassigned.mode).toBe("unassigned");
  expect(unassigned.result.state).toBe("unknown");
  expect(unassigned.output.items).toEqual([]);
  const unresolved = await page.evaluate(() => window.playground.trajectory.records.filter(({ metadata }) => metadata.agentScopeUnresolved));
  expect(unresolved).toHaveLength(6);
  const rootLeft = await page.locator("[data-trajectory-record]").first().evaluate((button) => button.closest("li").getBoundingClientRect().left);
  for (const entry of unresolved) {
    const row = page.locator(`[data-trajectory-record=${JSON.stringify(entry.id)}]`);
    await expect(row).toContainText("归属未确认");
    expect(entry.parentId).toBeUndefined();
    const geometry = await row.evaluate((button) => ({ parent: button.closest("li").dataset.trajectoryParent,
      left: button.closest("li").getBoundingClientRect().left, headingLeft: button.getBoundingClientRect().left }));
    expect(geometry.parent).toBeUndefined();
    expect(geometry.left).toBeCloseTo(rootLeft, 0);
    expect(geometry.headingLeft).toBeCloseTo(rootLeft, 0);
  }
  await expectInducedGraph(page);
  await expect(scopeBox(page)).toHaveCount(0);
  await page.locator(`[data-trajectory-record=${JSON.stringify(unresolved[0].id)}]`).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-state")).toContainText("调用归属未确认");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-hierarchy-group]")).toHaveCount(0);
  for (const { envelopeIndex } of unresolved[0].evidence) await expectSelectedEvidence(page, envelopeIndex, record.evidence[envelopeIndex]);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await openRecord(page, fixture("workflow-definition-only"));
  if (await page.locator("#hierarchy-directory").getAttribute("open") === null) await page.locator("#hierarchy-directory > summary").click();
  await expect(page.locator("#hierarchy-ungrouped")).toBeHidden();
  await expect(scopeBox(page)).toBeHidden();
  await expect(page.locator("#dag canvas").first()).toBeVisible();
});

test("narrow keyboard scope browsing preserves context after a rejected example and language changes", { tag: "@P1" }, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rejected = JSON.parse(readFileSync(new URL("../../fixtures/eino-agent-recorder-trip-planner-failure-completed-v1.json", import.meta.url), "utf8"));
  rejected.schemaVersion = 99;
  await page.route("**/eino-agent-recorder-trip-planner-failure-completed-v1.json*", (route) => route.fulfill({ json: rejected }));
  await page.reload();
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
  const record = fixture("agent-nested-distinct-results");
  await openRecord(page, record, false);
  await expect(page.locator("#record-actions, #global-summary, #scope-information")).toHaveCount(0);
  await expect(page.locator("#record-picker, #record-file, #viewer-kind")).toHaveCount(0);
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
  await expect(page.locator("#reading-sidebar, #inspection-search, #hierarchy-directory")).toHaveCount(0);
  const target = await page.evaluate(() => {
    const node = window.playground.executionDAG.nodes.find((node) => node.kind === "tool" && node.metadata.parentAgentScopeId);
    return { nodeId: node.id, groupId: node.metadata.agentScopeId };
  });
  const step = page.locator(`[data-trajectory-step=${JSON.stringify(target.nodeId)}]`);
  await step.focus();
  await page.keyboard.press("Enter");
  await page.locator(`:is(#node-detail, .eino-agent-reader [data-step-detail]) [data-hierarchy-group=${JSON.stringify(target.groupId)}]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toBeFocused();
  await expect(page.locator("#scope-information, :is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toHaveCount(0);
  await openScopeInformation(page);
  await expect(scopeOutput(page)).toContainText("child result:single");
  const before = await page.evaluate(() => ({ scope: window.playground.inspectionScope, ids: window.playground.scopeReading.nodeIds }));
  await selectAgentStep(page, target.nodeId);
  const selected = await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.id);
  const agentScope = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context.agent-step-scope");
  const path = await page.evaluate(() => {
    const groups = window.playground.explanation.groups, labels = [];
    let group = groups.find(({ id }) => id === window.playground.inspectionScope.groupId);
    while (group) { labels.unshift(group.label); group = groups.find(({ id }) => id === group.parentId); }
    return labels.join(" / ");
  });
  await expect(agentScope).toContainText(path);
  await expect(agentScope.locator(".agent-scope-path")).toHaveText(path);
  await expect(agentScope.locator("[data-hierarchy-group]")).toHaveCount(0);
  await expect(page.locator("#reading-sidebar")).toHaveCount(0);
  await expect(page.locator("#record-picker")).toHaveCount(0);
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toBeVisible();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]')).toBeVisible();
  await expect(page.locator("#close-details")).toHaveCount(0);
  await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
  await page.keyboard.press("Escape");
  await expect(step).toBeFocused();
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.id)).toBe(selected);
  const acceptedSample = await page.locator("#sample").inputValue();
  await page.locator("#sample").selectOption("agent-weather-failure");
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("#sample")).toHaveValue(acceptedSample);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.id)).toBe(selected);
  expect(await page.evaluate(() => ({ scope: window.playground.inspectionScope, ids: window.playground.scopeReading.nodeIds }))).toEqual(before);
  await page.locator('[data-language="en"]').click();
  await expect(page.locator("#sample")).toHaveValue(acceptedSample);
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(agentScope).toContainText(path);
  await expect(agentScope.locator(".agent-scope-path")).toHaveText(path);
  await expect(agentScope.locator("[data-hierarchy-group]")).toHaveCount(0);
  await expect(page.locator("#record-actions")).toHaveCount(0);
  await expect(page.locator("#reading-sidebar")).toHaveCount(0);
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toBeVisible();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]')).toBeVisible();
  await expect(step).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.id)).toBe(selected);
  await openScopeInformation(page);
  await expect(scopeOutput(page)).toContainText("child result:single");
  expect(await page.evaluate(() => ({ scope: window.playground.inspectionScope, ids: window.playground.scopeReading.nodeIds }))).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await expect(page.locator("#record-picker")).toHaveCount(0);
  await screenshot(page, testInfo, "workbench-local-narrow");
  const parentId = await page.evaluate(() => window.playground.explanation.groups.find(({ id }) => id === window.playground.inspectionScope.groupId).parentId);
  await page.locator(`:is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=${JSON.stringify(parentId)}]`).click();
  await expect(page.locator("#record-actions")).toHaveCount(0);
  await expect(page.locator("#reading-sidebar")).toHaveCount(0);
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", parentId);
  await expect(step).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#record-actions")).toHaveCount(0);
  await expect(page.locator("#reading-sidebar")).toHaveCount(0);
  await expect(page.locator(".eino-agent-reader [data-agent-trajectory]")).toBeFocused();
  await expect(scopeBox(page)).toHaveCount(0);
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
  expect(await page.evaluate(() => window.playground.inspectionScope)).toEqual({ groupId: undefined, ungroupedOnly: false });
  await expect(step).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("local call channels distinguish zero, null, empty, redacted and omitted source bodies", { tag: "@P0" }, async ({ page }) => {
  for (const [body, availability, capture] of [[0, "available", {}], [null, "null", {}], ["", "empty", {}],
    ["[REDACTED]", "redacted", { redacted: true }], [undefined, "not-observed", { status: "omitted", reason: "unsupported_value" }]]) {
    const record = fixture("agent-nested-distinct-results");
    const entry = record.evidence.find(({ kind, payload }) => kind === "component.io" && payload.component === "Tool" && payload.direction === "output" && payload.address.at(-1).subId === "call-child-one");
    if (body === undefined) delete entry.payload.body; else entry.payload.body = body;
    entry.metadata = { ...entry.metadata, capture: { status: "captured", ...capture } };
    await openRecord(page, record);
    const id = await page.evaluate(() => window.playground.explanation.groups.find(({ parentId }) => parentId).id);
    await chooseGroup(page, id);
    await openScopeInformation(page);
    await expect(scopeOutput(page).locator(".run-result-item")).toHaveAttribute("data-availability", availability);
    if (body === undefined) await expect(scopeOutput(page).locator("[data-run-value]")).toHaveCount(0);
    else await expect(scopeOutput(page).locator("[data-run-value]")).toHaveText(body === "" ? '""' : body === null ? "null" : String(body));
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  }
});

test("Agent trajectory stays in the selected call and returning between scopes does not alter facts", { tag: "@P1" }, async ({ page }) => {
  const record = fixture("agent-nested-parallel-scopes");
  await openRecord(page, record);
  const before = await canonicalState(page);
  const trajectoryBefore = await page.evaluate(() => window.playground.trajectory);
  const groupId = before.explanation.groups.find(({ label }) => label.endsWith("call-child-slow")).id;
  await chooseGroup(page, groupId);
  await openScopeInformation(page);
  await expect(scopeBox(page)).toBeVisible();
  await expectInducedGraph(page);
  await expect(page.locator("#run-view-tabs")).toBeHidden();
  await expect(scopeBox(page)).toHaveAttribute("data-scope-id", groupId);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  await expect(scopeBox(page)).toHaveCount(0);
  expect(await page.locator("[data-trajectory-record]").evaluateAll((nodes) => nodes.map((node) => node.dataset.trajectoryRecord)))
    .toEqual(trajectoryBefore.records.map(({ id }) => id));
  await expect(page.locator("[data-replay-controls], [data-replay-action], [data-replay-range]")).toHaveCount(0);
  await chooseGroup(page, groupId);
  await expect(page.locator('.eino-agent-reader [data-agent-trajectory]')).toBeVisible();
  await expect(scopeBox(page)).toHaveAttribute("data-scope-id", groupId);
  await expectInducedGraph(page);
  expect(await canonicalState(page)).toEqual(before);
  expect(await page.evaluate(() => window.playground.trajectory)).toEqual(trajectoryBefore);
});

test("a declared flat Graph stays the original SVG cycle without a redundant root scope control", { tag: "@P0" }, async ({ page }) => {
  const record = JSON.parse(readFileSync(new URL("../../fixtures/eino-compose-cyclic-graph-envelope-v1.json", import.meta.url), "utf8"));
  await openRecord(page, record);
  const before = await canonicalState(page);
  expect(before.execution).toBeUndefined();
  const group = before.explanation.groups.find(({ kind }) => kind === "graph");
  expect(group.basis).toBe("declared");
  expect(before.explanation.groups).toHaveLength(1);
  await expect(page.locator("#hierarchy-directory")).toBeHidden();
  await expect(scopeBox(page)).toBeHidden();
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  await expect(page.locator("#dag .eino-viewer-graph svg")).toBeVisible();
  await expect(page.locator("#dag canvas")).toHaveCount(0);
  const rendered = await page.locator("#dag .eino-viewer-graph svg").evaluate((svg) => ({
    nodes: [...svg.querySelectorAll("[data-node-id]")].map((node) => node.dataset.nodeId).sort(),
    edges: [...svg.querySelectorAll("[data-edge-index]")].map((edge) => ({ index: Number(edge.dataset.edgeIndex), path: edge.getAttribute("d") })),
  }));
  expect(rendered.nodes).toEqual(["end", "model", "start", "tools"]);
  expect(rendered.edges.map(({ index }) => index)).toEqual(record.payload.edges.map((_, index) => index));
  const forwardIndex = record.payload.edges.findIndex(({ from, to }) => from === "model" && to === "tools");
  const reverseIndex = record.payload.edges.findIndex(({ from, to }) => from === "tools" && to === "model");
  expect(rendered.edges[forwardIndex].path).toContain(" Q ");
  expect(rendered.edges[reverseIndex].path).toContain(" Q ");
  expect(rendered.edges[forwardIndex].path).not.toBe(rendered.edges[reverseIndex].path);
  expect(await page.evaluate(() => window.playground.scopeReading.execution)).toBeUndefined();
  expect(await page.evaluate(() => window.playground.projection.document.definition)).toEqual(record.payload);
  expect(await canonicalState(page)).toEqual(before);
});
