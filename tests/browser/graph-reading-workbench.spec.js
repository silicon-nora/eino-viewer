import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { expectSelectedEvidence, openSample, openStepSearch, openWorkbenchRecord } from "../helpers/workbench-ui.js";
import { topologyFacts, topologyNode } from "../helpers/graph-topology-ui.js";

const failures = new WeakMap();
test.beforeEach(async ({ page }) => {
  const messages = [];
  failures.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

function loopRecord(outcome) {
  const id = `graph-multistep-loop-${outcome}`;
  const record = JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${id}.json`, import.meta.url), "utf8"));
  const projection = projectEinoViewerDocument(record);
  expect(projection.ok).toBe(true);
  const sources = record.evidence.map((envelope, index) => ({ envelope, index }));
  // The recorded starts and invocation IDs establish visits independently of
  // the UI's labels. Search must not renumber these actual repeated calls.
  const visits = sources.filter(({ envelope }) => envelope.kind === "callback.event"
    && envelope.payload.phase === "start" && envelope.payload.nodePath?.[0] === "evaluate")
    .map(({ envelope, index }) => ({
      node: projection.document.execution.nodes.find((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index)),
      io: sources.filter(({ envelope: source }) => source.kind === "component.io"
        && source.correlation.invocationId === envelope.correlation.invocationId),
      error: sources.find(({ envelope: source }) => source.kind === "callback.event"
        && source.payload.phase === "error" && source.correlation.invocationId === envelope.correlation.invocationId),
    }));
  expect(visits).toHaveLength(outcome === "success" ? 3 : 2);
  return { id, record, execution: projection.document.execution, nodes: projection.document.execution.nodes, visits };
}

const row = (page, id) => page.locator(`button[data-inspection-node=${JSON.stringify(id)}]`);

async function open(page, fixture, viewport = { width: 1280, height: 720 }) {
  await page.setViewportSize(viewport);
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await openSample(page, "graph", fixture.id);
  await page.waitForLoadState("networkidle");
}

async function expectSelectedVisit(page, fixture, visit) {
  const detail = page.locator("#node-detail");
  await expect(detail).toBeVisible();
  await expect(row(page, visit.node.id)).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode)).toEqual(visit.node);
  const recordedDirections = ["input", "output"].filter((direction) =>
    visit.io.some(({ envelope }) => envelope.payload.direction === direction));
  expect(await detail.locator("[data-business-channel]").evaluateAll((channels) =>
    channels.map((channel) => channel.dataset.businessChannel))).toEqual(recordedDirections);
  await expect(detail.locator(".technical-disclosure, [data-business-channel] .run-copy-value, [data-business-channel] .run-result-preview, [data-business-channel] .run-result-expanded")).toHaveCount(0);
  for (const direction of ["input", "output"]) {
    const source = visit.io.find(({ envelope }) => envelope.payload.direction === direction);
    const value = detail.locator(`[data-business-channel="${direction}"] .business-value-text`);
    if (source) {
      await expect(value).toBeVisible();
      expect(JSON.parse(await value.textContent())).toEqual(source.envelope.payload.body);
      await expectSelectedEvidence(page, source.index, fixture.record.evidence[source.index]);
    } else await expect(value).toHaveCount(0);
  }
  if (visit.error) {
    expect(visit.node.status).toBe("failed");
    await expect(detail.locator(".step-state.failed")).toHaveText(/^(?:失败|Failed)$/i);
    const errorValue = detail.locator(".trajectory-detail-value .business-value-text");
    await expect(errorValue).toBeVisible();
    expect(await errorValue.textContent()).toBe(visit.error.envelope.payload.error.message);
    await expectSelectedEvidence(page, visit.error.index, fixture.record.evidence[visit.error.index]);
  }
  await expect.poll(async () => (await topologyFacts(page)).nodes.filter(({ active }) => active).map(({ id }) => id)).toEqual(["evaluate"]);
  const picker = page.locator("select[data-graph-visit]");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue(visit.node.id);
  expect(await picker.locator("option").evaluateAll((options) => options.map((option) => option.value)))
    .toEqual(fixture.visits.map(({ node }) => node.id));
}

async function expectLogicalGraph(page, fixture, outcome) {
  const displayed = await topologyFacts(page);
  const definition = fixture.record.evidence.find(({ kind }) => kind === "compose.graph").payload;
  // Declared branches, including unobserved alternatives, are not execution
  // parent/child links. Derive this contract from the unmodified source.
  expect(displayed.nodes.map(({ id }) => id).sort()).toEqual(["start", "end", ...definition.nodes.map(({ id }) => id)].sort());
  expect(displayed.nodes).toHaveLength(7);
  expect(displayed.nodes.filter(({ active }) => active)).toEqual([]);
  const expectedEdges = [...definition.edges.map(({ from, to }) => ({ from, to, kind: "edge" })),
    ...definition.branches.flatMap(({ from, targets }) => targets.map((to) => ({ from, to, kind: "branch" })))];
  expect(displayed.edges.map(({ from, to, kind }) => ({ from, to, kind }))).toEqual(expectedEdges);
  expect(displayed.edges.filter(({ from, kind }) => from === "evaluate" && kind === "branch").map(({ to }) => to).sort())
    .toEqual(["fallback", "finish", "revise"]);
  expect(displayed.edges.find(({ from, to }) => from === "revise" && to === "evaluate").path).toBeTruthy();
  await expect(page.locator('#dag [data-graph-edge][data-status], #dag [data-graph-edge][data-count], #dag [data-graph-edge][data-observed]')).toHaveCount(0);
  const evaluate = displayed.nodes.filter(({ id }) => id === "evaluate");
  expect(evaluate).toHaveLength(1);
  expect(evaluate[0].members).toEqual(fixture.visits.map(({ node }) => node.id));
  expect(evaluate[0].label).toContain(`执行 ${outcome === "success" ? 3 : 2} 次`);
  if (outcome === "failed") {
    expect(evaluate[0].label).toContain("1 次失败");
    expect(evaluate[0].counts.failed).toBe(1);
  }
  expect(displayed.nodes.flatMap(({ members }) => members).sort()).toEqual(fixture.nodes.slice(1).map(({ id }) => id).sort());
  const fallback = displayed.nodes.find(({ id }) => id === "fallback");
  expect(fallback).toMatchObject({ members: [], counts: {}, status: "not-observed" });
  expect(fallback.label).toContain("未观测到执行");
  if (outcome === "failed") expect(displayed.nodes.find(({ id }) => id === "finish"))
    .toMatchObject({ members: [], counts: {}, status: "not-observed" });
  for (const id of ["start", "end"]) {
    await expect(topologyNode(page, id)).toHaveAttribute("role", "img");
    await expect(topologyNode(page, id)).not.toHaveAttribute("tabindex", "0");
  }
  const branches = await page.locator('#dag [data-graph-edge][data-edge-kind="branch"]').evaluateAll((edges) =>
    edges.map((edge) => ({ dashed: getComputedStyle(edge).strokeDasharray, marker: edge.getAttribute("marker-end") })));
  expect(branches.every(({ dashed, marker }) => dashed !== "none" && Boolean(marker))).toBe(true);
  if (outcome === "success") {
    // Inspect the actual drawn curves, not model endpoints. The conditional
    // evaluate→fallback/finish routes skip revise's row and must go around it.
    const crossings = await page.locator('#dag svg[data-graph-topology]').evaluate((svg) => {
      const boxes = [...svg.querySelectorAll('[data-graph-node]')].map((node) => ({
        id: node.dataset.graphNode, box: node.querySelector('rect').getBoundingClientRect(),
      }));
      const intersections = [];
      for (const edge of svg.querySelectorAll('[data-graph-edge]')) {
        const length = edge.getTotalLength(), matrix = edge.getScreenCTM();
        for (let offset = 1; offset < length; offset += 2) {
          const point = edge.getPointAtLength(offset).matrixTransform(matrix);
          const hit = boxes.find(({ id, box }) => ![edge.dataset.from, edge.dataset.to].includes(id)
            && point.x > box.left + 1 && point.x < box.right - 1 && point.y > box.top + 1 && point.y < box.bottom - 1);
          if (hit) {
            intersections.push({ from: edge.dataset.from, to: edge.dataset.to, crossed: hit.id });
            break;
          }
        }
      }
      return intersections;
    });
    expect(crossings).toEqual([]);
  }
  expect(await page.evaluate(() => window.playground.executionDAG)).toEqual(fixture.execution);
}

async function activateLogicalEvaluate(page) {
  await topologyNode(page, "evaluate").focus();
  await topologyNode(page, "evaluate").press("Enter");
}

async function expectQuietControls(page) {
  await expect(page.locator("#open-raw, #raw-records-tab, #node-detail-tab, #close-details, #inspection-next-issue").filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('#inspection-scope option[value="evidence"], #inspection-scope option[value="unassigned"]')).toHaveCount(0);
  await expect(page.locator("#hierarchy-directory")).toBeHidden();
  await expect(page.locator("#node-detail .technical-disclosure")).toHaveCount(0);
  await expect(page.locator("#node-detail button[data-envelope-index], #run-result-summary button[data-envelope-index]")).toHaveCount(0);
  await expect(page.locator('.step-state.success:visible, [data-run-result="success"]:visible')).toHaveCount(0);
}

test("Graph workbench keeps real loop visits and source-bound values in its simplified reading flow", { tag: "@P0" }, async ({ page }) => {
  test.setTimeout(60000);
  for (const outcome of ["success", "failed"]) {
    const fixture = loopRecord(outcome);
    await open(page, fixture);
    const summary = page.locator("#global-summary");
    if (outcome === "success") await expect(summary).not.toHaveAttribute("open");
    else await expect(summary).toHaveAttribute("open");
    await expect(summary.locator(":scope > summary")).toContainText(/整次结果/);
    await expect(summary.locator(":scope > summary")).toContainText(/耗时/);
    await expect(row(page, fixture.nodes[0].id)).toHaveAttribute("aria-current", "true");
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode)).toEqual(fixture.nodes[0]);
    await expectQuietControls(page);
    await expectLogicalGraph(page, fixture, outcome);
    if (outcome === "success") {
      await summary.locator(":scope > summary").click();
      await expectQuietControls(page);
      for (const direction of ["input", "output"]) {
        const source = fixture.record.evidence.find((envelope) => envelope.kind === "component.io"
          && !envelope.payload.nodePath?.length && envelope.payload.direction === direction);
        const value = page.locator(`#run-result-summary [data-run-channel="${direction}"] [data-run-value]`);
        await expect(value).toBeVisible();
        expect(JSON.parse(await value.textContent())).toEqual(source.payload.body);
      }
      await summary.locator(":scope > summary").click();
    }
    await openStepSearch(page);
    for (const [index, visit] of fixture.visits.entries()) await expect(row(page, visit.node.id)).toContainText(`第 ${index + 1} 次`);

    const second = fixture.visits[1];
    if (outcome === "failed") {
      await page.locator("#inspection-search").fill("no matching loop visit");
      const issue = page.locator(`#run-result-summary [data-issue-step=${JSON.stringify(second.node.id)}]`);
      await expect(issue).toHaveCount(1);
      await issue.click();
      await expect(page.locator("#inspection-search")).toHaveValue("");
      await expect(page.locator("#node-detail")).toContainText("route evaluation unavailable at round 2");
      await page.locator("#inspection-scope").selectOption("issues");
      await expect(row(page, fixture.visits[0].node.id)).toHaveCount(0);
    } else {
      await page.locator("#inspection-search").fill("evaluate");
      await row(page, second.node.id).click();
    }
    await expectSelectedVisit(page, fixture, second);
    expect(second.io.find(({ envelope }) => envelope.payload.direction === "input").envelope.payload.body.round).toBe(2);
    await expect(page.locator("#node-detail .node-detail-hero h3")).toContainText("第 2 次");
    await expect(page.locator("select[data-graph-visit]")).toHaveAccessibleName("执行记录");
    await activateLogicalEvaluate(page, fixture);
    await expectSelectedVisit(page, fixture, second);
    for (const visit of [fixture.visits.at(-1), fixture.visits[0], second]) {
      await page.locator("select[data-graph-visit]").selectOption(visit.node.id);
      await expectSelectedVisit(page, fixture, visit);
      if (outcome === "failed" && visit === fixture.visits[0]) await expect(page.locator("#inspection-scope")).toHaveValue("steps");
    }

    const before = await page.evaluate(() => ({ selection: window.playground.linkedSelection,
      scope: window.playground.inspectionScope, document: window.playground.document }));
    const query = await page.locator("#inspection-search").inputValue();
    const filter = await page.locator("#inspection-scope").inputValue();
    await page.locator('[data-language="en"]').click();
    await expect(page.locator("#inspection-search")).toHaveValue(query);
    await expect(page.locator("#inspection-scope")).toHaveValue(filter);
    expect(await page.evaluate(() => ({ selection: window.playground.linkedSelection,
      scope: window.playground.inspectionScope, document: window.playground.document }))).toEqual(before);
    await expect(page.locator("#node-detail .node-detail-hero h3")).toContainText("Call 2");
    await expect(page.locator("select[data-graph-visit]")).toHaveAccessibleName("Execution");
    await expectSelectedVisit(page, fixture, second);
    if (outcome === "success") await expect(summary).not.toHaveAttribute("open");
    else await expect(summary).toHaveAttribute("open");
    // Coming from another logical node has a deterministic choice: the real
    // failed call wins when present; otherwise the first recorded call wins.
    await page.locator("#inspection-search").fill("");
    await page.locator("#inspection-scope").selectOption("steps");
    await row(page, fixture.nodes[0].id).click();
    await activateLogicalEvaluate(page, fixture);
    const preferred = outcome === "failed" ? second : fixture.visits[0];
    await expectSelectedVisit(page, fixture, preferred);
    await activateLogicalEvaluate(page, fixture);
    await expectSelectedVisit(page, fixture, preferred);
    // An available but unobserved branch cannot borrow an executed call's I/O.
    await topologyNode(page, "fallback").click();
    await expect(topologyNode(page, "fallback")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#node-detail h3")).toHaveText("fallback");
    await expect(page.locator("#node-detail")).toContainText("No execution observed");
    await expect(page.locator("#node-detail [data-business-channel], #node-detail [data-graph-visit]")).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.selectedNodeDetail.executionNode)).toBeUndefined();
    await page.locator('[data-language="zh"]').click();
    await expect(topologyNode(page, "fallback")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#node-detail")).toContainText("未观测到执行");
    await row(page, fixture.nodes[0].id).click();
    await expect(page.locator('#dag [data-graph-node][aria-pressed="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.playground.executionDAG)).toEqual(fixture.execution);
    expect(await page.evaluate(() => window.playground.document)).toEqual(fixture.record);
  }
  // A derived record with no declaration keeps the existing execution-view
  // fallback. It must not invent a topology from temporal callback order.
  const withoutDefinition = loopRecord("success").record;
  withoutDefinition.evidence = withoutDefinition.evidence.filter(({ kind }) => kind !== "compose.graph");
  await openWorkbenchRecord(page, withoutDefinition);
  await expect(page.locator('#dag svg[data-graph-topology]')).toHaveCount(0);
  await expect(page.locator('#dag canvas').first()).toBeVisible();
  await expect(page.locator('#path-region > summary')).toContainText("调用关系");
  expect(await page.evaluate(() => window.playground.executionDAG)).toEqual(projectEinoViewerDocument(withoutDefinition).document.execution);
  expect(await page.evaluate(() => window.playground.document)).toEqual(withoutDefinition);
});

test("Graph workbench keeps the path primary and complete details reachable at four reading widths", { tag: "@P1" }, async ({ page }) => {
  test.setTimeout(60000);
  const fixture = loopRecord("success");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await open(page, fixture, viewport);
    await expectQuietControls(page);
    await expect(page.locator("#global-summary")).not.toHaveAttribute("open");
    await expect(page.locator("#global-summary > summary")).toBeInViewport();
    await expect(page.locator("#dag svg[data-graph-topology]")).toBeVisible();
    await expect(page.locator("#dag")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `.artifacts/graph-reading-${viewport.width}-initial.png` });

    await openStepSearch(page);
    const selected = row(page, fixture.visits[1].node.id);
    await selected.focus();
    await page.keyboard.press("Enter");
    await expectSelectedVisit(page, fixture, fixture.visits[1]);
    if (viewport.width < 1200) await expect(page.locator("#editor-title")).toBeInViewport();
    if (viewport.width < 1200) {
      const picker = page.locator("select[data-graph-visit]");
      await picker.scrollIntoViewIfNeeded();
      await picker.focus();
      const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await settle();
      const position = await page.evaluate(() => window.scrollY);
      for (const visit of [fixture.visits[0], fixture.visits[1]]) {
        await picker.selectOption(visit.node.id);
        await settle();
        expect(await page.evaluate(() => window.scrollY)).toBe(position);
        await expect(picker).toBeFocused();
        await expectSelectedVisit(page, fixture, visit);
      }
    }
    await page.screenshot({ path: `.artifacts/graph-reading-${viewport.width}-detail.png` });
    const geometry = await page.evaluate(() => {
      const graph = document.querySelector("#reading-main").getBoundingClientRect();
      const detail = document.querySelector("#inspector-panel").getBoundingClientRect();
      return { graph: graph.toJSON(), detail: detail.toJSON(),
        values: [...document.querySelectorAll("#node-detail .business-value-text")].map((element) => ({
          height: element.clientHeight, scroll: element.scrollHeight, clamp: getComputedStyle(element).webkitLineClamp,
        })), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(geometry.overflow).toBe(false);
    if (viewport.width >= 1200) expect(geometry.graph.right).toBeLessThanOrEqual(geometry.detail.left + 1);
    else expect(geometry.detail.top).toBeGreaterThanOrEqual(geometry.graph.bottom - 1);
    for (const value of geometry.values) {
      expect(value.clamp).toBe("none");
      expect(value.scroll).toBeLessThanOrEqual(value.height + 1);
    }

    const selection = await page.evaluate(() => window.playground.linkedSelection);
    await page.locator("#editor-title").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#inspector-panel")).toBeHidden();
    await expect(selected).toBeFocused();
    expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selection);
    await page.keyboard.press("Enter");
    await expect(page.locator("#inspector-panel")).toBeVisible();
    expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selection);
    expect(await page.evaluate(() => window.playground.document)).toEqual(fixture.record);
  }
});
