import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { explainEino } from "../../src/explanation.js";
import { agentReader, agentDetail, agentValue, agentBoundary, selectAgentReaderStep, openAgentReaderScope, showAgentGlobalResult, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const portableURL = new URL(".artifacts/portable/eino-viewer.html", root).href;
const fixture = (id) => JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${id}.json`, root), "utf8"));
const errors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") messages.push(message.text()); });
  await page.setViewportSize({ width: 1360, height: 940 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openSDK(page, record, options = {}) {
  await page.route("**/__nested-run-viewer-test__", (route) => route.fulfill({
    contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><title>Nested saved run</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main id="viewer"></main></body></html>',
  }));
  await page.goto("/__nested-run-viewer-test__");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async ({ record, options }) => {
    const { createEinoRunViewer } = await import("/src/run-viewer.js");
    window.viewer = createEinoRunViewer(document.querySelector("#viewer"), record, options);
  }, { record, options });
}

async function importPortable(page, record) {
  await page.locator("#record-file").setInputFiles({ name: "nested-run.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
}

async function expandDirectory(page) {
  const directory = page.locator("[data-group-directory]");
  if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
  await expect(directory.locator("[data-group-select]").first()).toBeVisible();
  // Hierarchy branches are mounted lazily; fixtures here have one parent level.
  const branches = directory.locator("[data-group-children]");
  const count = await branches.count();
  for (let index = 0; index < count; index += 1) {
    const branch = branches.nth(index);
    if (await branch.getAttribute("open") === null) await branch.locator(":scope > summary").click();
    await expect(branch.locator("[data-group-select]").first()).toBeVisible();
  }
}

function sourceIndex(record, value) {
  return record.evidence.findIndex((envelope) => envelope.kind === "component.io" && envelope.payload.direction === "output"
    && (envelope.payload.body?.response === value || envelope.payload.body?.message?.content === value));
}

test("embedded child scopes retain distinct local outputs, exact evidence and the parent final result", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-nested-parallel-scopes");
  await openSDK(page, record);
  const originalCount = await page.evaluate(() => window.viewer.explanation.nodes.length);
  const reader = agentReader(page);
  const rootOutput = agentBoundary(reader, "output");
  await expect(rootOutput).toContainText("parent final: combined slow and fast");
  const groups = await page.evaluate(() => window.viewer.explanation.groups.filter((group) => group.parentId));
  expect(groups).toHaveLength(2);
  let screenshotTarget;
  for (const key of ["slow", "fast"]) {
    const index = sourceIndex(record, `lookup:${key}`);
    expect(index).toBeGreaterThan(-1);
    const target = await page.evaluate((envelopeIndex) => {
      const node = window.viewer.explanation.nodes.find((entry) => entry.output.items.some((item) => item.evidenceEnvelopeIndexes.includes(envelopeIndex)));
      return { nodeId: node.id, groupId: window.viewer.explanation.groups.find((group) => group.nodeIds.includes(node.id)).id };
    }, index);
    screenshotTarget = { ...target, envelopeIndex: index };
    await openAgentReaderScope(reader, target.groupId);
    await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", target.groupId);
    if (key === "fast") await expect(page.locator("[data-raw-envelope]")).toBeHidden();
    const expectedMembers = groups.find((group) => group.id === target.groupId).nodeIds;
    expect(await reader.locator("[data-trajectory-step]").evaluateAll((buttons) => buttons.map((button) => button.dataset.trajectoryStep))).toEqual(expectedMembers);
    await selectAgentReaderStep(reader, target.nodeId);
    const detail = page.locator("[data-step-detail]");
    await expect(agentValue(reader, "output").first()).toContainText(`lookup:${key}`);
    await expect(agentValue(reader, "output").first()).not.toContainText(`lookup:${key === "slow" ? "fast" : "slow"}`);
    await expect(detail.locator(".agent-scope-path")).not.toBeEmpty();
    await expectAgentAPIEvidence(page, reader, index, record.evidence[index]);
    await showAgentGlobalResult(reader);
    await expect(rootOutput).toContainText("parent final: combined slow and fast");
  }
  expect(await page.evaluate(() => window.viewer.explanation.nodes.length)).toBe(originalCount);
  const topIndex = await page.evaluate(() => window.viewer.explanation.run.output.items[0].evidenceEnvelopeIndexes[0]);
  await expectAgentAPIEvidence(page, reader, topIndex, record.evidence[topIndex]);
  await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", "");
  const unknown = await page.evaluate(() => window.viewer.explanation.nodes.find((node) => node.technical.metadata.agentScopeUnresolved));
  await selectAgentReaderStep(reader, unknown.id);
  await expect(agentDetail(reader)).toContainText("Invocation unconfirmed");
  expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(record.evidence);
  if (testInfo.project.name === "chromium") {
    await openAgentReaderScope(reader, screenshotTarget.groupId);
    await selectAgentReaderStep(reader, screenshotTarget.nodeId);
    await expectAgentAPIEvidence(page, reader, screenshotTarget.envelopeIndex, record.evidence[screenshotTarget.envelopeIndex]);
    const path = fileURLToPath(new URL(".artifacts/iteration-4/", root));
    mkdirSync(path, { recursive: true });
    await page.screenshot({ path: `${path}embedded-nested.png`, fullPage: true });
  }
});

test("embedded local failure stays local after parent recovery and propagated failure stays failed", { tag: "@P0" }, async ({ page }) => {
  await openSDK(page, fixture("agent-nested-failure-recovered"));
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  const failed = await page.evaluate(() => window.viewer.explanation.nodes.find((node) => node.status === "failed")?.id);
  expect(failed).toBeTruthy();
  await page.evaluate((id) => window.viewer.selectStep(id), failed);
  await expect(page.locator("[data-step-detail] .execution-status")).toHaveText("Failed");
  await expect(page.locator("[data-run-issues]")).toContainText("Local failure · overall run succeeded");
  await expect(page.locator("[data-run-summary]")).toContainText("parent final:");
  await page.evaluate((record) => window.viewer.update(record), fixture("agent-nested-failure-propagated"));
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "failed");
  await expect(page.locator("[data-run-summary] [data-run-channel=output]")).not.toContainText("child result:");
});

test("embedded Workflow hierarchy stays declared and Graph visits remain independent", { tag: "@P0" }, async ({ page }) => {
  await openSDK(page, fixture("workflow-nested-names"));
  await expandDirectory(page);
  await expect(page.locator("[data-group-directory] > summary")).toContainText("Workflow hierarchy");
  const group = await page.evaluate(() => window.viewer.explanation.groups.find((entry) => entry.parentId));
  expect(group).toBeTruthy();
  await page.evaluate((id) => window.viewer.selectGroup(id), group.id);
  const nodeIds = await page.locator("[data-step-list] [data-step-id]").evaluateAll((entries) => entries.map((entry) => entry.dataset.stepId));
  expect(nodeIds).toEqual(group.nodeIds);
  expect(nodeIds).toHaveLength(1);
  expect(new Set(nodeIds).size).toBe(nodeIds.length);
  await page.evaluate((record) => window.viewer.update(record), fixture("workflow-definition-only"));
  await expandDirectory(page);
  await expect(page.locator("[data-group-list]")).toContainText("Declared");
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  await page.evaluate((record) => window.viewer.update(record), fixture("graph-step-limit"));
  const counts = await page.evaluate(() => ({ before: window.viewer.explanation.nodes.length, groups: window.viewer.explanation.groups }));
  expect(counts.before).toBeGreaterThan(1);
  for (const group of counts.groups) await page.evaluate((id) => window.viewer.selectGroup(id), group.id);
  await page.evaluate(() => window.viewer.selectGroup(null));
  expect(await page.locator("[data-step-list] [data-step-id]").count()).toBe(counts.before);
});

test("portable parallel scopes keep exact source bodies and distinguish recovered from propagated errors", { tag: "@P0" }, async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(portableURL);
  await page.waitForLoadState("networkidle");
  await page.locator("#locale").selectOption("en");
  const record = fixture("agent-nested-parallel-scopes");
  const explanation = explainEino(record.evidence).explanation;
  await importPortable(page, record);
  const reader = agentReader(page);
  for (const key of ["fast", "slow"]) {
    const index = sourceIndex(record, `lookup:${key}`);
    const node = explanation.nodes.find((entry) => entry.output.items.some((item) => item.evidenceEnvelopeIndexes.includes(index)));
    const group = explanation.groups.find((entry) => entry.nodeIds.includes(node.id));
    await openAgentReaderScope(reader, group.id);
    await selectAgentReaderStep(reader, node.id);
    const output = agentValue(reader, "output").first();
    await expect(output).toContainText(`lookup:${key}`);
    await expect(output).not.toContainText(`lookup:${key === "fast" ? "slow" : "fast"}`);
    const row = reader.locator(`[data-trajectory-step=${JSON.stringify(node.id)}]`);
    await expect(row).toHaveAttribute("aria-pressed", "true");
    expect(node.output.items.flatMap((item) => item.evidenceEnvelopeIndexes)).toContain(index);
    await showAgentGlobalResult(reader);
    await expect(page.locator('[data-run-summary] [data-run-channel="output"]')).toContainText("parent final: combined slow and fast");
  }
  for (const [id, state] of [["agent-nested-failure-recovered", "success"], ["agent-nested-failure-propagated", "failed"]]) {
    const next = fixture(id);
    const localFailure = explainEino(next.evidence).explanation.nodes.find((node) => node.status === "failed" && node.label.includes("lookup_item"));
    expect(localFailure).toBeTruthy();
    await importPortable(page, next);
    await selectAgentReaderStep(reader, localFailure.id);
    await expect(page.locator("[data-step-detail] .execution-status")).toHaveText("Failed");
    await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", state);
    if (state === "success") await expect(page.locator("[data-run-issues]")).toContainText("Local failure · overall run succeeded");
    const download = page.waitForEvent("download");
    await page.locator("#download-record").click();
    expect(JSON.parse(readFileSync(await (await download).path(), "utf8"))).toEqual(next);
  }
  expect(requests.filter((url) => /^https?:/i.test(url))).toEqual([]);
});
