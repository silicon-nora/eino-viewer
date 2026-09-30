import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { syntheticAgentRecord, syntheticGraphRecord } from "../helpers/synthetic-record.js";
import { openStepSearch, openWorkbenchRecord, openRunInformation, selectAgentStep, expectSelectedEvidence } from "../helpers/workbench-ui.js";

async function openRecord(page, record) {
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document?.runId)).toBe(record.runId);
}

test("saved Graph record has truthful elapsed time and searchable source-backed paged steps", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = syntheticGraphRecord(1000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1560, height: 980 });
  await openRecord(page, record);
  await openRunInformation(page);
  await expect(page.locator("#node-detail .step-duration")).toHaveText("耗时 · 496 ms");
  await openStepSearch(page);
  const indexBounds = await page.locator("#run-inspection").boundingBox();
  const mainBounds = await page.locator(":is(#reading-main, .eino-agent-reader [data-reading-main])").boundingBox();
  expect(indexBounds.x + indexBounds.width).toBeLessThanOrEqual(mainBounds.x + 1);
  expect((await page.locator(".canvas-host").boundingBox()).height).toBeLessThanOrEqual(1200);
  await expect(page.locator("[data-inspection-node]")).toHaveCount(25);
  await expect(page.locator("#inspection-count")).toHaveText("1–25 / 250");
  await page.locator("#inspection-next").click();
  await expect(page.locator("#inspection-count")).toHaveText("26–50 / 250");
  const id = await page.locator("[data-inspection-node]").first().getAttribute("data-inspection-node");
  await page.locator("#inspection-search").fill(id);
  await page.locator("[data-inspection-node]").first().click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-duration")).toHaveText("耗时 · 1 ms");
  if (testInfo.project.name === "chromium") {
    mkdirSync(new URL("../../.artifacts/iteration-3/", import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL("../../.artifacts/iteration-3/workbench-timing-inspection.png", import.meta.url).pathname, fullPage: true });
  }
  const selection = await page.evaluate(() => window.playground.linkedSelection);
  const indexes = await page.evaluate(() => window.playground.selectedNodeDetail.evidence.map(({ envelopeIndex }) => envelopeIndex));
  expect(indexes.length).toBeGreaterThan(0);
  for (const index of indexes) await expectSelectedEvidence(page, index, record.evidence[index]);
  await page.locator("#inspection-search").fill("");
  await expect(page.locator('#inspection-scope option[value="evidence"], #inspection-scope option[value="unassigned"], [data-inspection-evidence]')).toHaveCount(0);
  await expect(page.locator("[data-inspection-node]")).toHaveCount(25);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selection);
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe(id);
  expect(record.evidence.filter(({ kind }) => kind === "schema.document")).toHaveLength(1);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  expect(errors).toEqual([]);
});

test("error navigation and a legacy record never invent duration", { tag: "@P0" }, async ({ page }) => {
  const record = JSON.parse(readFileSync(new URL("../../fixtures/recorder-matrix/workflow-failed-successor.json", import.meta.url)));
  await openRecord(page, record);
  await openRunInformation(page);
  await page.locator("#run-result-summary [data-run-issue-step]").first().click();
  await expect(page.locator("#node-detail")).toContainText(/失败|fail/);
  await expect(page.locator("#snapshot-json")).toBeHidden();
  await expectSelectedEvidence(page, 0, record.evidence[0]);
  const legacy = syntheticGraphRecord(100);
  legacy.evidence = legacy.evidence.filter(({ kind, payload }) => kind !== "run.lifecycle" && !(kind === "callback.event" && payload.address.length === 1));
  await openWorkbenchRecord(page, legacy);
  await openRunInformation(page);
  expect(await page.evaluate(() => window.playground.explanation.run.timing.durationMs)).toBeUndefined();
  await expect(page.locator("#global-summary")).toBeHidden();
});

test("definition-only Graph clicks preserve definition evidence in the workbench", { tag: "@P0" }, async ({ page }) => {
  const original = JSON.parse(readFileSync(new URL("../../fixtures/recorder-matrix/graph-step-limit.json", import.meta.url)));
  const record = { ...original, evidence: original.evidence.filter(({ kind }) => kind === "compose.graph") };
  await openRecord(page, record);
  await page.locator('#dag [data-graph-node="retry"]').click();
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe("graph:1:retry");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.timing.durationMs)).toBeUndefined();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .node-detail-hero")).not.toContainText(/\b0 ms\b/);
  await expect(page.locator("#node-detail .technical-disclosure, #node-detail button[data-envelope-index]")).toHaveCount(0);
  const selected = await expectSelectedEvidence(page, 0, record.evidence[0]);
  expect(selected).toEqual(record.evidence[0]);
});

for (const scenario of ["agent-repeated-tool"]) {
  test(`real ${scenario} retains separate source-linked tool results in detail and trajectory`, { tag: "@P0" }, async ({ page }) => {
    const record = JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${scenario}.json`, import.meta.url)));
    const outputs = record.evidence.filter(({ kind, payload }) => kind === "component.io" && payload.component === "Tool" && payload.direction === "output");
    expect(outputs).toHaveLength(2);
    await openRecord(page, record);
    await expect(page.locator("#reading-sidebar, #inspection-search")).toHaveCount(0);
    for (const output of outputs) {
      const callId = output.payload.address.findLast(({ type }) => type === "tool").subId;
      const response = output.payload.body.response;
      expect(typeof callId).toBe("string");
      expect(typeof response).toBe("string");
      const canonical = await page.evaluate((id) => window.playground.executionDAG.nodes.filter((node) => node.correlation.toolCallId === id), callId);
      expect(canonical).toHaveLength(1);
      const choice = await selectAgentStep(page, canonical[0].id);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(response);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) })).toContainText(response);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure, :is(#node-detail, .eino-agent-reader [data-step-detail]) .step-identity")).toHaveCount(0);
      const selected = await page.evaluate(() => ({
        callId: window.playground.selectedNodeDetail.trajectoryRecord.toolCallId,
        indexes: window.playground.selectedNodeDetail.evidence.map((item) => item.envelopeIndex),
      }));
      expect(selected.callId).toBe(callId);
      const sourceIndex = record.evidence.indexOf(output);
      expect(selected.indexes).toContain(sourceIndex);
      await expectSelectedEvidence(page, sourceIndex, output);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).not.toContainText(callId);
      await expect(choice.locator(".inspection-identity")).toHaveCount(0);
      await page.locator(`[data-trajectory-record="tool:${callId}"]`).click();
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(response);
      await expectSelectedEvidence(page, sourceIndex, output);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).not.toContainText(callId);
    }
  });
}

test("large Graph records retain bounded navigation while Agent trajectories flow in full", { tag: "@P2" }, async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const count of [100, 1000, 10000]) {
    const record = syntheticGraphRecord(count);
    await page.goto("/.artifacts/pages/?lang=zh");
    await page.waitForFunction(() => window.playground?.ready);
    await page.waitForLoadState("networkidle");
    await openWorkbenchRecord(page, record);
    await expect.poll(() => page.evaluate(() => window.playground.document?.runId)).toBe(record.runId);
    const technical = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure");
    await expect(technical).toHaveCount(0);
    if (count === 100) {
      // Technical source rows are no longer UI. The selected root must still
      // retain every exact child identity through a language refresh.
      const expectedPeers = Array.from({ length: Math.floor((count - 7) / 4) }, (_, index) => `callback:runnable:scale-node:visit:${index + 2}`);
      const peerIds = () => page.evaluate(() => window.playground.selectedNodeDetail.relationships.map(({ peer }) => peer));
      await expect.poll(peerIds).toEqual(expectedPeers);
      await page.locator('[data-language="en"]').click();
      await expect(technical).toHaveCount(0);
      await expect.poll(peerIds).toEqual(expectedPeers);
      await page.locator('[data-language="zh"]').click();
      await expect.poll(peerIds).toEqual(expectedPeers);
    }
    if (count === 10000) {
      await expect(page.locator("#dag canvas, #dag svg[data-graph-topology]")).toHaveCount(0);
      await expect(page.locator(".large-record-notice")).toContainText("较长的运行记录");
      expect(await page.evaluate(() => window.playground.executionDAG.nodes.length)).toBe(2500);
      await expect(page.locator(".large-record-notice button")).toHaveText("绘制完整视图");
    }
    await openStepSearch(page);
    const stepCount = await page.evaluate(() => window.playground.explanation.nodes.length);
    await expect(page.locator("[data-inspection-node]")).toHaveCount(Math.min(25, stepCount));
    await page.locator("[data-inspection-node]").first().click();
    const indexes = await page.evaluate(() => window.playground.selectedNodeDetail.evidence.map(({ envelopeIndex }) => envelopeIndex));
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) await expectSelectedEvidence(page, index, record.evidence[index]);
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  }
  const base = JSON.parse(readFileSync(new URL("../../fixtures/recorder-matrix/agent-direct-answer.json", import.meta.url), "utf8"));
  const agent = syntheticAgentRecord(base, 125);
  await page.setViewportSize({ width: 1560, height: 980 });
  await openRecord(page, agent);
  const users = agent.evidence.flatMap((envelope, index) => envelope.kind === "schema.message" && envelope.payload.role === "user"
    ? [{ id: `user:evidence:${index}`, index, value: envelope.payload.content }] : []);
  const finalValue = base.evidence.find(({ kind, payload }) => kind === "component.io" && payload.direction === "output").payload.body.message.content;
  const expected = [...users.map(({ id }) => id), "assistant:turn:1:1"];
  expect(expected).toHaveLength(125);
  const rows = page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory]) [data-trajectory-record]");
  const row = (id) => page.locator(`:is(#domain-view, .eino-agent-reader [data-agent-trajectory]) [data-trajectory-record=${JSON.stringify(id)}]`);
  const ids = () => rows.evaluateAll((entries) => entries.map((entry) => entry.dataset.trajectoryRecord));
  await expect(rows).toHaveCount(expected.length);
  await expect.poll(ids).toEqual(expected);
  expect(new Set(await ids()).size).toBe(expected.length);
  expect(await rows.locator(".trajectory-summary").allTextContents()).toEqual([...users.map(({ value }) => value), finalValue]);
  await expect(page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory]) .trajectory-pagination, :is(#domain-view, .eino-agent-reader [data-agent-trajectory]) [data-trajectory-page], #dag canvas, #dag svg")).toHaveCount(0);
  const flatGeometry = await page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])").evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflow: getComputedStyle(element).overflowY,
    maxHeight: getComputedStyle(element).maxHeight,
    hiddenHeight: element.scrollHeight - element.clientHeight,
  }));
  expect(flatGeometry.height).toBeGreaterThan(700);
  expect(flatGeometry.overflow).toBe("visible");
  expect(flatGeometry.maxHeight).toBe("none");
  expect(flatGeometry.hiddenHeight).toBeLessThanOrEqual(1);

  // The final answer is reachable by ordinary page scrolling, with no pager or
  // nested trajectory scroll area. Its inspector stays alongside that row.
  const finalRow = rows.last();
  await finalRow.scrollIntoViewIfNeeded();
  await expect(finalRow).toBeInViewport();
  await finalRow.click();
  await expect(page.locator(":is(#inspector-panel .inspector-content > header, .eino-agent-reader .agent-detail-heading)")).toBeInViewport();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$|^Output$/ }) }).locator(".business-value-text")).toHaveText(finalValue);
  await expect(page.locator("#close-details")).toHaveCount(0);
  const dismiss = async () => {
    await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
    await page.keyboard.press("Escape");
  };
  await dismiss();
  await expect(finalRow).toBeFocused();

  // Keyboard selection near the end preserves its original canonical identity
  // and input without adding a second navigation surface.
  const target = users.at(-1), stepId = `input:user:${target.index}`;
  const step = row(target.id);
  await expect(step).toHaveAttribute("data-trajectory-step", stepId);
  await step.focus();
  await page.keyboard.press("Enter");
  const selected = row(target.id);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(selected).toBeInViewport();
  await expect(page.locator(":is(#inspector-panel .inspector-content > header, .eino-agent-reader .agent-detail-heading)")).toBeInViewport();
  const input = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输入$|^Input$/ }) }).locator(".business-value-text");
  await expect(input).toHaveText(target.value);
  expect(await page.evaluate(() => window.playground.linkedSelection.evidenceIndexes)).toContain(target.index);
  await dismiss();
  await expect(step).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selected).toBeInViewport();
  const position = await page.evaluate(() => window.scrollY);
  expect(position).toBeGreaterThan(700);
  // Dispatch the existing language control without first scrolling the page to
  // the toolbar; it is the language refresh's own position preservation tested.
  await page.locator('[data-language="en"]').dispatchEvent("click");
  await expect.poll(ids).toEqual(expected);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position);
  await expect(input).toHaveText(target.value);
  await expect(page.locator(":is(#inspector-panel .inspector-content > header, .eino-agent-reader .agent-detail-heading)")).toBeInViewport();
  await dismiss();
  await expect(step).toBeFocused();
  expect(await page.evaluate(() => window.playground.document)).toEqual(agent);
  expect(errors).toEqual([]);
});
