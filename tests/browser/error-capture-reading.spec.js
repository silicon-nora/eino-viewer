import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { openStepSearch, revealSource, openRunInformation, openScopeInformation, expectSelectedEvidence, selectAgentStep, openAgentScope, openWorkbenchRecord } from "../helpers/workbench-ui.js";
import { agentReader, agentDetail, selectAgentReaderStep, openAgentReaderScope, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const variants = [
  { availability: "redacted", capture: { status: "captured", redacted: true }, message: "已脱敏错误：请求标识 [REDACTED]", label: "已脱敏" },
  { availability: "truncated", capture: { status: "captured", truncated: true }, message: "部分错误：trace begins…", label: "源内容已截断" },
  { availability: "not-observed", capture: { status: "omitted", reason: "size_limit" }, message: "[error details omitted by capture policy]", label: "未记录" },
];
const errors = new WeakMap();
const detail = (page, mode) => page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") messages.push(message.text()); });
  await page.setViewportSize({ width: 1360, height: 940 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

function boundaryCopy(name, variant) {
  // UI-only boundary copies of real Recorder fixtures, not additional real
  // recordings. Change only one local callback error and its capture metadata.
  const record = JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${name}.json`, root), "utf8"));
  const sourceIndex = record.evidence.findIndex(({ kind, payload }) => kind === "callback.event" && payload.phase === "error"
    && (name.startsWith("graph-") ? payload.nodePath?.[0] === "process" : payload.address?.at(-1)?.id === "lookup_item"));
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  const source = record.evidence[sourceIndex];
  source.payload.error.message = variant.message;
  source.metadata = { ...source.metadata, capture: { ...variant.capture } };
  const document = projectEinoViewerDocument(record).document;
  const explanation = explainExecutionDAG(document.execution, record.evidence).explanation;
  const owners = document.execution.nodes.filter(({ evidence }) => evidence.some(({ envelopeIndex }) => envelopeIndex === sourceIndex));
  expect(owners).toHaveLength(1);
  return { record, sourceIndex, source, node: owners[0], explanation, text: `${JSON.stringify(record, null, 2)}\n` };
}

async function openRecord(page, mode, data) {
  if (mode === "embedded") {
    await page.route("**/__error-capture-reading__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved error capture</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:0"><main id="consumer"></main></body></html>' }));
    await page.goto("/__error-capture-reading__");
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/dist/run-viewer.js");
      window.errorCaptureViewer = createEinoRunViewer(document.querySelector("#consumer"), input, { locale: "zh" });
    }, data.record);
  } else {
    await page.goto(mode === "workbench" ? "/.artifacts/pages/?lang=zh" : new URL(".artifacts/portable/eino-viewer.html", root).href);
    if (mode === "workbench") await page.waitForFunction(() => window.playground?.ready);
    else await page.locator("#locale").selectOption("zh");
    if (mode === "workbench") {
      await openWorkbenchRecord(page, data.text);
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(data.record);
    } else {
      await page.locator("#record-file").setInputFiles({ name: "synthetic-error-capture-boundary.json", mimeType: "application/json", buffer: Buffer.from(data.text) });
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    }
  }
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text) => { window.errorCaptureCopied = text; },
  } }));
}

async function selectStep(page, mode, id) {
  if (await agentReader(page).count()) return selectAgentReaderStep(agentReader(page), id);
  if (mode === "workbench" && await page.evaluate(() => window.playground.objectKind === "agent")) {
    await selectAgentStep(page, id);
    return;
  }
  if (mode === "workbench") await openStepSearch(page);
  await page.locator(mode === "workbench" ? "#inspection-search" : "[data-step-search]").fill(id);
  await page.locator(mode === "workbench" ? `button[data-inspection-node=${JSON.stringify(id)}]` : `button[data-step-id=${JSON.stringify(id)}]`).click();
}

async function expectErrorValue(page, mode, container, variant, { step = false } = {}) {
  const isAgent = Boolean(await agentReader(page).count());
  const box = container.locator(isAgent || mode === "workbench" ? ".run-result-item, .business-value" : ".erv-value");
  await expect(box).toHaveCount(1);
  await expect(box).toHaveAttribute("data-availability", variant.availability);
  await expect(box).toContainText(variant.label);
  const value = box.locator("[data-run-value], .business-value-text");
  const copies = box.locator("[data-run-copy-index], [data-scope-copy-index], [data-copy-value]");
  if (variant.availability === "not-observed") {
    await expect(box).toContainText("超出大小限制");
    await expect(value).toHaveCount(0);
    await expect(copies).toHaveCount(0);
    // The Go-required notice belongs to Raw only, not a business/error value.
    await expect(box).not.toContainText(variant.message);
    if (isAgent) await expect(box).toHaveAttribute("data-capture-reason", "size_limit");
    else if (mode !== "workbench") await expect(box.locator("[data-capture-reason]")).toHaveAttribute("data-capture-reason", "size_limit");
  } else {
    await expect(value).toHaveCount(1);
    const expected = !isAgent && mode !== "workbench" && step ? { message: variant.message } : variant.message;
    const text = await value.textContent();
    expect(typeof expected === "string" ? text : JSON.parse(text)).toEqual(expected);
    // Workbench details retain their existing text-only presentation. Root,
    // scope and SDK error values expose copy and must preserve the saved value.
    if (mode !== "workbench" || !step) {
      await page.evaluate(() => { window.errorCaptureCopied = null; });
      await copies.click();
      await expect.poll(() => page.evaluate(() => window.errorCaptureCopied)).not.toBeNull();
      const copied = await page.evaluate(() => window.errorCaptureCopied);
      expect(typeof expected === "string" ? copied : JSON.parse(copied)).toEqual(expected);
    }
  }
}

async function expectSource(page, mode, container, data) {
  if (await agentReader(page).count()) {
    await expect(container.locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
    const indexes = await container.locator("[data-evidence-indexes]").evaluateAll((boxes) => boxes.flatMap(({ dataset }) => JSON.parse(dataset.evidenceIndexes)));
    expect(indexes).toContain(data.sourceIndex);
    if (mode === "embedded") await expectAgentAPIEvidence(page, agentReader(page), data.sourceIndex, data.source, "errorCaptureViewer");
    else {
      if (await container.getAttribute("data-step-detail") === null) {
        await container.locator(`[data-run-issue-step=${JSON.stringify(data.node.id)}]`).click();
      }
      await expect(agentDetail(agentReader(page))).toHaveAttribute("data-step-id", data.node.id);
      if (mode === "workbench") await expectSelectedEvidence(page, data.sourceIndex, data.source);
      // The portable shell has no public viewer global or default Raw toolbar;
      // exact original source is verified by its unchanged full-file export.
    }
    return;
  }
  if (mode === "workbench") {
    await expect(container.locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
    if (await container.getAttribute("id") !== "node-detail") await selectStep(page, mode, data.node.id);
    await expectSelectedEvidence(page, data.sourceIndex, data.source);
    return;
  }
  const button = container.locator(`[data-envelope-index="${data.sourceIndex}"]`).first();
  await revealSource(button);
  await button.click();
  const raw = page.locator("[data-raw-envelope]");
  await expect(raw).toHaveAttribute("data-envelope-index", String(data.sourceIndex));
  await expect.poll(async () => JSON.parse(await raw.textContent() || "null")).toEqual(data.source);
}

async function chooseChildScope(page, mode, data) {
  const group = data.explanation.groups.find(({ nodeIds, parentId }) => parentId && nodeIds.includes(data.node.id));
  expect(group).toBeDefined();
  if (await agentReader(page).count()) return openAgentReaderScope(agentReader(page), group.id);
  if (mode === "workbench") {
    await openAgentScope(page, group.id);
    return;
  }
  const path = [];
  for (let current = group; current; current = data.explanation.groups.find(({ id }) => id === current.parentId)) path.unshift(current.id);
  const directory = page.locator("[data-group-directory]");
  if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
  for (const id of path.slice(0, -1)) {
    const children = directory.locator(`[data-group-children=${JSON.stringify(id)}]`);
    if (await children.getAttribute("open") === null) await children.locator(":scope > summary").click();
  }
  await page.locator(`[data-group-select=${JSON.stringify(group.id)}]`).click();
}

async function expectIndependentOutput(page, mode, data) {
  const sourceIndex = data.record.evidence.findIndex(({ kind, payload }) => kind === "component.io" && payload.direction === "output"
    && payload.component === "ChatModel" && payload.address.some(({ type, id }) => type === "agent" && id === "worker"));
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  const nodes = data.explanation.nodes.filter(({ output }) => output.items.some(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(sourceIndex)));
  expect(nodes).toHaveLength(1);
  await selectStep(page, mode, nodes[0].id);
  if (await agentReader(page).count()) {
    const savedBody = data.record.evidence[sourceIndex].payload.body;
    const canonical = data.explanation.nodes.find((node) => node.id === nodes[0].id).output.items;
    expect(canonical.map(({ value }) => value)).toContainEqual(savedBody);
    for (const item of canonical.filter(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(sourceIndex))) expect(item.availability).toBe("available");
    const output = detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) });
    await expect(output.locator(".business-value")).toHaveAttribute("data-availability", "available");
    // Only the saved tool plan is business content; the component's complete
    // message envelope remains unchanged in the public model above.
    const plan = savedBody.message.tool_calls.map(({ function: call }) => ({ name: call.name, arguments: JSON.parse(call.arguments) }));
    expect(JSON.parse(await output.locator(".business-value-text").textContent())).toEqual(plan);
    await expect(detail(page, mode)).toHaveAttribute("data-step-id", nodes[0].id);
    const displayedSources = JSON.parse(await output.locator(".business-value").getAttribute("data-evidence-indexes"));
    expect(displayedSources.length).toBeGreaterThan(0);
    // The trajectory may use the Agent event's tool plan while the same step
    // retains the complete component wrapper. Check each displayed source's
    // original calls, without falsely attributing its value to the wrapper.
    const canonicalSources = canonical.flatMap(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes);
    for (const index of displayedSources) {
      expect(canonicalSources).toContain(index);
      const original = data.record.evidence[index];
      const message = original.kind === "agent.event" ? original.payload.output.message.value : original.payload.body.message;
      expect(message.tool_calls).toEqual(savedBody.message.tool_calls);
    }
    if (mode === "workbench") await expectSelectedEvidence(page, sourceIndex, data.record.evidence[sourceIndex]);
    else if (mode === "embedded") await expectAgentAPIEvidence(page, agentReader(page), sourceIndex, data.record.evidence[sourceIndex], "errorCaptureViewer");
    return;
  }
  const output = detail(page, mode).locator(mode === "workbench" ? '[data-business-channel="output"]' : '[data-run-channel="output"]');
  const boxes = output.locator(mode === "workbench" ? ".business-value" : ".erv-value");
  expect(await boxes.count()).toBeGreaterThan(0);
  for (const box of await boxes.all()) await expect(box).toHaveAttribute("data-availability", "available");
  const values = await output.locator(mode === "workbench" ? ".business-value-text" : "[data-run-value]").allTextContents();
  expect(values.map((text) => JSON.parse(text))).toContainEqual(data.record.evidence[sourceIndex].payload.body);
}

async function expectOriginal(page, mode, data) {
  if (mode === "workbench") expect(await page.evaluate(() => window.playground.document)).toEqual(data.record);
  else if (await agentReader(page).count()) {
    if (mode === "embedded") expect(await page.evaluate(() => window.errorCaptureViewer.document.evidence)).toEqual(data.record.evidence);
  } else {
    const raw = page.locator("[data-original-record]");
    await revealSource(raw);
    await expect.poll(async () => JSON.parse(await raw.textContent() || "null")).toEqual(data.record);
  }
  if (mode === "portable") {
    const downloading = page.waitForEvent("download");
    await page.locator("#download-record").click();
    const chunks = [];
    for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(data.text);
  }
}

for (const mode of ["workbench", "embedded", "portable"]) {
  for (const fixture of ["graph-io-failed", "agent-nested-failure-propagated"]) {
    test(`${mode} preserves error capture boundaries in UI-only copies of ${fixture}`, { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
      for (const variant of variants) {
        const data = boundaryCopy(fixture, variant);
        await openRecord(page, mode, data);
        if (mode === "workbench") await openRunInformation(page);
        const isAgent = fixture.startsWith("agent-");
        const graphWorkbench = mode === "workbench" && !isAgent;
        const reference = page.locator(isAgent
          ? `[data-run-issue-step=${JSON.stringify(data.node.id)}]` : `[data-envelope-index="${data.sourceIndex}"]`);
        if (graphWorkbench) await selectStep(page, mode, data.node.id);
        const issue = graphWorkbench ? detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^错误$/ }) })
          : page.locator(isAgent ? ".eino-agent-reader [data-run-summary] .run-result-issue" : "[data-run-issues] > div").filter({ has: reference });
        await expectErrorValue(page, mode, issue, variant, { step: graphWorkbench });
        await expectSource(page, mode, issue, data);
        await selectStep(page, mode, data.node.id);
        const stepError = isAgent || mode === "workbench" ? detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^错误$/ }) }) : detail(page, mode).locator(":scope > .erv-issues");
        await expectErrorValue(page, mode, stepError, variant, { step: true });
        const output = isAgent
          ? detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) })
          : detail(page, mode).locator(mode === "workbench" ? '[data-business-channel="output"]' : '[data-run-channel="output"]');
        await expect(output.locator("[data-run-value], .business-value-text")).toHaveCount(0);
        await expectSource(page, mode, detail(page, mode), data);

        if (fixture.startsWith("agent-")) {
          await chooseChildScope(page, mode, data);
          if (mode === "workbench") {
            await openScopeInformation(page);
            await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary]), #scope-information, #global-summary")).toHaveCount(0);
          }
          const scopeIssue = agentReader(page).locator("[data-local-result] [data-scope-issue]").filter({ has: reference });
          await expectErrorValue(page, mode, scopeIssue, variant);
          await expectSource(page, mode, scopeIssue, data);
          await expectIndependentOutput(page, mode, data);
          if (mode === "workbench") {
            const records = await page.evaluate((index) => window.playground.trajectory.records.filter((record) => record.kind === "tool"
              && record.evidence.some(({ envelopeIndex }) => envelopeIndex === index)).map(({ id }) => id), data.sourceIndex);
            expect(records).toHaveLength(1);
            await page.locator(`[data-trajectory-record=${JSON.stringify(records[0])}]`).click();
            const error = detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^错误$/ }) });
            await expectErrorValue(page, mode, error, variant, { step: true });
            await expectSource(page, mode, detail(page, mode), data);
          } else {
            const trajectory = page.locator(`[data-trajectory-step=${JSON.stringify(data.node.id)}]`);
            await expect(trajectory).toHaveCount(1);
            await trajectory.click();
            await expect(detail(page, mode)).toHaveAttribute("data-trajectory-detail", await trajectory.getAttribute("data-trajectory-record"));
            // Trajectory errors display the exact saved message; canonical
            // callback details above retain their original error object.
            await expectErrorValue(page, mode, detail(page, mode).locator("[data-trajectory-error]"), variant);
            await expectSource(page, mode, detail(page, mode), data);
          }
        } else {
          const input = detail(page, mode).locator(mode === "workbench" ? '[data-business-channel="input"] .business-value' : '[data-run-channel="input"] .erv-value');
          await revealSource(input);
          await expect(input).toBeVisible();
          await expect(input).toHaveAttribute("data-availability", "available");
          await expect(input).toContainText("失败测试输入");
        }
        await expectOriginal(page, mode, data);
      }
    });
  }
}
