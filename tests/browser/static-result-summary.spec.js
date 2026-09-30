import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { revealSource, openRunInformation, openStepSearch, openWorkbenchRecord, expectSelectedEvidence } from "../helpers/workbench-ui.js";

const fixtures = new URL("../../fixtures/recorder-matrix/", import.meta.url);
const playgroundPath = process.env.EINO_VIEWER_PLAYGROUND_PATH ?? "/.artifacts/pages/?lang=zh";
const runtimeErrors = new WeakMap();
const screenshotDirectory = fileURLToPath(new URL("../../.artifacts/iteration-2/", import.meta.url));

async function screenshot(page, testInfo, name) {
  if (testInfo.project.name !== "chromium") return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}${name}.png`, fullPage: true });
}

function readRecord(id) {
  return JSON.parse(readFileSync(new URL(`${id}.json`, fixtures), "utf8"));
}

async function openRecord(page, id) {
  const record = readRecord(id);
  await importRecord(page, record);
  return record;
}

async function importRecord(page, record) {
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document?.runId)).toBe(record.runId);
  await openRunInformation(page);
  await expect(resultView(page)).toBeVisible();
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
}

function channel(page, direction) {
  return page.locator(`[data-reading-kind="graph"] #node-detail [data-business-channel="${direction}"], :is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="${direction}"]`);
}

function resultView(page) {
  return page.locator('[data-reading-kind="graph"] #node-detail, :is([data-reading-kind="workflow"] #run-result-summary, .eino-agent-reader [data-run-summary])');
}

async function runSummary(page) {
  return page.evaluate(() => window.playground.explanation.run);
}

async function expectRawEvidence(page, scope, record, index) {
  if (await page.evaluate(() => window.playground.objectKind === "graph")) {
    await expectSelectedEvidence(page, index, record.evidence[index]);
    await expect(scope.locator("button[data-envelope-index]")).toHaveCount(0);
    await expect(page.locator("#snapshot-json")).toBeHidden();
    return;
  }
  if (await scope.getAttribute("id") === "node-detail") {
    await expectSelectedEvidence(page, index, record.evidence[index]);
    await expect(scope.locator("button[data-envelope-index]")).toHaveCount(0);
    return;
  }
  const direction = await scope.getAttribute("data-run-channel");
  const source = await page.evaluate(({ direction, index }) => {
    const run = window.playground.explanation.run;
    const items = direction ? run[direction].items : run.issues;
    return { linked: items.some((item) => item.evidenceEnvelopeIndexes.includes(index)),
      envelope: window.playground.document.evidence[index] };
  }, { direction, index });
  expect(source).toEqual({ linked: true, envelope: record.evidence[index] });
  await expect(scope.locator("button[data-envelope-index]")).toHaveCount(0);
  await expect(page.locator("#snapshot-json")).toBeHidden();
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.setViewportSize({ width: 1560, height: 980 });
  await page.goto(playgroundPath);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => window.playground?.ready);
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});

test("Agent disclosed final answer and input are distinct source-backed values", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = await openRecord(page, "agent-direct-answer");
  const summary = await runSummary(page);
  expect(summary.result).toMatchObject({ state: "success", basis: "recorded" });
  expect(summary.capture.status).toBe("complete");
  expect(summary.input.items.map(({ value }) => value)).toEqual(["请直接打个招呼。"]);
  expect(summary.output.items.map(({ value }) => value)).toEqual(["你好，运行已完成。"]);
  await expect(channel(page, "input")).toContainText("请直接打个招呼。");
  await expect(channel(page, "output")).toContainText("你好，运行已完成。");
  await expect(page.locator(':is(#run-result-summary [data-run-result], .eino-agent-reader [data-run-result])')).toHaveAttribute("data-run-result", "success");
  await expect(page.locator('[data-agent-outcome]')).toBeHidden();
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-capture="complete"]')).toHaveCount(0);
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary]) .run-information, :is(#run-result-summary, .eino-agent-reader [data-run-summary]) .run-diagnostics, :is(#run-result-summary, .eino-agent-reader [data-run-summary]) .run-sources")).toHaveCount(0);
  await expect(page.locator("#snapshot-json")).toBeHidden();
  await expect(channel(page, "input").locator("[data-run-value]")).toBeVisible();
  await screenshot(page, testInfo, "agent-final-result");
  await expect(channel(page, "input").locator("[data-run-value]")).toBeVisible();
  await expect(channel(page, "input").locator("[data-run-value]")).toHaveText("请直接打个招呼。");
  for (const direction of ["input", "output"]) {
    const index = summary[direction].items[0].evidenceEnvelopeIndexes[0];
    await expectRawEvidence(page, channel(page, direction), record, index);
  }
});

test("recovered Agent success uses its final answer instead of the intermediate tool result", { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
  await openRecord(page, "agent-tool-recovered");
  const summary = await runSummary(page);
  expect(summary.result.state).toBe("success");
  expect(summary.capture.status).toBe("complete");
  expect(summary.output.items.map(({ value }) => value)).toEqual(["已恢复：使用缓存报价 120 元。"]);
  await expect(channel(page, "output")).toContainText("已恢复：使用缓存报价 120 元。");
  await expect(channel(page, "output")).not.toContainText("quote provider unavailable");
  await expect(channel(page, "output")).not.toContainText("lookup_profile");
});

for (const scenario of [
  { id: "agent-cancelled", state: "cancelled", reason: "agent canceled: mode=2, escalated=false" },
  { id: "agent-tool-interrupted", state: "interrupted", reason: "approval required for booking" },
]) {
  test(`${scenario.id} shows the actual exception and never promotes a tool plan to final output`, { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
    const record = await openRecord(page, scenario.id);
    const summary = await runSummary(page);
    expect(summary.result.state).toBe(scenario.state);
    expect(summary.capture.status).toBe("complete");
    expect(summary.output.availability).toBe("not-observed");
    expect(summary.output.items.some((item) => Object.hasOwn(item, "value"))).toBe(false);
    const issue = summary.issues.find(({ message }) => message === scenario.reason);
    expect(issue).toBeDefined();
    await expect(page.locator(':is(#run-result-summary [data-run-result], .eino-agent-reader [data-run-result])')).toHaveAttribute("data-run-result", scenario.state);
    await expect(page.locator(`[data-agent-outcome="${scenario.state}"]`)).toBeVisible();
    await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toContainText(scenario.reason);
    await expect(channel(page, "output")).not.toContainText("lookup_profile");
    await expectRawEvidence(page, page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])"), record, issue.evidenceEnvelopeIndexes[0]);
  });
}

test("redacted successful Agent shows outcome and limited capture independently", { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
  const record = await openRecord(page, "agent-redacted-tool");
  const summary = await runSummary(page);
  expect(summary.result.state).toBe("success");
  expect(summary.capture.status).toBe("partial");
  expect(summary.output.items.map(({ value }) => value)).toEqual(["已读取资料：[REDACTED]，欢迎 Ada。"]);
  await expect(page.locator(':is(#run-result-summary [data-run-result], .eino-agent-reader [data-run-result])')).toHaveAttribute("data-run-result", "success");
  await expect(page.locator('[data-agent-outcome]')).toBeHidden();
  await expect(page.locator('[data-agent-capture="partial"]')).toBeVisible();
  await expect(channel(page, "output")).toContainText("[REDACTED]");
  expect(JSON.stringify(record)).not.toContain("private@example.test");
  await expect(page.locator("body")).not.toContainText("private@example.test");
});

test("legacy Graph metadata completeness does not imply captured input or final output", { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
  const record = await openRecord(page, "graph-step-limit");
  const summary = await runSummary(page);
  expect(summary.result.state).toBe("failed");
  expect(summary.capture.status).toBe("complete");
  expect(summary.input.availability).toBe("not-observed");
  expect(summary.output.availability).toBe("not-observed");
  expect(summary.capture.limitations.length).toBeGreaterThan(0);
  const message = record.evidence.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "error").payload.error.message;
  await expect(page.locator("#node-detail")).toContainText(message);
  await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-capture="complete"]')).toBeHidden();
  await expect(channel(page, "input").locator(".business-value-state")).toHaveText("未记录");
  await expect(channel(page, "output").locator(".business-value-text")).toHaveCount(0);
});

test("legacy Workflow node output is not presented as the root run result", { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
  await openRecord(page, "workflow-failed-successor");
  const summary = await runSummary(page);
  expect(summary.result.state).toBe("failed");
  expect(summary.input.availability).toBe("not-observed");
  expect(summary.output.availability).toBe("not-observed");
  await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toContainText("matrix planned validation failure");
  await expect(channel(page, "output")).not.toContainText("request/prepared");
  await openRecord(page, "workflow-nested-names");
  const successful = await runSummary(page);
  expect(successful.result.state).toBe("success");
  expect(successful.output.availability).toBe("not-observed");
  await expect(channel(page, "output")).not.toContainText("request/left/right");
});

test("derived definition-only Graph remains viewable without claiming execution or a result", { tag: "@P0" }, async ({ page }) => {
  // Derived from the real captured declaration; not counted as another real run.
  const record = readRecord("graph-step-limit");
  record.evidence = record.evidence.filter(({ kind }) => kind === "compose.graph");
  await importRecord(page, record);
  const summary = await runSummary(page);
  expect(summary.result).toMatchObject({ state: "definition-only", basis: "declared" });
  expect(summary.capture.status).toBe("unknown");
  expect(summary.input.availability).toBe("not-observed");
  expect(summary.output.availability).toBe("not-observed");
  await expect(page.locator("#global-summary")).toBeHidden();
  await expect(page.locator("#run-result-summary")).toBeEmpty();
  const graph = page.locator("#dag svg[data-graph-topology]");
  await expect(graph).toBeVisible();
  await expect(graph.locator('[data-graph-node="retry"]')).toBeVisible();
  await expect(graph.locator('[data-graph-node="retry"] > title')).toHaveText("Retry forever · 仅定义");
  await openStepSearch(page);
  const step = page.locator('#inspection-results [data-inspection-node="graph:1:retry"]');
  await expect(page.locator("#inspection-results [data-inspection-node]")).toHaveCount(1);
  await expect(step.locator("strong")).toHaveText("Retry forever");
  await expect(step).toContainText("仅声明");
  await expect(step).not.toContainText("trajectoryDeclared");
  await expect(step).toHaveAttribute("aria-current", "true");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).toHaveText("Retry forever");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode)).toMatchObject({ id: "graph:1:retry", status: "declared" });
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).not.toContainText("成功");
  expect(await page.evaluate(() => window.playground.explanation.nodes.some(({ status }) => status === "success"))).toBe(false);
  await graph.locator('[data-graph-node="retry"]').click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) h3")).toHaveText("Retry forever");
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).not.toContainText("成功");
  await expect(page.locator("#node-detail .step-state")).toContainText("仅声明");
  await expectRawEvidence(page, page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])"), record, 0);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

// A deliberately modified copy exercises presentation robustness. This is not
// a new real-Recorder scenario and never enters the production fixture matrix.
test("synthetic failure with partial capture stays literal, keyboard-accessible and readable on a narrow screen", { tag: "@P0" }, async ({ page }) => {
  const record = readRecord("workflow-failed-successor");
  const unsafeText = '[synthetic UI text] <img src=x onerror="window.__summaryScriptRan=true"> <script>window.__summaryScriptRan=true</script>';
  record.evidence.find(({ kind }) => kind === "workflow.snapshot").payload.execution.nodes.find(({ status }) => status === "failed").errorMessage = unsafeText;
  record.evidence.find(({ kind, payload }) => kind === "run.lifecycle" && payload.state === "ended").payload.capture = "partial";
  record.diagnostics.push({ severity: "warning", code: "projection.truncated", path: "synthetic-ui-only", message: "Synthetic UI robustness: capture was limited." });
  await page.addInitScript(() => { window.__summaryScriptRan = false; });
  await page.setViewportSize({ width: 390, height: 844 });
  await importRecord(page, record);
  const summary = page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])");
  await expect(summary.locator('[data-run-result="failed"]')).toBeVisible();
  await expect(summary.locator('[data-run-capture="partial"]')).toBeVisible();
  await expect(summary).toContainText(unsafeText);
  await expect(summary.locator("img, script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__summaryScriptRan)).toBe(false);
  for (const language of ["en", "zh"]) {
    await page.locator(`[data-language="${language}"]`).click();
    await expect(summary.locator('[data-run-result="failed"]')).toBeVisible();
    await expect(summary.locator('[data-run-capture="partial"]')).toBeVisible();
    await expect(summary).toContainText(unsafeText);
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  }
  const failure = summary.locator('[data-run-issue="error"] [data-run-issue-step]').first();
  await failure.focus();
  await expect(failure).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#node-detail")).toContainText(unsafeText);
  await expectSelectedEvidence(page, 0, record.evidence[0]);
  await expect(page.locator("#snapshot-json")).toBeHidden();
  expect(await page.evaluate(() => window.__summaryScriptRan)).toBe(false);
});

function rootIO(record, direction) {
  const index = record.evidence.findIndex(({ kind, payload, metadata }) => kind === "component.io"
    && metadata?.io?.scope === "root" && payload.direction === direction);
  return { index, envelope: record.evidence[index] };
}

async function expectGraphNodeName(page, record, displayName, searchName) {
  const execution = projectEinoViewerDocument(record).document.execution;
  const start = record.evidence.findIndex(({ kind, payload }) => kind === "callback.event"
    && payload.phase === "start" && payload.nodePath?.[0] === "process");
  expect(start).toBeGreaterThanOrEqual(0);
  const canonical = execution.nodes.find((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === start));
  expect(canonical.label).toBe("Lambda");
  await openStepSearch(page);
  await page.locator("#inspection-search").fill(searchName);
  const row = page.locator(`#inspection-results [data-inspection-node=${JSON.stringify(canonical.id)}]`);
  await expect(row).toHaveCount(1);
  await expect(row.locator("strong")).toHaveText(displayName);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#node-detail .node-detail-hero h3")).toHaveText(displayName);
  await expect(page.locator('#dag [data-graph-node="process"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#dag [data-graph-node="process"] > title')).toContainText(searchName);
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode)).toEqual(canonical);
  for (const direction of ["input", "output"]) {
    const index = record.evidence.findIndex(({ kind, payload, metadata }) => kind === "component.io"
      && metadata?.io?.scope === "node" && payload.direction === direction);
    expect(index).toBeGreaterThanOrEqual(0);
    const value = page.locator(`#node-detail [data-business-channel="${direction}"] .business-value-text`);
    expect(JSON.parse(await value.textContent())).toEqual(record.evidence[index].payload.body);
    await expectSelectedEvidence(page, index, record.evidence[index]);
  }
  expect(await page.evaluate(() => window.playground.executionDAG)).toEqual(execution);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
}

for (const scenario of [
  { id: "graph-io-structured", availability: "available" },
  { id: "graph-io-empty", availability: "empty" },
  { id: "graph-io-null", availability: "null" },
  { id: "workflow-io-success", availability: "available" },
]) {
  test(`${scenario.id} displays actual root I/O without changing JSON value types`, { tag: ["@P0", "@data-matrix"] }, async ({ page }, testInfo) => {
    const record = await openRecord(page, scenario.id);
    const summary = await runSummary(page);
    expect(summary.result.state).toBe("success");
    expect(summary.capture.status).toBe("complete");
    for (const direction of ["input", "output"]) {
      const { index, envelope } = rootIO(record, direction);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(summary[direction].availability).toBe("available");
      expect(summary[direction].items).toHaveLength(1);
      expect(summary[direction].items[0]).toMatchObject({ value: envelope.payload.body, availability: scenario.availability });
      expect(summary[direction].items[0].evidenceEnvelopeIndexes).toContain(index);
      const graph = scenario.id.startsWith("graph-");
      const value = channel(page, direction).locator(graph ? ".business-value-text" : "[data-run-value]");
      await expect(graph ? channel(page, direction).locator(".business-value") : value).toHaveAttribute("data-availability", scenario.availability);
      const shown = envelope.payload.body === "" ? '""' : typeof envelope.payload.body === "string"
        ? envelope.payload.body : JSON.stringify(envelope.payload.body, null, 2);
      expect(await value.textContent()).toBe(shown);
    }
    if (scenario.id === "graph-io-structured") await screenshot(page, testInfo, "graph-structured-result");
    if (scenario.id === "workflow-io-success") await screenshot(page, testInfo, "workflow-final-result");
    if (scenario.id.startsWith("graph-io-")) {
      const inputs = record.evidence.map((envelope, index) => ({ envelope, index }))
        .filter(({ envelope }) => envelope.kind === "component.io" && envelope.metadata?.io?.scope === "node");
      const ownerID = await page.evaluate((index) => window.playground.executionDAG.nodes
        .find((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index)).id, inputs[0].index);
      await openStepSearch(page);
      const owner = page.locator(`#inspection-results [data-inspection-node=${JSON.stringify(ownerID)}]`);
      await expect(owner).toHaveCount(1);
      await owner.click();
      await expect(owner).toHaveAttribute("aria-current", "true");
      const step = await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode);
      expect(step.id).toBe(ownerID);
      for (const { envelope, index } of inputs) {
        const item = step[envelope.payload.direction].items.find(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(index));
        expect(item).toBeDefined();
        expect(Object.hasOwn(item, "value")).toBe(true);
        expect(item.value).toEqual(envelope.payload.body);
      }
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel] .business-value-expanded, :is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel] .run-result-preview")).toHaveCount(0);
      const values = page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel] .business-value-text");
      await expect(values).toHaveCount(2);
      for (const value of await values.all()) {
        await expect(value).toBeVisible();
        await expect(value).not.toContainText("未记录");
      }
      if (scenario.availability === "empty") {
        for (const value of await values.all()) await expect(value).toHaveText(/空字符串|""/);
      } else if (scenario.availability === "null") {
        for (const value of await values.all()) await expect(value).toHaveText(/null|空值/);
      } else {
        await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="input"] .business-value-text')).toContainText("查找杭州周末路线");
        await expect(page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="output"] .business-value-text')).toContainText("西湖步行路线");
      }
      expect((await runSummary(page)).input).toEqual(summary.input);
      expect((await runSummary(page)).output).toEqual(summary.output);
    }
    if (scenario.id.startsWith("graph-")) await openRunInformation(page);
    for (const direction of ["input", "output"]) {
      await expectRawEvidence(page, channel(page, direction), record, rootIO(record, direction).index);
    }
    if (scenario.id === "graph-io-structured") {
      const callbacks = record.evidence.filter(({ kind, payload }) => kind === "callback.event" && payload.nodePath?.[0] === "process");
      expect(callbacks).toHaveLength(2);
      for (const source of callbacks) expect(Object.hasOwn(source.payload.run, "name")).toBe(false);
      await expectGraphNodeName(page, record, "process", "process");

      // A display-only boundary copy, not another real Recorder scenario:
      // an explicit application name must survive even if it equals the type.
      // Its distinct declared alias also proves private UI search enrichment.
      const named = structuredClone(record);
      named.evidence.find(({ kind }) => kind === "compose.graph").payload.nodes[0].name = "路线处理";
      for (const source of named.evidence) if (source.kind === "callback.event" && source.payload.nodePath?.[0] === "process") {
        source.payload.run.name = "Lambda";
      }
      await importRecord(page, named);
      await expectGraphNodeName(page, named, "Lambda", "路线处理");
    }
  });
}

for (const id of ["graph-io-failed", "graph-io-cancelled", "workflow-io-failed"]) {
  test(`${id} exposes the actual input and failure while keeping missing output explicit`, { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
    const record = await openRecord(page, id);
    const summary = await runSummary(page);
    const expectedState = id.includes("cancelled") ? "cancelled" : "failed";
    expect(summary.result.state).toBe(expectedState);
    expect(summary.capture.status).toBe("complete");
    expect(summary.input.items[0].value).toEqual(rootIO(record, "input").envelope.payload.body);
    expect(summary.output.availability).toBe("not-observed");
    expect(summary.output.items).toHaveLength(0);
    expect(summary.issues.length).toBeGreaterThan(0);
    const graph = id.startsWith("graph-");
    if (graph) await expect(page.locator("#node-detail .step-state.failed")).toBeVisible();
    else await expect(page.locator(`:is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-result="${expectedState}"]`)).toBeVisible();
    await expect(channel(page, "input").locator(graph ? ".business-value-text" : "[data-run-value]")).toHaveText(rootIO(record, "input").envelope.payload.body);
    await expect(resultView(page)).toContainText(summary.issues[0].message);
    const issueIndex = graph ? record.evidence.findIndex(({ kind, payload }) => kind === "callback.event" && payload.phase === "error" && !payload.nodePath?.length)
      : summary.issues[0].evidenceEnvelopeIndexes[0];
    await expectRawEvidence(page, resultView(page), record, issueIndex);
  });
}

test("oversized Graph output is explicitly omitted, not rendered as empty, null or failure", { tag: ["@P0", "@data-matrix"] }, async ({ page }, testInfo) => {
  const record = await openRecord(page, "graph-io-oversized");
  const summary = await runSummary(page);
  const { index, envelope } = rootIO(record, "output");
  expect(summary.result.state).toBe("success");
  expect(summary.capture.status).toBe("partial");
  expect(summary.output.availability).toBe("not-observed");
  expect(summary.output.items[0]).toMatchObject({ availability: "not-observed", reason: "size_limit" });
  expect(Object.hasOwn(summary.output.items[0], "value")).toBe(false);
  expect(Object.hasOwn(envelope.payload, "body")).toBe(false);
  await expect(page.locator("#node-detail .step-state.success")).toHaveCount(0);
  await expect(page.locator("#global-summary")).toBeHidden();
  await expect(channel(page, "output").locator(".business-value-text")).toHaveCount(0);
  await expect(channel(page, "output").locator(".business-value")).toHaveAttribute("data-availability", "not-observed");
  await expect(channel(page, "output")).toContainText("超出大小限制");
  await screenshot(page, testInfo, "graph-omitted-result");
  await expectRawEvidence(page, channel(page, "output"), record, index);
});

test("Graph redaction remains visible and no root, node or raw record reveals the secret", { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
  const record = await openRecord(page, "graph-io-redacted");
  const summary = await runSummary(page);
  expect(summary.result.state).toBe("success");
  expect(summary.capture.status).toBe("partial");
  for (const direction of ["input", "output"]) {
    const { index, envelope } = rootIO(record, direction);
    expect(summary[direction].availability).toBe("redacted");
    expect(summary[direction].items[0]).toMatchObject({ value: envelope.payload.body, availability: "redacted" });
    await expect(channel(page, direction)).toContainText("[REDACTED]");
    await expect(channel(page, direction).locator(".business-value")).toHaveAttribute("data-availability", "redacted");
    await expectRawEvidence(page, channel(page, direction), record, index);
  }
  expect(JSON.stringify(record)).not.toContain("NEVER_EXPORT_PRIVATE_TOKEN");
  await expect(page.locator("#snapshot-json")).not.toHaveValue(/NEVER_EXPORT_PRIVATE_TOKEN/);
  await expect(page.locator("body")).not.toContainText("NEVER_EXPORT_PRIVATE_TOKEN");
});

test("long Graph output shows its full value by default with its original selected source", { tag: "@P1" }, async ({ page }) => {
  const record = await openRecord(page, "graph-io-long");
  const { index, envelope } = rootIO(record, "output");
  const expected = envelope.payload.body;
  expect(expected.length).toBeGreaterThan(480);
  const summary = await runSummary(page);
  expect(summary.output.items[0]).toMatchObject({ value: expected, availability: "available" });
  expect(summary.capture.status).toBe("complete");
  const output = channel(page, "output");
  await expect(output.locator(".run-result-preview, [data-run-expand]")).toHaveCount(0);
  await expect(output.locator(".business-value-text")).toBeVisible();
  expect(await output.locator(".business-value-text").textContent()).toBe(expected);
  await expect(output.locator(".run-copy-value, [data-run-copy-index]")).toHaveCount(0);
  await expectRawEvidence(page, output, record, index);
});
