import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openStepSearch, openRunInformation, selectAgentStep, openWorkbenchRecord } from "../helpers/workbench-ui.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Exercise source directly so this suite also works before the site is built.
  await page.goto("/site/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await page.waitForLoadState("networkidle");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function importRecord(page, record) {
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document.runId)).toBe(record.runId);
}

async function selectStep(page, id) {
  if (await page.evaluate(() => window.playground.objectKind === "agent")) {
    await selectAgentStep(page, id);
    return;
  }
  await openStepSearch(page);
  await page.locator("#inspection-search").fill(id);
  await page.locator(`[data-inspection-node=${JSON.stringify(id)}]`).click();
}

async function selectedReading(page) {
  return page.evaluate(() => ({ selection: window.playground.linkedSelection, detail: window.playground.selectedNodeDetail }));
}

async function expectBoundaryHitArea(page, { primary, direction, text, ids }) {
  const title = page.locator(`[data-trajectory-record=${JSON.stringify(ids[direction])}]`);
  const other = page.locator(`[data-trajectory-record=${JSON.stringify(ids[direction === "input" ? "output" : "input"])}]`);
  const card = page.locator(".agent-boundary-row").filter({ has: title });
  const body = primary.locator("[data-run-value]");
  const expected = await selectedReading(page);
  expect(expected.detail.trajectoryRecord.id).toBe(ids[direction]);
  await expect(card).toHaveCount(1);
  await expect(title).toHaveRole("button");

  // Copy remains an independent action, with the full original text, even
  // when another row owns the details. It must not bubble into row selection.
  await other.click();
  const otherReading = await selectedReading(page);
  await primary.locator(".run-copy-value").click();
  expect(await page.evaluate(() => window.boundaryCopiedText)).toBe(text);
  expect(await selectedReading(page)).toEqual(otherReading);

  // Use a real pointer drag, not a synthetic Selection: selecting text must
  // neither navigate nor discard the browser's native selection.
  await body.hover({ position: { x: 4, y: 10 } });
  const bodyBounds = await body.boundingBox();
  await page.mouse.move(bodyBounds.x + 4, bodyBounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bodyBounds.x + 74, bodyBounds.y + 10, { steps: 8 });
  await page.mouse.up();
  const selectedText = await page.evaluate(() => getSelection().toString());
  expect(selectedText.length).toBeGreaterThan(0);
  expect(text).toContain(selectedText);
  expect(await selectedReading(page)).toEqual(otherReading);

  // The side gutter and the last few pixels of the card are outside the
  // original title button. A fresh click must work even when the browser keeps
  // the prior text selection after clicking blank padding.
  const titleBounds = await title.boundingBox();
  await card.click({ position: { x: 8, y: titleBounds.height + 12 } });
  expect(await selectedReading(page)).toEqual(expected);
  await expect(title).toHaveAttribute("aria-pressed", "true");
  expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
  await other.click();
  const cardBounds = await card.boundingBox();
  await card.click({ position: { x: cardBounds.width - 8, y: cardBounds.height - 5 } });
  expect(await selectedReading(page)).toEqual(expected);

  await other.click();
  await body.click({ position: { x: 24, y: 10 } });
  expect(await selectedReading(page)).toEqual(expected);
  await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeHidden();
  await expect(title).toBeFocused();

  // The original button remains the sole keyboard selection control.
  for (const key of ["Enter", "Space"]) {
    await other.click();
    await title.focus();
    await title.press(key);
    expect(await selectedReading(page)).toEqual(expected);
    await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
    await expect(title).toHaveAttribute("aria-pressed", "true");
  }
}

function changedToolResult(value, missing = false) {
  const record = fixture("agent-parallel-same-tool");
  record.runId += `-reading-${missing ? "missing" : String(value)}`;
  for (const entry of record.evidence) entry.correlation.runId = record.runId;
  const owned = (entry) => entry.kind === "component.io" && entry.payload.component === "Tool"
    && entry.payload.direction === "output" && entry.payload.address.some((part) => part.subId === "call-slow")
    || entry.kind === "agent.event" && entry.payload.output?.message?.value?.tool_call_id === "call-slow";
  if (missing) record.evidence = record.evidence.filter((entry) => !owned(entry));
  else for (const entry of record.evidence.filter(owned)) {
    if (entry.kind === "component.io") entry.payload.body.response = typeof value === "string" ? value : JSON.stringify(value);
    else entry.payload.output.message.value.content = typeof value === "string" ? value : JSON.stringify(value);
  }
  if (value === null && !missing) {
    record.evidence = record.evidence.filter((entry) => !(owned(entry) && entry.kind === "agent.event"));
    record.evidence.find((entry) => owned(entry) && entry.kind === "component.io").payload.body = null;
  }
  return record;
}

for (const [name, value, missing, shown] of [["null", null, false, "null"], ["empty", "", false, '""'], ["unrecorded", undefined, true, "未记录"]]) {
  test(`trajectory keeps ${name} output distinct and never substitutes the input`, { tag: "@P0" }, async ({ page }) => {
    const record = changedToolResult(value, missing);
    await importRecord(page, record);
    const row = page.locator('[data-trajectory-record="tool:call-slow"]');
    await expect(row.locator(".trajectory-summary")).toHaveText(shown);
    await expect(row.locator(".trajectory-summary")).not.toContainText('"key"');
    await row.click();
    const output = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) });
    await expect(output).toContainText(shown);
    await expect(output.locator(".business-value")).toHaveAttribute("data-availability", missing ? "not-observed" : name === "null" ? "null" : "empty");
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure")).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  });
}

test("long input and final answer are readable in place without opening technical details", { tag: "@P1" }, async ({ page }) => {
  test.setTimeout(60000);
  const record = fixture("agent-direct-answer");
  await importRecord(page, record);
  const shortLayout = await page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])").evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom,
      stageBottom: document.querySelector(":is(.canvas-stage, .eino-agent-reader [data-reading-workspace])").getBoundingClientRect().bottom,
      readingTop: document.querySelector(":is(#reading-main, .eino-agent-reader [data-reading-main])").getBoundingClientRect().top,
      footerHeight: document.querySelector(".page-footer").getBoundingClientRect().height,
      viewportBottom: innerHeight - scrollY };
  });
  expect(shortLayout.top).toBeCloseTo(shortLayout.readingTop, 0);
  expect(shortLayout.bottom).toBeCloseTo(shortLayout.stageBottom, 0);
  expect(shortLayout.bottom).toBeGreaterThanOrEqual(shortLayout.viewportBottom - shortLayout.footerHeight - 2);
  const input = `输入正文开头\n${"这是应被完整保留的业务要求。\n".repeat(40)}输入正文结尾`;
  const output = `输出正文开头\n${"这是应被完整保留的最终结果。".repeat(100)}\n输出正文结尾`;
  for (const entry of record.evidence) {
    if (entry.kind === "schema.message") entry.payload.content = entry.payload.role === "user" ? input : output;
    if (entry.kind === "component.io" && entry.payload.direction === "input") {
      entry.payload.body.messages.find((message) => message.role === "user").content = input;
    }
    if (entry.kind === "component.io" && entry.payload.direction === "output") entry.payload.body.message.content = output;
    if (entry.kind === "agent.event") entry.payload.output.message.value.content = output;
  }
  await importRecord(page, record);
  const ids = await page.evaluate(() => ({
    input: window.playground.trajectory.records.find((node) => node.kind === "user").id,
    output: window.playground.trajectory.records.findLast((node) => node.kind === "assistant").id,
  }));
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text) => { window.boundaryCopiedText = text; },
  } }));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [direction, text] of [["input", input], ["output", output]]) {
      const primary = page.locator(`:is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="${direction}"]`);
      await expect(primary.locator("[data-run-value]")).toHaveText(text);
      await expect(primary.locator("[data-run-value]")).toBeVisible();
      await expect(primary.locator(".run-result-preview, [data-run-expand], .run-result-expanded")).toHaveCount(0);
      await page.locator(`[data-trajectory-record=${JSON.stringify(ids[direction])}]`).click();
      const channel = page.locator(`:is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="${direction}"]`);
      const full = channel.locator(".business-value-text").first();
      await expect(full).toHaveText(text);
      await expect(full).toBeVisible();
      await expect(channel.locator(".run-result-preview, .run-result-expanded, .run-copy-value")).toHaveCount(0);
      const layout = await full.evaluate((element) => {
        const detail = document.querySelector(":is(#node-detail, .eino-agent-reader [data-step-detail])"), panel = document.querySelector(":is(#inspector-panel, .eino-agent-reader [data-step-panel])");
        const body = element.getBoundingClientRect(), detailBounds = detail.getBoundingClientRect();
        return { fullHeight: element.clientHeight, fullScroll: element.scrollHeight,
          detailHeight: detail.clientHeight, detailScroll: detail.scrollHeight,
          panelHeight: panel.clientHeight, panelScroll: panel.scrollHeight,
          panelBottom: panel.getBoundingClientRect().bottom,
          stageBottom: document.querySelector(":is(.canvas-stage, .eino-agent-reader [data-reading-workspace])").getBoundingClientRect().bottom,
          contained: body.top >= detailBounds.top && body.bottom <= detailBounds.bottom + 1,
          clamp: getComputedStyle(element).webkitLineClamp,
          viewport: innerWidth, pageWidth: document.documentElement.scrollWidth };
      });
      expect(layout.fullScroll).toBeLessThanOrEqual(layout.fullHeight + 1);
      expect(layout.detailScroll).toBeLessThanOrEqual(layout.detailHeight + 1);
      expect(layout.panelScroll).toBeLessThanOrEqual(layout.panelHeight + 1);
      expect(layout.contained).toBe(true);
      expect(layout.panelBottom).toBeCloseTo(layout.stageBottom, 0);
      expect(layout.clamp).toBe("none");
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport + 1);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure")).toHaveCount(0);
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).not.toContainText("正文开头");
      await expectBoundaryHitArea(page, { primary, direction, text, ids });
    }
  }
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("empty message content cannot hide a recorded tool plan", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-parallel-same-tool");
  await importRecord(page, record);
  const id = await page.evaluate(() => window.playground.trajectory.records.find((node) => node.kind === "assistant" && node.metadata.toolNames?.length).id);
  await page.locator(`[data-trajectory-record=${JSON.stringify(id)}]`).click();
  const output = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) });
  await expect(output).toContainText("lookup_item");
  await expect(output).toContainText("arguments");
  await expect(output.locator(".business-value").first()).not.toHaveAttribute("data-availability", "empty");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure")).toHaveCount(0);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("recorded redaction stays visible beside business content", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("graph-io-redacted");
  await importRecord(page, record);
  const id = await page.evaluate(() => window.playground.explanation.nodes.find((node) => node.output.items.some((item) => item.availability === "redacted")).id);
  await selectStep(page, id);
  await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="output"] [data-availability="redacted"]')).toBeVisible();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure")).toHaveCount(0);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("returning from a nested Agent focuses the root answer and keeps it distinct", { tag: "@P1" }, async ({ page }) => {
  const record = fixture("agent-deep-nested-distinct-results");
  await importRecord(page, record);
  const nested = await page.evaluate(() => window.playground.trajectory.records.find((entry) => entry.kind === "assistant" && entry.metadata.parentAgentScopeId)?.id);
  await page.locator(`[data-trajectory-record=${JSON.stringify(nested)}]`).click();
  await page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .agent-scope-action").click();
  await expect(page.locator(":is(#scope-result-summary, .eino-agent-reader [data-local-result])")).toBeVisible();
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toHaveCount(0);
  await page.locator("[data-scope-global-result]").click();
  await expect(page.locator(":is(#scope-result-summary, .eino-agent-reader [data-local-result])")).toHaveCount(0);
  await openRunInformation(page);
  const output = page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]');
  await expect(output).toBeFocused();
  await expect(output).toBeInViewport();
  await expect(output).toContainText("parent final: accepted single");
  await expect(output).not.toContainText("leaf result:");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("JSON-looking tool text keeps its string type in step and trajectory details", { tag: "@P0" }, async ({ page }) => {
  for (const text of ["null", "false", "0", '{"response":"literal text"}',
    JSON.stringify({ response: { content: "business payload", extra: "retain me" }, condition: "ready", temperatureC: 21, messages: ["data"],
      id: "business-id", metadata: { owner: "customer" }, payload: "ordinary business value" })]) {
    const record = changedToolResult(text);
    await importRecord(page, record);
    const id = await page.evaluate(() => window.playground.explanation.nodes.find((node) => node.technical.correlation.toolCallId === "call-slow").id);
    await selectStep(page, id);
    const value = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) }).locator(".business-value");
    await expect(value).toHaveAttribute("data-value-type", "string");
    await expect(value).toHaveAttribute("data-availability", "available");
    await expect(value.locator(".business-value-text")).toHaveText(text);
    await expect(value.locator(".business-value-state")).toHaveText("文本");
    await page.locator('[data-trajectory-record="tool:call-slow"]').click();
    const output = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) }).locator(".business-value");
    await expect(output).toHaveAttribute("data-value-type", "string");
    await expect(output).toHaveAttribute("data-availability", "available");
    await expect(output.locator(".business-value-text")).toHaveText(text);
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  }
});

test("step and trajectory durations show recorded values rather than timing protocol enums", { tag: "@P2" }, async ({ page }) => {
  const record = fixture("agent-deep-nested-distinct-results");
  await importRecord(page, record);
  const node = await page.evaluate(() => window.playground.explanation.nodes.find((entry) => entry.kind === "tool" && Number.isFinite(entry.timing.durationMs)));
  await selectStep(page, node.id);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-duration")).toHaveText(`耗时 · ${node.timing.durationMs} ms`);
  const trajectory = await page.evaluate(() => window.playground.trajectory.records.find((entry) => entry.kind === "tool" && Number.isFinite(entry.timing?.durationMs)));
  await page.locator(`[data-trajectory-record=${JSON.stringify(trajectory.id)}]`).click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-duration")).toHaveText(`耗时 · ${trajectory.timing.durationMs} ms`);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .technical-disclosure, :is(#node-detail, .eino-agent-reader [data-step-detail]) .node-facts")).toHaveCount(0);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).not.toContainText(/component-boundary|recorded-boundaries|observed-at/);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("omitted component capture does not hide an independently recorded tool message", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("agent-parallel-same-tool");
  const component = record.evidence.find((entry) => entry.kind === "component.io" && entry.payload.component === "Tool"
    && entry.payload.direction === "output" && entry.payload.address.some((part) => part.subId === "call-slow"));
  delete component.payload.body;
  component.metadata = { ...component.metadata, capture: { status: "omitted", reason: "size_limit" } };
  await importRecord(page, record);
  await page.locator('[data-trajectory-record="tool:call-slow"]').click();
  const output = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) });
  await expect(output.locator(".business-value-text")).toHaveText("result:slow");
  await expect(output.locator(".business-value")).toHaveAttribute("data-availability", "available");
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});
