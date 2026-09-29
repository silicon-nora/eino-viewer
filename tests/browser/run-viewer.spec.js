import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { syntheticAgentRecord, syntheticGraphRecord } from "../helpers/synthetic-record.js";
import { clickSource, openPasteEditor, ensureDiagramVisible } from "../helpers/run-viewer-ui.js";
import { agentReader, agentValue, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

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
  await page.route("**/__run-viewer-test__", (route) => route.fulfill({
    contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><title>Run viewer consumer</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main><div id="first"></div><div id="second"></div></main></body></html>`,
  }));
  await page.goto("/__run-viewer-test__");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async ({ record, options }) => {
    const { createEinoRunViewer } = await import("/src/run-viewer.js");
    window.createEinoRunViewer = createEinoRunViewer;
    window.clicks = [];
    window.viewer = createEinoRunViewer(document.querySelector("#first"), record, { ...options, onNodeClick: (event) => window.clicks.push(event.id) });
  }, { record, options });
}

async function openPortableRecord(page, record, name = "run-record.json", text = JSON.stringify(record)) {
  await page.locator("#record-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  await expect(page.locator("[data-eino-run-viewer]")).toBeVisible();
}

test("embedded presents prose and quiet metadata while retaining source access and collection gaps", { tag: "@P1" }, async ({ page }) => {
  const record = fixture("agent-direct-answer");
  await openSDK(page, record, { locale: "zh" });
  const output = page.locator('#first [data-run-summary] [data-run-channel="output"]');
  const value = output.locator("[data-run-value]");
  await expect(value).toHaveAttribute("data-value-type", "string");
  expect(await value.evaluate((node) => node.tagName)).toBe("DIV");
  await expect(output.locator(".erv-value-label")).toHaveCount(0);
  await expect(output).not.toContainText("已记录最终根输出");
  await expect(output.locator("[data-evidence-sources]")).toHaveCount(0);
  await expect(page.locator('#first [data-run-capture="complete"]')).toBeHidden();
  const index = await page.evaluate(() => window.viewer.explanation.run.output.items[0].evidenceEnvelopeIndexes[0]);
  await expectAgentAPIEvidence(page, agentReader(page), index, record.evidence[index]);
  await page.evaluate(() => window.viewer.selectGroup(window.viewer.explanation.groups[0].id));
  await expect(page.locator("#first [data-scope-result]")).toBeHidden();
  await expect(page.locator('#first [data-run-summary] [data-run-channel="output"] [data-run-value]')).toBeVisible();
  await page.evaluate((input) => window.viewer.update(input), fixture("graph-io-oversized"));
  await expect(page.locator('#first [data-run-capture="partial"]')).toBeVisible();
  await expect(output).toContainText("未记录 · 超出大小限制");
  await expect(output.locator("[data-run-value]")).toHaveCount(0);
});

test("embedded keeps recorded execution errors separate from normal output without repeating them", { tag: "@P0" }, async ({ page }) => {
  await openSDK(page, fixture("workflow-io-failed"), { locale: "zh" });
  for (const id of ["workflow-io-failed", "agent-nested-failure-recovered"]) {
    const record = fixture(id);
    await page.evaluate((input) => window.viewer.update(input), record);
    const source = await page.evaluate(() => {
      const node = window.viewer.explanation.nodes.find((entry) => entry.status === "failed");
      const issue = window.viewer.explanation.run.issues.find((entry) => entry.nodeId === node.id);
      window.viewer.selectStep(node.id);
      return { item: node.output.items[0], message: issue.message };
    });
    const detail = page.locator("#first [data-step-detail]");
    await expect(detail.locator(`${id.startsWith("agent-") ? '[data-business-channel="output"]' : '[data-run-channel="output"]'} [data-run-value]`)).toHaveCount(0);
    const errors = detail.locator("[data-step-errors]");
    await expect(errors.locator(id.startsWith("agent-") ? ":scope > small" : "h3")).toHaveText(id.startsWith("agent-") ? "错误" : "执行错误");
    const exact = typeof source.item.value === "string" ? source.item.value : JSON.stringify(source.item.value, null, 2);
    await expect(errors.locator("[data-run-value]")).toHaveText(exact);
    expect((await detail.textContent()).split(source.message).length - 1).toBe(1);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedValue = text; } } }));
    await errors.locator("[data-copy-value]").click();
    expect(await page.evaluate(() => window.copiedValue)).toBe(exact);
    const index = source.item.evidenceEnvelopeIndexes[0];
    if (id.startsWith("agent-")) await expectAgentAPIEvidence(page, agentReader(page), index, record.evidence[index]);
    else await clickSource(errors.locator(`[data-envelope-index="${index}"]`));
    expect(JSON.parse(await page.locator("#first [data-raw-envelope]").textContent())).toEqual(record.evidence[index]);
  }
  await page.evaluate((input) => window.viewer.update(input), fixture("agent-deep-nested-failure-recovered"));
  await page.evaluate(() => {
    const caller = window.viewer.explanation.nodes.find((node) => node.status === "success" && window.viewer.explanation.run.issues.some((issue) => issue.nodeId === node.id && issue.recovered));
    window.viewer.selectStep(caller.id);
  });
  await expect(page.locator('#first [data-step-errors] .step-state')).toHaveText("已恢复的步骤错误");
  await expect(page.locator('#first [data-step-detail] [data-business-channel="output"]')).toContainText("handled leaf failure:");
});

test("embedded preserves Tool message scalar strings and real component null types", { tag: "@P0" }, async ({ page }) => {
  await openSDK(page, fixture("agent-tool-recovered"));
  for (const value of ["null", "0", "false"]) {
    // Synthetic scalar content applied to a real Recorder Tool message.
    const record = fixture("agent-tool-recovered");
    const index = record.evidence.findIndex((envelope) => envelope.kind === "agent.event" && envelope.payload.output?.message?.value?.role === "tool");
    record.evidence[index].payload.output.message.value.content = value;
    await page.evaluate(({ input, index }) => {
      window.viewer.update(input);
      window.viewer.selectStep(window.viewer.explanation.nodes.find((node) => node.output.items.some((item) => item.evidenceEnvelopeIndexes.includes(index))).id);
    }, { input: record, index });
    const output = page.locator('#first [data-step-detail] [data-business-channel="output"]');
    await expect(output.locator("[data-run-value]")).toHaveAttribute("data-value-type", "string");
    await expect(output.locator("[data-run-value]")).toHaveAttribute("data-availability", "available");
    await expect(output.locator("[data-run-value]")).toHaveText(value);
    await expect(output).toContainText("Text");
    await expect(output.locator("[data-copy-value]")).toHaveCount(0);
    await expectAgentAPIEvidence(page, agentReader(page), index, record.evidence[index]);
  }
  await page.evaluate((input) => {
    window.viewer.update(input);
    window.viewer.selectStep(window.viewer.explanation.nodes.at(-1).id);
  }, fixture("graph-io-null"));
  await expect(page.locator('#first [data-step-detail] [data-run-channel="output"] [data-run-value]')).toHaveAttribute("data-value-type", "null");
});

test("embedded result, selected step, timing and Raw point to the same structured source", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("graph-io-structured");
  await openSDK(page, record, { locale: "zh" });
  const viewer = page.locator("#first [data-eino-run-viewer]");
  await expect(viewer.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  await expect(viewer.locator("[data-run-capture]")).toHaveAttribute("data-run-capture", "complete");
  await expect(viewer.locator("header [data-run-timing]")).toContainText("0 ms");
  await viewer.locator("header [data-timing-boundaries] > summary").click();
  await expect(viewer.locator('header [data-timing-boundary="startedAtMs"]')).toContainText(new Date(1790000000000).toISOString());
  const rootOutput = record.evidence.find((envelope) => envelope.kind === "component.io" && envelope.metadata?.io?.scope === "root" && envelope.payload.direction === "output");
  expect(JSON.parse(await viewer.locator('[data-run-summary] [data-run-channel="output"] [data-run-value]').textContent())).toEqual(rootOutput.payload.body);
  await viewer.locator("[data-step-id]").filter({ hasText: "Lambda" }).first().click();
  const detail = viewer.locator("[data-step-detail]");
  await expect(detail.locator("h2")).toHaveText("Lambda");
  expect(JSON.parse(await detail.locator('[data-run-channel="output"] [data-run-value]').textContent())).toEqual(rootOutput.payload.body);
  const source = detail.locator("[data-envelope-index]").last();
  const index = Number(await source.getAttribute("data-envelope-index"));
  await clickSource(source);
  expect(JSON.parse(await viewer.locator("[data-raw-envelope]").textContent())).toEqual(record.evidence[index]);
  expect(await page.evaluate(() => window.clicks.length)).toBe(1);
  if (testInfo.project.name === "chromium") {
    const directory = fileURLToPath(new URL(".artifacts/static-delivery/", root));
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: `${directory}embedded-result.png`, fullPage: true });
  }
});

test("embedded instances isolate selection and invalid updates, and destroy mounted graphs repeatedly", { tag: "@P0" }, async ({ page }) => {
  const initial = fixture("graph-io-structured");
  await openSDK(page, initial);
  await page.evaluate((record) => {
    window.second = window.createEinoRunViewer(document.querySelector("#second"), record, { locale: "zh" });
    window.viewer.selectStep(window.viewer.explanation.nodes[1].id);
    window.viewer.selectEvidence(3);
  }, fixture("agent-tool-interrupted"));
  const first = page.locator("#first");
  await ensureDiagramVisible(first);
  await expect(first.locator("canvas").first()).toBeVisible();
  const before = await page.evaluate(() => ({ step: window.viewer.selectedStepId, evidence: window.viewer.selectedEnvelopeIndex, html: document.querySelector("#first").innerHTML }));
  const failed = await page.evaluate(() => { try { window.viewer.update({ schemaVersion: 99 }); } catch (error) { return { name: error.name, code: error.code }; } });
  expect(failed.code).toBeTruthy();
  expect(await page.evaluate(() => ({ step: window.viewer.selectedStepId, evidence: window.viewer.selectedEnvelopeIndex, html: document.querySelector("#first").innerHTML }))).toEqual(before);
  await expect(page.locator("#second [data-run-result]")).toHaveAttribute("data-run-result", "interrupted");
  for (const id of ["workflow-io-success", "agent-direct-answer", "graph-io-null"]) {
    await page.evaluate((record) => window.viewer.update(record), fixture(id));
    if (id.startsWith("agent-")) await expect(first.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
    else await expect(first.locator("[data-step-detail]")).not.toHaveAttribute("data-step-id");
    await ensureDiagramVisible(first);
    if (id.startsWith("agent-")) {
      await expect(first.locator("[data-agent-trajectory]")).toBeVisible();
      await expect(first.locator("[data-trajectory-record]")).toHaveCount(2);
      await expect(first.locator("canvas")).toHaveCount(0);
    } else await expect(first.locator("canvas").first()).toBeVisible();
  }
  await page.evaluate(() => { window.viewer.destroy(); window.viewer.destroy(); });
  await expect(first.locator("[data-eino-run-viewer]")).toHaveCount(0);
  await expect(page.locator("#second [data-eino-run-viewer]")).toBeVisible();
  expect(await page.evaluate(() => { try { window.viewer.update({}); } catch (error) { return error.code; } })).toBe("viewer.destroyed");
  await page.evaluate(() => window.second.destroy());
});

test("embedded empty, null and definition-only records do not invent missing values or execution", { tag: "@P0" }, async ({ page }) => {
  await openSDK(page, fixture("graph-io-empty"));
  const output = page.locator('#first [data-run-summary] [data-run-channel="output"]');
  await expect(output.locator("[data-run-value]")).toHaveAttribute("data-availability", "empty");
  await expect(output.locator("[data-run-value]")).toHaveText('""');
  await page.locator("#first [data-step-list] button").last().click();
  await expect(page.locator('#first [data-step-detail] [data-run-channel="output"] [data-run-value]')).toHaveText('""');
  await page.evaluate((record) => window.viewer.update(record), fixture("graph-io-null"));
  await expect(output.locator("[data-run-value]")).toHaveAttribute("data-availability", "null");
  await expect(output.locator("[data-run-value]")).toHaveText("null");
  await page.locator("#first [data-step-list] button").last().click();
  await expect(page.locator('#first [data-step-detail] [data-run-channel="output"] [data-run-value]')).toHaveText("null");
  await page.evaluate((record) => window.viewer.update(record), fixture("workflow-definition-only"));
  await expect(page.locator("#first [data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  await expect(page.locator("#first header [data-run-timing]")).not.toContainText("0 ms");
  await page.locator("#first [data-step-list] button").first().click();
  await expect(page.locator("#first [data-step-detail] .erv-badge")).toHaveText("Declared");
});

test("definition-only Graph canvas selects the exact source node without claiming execution", { tag: "@P0" }, async ({ page }) => {
  // Derived structural view of a real fixture, not another recorded execution.
  const definition = fixture("graph-step-limit").evidence.filter((envelope) => envelope.kind === "compose.graph");
  await openSDK(page, definition);
  await ensureDiagramVisible(page.locator("#first"));
  await page.locator('#first [data-run-graph] [data-node-id="retry"]').click();
  await expect(page.locator("#first [data-step-detail] h2")).toHaveText("Retry forever");
  await expect(page.locator("#first [data-step-detail] .erv-badge")).toHaveText("Declared");
  expect(await page.evaluate(() => window.viewer.selectedStepId)).toBe("graph:1:retry");
  await expect(page.locator("#first [data-step-detail] [data-run-timing]")).not.toContainText("0 ms");
  await clickSource(page.locator("#first [data-step-detail] [data-envelope-index]"));
  expect(JSON.parse(await page.locator("#first [data-raw-envelope]").textContent())).toEqual(definition[0]);
});

test("omitted and redacted step values preserve the same completeness facts as root results", { tag: "@P0" }, async ({ page }) => {
  const omitted = fixture("graph-io-oversized");
  await openSDK(page, omitted);
  await expect(page.locator("#first [data-run-result]")).toHaveAttribute("data-run-result", "success");
  await expect(page.locator("#first [data-run-capture]")).toHaveAttribute("data-run-capture", "partial");
  const rootOutput = page.locator('#first [data-run-summary] [data-run-channel="output"]');
  await expect(rootOutput).toHaveAttribute("data-availability", "not-observed");
  await expect(rootOutput).toContainText("Size limit exceeded");
  await expect(rootOutput.locator("[data-capture-reason]")).toHaveAttribute("data-capture-reason", "size_limit");
  await page.locator("#first [data-step-list] button").last().click();
  const stepOutput = page.locator('#first [data-step-detail] [data-run-channel="output"]');
  await expect(stepOutput).toHaveAttribute("data-availability", "not-observed");
  await expect(stepOutput).toContainText("Size limit exceeded");
  await expect(stepOutput.locator("[data-run-value]")).toHaveCount(0);
  const reference = stepOutput.locator("[data-envelope-index]");
  const index = Number(await reference.getAttribute("data-envelope-index"));
  await clickSource(reference);
  expect(JSON.parse(await page.locator("#first [data-raw-envelope]").textContent())).toEqual(omitted.evidence[index]);
  expect(Object.hasOwn(omitted.evidence[index].payload, "body")).toBe(false);
  await page.evaluate((record) => window.viewer.update(record), fixture("graph-io-redacted"));
  await page.locator("#first [data-step-list] button").last().click();
  const redacted = page.locator('#first [data-step-detail] [data-run-channel="input"]');
  await expect(redacted.locator('.erv-value[data-availability="redacted"] .erv-badge')).toHaveText("Redacted");
  await expect(page.locator("#first")).not.toContainText("NEVER_EXPORT_PRIVATE_TOKEN");
});

test("embedded metadata search pages results, reaches unassigned evidence, and copies the full long value", { tag: "@P1" }, async ({ page }) => {
  const record = fixture("graph-io-long");
  await openSDK(page, record, { pageSize: 1 });
  await expect(page.locator("#first [data-step-list] button")).toHaveCount(1);
  await page.locator("#first .erv-steps").getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("#first [data-step-list] button")).toContainText("Lambda");
  await page.locator("#first [data-step-search]").fill("not-a-real-step");
  await expect(page.locator("#first [data-step-list]")).toContainText("No matching records");
  await page.locator("#first [data-step-search]").fill("Lambda");
  await expect(page.locator("#first [data-step-list] button")).toHaveCount(1);
  const output = page.locator('#first [data-run-summary] [data-run-channel="output"]');
  await output.locator("[data-run-expand] > summary").click();
  const expected = record.evidence.find((envelope) => envelope.kind === "component.io" && envelope.metadata?.io?.scope === "root" && envelope.payload.direction === "output").payload.body;
  await expect(output.locator("[data-run-value]")).toHaveText(expected);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedValue = text; } } }));
  await output.locator("[data-copy-value]").click();
  expect(await page.evaluate(() => window.copiedValue)).toBe(expected);
  await page.locator("#first [data-evidence-panel] > summary").click();
  await page.locator("#first [data-evidence-scope]").selectOption("unassigned");
  await page.locator("#first [data-evidence-search]").fill("compose.graph");
  await page.locator("#first [data-evidence-list] button").click();
  expect(JSON.parse(await page.locator("#first [data-raw-envelope]").textContent())).toEqual(record.evidence[0]);
});

test("portable file opens all sources offline and exports the exact imported JSON", { tag: "@P1" }, async ({ page }, testInfo) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(portableURL);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#import-status")).toContainText("拖放 JSON 文件");
  for (const [id, kind] of [["agent-direct-answer", "agent"], ["graph-io-structured", "graph"], ["workflow-io-success", "workflow"]]) {
    await openPortableRecord(page, fixture(id), `${id}.json`);
    await expect(page.locator("[data-eino-run-viewer]")).toHaveAttribute("data-eino-run-viewer", kind);
    await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
    await ensureDiagramVisible(page.locator("#viewer"));
    if (kind === "agent") {
      await expect(page.locator("[data-agent-trajectory]")).toBeVisible();
      await expect(page.locator("[data-trajectory-record]")).not.toHaveCount(0);
      await expect(page.locator("[data-run-graph] canvas")).toHaveCount(0);
    } else await expect(page.locator("[data-run-graph] canvas").first()).toBeVisible();
  }
  const record = fixture("graph-io-structured");
  const originalText = ` \n${JSON.stringify(record, null, 3)}\n`;
  await openPortableRecord(page, record, "my-result.json", originalText);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-record").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("my-result.json");
  expect(readFileSync(await download.path(), "utf8")).toBe(originalText);
  expect(requests.filter((url) => /^https?:/i.test(url))).toEqual([]);
  if (testInfo.project.name === "chromium") {
    const directory = fileURLToPath(new URL(".artifacts/static-delivery/", root));
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: `${directory}portable-result.png`, fullPage: true });
  }
});

test("portable paste rejects bad drafts atomically and renders hostile text without execution", { tag: "@P0" }, async ({ page }) => {
  await page.goto(portableURL);
  await expect(page.locator("#record-json")).toBeHidden();
  await expect(page.locator("[data-i18n=subtitle], .brand")).toHaveCount(0);
  await expect(page.locator("[data-i18n=privacy]")).toContainText("导出包含原始数据");
  // Synthetic text-safety check; values are copied into all matching real body envelopes.
  const record = fixture("graph-io-empty");
  const hostile = '</pre><img src="https://invalid.example/secret" onerror="window.recordExecuted=true"><script>window.recordExecuted=true</script>';
  for (const envelope of record.evidence) if (envelope.kind === "component.io" && envelope.payload.direction === "output") envelope.payload.body = hostile;
  await openPortableRecord(page, record, "hostile.json");
  await expect(page.locator('[data-run-summary] [data-run-channel="output"] [data-run-value]')).toHaveText(hostile);
  await expect(page.locator("#viewer img, #viewer script")).toHaveCount(0);
  expect(await page.evaluate(() => window.recordExecuted)).toBeUndefined();
  await page.locator("[data-step-list] button").last().click();
  const selectedId = await page.locator("[data-step-detail]").getAttribute("data-step-id");
  await openPasteEditor(page);
  await page.locator("#record-json").fill('{"broken":');
  await page.locator("#apply-record").click();
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("#import-error")).toBeVisible();
  await expect(page.locator("#import-error-text")).toBeHidden();
  await page.locator("#import-error > summary").click();
  await expect(page.locator("#import-error-text")).not.toBeEmpty();
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", selectedId);
  await expect(page.locator('[data-run-summary] [data-run-channel="output"] [data-run-value]')).toHaveText(hostile);
  for (const locale of ["en", "zh"]) {
    await page.locator("#locale").selectOption(locale);
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
    await expect(page.locator("#import-error")).toBeVisible();
    await expect(page.locator("#import-error")).toHaveAttribute("open");
    await expect(page.locator("#record-json")).toHaveValue('{"broken":');
    await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-step-id", selectedId);
    await expect(page.locator('[data-run-summary] [data-run-channel="output"] [data-run-value]')).toHaveText(hostile);
  }
  await page.locator("#record-json").fill(JSON.stringify(fixture("workflow-io-failed")));
  await page.locator("#apply-record").click();
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "failed");
  await expect(page.locator("[data-run-issues]")).not.toBeEmpty();
});

test("portable drop, language switching, narrow layout and keyboard selection remain local", { tag: "@P1" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(portableURL);
  await page.locator("#drop-record").evaluate((target, record) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(record)], "cancelled.json", { type: "application/json" }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, fixture("agent-cancelled"));
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "cancelled");
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("[data-run-result]")).toHaveText("Cancelled");
  const planned = page.locator('[data-trajectory-record][data-execution-state="planned"]');
  await planned.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-step-detail]")).toHaveAttribute("data-execution-state", "planned");
  await expect(page.locator("[data-step-detail] .execution-status")).toHaveText("Planned · execution not observed");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("embedded synthetic scale bounds Graph lists and preserves every Agent row without paging", { tag: "@P2" }, async ({ page }) => {
  test.setTimeout(90000);
  await openSDK(page, fixture("agent-direct-answer"));
  for (const evidenceCount of [100, 1000, 10000]) {
    const record = syntheticGraphRecord(evidenceCount);
    const result = await page.evaluate((input) => {
      window.viewer.update(input);
      window.viewer.selectEvidence(input.evidence.length - 1);
      return { domElements: document.querySelectorAll("#first *").length, nodeCount: window.viewer.explanation.nodes.length };
    }, record);
    expect(await page.locator("#first [data-step-list] button").count()).toBeLessThanOrEqual(30);
    // Selecting the final envelope now reveals its actual final page.
    expect(await page.locator("#first [data-evidence-list] button").count()).toBe(evidenceCount % 30 || 30);
    if (result.nodeCount > 500) {
      await expect(page.locator("#first [data-run-graph] canvas")).toHaveCount(0);
      await expect(page.locator("#first [data-draw-graph]")).toBeVisible();
    } else await expect(page.locator("#first [data-run-graph] canvas").first()).toBeVisible();
    await expect(page.locator("#first [data-original-record]")).toBeEmpty();
    expect(JSON.parse(await page.locator("#first [data-raw-envelope]").textContent())).toEqual(record.evidence.at(-1));
    expect(result.domElements).toBeLessThan(1200);
  }
  const agent = syntheticAgentRecord(fixture("agent-direct-answer"));
  await page.evaluate((input) => window.viewer.update(input), agent);
  const reader = agentReader(page);
  const users = agent.evidence.flatMap((envelope, index) => envelope.kind === "schema.message" && envelope.payload.role === "user"
    ? [{ id: `user:evidence:${index}`, value: envelope.payload.content }] : []);
  const expected = [...users.map(({ id }) => id), "assistant:turn:1:1"];
  expect(expected).toHaveLength(105);
  await expect(reader.locator("[data-trajectory-record]")).toHaveCount(105);
  expect(await reader.locator("[data-trajectory-record]").evaluateAll((rows) => rows.map(({ dataset }) => dataset.trajectoryRecord))).toEqual(expected);
  const renderedInputs = await reader.locator("[data-trajectory-record]").evaluateAll((rows) => rows.map((row) => row.textContent));
  users.forEach((user, index) => expect(renderedInputs[index]).toContain(user.value));
  await expect(reader.locator("[data-trajectory-pagination], [data-run-graph], [data-draw-graph]")).toHaveCount(0);
  const target = users.at(-1);
  const row = reader.locator(`[data-trajectory-record=${JSON.stringify(target.id)}]`);
  await row.focus();
  await row.press("Enter");
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(agentValue(reader, "input")).toHaveText(target.value);
  const clicks = await page.evaluate(() => window.clicks.length);
  await page.evaluate(async () => { const { setRunViewerLocale } = await import("/src/run-viewer-state.js"); setRunViewerLocale(window.viewer, "zh"); });
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(reader.locator("[data-trajectory-record]")).toHaveCount(105);
  await expect(agentValue(reader, "input")).toHaveText(target.value);
  expect(await page.evaluate(() => window.clicks.length)).toBe(clicks);
  expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(agent.evidence);
});
