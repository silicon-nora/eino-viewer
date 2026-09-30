import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectSelectedEvidence, openWorkbenchRecord, selectAgentStep } from "../helpers/workbench-ui.js";
import { ensureDiagramVisible } from "../helpers/run-viewer-ui.js";

const record = JSON.parse(readFileSync(new URL("../../fixtures/recorder-matrix/agent-nested-parallel-scopes.json", import.meta.url), "utf8"));
const definitionOnly = JSON.parse(readFileSync(new URL("../../fixtures/recorder-matrix/workflow-definition-only.json", import.meta.url), "utf8"));
const messages = {
  en: { state: "Invocation unconfirmed", statePattern: /invocation unconfirmed/i, scopeState: "Invocation unconfirmed" },
  zh: { state: "调用归属未确认", statePattern: /调用归属未确认/, scopeState: "归属未确认" },
};
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openWorkbench(page, locale) {
  await page.goto(`/.artifacts/pages/?lang=${locale}`);
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document.runId)).toBe(record.runId);
}

async function focusUnconfirmed(page, host) {
  await host.focus();
  await host.press("Home");
  for (let count = 0; count < 100; count += 1) {
    const found = await host.evaluate((element) => {
      const cy = [element, ...element.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
      return Boolean(cy?.nodes(".keyboard-focus").first().data("metadata")?.agentScopeUnresolved);
    });
    if (found) return;
    await host.press("ArrowRight");
  }
  throw new Error("Keyboard navigation did not reach the recorded unconfirmed event");
}

for (const locale of ["en", "zh"]) {
  test(`workbench ${locale} uses the same truthful unconfirmed state in source-linked detail and keyboard trajectory reading`, { tag: "@P0" }, async ({ page }) => {
    const text = messages[locale];
    await openWorkbench(page, locale);
    const baseline = await page.evaluate(() => ({ document: window.playground.document, dag: window.playground.executionDAG }));
    const ambiguous = baseline.dag.nodes.filter((node) => node.metadata.agentScopeUnresolved);
    expect(ambiguous).toHaveLength(6);
    await expect(page.locator("#record-actions, #global-summary, #scope-information")).toHaveCount(0);
    await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
    await expect(page.locator("#dag canvas, #dag svg")).toHaveCount(0);
    const ids = await page.evaluate(() => window.playground.trajectory.records.filter((item) => item.metadata.agentScopeUnresolved).map(({ id }) => id));
    expect(ids).toHaveLength(6);
    for (const id of ids) {
      const row = page.locator(`[data-trajectory-record=${JSON.stringify(id)}]`);
      await expect(row.locator(".trajectory-status")).toBeVisible();
      await expect(row).toContainText(text.statePattern);
      await expect(row).not.toContainText(/Status success|Component Tool|Duration · Not recorded|耗时 · 未记录/);
    }
    const first = page.locator(`[data-trajectory-record=${JSON.stringify(ids[0])}]`);
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-state").first()).toHaveText(text.statePattern);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context")).toContainText(text.scopeState);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context [data-hierarchy-group]")).toHaveCount(0);

    await expect(page.locator("#reading-sidebar, #inspection-search")).toHaveCount(0);
    const linked = page.locator(`[data-trajectory-step=${JSON.stringify(ambiguous[0].id)}]`);
    await expect(linked.locator("strong")).not.toBeEmpty();
    await expect(linked).toContainText(text.statePattern);
    await expect(linked).not.toContainText(/Duration · Not recorded|耗时 · 未记录/);
    await expect(linked).not.toContainText("success");
    await selectAgentStep(page, ambiguous[0].id);
    for (const { envelopeIndex } of ambiguous[0].evidence) await expectSelectedEvidence(page, envelopeIndex, record.evidence[envelopeIndex]);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-state").first()).toHaveText(text.statePattern);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context")).toContainText(text.scopeState);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context [data-hierarchy-group]")).toHaveCount(0);
    const trajectoryId = await page.evaluate(() => window.playground.trajectory.records.find((node) => node.metadata.agentScopeUnresolved).id);
    const trajectory = page.locator(`[data-trajectory-record=${JSON.stringify(trajectoryId)}]`);
    await expect(trajectory).toContainText(text.statePattern);
    await trajectory.click();
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).not.toBeEmpty();
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-state").first()).toHaveText(text.statePattern);
    expect(await page.evaluate((id) => window.playground.trajectory.records.find((node) => node.id === id).metadata.agentScopeUnresolved, trajectoryId)).toBe(true);
    expect(await page.evaluate(() => ({ document: window.playground.document, dag: window.playground.executionDAG }))).toEqual(baseline);
  });

  test(`public canvas and embedded ${locale} trajectory never announce unconfirmed evidence as successful execution`, { tag: "@P0" }, async ({ page }) => {
    const text = messages[locale];
    await openWorkbench(page, locale);
    await page.evaluate(async ({ record, locale }) => {
      const { createEinoViewer } = await import("/src/viewer.js");
      const { createEinoRunViewer } = await import("/src/run-viewer.js");
      const host = document.createElement("div");
      host.id = "reading-viewer";
      host.style.cssText = "height:500px;width:900px";
      host.setAttribute("aria-label", "Host-provided label");
      document.body.append(host);
      window.readingClicks = [];
      window.readingViewer = createEinoViewer(host, record, {
        locale: locale === "zh" ? { statuses: { success: "成功", failed: "失败", skipped: "已跳过" } } : undefined,
        onNodeClick: (event) => window.readingClicks.push(event),
      });
      const embedded = document.createElement("div");
      embedded.id = "reading-embedded";
      document.body.append(embedded);
      window.readingEmbedded = createEinoRunViewer(embedded, record, { locale });
    }, { record, locale });
    const host = page.locator("#reading-viewer");
    await expect(host).toHaveAttribute("aria-label", new RegExp(`${text.state}: 6`));
    const before = await page.evaluate(() => JSON.stringify(window.readingViewer.document));
    await focusUnconfirmed(page, host);
    await expect(host).toHaveAttribute("aria-label", text.statePattern);
    await expect(host).not.toHaveAttribute("aria-label", /Duration · Not recorded|耗时 · 未记录/);
    await expect(host).not.toHaveAttribute("aria-label", /Status success|Component Tool/);
    await host.press("Enter");
    expect(await page.evaluate(() => {
      const clicked = window.readingClicks.at(-1);
      return clicked.node === window.readingViewer.document.execution.nodes.find((node) => node.id === clicked.id)
        && clicked.node.status === "success" && clicked.node.metadata.agentScopeUnresolved;
    })).toBe(true);
    await page.evaluate((record) => window.readingViewer.update(record), record);
    await host.press("Escape");
    await expect(host).toHaveAttribute("aria-label", new RegExp(`${text.state}: 6`));
    expect(await page.evaluate(() => JSON.stringify(window.readingViewer.document))).toBe(before);
    await ensureDiagramVisible(page.locator("#reading-embedded"));
    const embedded = page.locator("#reading-embedded [data-agent-trajectory]");
    await expect(embedded).toBeVisible();
    await expect(page.locator("#reading-embedded canvas")).toHaveCount(0);
    const unresolved = embedded.locator("[data-trajectory-record]").filter({ hasText: text.statePattern });
    await expect(unresolved).toHaveCount(6);
    await unresolved.first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#reading-embedded [data-step-detail]")).toContainText(text.statePattern);
    await expect(unresolved.first()).not.toContainText(/Status success|Component Tool|Duration · Not recorded|耗时 · 未记录/);
    await page.evaluate(() => { window.readingViewer.destroy(); window.readingEmbedded.destroy(); });
    await expect(host).toHaveAttribute("aria-label", "Host-provided label");
    await expect(host.locator("canvas")).toHaveCount(0);
  });
}

test("a real declaration-only Workflow with no execution node list opens without inventing execution", { tag: "@P0" }, async ({ page }) => {
  await openWorkbench(page, "zh");
  await openWorkbenchRecord(page, definitionOnly);
  await expect.poll(() => page.evaluate(() => window.playground.document.runId)).toBe(definitionOnly.runId);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  const summary = await page.evaluate(() => window.playground.explanation.run);
  expect(summary.result).toMatchObject({ state: "definition-only", basis: "declared" });
  expect(summary.capture.status).toBe("unknown");
  expect(summary.input.availability).toBe("not-observed");
  expect(summary.output.availability).toBe("not-observed");
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-result="definition-only"]')).toBeVisible();
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-result="success"]')).toHaveCount(0);
  await expect(page.locator("#node-detail #run-result-summary")).toBeVisible();
  await expect(page.locator("#dag canvas").first()).toBeVisible();
  await expect(page.locator("#dag")).not.toHaveAttribute("aria-label", /成功:|Succeeded:|Status success/);
  const observed = await page.evaluate(async (record) => {
    const { createEinoViewer } = await import("/src/viewer.js");
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:500px";
    document.body.append(host);
    const viewer = createEinoViewer(host, record);
    try {
      viewer.update(record);
      return { hasExecution: viewer.document.execution !== undefined,
        hasNodes: Object.hasOwn(viewer.document.definition.execution, "nodes"),
        label: host.getAttribute("aria-label"), canvas: Boolean(host.querySelector("canvas")) };
    } finally { viewer.destroy(); host.remove(); }
  }, definitionOnly);
  expect(observed).toMatchObject({ hasExecution: false, hasNodes: false, canvas: true });
  expect(observed.label).not.toMatch(/Succeeded:|Status success/);
  expect(await page.evaluate(() => window.playground.document)).toEqual(definitionOnly);
});
