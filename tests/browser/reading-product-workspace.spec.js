import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { buildScopeReading } from "../../src/scope-reading.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { trajectoryRecordValue } from "../../src/trajectory-reading.js";
import { syntheticGraphRecord } from "../helpers/synthetic-record.js";
import { openSample, revealSource, openRunInformation, expectSelectedEvidence, selectAgentStep, openWorkbenchRecord } from "../helpers/workbench-ui.js";

const root = new URL("../../", import.meta.url);
const fixture = (id) => JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${id}.json`, root), "utf8"));
const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

async function openReader(page, mode) {
  if (mode === "workbench") {
    await page.goto("/.artifacts/pages/?lang=zh");
    await page.waitForFunction(() => window.playground?.ready);
  } else if (mode === "portable") await page.goto(new URL(".artifacts/portable/eino-viewer.html", root).href);
  else {
    await page.route("**/__product-workspace__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved run workspace</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main id="viewer"></main><div id="second"></div></body></html>' }));
    await page.goto("/__product-workspace__");
  }
  await page.waitForLoadState("networkidle");
}

async function importRecord(page, mode, record) {
  if (mode === "embedded") {
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/src/run-viewer.js");
      window.createRunViewer = createEinoRunViewer;
      if (window.productViewer) window.productViewer.update(input);
      else {
        window.productClicks = [];
        window.productViewer = createEinoRunViewer(document.querySelector("#viewer"), input, { locale: "zh",
          onNodeClick: ({ id }) => window.productClicks.push(id) });
      }
    }, record);
  } else if (mode === "workbench") {
    await openWorkbenchRecord(page, record);
    await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
  } else {
    await page.locator("#record-file").setInputFiles({ name: "workspace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  }
}

async function expectOriginal(page, mode, record) {
  if (mode === "workbench") expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  else if (await page.locator("#viewer.eino-agent-reader, #viewer .eino-agent-reader").count()) {
    if (mode === "embedded") {
      // The Agent has no raw-record panel. Its public document still retains
      // every original envelope and all projected execution facts unchanged.
      expect(await page.evaluate(() => window.productViewer.document)).toEqual(projectEinoViewerDocument(record).document);
      expect(await page.evaluate(() => window.productViewer.document.evidence)).toEqual(record.evidence);
    } else {
      const downloadReady = page.waitForEvent("download");
      await page.locator("#download-record").click();
      const stream = await (await downloadReady).createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(record);
    }
  }
  else {
    const original = page.locator("#viewer [data-original-record]");
    const disclosure = original.locator("..");
    if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
    await expect.poll(async () => JSON.parse(await original.textContent() || "null")).toEqual(record);
  }
}

async function setLocale(page, mode, locale) {
  if (mode === "workbench") await page.locator(`[data-language="${locale}"]`).click();
  else if (mode === "portable") await page.locator("#locale").selectOption(locale);
  else await page.evaluate(async (locale) => {
    const { setRunViewerLocale } = await import("/src/run-viewer-state.js");
    setRunViewerLocale(window.productViewer, locale);
  }, locale);
}

async function dismissDetails(page, mode) {
  if (await page.locator(".eino-agent-reader").count()) {
    await expect(page.locator(".eino-agent-reader [data-close-step]")).toHaveCount(0);
    await page.locator(".eino-agent-reader .agent-detail-heading").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".eino-agent-reader [data-step-panel]")).toBeHidden();
  } else if (mode === "workbench") {
    await expect(page.locator("#close-details")).toHaveCount(0);
    await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeHidden();
  } else await page.locator("[data-close-step]").click();
}

async function expectAgentSources(page, mode, record, trajectoryRecord) {
  const detail = page.locator(".eino-agent-reader [data-step-detail]");
  await expect(detail).toHaveAttribute("data-trajectory-detail", trajectoryRecord.id);
  await expect(page.locator(`[data-trajectory-record=${JSON.stringify(trajectoryRecord.id)}]`)).toHaveAttribute("aria-pressed", "true");
  for (const direction of ["input", "output"]) {
    const value = trajectoryRecordValue(trajectoryRecord, direction, record.evidence);
    const box = detail.locator(`[data-business-channel="${direction}"] > .business-value`).first();
    if (await box.count()) await expect(box).toHaveAttribute("data-evidence-indexes", JSON.stringify(value.evidenceEnvelopeIndexes || []));
  }
  const expectedIndexes = trajectoryRecord.evidence.map(({ envelopeIndex }) => envelopeIndex);
  if (mode === "workbench") {
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.trajectoryRecord)).toEqual(trajectoryRecord);
    for (const index of expectedIndexes) await expectSelectedEvidence(page, index, record.evidence[index]);
  } else if (mode === "embedded") {
    const selected = await page.evaluate(async () => {
      const { inspectRunViewer } = await import("/src/run-viewer-state.js");
      const reading = inspectRunViewer(window.productViewer);
      return { record: reading.selectedNodeDetail.trajectoryRecord, indexes: reading.linkedSelection.evidenceIndexes,
        sources: reading.linkedSelection.evidenceIndexes.map((index) => window.productViewer.document.evidence[index]) };
    });
    expect(selected.record).toEqual(trajectoryRecord);
    expect(selected.indexes).toEqual(expectedIndexes);
    expect(selected.sources).toEqual(expectedIndexes.map((index) => record.evidence[index]));
  }
}

async function graphFacts(page, mode) {
  return page.locator(mode === "workbench" ? "#dag" : "#viewer [data-run-graph]").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    if (!cy) return null;
    return { zoom: cy.zoom(), pan: cy.pan(), width: cy.width(), height: cy.height(),
      active: cy.nodes(".active-node").map((node) => ({
        path: node.id().split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~")),
        bounds: node.renderedBoundingBox(),
      })) };
  });
}

async function expectActiveStep(page, mode, id) {
  const agent = mode === "workbench" ? await page.evaluate(() => window.playground.objectKind === "agent")
    : await page.locator("[data-eino-run-viewer]").getAttribute("data-eino-run-viewer") === "agent";
  if (agent) {
    const trajectory = page.locator(`[data-trajectory-step=${JSON.stringify(id)}]`);
    await expect(trajectory).toHaveCount(1);
    await expect(trajectory).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(mode === "workbench" ? "#dag canvas, #dag svg" : "[data-run-graph] canvas, [data-run-graph] svg")).toHaveCount(0);
    return;
  }
  await expect.poll(async () => (await graphFacts(page, mode))?.active.map(({ path }) => path)).toEqual([[id]]);
  await expect.poll(async () => {
    const graph = await graphFacts(page, mode), bounds = graph?.active[0]?.bounds;
    return bounds && bounds.x1 >= -1 && bounds.y1 >= -1 && bounds.x2 <= graph.width + 1 && bounds.y2 <= graph.height + 1
      ? "inside" : JSON.stringify({ width: graph?.width, height: graph?.height, bounds });
  }).toBe("inside");
}

async function workbenchGraphLayout(page) {
  return page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
    return {
      nodes: cy.nodes().map((node) => ({ id: node.id(), position: node.position(), ports: node.scratch("einoWorkflowDAG")?.ports || [] })),
      edges: cy.edges().map((edge) => ({ id: edge.id(), source: edge.sourceEndpoint(), target: edge.targetEndpoint(),
        segments: edge.segmentPoints(), route: edge.scratch("einoWorkflowDAG")?._flowAbsRoute || [] })),
    };
  });
}

function wrappedErrorRecord() {
  // A UI-only wrap stress copy, not another real Recorder scenario. The source
  // is intentionally below the character/newline folding thresholds.
  const record = fixture("workflow-io-failed");
  const error = "错误正文".repeat(60);
  record.evidence[0].payload.execution.nodes[0].errorMessage = error;
  return { record, error };
}

function errorReading(page, mode) {
  const detail = page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
  const issue = detail.locator(mode === "workbench" ? ".trajectory-detail-value" : ":scope > .erv-issues");
  return {
    detail, issue,
    preview: issue.locator(mode === "workbench" ? ".run-result-preview" : ".erv-value-preview"),
    expanded: issue.locator(mode === "workbench" ? ".business-value-expanded" : "[data-run-expand]"),
    full: issue.locator(mode === "workbench" ? ".business-value-text" : "[data-run-value]"),
  };
}

async function expectSixLinePreview(preview) {
  await expect(preview).toBeVisible();
  const geometry = await preview.evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight),
      padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) };
  });
  expect(geometry.lineHeight).toBeGreaterThan(0);
  expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 6 + geometry.padding + 2);
}

async function expectCopyButton(button) {
  await expect(button).toBeVisible();
  await expect(button).toHaveJSProperty("tagName", "BUTTON");
  await expect(button).toHaveCSS("border-top-style", "solid");
  await expect(button).toHaveCSS("border-top-width", "1px");
  await expect(button).toHaveCSS("border-right-width", "1px");
  await expect(button).toHaveCSS("border-bottom-width", "1px");
  await expect(button).toHaveCSS("border-left-width", "1px");
  await expect(button).toHaveCSS("border-radius", "6px");
  await expect(button).toHaveCSS("text-align", "center");
  expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(32);
}

async function visiblePreviewLineCount(preview) {
  return preview.evaluate((element) => {
    const bounds = element.getBoundingClientRect(), tops = new Set();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      for (let index = 0; index < text.textContent.length; index += 1) {
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.top < bounds.bottom && rect.bottom > bounds.top) tops.add(rect.top.toFixed(2));
        }
      }
    }
    return tops.size;
  });
}

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode} folds wrap-only error text to six lines while preserving exact expansion, copy and source`, { tag: "@P1" }, async ({ page }) => {
    const { record, error } = wrappedErrorRecord();
    expect(error.length).toBe(240);
    expect(error).not.toContain("\n");
    await openReader(page, mode);
    await importRecord(page, mode, record);
    await page.locator(mode === "workbench" ? '[data-inspection-node="process"]' : '[data-step-list] [data-step-id="process"]').click();
    const { detail, issue, preview, expanded, full } = errorReading(page, mode);
    await expect(expanded).not.toHaveAttribute("open");
    await expectSixLinePreview(preview);
    await expanded.locator(":scope > summary").click();
    await expect(full).toBeVisible();
    await expect(full).toHaveText(error);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text) => { window.copiedWrappedError = text; },
    } }));
    await issue.locator(mode === "workbench" ? ".run-copy-value" : "[data-copy-value]").click();
    expect(await page.evaluate(() => window.copiedWrappedError)).toBe(error);
    await setLocale(page, mode, "en");
    await expect(expanded).toHaveAttribute("open");
    await expect(full).toBeVisible();
    await expect(full).toHaveText(error);
    const source = detail.locator('[data-envelope-index="0"]').first();
    await revealSource(source);
    await source.click();
    if (mode === "workbench") {
      expect(await page.locator("#snapshot-json").evaluate((editor) => JSON.parse(editor.value.slice(editor.selectionStart, editor.selectionEnd))))
        .toEqual(record.evidence[0]);
    } else expect(JSON.parse(await page.locator("[data-raw-envelope]").textContent())).toEqual(record.evidence[0]);
    await expectOriginal(page, mode, record);
  });
}

test("embedded wrap-only values fold after width changes or hidden mounting and dispose pending work", { tag: "@P1" }, async ({ page }) => {
  const { record, error } = wrappedErrorRecord();
  await openReader(page, "embedded");
  await page.locator("#viewer").evaluate((host) => { host.style.width = "1100px"; });
  await importRecord(page, "embedded", record);
  await page.locator('[data-step-list] [data-step-id="process"]').click();
  const reading = errorReading(page, "embedded");
  await expect(reading.full).toBeVisible();
  await expect(reading.full).toHaveText(error);
  await expect(reading.expanded).toBeHidden();
  await page.locator("#viewer").evaluate((host) => { host.style.width = "500px"; });
  await expectSixLinePreview(reading.preview);
  await reading.expanded.locator(":scope > summary").click();
  await expect(reading.full).toHaveText(error);
  await page.evaluate((input) => {
    const host = document.querySelector("#viewer");
    host.style.display = "none";
    host.style.width = "1380px";
    window.productViewer.update(input);
    window.productViewer.selectStep("process");
  }, record);
  await page.locator("#viewer").evaluate((host) => { host.style.display = "block"; });
  await expectSixLinePreview(reading.preview);
  await reading.expanded.locator(":scope > summary").click();
  await expect(reading.full).toHaveText(error);
  await expectOriginal(page, "embedded", record);
  await page.evaluate(async (input) => {
    const host = document.querySelector("#viewer");
    host.style.display = "none";
    window.productViewer.update(input);
    window.productViewer.selectStep("process");
    window.productViewer.destroy();
    host.style.width = "500px";
    host.style.display = "block";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, record);
  await expect(page.locator("#viewer")).toBeEmpty();
});

test("homepage opens real examples without requiring JSON and the current-type selector preserves an accepted record until selection", { tag: "@P1" }, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("eino-workflow-dag-playground-language", "en"));
  await openReader(page, "workbench");
  await expect(page.locator("#record-opening")).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const language of ["en", "zh"]) {
      await page.locator(`[data-language="${language}"]`).click();
      await expect(page.locator(".controls")).toBeHidden();
      await expect(page.locator("#record-file, #record-drop-zone, #import-record, .controls #paste-record, #record-picker, #open-examples, #example-picker, #viewer-kind")).toHaveCount(0);
      await expect(page.locator("[data-open-example]")).toHaveCount(3);
      for (const card of await page.locator("[data-open-example]").all()) {
        await expect(card).toBeVisible();
        await expect(card).toBeEnabled();
        await expect(card.locator(".example-card-copy")).toBeVisible();
        await expect(card.locator(".example-preview")).toBeVisible();
      }
      const layout = await page.locator(".example-card").evaluateAll((cards) => ({
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        cards: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          const preview = card.querySelector(".example-preview").getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            preview: { left: preview.left, right: preview.right, top: preview.top, bottom: preview.bottom,
              width: preview.width, height: preview.height } };
        }),
      }));
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
      for (const [index, card] of layout.cards.entries()) {
        expect(card.left).toBeGreaterThanOrEqual(0);
        expect(card.right).toBeLessThanOrEqual(layout.viewportWidth);
        expect(card.preview.width).toBeGreaterThan(0);
        expect(card.preview.height).toBeGreaterThan(0);
        expect(card.preview.left).toBeGreaterThanOrEqual(card.left);
        expect(card.preview.right).toBeLessThanOrEqual(card.right);
        expect(card.preview.top).toBeGreaterThanOrEqual(card.top);
        expect(card.preview.bottom).toBeLessThanOrEqual(card.bottom);
        if (index > 0) {
          expect(card.top).toBeGreaterThanOrEqual(layout.cards[index - 1].bottom);
          expect(card.left).toBeCloseTo(layout.cards[0].left, 1);
          expect(card.right).toBeCloseTo(layout.cards[0].right, 1);
        }
      }
      await expect(page.locator('[data-example-kind="agent"] [data-preview-trajectory]')).toBeVisible();
      await expect(page.locator('[data-example-kind="agent"] svg')).toHaveCount(0);
      await expect(page.locator('[data-example-kind="graph"] .example-preview svg')).toBeVisible();
      await expect(page.locator('[data-example-kind="workflow"] .example-preview svg')).toBeVisible();
      await expect(page.locator(".integration-entry")).toBeVisible();
      await expect(page.locator("#sample")).toBeHidden();
      await expect(page.locator("#dag canvas, #dag svg")).toHaveCount(0);
      expect(await page.evaluate(() => window.playground.document)).toBeUndefined();
    }
  }
  for (const [kind, id, expectedNodes, expectedEdges] of [
    ["graph", "graph-multistep-loop-success", ["prepare", "evaluate", "revise", "finish"],
      ["prepare:evaluate", "evaluate:revise", "revise:evaluate", "evaluate:finish"]],
    ["workflow", "workflow-parallel-join-success", ["prepare", "fast", "slow", "join"],
      ["prepare:fast", "prepare:slow", "fast:join", "slow:join"]],
  ]) {
    const record = fixture(id);
    const payload = record.evidence.find((envelope) => envelope.kind === (kind === "graph" ? "compose.graph" : "workflow.snapshot")).payload;
    const definition = kind === "graph" ? payload : payload.workflow;
    const sourceNodes = new Set(definition.nodes.map((node) => node.id));
    const sourceEdges = new Set([
      ...definition.edges.map((edge) => `${edge.from}:${edge.to}`),
      ...(definition.branches || []).flatMap((branch) => branch.targets.map((target) => `${branch.from}:${target}`)),
    ]);
    const card = page.locator(`[data-example-kind="${kind}"]`);
    const nodes = await card.locator("[data-preview-node]").evaluateAll((items) => items.map((item) => item.dataset.previewNode));
    const edges = await card.locator("[data-preview-edge]").evaluateAll((items) => items.map((item) => item.dataset.previewEdge));
    expect([...nodes].sort()).toEqual([...expectedNodes].sort());
    expect([...edges].sort()).toEqual([...expectedEdges].sort());
    for (const node of nodes) expect(sourceNodes.has(node)).toBe(true);
    for (const edge of edges) {
      expect(sourceEdges.has(edge)).toBe(true);
      for (const node of edge.split(":")) expect(nodes).toContain(node);
    }
  }
  for (const [kind, id, file] of [
    ["agent", "agent-weather-workflow", "eino-agent-recorder-trip-planner-completed-v1.json"],
    ["graph", "graph-multistep-loop-success", "recorder-matrix/graph-multistep-loop-success.json"],
    ["workflow", "workflow-parallel-join-success", "recorder-matrix/workflow-parallel-join-success.json"],
  ]) {
    if (kind !== "agent") {
      await page.locator(".identity").click();
      await page.waitForFunction(() => window.playground?.ready);
      await expect(page.locator("#record-opening")).toBeVisible();
      expect(new URL(page.url()).searchParams.get("lang")).toBe("zh");
      expect(await page.evaluate(() => localStorage.getItem("eino-workflow-dag-playground-language"))).toBe("en");
      expect(await page.evaluate(() => window.playground.language)).toBe("zh");
      await expect(page.locator('[data-language="zh"]')).toHaveAttribute("aria-pressed", "true");
    }
    const card = page.locator(`[data-open-example="${id}"]`);
    if (kind === "agent") {
      await card.focus();
      await expect(card).toBeFocused();
      await page.keyboard.press("Enter");
    } else if (kind === "graph") await card.locator('[data-preview-node="evaluate"] text').click();
    else await card.locator(".example-preview").click();
    const expected = JSON.parse(readFileSync(new URL(`fixtures/${file}`, root), "utf8"));
    await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(expected);
    await expect(page.locator("#record-opening")).toBeHidden();
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toBeVisible();
    await expect(page.locator("#close-details")).toHaveCount(0);
    if (kind === "agent") {
      const first = page.locator("[data-trajectory-record]").first();
      await expect(first).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => window.playground.linkedSelection.trajectoryRecordId))
        .toBe(await first.getAttribute("data-trajectory-record"));
    } else {
      const first = page.locator("[data-inspection-node]").first();
      await expect(first).toHaveAttribute("aria-current", "true");
      expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id))
        .toBe(await first.getAttribute("data-inspection-node"));
    }
    await expect(page.locator("#record-file, #record-drop-zone, #import-record, .controls #paste-record, #record-picker, #open-examples, #example-picker, #viewer-kind")).toHaveCount(0);
    const sample = page.locator("#sample");
    await expect(sample).toBeVisible();
    await expect(sample).toBeEnabled();
    await expect(sample).toHaveValue(id);
    const options = await sample.locator("option").evaluateAll((items) => items.map((item) => item.value).filter(Boolean));
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) expect(option.startsWith(`${kind}-`) || kind === "graph" && option === "compose-cyclic-graph").toBe(true);
    if (kind === "agent") {
      await expect(page.locator("#record-actions, #scope-information, #global-summary, [data-replay-controls]")).toHaveCount(0);
      await expect(page.locator("#paste-record")).toBeHidden();
      await expect(page.locator("#open-raw")).toBeHidden();
    } else await expect(page.locator("#open-raw")).toBeVisible();
    await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
    if (kind === "agent") {
      await expect(page.locator('.eino-agent-reader [data-agent-trajectory]')).toBeVisible();
      await expect(page.locator("#run-view-tabs")).toBeHidden();
      await expect(page.locator("#dag canvas")).toHaveCount(0);
      await expect(page.locator("[data-trajectory-record]")).toHaveCount(7);
    } else await expect(page.locator("#dag canvas").first()).toBeVisible();
  }
  await openReader(page, "workbench");
  await openSample(page, "graph");
  const record = fixture("graph-io-structured");
  await expectOriginal(page, "workbench", record);
  await expect(page.locator("#record-opening")).toBeHidden();
  await page.locator("[data-inspection-node]").first().click();
  const before = await page.evaluate(() => ({ selection: window.playground.linkedSelection, execution: window.playground.executionDAG }));
  const sample = page.locator("#sample");
  for (const locale of ["en", "zh"]) {
    await sample.focus();
    await expect(sample).toBeFocused();
    await sample.press("Escape");
    await setLocale(page, "workbench", locale);
    await expect(sample).toHaveValue("graph-io-structured");
    await expectOriginal(page, "workbench", record);
    expect(await page.evaluate(() => ({ selection: window.playground.linkedSelection, execution: window.playground.executionDAG }))).toEqual(before);
  }
  await sample.selectOption("graph-multistep-loop-success");
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(fixture("graph-multistep-loop-success"));
  await expect(sample).toHaveValue("graph-multistep-loop-success");
});

for (const mode of ["embedded", "portable"]) {
  test(`${mode} automatically draws exactly 500 steps, requests 501, and never mounts an empty graph`, { tag: "@P1" }, async ({ page }) => {
    test.setTimeout(90000);
    await openReader(page, mode);
    const graph = page.locator("#viewer [data-run-graph]");
    for (const [count, evidenceCount] of [[500, 2003], [501, 2007], [500, 2003], [501, 2007]]) {
      const record = syntheticGraphRecord(evidenceCount);
      expect(projectEinoViewerDocument(record).document.execution.nodes).toHaveLength(count);
      await importRecord(page, mode, record);
      await expect(page.locator("[data-scope-diagram]")).toHaveAttribute("open");
      if (count === 500) {
        await expect(graph.locator("canvas").first()).toBeVisible();
        await expect(page.locator("[data-draw-graph]")).toHaveCount(0);
      } else {
        await expect(graph.locator("canvas")).toHaveCount(0);
        await expect(graph).toHaveAttribute("data-deferred", "true");
        await page.locator("[data-draw-graph]").click();
        await expect(graph.locator("canvas").first()).toBeVisible();
      }
      await expectOriginal(page, mode, record);
    }
    const empty = { schemaVersion: 1, workflow: { nodes: [], edges: [] } };
    await importRecord(page, mode, empty);
    await expect(graph).toHaveAttribute("data-empty", "true");
    await expect(graph.locator("canvas,svg")).toHaveCount(0);
    await expect(page.locator("[data-draw-graph]")).toHaveCount(0);
    await expectOriginal(page, mode, empty);
  });

  test(`${mode} graph policy follows the selected scope and resets manual drawing when returning`, { tag: "@P1" }, async ({ page }) => {
    // Synthetic declaration-only boundary, not an additional real Recorder run.
    const record = { schemaVersion: 1, workflow: { name: "Synthetic scope sizes", nodes: [
      { id: "large", kind: "graph", workflow: { nodes: Array.from({ length: 501 }, (_, i) => ({ id: `node-${i}`, component: "Lambda" })), edges: [] } },
      { id: "small", kind: "graph", workflow: { nodes: [{ id: "one", component: "Lambda" }], edges: [] } },
    ], edges: [] } };
    await openReader(page, mode);
    await importRecord(page, mode, record);
    const graph = page.locator("#viewer [data-run-graph]");
    await expect(graph).toHaveAttribute("data-deferred", "true");
    const directory = page.locator("[data-group-directory]");
    if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
    const children = page.locator('[data-group-children="workflow:%5B%5D"]');
    if (await children.getAttribute("open") === null) await children.locator(":scope > summary").click();
    await page.locator('[data-group-select="workflow:%5B%22small%22%5D"]').click();
    await expect(graph.locator("canvas").first()).toBeVisible();
    await expect(graph).toHaveAttribute("data-deferred", "false");
    await page.locator('[data-group-select="workflow:%5B%22large%22%5D"]').click();
    await expect(graph.locator("canvas")).toHaveCount(0);
    await page.locator("[data-draw-graph]").click();
    await expect(graph.locator("canvas").first()).toBeVisible();
    await page.locator("[data-all-groups]").click();
    await expect(graph).toHaveAttribute("data-deferred", "true");
    await expect(graph.locator("canvas")).toHaveCount(0);
    await expectOriginal(page, mode, record);
  });
}

test("embedded hidden mounts, rapid updates, resize and destruction leave the other instance untouched", { tag: "@P0" }, async ({ page }) => {
  await openReader(page, "embedded");
  const first = fixture("graph-io-structured"), final = fixture("workflow-io-success"), second = fixture("agent-direct-answer");
  await page.evaluate(() => { document.querySelector("#viewer").style.display = "none"; });
  await importRecord(page, "embedded", first);
  await expect(page.locator("#viewer canvas")).toHaveCount(0);
  await page.evaluate(({ first, final, second }) => {
    window.other = window.createRunViewer(document.querySelector("#second"), second, { locale: "en" });
    window.productViewer.update(first);
    window.productViewer.update(final);
    document.querySelector("#viewer").style.display = "block";
  }, { first, final, second });
  await expect(page.locator("#viewer canvas").first()).toBeVisible();
  await expect(page.locator("#second [data-agent-trajectory]")).toBeVisible();
  await expect(page.locator("#second [data-trajectory-record]")).toHaveCount(2);
  await expect(page.locator("#second canvas")).toHaveCount(0);
  const expectedOther = await page.evaluate(() => window.other.document);
  await expectOriginal(page, "embedded", final);
  const priorWidth = await page.locator("#viewer [data-run-graph]").evaluate((host) => host.getBoundingClientRect().width);
  await page.evaluate(() => { document.querySelector("#viewer").style.width = "500px"; });
  await expect.poll(() => page.locator("#viewer [data-run-graph]").evaluate((host) => host.getBoundingClientRect().width)).toBeLessThan(priorWidth);
  await page.evaluate((record) => { window.productViewer.update(record); window.productViewer.destroy(); window.productViewer.destroy(); }, first);
  await expect(page.locator("#viewer [data-eino-run-viewer],#viewer canvas")).toHaveCount(0);
  await expect(page.locator("#second [data-agent-trajectory]")).toBeVisible();
  await expect(page.locator("#second [data-trajectory-record]")).toHaveCount(2);
  expect(await page.evaluate(() => window.other.document)).toEqual(expectedOther);
  await page.evaluate(() => window.other.destroy());
});

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode} readable step names, empty-search recovery and language switches preserve the selected facts`, { tag: "@P1" }, async ({ page }) => {
    const record = fixture("agent-tool-recovered");
    await openReader(page, mode);
    await importRecord(page, mode, record);
    await expect(page.locator("#reading-sidebar, #inspection-search, [data-inspection-node], [data-step-list], [data-step-search], [data-group-directory]")).toHaveCount(0);
    const list = page.locator(".eino-agent-reader [data-agent-trajectory]");
    const search = page.locator(mode === "workbench" ? "#inspection-search" : "[data-step-search]");
    const clear = page.locator(mode === "workbench" ? "#clear-step-search" : "[data-clear-step-search]");
    const step = list.locator('[data-trajectory-step="tool:lookup_profile:call-tool-recovered"]');
    const toolRecord = buildExecutionTrajectory(record.evidence).trajectory.records.find((entry) => entry.toolCallId === "call-tool-recovered");
    await expect(list).toContainText("用户输入");
    await expect(list).toContainText("助手输出");
    await expect(step).toContainText("lookup_profile");
    await expect(step).not.toContainText("tool ·");
    for (const action of ["hover", "focus"]) {
      await step[action]();
      const visible = await step.evaluate((node) => {
        const name = node.querySelector("strong, .erv-step-name, span") || node;
        const style = getComputedStyle(name), rect = name.getBoundingClientRect();
        const rgb = (color) => color.match(/[\d.]+/g)?.map(Number) || [];
        let background = [255, 255, 255];
        for (let element = name; element; element = element.parentElement) {
          const value = rgb(getComputedStyle(element).backgroundColor);
          if (value.length === 3 || value[3] === 1) { background = value; break; }
        }
        const luminance = (color) => color.slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
        const foreground = luminance(rgb(style.color)), behind = luminance(background);
        return { text: node.innerText, color: style.color, opacity: style.opacity, width: rect.width, height: rect.height,
          contrast: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05) };
      });
      expect(visible.text).toContain("lookup_profile");
      expect(visible.color).not.toBe("rgba(0, 0, 0, 0)");
      expect(Number(visible.opacity)).toBeGreaterThan(0);
      expect(visible.width).toBeGreaterThan(0);
      expect(visible.height).toBeGreaterThan(0);
      expect(visible.contrast).toBeGreaterThanOrEqual(4.5);
    }
    await step.click();
    await step.hover();
    await expect(step).toHaveCSS("border-top-color", "rgb(39, 88, 199)");
    await expectActiveStep(page, mode, "tool:lookup_profile:call-tool-recovered");
    if (mode === "embedded") expect(await page.evaluate(() => window.productClicks)).toEqual(["tool:lookup_profile:call-tool-recovered"]);
    const detail = page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
    const output = detail.locator('[data-business-channel="output"] .business-value-text');
    const savedOutput = await output.textContent();
    await expect(detail.locator(".trajectory-detail-values > .trajectory-detail-value > small")).toHaveText(["输入", "输出"]);
    await expect(detail.locator(".trajectory-detail-values .run-copy-value")).toHaveCount(0);
    const inputValue = detail.locator('[data-business-channel="input"] > .business-value');
    await expect(inputValue).toHaveAttribute("data-value-type", "object");
    expect(JSON.parse(await inputValue.locator(".business-value-text").textContent())).toEqual({ customer: "Ada" });
    expect(JSON.parse(savedOutput)).toEqual({ recovered: true, error: "quote provider unavailable", price: 120 });
    await expect(step).toBeVisible();
    await expect(output).toHaveText(savedOutput);
    await setLocale(page, mode, "en");
    await expect(list).toContainText("User input");
    await expect(list).toContainText("Assistant output");
    await expect(output).toHaveText(savedOutput);
    await expect(step).toHaveAttribute("aria-pressed", "true");
    await expectActiveStep(page, mode, "tool:lookup_profile:call-tool-recovered");
    if (mode === "embedded") expect(await page.evaluate(() => window.productClicks)).toEqual(["tool:lookup_profile:call-tool-recovered"]);
    await setLocale(page, mode, "zh");
    await expect(output).toHaveText(savedOutput);
    await expectOriginal(page, mode, record);

    // Every host shares the same trajectory focus origin and saved call.
    await dismissDetails(page, mode);
    await expect(step).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(output).toHaveText(savedOutput);

    const trajectory = page.locator('[data-trajectory-step="tool:lookup_profile:call-tool-recovered"]');
    await trajectory.focus();
    await page.keyboard.press("Enter");
    const trajectoryId = await trajectory.getAttribute("data-trajectory-record");
    // Technical provenance stays verifiable without a duplicate source UI.
    await expect(detail.locator(".technical-disclosure, .step-identity, [data-evidence-sources], button[data-envelope-index]")).toHaveCount(0);
    await expectAgentSources(page, mode, record, toolRecord);
    const sampleValue = mode === "workbench" ? await page.locator("#sample").inputValue() : undefined;
    if (mode === "workbench") {
      await page.locator("#sample").focus();
      await expect(page.locator("#sample")).toBeFocused();
      await page.locator("#sample").press("Escape");
    }
    const selectedRecord = () => mode === "workbench" ? page.evaluate(() => window.playground.linkedSelection.trajectoryRecordId)
      : detail.getAttribute("data-trajectory-detail");
    await expect.poll(selectedRecord).toBe(trajectoryId);
    const trajectoryClicks = mode === "embedded" ? await page.evaluate(() => window.productClicks) : undefined;
    if (trajectoryClicks) expect(trajectoryClicks).toEqual(Array(3).fill("tool:lookup_profile:call-tool-recovered"));
    await setLocale(page, mode, "en");
    if (mode === "workbench") await expect(page.locator("#sample")).toHaveValue(sampleValue);
    await expect.poll(selectedRecord).toBe(trajectoryId);
    await expectAgentSources(page, mode, record, toolRecord);
    await expect(trajectory).toHaveAttribute("aria-pressed", "true");
    if (trajectoryClicks) expect(await page.evaluate(() => window.productClicks)).toEqual(trajectoryClicks);
    await dismissDetails(page, mode);
    await expect(trajectory).toBeFocused();
    await expect.poll(selectedRecord).toBe(trajectoryId);
    await setLocale(page, mode, "zh");
    await expectOriginal(page, mode, record);

    // Graph viewport/activation remains an independent supported mechanism;
    // removing the Agent canvas must not remove its regression protection.
    const graphRecord = fixture("graph-io-structured");
    await importRecord(page, mode, graphRecord);
    await expect.poll(async () => Boolean(await graphFacts(page, mode))).toBe(true);
    const graphList = page.locator(mode === "workbench" ? "#inspection-results" : "[data-step-list]");
    const graphAttr = mode === "workbench" ? "data-inspection-node" : "data-step-id";
    const graphStep = graphList.locator(`[${graphAttr}]`).last();
    const graphId = await graphStep.getAttribute(graphAttr);
    await search.fill("no saved step has this exact name 987654321");
    await expect(graphList.locator(`[${graphAttr}]`)).toHaveCount(0);
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect(search).toHaveValue("");
    await expect(graphStep).toBeVisible();
    await page.locator(mode === "workbench" ? "#dag" : "#viewer [data-run-graph]").evaluate((host) => {
      const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
      window.programmaticGraphTaps = 0;
      cy.on("tap", () => { window.programmaticGraphTaps += 1; });
    });
    await graphStep.click();
    await expectActiveStep(page, mode, graphId);
    expect(await page.evaluate(() => window.programmaticGraphTaps)).toBe(0);
    const clicks = mode === "embedded" ? await page.evaluate(() => window.productClicks) : undefined;
    if (clicks) expect(clicks).toEqual([...Array(3).fill("tool:lookup_profile:call-tool-recovered"), graphId]);
    await page.locator(mode === "workbench" ? "#dag" : "#viewer [data-run-graph]").evaluate((host) => {
      const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
      cy.zoom(cy.zoom() * 0.8);
      cy.pan({ x: cy.pan().x + 6, y: cy.pan().y + 9 });
    });
    const viewport = await graphFacts(page, mode);
    const layout = mode === "workbench" ? await workbenchGraphLayout(page) : undefined;
    await setLocale(page, mode, "en");
    await expect.poll(async () => (await graphFacts(page, mode))?.active.map(({ path }) => path)).toEqual([[graphId]]);
    await expect.poll(async () => (await graphFacts(page, mode))?.zoom).toBeCloseTo(viewport.zoom, 8);
    await expect.poll(async () => (await graphFacts(page, mode))?.pan).toEqual(viewport.pan);
    if (mode === "workbench") await expect.poll(() => workbenchGraphLayout(page)).toEqual(layout);
    if (clicks) expect(await page.evaluate(() => window.productClicks)).toEqual(clicks);
    expect(await page.evaluate(() => window.programmaticGraphTaps)).toBe(0);
    await expectOriginal(page, mode, graphRecord);
  });

  test(`${mode} one error action clears obstructing filters and opens the exact failed step`, { tag: "@P1" }, async ({ page }) => {
    const record = fixture("workflow-io-failed");
    await openReader(page, mode);
    await importRecord(page, mode, record);
    const search = page.locator(mode === "workbench" ? "#inspection-search" : "[data-step-search]");
    await search.fill("no matching step");
    const summary = page.locator(mode === "workbench" ? ":is(#run-result-summary, .eino-agent-reader [data-run-summary])" : "[data-run-summary]");
    await summary.locator('[data-issue-step="process"]').click();
    await expect(search).toHaveValue("");
    const detail = page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("workflow upstream unavailable");
    if (mode === "workbench") expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe("process");
    else await expect(detail).toHaveAttribute("data-step-id", "process");
    await expectActiveStep(page, mode, "process");
    if (mode === "embedded") expect(await page.evaluate(() => window.productClicks)).toEqual(["process"]);
    await expect(detail.locator(mode === "workbench" ? '[data-business-channel="output"] .business-value-text' : '[data-run-channel="output"] [data-run-value]')).toHaveCount(0);
    await expectOriginal(page, mode, record);

    const nested = fixture("agent-nested-failure-propagated");
    const projection = projectEinoViewerDocument(nested).document;
    const explained = explainExecutionDAG(projection.execution, projection.evidence).explanation;
    const child = explained.groups.find((group) => group.parentId);
    const failed = projection.execution.nodes.find((node) => node.status === "failed" && !child.nodeIds.includes(node.id));
    expect(failed).toBeDefined();
    await importRecord(page, mode, nested);
    const childRow = page.locator(`.trajectory-turn[data-trajectory-scope=${JSON.stringify(child.id)}] [data-trajectory-record]`).first();
    const childNodeId = await childRow.getAttribute("data-trajectory-step");
    await childRow.click();
    await detail.locator(`.agent-scope-action[data-hierarchy-group=${JSON.stringify(child.id)}]`).click();
    await expect(page.locator('[data-reading-scope] [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", child.id);
    // This propagated parent Agent event is not a verified child-call
    // boundary error. Do not invent a local issue merely to retain its link.
    const local = buildScopeReading(projection, explained, { groupId: child.id, locale: "zh" });
    expect(local.issues.some(({ nodeId }) => nodeId === failed.id)).toBe(false);
    await expect(page.locator(`[data-local-result] [data-issue-step=${JSON.stringify(failed.id)}]`)).toHaveCount(0);
    await page.locator("[data-scope-global-result]").click();
    await expect(summary).toBeVisible();
    await expect(page.locator("[data-local-result]")).toHaveCount(0);
    await expect(page.locator("#inspection-search, [data-inspection-node], [data-step-search], [data-group-directory]")).toHaveCount(0);
    const target = summary.locator(`[data-issue-step=${JSON.stringify(failed.id)}]`).first();
    await revealSource(target);
    await target.click();
    if (mode === "workbench") {
      expect(await page.evaluate(() => window.playground.linkedSelection.executionNodeId)).toBe(failed.id);
      expect(await page.evaluate(() => window.playground.inspectionScope)).toEqual({ groupId: undefined, ungroupedOnly: false });
    } else {
      await expect(detail).toHaveAttribute("data-step-id", failed.id);
      await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", "");
      await expect(page.locator("[data-reading-scope]")).toHaveAttribute("data-ungrouped-only", "false");
    }
    await expect(detail).toContainText("lookup rejected: failure");
    await expectActiveStep(page, mode, failed.id);
    const failedTrajectoryId = await detail.getAttribute("data-trajectory-detail");
    const failedTrajectory = buildExecutionTrajectory(nested.evidence).trajectory.records.find(({ id }) => id === failedTrajectoryId);
    expect(failedTrajectory.error.message).toContain("lookup rejected: failure");
    await expect(detail.locator("[data-trajectory-error] [data-run-value]")).toHaveText(failedTrajectory.error.message);
    await expectAgentSources(page, mode, nested, failedTrajectory);
    if (mode === "embedded") expect(await page.evaluate(() => window.productClicks)).toEqual(["process", ...(childNodeId ? [childNodeId] : []), failed.id]);
    await expectOriginal(page, mode, nested);
  });
}

test("workbench trajectory selection and language preserve complete Agent content and the current-type selector", { tag: "@P2" }, async ({ page }) => {
  await openReader(page, "workbench");
  const record = fixture("agent-tool-recovered");
  // A UI-only long-input copy checks complete in-place reading. Recorded
  // execution/output and tool ownership stay intact.
  const input = record.evidence.find((entry) => entry.kind === "schema.message" && entry.payload.role === "user");
  const longInput = `${input.payload.content}\n${"保留每一项业务要求及查询条件。\n".repeat(30)}输入正文结束`;
  input.payload.content = longInput;
  await importRecord(page, "workbench", record);
  const inputChannel = page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="input"]');
  const folding = inputChannel.locator("[data-run-expand], .run-result-expanded, .run-result-preview");
  const full = inputChannel.locator("[data-run-value]");
  await expect(folding).toHaveCount(0);
  await expect(full).toBeVisible();
  await expect(full).toHaveText(longInput);
  await expect(page.locator("#record-picker")).toHaveCount(0);
  const sample = page.locator("#sample");
  await expect(sample).toBeVisible();
  const sampleValue = await sample.inputValue();
  const sampleOptions = await sample.locator("option").evaluateAll((options) => options.map(({ value }) => value));
  await expect(page.locator("#reading-sidebar, #inspection-search, [data-inspection-node]")).toHaveCount(0);
  await selectAgentStep(page, "tool:lookup_profile:call-tool-recovered");
  await expect(folding).toHaveCount(0);
  await expect(full).toHaveText(longInput);
  await expect(page.locator("#path-region, [data-scope-diagram], [data-run-graph]")).toHaveCount(0);
  await expect(page.locator(".eino-agent-reader [data-agent-trajectory]")).toBeVisible();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toContainText("lookup_profile");
  await sample.focus();
  await expect(sample).toBeFocused();
  await sample.press("Escape");
  const selected = await page.evaluate(() => window.playground.linkedSelection);
  await setLocale(page, "workbench", "en");
  await expect(sample).toBeVisible();
  await expect(sample).toHaveValue(sampleValue);
  expect(await sample.locator("option").evaluateAll((options) => options.map(({ value }) => value))).toEqual(sampleOptions);
  await expect(page.locator("#record-actions, #global-summary, #scope-information, [data-replay-controls]")).toHaveCount(0);
  await expect(folding).toHaveCount(0);
  await expect(full).toBeVisible();
  await expect(full).toHaveText(longInput);
  await expect(page.locator("#inspection-search")).toHaveCount(0);
  await expect(page.locator("#path-region, [data-scope-diagram], [data-run-graph]")).toHaveCount(0);
  await expect(page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])")).toBeVisible();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected);
  await expectOriginal(page, "workbench", record);
});

async function expectWorkspaceGeometry(page, mode) {
  const boxes = await page.evaluate((mode) => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    const workbench = mode === "workbench";
    return {
      width: document.querySelector(workbench ? ".workbench" : "[data-eino-run-viewer]").clientWidth,
      sidebar: rect(workbench ? "#reading-sidebar" : ".erv-steps"),
      graph: rect(workbench ? ":is(#reading-main, .eino-agent-reader [data-reading-main])" : "[data-reading-main]"),
      detail: rect(workbench ? ":is(#inspector-panel, .eino-agent-reader [data-step-panel])" : "[data-step-panel]"),
      stage: workbench ? rect(":is(.canvas-stage, .eino-agent-reader [data-reading-workspace])") : undefined,
      documentBottom: workbench ? rect(".workbench").bottom : undefined,
      footerHeight: workbench ? rect(".page-footer").height : undefined,
      viewportBottom: innerHeight - scrollY,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }, mode);
  expect(boxes.overflow).toBe(false);
  if (boxes.width >= 1200) {
    expect(boxes.sidebar.width).toBeCloseTo(240, 0);
    expect(boxes.detail.width).toBeCloseTo(320, 0);
    expect(boxes.sidebar.right).toBeLessThanOrEqual(boxes.graph.left + 1);
    expect(boxes.graph.right).toBeLessThanOrEqual(boxes.detail.left + 1);
    expect(boxes.detail.top).toBeCloseTo(boxes.graph.top, 0);
    if (mode === "workbench") {
      expect(boxes.detail.bottom).toBeCloseTo(boxes.stage.bottom, 0);
      expect(boxes.documentBottom - boxes.detail.bottom).toBeLessThanOrEqual(2);
      expect(boxes.detail.bottom).toBeGreaterThanOrEqual(boxes.viewportBottom - boxes.footerHeight - 2);
    }
  } else if (boxes.width >= 768) {
    expect(boxes.sidebar.width).toBeCloseTo(220, 0);
    expect(boxes.sidebar.right).toBeLessThanOrEqual(boxes.graph.left + 1);
    expect(boxes.detail.top).toBeGreaterThanOrEqual(boxes.graph.bottom - 1);
    expect(boxes.detail.left).toBeCloseTo(boxes.graph.left, 0);
  } else {
    expect(boxes.sidebar.top).toBeGreaterThanOrEqual(boxes.graph.bottom - 1);
    expect(boxes.detail.top).toBeGreaterThanOrEqual(boxes.sidebar.bottom - 1);
  }
  return boxes;
}

for (const mode of ["workbench", "embedded", "portable"]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    test(`${mode} keeps graph, directory and selected result readable at ${viewport.width}×${viewport.height}`, { tag: "@P1" }, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await openReader(page, mode);
      const record = fixture("graph-io-structured");
      await importRecord(page, mode, record);
      const output = page.locator(mode === "workbench" ? ':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]' : '[data-run-summary] [data-run-channel="output"]');
      await expect(output).toBeInViewport();
      if (mode === "workbench") {
        const recorded = record.evidence.find((entry) => entry.kind === "component.io"
          && entry.payload.component === "Graph" && entry.payload.direction === "output").payload.body;
        await expect(output.locator(".run-result-preview, [data-run-expand], .run-result-expanded")).toHaveCount(0);
        const full = output.locator("pre[data-run-value]");
        await expect(full).toBeVisible();
        expect(JSON.parse(await full.textContent())).toEqual(recorded);
        expect(await full.evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe("none");
      } else {
        const structuredPreview = output.locator("pre.erv-value-preview");
        await expectSixLinePreview(structuredPreview);
        expect(await structuredPreview.evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe("6");
        expect(await visiblePreviewLineCount(structuredPreview)).toBeLessThanOrEqual(6);
        const padding = await structuredPreview.evaluate((element) => {
          const inner = getComputedStyle(element), outer = getComputedStyle(element.parentElement);
          return { top: inner.paddingTop, bottom: inner.paddingBottom, outerTop: outer.paddingTop, outerBottom: outer.paddingBottom };
        });
        expect(padding).toEqual({ top: "0px", bottom: "0px", outerTop: "12px", outerBottom: "12px" });
      }
      const step = page.locator(mode === "workbench" ? "[data-inspection-node]" : "[data-step-list] [data-step-id]").last();
      const id = await step.getAttribute(mode === "workbench" ? "data-inspection-node" : "data-step-id");
      await step.focus();
      await page.keyboard.press("Enter");
      const detail = page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
      await expect(detail).toBeVisible();
      await expect(detail).toContainText("查找杭州周末路线");
      await expect(detail).toContainText("西湖步行路线");
      if (mode === "workbench") {
        await expect(detail.locator("[data-business-channel] > h4")).toHaveText(["输入", "输出"]);
        await expect(detail.locator("[data-business-channel] .run-copy-value")).toHaveCount(0);
        await expect(detail.locator("[data-business-channel] .run-result-preview, [data-business-channel] .run-result-expanded")).toHaveCount(0);
        for (const direction of ["input", "output"]) {
          const recorded = record.evidence.find((entry) => entry.kind === "component.io"
            && entry.payload.component === "Lambda" && entry.payload.direction === direction).payload.body;
          const full = detail.locator(`[data-business-channel="${direction}"] .business-value-text`);
          await expect(full).toBeVisible();
          expect(JSON.parse(await full.textContent())).toEqual(recorded);
        }
        const readable = await detail.evaluate((element) => {
          const panel = element.closest(":is(#inspector-panel, .eino-agent-reader [data-step-panel])");
          return { height: element.clientHeight, scroll: element.scrollHeight,
            panelHeight: panel.clientHeight, panelScroll: panel.scrollHeight };
        });
        expect(readable.scroll).toBeLessThanOrEqual(readable.height + 1);
        expect(readable.panelScroll).toBeLessThanOrEqual(readable.panelHeight + 1);
      }
      await expectActiveStep(page, mode, id);
      await expectWorkspaceGeometry(page, mode);
      if (testInfo.project.name === "chromium") {
        mkdirSync(new URL(".artifacts/product-refinement/", root), { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: new URL(`.artifacts/product-refinement/after-${mode}-${viewport.width}x${viewport.height}.png`, root).pathname, fullPage: true });
      }
      await expectOriginal(page, mode, record);
    });
  }

  test(`${mode} clipboard rejection explains recovery without changing or hiding the original value`, { tag: "@P2" }, async ({ page }) => {
    await openReader(page, mode);
    const record = fixture("agent-direct-answer");
    await importRecord(page, mode, record);
    if (mode === "workbench") await openRunInformation(page);
    const output = page.locator(mode === "workbench" ? ':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]' : '[data-run-summary] [data-run-channel="output"]');
    const original = await output.locator("[data-run-value]").textContent();
    expect(original).toBe(record.evidence.find((entry) => entry.kind === "agent.event").payload.output.message.value.content);
    const copy = output.locator("[data-copy-value]");
    const feedback = output.locator(".agent-copy-feedback");
    await expectCopyButton(copy);
    const restingBackground = await copy.evaluate((button) => getComputedStyle(button).backgroundColor);
    await copy.hover();
    await expect(copy).not.toHaveCSS("background-color", restingBackground);
    await page.keyboard.press("Tab");
    await copy.focus();
    await expect(copy).toBeFocused();
    await expect(copy).toHaveCSS("outline-style", "solid");
    await expect(copy).toHaveCSS("outline-width", "2px");
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value) => { window.buttonCopiedValue = value; },
    } }));
    const beforeCopy = await copy.boundingBox();
    await copy.press("Enter");
    await expect(copy).toHaveText("复制内容");
    await expect(copy).toHaveAttribute("data-copy-result", "success");
    await expect(feedback).toHaveText("已复制");
    expect(await page.evaluate(() => window.buttonCopiedValue)).toBe(original);
    expect(await copy.boundingBox()).toEqual(beforeCopy);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new DOMException("Clipboard denied in this test", "NotAllowedError"); },
    } }));
    await copy.click();
    await expect(copy).toHaveAttribute("data-copy-result", "failed");
    await expect(feedback).toHaveText("复制失败");
    await expect(feedback).toHaveAttribute("aria-label", "无法自动复制，请选中内容复制。");
    await expect(feedback).toHaveAttribute("title", "无法自动复制，请选中内容复制。");
    expect(await copy.boundingBox()).toEqual(beforeCopy);
    await expect(output.locator("[data-run-value]")).toHaveText(original);
    await expect(output.locator("[data-run-value]")).toBeVisible();
    await expectOriginal(page, mode, record);
    await page.setViewportSize({ width: 390, height: 844 });
    await setLocale(page, mode, "en");
    await copy.click();
    await expect(copy).toHaveText("Copy value");
    await expect(feedback).toHaveText("Copy failed");
    await expect(feedback).toHaveAttribute("aria-label", "Copy unavailable; select the value to copy.");
    await expectCopyButton(copy);
    const channelBounds = await output.boundingBox(), buttonBounds = await copy.boundingBox();
    expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(channelBounds.x + channelBounds.width + 1);
    await page.locator('[data-reading-channel="output"]').click();
    const detail = page.locator('.eino-agent-reader [data-step-detail] [data-business-channel="output"] > .business-value');
    await expect(detail.locator(".run-copy-value")).toHaveCount(0);
    await expect(detail).toHaveAttribute("data-value-type", "string");
    await expect(detail.locator(".business-value-text")).toHaveText(original);
    await expect(detail.locator(".business-value-text")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expectOriginal(page, mode, record);
  });
}

test("embedded container width, not the host viewport, selects the 220px navigation and lower details layout", { tag: "@P1" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReader(page, "embedded");
  await page.locator("#viewer").evaluate((host) => { host.style.width = "1000px"; });
  const record = fixture("graph-io-structured");
  await importRecord(page, "embedded", record);
  await page.locator("[data-step-list] [data-step-id]").last().click();
  const geometry = await expectWorkspaceGeometry(page, "embedded");
  expect(geometry.width).toBeGreaterThanOrEqual(768);
  expect(geometry.width).toBeLessThan(1200);
  await expectOriginal(page, "embedded", record);
});

test("portable rejects a multiple-file drop and cancels an older pending read without replacing the accepted record", { tag: "@P0" }, async ({ page }) => {
  await openReader(page, "portable");
  const accepted = fixture("agent-direct-answer"), pending = fixture("workflow-io-failed");
  await importRecord(page, "portable", accepted);
  await page.evaluate((record) => {
    const readText = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === "pending.json") return new Promise((resolve) => { window.resolvePendingFile = () => resolve(JSON.stringify(record)); });
      return readText.call(this);
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(record)], "pending.json", { type: "application/json" }));
    document.querySelector("#drop-record").dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, pending);
  await expect.poll(() => page.evaluate(() => typeof window.resolvePendingFile)).toBe("function");
  await page.evaluate((record) => {
    const transfer = new DataTransfer();
    for (const name of ["one.json", "two.json"]) transfer.items.add(new File([JSON.stringify(record)], name, { type: "application/json" }));
    document.querySelector("#drop-record").dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, pending);
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await page.evaluate(async () => {
    window.resolvePendingFile();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
  await expectOriginal(page, "portable", accepted);
});

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode} keeps selected details across language changes before a large path has been drawn`, { tag: "@P1" }, async ({ page }) => {
    await openReader(page, mode);
    const record = syntheticGraphRecord(2007);
    await importRecord(page, mode, record);
    const graph = page.locator(mode === "workbench" ? "#dag" : "[data-run-graph]");
    await expect(graph.locator("canvas")).toHaveCount(0);
    const step = page.locator(mode === "workbench" ? "[data-inspection-node]" : "[data-step-list] [data-step-id]").first();
    const id = await step.getAttribute(mode === "workbench" ? "data-inspection-node" : "data-step-id");
    await step.click();
    await setLocale(page, mode, "en");
    const detail = page.locator(mode === "workbench" ? ":is(#node-detail, .eino-agent-reader [data-step-detail])" : "[data-step-detail]");
    await expect(detail).toBeVisible();
    if (mode === "workbench") expect(await page.evaluate(() => window.playground.selectedNodeDetail.explanationNode.id)).toBe(id);
    else await expect(detail).toHaveAttribute("data-step-id", id);
    await expect(graph.locator("canvas")).toHaveCount(0);
    await expectOriginal(page, mode, record);
  });

  test(`${mode} a Tool role plus a digit in its name cannot impersonate Call 2`, { tag: "@P0" }, async ({ page }) => {
    // A naming boundary copy of one real Tool call, not another recorded run.
    const record = JSON.parse(JSON.stringify(fixture("agent-tool-recovered")).replaceAll("lookup_profile", "lookup_2"));
    await openReader(page, mode);
    await importRecord(page, mode, record);
    await setLocale(page, mode, "en");
    await expect(page.locator("#inspection-search, #reading-sidebar, [data-step-search], [data-step-list]")).toHaveCount(0);
    const tool = page.locator('[data-trajectory-step="tool:lookup_2:call-tool-recovered"]');
    await expect(tool).toHaveCount(1);
    await expect(tool.locator("strong")).toHaveText("lookup_2");
    await expect(tool).not.toContainText("Call 2");
    await tool.click();
    await expect(page.locator(".eino-agent-reader [data-step-detail] h3")).toHaveText("lookup_2");
    const toolRecord = buildExecutionTrajectory(record.evidence).trajectory.records.find((entry) => entry.toolCallId === "call-tool-recovered");
    expect(toolRecord.toolCallId).toBe("call-tool-recovered");
    await expectAgentSources(page, mode, record, toolRecord);
    await expectOriginal(page, mode, record);
  });
}

test("workbench preserves an exact selected declaration path through language changes", { tag: "@P1" }, async ({ page }) => {
  await openReader(page, "workbench");
  const record = fixture("workflow-definition-only");
  await importRecord(page, "workbench", record);
  await page.locator("[data-inspection-node]").first().click();
  const selected = await page.evaluate(() => ({ path: window.playground.instance.getActiveNodePath(), selection: window.playground.linkedSelection }));
  expect(selected.path?.length).toBeGreaterThan(0);
  await setLocale(page, "workbench", "en");
  await expect.poll(() => page.evaluate(() => window.playground.instance.getActiveNodePath())).toEqual(selected.path);
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected.selection);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "definition-only");
  await expectOriginal(page, "workbench", record);
});
