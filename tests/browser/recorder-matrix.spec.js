import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expectAgentTrajectory, openDetails, openStepSearch, openWorkbenchRecord, selectAgentStep, expectSelectedEvidence } from "../helpers/workbench-ui.js";

const base = new URL("../../fixtures/recorder-matrix/", import.meta.url);
const scenarios = JSON.parse(readFileSync(new URL("manifest.json", base), "utf8")).cases;
const output = fileURLToPath(new URL("../../.artifacts/recorder-matrix/", import.meta.url));
const playgroundPath = process.env.EINO_VIEWER_PLAYGROUND_PATH ?? "/.artifacts/pages/?lang=zh";
const statusLabels = { success: "运行成功", failed: "运行失败", cancelled: "运行已取消", unknown: "运行未完成" };

// Record loading coverage stays separate from the targeted semantic acceptance
// tests below: accepting a record alone does not prove its steps truthful.
for (const scenario of scenarios) {
  test(`real Recorder ${scenario.id} opens with source-backed run completion`, { tag: ["@data-matrix", "@P0"] }, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const record = JSON.parse(readFileSync(new URL(`${scenario.id}.json`, base), "utf8"));
    await page.setViewportSize({ width: 1560, height: 980 });
    await page.goto(playgroundPath);
    await page.waitForFunction(() => window.playground?.ready);
    await openWorkbenchRecord(page, record);
    await expect.poll(() => page.evaluate(() => window.playground.document?.runId)).toBe(record.runId);
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
    await expect(page.locator("#record-kind")).toHaveText({ agent: "Agent", graph: "Graph", workflow: "Workflow" }[scenario.source]);
    expect(await page.evaluate(() => window.playground.objectKind)).toBe(scenario.source);
    if (scenario.source === "agent") {
      await expectAgentTrajectory(page);
      expect(await page.evaluate(() => window.playground.validation.kind)).not.toBe("invalid");
      await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", scenario.outcome === "unknown" ? "interrupted" : scenario.outcome);
      if (scenario.capture === "partial") await expect(page.locator('[data-agent-capture="partial"]')).toBeVisible();
    } else {
      await expect(page.locator("#validation-result")).not.toHaveClass(/invalid/);
      await expect(page.locator(scenario.source === "graph" ? "#dag svg[data-graph-topology]" : "#dag canvas").first()).toBeVisible();
    }
    if (!scenario.definitionOnly && scenario.source !== "agent") {
      await expect(page.locator("#render-status")).toHaveText(scenario.capture === "partial" ? "运行已结束 · 采集不完整" : statusLabels[scenario.outcome]);
    }
    if (scenario.source !== "agent") await openDetails(page);
    const pathOverview = await page.locator(scenario.source === "agent" ? ":is(#domain-view, .eino-agent-reader [data-agent-trajectory])" : ":is(#node-detail, .eino-agent-reader [data-step-detail])").innerText();
    if (scenario.source === "agent") {
      await expect(page.locator("[data-replay-controls], [data-replay-action]")).toHaveCount(0);
      await page.locator(".trajectory-record").first().click();
      const inputIndex = record.evidence.findIndex(({ kind, payload }) => kind === "schema.message" && payload.role === "user");
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(record.evidence[inputIndex].payload.content);
      const selected = await expectSelectedEvidence(page, inputIndex, record.evidence[inputIndex]);
      expect(selected.payload.role).toBe("user");
      await expect(page.locator("#raw-records-tab")).toBeHidden();
    }
    const observation = await page.evaluate(() => ({
      completion: window.playground.projection.document.completion,
      executionNodes: window.playground.executionDAG?.nodes.map(({ id, status }) => ({ id, status })),
      trajectoryRecords: window.playground.trajectory?.records.map(({ id, status }) => ({ id, status })),
      statusText: document.querySelector("#render-status")?.textContent || window.playground.explanation.run.result.label,
      summaryText: document.querySelector("#render-summary")?.textContent || `${window.playground.trajectory.records.length} trajectory records`,
    }));
    const completion = scenario.definitionOnly ? { state: "unknown", basis: "legacy" }
      : { state: "ended", basis: "recorded", outcome: scenario.outcome, capture: scenario.capture };
    expect(observation.completion).toEqual(completion);
    mkdirSync(output, { recursive: true });
    writeFileSync(`${output}browser-${scenario.id}-${testInfo.project.name}.json`, `${JSON.stringify({ ...observation, pathOverview }, null, 2)}\n`);
    if (testInfo.project.name === "chromium" && ["agent-cancelled", "agent-tool-interrupted", "agent-redacted-tool", "workflow-failed-successor", "workflow-nested-names"].includes(scenario.id)) {
      await page.screenshot({ path: `${output}${scenario.id}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

async function openMatrixRecord(page, id) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const record = JSON.parse(readFileSync(new URL(`${id}.json`, base), "utf8"));
  await page.setViewportSize({ width: 1560, height: 980 });
  await page.goto(playgroundPath);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => window.playground?.ready);
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document?.runId)).toBe(record.runId);
  if (record.source === "agent") await expectAgentTrajectory(page);
  else await expect(page.locator(record.source === "graph" ? "#dag svg[data-graph-topology]" : "#dag canvas").first()).toBeVisible();
  if (record.source !== "agent") await openDetails(page);
  return { record, errors };
}

function pathStep(page, id) {
  return page.locator(`#inspection-results [data-inspection-node=${JSON.stringify(id)}]`);
}

function trajectoryStep(page, id) {
  return page.locator(`[data-trajectory-record=${JSON.stringify(id)}]`);
}

async function openEvidence(page, index, expected) {
  if (await page.evaluate(() => window.playground.objectKind !== "workflow")) {
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure, :is(#node-detail, .eino-agent-reader [data-step-detail]) button[data-envelope-index]")).toHaveCount(0);
    await expect(page.locator("#snapshot-json")).toBeHidden();
    return expectSelectedEvidence(page, index, expected);
  }
  const disclosure = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure").first();
  if (await disclosure.getAttribute("open") === null) await disclosure.locator("summary").first().click();
  const evidenceSelector = `[data-envelope-index="${index}"]`;
  const action = page.locator(`:is(#node-detail, .eino-agent-reader [data-step-detail]) ${evidenceSelector}`);
  const card = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .evidence-card").filter({ has: page.locator(evidenceSelector) });
  if (await card.getAttribute("open") === null) await card.locator("summary").first().click();
  await action.click();
  await expect(page.locator("#snapshot-json")).toBeVisible();
  const selected = await page.locator("#snapshot-json").evaluate((editor) => ({
    index: Number(editor.dataset.selectedEnvelopeIndex),
    envelope: JSON.parse(editor.value.slice(editor.selectionStart, editor.selectionEnd)),
  }));
  expect(selected).toEqual({ index, envelope: expected });
  return selected.envelope;
}

test("Workflow failure displays only observed steps and preserves the declared successor in Raw", { tag: "@P0" }, async ({ page }) => {
  const { record, errors } = await openMatrixRecord(page, "workflow-failed-successor");
  const state = await page.evaluate(() => ({
    nodes: window.playground.executionDAG.nodes,
    renderedIds: window.playground.snapshot.workflow.nodes.map(({ id }) => id),
  }));
  expect(state.nodes).toHaveLength(2);
  expect(state.nodes.map(({ metadata, status }) => ({ path: metadata.sourceNodePath, status })))
    .toEqual(expect.arrayContaining([
      { path: ["prepare"], status: "success" },
      { path: ["fail"], status: "failed" },
    ]));
  expect(state.renderedIds.sort()).toEqual(state.nodes.map(({ id }) => id).sort());
  await openStepSearch(page);
  await expect(page.locator("#inspection-results [data-inspection-node]")).toHaveCount(2);
  await expect(page.locator("#inspection-results [data-inspection-node] strong")).toHaveText(["prepare", "fail"]);
  await expect(page.locator("#render-status")).toHaveText("运行失败");
  await expect(page.locator("#render-summary")).toContainText("2");
  const prepare = state.nodes.find(({ metadata }) => metadata.sourceNodePath[0] === "prepare");
  const failed = state.nodes.find(({ metadata }) => metadata.sourceNodePath[0] === "fail");
  await expect(pathStep(page, prepare.id)).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe(prepare.id);
  await expect(pathStep(page, prepare.id)).toContainText("成功");
  await expect(pathStep(page, failed.id)).toContainText("失败");
  // The saved scope name and technical declaration legitimately contain
  // "after"; only executed step identities and their business values exclude it.
  await expect(page.locator('#inspection-results [data-inspection-node="after"]')).toHaveCount(0);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .node-detail-hero h3")).toHaveText("prepare");
  await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="input"] .business-value-text')).toHaveText("request");
  await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="output"] .business-value-text')).toHaveText("request/prepared");
  await pathStep(page, failed.id).click();
  await expect(pathStep(page, failed.id)).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe(failed.id);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("失败");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("matrix planned validation failure");
  const snapshotIndex = record.evidence.findIndex(({ kind }) => kind === "workflow.snapshot");
  const raw = await openEvidence(page, snapshotIndex, record.evidence[snapshotIndex]);
  expect(raw.payload.workflow.nodes.some(({ id }) => id === "after")).toBe(true);
  expect(raw.payload.execution.nodes.some(({ path }) => path.includes("after"))).toBe(false);
  expect(raw.payload.execution.nodes.find(({ path }) => path[0] === "fail").errorMessage)
    .toBe("matrix planned validation failure");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  expect(errors).toEqual([]);
});

test("Agent cancellation keeps an unexecuted plan separate from the run cancellation in summary and trajectory", { tag: "@P0" }, async ({ page }) => {
  const { record, errors } = await openMatrixRecord(page, "agent-cancelled");
  const cancellationIndex = record.evidence.findIndex(({ kind, payload }) => kind === "agent.event" && payload.error);
  const cancellationMessage = record.evidence[cancellationIndex].payload.error.message;
  const planIndex = record.evidence.findIndex(({ kind, payload }) => kind === "agent.event" && payload.output?.message?.value?.tool_calls?.length);
  const state = await page.evaluate(() => ({
    path: window.playground.executionDAG.nodes,
    trajectory: window.playground.trajectory.records,
  }));
  const pathTool = state.path.find(({ kind }) => kind === "tool");
  const trajectoryTool = state.trajectory.find(({ kind }) => kind === "tool");
  for (const tool of [pathTool, trajectoryTool]) {
    expect(tool).toMatchObject({ status: "incomplete", metadata: { executionState: "planned" } });
    expect(tool.evidence.some(({ envelopeIndex }) => envelopeIndex === cancellationIndex)).toBe(false);
    expect(tool.error).toBeUndefined();
    expect(tool.errorMessage).toBeUndefined();
  }
  expect(state.path.some(({ kind, status }) => kind === "tool" && ["failed", "running"].includes(status))).toBe(false);
  expect(state.trajectory.some(({ kind, status }) => kind === "tool" && ["failed", "running"].includes(status))).toBe(false);
  const pathError = state.path.find(({ kind }) => kind === "error");
  const trajectoryError = state.trajectory.find(({ kind }) => kind === "error");
  for (const error of [pathError, trajectoryError]) {
    expect(error).toMatchObject({ status: "cancelled" });
    expect(error.evidence.some(({ envelopeIndex }) => envelopeIndex === cancellationIndex)).toBe(true);
  }
  await expect(page.locator('[data-agent-outcome="cancelled"]')).toHaveText("已取消");
  await expect(page.locator("#reading-sidebar, #inspection-search")).toHaveCount(0);
  const outcome = page.locator('[data-agent-outcome="cancelled"]');
  await expect(outcome).toContainText("已取消");
  await outcome.click();
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe(pathError.id);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(cancellationMessage);
  const planStep = page.locator(`[data-trajectory-step=${JSON.stringify(pathTool.id)}]`);
  await expect(planStep).toContainText("仅计划 · 未观察到执行");
  await selectAgentStep(page, pathTool.id);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .node-detail-content")).toHaveAttribute("data-execution-state", "planned");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("仅计划 · 未观察到执行");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).not.toContainText(cancellationMessage);
  await openEvidence(page, planIndex, record.evidence[planIndex]);
  await expect(trajectoryStep(page, trajectoryTool.id)).toHaveAttribute("data-execution-state", "planned");
  await expect(trajectoryStep(page, trajectoryTool.id)).toContainText("仅计划 · 未观察到执行");
  await expect(page.locator(".trajectory-record.running")).toHaveCount(0);
  await trajectoryStep(page, trajectoryError.id).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(cancellationMessage);
  await openEvidence(page, cancellationIndex, record.evidence[cancellationIndex]);
  expect(errors).toEqual([]);
});

test("Interrupted tool preserves its original approval reason in trajectory, details and source data", { tag: "@P0" }, async ({ page }) => {
  const { record, errors } = await openMatrixRecord(page, "agent-tool-interrupted");
  const interruptionIndex = record.evidence.findIndex(({ kind, payload }) => kind === "agent.event" && payload.action?.interrupted);
  const reason = "approval required for booking";
  const state = await page.evaluate(() => ({
    path: window.playground.executionDAG.nodes,
    trajectory: window.playground.trajectory.records,
  }));
  const pathTool = state.path.find(({ kind }) => kind === "tool");
  const trajectoryTool = state.trajectory.find(({ kind }) => kind === "tool");
  for (const tool of [pathTool, trajectoryTool]) {
    expect(tool).toMatchObject({ status: "incomplete", metadata: { executionState: "interrupted", interruptionReason: reason } });
    expect(tool.evidence.some(({ envelopeIndex }) => envelopeIndex === interruptionIndex)).toBe(true);
    expect(tool.error).toBeUndefined();
    expect(tool.errorMessage).toBeUndefined();
  }
  expect(state.path.some(({ status }) => status === "running")).toBe(false);
  expect(state.trajectory.some(({ status }) => status === "running")).toBe(false);
  const step = page.locator(`[data-trajectory-step=${JSON.stringify(pathTool.id)}]`);
  await expect(step).toContainText("已中断");
  await selectAgentStep(page, pathTool.id);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .node-detail-content")).toHaveAttribute("data-execution-state", "interrupted");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("已中断");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(reason);
  const raw = await openEvidence(page, interruptionIndex, record.evidence[interruptionIndex]);
  expect(raw.payload.action.interrupted.contexts.some(({ info }) => info === reason)).toBe(true);
  await expect(trajectoryStep(page, trajectoryTool.id)).toHaveAttribute("data-execution-state", "interrupted");
  await expect(trajectoryStep(page, trajectoryTool.id)).toContainText("已中断");
  await expect(trajectoryStep(page, trajectoryTool.id)).toContainText(reason);
  await trajectoryStep(page, trajectoryTool.id).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("已中断");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(reason);
  await openEvidence(page, interruptionIndex, record.evidence[interruptionIndex]);
  expect(errors).toEqual([]);
});
