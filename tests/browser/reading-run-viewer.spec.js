import { expect, test } from "@playwright/test";
import { openPasteEditor } from "../helpers/run-viewer-ui.js";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { explainEino } from "../../src/explanation.js";
import { agentReader, agentDetail, agentBoundary, openAgentReaderScope } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const portableURL = new URL(".artifacts/portable/eino-viewer.html", root).href;
const fixture = (id) => JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${id}.json`, root), "utf8"));
const scenarios = ["agent-direct-answer", "graph-io-structured", "workflow-io-success"];
const errors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") messages.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openEmbedded(page, record) {
  await page.route("**/__reading-run-viewer-test__", (route) => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved result reader</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:12px"><main id="viewer"></main></body></html>' }));
  await page.goto("/__reading-run-viewer-test__");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (input) => {
    const { createEinoRunViewer } = await import("/src/run-viewer.js");
    window.viewer = createEinoRunViewer(document.querySelector("#viewer"), input, { locale: "zh" });
  }, record);
}

async function importPortable(page, record, text = JSON.stringify(record)) {
  await page.locator("#record-file").setInputFiles({ name: "saved-result.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  await expect(page.locator("#import-editor")).not.toHaveAttribute("open");
  await expect(page.locator("#import-editor-label")).toHaveText("更换记录");
}

async function expectResultInFirstScreen(page, viewport) {
  if (await agentReader(page).count()) {
    const reader = agentReader(page);
    const input = await agentBoundary(reader, "input").boundingBox();
    const output = await agentBoundary(reader, "output").boundingBox();
    const first = await reader.locator("[data-trajectory-record]").first().boundingBox();
    expect(first.y).toBeLessThan(viewport.height * 0.7);
    expect(input.y).toBeLessThan(output.y);
    await expect(reader.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
    await expect(reader.locator('[data-run-result="success"]')).toBeHidden();
    await expect(reader.locator('[data-run-capture="complete"]')).toBeHidden();
    await expect(reader.locator("[data-group-directory], [data-run-identity], [data-close-step]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    return;
  }
  // Visibility alone is insufficient: values can be visible far below the fold.
  const title = await page.locator("[data-run-title]").boundingBox();
  const output = page.locator('[data-run-summary] [data-run-channel="output"]');
  const input = page.locator('[data-run-summary] [data-run-channel="input"]');
  const value = await output.locator("[data-run-value]").first().boundingBox();
  const outputBox = await output.boundingBox();
  const inputBox = await input.boundingBox();
  expect(title.y + title.height).toBeLessThan(viewport.height * 0.4);
  expect(value.y).toBeGreaterThan(title.y + title.height);
  expect(value.y + Math.min(value.height, 60)).toBeLessThan(viewport.height * 0.85);
  const order = await page.locator("[data-run-summary] > .erv-channels > [data-run-channel]").evaluateAll((items) => items.map((item) => item.dataset.runChannel));
  expect(order).toEqual(["output", "input"]);
  if (viewport.width < 650) expect(inputBox.y).toBeGreaterThanOrEqual(outputBox.y + outputBox.height);
  for (const selector of ["[data-run-result]", "header [data-run-timing]"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.y + box.height).toBeLessThan(value.y);
  }
  await expect(page.locator("[data-run-identity]")).not.toHaveAttribute("open");
  await expect(page.locator('[data-run-capture="complete"]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function screenshot(page, testInfo, name) {
  if (testInfo.project.name !== "chromium") return;
  const directory = fileURLToPath(new URL(".artifacts/iteration-5/", root));
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: `${directory}${name}.png`, fullPage: true });
}

for (const [label, viewport] of [["desktop", { width: 1280, height: 720 }], ["narrow", { width: 390, height: 844 }]]) {
  test(`embedded ${label} opens Agent on its trajectory and Graph/Workflow on their final results`, { tag: "@P1" }, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openEmbedded(page, fixture(scenarios[0]));
    for (const id of scenarios) {
      const record = fixture(id);
      await page.evaluate((input) => window.viewer.update(input), record);
      await expectResultInFirstScreen(page, viewport);
      expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(record.evidence);
      if (!id.startsWith("agent-")) await expect(page.locator("[data-group-directory] > summary")).toBeVisible();
    }
    await screenshot(page, testInfo, `embedded-reading-${label}`);
  });

  test(`portable ${label} folds successful imports and reveals the appropriate reading surface`, { tag: "@P1" }, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests = [];
    page.on("request", (request) => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    await page.goto(portableURL);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#record-file")).toBeVisible();
    await expect(page.locator("#import-status")).toContainText("拖放 JSON 文件");
    for (const id of scenarios) {
      await importPortable(page, fixture(id));
      await expectResultInFirstScreen(page, viewport);
      const editor = await page.locator("#drop-record").boundingBox();
      expect(editor.height).toBeLessThan(100);
      await expect(page.locator("#download-record")).toBeEnabled();
    }
    expect(requests).toEqual([]);
    await screenshot(page, testInfo, `portable-reading-${label}`);
  });
}

test("embedded long identity and folding details never change exact saved results or selection", { tag: "@P1" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const record = fixture("agent-nested-parallel-scopes");
  // Synthetic identity-length stress applied to a real source record; not a new Recorder scenario.
  record.runId = `saved-run-${"long-identity-".repeat(40)}`;
  for (const envelope of record.evidence) if (envelope.correlation?.runId) envelope.correlation.runId = record.runId;
  await openEmbedded(page, record);
  const reader = agentReader(page);
  await expectResultInFirstScreen(page, { width: 390, height: 844 });
  expect(await page.evaluate(() => window.viewer.document.execution.runId)).toBe(record.runId);
  const selected = await page.evaluate(() => {
    const node = window.viewer.explanation.nodes.find((entry) => entry.technical.metadata.agentScopeUnresolved);
    window.viewer.selectStep(node.id);
    window.viewer.selectEvidence(node.evidence[0].envelopeIndex);
    return { id: node.id, index: node.evidence[0].envelopeIndex };
  });
  await expect(page.locator("[data-step-detail] .execution-status")).toHaveText("已记录 · 调用归属未确认");
  await expect(page.locator(`[data-trajectory-step=${JSON.stringify(selected.id)}]`)).toContainText("归属未确认");
  await page.locator("[data-raw-envelope]").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-step-detail]")).toBeHidden();
  expect(await page.evaluate(() => ({ id: window.viewer.selectedStepId, index: window.viewer.selectedEnvelopeIndex }))).toEqual(selected);
  await page.locator(`[data-trajectory-step=${JSON.stringify(selected.id)}]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", selected.id);
  expect(JSON.parse(await page.locator("[data-raw-envelope]").textContent())).toEqual(record.evidence[selected.index]);
  expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(record.evidence);
  await page.evaluate((input) => window.viewer.update(input), fixture("workflow-definition-only"));
  await expect(page.locator("header [data-run-timing]")).toHaveText("耗时未记录");
  await expect(page.locator("header [data-run-timing]")).not.toContainText("0 ms");
});

test("portable failure is visible immediately and an invalid replacement preserves scope, detail and exact export", { tag: "@P0" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = [];
  page.on("request", (request) => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
  await page.goto(portableURL);
  await page.waitForLoadState("networkidle");
  await importPortable(page, fixture("agent-nested-failure-propagated"));
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "failed");
  const reader = agentReader(page);
  const issues = await page.locator("[data-run-result]").boundingBox();
  const input = await page.locator('[data-run-summary] [data-run-channel="input"]').boundingBox();
  expect(issues.y).toBeLessThan(844 * 0.55);
  expect(issues.y + Math.min(issues.height, 80)).toBeLessThan(844);
  expect(issues.y).toBeLessThan(input.y);
  const record = fixture("agent-nested-failure-recovered");
  const source = ` \n${JSON.stringify(record, null, 3)}\n`;
  await importPortable(page, record, source);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  await expect(page.locator("[data-run-issues]")).toContainText("局部失败，整体成功");
  const group = explainEino(record.evidence).explanation.groups.find(({ parentId }) => parentId);
  await openAgentReaderScope(reader, group.id);
  await page.locator("[data-trajectory-record]").last().click();
  const before = {
    group: await page.locator("[data-reading-scope]").getAttribute("data-group-id"),
    step: await page.locator("[data-step-detail]").getAttribute("data-step-id"),
    detail: await agentDetail(reader).innerHTML(),
    result: await agentBoundary(reader, "output", { local: true }).textContent(),
  };
  await page.locator("#import-editor-label").focus();
  await page.keyboard.press("Enter");
  await openPasteEditor(page);
  await page.locator("#record-json").fill('{"invalid":');
  await page.locator("#apply-record").click();
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("#import-status")).toBeVisible();
  await expect(page.locator("#import-editor")).toHaveAttribute("open");
  expect({
    group: await page.locator("[data-reading-scope]").getAttribute("data-group-id"),
    step: await page.locator("[data-step-detail]").getAttribute("data-step-id"),
    detail: await agentDetail(reader).innerHTML(),
    result: await agentBoundary(reader, "output", { local: true }).textContent(),
  }).toEqual(before);
  const pendingDownload = page.waitForEvent("download");
  await page.locator("#download-record").click();
  expect(readFileSync(await (await pendingDownload).path(), "utf8")).toBe(source);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
