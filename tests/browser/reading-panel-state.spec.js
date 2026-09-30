import { expect, test } from "@playwright/test";
import { openSample, selectWorkflowStep } from "../helpers/workbench-ui.js";

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
  await selectWorkflowStep(page, "fast");
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
  await selectWorkflowStep(page, "slow");
  await frames(page);
  expect(await zoom(page)).toBeCloseTo(manual, 8);
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  await expect(page.locator("#open-details")).toBeHidden();
  const selected = await page.evaluate(() => window.playground.linkedSelection);
  await page.locator('[data-language="en"]').click();
  await frames(page);
  await expect(page.locator("#node-detail")).toBeVisible();
  await expect(page.locator("#open-details")).toBeHidden();
  expect(await zoom(page)).toBeCloseTo(manual, 8);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected);
  expect(await page.evaluate(() => window.playground.document)).toEqual(document);
});

for (const viewport of [{ width: 1440, height: 1000, name: "desktop" }, { width: 390, height: 844, name: "narrow" }]) {
  test(`Workflow language changes preserve selection and fixed reading panels without transient reveals on ${viewport.name}`, { tag: "@P1" }, async ({ page }) => {
    await open(page, viewport, "workflow");
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
    for (const language of ["en", "zh"]) {
      await page.evaluate(() => { window.panelScrollCalls = 0; window.panelVisibilityChanges = []; });
      const baselineZoom = await zoom(page);
      await page.locator(`[data-language="${language}"]`).click();
      await frames(page);
      for (const selector of ["#raw-records-tab", "#open-raw", "#snapshot-json"]) await expect(page.locator(selector)).toBeHidden();
      await expect(page.locator("#node-detail")).toBeVisible();
      await expect(page.locator("section#path-region")).toBeVisible();
      await expect(page.locator("#close-details, #path-region > summary")).toHaveCount(0);
      expect(await page.evaluate(() => window.panelScrollCalls)).toBe(0);
      // Assigning the unchanged hidden property can emit an attribute record;
      // every prior value must still match the unchanged visibility state.
      const transitions = await page.evaluate(() => window.panelVisibilityChanges);
      expect(transitions.every((value) => value === null)).toBe(true);
      expect(baselineZoom).toBeGreaterThan(0);
      expect(await zoom(page)).toBeCloseTo(baselineZoom, 8);
      expect(await page.evaluate(() => ({ document: window.playground.document, selection: window.playground.linkedSelection }))).toEqual(before);
    }
    await page.evaluate(() => window.panelVisibilityObserver.disconnect());
  });
}
