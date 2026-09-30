import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { openStepSearch, openReadingDirectory, revealSource, expectSelectedEvidence, openAgentScope, openWorkflowScope, openRunInformation, selectAgentStep, selectWorkflowStep, openWorkbenchRecord } from "../helpers/workbench-ui.js";
import { ensureDiagramVisible } from "../helpers/run-viewer-ui.js";
import { agentReader, selectAgentReaderStep, openAgentReaderScope, showAgentGlobalResult, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1360, height: 940 });
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (page, mode, id) => page.locator(mode === "workbench" ? `button[data-inspection-node=${JSON.stringify(id)}], [data-trajectory-step=${JSON.stringify(id)}]` : `button[data-step-id=${JSON.stringify(id)}], [data-trajectory-step=${JSON.stringify(id)}]`);
const detail = (page, mode) => page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
const title = (page, mode, target) => detail(page, mode).locator(target.callId ? ".node-detail-hero h3"
  : mode === "workbench" ? ".step-reading-identity" : "[data-step-identity]");
const search = (page, mode) => page.locator(mode === "workbench" ? "#inspection-search" : "[data-step-search]");

function recordedTargets(record, workflow) {
  const document = projectEinoViewerDocument(record).document;
  const explanation = explainExecutionDAG(document.execution, record.evidence).explanation;
  const sources = record.evidence.map((envelope, index) => ({ envelope, index })).filter(({ envelope }) =>
    envelope.kind === "component.io" && envelope.payload.direction === "output"
    && (workflow ? envelope.payload.nodePath?.length === 2
      : envelope.payload.component === "Tool" && envelope.payload.address?.at(-1)?.id === "lookup_item"));
  expect(sources).toHaveLength(2);
  return sources.map(({ envelope, index }) => {
    // Projection supplies opaque UI IDs only. Identity and result expectations
    // come from the original Recorder address/path and component output body.
    const nodes = document.execution.nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    const group = explanation.groups.find(({ nodeIds }) => nodeIds.includes(node.id));
    expect(group).toBeDefined();
    const groupPath = [];
    for (let current = group; current; current = explanation.groups.find(({ id }) => id === current.parentId)) groupPath.unshift(current.id);
    const callIds = envelope.payload.address.filter(({ type, subId }) => type === "tool" && subId).map(({ subId }) => subId);
    const patterns = workflow
      ? [new RegExp(envelope.payload.nodePath.map(escapePattern).join("\\s*/\\s*"))]
      : callIds.map((id) => new RegExp(escapePattern(id)));
    // A child Agent's caller is part of its saved invocation path, distinct
    // from the tool-call identity that no longer belongs in the step title.
    const agentPath = [];
    let previousAgentIndex = -1;
    for (const [addressIndex, part] of envelope.payload.address.entries()) {
      if (part.type !== "agent") continue;
      const caller = envelope.payload.address.slice(previousAgentIndex + 1, addressIndex).findLast(({ type }) => type === "tool");
      agentPath.push(caller?.subId ? `${part.id} · ${caller.subId}` : part.id);
      previousAgentIndex = addressIndex;
    }
    return { record, node, group, groupPath, agentPath, envelope, index, patterns, callId: callIds.at(-1), value: workflow ? envelope.payload.body : envelope.payload.body.response };
  });
}

async function openRecord(page, mode, text) {
  const record = JSON.parse(text);
  if (mode === "embedded") {
    await page.route("**/__step-identity-reading__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved step identity</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:0"><main id="consumer"></main></body></html>' }));
    await page.goto("/__step-identity-reading__");
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/dist/run-viewer.js");
      window.identityCreateViewer = createEinoRunViewer;
      window.identityViewer = createEinoRunViewer(document.querySelector("#consumer"), input, { locale: "zh" });
    }, record);
  } else {
    await page.goto(mode === "workbench" ? "/.artifacts/pages/?lang=zh" : new URL(".artifacts/portable/eino-viewer.html", root).href);
    if (mode === "workbench") await page.waitForFunction(() => window.playground?.ready);
    else await page.locator("#locale").selectOption("zh");
    if (mode === "workbench") {
      await openWorkbenchRecord(page, text);
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
    } else {
      await page.locator("#record-file").setInputFiles({ name: "step-identity.json", mimeType: "application/json", buffer: Buffer.from(text) });
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    }
  }
  await page.waitForLoadState("networkidle");
  if (mode === "workbench" && record.source === "graph") await openStepSearch(page);
}

async function expectIdentity(locator, target, mode) {
  if (target.callId) {
    if (await locator.evaluate((element) => element.hasAttribute("data-trajectory-record"))) locator = locator.locator(".trajectory-identity strong");
    await expect(locator).toContainText(target.envelope.payload.address.at(-1).id);
    // Internal IDs still identify the real saved invocation, but are not a
    // user-facing suffix. Selection and source assertions below keep identity.
    for (const pattern of target.patterns) await expect(locator).not.toContainText(pattern);
    return;
  }
  for (const pattern of target.patterns) await expect(locator).toContainText(pattern);
}

async function allSteps(page, mode) {
  if (await agentReader(page).count()) { await showAgentGlobalResult(agentReader(page)); return; }
  if (mode === "workbench") {
    if (await page.evaluate(() => window.playground.objectKind === "workflow")) {
      if (await page.evaluate(() => window.playground.scopeReading.mode !== "all")) await page.locator('#hierarchy-breadcrumbs [data-hierarchy-group=""]').click();
      await expect(page.locator("#reading-sidebar, #inspection-search, [data-inspection-node]")).toHaveCount(0);
      return;
    }
    if (await page.evaluate(() => window.playground.objectKind === "agent")) {
      await openRunInformation(page);
      return;
    }
    await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
    await openStepSearch(page);
  } else await page.locator("[data-all-groups]").click();
  await search(page, mode).fill("");
}

async function chooseScope(page, mode, target) {
  await allSteps(page, mode);
  if (target.callId) {
    if (target.group.parentId) await openAgentReaderScope(agentReader(page), target.group.id);
    return;
  }
  if (mode === "workbench" && target.record.source === "workflow") return openWorkflowScope(page, target.group.id);
  if (mode === "workbench") await openReadingDirectory(page);
  const directory = page.locator(mode === "workbench" ? "#hierarchy-directory" : "[data-group-directory]");
  if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
  if (mode === "workbench") {
    for (const id of target.groupPath) await page.locator(`#hierarchy-groups [data-hierarchy-group=${JSON.stringify(id)}]`).click();
    await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", target.group.id);
    await openStepSearch(page);
  } else {
    for (const id of target.groupPath.slice(0, -1)) {
      const branch = directory.locator(`[data-group-children=${JSON.stringify(id)}]`);
      if (await branch.getAttribute("open") === null) await branch.locator(":scope > summary").click();
    }
    await page.locator(`[data-group-select=${JSON.stringify(target.group.id)}]`).click();
    await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", target.group.id);
  }
}

async function checkGraphIdentity(page, mode, target, select = true) {
  if (target.callId) {
    const matches = mode === "workbench" ? await page.evaluate(({ callId, index }) => window.playground.trajectory.records
      .filter((record) => record.kind === "tool" && record.toolCallId === callId && record.evidence.some(({ envelopeIndex }) => envelopeIndex === index))
      .map(({ id }) => id), { callId: target.callId, index: target.index }) : undefined;
    const item = mode === "workbench" ? page.locator(`[data-trajectory-record=${JSON.stringify(matches[0])}]`)
      : page.locator(`[data-trajectory-step=${JSON.stringify(target.node.id)}]`);
    if (matches) expect(matches).toHaveLength(1);
    await expect(item).toHaveCount(1);
    await expectIdentity(mode === "workbench" ? item.locator(".trajectory-identity strong") : item, target, mode);
    if (mode === "workbench") {
      const sequence = await page.evaluate((id) => window.playground.trajectory.records.find((record) => record.id === id).sequence, matches[0]);
      await expect(item.locator(".trajectory-sequence")).toHaveText(String(sequence).padStart(2, "0"));
      if (target.agentPath.length > 1) await expect(item.locator(".trajectory-identity > small")).toHaveText(target.agentPath.join(" / "));
    }
    await item.focus();
    if (select) {
      await page.keyboard.press("Enter");
      await expect(detail(page, mode)).toContainText(String(target.value));
    }
    await expect(page.locator(mode === "workbench" ? "#dag canvas" : "[data-run-graph] canvas")).toHaveCount(0);
    return;
  }
  if (mode === "workbench" && target.record.source === "workflow") {
    await selectWorkflowStep(page, target.node.id);
    await expectIdentity(title(page, mode, target), target, mode);
    for (const pattern of target.patterns) await expect(page.locator("#dag")).toHaveAttribute("aria-label", pattern);
    return;
  }
  if (mode !== "workbench") {
    await ensureDiagramVisible(page.locator("[data-eino-run-viewer]"));
  }
  const host = page.locator(mode === "workbench" ? "#dag" : "[data-run-graph]");
  await expect.poll(() => host.evaluate((element) => [element, ...element.querySelectorAll("*")].some((item) => item._cyreg?.cy))).toBe(true);
  await host.focus();
  await host.press("Home");
  // Whole-run Home selects a different root before testing Enter on the tool.
  // Do not toggle an already-selected node in a one-node scoped graph.
  if (select) await host.press("Enter");
  let reached = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    reached = await host.evaluate((element, id) => {
      const cy = [element, ...element.querySelectorAll("*")].map((item) => item._cyreg?.cy).find(Boolean);
      const current = cy?.nodes(".keyboard-focus").first();
      return (current?.data("path")?.at(-1) || current?.id()) === id;
    }, target.node.id);
    if (reached) break;
    await host.press("ArrowRight");
  }
  expect(reached).toBe(true);
  for (const pattern of target.patterns) await expect(host).toHaveAttribute("aria-label", pattern);
  if (select) {
    await host.press("Enter");
    await expectIdentity(title(page, mode, target), target, mode);
  }
}

function resultValue(text) {
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  return value && typeof value === "object" && Object.hasOwn(value, "response") ? value.response : value;
}

async function checkResultAndSource(page, mode, target, expectCollapsed = false) {
  const agentReading = Boolean(target.callId);
  const workflowCanvas = mode === "workbench" && target.record.source === "workflow";
  if (workflowCanvas) await selectWorkflowStep(page, target.node.id);
  else {
    if (!agentReading) await search(page, mode).fill(target.node.id);
    await expectIdentity(row(page, mode, target.node.id), target, mode);
    if (agentReading) await selectAgentReaderStep(agentReader(page), target.node.id);
    else await row(page, mode, target.node.id).click();
  }
  await expectIdentity(title(page, mode, target), target, mode);
  const values = agentReading ? detail(page, mode).locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^(输出|Output)$/ }) }).locator(".business-value-text")
    : detail(page, mode).locator(mode === "workbench" ? '[data-business-channel="output"] .business-value-text' : '[data-run-channel="output"] [data-run-value]');
  await expect(values.first()).toBeAttached();
  const results = (await values.allTextContents()).map(resultValue);
  expect(results.length).toBeGreaterThan(0);
  // Agent message output and component output may both be present. Every
  // displayed result must still be this exact source value, not its sibling.
  for (const value of results) expect(value).toEqual(target.value);
  if (target.callId) {
    await expect(detail(page, mode).locator(".technical-disclosure, [data-step-identity], button[data-envelope-index]")).toHaveCount(0);
    const indexes = await detail(page, mode).locator('[data-business-channel="output"] [data-evidence-indexes]').evaluateAll((nodes) => nodes.flatMap((node) => JSON.parse(node.dataset.evidenceIndexes)));
    const recordId = await detail(page, mode).getAttribute("data-trajectory-detail");
    const selectedRecord = buildExecutionTrajectory(target.record.evidence).trajectory.records.find(({ id }) => id === recordId);
    const owned = selectedRecord.evidence.map(({ envelopeIndex }) => envelopeIndex);
    expect(owned).toContain(target.index);
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(owned).toContain(index);
      const original = target.record.evidence[index];
      const message = original.kind === "schema.message" ? original.payload : original.kind === "agent.event" ? original.payload.output?.message?.value : undefined;
      if (message) {
        expect(message.role).toBe("tool");
        expect(message.tool_call_id).toBe(target.callId);
        expect(message.content).toBe(target.value);
      } else expect(original.payload.body.response).toBe(target.value);
    }
    if (mode === "workbench") {
      await expectSelectedEvidence(page, target.index, target.envelope);
      expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.toolCallId)).toBe(target.callId);
      expect(await page.evaluate((id) => window.playground.explanation.nodes.find((node) => node.id === id).technical.correlation.toolCallId, target.node.id)).toBe(target.callId);
    } else if (mode === "embedded") await expectAgentAPIEvidence(page, agentReader(page), target.index, target.envelope, "identityViewer");
    if (target.agentPath.length > 1) await expect(detail(page, mode).locator(".agent-scope-path")).toHaveText(target.agentPath.join(" / "));
    return;
  }
  if (mode === "workbench") {
    await expect(detail(page, mode).locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
    await expectSelectedEvidence(page, target.index, target.envelope);
    return;
  }
  if (expectCollapsed) await expect(detail(page, mode).locator(".technical-disclosure")).not.toHaveAttribute("open");
  const source = detail(page, mode).locator(`[data-envelope-index="${target.index}"]`).first();
  await revealSource(source);
  await source.click();
  const raw = page.locator("[data-raw-envelope]");
  await expect(raw).toHaveAttribute("data-envelope-index", String(target.index));
  await expect.poll(async () => JSON.parse(await raw.textContent() || "null")).toEqual(target.envelope);
}

async function checkTrajectoryIdentity(page, targets) {
  // A scope no longer silently returns to the whole run when showing trajectory.
  await openRunInformation(page);
  for (const target of targets) {
    const records = await page.evaluate(({ callId, sourceIndex }) => window.playground.trajectory.records
      .filter((record) => record.kind === "tool" && record.toolCallId === callId
        && record.evidence.some(({ envelopeIndex }) => envelopeIndex === sourceIndex))
      .map(({ id }) => id), { callId: target.callId, sourceIndex: target.index });
    expect(records).toHaveLength(1);
    const item = page.locator(`[data-trajectory-record=${JSON.stringify(records[0])}]`);
    await expectIdentity(item.locator(".trajectory-identity strong"), target, "workbench");
    if (target.agentPath.length > 1) await expect(item.locator(".trajectory-identity > small")).toHaveText(target.agentPath.join(" / "));
    await item.click();
    await expectIdentity(detail(page, "workbench").locator(".node-detail-hero h3"), target, "workbench");
    if (target.agentPath.length > 1) await expect(detail(page, "workbench").locator(".agent-scope-path")).toHaveText(target.agentPath.join(" / "));
    const values = await detail(page, "workbench").locator(".trajectory-detail-value .business-value-text").allTextContents();
    expect(values.map(resultValue)).toContainEqual(target.value);
    await expectSelectedEvidence(page, target.index, target.envelope);
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord.toolCallId)).toBe(target.callId);
  }
}

for (const mode of ["workbench", "embedded", "portable"]) {
  for (const fixture of ["agent-parallel-same-tool", "agent-nested-parallel-scopes", "workflow-nested-names"]) {
    test(`${mode} preserves source step identity for ${fixture} across scope, selection and language`, { tag: "@P0" }, async ({ page }) => {
      const text = readFileSync(new URL(`fixtures/recorder-matrix/${fixture}.json`, root), "utf8");
      const record = JSON.parse(text);
      const workflow = fixture.startsWith("workflow-");
      const targets = recordedTargets(record, workflow);
      expect(new Set(targets.map(({ value }) => value)).size).toBe(2);
      await openRecord(page, mode, text);
      for (const locale of ["zh", "en"]) {
        if (locale === "en") {
          if (mode === "workbench") await page.locator('[data-language="en"]').click();
          else if (mode === "portable") await page.locator("#locale").selectOption("en");
          else await page.evaluate((input) => {
            window.identityViewer.destroy();
            window.identityViewer = window.identityCreateViewer(document.querySelector("#consumer"), input, { locale: "en" });
          }, record);
        }
        await allSteps(page, mode);
        if (!(mode === "workbench" && workflow)) for (const target of targets) await expectIdentity(row(page, mode, target.node.id), target, mode);
        await checkGraphIdentity(page, mode, targets[0]);
        for (const target of targets) {
          await chooseScope(page, mode, target);
          if (mode === "workbench" && workflow) {
            expect(await page.evaluate(() => window.playground.scopeReading.nodeIds)).toContain(target.node.id);
            for (const sibling of targets.filter(({ group }) => group.id !== target.group.id)) {
              expect(await page.evaluate(() => window.playground.scopeReading.nodeIds)).not.toContain(sibling.node.id);
            }
          } else {
            await expectIdentity(row(page, mode, target.node.id), target, mode);
            for (const sibling of targets.filter(({ group }) => group.id !== target.group.id)) await expect(row(page, mode, sibling.node.id)).toHaveCount(0);
          }
          await checkResultAndSource(page, mode, target, mode === "workbench" && fixture === "agent-parallel-same-tool" && locale === "zh");
          await checkGraphIdentity(page, mode, target, false);
        }
        if (mode === "workbench" && !workflow) await checkTrajectoryIdentity(page, targets);
      }
      if (mode === "workbench") {
        expect(await page.evaluate(() => window.playground.document)).toEqual(record);
        for (const target of targets) expect(await page.evaluate((id) => window.playground.executionDAG.nodes.find((node) => node.id === id).label, target.node.id)).toBe(target.node.label);
      } else if (!workflow) {
        if (mode === "embedded") expect(await page.evaluate(() => window.identityViewer.document)).toEqual(projectEinoViewerDocument(record).document);
        // The portable export below verifies every original envelope exactly.
      } else {
        const original = page.locator("[data-original-record]");
        await revealSource(original);
        await expect.poll(async () => JSON.parse(await original.textContent() || "null")).toEqual(record);
      }
      if (mode === "portable") {
        const downloading = page.waitForEvent("download");
        await page.locator("#download-record").click();
        const chunks = [];
        for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(text);
      }
    });
  }
}
