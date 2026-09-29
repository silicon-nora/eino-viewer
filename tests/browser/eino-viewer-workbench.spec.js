import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { validateEinoRunRecord } from "../../src/run-record.js";
import { runCompletion } from "../../src/run-lifecycle.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { editCopy, openSample, openWorkbenchRecord, expectAgentTrajectory, openRecordActions, openRunInformation, openDetails, openStepSearch, selectAgentStep, expectSelectedEvidence } from "../helpers/workbench-ui.js";

function fixtureRecord(name) {
  return JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
}

async function expectTrajectoryCardHierarchy(page, records, depths, step) {
  const geometry = await page.locator("[data-trajectory-record]").evaluateAll((buttons) => buttons.map((button) => {
    const item = button.closest("li"), list = item.parentElement.getBoundingClientRect();
    const card = item.getBoundingClientRect(), heading = button.getBoundingClientRect();
    return { id: button.dataset.trajectoryRecord, parent: item.dataset.trajectoryParent,
      left: card.left - list.left, right: card.right - list.right, width: list.width,
      headingLeft: heading.left - card.left, headingRight: heading.right - card.right };
  }));
  expect(geometry.map(({ id }) => id)).toEqual(records.map(({ id }) => id));
  const visibleIds = new Set(records.map(({ id }) => id));
  for (const [index, card] of geometry.entries()) {
    const record = records[index];
    expect(card.parent, `${record.id}: exact visible parent, not adjacent step or Agent name`)
      .toBe(visibleIds.has(record.parentId) ? record.parentId : undefined);
    expect(card.left, `${record.id}: the actual card follows its confirmed parent chain`)
      .toBeCloseTo(Math.min(depths[index] * step, card.width * .3), 0);
    expect(Math.abs(card.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.headingLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.headingRight)).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function expectSingaporeTrajectoryValues(page) {
  const record = fixtureRecord("eino-agent-recorder-trip-planner-completed-v1.json");
  const output = record.evidence.find((entry) => entry.kind === "agent.event"
    && entry.payload.output?.message?.value?.tool_call_id === "call-weather-singapore").payload.output.message.value.content;
  const input = record.evidence.find((entry) => entry.kind === "component.io" && entry.payload.direction === "input"
    && entry.payload.component === "Tool" && entry.payload.address.some(({ subId }) => subId === "call-weather-singapore")).payload.body.argumentsJson;
  const value = (label) => page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value")
    .filter({ has: page.locator("small", { hasText: new RegExp(`^${label}$`) }) }).locator(".business-value-text");
  await expect(value("输出")).toHaveText(output);
  await expect(value("输入")).toHaveCount(1);
  expect(JSON.parse(await value("输入").textContent())).toEqual(JSON.parse(input));
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value > small")).toHaveText(["输入", "输出"]);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value .run-copy-value")).toHaveCount(0);
}

const importRecord = openWorkbenchRecord;

async function expectRepeatedCanvasSelection(page, node) {
  const detail = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])");
  const heading = await detail.locator(".node-detail-hero h3").textContent();
  const values = await detail.locator("[data-business-channel] .business-value-text").allTextContents();
  const host = page.locator("#dag");
  await host.focus();
  await host.press("Home");
  let reached = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    reached = await host.evaluate((element, id) => {
      const cy = [element, ...element.querySelectorAll("*")].map((item) => item._cyreg?.cy).find(Boolean);
      const focused = cy?.nodes(".keyboard-focus").first();
      return (focused?.data("path")?.at(-1) || focused?.id()) === id;
    }, node.id);
    if (reached) break;
    await host.press("ArrowRight");
  }
  expect(reached).toBe(true);
  for (let activation = 0; activation < 2; activation += 1) {
    await host.press("Enter");
    expect(await page.evaluate(() => window.playground.selectedNodeDetail?.executionNode)).toEqual(node);
    await expect(detail).toBeVisible();
    await expect(detail.locator(".node-detail-hero h3")).toHaveText(heading);
    expect(await detail.locator("[data-business-channel] .business-value-text").allTextContents()).toEqual(values);
    await expect(page.locator(`[data-inspection-node=${JSON.stringify(node.id)}]`)).toHaveAttribute("aria-current", "true");
  }
}

function recordedLifecycle(record, outcome = "success", capture = "complete") {
  const copy = structuredClone(record);
  const envelope = (payload) => ({
    protocol: "eino-dag", protocolVersion: 1, kind: "run.lifecycle", kindVersion: 1,
    correlation: { runId: copy.runId }, payload,
  });
  copy.evidence = [envelope({ state: "started" }), ...copy.evidence,
    envelope({ state: "ended", outcome, capture })];
  return copy;
}

const runtimeErrors = new WeakMap();
const playgroundPath = process.env.EINO_VIEWER_PLAYGROUND_PATH ?? "/.artifacts/pages/?lang=zh";

test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.setViewportSize({ width: 1560, height: 980 });
  await page.goto(playgroundPath);
  await page.waitForFunction(() => window.playground?.ready);
  await openSample(page);
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});

test("the workbench exposes only Agent, Graph, and Workflow as primary objects", { tag: "@P1" }, async ({ page }) => {
  await expect(page.locator("#record-kind")).toHaveText("Agent");
  await expect(page.locator("#record-kind")).not.toHaveRole("button");
  await expect(page.locator("#viewer-kind, #record-picker, #record-file, #import-record, #record-drop-zone, #open-examples, #example-picker")).toHaveCount(0);
  await expect(page.locator("#test-mode")).toBeHidden();
  await expect(page.locator("#domain-field")).toBeHidden();
  await expect(page.locator(".coverage")).toBeHidden();
  await expect(page.locator("#view-select")).toBeHidden();
  await expect(page.locator("#sample")).toBeVisible();
  await expect(page.locator("#sample")).toHaveAccessibleName("更换记录");
  await expect(page.locator('#sample option:not([value=""])')).toHaveText(["多城市出行 Agent", "父子 Agent 协作", "后期失败的出行 Agent", "未完成的 Agent 运行"]);
  await expect(page.locator("#sample-title")).toHaveText("多城市出行 Agent");
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  await expect(page.locator("#close-details")).toHaveCount(0);
  const firstRecord = buildExecutionTrajectory(fixtureRecord("eino-agent-recorder-trip-planner-completed-v1.json").evidence).trajectory.records[0];
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord)).toEqual(firstRecord);
  await expect(page.locator("[data-trajectory-record]").first()).toHaveAttribute("data-trajectory-record", firstRecord.id);
  await expect(page.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).toHaveText("用户输入");
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
  await openRunInformation(page);
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
  await expect(page.locator("#record-opening")).toBeHidden();
  const rootOutput = await page.evaluate(() => window.playground.explanation.run.output.items[0].value);
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]')).toContainText(rootOutput);

  await openSample(page, "agent", "agent-nested-distinct-results");
  const record = fixtureRecord("recorder-matrix/agent-nested-distinct-results.json");
  const trajectory = buildExecutionTrajectory(record.evidence).trajectory;
  expect(trajectory.records[3].parentId).toBe(trajectory.records[2].id);
  expect(trajectory.records[4].parentId).toBe(trajectory.records[3].id);
  expect(trajectory.records[4].toolCallId).toBe("shared-inner-call");
  for (const { width, height, step } of [{ width: 1280, height: 720, step: 28 }, { width: 390, height: 844, step: 12 }]) {
    await page.setViewportSize({ width, height });
    await expectTrajectoryCardHierarchy(page, trajectory.records, [0, 0, 1, 2, 3, 2, 0], step);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator("#sample-title")).toHaveText("父子 Agent 协作");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  const groups = await page.evaluate(() => window.playground.explanation.groups);
  const parent = groups.find(({ parentId }) => !parentId);
  const child = groups.find(({ parentId }) => parentId === parent.id);
  const path = `${parent.label} / ${child.label}`;
  const context = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context.agent-step-scope");
  await expect(page.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
  await expect(context.locator(".agent-scope-path")).toHaveText(parent.label);
  await expect(context.locator("[data-hierarchy-group]")).toHaveCount(0);
  await expect(context).not.toContainText("查看轨迹");
  const rows = page.locator(`.trajectory-turn[data-trajectory-scope=${JSON.stringify(child.id)}]`);
  await expect(rows.first().locator(".trajectory-scope")).toHaveText(path);
  await rows.locator("[data-trajectory-record]").first().click();
  await expect(context.locator("small")).toHaveText("Agent");
  await expect(context).toContainText(path);
  await expect(context).not.toContainText("当前步骤所属范围");
  const action = context.locator("[data-hierarchy-group]");
  await expect(action).toHaveCount(1);
  await expect(action).toHaveText(path);
  await expect(action).toHaveClass(/agent-scope-path/);
  await expect(context).not.toContainText("查看轨迹");
  await expect(action).toHaveAttribute("data-hierarchy-group", child.id);
  expect(await action.getAttribute("aria-label")).toContain(path);
  await action.click();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", child.id);
  expect(await page.locator(".trajectory-turn").evaluateAll((turns) => [...new Set(turns.map((turn) => turn.dataset.trajectoryScope))])).toEqual([child.id]);
  await expect(context.locator(".agent-scope-path")).toHaveText(path);
  await expect(action).toHaveCount(0);
  const childRecords = trajectory.records.filter(({ metadata }) => metadata.agentScopeId === child.id);
  await expectTrajectoryCardHierarchy(page, childRecords, [0, 1, 0], 28);
  const scopedSelection = await page.evaluate(() => ({ scope: window.playground.inspectionScope,
    selection: window.playground.linkedSelection, detail: window.playground.selectedNodeDetail.trajectoryRecord }));
  await page.locator('[data-language="en"]').click();
  await expect(context.locator(".agent-scope-path")).toHaveText(path);
  await expect(action).toHaveCount(0);
  await expect(context).not.toContainText("View trajectory");
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", child.id);
  expect(await page.evaluate(() => ({ scope: window.playground.inspectionScope,
    selection: window.playground.linkedSelection, detail: window.playground.selectedNodeDetail.trajectoryRecord }))).toEqual(scopedSelection);
  await expectTrajectoryCardHierarchy(page, childRecords, [0, 1, 0], 28);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await page.locator(`:is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=${JSON.stringify(parent.id)}]`).click();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", parent.id);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  expect(await page.evaluate(() => window.playground.inspectionScope)).toEqual({ groupId: undefined, ungroupedOnly: false });
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await expectTrajectoryCardHierarchy(page, trajectory.records, [0, 0, 1, 2, 3, 2, 0], 28);
  await page.setViewportSize({ width: 390, height: 844 });
  await rows.locator("[data-trajectory-record]").first().click();
  await context.locator("[data-hierarchy-group]").click();
  await expectTrajectoryCardHierarchy(page, childRecords, [0, 1, 0], 12);
  const tool = page.locator(`[data-trajectory-record=${JSON.stringify(trajectory.records[4].id)}]`);
  await tool.click();
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord)).toEqual(trajectory.records[4]);
  const sourceIndex = record.evidence.findIndex(({ kind, payload }) => kind === "component.io" && payload.component === "Tool"
    && payload.direction === "output" && payload.body.response === "lookup:single");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(record.evidence[sourceIndex].payload.body.response);
  await expectSelectedEvidence(page, sourceIndex, record.evidence[sourceIndex]);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  await expectTrajectoryCardHierarchy(page, trajectory.records, [0, 0, 1, 2, 3, 2, 0], 12);
  expect(await page.evaluate(() => window.playground.trajectory)).toEqual(trajectory);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("Agent displays a production-shaped multi-turn Eino Runner trace", { tag: "@P0" }, async ({ page }) => {
  await expect(page.locator("#record-kind")).toHaveText("Agent");
  await expect(page.locator("#sample")).toHaveValue("agent-weather-workflow");
  await expectAgentTrajectory(page);
  await expect(page.locator('.eino-agent-reader[data-eino-run-viewer="agent"]')).toBeVisible();
  expect(await page.evaluate(() => window.playground.document.evidence.length)).toBe(22);
  expect(await page.evaluate(() => ({
    objectKind: window.playground.objectKind,
    sourceCount: window.playground.document.evidence.length,
    nodes: window.playground.executionDAG.nodes.map((node) => node.kind),
    labels: window.playground.executionDAG.nodes.map((node) => node.label),
    edges: window.playground.executionDAG.edges.map((edge) => edge.kind),
  }))).toEqual({
    objectKind: "agent",
    sourceCount: 22,
    nodes: ["input", "tool", "tool", "tool", "output"],
    labels: [
      "schema.message · user",
      "tool · get_weather",
      "tool · get_weather",
      "tool · get_air_quality",
      "schema.message · assistant",
    ],
    edges: ["tool-call", "tool-call", "tool-call", "tool-call", "data"],
  });
  const viewerModuleURLs = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => url.includes("/eino-viewer/")));
  if (!playgroundPath.startsWith("/site/")) expect(viewerModuleURLs.some((url) => /\/eino-viewer\/[a-f0-9]{12}\/eino-viewer\.js\?v=[a-f0-9]{12}$/.test(url))).toBe(true);

  await expect(page.locator("#reading-sidebar, #inspection-search, #hierarchy-directory, [data-inspection-node]")).toHaveCount(0);
  const steps = page.locator("[data-trajectory-step]");
  await expect(steps.locator("strong")).toHaveText(["用户输入", "get_weather", "get_weather", "get_air_quality", "助手输出"]);
  for (const [id, value] of [["input:user:1", "比较新加坡和东京"], ["tool:get_weather:call-weather-singapore", /"condition":\s*"thunderstorms"/], ["tool:get_weather:call-weather-tokyo", /"condition":\s*"clear"/], ["tool:get_air_quality:call-air-quality-tokyo", /"aqi":\s*42/]]) {
    await selectAgentStep(page, id);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(value);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure, :is(#node-detail, .eino-agent-reader [data-step-detail]) button[data-envelope-index], :is(#node-detail, .eino-agent-reader [data-step-detail]) [data-step-identity]")).toHaveCount(0);
  }
  const text = await page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])").innerText();
  expect(text).not.toMatch(/运行成功|收到用户输入|Agent 判断|Agent 汇总|最终回答|decision|summary|final answer|因而|causal|correlation|metadata/i);
});

test("Agent opens its real turns directly without a second path view", { tag: "@P0" }, async ({ page }) => {
  await expectAgentTrajectory(page);
  await expect(page.locator("#dag")).toBeHidden();
  await expect(page.locator(".trajectory-turn > h3")).toHaveText(["第 1 回合", "第 2 回合", "第 3 回合"]);
  await expect(page.locator(".trajectory-record")).toHaveCount(7);
  await expect(page.locator(".trajectory-record .trajectory-identity strong")).toHaveText([
    "用户输入",
    "助手消息",
    "get_weather",
    "get_weather",
    "助手消息",
    "get_air_quality",
    "助手输出",
  ]);
  await expect(page.locator(".trajectory-record").nth(1)).toContainText("get_weather × 2");
  await page.locator(".trajectory-record").nth(2).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).toHaveText("get_weather");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.toolCallId)).toBe("call-weather-singapore");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context")).toHaveCount(0);
  await expectSingaporeTrajectoryValues(page);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("thunderstorms");
  expect(await page.evaluate(() => ({
    view: window.playground.runView,
    status: window.playground.trajectory.status,
    evidence: window.playground.trajectory.metadata.representedEvidenceCount,
  }))).toEqual({ view: "trajectory", status: "success", evidence: 20 });

  await openSample(page, "agent", "agent-weather-failure");
  await expect(page.locator(".trajectory-record")).toHaveCount(6);
  await expect(page.locator(".trajectory-record.failed")).toHaveCount(1);
  await expect(page.locator(".trajectory-record.failed")).toContainText("get_air_quality");
  await expect(page.locator(".trajectory-record.failed")).toContainText("air quality provider timed out");
  await expect(page.locator(".trajectory-record.failed .trajectory-status")).toBeVisible();
  await expect(page.locator("#record-actions, [data-replay-controls]")).toHaveCount(0);
  await expect(page.locator("#record-picker")).toHaveCount(0);
  await expect(page.locator("#sample")).toHaveValue("agent-weather-failure");
  const failureAction = page.locator("[data-agent-outcome]");
  await expect(failureAction).toBeVisible();
  await failureAction.click();
  expect(await page.evaluate(() => window.playground.linkedSelection.executionNodeId)).toBe("tool:get_air_quality:call-air-quality-tokyo");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("air quality provider timed out");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("Tokyo");
  await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
  await page.keyboard.press("Escape");
  await expect(failureAction).toBeFocused();

  await expectAgentTrajectory(page);
});


test("canonical steps and trajectory stay linked to exact source evidence without technical UI", { tag: "@P0" }, async ({ page }) => {
  const record = fixtureRecord("eino-agent-recorder-trip-planner-completed-v1.json");
  const nodeId = "tool:get_weather:call-weather-singapore";
  const canonical = projectEinoViewerDocument(record).document.execution.nodes.find(({ id }) => id === nodeId);
  const canonicalIndexes = canonical.evidence.map(({ envelopeIndex }) => envelopeIndex).sort((a, b) => a - b);
  expect(canonicalIndexes).toEqual([2, 3, 4, 5, 6, 8]);
  expect(await page.evaluate((id) => window.playground.executionDAG.nodes.find((node) => node.id === id), nodeId)).toEqual(canonical);
  expect(await page.evaluate((indexes) => indexes.map((index) => window.playground.document.evidence[index]), canonicalIndexes))
    .toEqual(canonicalIndexes.map((index) => record.evidence[index]));
  const trajectory = buildExecutionTrajectory(record.evidence).trajectory;
  // The canonical step still owns all six source envelopes and relates to the
  // same three rows. Selecting a trajectory row uses that row's own evidence,
  // not an expanded canonical selection manufactured by a removed directory.
  const canonicalLinked = trajectory.records.filter(({ evidence }) => evidence.some(({ envelopeIndex }) => canonicalIndexes.includes(envelopeIndex)));
  expect(canonicalLinked).toHaveLength(3);
  for (const linked of canonicalLinked) await expect(page.locator(`[data-trajectory-record=${JSON.stringify(linked.id)}]`)).toBeVisible();
  const tool = trajectory.records.find(({ toolCallId }) => toolCallId === "call-weather-singapore");
  const selectedIndexes = tool.evidence.map(({ envelopeIndex }) => envelopeIndex).sort((a, b) => a - b);
  await selectAgentStep(page, nodeId);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toMatchObject({
    evidenceIndexes: selectedIndexes,
    executionNodeId: nodeId,
    trajectoryRecordId: tool.id,
  });
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord)).toEqual(tool);
  for (const index of selectedIndexes) await expectSelectedEvidence(page, index, record.evidence[index]);
  expect(await page.locator(".trajectory-record.linked").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryRecord)))
    .toEqual(trajectory.records.filter(({ evidence }) => evidence.some(({ envelopeIndex }) => selectedIndexes.includes(envelopeIndex))).map(({ id }) => id));
  await expectSingaporeTrajectoryValues(page);

  await page.locator(".trajectory-record").nth(0).click();
  await expect(page.locator(".trajectory-record.selected")).toHaveCount(1);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toMatchObject({
    evidenceIndexes: [1],
    executionNodeId: "input:user:1",
    trajectoryRecordId: "user:evidence:1",
  });

  await expectAgentTrajectory(page);
  await expect(page.locator(".node-detail-hero h3")).toHaveText("用户输入");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .business-value-text").first()).toContainText("比较新加坡和东京");

  await expectSelectedEvidence(page, 1, record.evidence[1]);
  expect(record.evidence[1]).toHaveProperty("observedAtMs");
  await expect(page.locator("#open-raw")).toBeHidden();
  await expect(page.locator("#raw-records-tab")).toBeHidden();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure, :is(#node-detail, .eino-agent-reader [data-step-detail]) button[data-envelope-index], :is(#node-detail, .eino-agent-reader [data-step-detail]) [data-step-identity]")).toHaveCount(0);

  await page.locator(".trajectory-record").nth(2).click();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toMatchObject({
    trajectoryRecordId: "tool:call-weather-singapore",
    executionNodeId: "tool:get_weather:call-weather-singapore",
  });

  await openSample(page, "agent", "agent-weather-failure");
  const failureTrajectory = buildExecutionTrajectory(fixtureRecord("eino-agent-recorder-trip-planner-failure-completed-v1.json").evidence).trajectory;
  const first = failureTrajectory.records[0];
  const indexes = first.evidence.map(({ envelopeIndex }) => envelopeIndex).sort((a, b) => a - b);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual({
    evidenceIndexes: indexes,
    executionNodeId: "input:user:1",
    trajectoryRecordId: first.id,
    rawEnvelopeIndex: undefined,
  });
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord)).toEqual(first);
  await expect(page.locator(".trajectory-record").first()).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".trajectory-record.linked").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryRecord)))
    .toEqual(failureTrajectory.records.filter(({ evidence }) => evidence.some(({ envelopeIndex }) => indexes.includes(envelopeIndex))).map(({ id }) => id));
});

test("Raw edit copies recognize all three run sources without exposing a file picker", { tag: "@P1" }, async ({ page }) => {
  for (const [source, filename] of [
    ["workflow", "eino-workflow-recorder-weather-v1.json"],
    ["graph", "eino-graph-recorder-cyclic-v1.json"],
    ["agent", "eino-agent-recorder-trip-planner-v1.json"],
  ]) {
    const record = fixtureRecord(filename);
    await importRecord(page, record);
    await expect.poll(() => page.evaluate(() => window.playground.objectKind)).toBe(source);
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
    await expect(page.locator("#record-kind")).toHaveText({ agent: "Agent", graph: "Graph", workflow: "Workflow" }[source]);
    await expect(page.locator("#record-file, #import-record, #record-drop-zone")).toHaveCount(0);
    if (source === "agent") await expectAgentTrajectory(page);
    else await expect(page.locator("#dag canvas").first()).toBeVisible();
    if (source === "agent") {
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
      expect(await page.evaluate(() => window.playground.validation.kind)).not.toBe("invalid");
    } else await expect(page.locator("#validation-result")).not.toHaveClass(/invalid/);
  }
});

test("rejected example records and Raw drafts preserve the full valid document and linked selection", { tag: "@P0" }, async ({ page }) => {
  const accepted = fixtureRecord("eino-agent-recorder-trip-planner-completed-v1.json");
  const wrongSource = structuredClone(accepted);
  wrongSource.source = "not-a-source";
  const wrongRun = structuredClone(accepted);
  wrongRun.runId = "different-run";
  const invalidEvidence = structuredClone(accepted);
  invalidEvidence.evidence[0].protocol = "invalid";
  const wrongVersion = { ...accepted, schemaVersion: 999 };
  const sampleResource = /\/fixtures\/eino-agent-recorder-trip-planner-failure-completed-v1\.json(?:\?|$)/;
  for (const [candidate, code] of [
    [wrongSource, "run_record.invalid_source"],
    [wrongRun, "run_record.mismatched_run_id"],
    [invalidEvidence, "envelope.invalid_protocol"],
    [wrongVersion, "run_record.invalid_schema_version"],
  ]) {
    // Catalog resources are fetched once at startup. Establish a genuine
    // accepted Agent on this page, then reject another visible example choice.
    await page.route(sampleResource, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(candidate) }));
    await page.goto(playgroundPath);
    await page.waitForFunction(() => window.playground?.ready);
    await openSample(page);
    await page.locator(".trajectory-record").nth(2).click();
    const before = await page.evaluate(() => ({ document: window.playground.document,
      selection: window.playground.linkedSelection, trajectory: window.playground.trajectory }));
    expect(before.document).toEqual(accepted);
    await page.locator("#sample").selectOption("agent-weather-failure");
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
    await expect(page.locator("#import-status")).toBeVisible();
    expect(await page.evaluate(() => window.playground.diagnostics.map(({ code }) => code))).toContain(code);
    expect(await page.evaluate(() => ({
      document: window.playground.document,
      selection: window.playground.linkedSelection,
      trajectory: window.playground.trajectory,
    }))).toEqual(before);
    await expect(page.locator("#sample")).toHaveValue("agent-weather-workflow");
    await page.unroute(sampleResource);
  }
  await openSample(page, "workflow");
  await openStepSearch(page);
  await page.locator("[data-inspection-node]").first().click();
  const selectedStep = await page.evaluate(() => ({ selection: window.playground.linkedSelection,
    firstEnvelopeIndex: window.playground.selectedNodeDetail.evidence[0].envelopeIndex }));
  await openRecordActions(page);
  await page.locator("#open-raw").click();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual({
    ...selectedStep.selection, rawEnvelopeIndex: selectedStep.firstEnvelopeIndex,
  });
  const rawSelection = await page.evaluate(() => {
    const editor = document.querySelector("#snapshot-json");
    return { text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
      envelope: window.playground.document.evidence[window.playground.linkedSelection.rawEnvelopeIndex] };
  });
  expect(JSON.parse(rawSelection.text)).toEqual(rawSelection.envelope);
  await editCopy(page);
  const before = await page.evaluate(() => ({ document: window.playground.document, selection: window.playground.linkedSelection }));
  await page.locator("#snapshot-json").fill('{"broken":');
  await page.locator("#apply-json").click();
  await expect(page.locator("#validation-result")).toHaveClass(/invalid/);
  await expect(page.locator("#issue-list")).toContainText("invalid_json");
  expect(await page.evaluate(() => window.playground.document)).toEqual(before.document);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(before.selection);
  await expect(page.locator("#snapshot-json")).toHaveValue('{"broken":');
});

test("Workflow Raw links select complete envelopes in compact JSON with repeated timestamps", { tag: "@P0" }, async ({ page }) => {
  const record = fixtureRecord("eino-workflow-recorder-weather-completed-v1.json");
  // Callbacks require their envelope and payload clocks to agree. Keep
  // that protocol invariant while deliberately repeating every timestamp.
  for (const envelope of record.evidence) {
    envelope.observedAtMs = 42;
    if (envelope.kind === "callback.event") envelope.payload.timestampMs = 42;
  }
  record.metadata = { note: 'nested "kind" and escaped \\" braces } [', nested: { observedAtMs: 42, kind: "schema.message" } };
  expect(projectEinoViewerDocument(structuredClone(record)).ok).toBe(true);
  await importRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
  await expect.poll(() => page.evaluate(() => window.playground.objectKind)).toBe("workflow");
  await openRecordActions(page);
  await page.locator("#open-raw").click();
  await editCopy(page);
  await page.locator("#snapshot-json").fill(JSON.stringify(record));
  await page.locator("#apply-json").click();
  await expect(page.locator("#validation-result")).not.toHaveClass(/invalid/);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await openStepSearch(page);
  await page.locator("[data-inspection-node]").nth(1).click();
  await openRecordActions(page);
  await page.locator("#open-raw").click();
  const selected = await page.evaluate(() => {
    const editor = document.querySelector("#snapshot-json");
    return {
      index: window.playground.linkedSelection.rawEnvelopeIndex,
      text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
    };
  });
  expect(Number.isInteger(selected.index)).toBe(true);
  expect(JSON.parse(selected.text)).toEqual(record.evidence[selected.index]);
  const draft = '{"unapplied":';
  await editCopy(page);
  await page.locator("#snapshot-json").fill(draft);
  await page.locator("[data-inspection-node]").nth(2).click();
  await openRecordActions(page);
  await page.locator("#open-raw").click();
  await expect(page.locator("#restore-draft")).toBeVisible();
  expect(await page.locator("#snapshot-json").inputValue()).toBe(JSON.stringify(record));
  await page.locator("#restore-draft").click();
  await expect(page.locator("#snapshot-json")).toHaveValue(draft);
});


test("recorded termination stays independent from capture and lifecycle-only examples preserve accepted execution", { tag: "@P0" }, async ({ page }) => {
  const legacy = fixtureRecord("eino-agent-recorder-trip-planner-v1.json");
  await importRecord(page, legacy);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(legacy);
  expect(await page.evaluate(() => window.playground.trajectory.completion)).toMatchObject({ state: "unknown", basis: "legacy" });

  const open = recordedLifecycle(legacy);
  open.evidence.pop();
  await importRecord(page, open);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(open);
  expect(await page.evaluate(() => window.playground.trajectory.status)).toBe("running");

  const partial = recordedLifecycle(legacy, "success", "partial");
  await importRecord(page, partial);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(partial);
  await expect(page.locator("[data-agent-capture]")).toBeVisible();
  expect(await page.evaluate(() => window.playground.trajectory.completion)).toMatchObject({ state: "ended", capture: "partial" });
  await expect(page.locator("[data-agent-capture]")).toHaveAttribute("data-agent-capture", "partial");
  expect(await page.evaluate(() => window.playground.explanation.run.capture.status)).toBe("partial");
  // A valid lifecycle fact alone is not a renderable Agent execution under the
  // existing public projection contract. Rejection must retain real UI state.
  const lifecycleOnly = recordedLifecycle({ schemaVersion: 1, runId: "ui-lifecycle-only", source: "agent", evidence: [] });
  lifecycleOnly.evidence.shift();
  expect(validateEinoRunRecord(lifecycleOnly).valid).toBe(true);
  expect(runCompletion(lifecycleOnly.evidence)).toEqual({ state: "ended", basis: "recorded", outcome: "success", capture: "complete" });
  const projected = projectEinoViewerDocument(structuredClone(lifecycleOnly));
  expect(projected.ok).toBe(false);
  expect(projected.diagnostics.map(({ code }) => code)).toContain("viewer.missing_execution");
  await page.route(/\/fixtures\/eino-agent-recorder-trip-planner-completed-v1\.json(?:\?|$)/,
    (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(partial) }));
  await page.route(/\/fixtures\/eino-agent-recorder-trip-planner-failure-completed-v1\.json(?:\?|$)/,
    (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(lifecycleOnly) }));
  await page.goto(playgroundPath);
  await page.waitForFunction(() => window.playground?.ready);
  await page.locator('[data-open-example="agent-weather-workflow"]').click();
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(partial);
  await page.locator("[data-trajectory-record]").nth(2).click();
  const before = await page.evaluate(() => ({ document: window.playground.document,
    selection: window.playground.linkedSelection, trajectory: window.playground.trajectory,
    execution: window.playground.executionDAG }));
  await page.locator("#sample").selectOption("agent-weather-failure");
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  expect(await page.evaluate(() => window.playground.diagnostics.map(({ code }) => code))).toContain("viewer.missing_execution");
  expect(await page.evaluate(() => ({ document: window.playground.document,
    selection: window.playground.linkedSelection, trajectory: window.playground.trajectory,
    execution: window.playground.executionDAG }))).toEqual(before);
  expect(await page.locator("[data-trajectory-record]").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryRecord)))
    .toEqual(before.trajectory.records.map(({ id }) => id));
  await expect(page.locator(`[data-trajectory-record=${JSON.stringify(before.selection.trajectoryRecordId)}]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sample")).toHaveValue("agent-weather-workflow");
  await expect(page.locator("[data-replay-controls], [data-replay-action]")).toHaveCount(0);
});

test("failed and incomplete Agent records stay truthful without invented output", { tag: "@P0" }, async ({ page }) => {
  await selectAgentStep(page, "tool:get_weather:call-weather-singapore");
  expect(await page.evaluate(() => window.playground.linkedSelection.executionNodeId)).toBe("tool:get_weather:call-weather-singapore");
  await openSample(page, "agent", "agent-weather-failure");
  const failure = fixtureRecord("eino-agent-recorder-trip-planner-failure-completed-v1.json");
  const first = buildExecutionTrajectory(failure.evidence).trajectory.records[0];
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual({
    evidenceIndexes: first.evidence.map(({ envelopeIndex }) => envelopeIndex).sort((a, b) => a - b),
    executionNodeId: "input:user:1",
    trajectoryRecordId: first.id,
    rawEnvelopeIndex: undefined,
  });
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord)).toEqual(first);
  await expect(page.locator("[data-trajectory-record]").first()).toHaveAttribute("data-trajectory-record", first.id);
  await expect(page.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
  await expectAgentTrajectory(page);
  await expect(page.locator("[data-agent-outcome]")).toHaveText("执行失败");
  await expect(page.locator("[data-trajectory-step] strong")).toHaveText([
    "用户输入", "get_weather", "get_weather", "get_air_quality",
  ]);
  for (const [id, value] of [["tool:get_weather:call-weather-singapore", /"condition":\s*"thunderstorms"/], ["tool:get_weather:call-weather-tokyo", /"condition":\s*"clear"/], ["tool:get_air_quality:call-air-quality-tokyo", "air quality provider timed out"]]) {
    await selectAgentStep(page, id);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText(value);
  }
  await expect(page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])")).not.toContainText("助手输出");
  expect(await page.evaluate(() => window.playground.trajectory.records.some(({ metadata }) => metadata?.publicOutput))).toBe(false);
  expect(await page.evaluate(() => window.playground.executionDAG.nodes.map((node) => [node.kind, node.status]))).toEqual([
    ["input", "success"], ["tool", "success"], ["tool", "success"], ["tool", "failed"],
  ]);

  await openSample(page, "agent", "agent-incomplete");
  expect(await page.evaluate(() => window.playground.trajectory.status)).toBe("running");
  await expect(page.locator("[data-agent-outcome]")).toBeVisible();
  await expect(page.locator("[data-agent-outcome]")).not.toContainText("成功");
  await expect(page.locator("[data-trajectory-record]")).toHaveCount(1);
  await expect(page.locator("[data-trajectory-record] strong")).toHaveText(["用户输入"]);
  await expect(page.locator("#reading-sidebar, #inspection-search, [data-inspection-node]")).toHaveCount(0);
});

test("Graph keeps its cyclic definition while showing repeated runtime visits", { tag: "@P0" }, async ({ page }) => {
  await openSample(page, "graph", "compose-cyclic-graph");
  expect(await page.evaluate(() => window.playground.document)).toEqual(fixtureRecord("eino-graph-recorder-cyclic-completed-v1.json"));
  await openDetails(page);
  await expect(page.locator("#record-kind")).toHaveText("Graph");
  await expect(page.locator("#sample")).toHaveValue("compose-cyclic-graph");
  await expect(page.locator("#signal-protocol")).toHaveText("GRAPH RUN");
  await expect(page.locator("#signal-kind")).toHaveText("9 条原始记录");
  await expect(page.locator("#dag canvas").first()).toBeVisible();
  await openStepSearch(page);
  await expect(page.locator("[data-inspection-node] strong")).toHaveText([
    "cyclic-agent-graph", "Model", "Model",
  ]);
  const first = projectEinoViewerDocument(fixtureRecord("eino-graph-recorder-cyclic-completed-v1.json")).document.execution.nodes[0];
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode)).toEqual(first);
  await expect(page.locator("[data-inspection-node]").first()).toHaveAttribute("data-inspection-node", first.id);
  await expect(page.locator("[data-inspection-node]").first()).toHaveAttribute("aria-current", "true");
  await expectRepeatedCanvasSelection(page, first);
  expect(await page.evaluate(() => {
    const projected = window.playground.projection.document;
    return {
      kind: projected.kind,
      branch: projected.definition.branches[0],
      visits: projected.execution.nodes.filter((node) => node.correlation.entityId?.endsWith("node:model")).length,
    };
  })).toEqual({
    kind: "graph",
    branch: { from: "model", targets: ["end", "model"] },
    visits: 2,
  });

  await page.locator("[data-inspection-node]").nth(1).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toBeVisible();
  await expect(page.locator(".node-detail-hero h3")).toHaveText("Model");
  await expect(page.locator(".technical-disclosure")).toHaveCount(0);
});

test("Workflow keeps the existing eino-workflow-dag rendering contract", { tag: "@P0" }, async ({ page }) => {
  await openSample(page, "workflow", "workflow-weather");
  expect(await page.evaluate(() => window.playground.document)).toEqual(fixtureRecord("eino-workflow-recorder-weather-completed-v1.json"));
  await openDetails(page);
  await expect(page.locator("#record-kind")).toHaveText("Workflow");
  await expect(page.locator("#sample")).toHaveValue("workflow-weather");
  await expect(page.locator("#sample-title")).toHaveText("天气 Workflow");
  await expect(page.locator("#dag canvas").first()).toBeVisible();
  await openStepSearch(page);
  await expect(page.locator("[data-inspection-node] strong")).toHaveText([
    "Parse city",
    "Get weather",
    "Build model context",
    "Generate answer",
  ]);
  const first = projectEinoViewerDocument(fixtureRecord("eino-workflow-recorder-weather-completed-v1.json")).document.execution.nodes.find(({ id }) => id === "parse-city");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode)).toEqual(first);
  await expect(page.locator("[data-inspection-node]").first()).toHaveAttribute("data-inspection-node", first.id);
  await expect(page.locator("[data-inspection-node]").first()).toHaveAttribute("aria-current", "true");
  await expectRepeatedCanvasSelection(page, first);
  expect(await page.evaluate(() => ({
    objectKind: window.playground.objectKind,
    sourceCount: window.playground.document.evidence.length,
    schemaVersion: window.playground.snapshot.schemaVersion,
    workflowName: window.playground.snapshot.workflow.name,
    nodeNames: window.playground.snapshot.workflow.nodes.map((node) => node.name),
    executionNodeIDs: window.playground.executionDAG.nodes.map((node) => node.id),
    evidenceCounts: window.playground.executionDAG.nodes.map((node) => node.evidence.length),
    input: window.playground.snapshot.metadata.input,
    output: window.playground.snapshot.metadata.output,
    hasUpdate: typeof window.playground.instance.update,
  }))).toEqual({
    objectKind: "workflow",
    sourceCount: 11,
    schemaVersion: 1,
    workflowName: "weather-query-workflow",
    nodeNames: ["Build model context", "Generate answer", "Get weather", "Parse city"],
    executionNodeIDs: ["build-context", "generate-answer", "get-weather", "parse-city"],
    evidenceCounts: [3, 3, 3, 3],
    input: "新加坡现在天气怎么样？",
    output: "新加坡当前晴，31°C，湿度 68%。适合出行，注意防晒。",
    hasUpdate: "function",
  });

  await page.locator("[data-inspection-node]").nth(1).click();
  await expect(page.locator(".node-detail-hero h3")).toHaveText("Get weather");
  await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="output"]')).toContainText('"Condition": "晴"');
  expect(await page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel]").evaluateAll((channels) => channels.map((channel) => channel.dataset.businessChannel))).toEqual(["input", "output"]);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel] .run-copy-value")).toHaveCount(0);
  await expect(page.locator(".business-content")).toContainText("输入");
  await expect(page.locator(".business-content")).toContainText("输出");
  await expect(page.locator(".business-content")).toContainText("新加坡");
  await expect(page.locator(".business-content")).toContainText('"Condition": "晴"');
  await expect(page.locator(".business-content")).toContainText('"TemperatureC": 31');
});

test("invalid cyclic Graph example replacements keep the last valid view", { tag: "@P0" }, async ({ page }) => {
  const invalid = fixtureRecord("eino-graph-recorder-cyclic-completed-v1.json");
  invalid.evidence[0].payload.edges[0].to = "missing";
  const resource = /\/fixtures\/recorder-matrix\/graph-multistep-loop-failed\.json(?:\?|$)/;
  await page.route(resource, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(invalid) }));
  await page.goto(playgroundPath);
  await page.waitForFunction(() => window.playground?.ready);
  await openSample(page, "graph", "compose-cyclic-graph");
  const before = await page.evaluate(() => {
    window.lastValidGraphCanvas = document.querySelector("#dag canvas");
    return { document: window.playground.document, dag: window.playground.executionDAG, selection: window.playground.linkedSelection };
  });
  await page.locator("#sample").selectOption("graph-multistep-loop-failed");
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("#import-status")).toBeVisible();
  expect(await page.evaluate(() => window.playground.diagnostics.map(({ code }) => code))).toContain("compose.unknown_edge_target");
  await expect(page.locator("#sample")).toHaveValue("compose-cyclic-graph");
  await expect(page.locator("#open-raw")).toBeHidden();
  // Rejected selection preserves the actual mounted graph and selected step.
  expect(await page.evaluate(() => document.querySelector("#dag canvas") === window.lastValidGraphCanvas)).toBe(true);
  expect(await page.evaluate(() => ({ document: window.playground.document, dag: window.playground.executionDAG, selection: window.playground.linkedSelection }))).toEqual(before);
  await page.unroute(resource);
});

test("the public viewer preserves valid state and has a final destroy lifecycle", { tag: "@P0" }, async ({ page }) => {
  await openSample(page, "graph", "compose-cyclic-graph");
  expect(await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:500px";
    document.body.append(host);
    const source = structuredClone(window.playground.document);
    const viewer = window.playground.einoAPI.createEinoViewer(host, source, { kind: "graph" });
    const validMarkup = host.innerHTML;
    const invalid = structuredClone(source);
    invalid.evidence[0].payload.edges[0].to = "missing";
    let invalidUpdate;
    try {
      viewer.update(invalid);
    } catch (error) {
      invalidUpdate = { name: error.name, code: error.code };
    }
    const preserved = host.innerHTML === validMarkup && viewer.document.definition.name === source.evidence[0].payload.name;
    viewer.destroy();
    viewer.destroy();
    let destroyedUpdate;
    try {
      viewer.update(source);
    } catch (error) {
      destroyedUpdate = { name: error.name, code: error.code };
    }
    const empty = host.childElementCount === 0;
    host.remove();
    return { invalidUpdate, preserved, destroyedUpdate, empty };
  })).toEqual({
    invalidUpdate: { name: "EinoViewerError", code: "compose.unknown_edge_target" },
    preserved: true,
    destroyedUpdate: { name: "EinoViewerError", code: "viewer.destroyed" },
    empty: true,
  });
});

test("public viewer updates same-ID state labels and canonical Workflow clicks", { tag: "@P0" }, async ({ page }) => {
  const planned = fixtureRecord("recorder-matrix/agent-cancelled.json");
  const interrupted = fixtureRecord("recorder-matrix/agent-tool-interrupted.json");
  // Alias only the call identity in this transport-update test; real matrix
  // fixtures remain unchanged and are separately tested end to end.
  const updated = JSON.parse(JSON.stringify(interrupted).replaceAll("call-tool-interrupted", "call-adk-cancelled"));
  const workflow = fixtureRecord("recorder-matrix/workflow-failed-successor.json");
  const result = await page.evaluate(({ planned, updated, workflow }) => {
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:500px";
    document.body.append(host);
    let clicked;
    const viewer = window.playground.einoAPI.createEinoViewer(host, planned, { onNodeClick: (event) => { clicked = event; } });
    // Inspect the actual compatibility renderer's computed canvas labels.
    const cy = () => [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    try {
      const toolId = viewer.document.execution.nodes.find(({ kind }) => kind === "tool").id;
      const before = cy().getElementById(toolId).data("label");
      viewer.update(updated);
      const after = cy().getElementById(toolId).data("label");
      viewer.update(workflow);
      cy().getElementById("fail").emit("tap");
      return {
        before, after,
        ids: viewer.document.execution.nodes.map(({ id }) => id).sort(),
        canonical: clicked?.node === viewer.document.execution.nodes.find(({ id }) => id === clicked?.id),
        kind: clicked?.node.kind,
        status: clicked?.node.status,
        error: clicked?.node.errorMessage,
        evidenceCount: clicked?.node.evidence.length,
      };
    } finally {
      viewer.destroy();
      host.remove();
    }
  }, { planned, updated, workflow });
  expect(result.before).toContain("Planned only");
  expect(result.after).toContain("Interrupted");
  expect(result.after).not.toContain("Planned");
  expect(result.ids).toEqual(["fail", "prepare"]);
  expect(result.canonical).toBe(true);
  expect(result.kind).toBe("workflow");
  expect(result.status).toBe("failed");
  expect(result.error).toBe("matrix planned validation failure");
  expect(result.evidenceCount).toBeGreaterThan(0);
});

test("Agent, Graph, and Workflow node clicks share one canonical event shape", { tag: "@P0" }, async ({ page }) => {
  const agent = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:500px";
    document.body.append(host);
    let clicked;
    const viewer = window.playground.einoAPI.createEinoViewer(host, window.playground.document, {
      kind: "agent",
      onNodeClick: (event) => { clicked = event; },
    });
    host.focus();
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const result = { id: clicked?.id, nodeId: clicked?.node?.id, nodeKind: clicked?.node?.kind, evidence: clicked?.node?.evidence?.length };
    viewer.destroy();
    host.remove();
    return result;
  });
  expect(agent.id).toBe(agent.nodeId);
  expect(agent.nodeKind).toBe("input");
  expect(agent.evidence).toBeGreaterThan(0);

  await openSample(page, "graph", "compose-cyclic-graph");
  expect(await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:500px";
    document.body.append(host);
    let clicked;
    const viewer = window.playground.einoAPI.createEinoViewer(host, window.playground.document, {
      kind: "graph",
      onNodeClick: (event) => { clicked = event; },
    });
    host.focus();
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const result = { id: clicked?.id, nodeId: clicked?.node?.id, component: clicked?.node?.component };
    viewer.destroy();
    host.remove();
    return result;
  })).toEqual({
    id: "callback:runnable:cyclic-agent-graph:1",
    nodeId: "callback:runnable:cyclic-agent-graph:1",
    component: "Graph",
  });

  await openSample(page, "workflow", "workflow-weather");
  const workflow = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:500px";
    document.body.append(host);
    let clicked;
    const viewer = window.playground.einoAPI.createEinoViewer(host, window.playground.document, {
      kind: "workflow",
      onNodeClick: (event) => { clicked = event; },
    });
    host.focus();
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const result = { id: clicked?.id, nodeId: clicked?.node?.id };
    viewer.destroy();
    host.remove();
    return result;
  });
  expect(workflow.id).toBeTruthy();
  expect(workflow.id).toBe(workflow.nodeId);
});

test("the unified viewer stays usable on narrow screens and passes accessibility checks", { tag: "@P1" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAgentTrajectory(page);
  await expect(page.locator("#paste-record")).toBeHidden();
  await expect(page.locator("[data-replay-controls], #record-actions")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const agentResults = await new AxeBuilder({ page }).analyze();
  expect(agentResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))).toEqual([]);
  await expect(page.locator("#sample")).toBeVisible();
  await expect(page.locator("#sample")).toHaveAccessibleName("更换记录");
  await expect(page.locator("#record-picker, #viewer-kind, #record-file")).toHaveCount(0);
  const pickerBounds = await page.locator("#sample").boundingBox();
  expect(pickerBounds.x).toBeGreaterThanOrEqual(0);
  expect(pickerBounds.x + pickerBounds.width).toBeLessThanOrEqual(390);
  await openSample(page, "graph");
  await expect(page.locator("#dag canvas").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).exclude("#dag canvas").analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))).toEqual([]);
});
