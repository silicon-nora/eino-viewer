import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const fixture = (name) => read(`protocol/v2/fixtures/${name}.json`);
const reader = (page) => page.locator('[data-eino-run-viewer][data-record-version="2"]');
const diagram = (page) => reader(page).locator("[data-scope-diagram]");
const detail = (page) => reader(page).locator("[data-step-detail]");
const definition = (page, id) => diagram(page).locator(`g[data-definition-id=${JSON.stringify(id)}]`);
const viewport = (page) => diagram(page).locator("svg > g").first();
const errors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openReader(page, record, { lowLevel = false } = {}) {
  await page.route("**/__protocol-v2-navigation__", (route) => route.fulfill({
    contentType: "text/html",
    headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" },
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protocol v2 navigation</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body style="margin:16px;background:#f3f5f8"><main id="viewer" style="width:100%;height:700px"></main></body></html>',
  }));
  await page.goto("/__protocol-v2-navigation__");
  await page.evaluate(async ({ input, lowLevel }) => {
    const { createEinoRunViewer } = await import("/src/run-viewer.js");
    const { createEinoViewer } = await import("/src/viewer.js");
    window.navigationClicks = [];
    window.navigationViewer = (lowLevel ? createEinoViewer : createEinoRunViewer)(
      document.querySelector("#viewer"), input,
      { locale: "zh", onNodeClick: (event) => window.navigationClicks.push(event.id) },
    );
  }, { input: record, lowLevel });
}

async function readingState(page) {
  return page.evaluate(async () => {
    const { captureRunViewerReading } = await import("/src/run-viewer-state.js");
    return captureRunViewerReading(window.navigationViewer);
  });
}

async function selectDefinition(page, id) {
  // Keyboard activation exercises the same real SVG control even when a
  // deliberately zoomed diagram puts a node outside the visible viewport.
  const node = definition(page, id);
  await node.focus();
  await node.press("Enter");
  await expect(detail(page)).toHaveAttribute("data-entity-kind", "definition");
  await expect(detail(page)).toHaveAttribute("data-entity-id", id);
}

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(name);
  await reader(page).screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function expectRootOutput(page, record) {
  const rootCall = record.invocations.find((call) => call.id === record.run.rootInvocationId);
  const output = reader(page).locator('[data-run-summary] [data-run-channel="output"]');
  for (const id of rootCall.outputRefs) {
    const content = record.contents.find((item) => item.id === id);
    const value = output.locator(`[data-content-id=${JSON.stringify(id)}] [data-run-value]`);
    await expect(value).toHaveCount(1);
    expect(JSON.parse(await value.textContent())).toEqual(content.data.value);
  }
  expect(await page.evaluate(() => window.navigationViewer.selectedGroupId)).toBeNull();
}

test("v2 Graph preserves cycles, edge selection, four directions and the viewport across locale changes", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("graph-loop-repeated-definition");
  await openReader(page, record);
  await expect(reader(page).locator('[data-reading-mode="steps"]')).toHaveAttribute("aria-pressed", "true");
  await reader(page).locator('[data-reading-mode="flow"]').click();
  await expect(definition(page, "d:step")).toHaveAttribute("aria-label", /3 次调用/);
  await expect(diagram(page).locator("path[data-edge-id]")).toHaveCount(record.definitions.find((item) => item.id === "d:graph").edges.length);

  const loop = () => diagram(page).locator('path[data-edge-id="edge:repeat"]');
  await expect(loop()).toHaveAttribute("d", / C /);
  await loop().focus();
  await loop().press("Enter");
  await expect(loop()).toHaveAttribute("data-selected", "true");
  await expect(detail(page).locator("h2")).toHaveText("candidate: d:check → d:step");

  for (const direction of ["LR", "RL", "TB", "BT"]) {
    const control = diagram(page).locator(`[data-layout-direction="${direction}"]`);
    await control.click();
    await expect(control).toHaveAttribute("aria-pressed", "true");
    await expect(loop()).toHaveAttribute("data-selected", "true");
    const centers = await diagram(page).evaluate((host) => {
      const center = (id) => {
        const box = host.querySelector(`g[data-definition-id="${id}"] rect`);
        return { x: Number(box.getAttribute("x")) + Number(box.getAttribute("width")) / 2,
          y: Number(box.getAttribute("y")) + Number(box.getAttribute("height")) / 2 };
      };
      return { step: center("d:step"), check: center("d:check") };
    });
    const axis = direction === "LR" || direction === "RL" ? "x" : "y";
    const difference = centers.check[axis] - centers.step[axis];
    expect(direction === "LR" || direction === "TB" ? difference : -difference).toBeGreaterThan(100);
  }
  await diagram(page).locator('[data-layout-direction="LR"]').click();
  await diagram(page).getByRole("button", { name: "+", exact: true }).click();
  await expect(viewport(page)).toHaveAttribute("transform", /scale\(1\.2\)/);

  // Drag a verified empty patch of the SVG, using browser pointer events.
  await diagram(page).scrollIntoViewIfNeeded();
  const start = await diagram(page).locator("svg").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const y of [.7, .55, .85]) for (const x of [.15, .3, .45]) {
      const point = { x: box.left + box.width * x, y: box.top + box.height * y };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit && svg.contains(hit) && !hit.closest('[role="button"]')) return point;
    }
    return null;
  });
  expect(start, "The flow must expose a real background for panning").not.toBeNull();
  const beforePan = await viewport(page).getAttribute("transform");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 42, start.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect(viewport(page)).not.toHaveAttribute("transform", beforePan);
  const transformed = await viewport(page).getAttribute("transform");

  await selectDefinition(page, "d:step");
  await expect(viewport(page)).toHaveAttribute("transform", transformed);
  await expect(detail(page).locator("button[data-definition-invocation]")).toHaveCount(3);
  await loop().focus();
  await loop().press("Enter");
  const saved = await readingState(page);
  await page.evaluate(async () => {
    const { setRunViewerLocale } = await import("/src/run-viewer-state.js");
    setRunViewerLocale(window.navigationViewer, "en");
  });
  await expect(reader(page)).toHaveAttribute("lang", "en");
  await expect(loop()).toHaveAttribute("data-selected", "true");
  await expect(viewport(page)).toHaveAttribute("transform", transformed);
  expect(await readingState(page)).toEqual(saved);
  await expect(detail(page).locator("h2")).toHaveText("candidate: d:check → d:step");
  await expectRootOutput(page, record);
  await screenshot(page, testInfo, "v2-graph.png");
});

test("v2 definition-only Workflow opens and leaves nested definitions without inventing calls", { tag: "@P0" }, async ({ page }) => {
  const record = fixture("definition-only-workflow");
  await openReader(page, record);
  await expect(reader(page).locator('[data-reading-mode="flow"]')).toHaveAttribute("aria-pressed", "true");
  await expect(diagram(page).locator('[data-layout-direction="LR"]')).toHaveAttribute("aria-pressed", "true");
  await expect(detail(page)).toBeHidden();
  await expect(reader(page).locator("button[data-invocation-id]")).toHaveCount(0);
  await selectDefinition(page, "d:week_report_work_items");
  await expect(detail(page)).toContainText("未观察到执行");
  await expect(detail(page).locator("button[data-definition-invocation]")).toHaveCount(0);
  await detail(page).locator('[data-enter-definition="d:week_report_work_items"]').click();
  await expect(definition(page, "d:week_report_rank_docs")).toBeVisible();
  await expect(definition(page, "d:behavior_heatmap")).toHaveCount(0);
  expect((await readingState(page)).definitionScopeId).toBe("d:week_report_work_items");
  await reader(page).locator("[data-scope-back]").click();
  await expect(definition(page, "d:week_report_work_items")).toBeVisible();
  await expect(definition(page, "d:behavior_heatmap")).toBeVisible();
  await reader(page).locator("[data-scope-root]").click();
  expect((await readingState(page)).definitionScopeId).toBeNull();
  expect(await page.evaluate(() => window.navigationViewer.document.record)).toEqual(record);
  await expect(reader(page).locator("button[data-invocation-id]")).toHaveCount(0);
});

test("v2 executed Workflow starts at the real root and separates selected calls from entered scopes", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("cloud-focus-week-report-normal");
  await openReader(page, record);
  await expect(reader(page).locator("header h2")).toHaveText("应用运行 · 运行结果");
  await expect(reader(page).locator('[data-reading-mode="flow"]')).toHaveAttribute("aria-pressed", "true");
  await expect(diagram(page).locator('[data-layout-direction="LR"]')).toHaveAttribute("aria-pressed", "true");
  await expect(detail(page)).toBeHidden();
  expect(await page.evaluate(() => window.navigationViewer.selectedEntity)).toBeNull();
  await expectRootOutput(page, record);
  await selectDefinition(page, "d:behavior_heatmap");
  await detail(page).locator('[data-definition-invocation="i:behavior_heatmap"]').click();
  await expect(detail(page)).toHaveAttribute("data-entity-kind", "invocation");
  await expect(detail(page)).toHaveAttribute("data-step-id", "i:behavior_heatmap");
  expect(JSON.parse(await detail(page).locator('[data-content-id="c:heatmap"] [data-run-value]').textContent()))
    .toEqual(record.contents.find((content) => content.id === "c:heatmap").data.value);
  await expectRootOutput(page, record);
  await screenshot(page, testInfo, "v2-workflow.png");

  await selectDefinition(page, "d:week_report_work_items");
  await detail(page).locator('[data-definition-invocation="i:week_report_work_items"]').click();
  await detail(page).locator('[data-enter-scope="i:week_report_work_items"]').click();
  expect(await page.evaluate(() => window.navigationViewer.selectedGroupId)).toBe("i:week_report_work_items");
  await expect(definition(page, "d:week_report_rank_docs")).toBeVisible();
  await expect(detail(page)).toBeHidden();
  await expect(reader(page).locator("[data-run-summary] > h3")).toHaveText("局部调用结果 · week_report_work_items");
  await reader(page).locator("[data-scope-back]").click();
  expect(await page.evaluate(() => window.navigationViewer.selectedGroupId)).toBe("i:workflow");
  await expect(definition(page, "d:behavior_heatmap")).toBeVisible();
  await reader(page).locator("[data-scope-root]").click();
  await expectRootOutput(page, record);
});

test("v2 Agent keeps flat message previews and an undispatched request visible", { tag: "@P0" }, async ({ page }, testInfo) => {
  const record = fixture("agent-parallel-interrupted");
  await openReader(page, record);
  const trajectory = reader(page).locator("[data-agent-trajectory]");
  await expect(trajectory).toBeVisible();
  await expect(reader(page).locator("canvas, svg, [data-reading-mode]")).toHaveCount(0);
  await expect(trajectory.locator("button[data-invocation-id]")).toHaveCount(record.invocations.length - 1);
  await expect(trajectory.locator('[data-trajectory-preview="c:left:tool-result"]')).toContainText("Fictional left project completed its draft.");
  await expect(reader(page).locator('[data-run-summary] [data-run-channel="input"]')).toContainText("Compare the two fictional project summaries and render the result.");
  await trajectory.locator('[data-event-id="ev:request:not-dispatched"]').click();
  await expect(detail(page)).toHaveAttribute("data-entity-kind", "event");
  await expect(detail(page)).toHaveAttribute("data-entity-id", "ev:request:not-dispatched");
  await expect(detail(page)).toContainText("已请求 · 未观察到执行");
  await expect(reader(page).locator('[data-run-summary] [data-run-channel="output"]')).toContainText("No final assistant answer was produced before interruption.");
  await screenshot(page, testInfo, "v2-agent.png");
});

async function replaceLowLevel(page, input) {
  await page.evaluate((record) => window.navigationViewer.update(record), input);
}

async function expectPaintedCanvas(page) {
  await expect(page.locator("#viewer canvas").first()).toBeVisible();
  await expect.poll(() => page.locator("#viewer canvas").evaluateAll((canvases) => canvases.some((canvas) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100 || canvas.width < 100 || canvas.height < 100) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let index = 3; index < data.length; index += 64) if (data[index] && ++painted > 25) return true;
    return false;
  })), { message: "The displayed legacy canvas must have nonzero dimensions and painted pixels after replacement" }).toBe(true);
}

test("low-level createEinoViewer replaces v2 and cyclic v1 Graph with a visible interactive SVG", { tag: "@P0" }, async ({ page }) => {
  const native = fixture("graph-loop-repeated-definition");
  const old = read("fixtures/eino-compose-cyclic-graph-envelope-v1.json");
  await openReader(page, native, { lowLevel: true });
  for (let iteration = 0; iteration < 2; iteration++) {
    await replaceLowLevel(page, old);
    await expect(reader(page)).toHaveCount(0);
    const svg = page.locator("#viewer .eino-viewer-graph svg");
    await expect(svg).toBeVisible();
    const box = await svg.boundingBox();
    expect(box.width).toBeGreaterThan(500);
    expect(box.height).toBeGreaterThan(300);
    const node = svg.locator('[data-node-id="model"]');
    await expect(node).toBeVisible();
    await node.click();
    expect(await page.evaluate(() => window.navigationClicks.at(-1))).toBe("model");
    await replaceLowLevel(page, native);
    await expect(reader(page)).toBeVisible();
    await expect(page.locator("#viewer .eino-viewer-graph")).toHaveCount(0);
    expect(await page.evaluate(() => window.navigationViewer.document.record)).toEqual(native);
  }
});

for (const [kind, oldName, nativeName] of [
  ["Graph", "graph-io-structured", "graph-loop-repeated-definition"],
  ["Workflow", "workflow-io-success", "cloud-focus-week-report-normal"],
]) {
  test(`low-level createEinoViewer keeps the ${kind} canvas painted across v1 → v2 → v1 replacements`, { tag: "@P0" }, async ({ page }) => {
    const old = read(`fixtures/recorder-matrix/${oldName}.json`);
    const native = fixture(nativeName);
    await openReader(page, old, { lowLevel: true });
    await expectPaintedCanvas(page);
    for (let iteration = 0; iteration < 2; iteration++) {
      await replaceLowLevel(page, native);
      await expect(reader(page)).toBeVisible();
      await expect(page.locator("#viewer canvas")).toHaveCount(0);
      expect(await page.evaluate(() => window.navigationViewer.document.record)).toEqual(native);
      await replaceLowLevel(page, old);
      await expect(reader(page)).toHaveCount(0);
      await expectPaintedCanvas(page);
      expect(await page.evaluate(() => window.navigationViewer.kind)).toBe(kind.toLowerCase());
    }
  });
}
