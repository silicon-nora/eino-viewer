import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { editCopy, revealSource, openRecordActions, openAgentScope, openScopeInformation, openWorkbenchRecord, openRunInformation } from "../helpers/workbench-ui.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

async function openRecord(page, record) {
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
}

for (const width of [1440, 390]) {
  test(`trajectory-first reading has no implementation prose at ${width}px`, { tag: "@P2" }, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const record = fixture("agent-deep-nested-failure-recovered");
    await openRecord(page, record);
    await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel=output]")).toBeVisible();
    await expect(page.locator("[data-trajectory-record]").first()).toBeInViewport();
    for (const selector of [".intro", ".signal-bus", ".canvas-status"]) await expect(page.locator(selector)).toBeHidden();
    await expect(page.locator(".run-issue-disclosure")).not.toHaveAttribute("open");
    await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
    await expect(page.locator("#reading-sidebar, #hierarchy-directory, #inspection-search, [data-inspection-node]")).toHaveCount(0);
    const groups = await page.evaluate(() => window.playground.explanation.groups);
    expect(groups).toHaveLength(3);
    const rootGroup = groups.find(({ parentId }) => !parentId);
    const middleGroup = groups.find(({ parentId }) => parentId === rootGroup.id);
    const leafGroup = groups.find(({ parentId }) => parentId === middleGroup.id);
    expect(leafGroup).toBeDefined();
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .agent-scope-path")).toHaveText(rootGroup.label);
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .agent-scope-action")).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.inspectionScope)).toEqual({ groupId: undefined, ungroupedOnly: false });
    await expect(page.locator(":is(#scope-result-summary, .eino-agent-reader [data-local-result])")).toBeHidden();
    await openAgentScope(page, middleGroup.id);
    await openAgentScope(page, leafGroup.id);
    const local = page.locator(":is(#scope-result-summary, .eino-agent-reader [data-local-result])");
    await openScopeInformation(page);
    await expect(local.locator("[data-scope-result]")).toHaveAttribute("data-scope-result", "failed");
    await expect(local.locator('[data-scope-channel="output"] .run-value-state')).toHaveText("未记录");
    await expect(local.locator('[data-scope-issue-origin="caller"]')).toContainText("调用方已处理");
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
    const visible = await page.locator("body").innerText();
    for (const text of ["已记录最终根输出", "不代表额外执行", "不是整次运行的最终输出", "末步骤或子调用答案", "不补造连线", "未归属不代表记录无效", "仅折叠预览"]) expect(visible).not.toContain(text);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (testInfo.project.name === "chromium") {
      mkdirSync(new URL("../../.artifacts/iteration-7/", import.meta.url), { recursive: true });
      await local.scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(`../../.artifacts/iteration-7/workbench-${width}.png`, import.meta.url).pathname });
    }
  });
}

test("raw source is read-only until edit-copy and source navigation preserves the draft", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("workflow-io-success");
  await openRecord(page, record);
  await openRecordActions(page);
  await page.locator("#open-raw").click();
  const editor = page.locator("#snapshot-json");
  await expect(editor).toHaveAttribute("readonly");
  await expect(page.locator("#apply-json")).toBeHidden();
  await editCopy(page);
  await editor.fill('{"unfinished":');
  const source = page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"] [data-envelope-index]').first();
  await revealSource(source);
  await source.click();
  await expect(editor).toHaveAttribute("readonly");
  await expect(page.locator("#restore-draft")).toBeVisible();
  await page.locator("#restore-draft").click();
  await expect(editor).toHaveValue('{"unfinished":');
  await expect(editor).toBeEditable();
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("root results distinguish ambiguous strings from JSON primitives without changing source values", { tag: "@P0" }, async ({ page }) => {
  for (const value of ["null", null, "0", 0, "false", false, "", { name: "ordinary object", content: "keep", extra: 1 }]) {
    const record = fixture("graph-io-structured");
    const entry = record.evidence.find(({ kind, payload, metadata }) => kind === "component.io" && metadata?.io?.scope === "root" && payload.direction === "output");
    entry.payload.body = value;
    await openRecord(page, record);
    await openRunInformation(page);
    const result = page.locator('#node-detail [data-business-channel="output"] .business-value');
    await expect(result).toHaveAttribute("data-value-type", value === null ? "null" : typeof value);
    await expect(result.locator(".business-value-text")).toHaveText(value === "" ? '""' : typeof value === "string" ? value : JSON.stringify(value, null, 2));
    if (["null", "0", "false"].includes(value)) await expect(result.locator(".business-value-state")).toHaveText("文本");
    expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  }
});
