import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { expectSelectedEvidence, openSample, openStepSearch } from "../helpers/workbench-ui.js";

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
  await expect.poll(() => page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((element) => element._cyreg?.cy).find(Boolean);
    return cy?.nodes(".active-node").map((node) => node.data("path")?.at(-1) || node.id());
  })).toEqual([fixture.visits[0].node.id]);
  const picker = page.locator("select[data-graph-visit]");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue(visit.node.id);
  expect(await picker.locator("option").evaluateAll((options) => options.map((option) => option.value)))
    .toEqual(fixture.visits.map(({ node }) => node.id));
}

async function expectLogicalGraph(page, fixture, outcome) {
  const displayed = await page.locator("#dag").evaluate((host) => {
    const cy = [host, ...host.querySelectorAll("*")].map((element) => element._cyreg?.cy).find(Boolean);
    const id = (node) => node.data("path")?.at(-1) || node.id();
    return {
      nodes: cy.nodes().filter((node) => node.data("metadata")?.executionKind).map((node) => ({
        id: id(node), members: node.data("metadata")?.graphReading?.memberIds,
        counts: node.data("metadata")?.graphReading?.statusCounts, label: node.data("label"),
      })),
      edges: cy.edges().map((edge) => ({ from: id(edge.source()), to: id(edge.target()),
        kind: edge.data("metadata")?.executionEdgeKind, originals: edge.data("metadata")?.graphReading?.edgeIds })),
    };
  });
  // These counts come from the real named scenario, not the grouping helper.
  expect(displayed.nodes).toHaveLength(outcome === "success" ? 5 : 4);
  const evaluate = displayed.nodes.filter(({ members }) => members.includes(fixture.visits[0].node.id));
  expect(evaluate).toHaveLength(1);
  expect(evaluate[0].id).toBe(fixture.visits[0].node.id);
  expect(evaluate[0].members).toEqual(fixture.visits.map(({ node }) => node.id));
  expect(evaluate[0].label).toContain(`执行 ${outcome === "success" ? 3 : 2} 次`);
  if (outcome === "failed") {
    expect(evaluate[0].label).toContain("1 次失败");
    expect(evaluate[0].counts.failed).toBe(1);
  }
  expect(displayed.nodes.flatMap(({ members }) => members).sort()).toEqual(fixture.nodes.map(({ id }) => id).sort());
  const owner = new Map(displayed.nodes.flatMap(({ id, members }) => members.map((member) => [member, id])));
  expect(displayed.edges.flatMap(({ originals }) => originals).sort()).toEqual(fixture.execution.edges.map(({ id }) => id).sort());
  for (const edge of displayed.edges) {
    expect(edge.originals.length).toBeGreaterThan(0);
    for (const originalId of edge.originals) {
      const original = fixture.execution.edges.find(({ id }) => id === originalId);
      expect({ from: edge.from, to: edge.to, kind: edge.kind })
        .toEqual({ from: owner.get(original.from), to: owner.get(original.to), kind: original.kind });
    }
  }
  expect(await page.evaluate(() => window.playground.executionDAG)).toEqual(fixture.execution);
}

async function activateLogicalEvaluate(page, fixture) {
  const host = page.locator("#dag");
  await host.focus();
  await host.press("Home");
  let reached = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    reached = await host.evaluate((element, target) => {
      const cy = [element, ...element.querySelectorAll("*")].map((item) => item._cyreg?.cy).find(Boolean);
      const node = cy.nodes(".keyboard-focus").first();
      return (node.data("path")?.at(-1) || node.id()) === target;
    }, fixture.visits[0].node.id);
    if (reached) break;
    await host.press("ArrowRight");
  }
  expect(reached).toBe(true);
  await host.press("Enter");
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
    expect(await page.evaluate(() => window.playground.document)).toEqual(fixture.record);
  }
});

test("Graph workbench keeps the path primary and complete details reachable at four reading widths", { tag: "@P1" }, async ({ page }) => {
  test.setTimeout(60000);
  const fixture = loopRecord("success");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await open(page, fixture, viewport);
    await expectQuietControls(page);
    await expect(page.locator("#global-summary")).not.toHaveAttribute("open");
    await expect(page.locator("#global-summary > summary")).toBeInViewport();
    await expect(page.locator("#dag canvas").first()).toBeVisible();
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
