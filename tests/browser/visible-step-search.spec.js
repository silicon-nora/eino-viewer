import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { agentReader, selectAgentReaderStep, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";
import { openStepSearch, openReadingDirectory, revealSource, expectSelectedEvidence, selectAgentStep, openWorkbenchRecord } from "../helpers/workbench-ui.js";

const root = new URL("../../", import.meta.url);
const errors = new WeakMap();
const rows = (page, mode) => page.locator(mode === "workbench" ? "button[data-inspection-node]" : "button[data-step-id]");
const search = (page, mode) => page.locator(mode === "workbench" ? "#inspection-search" : "[data-step-search]");
const row = (page, mode, id) => page.locator(mode === "workbench" ? `button[data-inspection-node=${JSON.stringify(id)}]` : `button[data-step-id=${JSON.stringify(id)}]`);
const detail = (page, mode) => page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");

test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") messages.push(message.text()); });
  await page.setViewportSize({ width: 1360, height: 940 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

function fixture(name) {
  const text = readFileSync(new URL(`fixtures/recorder-matrix/${name}.json`, root), "utf8");
  const record = JSON.parse(text);
  const document = projectEinoViewerDocument(record).document;
  const explanation = explainExecutionDAG(document.execution, record.evidence).explanation;
  return { text, record, document, explanation, entries: record.evidence.map((envelope, index) => ({ envelope, index })) };
}

function owner(data, source) {
  // The projection gives opaque UI IDs, never the expected match set or label.
  const matches = data.document.execution.nodes.filter(({ evidence }) => evidence.some(({ envelopeIndex }) => envelopeIndex === source.index));
  expect(matches).toHaveLength(1);
  return { ...source, node: matches[0], record: data.record };
}

async function openRecord(page, mode, data) {
  if (mode === "embedded") {
    await page.route("**/__visible-step-search__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visible step search</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:0"><main id="consumer"></main></body></html>' }));
    await page.goto("/__visible-step-search__");
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/dist/run-viewer.js");
      window.searchCreateViewer = createEinoRunViewer;
      window.searchViewer = createEinoRunViewer(document.querySelector("#consumer"), input, { locale: "zh" });
    }, data.record);
  } else {
    await page.goto(mode === "workbench" ? "/.artifacts/pages/?lang=zh" : new URL(".artifacts/portable/eino-viewer.html", root).href);
    if (mode === "workbench") await page.waitForFunction(() => window.playground?.ready);
    else await page.locator("#locale").selectOption("zh");
    if (mode === "workbench") {
      await openWorkbenchRecord(page, data.text);
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(data.record);
    } else {
      await page.locator("#record-file").setInputFiles({ name: "visible-search.json", mimeType: "application/json", buffer: Buffer.from(data.text) });
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    }
  }
  await page.waitForLoadState("networkidle");
  if (mode === "workbench" && data.record.source !== "agent") await openStepSearch(page);
}

async function english(page, mode, data) {
  if (mode === "workbench") {
    await page.locator('[data-language="en"]').click();
    if (data.record.source !== "agent") await openStepSearch(page);
  } else if (mode === "portable") await page.locator("#locale").selectOption("en");
  else await page.evaluate((input) => {
    window.searchViewer.destroy();
    window.searchViewer = window.searchCreateViewer(document.querySelector("#consumer"), input, { locale: "en" });
  }, data.record);
}

async function expectSearch(page, mode, query, targets) {
  await search(page, mode).fill(query);
  await expect.poll(() => rows(page, mode).evaluateAll((buttons) => buttons.map((button) => button.dataset.inspectionNode || button.dataset.stepId).sort()))
    .toEqual(targets.map(({ node }) => node.id).sort());
}

async function issuesOnly(page, mode, checked) {
  if (mode === "workbench") await page.locator("#inspection-scope").selectOption(checked ? "issues" : "steps");
  else await page.locator("[data-issues-only]").setChecked(checked);
}

async function chooseScope(page, mode, data, target) {
  const group = data.explanation.groups.find(({ nodeIds }) => nodeIds.includes(target.node.id));
  expect(group).toBeDefined();
  const path = [];
  for (let current = group; current; current = data.explanation.groups.find(({ id }) => id === current.parentId)) path.unshift(current.id);
  if (mode === "workbench") {
    await openReadingDirectory(page);
    await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  } else await page.locator("[data-all-groups]").click();
  const directory = page.locator(mode === "workbench" ? "#hierarchy-directory" : "[data-group-directory]");
  if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
  if (mode === "workbench") {
    for (const id of path) await page.locator(`#hierarchy-groups [data-hierarchy-group=${JSON.stringify(id)}]`).click();
    await openStepSearch(page);
  } else {
    for (const id of path.slice(0, -1)) {
      const children = directory.locator(`[data-group-children=${JSON.stringify(id)}]`);
      if (await children.getAttribute("open") === null) await children.locator(":scope > summary").click();
    }
    await page.locator(`[data-group-select=${JSON.stringify(group.id)}]`).click();
  }
}

async function expectSource(page, mode, target, direction) {
  const agentReading = Boolean(await agentReader(page).count());
  if (agentReading) await selectAgentReaderStep(agentReader(page), target.node.id);
  else await row(page, mode, target.node.id).click();
  const values = agentReading ? detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: direction === "input" ? /^(输入|Input)$/ : /^(输出|Output)$/ }) }).locator(".business-value-text")
    : detail(page, mode).locator(mode === "workbench" ? `[data-business-channel="${direction}"] .business-value-text` : `[data-run-channel="${direction}"] [data-run-value]`);
  await revealSource(values.first());
  await expect(values.first()).toBeVisible();
  if (target.envelope.kind === "component.io") {
    await expect(values.first()).toBeAttached();
    const expected = target.envelope.payload.body;
    const actual = (await values.allTextContents()).map((text) => { try { return JSON.parse(text); } catch { return text; } });
    // Tool messages may show the same response without the component wrapper.
    for (const value of actual) expect(value?.response ?? value).toEqual(expected?.response ?? expected);
  }
  if (agentReading) {
    await expect(detail(page, mode).locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
    const indexes = await detail(page, mode).locator(`[data-business-channel="${direction}"] [data-evidence-indexes]`).evaluateAll((nodes) => nodes.flatMap((node) => JSON.parse(node.dataset.evidenceIndexes)));
    const recordId = await detail(page, mode).getAttribute("data-trajectory-detail");
    const selectedRecord = buildExecutionTrajectory(target.record.evidence).trajectory.records.find(({ id }) => id === recordId);
    const owned = selectedRecord.evidence.map(({ envelopeIndex }) => envelopeIndex);
    expect(owned).toContain(target.index);
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(owned).toContain(index);
      const original = target.record.evidence[index];
      const message = original.kind === "schema.message" ? original.payload : original.kind === "agent.event" ? original.payload.output?.message?.value : undefined;
      if (message && target.envelope.kind === "component.io") {
        expect(message.role).toBe("tool");
        expect(message.tool_call_id).toBe(target.envelope.payload.address.at(-1).subId);
        expect(message.content).toBe(target.envelope.payload.body.response);
      } else expect(original).toEqual(target.envelope);
    }
    if (mode === "workbench") await expectSelectedEvidence(page, target.index, target.envelope);
    else if (mode === "embedded") await expectAgentAPIEvidence(page, agentReader(page), target.index, target.envelope, "searchViewer");
    return;
  }
  if (mode === "workbench" && target.record.source === "graph") {
    await expect(detail(page, mode).locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
    await expectSelectedEvidence(page, target.index, target.envelope);
    return;
  }
  const button = detail(page, mode).locator(`[data-envelope-index="${target.index}"]`).first();
  await revealSource(button);
  await button.click();
  if (mode === "workbench") {
    expect(await page.locator("#snapshot-json").evaluate((editor) => ({
      index: Number(editor.dataset.selectedEnvelopeIndex),
      value: JSON.parse(editor.value.slice(editor.selectionStart, editor.selectionEnd)),
    }))).toEqual({ index: target.index, value: target.envelope });
    await page.locator("#node-detail-tab").click();
  } else {
    const raw = page.locator("[data-raw-envelope]");
    await expect(raw).toHaveAttribute("data-envelope-index", String(target.index));
    await expect.poll(async () => JSON.parse(await raw.textContent() || "null")).toEqual(target.envelope);
    await expect(detail(page, mode)).toHaveAttribute("data-step-id", target.node.id);
  }
}

async function expectOriginal(page, mode, data) {
  if (mode === "workbench") {
    expect(await page.evaluate(() => window.playground.document)).toEqual(data.record);
    expect(await page.evaluate(() => window.playground.executionDAG)).toEqual(data.document.execution);
  } else if (data.record.source === "agent") {
    if (mode === "embedded") expect(await page.evaluate(() => window.searchViewer.document)).toEqual(data.document);
    else {
      const downloading = page.waitForEvent("download");
      await page.locator("#download-record").click();
      const chunks = [];
      for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString("utf8")).toBe(data.text);
    }
  } else {
    const original = page.locator("[data-original-record]");
    await revealSource(original);
    await expect.poll(async () => JSON.parse(await original.textContent() || "null")).toEqual(data.record);
  }
}

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode} searches visible Graph call numbers and statuses without mixing callbacks or business bodies`, { tag: ["@data-matrix", "@P1"] }, async ({ page }) => {
    for (const outcome of ["success", "failed"]) {
      const data = fixture(`graph-multistep-loop-${outcome}`);
      const calls = data.entries.filter(({ envelope }) => envelope.kind === "callback.event" && envelope.payload.phase === "start")
        .map((entry) => ({ ...owner(data, entry), terminal: data.entries.find(({ envelope }) => envelope.kind === "callback.event"
          && ["end", "error"].includes(envelope.payload.phase) && envelope.correlation.invocationId === entry.envelope.correlation.invocationId)?.envelope }));
      expect(calls.every(({ terminal }) => terminal)).toBe(true);
      const succeeded = calls.filter(({ terminal }) => terminal.payload.phase === "end");
      const failed = calls.filter(({ terminal }) => terminal.payload.phase === "error");
      const evaluate = calls.filter(({ envelope }) => envelope.payload.nodePath?.[0] === "evaluate");
      const revise = calls.filter(({ envelope }) => envelope.payload.nodePath?.[0] === "revise");
      const prepare = calls.find(({ envelope }) => envelope.payload.nodePath?.[0] === "prepare");
      expect(prepare.envelope.correlation.invocationId.endsWith(":2")).toBe(true);
      expect(evaluate).toHaveLength(outcome === "success" ? 3 : 2);
      const second = evaluate[1];
      const secondInput = owner(data, data.entries.find(({ envelope }) => envelope.kind === "component.io" && envelope.payload.direction === "input"
        && envelope.correlation.invocationId === second.envelope.correlation.invocationId));
      expect(secondInput.envelope.payload.body.round).toBe(2);
      await openRecord(page, mode, data);
      for (const locale of ["zh", "en"]) {
        if (locale === "en") await english(page, mode, data);
        await issuesOnly(page, mode, false);
        // Expected status sets come from real callback end/error records.
        await expectSearch(page, mode, "成功", succeeded);
        await expectSearch(page, mode, "失败", failed);
        if (locale === "en") {
          await expectSearch(page, mode, mode === "workbench" ? "Success" : "Succeeded", succeeded);
          // Status words are not reserved syntax: this real run's opaque IDs
          // contain "failed", so ordinary English ID search matches both visits.
          // Chinese status aliases above verify the actual end/error sets.
          if (outcome === "failed") await expectSearch(page, mode, "evaluate Failed", evaluate);
        }
        await expectSearch(page, mode, locale === "zh" ? "evaluate 第 2 次" : "evaluate Call 2", [second]);
        await expect(row(page, mode, second.node.id)).toContainText(locale === "zh" ? "第 2 次" : "Call 2");
        await expectSource(page, mode, secondInput, "input");
        await expectSearch(page, mode, "Call 2", [second, ...(revise[1] ? [revise[1]] : [])]);
        await expect(row(page, mode, prepare.node.id)).toHaveCount(0);
        await expectSearch(page, mode, prepare.node.id, [prepare]);
        await expectSearch(page, mode, "杭州一日路线", []);
        await issuesOnly(page, mode, true);
        await expectSearch(page, mode, locale === "zh" ? "evaluate 第 2 次" : "evaluate Call 2", outcome === "failed" ? [second] : []);
        await expectSearch(page, mode, "成功", []);
        await expectSearch(page, mode, "失败", failed);
      }
      await expectOriginal(page, mode, data);
    }
  });

  test(`${mode} searches visible Workflow paths and preserves original Agent call identities in the trajectory`, { tag: ["@data-matrix", "@P1"] }, async ({ page }) => {
    const workflow = fixture("workflow-nested-names");
    const targets = workflow.entries.filter(({ envelope }) => envelope.kind === "component.io" && envelope.payload.direction === "output"
      && envelope.payload.nodePath?.length === 2).map((entry) => owner(workflow, entry));
    const left = targets.find(({ envelope }) => envelope.payload.nodePath[0] === "left");
    const right = targets.find(({ envelope }) => envelope.payload.nodePath[0] === "right");
    expect(targets).toHaveLength(2);
    await openRecord(page, mode, workflow);
    for (const locale of ["zh", "en"]) {
      if (locale === "en") await english(page, mode, workflow);
      await issuesOnly(page, mode, false);
      await chooseScope(page, mode, workflow, left);
      await expectSearch(page, mode, "Shared step", [left]);
      await expectSearch(page, mode, "Shared step left / shared", [left]);
      await expectSearch(page, mode, "left/shared", [left]);
      await expectSource(page, mode, left, "output");
      await expectSearch(page, mode, "right/shared", []);
      await expectSearch(page, mode, "request/left", []);
      await issuesOnly(page, mode, true);
      await expectSearch(page, mode, "Shared step left / shared", []);
      await issuesOnly(page, mode, false);
      await chooseScope(page, mode, workflow, right);
      await expectSearch(page, mode, "left/shared", []);
      await expectSearch(page, mode, "Shared step right/shared", [right]);
      await expectSource(page, mode, right, "output");
    }
    await expectOriginal(page, mode, workflow);

    const agent = fixture("agent-parallel-same-tool");
    const tools = agent.entries.filter(({ envelope }) => envelope.kind === "component.io" && envelope.payload.component === "Tool"
      && envelope.payload.direction === "output").map((entry) => owner(agent, entry));
    const user = owner(agent, agent.entries.find(({ envelope }) => envelope.kind === "schema.message" && envelope.payload.role === "user"));
    expect(tools).toHaveLength(2);
    await openRecord(page, mode, agent);
    for (const locale of ["zh", "en"]) {
      if (locale === "en") await english(page, mode, agent);
      await expect(page.locator("#reading-sidebar, #inspection-search, #inspection-scope, [data-inspection-node], [data-step-search], [data-step-list]")).toHaveCount(0);
      const originalOrder = buildExecutionTrajectory(agent.record.evidence).trajectory.records.map(({ id }) => id);
      expect(await page.locator("[data-trajectory-record]").evaluateAll((items) => items.map((item) => item.dataset.trajectoryRecord))).toEqual(originalOrder);
      for (const tool of tools) {
        const callId = tool.envelope.payload.address.at(-1).subId;
        const item = page.locator(`[data-trajectory-step=${JSON.stringify(tool.node.id)}]`);
        await expect(item).toHaveCount(1);
        await expect(item.locator("strong")).toHaveText(tool.envelope.payload.address.at(-1).id);
        await expect(item.locator("strong")).not.toContainText(callId);
        await expectSource(page, mode, tool, "output");
        const rowId = await item.getAttribute("data-trajectory-record");
        const originalRow = buildExecutionTrajectory(agent.record.evidence).trajectory.records.find(({ id }) => id === rowId);
        expect(originalRow.toolCallId).toBe(callId);
      }
      await expectSource(page, mode, user, "input");
      await expect(detail(page, mode).locator('[data-business-channel="input"] .business-value-text')).toHaveText(user.envelope.payload.content);
    }
    await expectOriginal(page, mode, agent);
  });
}
