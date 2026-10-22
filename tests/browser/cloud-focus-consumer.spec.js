import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prepareWorkbenchExample } from "../helpers/workbench-ui.js";

const fixtureDir = process.env.EINO_CLOUD_FOCUS_FIXTURES;
const fixtures = fixtureDir ? readdirSync(fixtureDir).filter(name => name.endsWith(".json")) : [];
const portableURL = new URL("../../.artifacts/portable/eino-viewer.html", import.meta.url).href;

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode}: real cloud-focus Generate records retain producer facts`, async ({ page }) => {
    test.skip(!fixtureDir, "Set EINO_CLOUD_FOCUS_FIXTURES to freshly executed consumer records.");
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    for (const name of fixtures) {
      const record = JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
      delete record.sourceRecords;
      const errors = [];
      const onError = error => errors.push(error.message);
      page.on("pageerror", onError);
      let prepared;
      if (mode === "workbench") {
        prepared = await prepareWorkbenchExample(page, record, { kind: "workflow", id: "workflow-parallel-join-success" });
        await page.goto("/.artifacts/pages/?lang=zh");
        await page.waitForFunction(() => window.playground?.ready);
        await page.locator('[data-open-example="workflow-parallel-join-success"]').click();
        await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
      } else if (mode === "portable") {
        await page.goto(portableURL);
        await page.locator("#record-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
        await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
      } else {
        await page.route("**/__cloud-focus-consumer__", route => route.fulfill({ contentType: "text/html",
          body: '<!doctype html><html><head><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main id="viewer"></main></body></html>' }));
        await page.goto("/__cloud-focus-consumer__");
        await page.evaluate(async input => {
          const { createEinoRunViewer } = await import("/src/run-viewer.js");
          window.consumerViewer = createEinoRunViewer(document.querySelector("#viewer"), input, { locale: "zh" });
        }, record);
      }
      await page.waitForLoadState("networkidle");
      const viewer = page.locator('[data-eino-run-viewer][data-record-version="2"]');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator("[data-run-result]").first()).toHaveAttribute("data-run-result", record.run.status);
      await expect(viewer.locator("button[data-step-id]")).toHaveCount(record.invocations.length - 1);
      await viewer.locator("summary").filter({ hasText: /^(完整原始记录|Original record)$/ }).click();
      expect(JSON.parse(await viewer.locator("[data-original-record]").textContent())).toEqual(record);
      expect(errors).toEqual([]);
      page.off("pageerror", onError);
      if (prepared) await prepared.dispose();
    }
  });
}
