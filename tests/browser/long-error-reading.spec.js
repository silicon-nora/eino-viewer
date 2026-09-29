import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { revealSource, openRunInformation, openScopeInformation, expectSelectedEvidence, openAgentScope, openWorkbenchRecord } from "../helpers/workbench-ui.js";
import { agentReader, agentDetail, openAgentReaderScope, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

function longErrorRecord() {
  const record = JSON.parse(readFileSync(new URL("fixtures/recorder-matrix/agent-nested-failure-propagated.json", root), "utf8"));
  // Synthetic UI-only stress: two emoji straddle the old UTF-16 preview cuts
  // at 320 and 360; the remaining 301 lines must never be discarded on copy.
  const message = `${"报".repeat(319)}😀${"报".repeat(38)}🧪\n${Array.from({ length: 301 }, (_, index) => `error detail line ${index + 1}: 保存原始错误`).join("\n")}\nerror-tail-needle`;
  const sourceIndex = record.evidence.findIndex(({ kind, payload }) => kind === "callback.event" && payload.phase === "error"
    && payload.run?.component === "Tool" && payload.address?.at(-1)?.id === "lookup_item");
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  record.evidence[sourceIndex].payload.error.message = message;
  return { record, message, sourceIndex };
}

async function openRecord(page, mode, record) {
  if (mode === "embedded") {
    await page.route("**/__long-error-reading__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Long saved error</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:0"><main id="consumer"></main></body></html>' }));
    await page.goto("/__long-error-reading__");
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/dist/run-viewer.js");
      window.longErrorViewer = createEinoRunViewer(document.querySelector("#consumer"), input, { locale: "zh" });
    }, record);
  } else {
    await page.goto(mode === "workbench" ? "/.artifacts/pages/?lang=zh" : new URL(".artifacts/portable/eino-viewer.html", root).href);
    if (mode === "workbench") await page.waitForFunction(() => window.playground?.ready);
    else await page.locator("#locale").selectOption("zh");
    if (mode === "workbench") {
      await openWorkbenchRecord(page, record);
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
    } else {
      await page.locator("#record-file").setInputFiles({ name: "synthetic-long-error.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    }
  }
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text) => { window.longErrorCopied = text; },
  } }));
}

async function expectFoldedError(page, mode, container, message) {
  const preview = container.locator(".run-result-preview");
  await expect(preview).toHaveCount(1);
  await expect(preview).toBeVisible();
  const previewText = await preview.textContent();
  expect(previewText).toContain("😀");
  expect(previewText).not.toContain("error-tail-needle");
  expect(previewText).not.toContain("\uFFFD");
  expect([...previewText].some((character) => character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff)).toBe(false);
  const folded = container.locator("[data-run-expand]");
  await expect(folded).not.toHaveAttribute("open");
  const full = container.locator("[data-run-value]");
  await expect(full).toBeHidden();
  // Copy is available without expanding; labels/recovery badges are not copied.
  await container.locator("[data-copy-value]").click();
  expect(await page.evaluate(() => window.longErrorCopied)).toBe(message);
  await folded.locator(":scope > summary").focus();
  await folded.locator(":scope > summary").press("Enter");
  await expect(full).toBeVisible();
  expect(await full.textContent()).toBe(message);
  await folded.locator(":scope > summary").click();
  await expect(full).toBeHidden();
}

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode} folds long run and scope errors without splitting emoji or losing source text`, { tag: "@P1" }, async ({ page }) => {
    const { record, message, sourceIndex } = longErrorRecord();
    expect(message.split("\n").length).toBeGreaterThan(300);
    const document = projectEinoViewerDocument(record).document;
    const explanation = explainExecutionDAG(document.execution, record.evidence).explanation;
    const failed = explanation.nodes.find(({ evidence }) => evidence.some(({ envelopeIndex }) => envelopeIndex === sourceIndex));
    expect(failed.status).toBe("failed");
    const group = explanation.groups.find(({ nodeIds, parentId }) => parentId && nodeIds.includes(failed.id));
    expect(group).toBeDefined();
    const groupPath = [];
    for (let current = group; current; current = explanation.groups.find(({ id }) => id === current.parentId)) groupPath.unshift(current);
    await openRecord(page, mode, record);
    if (mode === "workbench") await openRunInformation(page);
    const reader = agentReader(page);
    const runIssue = reader.locator("[data-run-summary] .run-result-issue").filter({ has: page.locator(".run-result-preview") });
    await expectFoldedError(page, mode, runIssue, message);
    await openAgentReaderScope(reader, group.id);
    const scopeIssue = reader.locator("[data-local-result] [data-scope-issue]").filter({ has: page.locator(".run-result-preview") });
    if (mode === "workbench") {
      await openScopeInformation(page);
      await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary]), #scope-information, #global-summary")).toHaveCount(0);
    }
    await expectFoldedError(page, mode, scopeIssue, message);
    await expect(reader.locator("[data-group-directory], [data-step-search]")).toHaveCount(0);
    await scopeIssue.locator(`[data-issue-step=${JSON.stringify(failed.id)}]`).click();
    const step = agentDetail(reader);
    await expect(step).toContainText("失败");
    if (mode === "workbench") {
      await expect(step.locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
      await expectSelectedEvidence(page, sourceIndex, record.evidence[sourceIndex]);
      expect(await page.evaluate(() => window.playground.document)).toEqual(record);
    } else if (mode === "embedded") {
      await expectAgentAPIEvidence(page, reader, sourceIndex, record.evidence[sourceIndex], "longErrorViewer");
      expect(await page.evaluate(() => window.longErrorViewer.document.evidence)).toEqual(record.evidence);
    } else {
      await expect(step).toHaveAttribute("data-step-id", failed.id);
      expect(await step.locator("[data-evidence-indexes]").evaluateAll((boxes) => boxes.flatMap(({ dataset }) => JSON.parse(dataset.evidenceIndexes)))).toContain(sourceIndex);
      const download = page.waitForEvent("download");
      await page.locator("#download-record").click();
      expect(JSON.parse(readFileSync(await (await download).path(), "utf8"))).toEqual(record);
    }
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
  });
}
