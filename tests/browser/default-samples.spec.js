import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openSample, openRunInformation } from "../helpers/workbench-ui.js";

const readFixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const defaults = [
  { kind: "agent", id: "agent-weather-workflow", file: "eino-agent-recorder-trip-planner-completed-v1.json" },
  { kind: "graph", id: "graph-io-structured", file: "recorder-matrix/graph-io-structured.json" },
  { kind: "workflow", id: "workflow-io-success", file: "recorder-matrix/workflow-io-success.json" },
];
const errors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  await page.setViewportSize({ width: 1560, height: 980 });
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
});

test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

for (const sample of defaults) {
  test(`${sample.kind} example explicitly opens an unchanged real record with source-backed final input and output`, { tag: ["@data-matrix", "@P0"] }, async ({ page }) => {
    const record = readFixture(sample.file);
    await openSample(page, sample.kind, sample.id);
    await expect(page.locator("#sample")).toHaveValue(sample.id);
    if (sample.kind === "graph") {
      expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.status)).toBe("success");
      await expect(page.locator("#global-summary")).toBeHidden();
      await expect(page.locator("#run-result-summary")).toBeEmpty();
    } else if (sample.kind === "agent") await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
    else {
      expect(await page.evaluate(() => window.playground.explanation.run.result.state)).toBe("success");
      await expect(page.locator('[data-run-result="success"]')).toHaveCount(0);
      await expect(page.locator('[data-workflow-run]')).toHaveAttribute("aria-current", "true");
      await expect(page.locator("#node-detail #run-result-summary")).toBeVisible();
    }
    await expect(page.locator('[data-run-capture="complete"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.explanation.run.capture.status)).toBe("complete");
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
    const run = await page.evaluate(() => window.playground.explanation.run);
    await openRunInformation(page);

    for (const direction of ["input", "output"]) {
      const channel = page.locator(sample.kind === "graph" ? `#node-detail [data-business-channel="${direction}"]`
        : `:is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="${direction}"]`);
      await expect(sample.kind === "graph" ? channel.locator(".business-value") : channel).toHaveAttribute("data-availability", "available");
      expect(run[direction].items).toHaveLength(1);
      const item = run[direction].items[0];
      let expectedValue;
      let expectedIndexes;
      if (sample.kind === "agent") {
        const role = direction === "input" ? "user" : "assistant";
        const messageIndex = record.evidence.findIndex(({ kind, payload }) => kind === "schema.message" && payload.role === role);
        expectedValue = record.evidence[messageIndex].payload.content;
        expectedIndexes = [messageIndex];
        if (direction === "output") {
          const finalEventIndex = record.evidence.findLastIndex(({ kind, payload }) => kind === "agent.event" && payload.runPath.length === 1 && payload.output?.message?.role === "assistant");
          expect(record.evidence[finalEventIndex].payload.output.message.value).toEqual(record.evidence[messageIndex].payload);
          expectedIndexes.unshift(finalEventIndex);
        }
      } else {
        const rootIndex = record.evidence.findIndex(({ kind, payload, metadata }) => kind === "component.io" && payload.direction === direction && metadata?.io?.scope === "root");
        expect(rootIndex).toBeGreaterThanOrEqual(0);
        const source = record.evidence[rootIndex];
        expect(source.payload.address).toHaveLength(1);
        expect(source.payload.address[0].type).toBe("runnable");
        expect(source.payload.component).toBe(sample.kind === "graph" ? "Graph" : "Workflow");
        expectedValue = source.payload.body;
        expectedIndexes = [rootIndex];
      }
      expect(item.value).toEqual(expectedValue);
      expect(item.evidenceEnvelopeIndexes).toEqual(expectedIndexes);
      // Agent boundary values are readable at their exact trajectory position,
      // not duplicated in a second summary or hidden inside an action menu.
      if (sample.kind === "agent") {
        await expect(channel).toHaveCount(1);
        await expect(channel.locator("[data-run-value]")).toBeVisible();
        await expect(page.locator("#global-summary, #record-actions, #scope-information")).toHaveCount(0);
      }
      const visibleValue = typeof expectedValue === "string" ? expectedValue : expectedValue.query || expectedValue.answer;
      await expect(channel).toContainText(visibleValue);
    }
    // Reading and rendering must not enrich or rewrite the original fixture.
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  });
}

test("complex real Graph and Workflow examples require explicit selection and preserve source facts", { tag: ["@data-matrix", "@P0"] }, async ({ page }) => {
  for (const [kind, id, label, state] of [
    ["graph", "graph-multistep-loop-success", "多轮路线修订", "success"],
    ["graph", "graph-multistep-loop-failed", "第二轮评估失败", "failed"],
    ["workflow", "workflow-parallel-join-success", "并行费用汇总", "success"],
    ["workflow", "workflow-parallel-join-failed", "库存查询失败", "failed"],
  ]) {
    await openSample(page, kind, id);
    await expect(page.locator(`#sample option[value="${id}"]`)).toHaveText(label);
    await expect(page.locator("#sample")).toHaveValue(id);
    await expect(page.locator("#sample")).toHaveAccessibleName("更换记录");
    await expect(page.locator("#record-kind")).toHaveText(kind === "graph" ? "Graph" : "Workflow");
    await expect(page.locator("#record-picker, #viewer-kind, #example-picker, #open-examples, #record-file")).toHaveCount(0);
    if (kind === "graph") {
      expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.status)).toBe(state);
      if (state === "failed") await expect(page.locator("#node-detail .step-state.failed")).toBeVisible();
      else await expect(page.locator("#node-detail .step-state.success")).toHaveCount(0);
    } else {
      expect(await page.evaluate(() => window.playground.explanation.run.result.state)).toBe(state);
      await expect(page.locator('[data-workflow-run]')).toHaveAttribute("aria-current", "true");
      if (state === "failed") await expect(page.locator("#node-detail [data-run-result]")).toHaveAttribute("data-run-result", "failed");
      else await expect(page.locator('#node-detail [data-run-result="success"]')).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.playground.document)).toEqual(readFixture(`recorder-matrix/${id}.json`));
    // Merely focusing the current-type selector does not replace the record.
    const accepted = await page.evaluate(() => window.playground.document);
    await page.locator("#sample").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator('#sample option[value^="agent-"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.document)).toEqual(accepted);
  }
});
