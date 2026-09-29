import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { editCopy, openStepSearch, revealSource, openRecordActions, openWorkbenchRecord } from "../helpers/workbench-ui.js";
import { openPasteEditor } from "../helpers/run-viewer-ui.js";

const safeText = readFileSync(new URL("../../fixtures/input-boundaries/graph-safe-integers.json", import.meta.url), "utf8");
const unsafeText = readFileSync(new URL("../../fixtures/input-boundaries/graph-unsafe-integers.json", import.meta.url), "utf8");
const safeRecord = JSON.parse(safeText);
const rootBody = safeRecord.evidence[9].payload.body;
const portableURL = new URL("../../.artifacts/portable/eino-viewer.html", import.meta.url).href;
const base = { ...safeRecord };
delete base.metadata;
const deepText = JSON.stringify(base).slice(0, -1) + ',"metadata":' + '{"nested":'.repeat(8000) + 'null' + '}'.repeat(8000) + '}';
const roundedText = safeText.replace('"zero": 0', '"zero": 1.00000000000000001');
const errors = new WeakMap();

test.beforeEach(({ page }) => {
  const failures = [];
  errors.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function upload(page, text, name = "numeric-boundary.json") {
  await page.locator("#record-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
}

async function workbench(page) {
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await openWorkbenchRecord(page, safeText);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(safeRecord);
}

test("workbench accepts real safe integers without changing values, text types, copy or source", { tag: "@P0" }, async ({ page }) => {
  await workbench(page);
  const output = page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]');
  expect(JSON.parse(await output.locator("[data-run-value]").textContent())).toEqual(rootBody);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copied = text; } } }));
  await output.locator("[data-run-copy-index]").click();
  expect(JSON.parse(await page.evaluate(() => window.copied))).toEqual(rootBody);
  const reference = output.locator("[data-envelope-index]").first();
  await revealSource(reference);
  await reference.click();
  expect(await page.locator("#snapshot-json").inputValue()).toBe(safeText);
  expect(await page.evaluate(() => window.playground.document)).toEqual(safeRecord);
});

test("workbench rejects unsafe numbers and deep metadata while preserving result, selection and the rejected draft", { tag: "@P0" }, async ({ page }) => {
  await workbench(page);
  await openStepSearch(page);
  await page.locator("[data-inspection-node]").first().click();
  await openRecordActions(page);
  await page.locator("#open-raw").click();
  await editCopy(page);
  const editor = page.locator("#snapshot-json");
  const state = await page.evaluate(() => ({ document: window.playground.document, selection: window.playground.linkedSelection, result: document.querySelector(":is(#run-result-summary, .eino-agent-reader [data-run-summary])").innerHTML }));
  for (const [text, reason] of [[unsafeText, "整数超出精确范围"], [roundedText, "数字精度无法保留"], [deepText, "记录嵌套过深"]]) {
    await editor.fill(text);
    await page.locator("#apply-json").click();
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
    await expect(page.locator("#import-status")).toHaveText(`${reason}；当前结果已保留。`);
    await expect(editor).toHaveValue(text);
    expect(await page.evaluate(() => ({ document: window.playground.document, selection: window.playground.linkedSelection, result: document.querySelector(":is(#run-result-summary, .eino-agent-reader [data-run-summary])").innerHTML }))).toEqual(state);
  }
  // Formatting is another parse boundary: it must not round an unaccepted draft.
  await editor.fill(unsafeText);
  await page.locator("#format-json").click();
  await expect(editor).toHaveValue(unsafeText);
  await page.locator("#apply-json").click();
  await expect(editor).toHaveValue(unsafeText);
  expect(await page.evaluate(() => window.playground.document)).toEqual(safeRecord);
});

test("portable rejects numeric and depth hazards without replacing the accepted record or export", { tag: "@P0" }, async ({ page }) => {
  await page.goto(portableURL);
  await upload(page, safeText, "safe-original.json");
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  const output = page.locator('[data-run-summary] [data-run-channel="output"] [data-run-value]');
  expect(JSON.parse(await output.textContent())).toEqual(rootBody);
  const before = await page.locator("#viewer").innerHTML();
  for (const [text, reason] of [[unsafeText, "整数超出精确范围"], [roundedText, "数字精度无法保留"], [deepText, "记录嵌套过深"]]) {
    await upload(page, text);
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
    await expect(page.locator("#import-status")).toHaveText(`${reason}；当前结果已保留。`);
    expect(await page.locator("#viewer").innerHTML()).toBe(before);
    expect(await page.locator("#record-json").inputValue()).toBe(safeText);
  }
  await openPasteEditor(page);
  await page.locator("#record-json").fill(unsafeText);
  await page.locator("#apply-record").click();
  await expect(page.locator("#record-json")).toHaveValue(unsafeText);
  expect(await page.locator("#viewer").innerHTML()).toBe(before);
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-record").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("safe-original.json");
  expect(readFileSync(await download.path(), "utf8")).toBe(safeText);
});

test("embedded rejects unsafe objects without invoking getters or changing its accepted selection", { tag: "@P0" }, async ({ page }) => {
  await page.route("**/__input-boundary-sdk__", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main id="viewer"></main></body></html>' }));
  await page.goto("/__input-boundary-sdk__");
  const result = await page.evaluate(async ({ safe, unsafeText }) => {
    const { createEinoRunViewer } = await import("/dist/run-viewer.js");
    const host = document.querySelector("#viewer");
    const viewer = createEinoRunViewer(host, safe, { locale: "zh" });
    viewer.selectStep(viewer.explanation.nodes[0].id);
    viewer.selectEvidence(9);
    const state = () => ({ html: host.innerHTML, step: viewer.selectedStepId, evidence: viewer.selectedEnvelopeIndex, record: JSON.stringify(viewer.document.evidence) });
    const before = state();
    const deep = structuredClone(safe);
    deep.metadata = {};
    let tail = deep.metadata;
    for (let i = 0; i < 8000; i += 1) tail = tail.nested = {};
    let reads = 0;
    const getter = structuredClone(safe);
    getter.metadata = Object.defineProperty({}, "secret", { enumerable: true, get() { reads += 1; return "must not read"; } });
    const sparse = structuredClone(safe);
    sparse.metadata = { items: Array(2) };
    const failures = [];
    for (const candidate of [JSON.parse(unsafeText), deep, getter, sparse]) {
      let diagnostics;
      try { viewer.update(candidate); }
      catch (error) { diagnostics = error.diagnostics; }
      failures.push({ codes: diagnostics?.map(({ code }) => code), unchanged: JSON.stringify(state()) === JSON.stringify(before) });
    }
    const acceptedBody = viewer.explanation.run.output.items[0].value;
    viewer.destroy();
    return { failures, reads, acceptedBody };
  }, { safe: safeRecord, unsafeText });
  expect(result.reads).toBe(0);
  expect(result.acceptedBody).toEqual(rootBody);
  for (const [index, code] of ["unsafe_integer", "max_depth_exceeded", "non_json_property", "sparse_array"].entries()) {
    expect(result.failures[index].codes).toContain(code);
    expect(result.failures[index].unchanged).toBe(true);
  }
});
