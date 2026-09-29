import { expect, test } from "@playwright/test";
import { openSample, openStepSearch, openPasteDraft } from "../helpers/workbench-ui.js";

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function open(page, viewport = { width: 1440, height: 1000 }, kind = "agent") {
  await page.setViewportSize(viewport);
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await openSample(page, kind, kind === "workflow" ? "workflow-parallel-join-success" : undefined);
  await openStepSearch(page);
  await page.locator("[data-inspection-node]").nth(1).click();
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  await frames(page);
}

async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function zoom(page) {
  return page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    return cy?.zoom() ?? null;
  });
}

test("selecting another step in an already open panel preserves manual graph zoom", { tag: "@P1" }, async ({ page }) => {
  await open(page, undefined, "workflow");
  const document = await page.evaluate(() => window.playground.document);
  const fitted = await zoom(page);
  await page.locator("#zoom-out").click();
  await expect.poll(() => zoom(page)).toBeLessThan(fitted);
  const manual = await zoom(page);
  await page.locator("[data-inspection-node]").nth(2).click();
  await frames(page);
  expect(await zoom(page)).toBeCloseTo(manual, 8);
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  await expect(page.locator("#open-details")).toHaveAttribute("aria-expanded", "true");
  const selected = await page.evaluate(() => window.playground.linkedSelection);
  await page.locator('[data-language="en"]').click();
  await frames(page);
  await expect(page.locator("#node-detail-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#open-details")).toHaveAttribute("aria-expanded", "true");
  expect(await zoom(page)).toBeCloseTo(manual, 8);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected);
  expect(await page.evaluate(() => window.playground.document)).toEqual(document);
});

for (const viewport of [{ width: 1440, height: 1000, name: "desktop" }, { width: 390, height: 844, name: "narrow" }]) {
  test(`Workflow language changes preserve import draft, selection and open/closed state without transient reveals on ${viewport.name}`, { tag: "@P1" }, async ({ page }) => {
    await open(page, viewport, "workflow");
    await openPasteDraft(page);
    const draft = '{"unapplied draft": true';
    await expect(page.locator("#snapshot-json")).toBeEditable();
    await page.locator("#snapshot-json").fill(draft);
    await page.locator("#snapshot-json").evaluate((editor) => editor.setSelectionRange(2, 9, "backward"));
    await frames(page);
    const before = await page.evaluate(() => ({ document: window.playground.document, selection: window.playground.linkedSelection }));
    // Observe actual transient state, not just the final restored appearance.
    await page.evaluate(() => {
      window.panelScrollCalls = 0;
      const originalScroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        if (this.id === "inspector-panel") window.panelScrollCalls += 1;
        return originalScroll.apply(this, args);
      };
      window.panelVisibilityChanges = [];
      window.panelVisibilityObserver = new MutationObserver((entries) => {
        window.panelVisibilityChanges.push(...entries.map((entry) => entry.oldValue));
      });
      window.panelVisibilityObserver.observe(document.querySelector(":is(#inspector-panel, .eino-agent-reader [data-step-panel])"), { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
    });
    for (const openState of [true, false]) {
      if (!openState) {
        await expect(page.locator("#close-details")).toHaveCount(0);
        await page.locator("#snapshot-json").focus();
        await page.keyboard.press("Escape");
        await frames(page);
      }
      await page.evaluate(() => { window.panelScrollCalls = 0; window.panelVisibilityChanges = []; });
      const baselineZoom = await zoom(page);
      await page.locator(`[data-language="${openState ? "en" : "zh"}"]`).click();
      await frames(page);
      await expect(page.locator("#raw-records-tab")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#node-detail-tab")).toHaveAttribute("aria-selected", "false");
      await expect(page.locator("#open-raw")).toHaveAttribute("aria-expanded", String(openState));
      expect(await page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])").evaluate((panel) => !panel.hidden)).toBe(openState);
      expect(await page.locator("#snapshot-json").inputValue()).toBe(draft);
      expect(await page.locator("#snapshot-json").evaluate((editor) => [editor.selectionStart, editor.selectionEnd, editor.selectionDirection])).toEqual([2, 9, "backward"]);
      expect(await page.evaluate(() => window.panelScrollCalls)).toBe(0);
      // Assigning the unchanged hidden property can emit an attribute record;
      // every prior value must still match the unchanged visibility state.
      const transitions = await page.evaluate(() => window.panelVisibilityChanges);
      expect(transitions.every((value) => openState ? value === null : value !== null)).toBe(true);
      expect(baselineZoom).toBeGreaterThan(0);
      expect(await zoom(page)).toBeCloseTo(baselineZoom, 8);
      expect(await page.evaluate(() => ({ document: window.playground.document, selection: window.playground.linkedSelection }))).toEqual(before);
    }
    await openPasteDraft(page);
    await expect(page.locator("#snapshot-json")).toHaveValue(draft);
    await page.evaluate(() => window.panelVisibilityObserver.disconnect());
  });
}
