import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { openStepSearch, openReadingDirectory, openRunInformation, openDetails, openAgentScope, openWorkbenchRecord, selectAgentStep, expectSelectedEvidence } from "../helpers/workbench-ui.js";

const fixture = (id) => JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${id}.json`, import.meta.url), "utf8"));
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  await page.setViewportSize({ width: 1560, height: 980 });
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openRecord(page, record, revealSearch = true) {
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document.runId)).toBe(record.runId);
  if (revealSearch && record.source !== "agent") await openStepSearch(page);
}

async function chooseGroup(page, groupId, revealSearch = true) {
  if (await page.evaluate(() => window.playground.objectKind === "agent")) {
    await openAgentScope(page, groupId);
    return;
  }
  await openReadingDirectory(page);
  const path = await page.evaluate((id) => {
    const groups = window.playground.explanation.groups;
    const result = [];
    let group = groups.find((item) => item.id === id);
    while (group) { result.unshift(group.id); group = groups.find((item) => item.id === group.parentId); }
    return result;
  }, groupId);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  if (await page.locator("#hierarchy-directory").getAttribute("open") === null) await page.locator("#hierarchy-directory > summary").click();
  for (const id of path) await page.locator(`#hierarchy-groups [data-hierarchy-group=${JSON.stringify(id)}]`).click();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", groupId);
  if (revealSearch) await openStepSearch(page);
}

test("parallel nested scopes keep local IO and evidence separate from the global final result", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-nested-parallel-scopes");
  await openRecord(page, record, false);
  await expect(page.locator("#record-actions, #global-summary, #scope-information")).toHaveCount(0);
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
  await expect(page.locator("#reading-sidebar, #inspection-search, #hierarchy-directory")).toHaveCount(0);
  const before = await page.evaluate(() => ({ count: window.playground.explanation.nodes.length, evidence: window.playground.document.evidence.length }));
  await openRunInformation(page);
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]')).toContainText("parent final: combined slow and fast");
  for (const key of ["slow", "fast"]) {
    const sourceIndex = record.evidence.findIndex(({ kind, payload }) => kind === "component.io" && payload.component === "Tool" && payload.direction === "output" && payload.body.response === `lookup:${key}`);
    const target = await page.evaluate((index) => {
      const explanation = window.playground.explanation;
      const node = explanation.nodes.find((item) => item.kind === "tool" && item.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      const group = explanation.groups.find(({ nodeIds }) => nodeIds.includes(node.id));
      const path = [];
      let ancestor = group;
      while (ancestor) { path.unshift(ancestor.label); ancestor = explanation.groups.find(({ id }) => id === ancestor.parentId); }
      const trajectory = window.playground.trajectory.records.find((item) => item.metadata.agentScopeId === group.id
        && item.kind === "tool" && item.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      return { nodeId: node.id, groupId: group.id, path: path.join(" / "), trajectoryId: trajectory.id };
    }, sourceIndex);
    await chooseGroup(page, target.groupId, false);
    await selectAgentStep(page, target.nodeId);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(`lookup:${key}`);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).not.toContainText(`lookup:${key === "slow" ? "fast" : "slow"}`);
    const context = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context.agent-step-scope");
    await expect(context.locator("small")).toHaveText("Agent");
    await expect(context).toContainText(target.path);
    expect(target.path).toContain(`call-child-${key}`);
    expect(target.path).not.toContain(`call-child-${key === "slow" ? "fast" : "slow"}`);
    await expect(context.locator(".agent-scope-path")).toHaveText(target.path);
    await expect(context.locator("[data-hierarchy-group]")).toHaveCount(0);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) })).toContainText(`lookup:${key}`);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure, :is(#node-detail, .eino-agent-reader [data-step-detail]) .step-identity")).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.toolCallId)).toBe("shared-inner-call");
    expect(await page.evaluate((id) => window.playground.executionDAG.nodes.find((node) => node.id === id).correlation.toolCallId, target.nodeId)).toBe("shared-inner-call");
    const raw = await expectSelectedEvidence(page, sourceIndex, record.evidence[sourceIndex]);
    expect(raw).toEqual(record.evidence[sourceIndex]);
    await expect(page.locator("#snapshot-json")).toBeHidden();
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) button[data-envelope-index]")).toHaveCount(0);
    await page.locator(`[data-trajectory-record=${JSON.stringify(target.trajectoryId)}]`).click();
    await expectSelectedEvidence(page, sourceIndex, record.evidence[sourceIndex]);
    await expect(context).toContainText(target.path);
    await expect(context.locator(".agent-scope-path")).toHaveText(target.path);
    await expect(context.locator("[data-hierarchy-group]")).toHaveCount(0);
    await expect(page.locator(`.trajectory-turn[data-trajectory-scope=${JSON.stringify(target.groupId)}] .trajectory-scope`).first()).toHaveText(target.path);
    await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.explanation.run.output.items.map(({ value }) => value)))
      .toEqual(["parent final: combined slow and fast"]);
  }
  const scopedSteps = await page.locator("[data-trajectory-record]").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryRecord));
  const beforeFold = await page.evaluate(() => ({ scope: window.playground.inspectionScope, selection: window.playground.linkedSelection }));
  await expect(page.locator("#close-details")).toHaveCount(0);
  await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(`[data-trajectory-record=${JSON.stringify(beforeFold.selection.trajectoryRecordId)}]`)).toBeFocused();
  expect(await page.evaluate(() => ({ scope: window.playground.inspectionScope, selection: window.playground.linkedSelection }))).toEqual(beforeFold);
  expect(await page.locator("[data-trajectory-record]").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryRecord))).toEqual(scopedSteps);
  expect(await page.evaluate(() => ({ count: window.playground.explanation.nodes.length, evidence: window.playground.document.evidence.length }))).toEqual(before);
  if (testInfo.project.name === "chromium") {
    await openDetails(page);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure")).toHaveCount(0);
    mkdirSync(new URL("../../.artifacts/iteration-4/", import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL("../../.artifacts/iteration-4/workbench-nested.png", import.meta.url).pathname, fullPage: true });
  }
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  expect(await page.evaluate(() => window.playground.scopeReading.nodeIds.length)).toBe(before.count);
  expect(await page.evaluate(() => window.playground.inspectionScope.ungroupedOnly)).toBe(false);
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]')).toContainText("parent final: combined slow and fast");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  const unresolved = await page.evaluate(() => window.playground.trajectory.records.find((item) => item.metadata.agentScopeUnresolved).id);
  await page.locator(`[data-trajectory-record=${JSON.stringify(unresolved)}]`).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).not.toBeEmpty();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-state")).toHaveText(/调用归属未确认/);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context [data-hierarchy-group]")).toHaveCount(0);
  expect(await page.evaluate((id) => window.playground.trajectory.records.find((item) => item.id === id).metadata.agentScopeUnresolved, unresolved)).toBe(true);
});

test("local child failure remains failed while the parent final result succeeds", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-nested-failure-recovered");
  await openRecord(page, record);
  await openRunInformation(page);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  await expect(page.locator(".run-result-issues")).toContainText("局部失败，整体成功");
  const target = await page.evaluate(() => {
    const explanation = window.playground.explanation;
    const node = explanation.nodes.find(({ status }) => status === "failed");
    return { id: node.id, groupId: explanation.groups.find(({ nodeIds }) => nodeIds.includes(node.id)).id };
  });
  await chooseGroup(page, target.groupId);
  await page.locator(`:is(#scope-result-summary, .eino-agent-reader [data-local-result]) [data-issue-step=${JSON.stringify(target.id)}]`).click();
  expect(await page.evaluate(() => window.playground.linkedSelection.executionNodeId)).toBe(target.id);
  await expect(page.locator('.eino-agent-reader [data-step-detail]')).toHaveAttribute("data-step-id", target.id);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-state")).toHaveText("失败");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("lookup rejected: failure");
  await openRunInformation(page);
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]')).toContainText("parent final: recovered with fallback");
  const propagated = fixture("agent-nested-failure-propagated");
  await openRecord(page, propagated);
  await openRunInformation(page);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "failed");
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]')).toHaveAttribute("data-availability", "not-observed");
  const issues = await page.evaluate(() => window.playground.explanation.run.issues);
  expect(issues).toHaveLength(2);
  expect(new Set(issues.filter(({ recovered, nodeId }) => !recovered && nodeId).map(({ nodeId }) => nodeId)).size).toBe(2);
  const shownIssues = page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-issue]");
  for (const [index, issue] of issues.entries()) {
    await expect(shownIssues.nth(index).locator("[data-run-value]")).toHaveText(issue.message);
  }
  await page.locator('[data-agent-outcome="failed"]').click();
  await expect(shownIssues.first()).toBeFocused();
  await expect(shownIssues.first().locator("[data-run-value]")).toBeInViewport();
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]')).not.toBeFocused();
  expect(await page.evaluate(() => window.playground.document)).toEqual(propagated);
});

test("Workflow nesting and Graph revisits stay distinct, and definitions are never execution", { tag: "@P0" }, async ({ page }) => {
  await openRecord(page, fixture("workflow-nested-names"));
  const groups = await page.evaluate(() => window.playground.explanation.groups);
  for (const side of ["left", "right"]) {
    await chooseGroup(page, groups.find(({ label }) => label === side).id);
    await expect(page.locator("[data-inspection-node]")).toHaveCount(1);
    await page.locator("[data-inspection-node]").click();
    const path = await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.technical.metadata.sourceNodePath);
    expect(path).toEqual([side, "shared"]);
  }
  await openRecord(page, fixture("graph-step-limit"));
  await page.locator("#inspection-search").fill("node:retry");
  await expect(page.locator("[data-inspection-node]")).toHaveCount(3);
  const ids = await page.locator("[data-inspection-node]").evaluateAll((nodes) => nodes.map((node) => node.dataset.inspectionNode));
  expect(new Set(ids).size).toBe(3);
  await openRecord(page, fixture("workflow-definition-only"));
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  const group = await page.evaluate(() => window.playground.explanation.groups[0]);
  expect(group.basis).toBe("declared");
  await chooseGroup(page, group.id);
  await expect(page.locator("#hierarchy-context")).toContainText("仅声明");
  await expect(page.locator("#hierarchy-ungrouped")).toBeHidden();
  expect(await page.evaluate(() => window.playground.executionDAG)).toBeUndefined();
});
