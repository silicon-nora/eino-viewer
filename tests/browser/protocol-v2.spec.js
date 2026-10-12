import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openRunInformation, prepareWorkbenchExample } from "../helpers/workbench-ui.js";

const root = new URL("../../", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`protocol/v2/fixtures/${name}.json`, root), "utf8"));
const oldGraph = () => JSON.parse(readFileSync(new URL("fixtures/recorder-matrix/graph-io-structured.json", root), "utf8"));
const portableURL = new URL(".artifacts/portable/eino-viewer.html", root).href;
const v2 = (page) => page.locator('[data-eino-run-viewer][data-record-version="2"]');
const runSummary = (page) => v2(page).locator("[data-run-summary]");
const callList = (page) => v2(page).locator("[data-step-list], [data-agent-trajectory]");
const pageErrors = new WeakMap();
const catalogSelections = new WeakMap();
const catalogPlans = new WeakMap();
const catalogIDs = {
  graph: ["graph-multistep-loop-success", "graph-multistep-loop-failed", "graph-io-structured"],
  agent: ["agent-weather-workflow", "agent-weather-failure"],
  workflow: ["workflow-parallel-join-success", "workflow-parallel-join-failed"],
};

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 940 });
});
test.afterEach(async ({ page }) => {
  for (const prepared of catalogPlans.get(page) || []) await prepared.dispose();
  expect(pageErrors.get(page)).toEqual([]);
});

async function openEntry(page, mode, records = []) {
  if (mode === "workbench") {
    // The workbench preloads the catalog. Prepare every accepted/rejected
    // alternative before navigation, then replace through the real selector
    // without reloading or clearing the application's accepted reading state.
    const prepared = [], counts = new Map();
    for (const record of records) {
      const source = record.run?.source || record.source || "graph";
      const kind = source === "application" ? "workflow" : source;
      const offset = counts.get(kind) || 0;
      const id = catalogIDs[kind][offset];
      expect(id, `A distinct catalog entry is required for ${kind} alternative ${offset + 1}`).toBeTruthy();
      counts.set(kind, offset + 1);
      prepared.push({ ...await prepareWorkbenchExample(page, record, { kind, id }), key: JSON.stringify(record) });
    }
    catalogPlans.set(page, prepared);
    await page.goto("/.artifacts/pages/?lang=zh");
    await page.waitForFunction(() => window.playground?.ready);
  } else if (mode === "portable") {
    await page.goto(portableURL);
  } else {
    await page.route("**/__protocol-v2-embed__", (route) => route.fulfill({
      contentType: "text/html",
      // Import maps need inline scripts. Deliberately omit unsafe-eval: v2
      // validation must work without compiling schemas in the browser.
      headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" },
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Protocol v2 embedded reader</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main id="viewer"></main></body></html>',
    }));
    await page.goto("/__protocol-v2-embed__");
    await page.evaluate(() => {
      window.v2PolicyViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => window.v2PolicyViolations.push(event.violatedDirective));
    });
  }
  await page.waitForLoadState("networkidle");
}

async function replaceRecord(page, mode, record, { accepted = true, name = "protocol-v2.json", text = JSON.stringify(record) } = {}) {
  if (mode === "embedded") {
    const error = await page.evaluate(async (input) => {
      try {
        const { createEinoRunViewer } = await import("/src/run-viewer.js");
        if (window.v2TestViewer) window.v2TestViewer.update(input);
        else window.v2TestViewer = createEinoRunViewer(document.querySelector("#viewer"), input, { locale: "zh" });
        return null;
      } catch (failure) { return { name: failure.name, code: failure.code, message: failure.message }; }
    }, record);
    if (accepted) expect(error).toBeNull();
    else expect(error).not.toBeNull();
    expect(await page.evaluate(() => window.v2PolicyViolations)).toEqual([]);
  } else if (mode === "portable") {
    await page.locator("#record-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", String(!accepted));
  } else {
    const previous = catalogSelections.get(page);
    const prepared = catalogPlans.get(page)?.find((entry) => entry.key === JSON.stringify(record));
    expect(prepared, "Workbench alternatives must be prepared before opening the page").toBeTruthy();
    const { kind, id } = prepared;
    if (!previous) await page.locator(`[data-open-example=${JSON.stringify(id)}]`).click();
    else await page.locator("#sample").selectOption(id);
    if (accepted) {
      await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
      catalogSelections.set(page, { kind, id });
    } else await expect(page.locator("#import-status")).toHaveAttribute("data-error", "true");
  }
  if (accepted && record.schemaVersion === 2) await expect(v2(page)).toBeVisible();
}

async function originalRecord(page) {
  await v2(page).locator("summary").filter({ hasText: /^(完整原始记录|Original record)$/ }).click();
  const original = v2(page).locator("[data-original-record]");
  await expect(original).toBeVisible();
  return JSON.parse(await original.textContent());
}

async function expectInvocation(page, invocation) {
  const control = callList(page).locator(`button[data-step-id=${JSON.stringify(invocation.id)}]`);
  await expect(control).toBeVisible();
  await expect(control).toContainText(invocation.name);
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  const detail = v2(page).locator("[data-step-detail]");
  await expect(detail).toHaveAttribute("data-entity-kind", "invocation");
  await expect(detail).toHaveAttribute("data-entity-id", invocation.id);
  await expect(detail.locator("h2")).toHaveText(invocation.name);
  return detail;
}

async function expectOldGraph(page, mode, record) {
  const expected = record.evidence.find((item) => item.kind === "component.io"
    && item.metadata?.io?.scope === "root" && item.payload.direction === "output").payload.body;
  if (mode === "workbench") {
    await openRunInformation(page);
    const output = page.locator('#node-detail [data-business-channel="output"] .business-value-text');
    await expect(output).toBeVisible();
    expect(JSON.parse(await output.textContent())).toEqual(expected);
  } else {
    await expect(page.locator('[data-eino-run-viewer] [data-run-result="success"]')).toBeVisible();
    const output = page.locator('[data-run-summary] [data-run-channel="output"] [data-run-value]');
    expect(JSON.parse(await output.textContent())).toEqual(expected);
  }
}

for (const mode of ["embedded", "workbench", "portable"]) {
  test(`${mode}: v2 shows the actual root result and every repeated call without source attachments`, { tag: "@P0" }, async ({ page }) => {
    const record = fixture("graph-loop-repeated-definition");
    record.sourceRecords = [{ id: "source:optional", owner: { kind: "run", id: record.run.id }, format: "synthetic.original", payload: { note: "attachment-only, not a root result" } }];
    const withoutSources = structuredClone(record);
    delete withoutSources.sourceRecords;
    await openEntry(page, mode, [record, withoutSources]);
    await replaceRecord(page, mode, record);
    const summary = runSummary(page);
    await expect(summary.locator("[data-run-result]")).toHaveAttribute("data-run-result", "succeeded");
    const output = summary.locator('[data-run-channel="output"] [data-run-value]');
    expect(JSON.parse(await output.textContent())).toEqual({ counter: 3 });
    await expect(summary.locator('[data-content-id="c:previous-result"]')).toHaveAttribute("data-availability", "inline");
    await expect(summary.locator('[data-content-id="c:previous-result"] [data-run-value]')).toContainText("null");
    await expect(callList(page).locator("button[data-step-id]")).toHaveCount(record.invocations.length - 1);
    const repeats = record.invocations.filter((call) => call.definitionId === "d:step");
    expect(repeats).toHaveLength(3);
    for (const call of repeats) {
      await expectInvocation(page, call);
      expect(JSON.parse(await output.textContent())).toEqual({ counter: 3 });
    }
    const visibleSummary = await summary.innerText();
    expect(await originalRecord(page)).toEqual(record);
    await expect(v2(page).locator('[data-entity-collection="sourceRecord"]')).toHaveCount(1);
    await replaceRecord(page, mode, withoutSources);
    expect(await runSummary(page).innerText()).toBe(visibleSummary);
    await expect(callList(page).locator("button[data-step-id]")).toHaveCount(record.invocations.length - 1);
    await expect(v2(page).locator('[data-entity-collection="sourceRecord"]')).toHaveCount(0);
    expect(await originalRecord(page)).toEqual(withoutSources);
  });

  test(`${mode}: an undispatched tool request stays a request and never becomes a final answer or call`, { tag: "@P0" }, async ({ page }) => {
    const record = fixture("agent-parallel-interrupted");
    await openEntry(page, mode, [record]);
    await replaceRecord(page, mode, record);
    await expect(runSummary(page).locator("[data-run-result]")).toHaveAttribute("data-run-result", "interrupted");
    const output = runSummary(page).locator('[data-run-channel="output"]');
    await expect(output).toContainText("No final assistant answer was produced before interruption.");
    await expect(output.locator("[data-run-value]")).toHaveCount(0);
    await expect(callList(page).locator("button[data-step-id]")).toHaveCount(record.invocations.length - 1);
    const pending = callList(page).locator('button[data-event-id="ev:request:not-dispatched"]');
    await expect(pending).toContainText(/已请求 · 未观察到执行|Requested · execution not observed/);
    await pending.click();
    const detail = v2(page).locator("[data-step-detail]");
    await expect(detail).toHaveAttribute("data-entity-kind", "event");
    await expect(detail).toHaveAttribute("data-entity-id", "ev:request:not-dispatched");
    await expect(detail).toContainText("tool.requested");
    await expect(detail).toContainText(/已请求 · 未观察到执行|Requested · execution not observed/);
    const tools = record.invocations.filter((call) => call.kind === "tool");
    expect(tools).toHaveLength(2);
    for (const tool of tools) await expectInvocation(page, tool);
    expect(await originalRecord(page)).toEqual(record);
  });

  test(`${mode}: v1 and v2 replace each other and rejected v2 preserves the accepted selection and record`, { tag: "@P0" }, async ({ page }) => {
    const old = oldGraph(), record = fixture("graph-loop-repeated-definition");
    const invalid = structuredClone(record);
    invalid.invocations[0].outputRefs.push("content:does-not-exist");
    const network = [];
    if (mode === "portable") page.on("request", (request) => { if (/^https?:/i.test(request.url())) network.push(request.url()); });
    await openEntry(page, mode, [old, record, invalid]);
    await replaceRecord(page, mode, old);
    await expectOldGraph(page, mode, old);
    const acceptedText = ` \n${JSON.stringify(record, null, 3)}\n`;
    await replaceRecord(page, mode, record, { name: "accepted-v2.json", text: acceptedText });
    await expectInvocation(page, record.invocations.find((call) => call.id === "i:step:2"));
    const before = await v2(page).innerHTML();
    await replaceRecord(page, mode, invalid, { accepted: false, name: "rejected-v2.json" });
    expect(await v2(page).innerHTML()).toBe(before);
    await expect(v2(page).locator("[data-step-detail]")).toHaveAttribute("data-entity-id", "i:step:2");
    if (mode === "portable") {
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#download-record").click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("accepted-v2.json");
      expect(readFileSync(await download.path(), "utf8")).toBe(acceptedText);
      expect(network).toEqual([]);
    } else if (mode === "workbench") expect(await page.evaluate(() => window.playground.document)).toEqual(record);
    else expect(await page.evaluate(() => window.v2TestViewer.document.record)).toEqual(record);
    await replaceRecord(page, mode, old);
    await expect(v2(page)).toHaveCount(0);
    await expectOldGraph(page, mode, old);
    await replaceRecord(page, mode, record);
    await expect(runSummary(page).locator("[data-run-result]")).toHaveAttribute("data-run-result", "succeeded");
  });
}

for (const scenario of ["graph-repeated-calls", "agent-model-tool-usage", "workflow-success-empty", "workflow-failed", "workflow-cancelled"]) {
  test(`real Go Recorder export: ${scenario}`, { tag: "@P0" }, async ({ page }) => {
    const record = JSON.parse(readFileSync(new URL(`integrations/go/testdata/v2/${scenario}.json`, root), "utf8"));
    await openEntry(page, "embedded");
    await replaceRecord(page, "embedded", record);
    await expect(runSummary(page).locator("[data-run-result]")).toHaveAttribute("data-run-result", record.run.status);
    const stepsMode = v2(page).locator('button[data-reading-mode="steps"]');
    if (await stepsMode.count()) await stepsMode.click();
    await expect(callList(page).locator("button[data-step-id]")).toHaveCount(record.invocations.length - 1);
    const output = runSummary(page).locator('[data-run-channel="output"]');
    if (scenario === "graph-repeated-calls") {
      await expect(output.locator("[data-run-value]")).toHaveText("3");
      const calls = record.invocations.filter((call) => call.parent.state !== "root");
      expect(calls).toHaveLength(3);
      expect(new Set(calls.map((call) => call.definitionId)).size).toBe(1);
      for (const call of calls) await expectInvocation(page, call);
    } else if (scenario === "agent-model-tool-usage") {
      await expect(output).toContainText("新加坡当前晴，31°C，湿度 68%。");
      const models = record.invocations.filter((call) => call.kind === "model");
      expect(models).toHaveLength(2);
      for (const model of models) {
        const detail = await expectInvocation(page, model);
        await expect(detail.locator("[data-usage-id]")).toHaveCount(1);
        await expect(detail.locator("[data-usage-id]")).toContainText("13");
      }
    } else if (scenario === "workflow-success-empty") {
      await expect(output.locator("[data-content-id]")).toHaveAttribute("data-availability", "inline");
      await expect(output.locator("[data-run-value]")).toHaveText(/空字符串|Empty string/);
    } else {
      await expect(runSummary(page)).toContainText(scenario === "workflow-failed" ? "observed failure" : "context canceled");
      await expect(output.locator("[data-run-value]")).toHaveCount(0);
    }
    expect(await originalRecord(page)).toEqual(record);
  });
}
