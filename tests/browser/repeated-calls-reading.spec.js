import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { openStepSearch, revealSource, openWorkbenchRecord, expectSelectedEvidence } from "../helpers/workbench-ui.js";
import { ensureDiagramVisible } from "../helpers/run-viewer-ui.js";

const root = new URL("../../", import.meta.url);
const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1360, height: 940 });
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

async function openRecord(page, mode, text) {
  const record = JSON.parse(text);
  if (mode === "embedded") {
    await page.route("**/__repeated-calls-reading__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Repeated recorded calls</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:0"><main id="consumer"></main></body></html>' }));
    await page.goto("/__repeated-calls-reading__");
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/dist/run-viewer.js");
      window.repeatedCreateViewer = createEinoRunViewer;
      window.repeatedViewer = createEinoRunViewer(document.querySelector("#consumer"), input, { locale: "zh" });
    }, record);
  } else {
    await page.goto(mode === "workbench" ? "/.artifacts/pages/?lang=zh" : new URL(".artifacts/portable/eino-viewer.html", root).href);
    if (mode === "workbench") await page.waitForFunction(() => window.playground?.ready);
    else await page.locator("#locale").selectOption("zh");
    if (mode === "workbench") {
      await openWorkbenchRecord(page, text);
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
    } else {
      await page.locator("#record-file").setInputFiles({ name: "recorded-loop.json", mimeType: "application/json", buffer: Buffer.from(text) });
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    }
  }
  await page.waitForLoadState("networkidle");
  if (mode === "workbench") await openStepSearch(page);
}

const row = (page, mode, id) => page.locator(mode === "workbench" ? `button[data-inspection-node=${JSON.stringify(id)}]` : `button[data-step-id=${JSON.stringify(id)}]`);
const detail = (page, mode) => page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
const title = (page, mode) => detail(page, mode).locator(mode === "workbench" ? ".node-detail-hero h3" : ".erv-detail-header");
const search = (page, mode) => page.locator(mode === "workbench" ? "#inspection-search" : "[data-step-search]");

async function showRoundTwo(page, mode, second) {
  await search(page, mode).fill(second.node.id);
  await expect(row(page, mode, second.node.id)).toContainText(/第 2 次|Call 2/);
  await expect(row(page, mode, second.node.id)).not.toContainText(/第 1 次|Call 1/);
  await row(page, mode, second.node.id).click();
  const value = detail(page, mode).locator(mode === "workbench" ? '[data-business-channel="input"] .business-value-text' : '[data-run-channel="input"] [data-run-value]');
  await revealSource(value);
  expect(JSON.parse(await value.textContent())).toEqual(second.input.envelope.payload.body);
  expect(JSON.parse(await value.textContent()).round).toBe(2);
}

async function checkKeyboardLabel(page, mode, id, expected, logical) {
  if (mode === "workbench") {
    const node = page.locator('#dag [data-graph-node="evaluate"]');
    await expect(node).toHaveAttribute("aria-label", logical.countLabel);
    if (logical.failureLabel) await expect(node).toHaveAttribute("aria-label", logical.failureLabel);
    await node.focus();
    await node.press("Enter");
    await expect(node).toHaveAttribute("aria-pressed", "true");
    await expect(title(page, mode)).toContainText(expected);
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode.id)).toBe(id);
    await expect(page.locator("[data-graph-visit]")).toHaveValue(id);
    return;
  }
  await ensureDiagramVisible(page.locator("[data-eino-run-viewer]"));
  const host = page.locator("[data-run-graph]");
  await expect.poll(() => host.evaluate((element) => [element, ...element.querySelectorAll("*")].some((item) => item._cyreg?.cy))).toBe(true);
  await host.focus();
  await host.press("Home");
  // Embedded and portable still select individual calls on the native canvas.
  await host.press("Enter");
  let reached = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    reached = await host.evaluate((element, target) => {
      const cy = [element, ...element.querySelectorAll("*")].map((item) => item._cyreg?.cy).find(Boolean);
      const current = cy?.nodes(".keyboard-focus").first();
      return (current?.data("path")?.at(-1) || current?.id()) === target;
    }, id);
    if (reached) break;
    await host.press("ArrowRight");
  }
  expect(reached).toBe(true);
  await expect(host).toHaveAttribute("aria-label", expected);
  await host.press("Enter");
  await expect(title(page, mode)).toContainText(expected);
}

for (const mode of ["workbench", "embedded", "portable"]) {
  for (const outcome of ["success", "failed"]) {
    test(`${mode} ${outcome} keeps real repeated Graph call numbers stable through search, failure selection and language`, { tag: "@P0" }, async ({ page }) => {
      const text = readFileSync(new URL(`fixtures/recorder-matrix/graph-multistep-loop-${outcome}.json`, root), "utf8");
      const record = JSON.parse(text);
      // Source invocation IDs select nodes; numbering is asserted independently
      // from the real three/two evaluate callbacks, never copied from UI helpers.
      const projection = projectEinoViewerDocument(record).document;
      const starts = record.evidence.map((envelope, index) => ({ envelope, index })).filter(({ envelope }) =>
        envelope.kind === "callback.event" && envelope.payload.phase === "start" && envelope.payload.nodePath?.[0] === "evaluate");
      expect(starts).toHaveLength(outcome === "success" ? 3 : 2);
      const visits = starts.map(({ envelope, index }) => ({
        node: projection.execution.nodes.find((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index)),
        input: record.evidence.map((source, sourceIndex) => ({ envelope: source, index: sourceIndex })).find(({ envelope: source }) =>
          source.kind === "component.io" && source.payload.direction === "input" && source.correlation.invocationId === envelope.correlation.invocationId),
      }));
      expect(visits.every(({ node }) => node.label === "evaluate")).toBe(true);
      await openRecord(page, mode, text);
      for (const [index, visit] of visits.entries()) await expect(row(page, mode, visit.node.id)).toContainText(`第 ${index + 1} 次`);
      const second = visits[1];
      await showRoundTwo(page, mode, second);
      await expect(title(page, mode)).toContainText("第 2 次");
      if (mode === "workbench") {
        await expectSelectedEvidence(page, second.input.index, second.input.envelope);
        await expect(detail(page, mode).locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
      } else {
        const sourceButton = detail(page, mode).locator(`[data-envelope-index="${second.input.index}"]`).first();
        await revealSource(sourceButton);
        await sourceButton.click();
        expect(JSON.parse(await page.locator("[data-raw-envelope]").textContent())).toEqual(second.input.envelope);
      }
      if (outcome === "failed") {
        if (mode === "workbench") await search(page, mode).fill("evaluate 第 2 次 失败");
        else {
          await page.locator("[data-issues-only]").check();
          await search(page, mode).fill("");
        }
        await expect(row(page, mode, second.node.id)).toContainText("第 2 次");
        await expect(row(page, mode, second.node.id)).toContainText("失败");
        await expect(row(page, mode, visits[0].node.id)).toHaveCount(0);
      }
      await checkKeyboardLabel(page, mode, second.node.id, /第 2 次/, { id: visits[0].node.id,
        countLabel: new RegExp(`执行 ${visits.length} 次`), failureLabel: outcome === "failed" ? /1 次失败/ : undefined });
      if (mode === "workbench") await page.locator('[data-language="en"]').click();
      else if (mode === "portable") await page.locator("#locale").selectOption("en");
      else await page.evaluate((input) => {
        // Locale is a constructor option, not a mutation of the saved record.
        window.repeatedViewer.destroy();
        window.repeatedViewer = window.repeatedCreateViewer(document.querySelector("#consumer"), input, { locale: "en" });
      }, record);
      if (mode === "workbench") await openStepSearch(page);
      await showRoundTwo(page, mode, second);
      await expect(title(page, mode)).toContainText("Call 2");
      await expect(title(page, mode)).not.toContainText("第 2 次");
      await checkKeyboardLabel(page, mode, second.node.id, /Call 2/, { id: visits[0].node.id,
        countLabel: new RegExp(`${visits.length} calls`), failureLabel: outcome === "failed" ? /1 failed/ : undefined });
      if (mode === "workbench") {
        expect(await page.evaluate(() => window.playground.document)).toEqual(record);
        expect(await page.evaluate((id) => window.playground.executionDAG.nodes.find((node) => node.id === id).label, second.node.id)).toBe("evaluate");
      } else {
        const raw = page.locator("[data-original-record]");
        await revealSource(raw);
        await expect.poll(async () => JSON.parse(await raw.textContent() || "null")).toEqual(record);
      }
      if (mode === "portable") {
        const download = page.waitForEvent("download");
        await page.locator("#download-record").click();
        const chunks = [];
        for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(text);
      }
    });
  }
}
