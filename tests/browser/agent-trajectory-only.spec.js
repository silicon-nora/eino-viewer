import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { buildExecutionTrajectory } from "../../src/trajectory.js";
import { openAgentScope, openStepSearch, openWorkbenchRecord, revealSource } from "../helpers/workbench-ui.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), "utf8"));

test("trajectory-only Agent reading retains model inputs and reaches calls with no recorded reply", { tag: "@P0" }, async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  const upload = async (record) => {
    await openWorkbenchRecord(page, record);
    await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
    await expect(page.locator("#reading-sidebar, #inspection-search, #hierarchy-groups")).toHaveCount(0);
  };
  const weather = fixture("eino-agent-recorder-weather-v1");
  const modelInput = weather.evidence.find(({ kind, payload }) => kind === "component.io" && payload.component === "ChatModel" && payload.direction === "input");
  const inputOnly = { ...weather, evidence: [modelInput] };
  expect(projectEinoViewerDocument(inputOnly).ok).toBe(true);
  await upload(inputOnly);
  await expect(page.locator("[data-trajectory-record]")).toHaveCount(0);
  await expect(page.locator(".agent-recorded-input")).toHaveCount(1);
  const actualInput = page.locator('.agent-recorded-input [data-business-channel="input"] .business-value-text');
  await revealSource(actualInput);
  await expect(actualInput).toBeVisible();
  expect(JSON.parse(await actualInput.textContent())).toEqual(modelInput.payload.body);
  await expect(page.locator(".trajectory-view .search-empty")).toHaveCount(0);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "unknown");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copied = text; } } }));
  await page.locator(".agent-recorded-input .run-copy-value").click();
  expect(JSON.parse(await page.evaluate(() => window.copied))).toEqual(modelInput.payload.body);

  const nested = fixture("recorder-matrix/agent-nested-distinct-results");
  // The parent tool is planned-only; the later child input must not jump
  // ahead of that existing trajectory row or manufacture a child reply.
  const partial = { ...nested, evidence: nested.evidence.slice(0, 7).filter((_, index) => index !== 5) };
  const projected = projectEinoViewerDocument(partial);
  expect(projected.ok).toBe(true);
  const explained = explainExecutionDAG(projected.document.execution, projected.document.evidence).explanation;
  const child = explained.groups.find(({ parentId }) => parentId);
  const expectedInput = nested.evidence[6].payload.body;
  await upload(partial);
  expect(await page.evaluate(() => window.playground.trajectory.records)).toEqual(buildExecutionTrajectory(partial.evidence).trajectory.records);
  const supplement = page.locator(".agent-recorded-input");
  await expect(supplement).toHaveCount(1);
  await expect(supplement.locator(".trajectory-sequence, [data-trajectory-record]")).toHaveCount(0);
  expect(await page.locator(".trajectory-view [data-trajectory-record], .trajectory-view [data-recorded-input-node]").evaluateAll((elements) => elements.map((element) => element.dataset.trajectoryRecord || "recorded-input")))
    .toEqual([...buildExecutionTrajectory(partial.evidence).trajectory.records.map(({ id }) => id), "recorded-input"]);
  const childPath = `${explained.groups.find(({ id }) => id === child.parentId).label} / ${child.label}`;
  const childScope = supplement.locator(`[data-hierarchy-group=${JSON.stringify(child.id)}]`);
  await expect(childScope).toHaveText(childPath);
  await childScope.click();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", child.id);
  await expect(supplement.locator(".agent-scope-path")).toHaveText(childPath);
  await expect(supplement.locator("[data-hierarchy-group]")).toHaveCount(0);
  await expect(page.locator("[data-trajectory-record]")).toHaveCount(0);
  expect(JSON.parse(await actualInput.textContent())).toEqual(expectedInput);
  await expect(page.locator(':is(#scope-result-summary, .eino-agent-reader [data-local-result]) [data-scope-channel="output"]')).toHaveAttribute("data-availability", "not-observed");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", child.id);
  await expect(supplement.locator(".agent-scope-path")).toHaveText(childPath);
  await expect(supplement.locator("[data-hierarchy-group]")).toHaveCount(0);
  expect(JSON.parse(await actualInput.textContent())).toEqual(expectedInput);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  await expect(page.locator(".trajectory-view")).toBeFocused();
  await expect(page.locator("[data-trajectory-record]")).toHaveCount(3);
  expect(await page.evaluate(() => window.playground.document)).toEqual(partial);

  await upload(nested);
  await expect(page.locator(".agent-recorded-input")).toHaveCount(0);
  const childReply = await page.evaluate(() => window.playground.trajectory.records.find((record) => record.kind === "assistant" && record.metadata.parentAgentScopeId));
  await page.locator(`[data-trajectory-record=${JSON.stringify(childReply.id)}]`).click();
  const detailInput = page.locator(':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="input"] .business-value-text').first();
  await revealSource(detailInput);
  await expect(detailInput).toBeVisible();
  expect(JSON.parse(await detailInput.textContent())).toEqual(expectedInput);
  expect(await page.evaluate(() => window.playground.linkedSelection.evidenceIndexes)).toEqual([...new Set(childReply.evidence.map(({ envelopeIndex }) => envelopeIndex))].sort((a, b) => a - b));
  await openAgentScope(page, child.id);
  await page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]').click();
  await expect(page.locator(".trajectory-view")).toBeFocused();
  expect(await page.evaluate(() => window.playground.document)).toEqual(nested);
  const graph = fixture("recorder-matrix/graph-io-structured");
  await openWorkbenchRecord(page, graph);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(graph);
  await openStepSearch(page);
  await expect(page.locator("#run-inspection > summary")).toHaveText("Find steps and evidence");
  await expect(page.locator("#inspection-scope")).toHaveAttribute("aria-label", "Show");
  await expect(page.locator("#inspection-next-issue")).toHaveText("Next error / interruption");
  await expect(page.locator("#inspection-previous")).toHaveText("Previous");
  await expect(page.locator("#inspection-next")).toHaveText("Next");
  await expect(page.locator("#reading-sidebar")).toHaveCount(1);
  await upload(nested);
  expect(errors).toEqual([]);
});
