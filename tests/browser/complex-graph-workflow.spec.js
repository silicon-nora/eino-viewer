import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { openStepSearch, selectWorkflowStep, openWorkbenchRecord, openRunInformation, revealSource, expectSelectedEvidence } from "../helpers/workbench-ui.js";

const root = new URL("../../", import.meta.url);
const cases = [
  { id: "graph-multistep-loop-success", source: "graph", paths: ["prepare", "evaluate", "revise", "evaluate", "revise", "evaluate", "finish"] },
  { id: "graph-multistep-loop-failed", source: "graph", paths: ["prepare", "evaluate", "revise", "evaluate"], error: "route evaluation unavailable at round 2" },
  { id: "workflow-parallel-join-success", source: "workflow", paths: ["prepare", "slow", "fast", "join", "finish"] },
  { id: "workflow-parallel-join-failed", source: "workflow", paths: ["prepare", "slow", "fast"], error: "inventory lookup failed" },
];
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") messages.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openRecord(page, mode, scenario, record) {
  await page.setViewportSize(scenario.error ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  if (mode === "embedded") {
    await page.route("**/__complex-static-result__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Complex static result</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:0"><main id="consumer"></main></body></html>' }));
    await page.goto("/__complex-static-result__");
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/dist/run-viewer.js");
      window.complexViewer = createEinoRunViewer(document.querySelector("#consumer"), input, { locale: "zh" });
    }, record);
  } else {
    await page.goto(mode === "workbench" ? "/.artifacts/pages/?lang=zh" : new URL(".artifacts/portable/eino-viewer.html", root).href);
    if (mode === "workbench") {
      await page.waitForFunction(() => window.playground?.ready);
      await openWorkbenchRecord(page, record);
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
      await openRunInformation(page);
    } else {
      await page.locator("#locale").selectOption("zh");
      await page.locator("#record-file").setInputFiles({ name: `${scenario.id}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
      await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
    }
  }
  await page.waitForLoadState("networkidle");
}

async function selectStep(page, mode, id) {
  if (mode === "workbench") {
    if (await page.evaluate(() => window.playground.objectKind === "workflow")) {
      await selectWorkflowStep(page, id);
      return;
    }
    await openStepSearch(page);
    await page.locator("#inspection-search").fill(id);
    await page.locator(`[data-inspection-node=${JSON.stringify(id)}]`).click();
  } else {
    await page.locator("[data-step-search]").fill(id);
    await page.locator(`button[data-step-id=${JSON.stringify(id)}]`).click();
  }
}

async function expectJSONValue(value, expected) {
  await expect(value).toHaveCount(1);
  await revealSource(value);
  await expect(value).toBeVisible();
  expect(JSON.parse(await value.textContent())).toEqual(expected);
}

async function expectEvidence(page, mode, container, record, index) {
  if (mode === "workbench") {
    await expect(container.locator("button[data-envelope-index], .technical-disclosure")).toHaveCount(0);
    await expectSelectedEvidence(page, index, record.evidence[index]);
    return;
  }
  const button = container.locator(`[data-envelope-index="${index}"]`).first();
  await revealSource(button);
  await button.click();
  if (mode === "workbench") {
    const raw = page.locator("#snapshot-json");
    await expect(raw).toBeVisible();
    expect(await raw.evaluate((element) => ({ index: Number(element.dataset.selectedEnvelopeIndex),
      value: JSON.parse(element.value.slice(element.selectionStart, element.selectionEnd)) })))
      .toEqual({ index, value: record.evidence[index] });
    await page.locator("#node-detail-tab").click();
  } else {
    const raw = page.locator("[data-raw-envelope]");
    await expect(raw).toBeVisible();
    await expect(raw).toHaveAttribute("data-envelope-index", String(index));
    expect(JSON.parse(await raw.textContent())).toEqual(record.evidence[index]);
  }
}

async function expectWorkflowEdges(page, mode, scenario, nodes) {
  if (mode !== "workbench") {
    const diagram = page.locator(".erv-diagram");
    if (await diagram.getAttribute("open") === null) await diagram.locator(":scope > summary").click();
  }
  const idToPath = Object.fromEntries(nodes.map((node) => [node.id, node.metadata.sourceNodePath.join("/")]));
  const graph = page.locator(mode === "workbench" ? "#dag" : "[data-run-graph]");
  const expected = scenario.error ? ["prepare→fast", "prepare→slow"]
    : ["prepare→fast", "prepare→slow", "fast→join", "slow→join", "join→finish"];
  await expect.poll(() => graph.evaluate((host, paths) => {
    const cy = [host, ...host.querySelectorAll("*")].map((element) => element._cyreg?.cy).find(Boolean);
    if (!cy) return null;
    const id = (node) => node.data("path")?.at(-1) || node.id();
    return cy.edges().filter((edge) => edge.data("metadata")?.executionEdgeKind)
      .map((edge) => `${paths[id(edge.source())]}→${paths[id(edge.target())]}`).sort();
  }, idToPath)).toEqual(expected.sort());
}

for (const mode of ["workbench", "embedded", "portable"]) {
  for (const scenario of cases) {
    test(`${mode} preserves every real ${scenario.id} value, outcome and source`, { tag: ["@data-matrix", "@P0"] }, async ({ page }, testInfo) => {
      const text = readFileSync(new URL(`fixtures/recorder-matrix/${scenario.id}.json`, root), "utf8");
      const record = JSON.parse(text);
      // Projection supplies opaque selection IDs only. Assertions use recorded
      // bodies and explicit real-Go scenario facts, not a second rendered view.
      const projected = projectEinoViewerDocument(record);
      expect(projected.ok).toBe(true);
      const nodes = projected.document.execution.nodes;
      const entries = record.evidence.map((envelope, index) => ({ envelope, index }));
      const nodeIO = entries.filter(({ envelope }) => envelope.kind === "component.io" && envelope.payload.nodePath?.length);
      const inputs = nodeIO.filter(({ envelope }) => envelope.payload.direction === "input");
      expect(inputs.map(({ envelope }) => envelope.payload.nodePath.join("/")).sort()).toEqual([...scenario.paths].sort());
      const owned = inputs.map(({ index }) => {
        const matches = nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
        expect(matches).toHaveLength(1);
        return matches[0];
      });
      expect(new Set(owned.map(({ id }) => id)).size).toBe(inputs.length);
      expect(nodes).toHaveLength(inputs.length + (scenario.source === "graph" ? 1 : 0));
      expect(owned.filter(({ status }) => status === "failed")).toHaveLength(scenario.error ? 1 : 0);
      await openRecord(page, mode, scenario, record);
      const graphWorkbench = mode === "workbench" && scenario.source === "graph";
      const summary = page.locator(graphWorkbench ? "#node-detail" : mode === "workbench" ? "#run-result-summary" : "[data-run-summary]");
      const outcome = page.locator(`[data-run-result="${scenario.error ? "failed" : "success"}"]`).first();
      if (graphWorkbench) {
        expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.status)).toBe(scenario.error ? "failed" : "success");
        if (scenario.error) await expect(summary.locator(".step-state.failed")).toBeVisible();
        else await expect(summary.locator(".step-state.success")).toHaveCount(0);
      } else if (mode === "workbench") {
        expect(await page.evaluate(() => window.playground.explanation.run.result.state)).toBe(scenario.error ? "failed" : "success");
        await expect(page.locator('[data-workflow-run]')).toHaveAttribute("aria-current", "true");
        if (scenario.error) await expect(outcome).toBeVisible();
        else await expect(outcome).toHaveCount(0);
      } else await expect(outcome).toBeVisible();
      for (const direction of ["input", "output"]) {
        const source = entries.find(({ envelope }) => envelope.kind === "component.io" && !envelope.payload.nodePath?.length
          && envelope.payload.address?.length === 1 && envelope.payload.direction === direction);
        const channel = summary.locator(`[${graphWorkbench ? "data-business-channel" : "data-run-channel"}="${direction}"]`);
        const value = channel.locator(graphWorkbench ? ".business-value-text" : "[data-run-value]");
        if (!source) { await expect(value).toHaveCount(0); continue; }
        await expectJSONValue(value, source.envelope.payload.body);
        if (mode === "workbench") await expect(channel.locator(".run-copy-value")).toHaveCount(0);
        else {
          await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
            value: { writeText: async (value) => { window.complexCopied = value; } } }));
          await channel.locator(mode === "workbench" ? "[data-run-copy-index]" : "[data-copy-value]").click();
          expect(JSON.parse(await page.evaluate(() => window.complexCopied))).toEqual(source.envelope.payload.body);
        }
        await expectEvidence(page, mode, channel, record, source.index);
      }
      if (scenario.source === "workflow") await expectWorkflowEdges(page, mode, scenario, nodes);
      const detail = page.locator(mode === "workbench" ? "#node-detail" : "[data-step-detail]");
      for (let visit = 0; visit < inputs.length; visit += 1) {
        const input = inputs[visit], owner = owned[visit];
        await selectStep(page, mode, owner.id);
        if (mode === "workbench" && owner.status === "success") {
          await expect(detail.locator(".step-state.success")).toHaveCount(0);
          expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.status)).toBe(owner.status);
        } else await expect(detail).toContainText(owner.status === "failed" ? "失败" : "成功");
        for (const direction of ["input", "output"]) {
          const source = nodeIO.find(({ envelope }) => envelope.payload.direction === direction
            && (scenario.source === "graph" ? envelope.correlation.invocationId === input.envelope.correlation.invocationId
              : JSON.stringify(envelope.payload.nodePath) === JSON.stringify(input.envelope.payload.nodePath)));
          const value = detail.locator(mode === "workbench" ? `[data-business-channel="${direction}"] .business-value-text`
            : `[data-run-channel="${direction}"] [data-run-value]`);
          if (source) await expectJSONValue(value, source.envelope.payload.body);
          else await expect(value).toHaveCount(0);
        }
        if (owner.status === "failed") await expect(detail).toContainText(scenario.error);
        const source = nodeIO.find(({ index, envelope }) => envelope.payload.direction === "output"
          && owner.evidence.some(({ envelopeIndex }) => envelopeIndex === index)) || input;
        await expectEvidence(page, mode, detail, record, source.index);
      }
      if (mode === "workbench") expect(await page.evaluate(() => window.playground.document)).toEqual(record);
      else {
        const original = page.locator("[data-original-record]");
        await revealSource(original);
        await expect.poll(async () => JSON.parse(await original.textContent() || "null")).toEqual(record);
      }
      if (testInfo.project.name === "chromium" && mode === "workbench") {
        mkdirSync(new URL(".artifacts/iteration-9/", root), { recursive: true });
        await page.screenshot({ path: new URL(`.artifacts/iteration-9/${scenario.id}.png`, root).pathname, fullPage: true });
      }
      if (mode === "portable") {
        const download = page.waitForEvent("download");
        await page.locator("#download-record").click();
        const chunks = [];
        for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        // This import used JSON.stringify above: export must preserve those exact bytes.
        expect(Buffer.concat(chunks).toString("utf8")).toBe(JSON.stringify(record));
      }
      expect(JSON.stringify(record)).toBe(JSON.stringify(JSON.parse(text)));
    });
  }
}
