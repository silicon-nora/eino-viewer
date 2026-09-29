import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { openSample, openStepSearch, openRunInformation, openPasteDraft, selectAgentStep, openWorkbenchRecord, expectSelectedEvidence } from "../helpers/workbench-ui.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function open(page, viewport = { width: 1280, height: 720 }) {
  await page.setViewportSize(viewport);
  await page.goto("/.artifacts/pages/?lang=zh");
  await page.waitForFunction(() => window.playground?.ready);
  await openSample(page);
}

async function importRecord(page, record) {
  await openWorkbenchRecord(page, record);
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
}

async function expectFirstStepSelected(page, kind) {
  const row = page.locator(kind === "agent" ? "[data-trajectory-record]" : "[data-inspection-node]").first();
  const id = await row.getAttribute(kind === "agent" ? "data-trajectory-record" : "data-inspection-node");
  expect(id).toBeTruthy();
  await expect(row).toHaveAttribute(kind === "agent" ? "aria-pressed" : "aria-current", "true");
  const selected = await page.evaluate(() => ({
    selection: window.playground.linkedSelection,
    detail: window.playground.selectedNodeDetail,
    document: window.playground.document,
  }));
  if (kind === "agent") {
    expect(selected.selection.trajectoryRecordId).toBe(id);
    expect(selected.detail.trajectoryRecord.id).toBe(id);
  } else {
    expect(selected.selection.executionNodeId).toBe(id);
    expect(selected.detail.explanationNode.id).toBe(id);
  }
  const indexes = [...new Set(selected.detail.evidence.map(({ envelopeIndex }) => envelopeIndex))].sort((a, b) => a - b);
  expect(indexes.length).toBeGreaterThan(0);
  expect(selected.selection.evidenceIndexes).toEqual(indexes);
  for (const index of indexes) await expectSelectedEvidence(page, index, selected.document.evidence[index]);
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  await expect(page.locator("#close-details")).toHaveCount(0);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel] .run-copy-value, :is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value .run-copy-value")).toHaveCount(0);
  if (kind !== "agent") {
    expect(await page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel]").evaluateAll((channels) => channels.map((channel) => channel.dataset.businessChannel))).toEqual(["input", "output"]);
  }
}

async function dismissDetails(page) {
  await page.locator(":is(#editor-title, .eino-agent-reader .agent-detail-heading)").focus();
  await page.keyboard.press("Escape");
}

async function screenshot(page, testInfo, name) {
  if (testInfo.project.name !== "chromium") return;
  mkdirSync(new URL("../../.artifacts/iteration-5/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`../../.artifacts/iteration-5/${name}.png`, import.meta.url).pathname });
}

for (const viewport of [{ width: 1280, height: 720, name: "desktop" }, { width: 390, height: 844, name: "narrow" }]) {
  test(`Agent trajectory and Graph Workflow results lead the ${viewport.name} first screen without overlapping tools`, { tag: "@P1" }, async ({ page }, testInfo) => {
    await open(page, viewport);
    for (const kind of ["agent", "graph", "workflow"]) {
      await openSample(page, kind);
      await expect.poll(() => page.evaluate(() => window.playground.objectKind)).toBe(kind);
      await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "success");
      if (kind === "agent") {
        await expect(page.locator('[data-run-capture="complete"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.playground.explanation.run.capture.status)).toBe("complete");
      } else await expect(page.locator("[data-run-capture]")).toHaveAttribute("data-run-capture", "complete");
      await expectFirstStepSelected(page, kind);
      const output = page.locator('[data-run-channel="output"] .run-result-value, [data-run-channel="output"] .run-result-preview').first();
      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return { output: rect('[data-run-channel="output"]'), result: rect(":is(#run-result-summary, .eino-agent-reader [data-run-summary])"), tools: rect(".reader-tools"),
          main: rect(":is(#reading-main, .eino-agent-reader [data-reading-main])"), sidebar: rect("#reading-sidebar"), stage: rect(":is(.canvas-stage, .eino-agent-reader [data-reading-workspace])"), detail: rect(":is(#inspector-panel, .eino-agent-reader [data-step-panel])"), overflow: document.documentElement.scrollWidth > innerWidth + 1,
          channels: [...document.querySelectorAll("[data-run-channel]")].map((node) => node.dataset.runChannel) };
      });
      expect(geometry.channels).toEqual(kind === "agent" ? ["input", "output"] : ["output", "input"]);
      if (kind === "agent") {
        await expect(page.locator("#sample")).toBeVisible();
        await expect(page.locator("#sample")).toHaveAccessibleName("更换记录");
        await expect(page.locator("#record-picker, #viewer-kind, #example-picker, #open-examples, #record-file, #import-record, #record-drop-zone")).toHaveCount(0);
        await expect(page.locator("#record-actions, #global-summary, #scope-information, [data-replay-controls]")).toHaveCount(0);
        await expect(page.locator("#reading-sidebar, #run-inspection, #hierarchy-directory, #inspection-search, [data-inspection-node]")).toHaveCount(0);
        expect(geometry.sidebar).toBeUndefined();
        await expect(page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])")).toBeVisible();
        for (const selector of [".reader-tools", "#path-region > summary", ".canvas-footer", "#open-details", "#open-examples", "#paste-record", "[data-agent-outcome]", "[data-agent-capture]"]) {
          await expect(page.locator(selector)).toBeHidden();
        }
        await expect(page.locator("[data-agent-duration]")).toBeVisible();
        await expect(page.locator("[data-agent-duration]")).not.toBeEmpty();
        await expect(page.locator("[data-agent-duration]")).not.toHaveRole("button");
        await expect(page.locator('[data-run-channel="input"] [data-run-value]')).toBeVisible();
        await expect(page.locator('[data-replay-action="toggle"]')).toHaveCount(0);
        await expect(page.locator("[data-trajectory-record]").first()).toBeInViewport();
        const recorded = await page.evaluate(() => ({
          ids: window.playground.trajectory.records.map(({ id }) => id),
          output: window.playground.explanation.run.output.items[0].value,
          document: window.playground.document,
        }));
        expect(await page.locator("[data-trajectory-record]").evaluateAll((rows) => rows.map((row) => row.dataset.trajectoryRecord))).toEqual(recorded.ids);
        for (const badge of await page.locator(".trajectory-status.success").all()) await expect(badge).toBeHidden();
        const trajectoryHeight = await page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])").evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { height: bounds.height, bottom: bounds.bottom, overflow: getComputedStyle(element).overflowY,
            hiddenHeight: element.scrollHeight - element.clientHeight,
            lastBottom: [...element.querySelectorAll("[data-trajectory-record]")].at(-1).getBoundingClientRect().bottom,
          };
        });
        expect(trajectoryHeight.overflow).toBe("visible");
        expect(trajectoryHeight.hiddenHeight).toBeLessThanOrEqual(1);
        expect(trajectoryHeight.lastBottom).toBeLessThanOrEqual(trajectoryHeight.bottom + 1);
        await expect(page.locator(".trajectory-pagination")).toHaveCount(0);
        if (viewport.width >= 1200) expect(geometry.main.right).toBeLessThanOrEqual(geometry.detail.left + 1);
        else expect(geometry.main.width).toBeGreaterThan(geometry.stage.width * 0.9);
        await screenshot(page, testInfo, `workbench-${kind}-${viewport.name}`);
        await page.locator("[data-trajectory-record]").last().click();
        await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) }).locator(".business-value-text")).toHaveText(recorded.output);
        await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context")).toHaveCount(0);
        expect(await page.evaluate(() => window.playground.document)).toEqual(recorded.document);
        await dismissDetails(page);
        await expect(page.locator("[data-trajectory-record]").last()).toBeFocused();
        await openRunInformation(page);
        await expect(output).toHaveText(recorded.output);
        await expect(page.locator("#open-raw")).toBeHidden();
        await expect(page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) button[data-envelope-index]')).toHaveCount(0);
        await expect(page.locator('#inspection-scope option[value="evidence"], #inspection-scope option[value="unassigned"]')).toHaveCount(0);
        // Both desktop and narrow pages grow with their real row count, and a
        // short accepted record removes the space occupied by the longer run.
        const shortRecord = fixture("agent-direct-answer");
        await importRecord(page, shortRecord);
        await expect(page.locator("[data-trajectory-record]")).toHaveCount(2);
        expect((await page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])").boundingBox()).height).toBeLessThan(trajectoryHeight.height);
        expect(await page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])").evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
        const shortGeometry = await page.locator(":is(#domain-view, .eino-agent-reader [data-agent-trajectory])").evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          containerHeight: element.parentElement.getBoundingClientRect().height,
          minimum: getComputedStyle(element.parentElement).minHeight,
        }));
        expect(shortGeometry.minimum).toBe("0px");
        expect(Math.abs(shortGeometry.containerHeight - shortGeometry.height)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => window.playground.document)).toEqual(shortRecord);
      } else {
        await expect(output).toBeInViewport();
        expect(geometry.result.bottom).toBeGreaterThanOrEqual(geometry.output.bottom);
        if (viewport.width >= 768) expect(geometry.sidebar.right).toBeLessThanOrEqual(geometry.main.left + 1);
        else expect(geometry.sidebar.top).toBeGreaterThanOrEqual(geometry.main.bottom - 1);
        await expect(page.locator("#inspection-search")).toBeVisible();
      }
      expect(geometry.overflow).toBe(false);
      if (kind !== "agent") await screenshot(page, testInfo, `workbench-${kind}-${viewport.name}`);
    }
  });
}

test("details and the compact record selector preserve selected evidence and the accepted Agent record", { tag: "@P1" }, async ({ page }) => {
  await open(page);
  const record = await page.evaluate(() => window.playground.document);
  const input = page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="input"]');
  await openRunInformation(page);
  const originalInput = record.evidence.find(({ kind, payload }) => kind === "schema.message" && payload.role === "user").payload.content;
  await expect(input.locator("[data-run-value]")).toHaveText(originalInput);
  await expect(input.locator("[data-run-value]")).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
    value: { writeText: async (text) => { window.copiedRunInput = text; } } }));
  await input.locator("[data-copy-value]").click();
  expect(await page.evaluate(() => window.copiedRunInput)).toBe(originalInput);
  const step = await selectAgentStep(page, "tool:get_weather:call-weather-singapore");
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value > small")).toHaveText(["输入", "输出"]);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .trajectory-detail-value .run-copy-value")).toHaveCount(0);
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .step-scope-context")).toHaveCount(0);
  const selected = await page.evaluate(() => window.playground.linkedSelection);
  await dismissDetails(page);
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeHidden();
  await expect(step).toBeFocused();
  await page.locator('[data-language="en"]').click();
  await expect(input.locator("[data-run-value]")).toBeVisible();
  await expect(input.locator("[data-run-value]")).toHaveText(originalInput);
  await expect(page.locator("#reading-sidebar, #inspection-search, [data-inspection-node]")).toHaveCount(0);
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeHidden();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected);
  await expect(page.locator("#sample")).toHaveAccessibleName("Change record");
  await expect(page.locator("#sample")).toHaveValue("agent-weather-workflow");
  await page.locator("#sample").focus();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await expect(page.locator("#record-picker, #viewer-kind")).toHaveCount(0);
  await step.click();
  await dismissDetails(page);
  await expect(step).toBeFocused();
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeHidden();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(selected);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  await openSample(page, "agent", "agent-weather-failure");
  await expect(page.locator("#reading-sidebar, #inspection-search")).toHaveCount(0);
  await expect(page.locator("#sample")).toHaveValue("agent-weather-failure");
  await expectFirstStepSelected(page, "agent");
  expect(await page.evaluate(() => window.playground.linkedSelection.trajectoryRecordId)).not.toBe(selected.trajectoryRecordId);
});

test("visible path zoom controls change only the viewport and remain keyboard operable", { tag: "@P1" }, async ({ page }) => {
  await open(page);
  for (const kind of ["graph", "workflow"]) {
    await openSample(page, kind);
    await expect.poll(() => page.evaluate(() => window.playground.objectKind)).toBe(kind);
    const before = await page.evaluate(() => ({ document: window.playground.document, dag: window.playground.executionDAG }));
    const zoom = () => page.locator("#dag").evaluate((host) => {
      const cy = [host, ...host.querySelectorAll("*")].map((node) => node._cyreg?.cy).find(Boolean);
      return cy.zoom();
    });
    const initial = await zoom();
    // A short graph may already fit at the renderer's maximum zoom.
    await page.locator("#zoom-out").click();
    await expect.poll(zoom).toBeLessThan(initial);
    const smaller = await zoom();
    await page.locator("#zoom-in").focus();
    await page.keyboard.press("Enter");
    await expect.poll(zoom).toBeGreaterThan(smaller);
    await page.locator("#fit-reading").click();
    await expect.poll(zoom).toBeCloseTo(initial, 2);
    expect(await page.evaluate(() => ({ document: window.playground.document, dag: window.playground.executionDAG }))).toEqual(before);
  }
});

test("Graph step selection preserves a pending paste draft without replacing the accepted record", { tag: "@P2" }, async ({ page }) => {
  await open(page);
  await openSample(page, "graph");
  const record = await page.evaluate(() => window.playground.document);
  await openPasteDraft(page);
  const draft = '{"next record":';
  await page.locator("#snapshot-json").fill(draft);
  await openStepSearch(page);
  await page.locator("[data-inspection-node]").first().click();
  await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toBeVisible();
  await expect(page.locator("#open-details")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#node-detail-tab")).toHaveAttribute("aria-selected", "true");
  await openPasteDraft(page);
  await expect(page.locator("#snapshot-json")).toHaveValue(draft);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
});

test("narrow failed Agent opens its first step and restores focus when details are dismissed with Escape", { tag: "@P1" }, async ({ page }, testInfo) => {
  const record = fixture("agent-nested-failure-propagated");
  await page.route(/\/fixtures\/recorder-matrix\/agent-nested-distinct-results\.json(?:\?|$)/,
    (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(record) }));
  await page.route(/\/fixtures\/eino-agent-recorder-trip-planner-failure-completed-v1\.json(?:\?|$)/,
    (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...record, schemaVersion: 99 }) }));
  await open(page, { width: 390, height: 844 });
  await page.locator("#sample").selectOption("agent-nested-distinct-results");
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
  await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-result", "failed");
  await expect(page.locator("#record-picker, #record-file")).toHaveCount(0);
  const outcome = page.locator("[data-agent-outcome]");
  await expect(outcome).toBeInViewport();
  await expectFirstStepSelected(page, "agent");
  const initialSelection = await page.evaluate(() => window.playground.linkedSelection);
  await outcome.click();
  // The propagated record names both the run boundary and the leaf. Do not
  // guess one of them; the action reveals the original run issues instead.
  await expect(page.locator("#global-summary")).toHaveCount(0);
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeVisible();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(initialSelection);
  await openRunInformation(page);
  await expect(page.locator(".run-result-issues")).toBeVisible();
  const issue = await page.locator(".run-result-issues").boundingBox();
  const outputChannel = page.locator(':is(#run-result-summary, .eino-agent-reader [data-run-summary]) [data-run-channel="output"]');
  await expect(outputChannel).toHaveAttribute("data-availability", "not-observed");
  await expect(outputChannel.locator("[data-run-value]")).toHaveCount(0);
  const outputHeading = outputChannel.locator(":scope > h3");
  await expect(outputHeading).toHaveText("最终结果");
  await expect(outputHeading).toHaveCSS("clip-path", "none");
  expect((await outputHeading.boundingBox()).height).toBeGreaterThanOrEqual(12);
  await expect(outputChannel.locator(".run-value-state")).toHaveText("未记录");
  await expect(outputChannel.locator(".run-value-state")).toBeVisible();
  const output = await outputChannel.boundingBox();
  expect(issue.y >= output.y + output.height || output.y >= issue.y + issue.height).toBe(true);
  await screenshot(page, testInfo, "workbench-failure-narrow");
  const step = page.locator("[data-trajectory-record]").first();
  await step.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":is(#inspector-panel .inspector-content > header, .eino-agent-reader .agent-detail-heading)")).toBeInViewport();
  const before = await page.evaluate(() => window.playground.linkedSelection);
  await dismissDetails(page);
  await expect(step).toBeFocused();
  await expect(step).toBeInViewport();
  await page.locator("#sample").selectOption("agent-weather-failure");
  await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  expect(await page.evaluate(() => window.playground.diagnostics.map(({ code }) => code))).toContain("run_record.invalid_schema_version");
  await expect(page.locator("#sample")).toHaveValue("agent-nested-distinct-results");
  await expect(page.locator(":is(#inspector-panel, .eino-agent-reader [data-step-panel])")).toBeHidden();
  expect(await page.evaluate(() => window.playground.linkedSelection)).toEqual(before);
  expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
