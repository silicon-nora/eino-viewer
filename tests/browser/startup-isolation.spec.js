import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const record = JSON.parse(readFileSync(new URL("../../fixtures/recorder-matrix/graph-multistep-loop-success.json", import.meta.url), "utf8"));
const sampleURL = /\/fixtures\/eino-component-io-v1\.json(?:\?|$)/;

test("unavailable example resources show loading or failure without restoring removed import controls", { tag: "@P1" }, async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const mode of ["missing", "invalid", "pending"]) {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route(sampleURL, async (route) => {
      if (mode === "pending") { await pending; await route.continue(); }
      else await route.fulfill({ status: mode === "missing" ? 404 : 200, contentType: "application/json", body: mode === "missing" ? "not found" : "{broken" });
    });
    try {
      await page.goto("/.artifacts/pages/?lang=zh", { waitUntil: "domcontentloaded" });
      // Deliberately do not wait for networkidle: this resource may never end.
      await page.waitForFunction(() => window.playground?.ready);
      await expect(page.locator("#record-opening")).toBeVisible();
      await expect(page.locator(".controls")).toBeHidden();
      await expect(page.locator("#record-picker, #record-file, #record-drop-zone, #import-record, #viewer-kind, #open-examples, #example-picker")).toHaveCount(0);
      await expect(page.locator("#paste-record")).toBeHidden();
      expect(await page.evaluate(() => window.playground.document)).toBeUndefined();
      await expect(page.locator("#sample")).toBeDisabled();
      for (const card of await page.locator("[data-open-example]").all()) await expect(card).toBeDisabled();
      await expect(page.locator("#opening-example-status")).toHaveText(mode === "pending" ? "示例加载中…" : "示例暂不可用");
      await expect(page.locator("#opening-example-status")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${mode}-opening.png`) });
      await page.locator('[data-language="en"]').click();
      await expect(page.locator("#opening-example-status")).toHaveText(mode === "pending" ? "Loading examples…" : "Examples unavailable");
      expect(await page.evaluate(() => window.playground.document)).toBeUndefined();
      if (mode === "pending") {
        release();
        await expect(page.locator("#sample")).toBeEnabled();
        await expect(page.locator("#sample-status")).toBeHidden();
        // Finishing a request does not open a record; a real homepage choice does.
        expect(await page.evaluate(() => window.playground.document)).toBeUndefined();
        await page.locator('[data-open-example="graph-multistep-loop-success"]').click();
        await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
        await expect(page.locator("#record-kind")).toHaveText("Graph");
        await expect(page.locator("#sample")).toHaveValue("graph-multistep-loop-success");
        await expect(page.locator("#sample")).toHaveAccessibleName("Change record");
        await expect(page.locator("#global-summary")).toBeHidden();
        await expect(page.locator("#run-result-summary")).toBeEmpty();
        expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.status)).toBe("success");
        await page.screenshot({ path: testInfo.outputPath(`${mode}-selected.png`) });
      }
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  }
  // Successfully fetched JSON can still be an unsupported record. Keep the
  // rejection on the homepage until the user chooses another real example.
  const unsupportedSampleURL = /\/fixtures\/recorder-matrix\/graph-multistep-loop-success\.json(?:\?|$)/;
  await page.route(unsupportedSampleURL, (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ...record, schemaVersion: 999 }) }));
  try {
    await page.goto("/.artifacts/pages/?lang=zh");
    await page.waitForFunction(() => window.playground?.ready);
    await page.locator('[data-open-example="graph-multistep-loop-success"]').click();
    await expect(page.locator("#record-opening")).toBeVisible();
    await expect(page.locator(".controls")).toBeHidden();
    expect(await page.evaluate(() => window.playground.document)).toBeUndefined();
    await expect(page.locator("#validation-result")).toHaveClass(/invalid/);
    await expect(page.locator("#issue-list")).toContainText("run_record.invalid_schema_version");
    await expect(page.locator("#opening-example-status")).toBeVisible();
    await expect(page.locator("#opening-example-status")).toHaveText("无法打开这份记录：记录格式或内容不符合要求。");
    await page.locator('[data-language="en"]').click();
    await expect(page.locator("#record-opening")).toBeVisible();
    expect(await page.evaluate(() => window.playground.document)).toBeUndefined();
    await expect(page.locator("#validation-result")).toHaveClass(/invalid/);
    await expect(page.locator("#issue-list")).toContainText("run_record.invalid_schema_version");
    await expect(page.locator("#opening-example-status")).toBeVisible();
    await expect(page.locator("#opening-example-status")).toHaveText("This record could not be opened. Its format or contents are not supported.");
    await page.locator('[data-open-example="agent-weather-workflow"]').click();
    const accepted = JSON.parse(readFileSync(new URL("../../fixtures/eino-agent-recorder-trip-planner-completed-v1.json", import.meta.url), "utf8"));
    await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(accepted);
    await expect(page.locator("#record-kind")).toHaveText("Agent");
    await expect(page.locator("#sample")).toHaveValue("agent-weather-workflow");
    await expect(page.locator("#record-opening")).toBeHidden();
    await expect(page.locator("#opening-example-status")).toBeHidden();
    await expect(page.locator("#opening-example-status")).toBeEmpty();
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    await expect(page.locator("#import-status")).toBeEmpty();
    expect(await page.evaluate(() => window.playground.validation.kind)).not.toBe("invalid");
    expect(await page.evaluate(() => window.playground.diagnostics.map(({ code }) => code))).not.toContain("run_record.invalid_schema_version");
  } finally {
    await page.unroute(unsupportedSampleURL);
  }
  // Core failure remains a real unavailable state rather than enabling choices.
  let coreBlocked = false;
  await page.route(/\/dist\/eino-workflow-dag\.umd\.js(?:\?|$)/, (route) => { coreBlocked = true; return route.abort(); });
  await page.goto("/.artifacts/pages/?lang=zh");
  await expect.poll(() => coreBlocked).toBe(true);
  await expect(page.locator(".controls")).toBeHidden();
  await expect(page.locator("#opening-example-status")).toBeVisible();
  await expect(page.locator("#opening-example-status")).toHaveText("渲染器不可用");
  await expect(page.locator("#import-status")).toHaveText("渲染器不可用");
  await expect(page.locator("#record-file, #record-drop-zone, #import-record")).toHaveCount(0);
  await expect(page.locator("#paste-record")).toBeHidden();
  await expect(page.locator("#sample")).toBeDisabled();
  for (const card of await page.locator("[data-open-example]").all()) await expect(card).toBeDisabled();
  await page.locator('[data-language="en"]').click();
  await expect(page.locator("#opening-example-status")).toBeVisible();
  await expect(page.locator("#opening-example-status")).toHaveText("Renderer unavailable");
  await expect(page.locator("#import-status")).toHaveText("Renderer unavailable");
  expect(errors).toEqual([]);
});
