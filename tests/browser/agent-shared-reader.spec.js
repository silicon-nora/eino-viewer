import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { openSample } from "../helpers/workbench-ui.js";
import { ensureDiagramVisible } from "../helpers/run-viewer-ui.js";
import { agentReader, agentDetail, agentValue, agentBoundary, openAgentReaderScope, showAgentGlobalResult, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const fixture = (id) => JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${id}.json`, root), "utf8"));
const fixtureId = "agent-nested-distinct-results";
const record = fixture(fixtureId);
const { document } = projectEinoViewerDocument(record);
const { explanation } = explainExecutionDAG(document.execution, document.evidence);
const { trajectory } = buildExecutionTrajectory(record.evidence);
const child = explanation.groups.find(({ parentId }) => parentId);

async function embedded(page, input = record) {
  await page.route("**/__shared-agent-reader__", (route) => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:12px"><main id="first"></main><main id="second"></main></body></html>' }));
  await page.goto("/__shared-agent-reader__");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (input) => {
    const { createEinoRunViewer } = await import("/src/run-viewer.js");
    window.createReader = createEinoRunViewer;
    window.clicks = [];
    window.viewer = createEinoRunViewer(document.querySelector("#first"), input, { locale: "zh", onNodeClick: (event) => window.clicks.push(event) });
  }, input);
}

async function openEntry(page, mode) {
  if (mode === "embedded") return embedded(page);
  if (mode === "workbench") {
    await page.goto("/.artifacts/pages/?lang=zh");
    await page.waitForFunction(() => window.playground?.ready);
    await openSample(page, "agent", fixtureId);
  } else {
    await page.goto(new URL(".artifacts/portable/eino-viewer.html", root).href);
    await page.waitForLoadState("networkidle");
    await page.locator("#record-file").setInputFiles({ name: "same-real-agent.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  }
}

test("all three Agent entries share the accepted reader, exact nesting and parent/child boundaries", { tag: "@P0" }, async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  const snapshots = [];
  for (const mode of ["workbench", "embedded", "portable"]) {
    await openEntry(page, mode);
    const reader = agentReader(page);
    await expect(reader).toHaveCount(1);
    await expect(reader).toHaveClass(/eino-agent-reader/);
    // Compare the shared reading area at the same actual host width; different
    // entry shells are deliberately excluded from the product equivalence.
    await reader.evaluate((element) => { element.style.width = "1040px"; element.style.maxWidth = "100%"; });
    await expect(reader.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
    await expect(agentDetail(reader)).toBeVisible();
    await expect(reader.locator("canvas, [data-group-directory], [data-step-search], [data-close-step]")).toHaveCount(0);
    await expect(agentDetail(reader).locator("[data-copy-value], .run-copy-value, [data-raw-envelope]")).toHaveCount(0);
    await expect(reader.locator('[data-run-result="success"]')).toBeHidden();
    await expect(agentBoundary(reader, "output")).toContainText("parent final: reviewed single");
    const actual = await reader.locator("[data-trajectory-record]").evaluateAll((buttons) => buttons.map((button) => {
      const row = button.closest("li");
      return { id: button.dataset.trajectoryRecord, step: button.dataset.trajectoryStep || null,
        parent: row.dataset.trajectoryParent || null, depth: Number(row.style.getPropertyValue("--trajectory-depth")),
        name: button.querySelector(".trajectory-identity strong").textContent };
    }));
    expect(actual.map(({ id }) => id)).toEqual(trajectory.records.map(({ id }) => id));
    expect(actual.map(({ depth }) => depth)).toEqual([0, 0, 1, 2, 3, 2, 0]);
    expect(actual.map(({ parent }) => parent)).toEqual(trajectory.records.map(({ parentId }) => parentId || null));
    const positions = await reader.locator("[data-trajectory-record]").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().left));
    expect(positions[3] - positions[2]).toBeCloseTo(28, 0);
    expect(positions[4] - positions[3]).toBeCloseTo(28, 0);
    snapshots.push(actual);
    await reader.locator('[data-trajectory-record="nested:2:tool:shared-inner-call"]').click();
    await expect(agentValue(reader, "input").first()).toHaveText(JSON.stringify({ key: "single" }, null, 2));
    await expect(agentValue(reader, "output").first()).toHaveText("lookup:single");
    expect(await agentDetail(reader).locator("[data-business-channel]").evaluateAll((channels) => channels.map((channel) => channel.dataset.businessChannel))).toEqual(["input", "output"]);
    await openAgentReaderScope(reader, child.id);
    await expect(agentBoundary(reader, "output", { local: true })).toContainText("child result:single");
    await expect(agentBoundary(reader, "output", { local: true })).not.toContainText("parent final:");
    await expect(reader.locator("[data-trajectory-record]")).toHaveCount(3);
    await showAgentGlobalResult(reader);
    await expect(agentBoundary(reader, "output")).toContainText("parent final: reviewed single");
    await expect(reader.locator("[data-trajectory-record]")).toHaveCount(7);
  }
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[2]).toEqual(snapshots[0]);
  expect(errors).toEqual([]);
});

test("shared Agent API keeps exact selections through locale, invalid updates and independent mounts", { tag: "@P0" }, async ({ page }) => {
  await embedded(page);
  const reader = page.locator('#first [data-eino-run-viewer="agent"]');
  expect(await page.evaluate(() => window.clicks)).toEqual([]);
  const selected = "nested:2:tool:lookup_item:shared-inner-call";
  await reader.locator(`[data-trajectory-step=${JSON.stringify(selected)}]`).click();
  expect(await page.evaluate(() => window.clicks.map(({ id }) => id))).toEqual([selected]);
  expect(await page.evaluate(() => window.clicks[0].node)).toEqual(document.execution.nodes.find(({ id }) => id === selected));
  await openAgentReaderScope(reader, child.id);
  await page.evaluate((id) => window.viewer.selectStep(id), selected);
  const sourceIndex = explanation.nodes.find(({ id }) => id === selected).output.items[0].evidenceEnvelopeIndexes[0];
  await expectAgentAPIEvidence(page, reader, sourceIndex, record.evidence[sourceIndex]);
  const before = await page.evaluate(() => ({ step: window.viewer.selectedStepId, group: window.viewer.selectedGroupId,
    source: window.viewer.selectedEnvelopeIndex, clicks: window.clicks.length, document: window.viewer.document }));
  await page.evaluate(async () => { const { setRunViewerLocale } = await import("/src/run-viewer-state.js"); setRunViewerLocale(window.viewer, "en"); });
  expect(await page.evaluate(() => ({ step: window.viewer.selectedStepId, group: window.viewer.selectedGroupId,
    source: window.viewer.selectedEnvelopeIndex, clicks: window.clicks.length, document: window.viewer.document }))).toEqual(before);
  await expect(agentValue(reader, "output").first()).toHaveText("lookup:single");
  const html = await reader.innerHTML();
  expect(await page.evaluate(() => { try { window.viewer.update({ schemaVersion: 99 }); } catch (error) { return error.code; } })).toBeTruthy();
  expect(await reader.innerHTML()).toBe(html);
  await page.evaluate((input) => { window.second = window.createReader(document.querySelector("#second"), input); }, fixture("agent-direct-answer"));
  const otherBefore = await page.locator("#second").innerHTML();
  expect(await page.evaluate(() => [window.viewer.selectStep("missing-step"), window.viewer.selectEvidence(-1), window.viewer.selectGroup("missing-group")])).toEqual([false, false, false]);
  expect(await reader.innerHTML()).toBe(html);
  expect(await page.locator("#second").innerHTML()).toBe(otherBefore);
  await page.evaluate((input) => {
    const stale = document.querySelector("#first [data-trajectory-record]");
    window.viewer.update(input);
    window.afterUpdateClicks = window.clicks.length;
    stale.click();
  }, record);
  expect(await page.evaluate(() => window.clicks.length)).toBe(await page.evaluate(() => window.afterUpdateClicks));
  expect(await page.evaluate(() => window.viewer.selectedStepId)).toBe("input:user:1");
  expect(await page.evaluate(() => window.viewer.selectedEnvelopeIndex)).toBeNull();
  await page.evaluate(() => {
    const stale = document.querySelector("#first [data-trajectory-record]");
    window.viewer.destroy(); window.viewer.destroy(); stale.click();
  });
  await expect(page.locator("#first [data-eino-run-viewer]")).toHaveCount(0);
  expect(await page.locator("#second").innerHTML()).toBe(otherBefore);
  await page.evaluate(() => window.second.destroy());
});

test("shared Agent uses container width while switching kinds leaves Graph and Workflow readers intact", { tag: "@P1" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await embedded(page);
  const host = page.locator("#first");
  const reader = host.locator('[data-eino-run-viewer="agent"]');
  for (const width of [390, 1040]) {
    await host.evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    const positions = await reader.locator("[data-trajectory-record]").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().left));
    expect(positions[4] - positions[3]).toBeCloseTo(width < 768 ? 12 : 28, 0);
    expect(await reader.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(reader.locator("[data-trajectory-record]")).toHaveCount(7);
  }
  const styleSignature = (target) => target.evaluate((element) => {
    const selectors = [".trajectory-record", ".run-copy-value", ".business-value-text", ".agent-reader-layout"];
    const properties = ["font-family", "font-size", "font-weight", "line-height", "color", "background-color", "border-top-width", "border-top-color", "border-radius", "padding-top", "padding-left", "display", "grid-template-columns"];
    return selectors.map((selector) => {
      const node = element.querySelector(selector);
      if (!node) throw new Error(`Missing shared Agent element: ${selector}`);
      const style = getComputedStyle(node);
      return Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]));
    });
  });
  const originalStyles = await styleSignature(reader);
  await page.evaluate((input) => {
    document.querySelector("#second").style.width = "1040px";
    window.second = window.createReader(document.querySelector("#second"), input, { locale: "zh" });
  }, fixture("graph-io-structured"));
  await ensureDiagramVisible(page.locator("#second"));
  expect(await styleSignature(reader)).toEqual(originalStyles);
  // Reverse the types in the two actual DOM positions. Styles must be isolated
  // both with a Graph stylesheet after the Agent and with one before it.
  await page.evaluate(({ graph, agent }) => { window.viewer.update(graph); window.second.update(agent); }, { graph: fixture("graph-io-structured"), agent: record });
  expect(await styleSignature(page.locator('#second [data-eino-run-viewer="agent"]'))).toEqual(originalStyles);
  await page.evaluate((input) => { window.second.destroy(); window.viewer.update(input); }, record);
  expect(await styleSignature(reader)).toEqual(originalStyles);
  for (const id of ["graph-io-structured", "workflow-parallel-join-success"]) {
    await page.evaluate((input) => window.viewer.update(input), fixture(id));
    await expect(host.locator(".eino-agent-reader")).toHaveCount(0);
    await expect(host.locator("[data-step-list]")).toBeVisible();
    await ensureDiagramVisible(host);
    await expect(host.locator("[data-run-graph] canvas").first()).toBeVisible();
    await host.locator("[data-step-list] [data-step-id]").last().click();
    await expect(host.locator("[data-step-detail]")).toBeVisible();
    expect(await page.evaluate(() => window.viewer.document.evidence)).toEqual(fixture(id).evidence);
  }
  await page.evaluate((input) => window.viewer.update(input), record);
  await expect(reader).toBeVisible();
  await expect(reader.locator("canvas, [data-step-list], [data-close-step]")).toHaveCount(0);
  await expect(reader.locator("[data-trajectory-record]").first()).toHaveAttribute("aria-pressed", "true");
});
