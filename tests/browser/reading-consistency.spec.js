import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { projectEinoViewerDocument } from "../../src/viewer.js";
import { explainExecutionDAG } from "../../src/explanation.js";
import { openStepSearch, openReadingDirectory, openScopeInformation, revealSource, expectSelectedEvidence, selectAgentStep, openAgentScope, openWorkbenchRecord } from "../helpers/workbench-ui.js";
import { agentReader, agentDetail, agentBoundary, selectAgentReaderStep, openAgentReaderScope, expectAgentAPIEvidence } from "../helpers/agent-reader-ui.js";

const root = new URL("../../", import.meta.url);
const fixture = (id) => JSON.parse(readFileSync(new URL(`fixtures/recorder-matrix/${id}.json`, root), "utf8"));
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const entries = [];
  errors.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

function explanation(record) {
  const projected = projectEinoViewerDocument(structuredClone(record));
  expect(projected.ok).toBe(true);
  const result = explainExecutionDAG(projected.document.execution, projected.document.evidence, { diagnostics: [...projected.diagnostics, ...(record.diagnostics || [])] });
  expect(result.ok).toBe(true);
  return result.explanation;
}

async function openReader(page, mode) {
  if (mode === "workbench") {
    await page.goto(process.env.EINO_VIEWER_PLAYGROUND_PATH ?? "/.artifacts/pages/?lang=zh");
    await page.waitForFunction(() => window.playground?.ready);
  } else if (mode === "portable") await page.goto(new URL(".artifacts/portable/eino-viewer.html", root).href);
  else {
    await page.route("**/__reading-consistency__", (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><meta charset="utf-8"><title>Reading consistency</title><script type="importmap">{"imports":{"eino-workflow-dag":"/node_modules/eino-workflow-dag/dist/eino-workflow-dag.js","cytoscape":"/node_modules/cytoscape/dist/cytoscape.esm.min.mjs"}}</script></head><body><main id="viewer"></main></body></html>' }));
    await page.goto("/__reading-consistency__");
  }
  await page.waitForLoadState("networkidle");
}

async function importRecord(page, mode, record) {
  if (mode === "embedded") {
    await page.evaluate(async (input) => {
      const { createEinoRunViewer } = await import("/src/run-viewer.js");
      if (window.readingViewer) window.readingViewer.update(input);
      else window.readingViewer = createEinoRunViewer(document.querySelector("#viewer"), input, { locale: "zh" });
    }, record);
  } else if (mode === "workbench") {
    await openWorkbenchRecord(page, record);
    await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(record);
  } else {
    await page.locator("#record-file").setInputFiles({ name: "reading-consistency.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) });
    await expect(page.locator("#import-status")).toHaveAttribute("data-error", "false");
  }
}

async function selectStep(page, mode, id) {
  if (await agentReader(page).count()) return selectAgentReaderStep(agentReader(page), id);
  if (mode === "workbench") {
    if (await page.evaluate(() => window.playground.objectKind === "agent")) {
      await selectAgentStep(page, id);
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

async function selectGroup(page, mode, groups, id) {
  if (await agentReader(page).count()) return openAgentReaderScope(agentReader(page), id);
  if (mode === "workbench" && await page.evaluate(() => window.playground.objectKind === "agent")) {
    await openAgentScope(page, id);
    return;
  }
  const path = [];
  let group = groups.find((entry) => entry.id === id);
  while (group) { path.unshift(group.id); group = groups.find((entry) => entry.id === group.parentId); }
  if (mode === "workbench") {
    await openReadingDirectory(page);
    await page.locator('#hierarchy-breadcrumbs [data-hierarchy-group=""]').click();
    if (await page.locator("#hierarchy-directory").getAttribute("open") === null) await page.locator("#hierarchy-directory > summary").click();
    for (const entry of path) await page.locator(`#hierarchy-groups [data-hierarchy-group=${JSON.stringify(entry)}]`).click();
  } else {
    await page.locator("[data-all-groups]").click();
    const directory = page.locator("[data-group-directory]");
    if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
    for (const parent of path.slice(0, -1)) {
      const branch = page.locator(`[data-group-children=${JSON.stringify(parent)}]`);
      if (await branch.getAttribute("open") === null) await branch.locator(":scope > summary").click();
    }
    await page.locator(`[data-group-select=${JSON.stringify(id)}]`).click();
  }
}

async function expectOriginalRecord(page, mode, record) {
  if (mode === "workbench") expect(await page.evaluate(() => window.playground.document)).toEqual(record);
  else if (await agentReader(page).count()) {
    if (mode === "embedded") expect(await page.evaluate(() => window.readingViewer.document.evidence)).toEqual(record.evidence);
    else {
      const download = page.waitForEvent("download");
      await page.locator("#download-record").click();
      expect(JSON.parse(readFileSync(await (await download).path(), "utf8"))).toEqual(record);
    }
  }
  else {
    const raw = page.locator("[data-original-record]");
    const disclosure = raw.locator("..");
    if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
    await expect.poll(async () => JSON.parse(await raw.textContent() || "null")).toEqual(record);
  }
}

async function expectErrorCapture(mode, issue, availability, message) {
  await expect(issue).toHaveCount(1);
  const box = issue.locator(mode === "workbench" ? ".business-value" : ".erv-value");
  await expect(box).toHaveAttribute("data-availability", availability);
  const value = box.locator(mode === "workbench" ? ".business-value-text" : "[data-run-value]");
  if (availability === "not-observed") {
    await expect(value).toHaveCount(0);
    await expect(box.locator(".run-copy-value, [data-copy-value], [data-run-copy-index], [data-scope-copy-index]")).toHaveCount(0);
    await expect(box).toContainText(/超出大小限制|Size limit exceeded/);
    await expect(box).not.toContainText(message);
  } else {
    await expect(value).toHaveText(message);
    if (availability === "redacted") await expect(box).toContainText(/已脱敏|Redacted/);
    if (availability === "truncated") await expect(box).toContainText(/源内容已截断|Truncated at source|Source truncated/);
  }
}

for (const mode of ["workbench", "embedded", "portable"]) {
  test(`${mode} retains an independent Tool result beside an error from the same event`, { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
    await openReader(page, mode);
    for (const variant of ["business", "same-error", "numeric-text", "redacted", "truncated", "omitted"]) {
      const record = fixture("agent-tool-recovered");
      const index = record.evidence.findIndex((entry) => entry.kind === "agent.event" && entry.payload.output?.message?.value?.role === "tool");
      const payload = record.evidence[index].payload;
      const callId = payload.output.message.value.tool_call_id;
      payload.error = { message: `independent execution error for ${callId}` };
      // UI-only copies: capture belongs to the error on this mixed event, not
      // its independently saved fallback output. Keep callId in the error so
      // the existing real Tool ownership is preserved in every boundary case.
      const capture = {
        redacted: { status: "captured", redacted: true },
        truncated: { status: "captured", truncated: true },
        omitted: { status: "omitted", reason: "size_limit" },
      }[variant];
      if (capture) record.evidence[index].metadata = { ...record.evidence[index].metadata, capture };
      if (variant === "redacted") payload.error.message += " [REDACTED]";
      if (variant === "truncated") payload.error.message += "…";
      const availability = variant === "omitted" ? "not-observed" : capture ? variant : "available";
      if (variant === "same-error") payload.output.message.value.content = JSON.stringify(payload.error);
      if (variant === "numeric-text") {
        payload.output.message.value.content = '{"id":9007199254740993}';
        const call = record.evidence.flatMap((entry) => entry.payload.output?.message?.value?.tool_calls || []).find((entry) => entry.id === callId);
        call.function.arguments = '{"id":9007199254740993}';
      }
      const expected = payload.output.message.value.content;
      const node = explanation(record).nodes.find((entry) => entry.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      await importRecord(page, mode, record);
      await selectStep(page, mode, node.id);
      const detail = agentDetail(agentReader(page));
      const trajectoryOutput = detail.locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输出$/ }) });
      const output = trajectoryOutput.locator(".business-value-text");
      await expect(output).toHaveText(expected);
      const outputBox = trajectoryOutput.locator(".business-value");
      await expect(outputBox).toHaveAttribute("data-availability", "available");
      await expect(outputBox.locator(".run-copy-value")).toHaveCount(0);
      if (variant === "numeric-text") {
        let input;
        {
          const inputSection = detail.locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^输入$/ }) });
          const primary = inputSection.locator(":scope > .business-value");
          await expect(primary).toHaveAttribute("data-availability", "available");
          await expect(primary.locator(".business-value-text")).toHaveText(JSON.stringify({ customer: "Ada" }, null, 2));
          const additional = inputSection.locator("[data-additional-input]");
          await expect(additional).not.toHaveAttribute("open");
          await additional.locator(":scope > summary").click();
          const recordedInput = additional.locator(".business-value").filter({
            has: page.locator(".business-value-text", { hasText: /^\{"id":9007199254740993\}$/ }),
          });
          await expect(recordedInput).toHaveCount(1);
          await expect(recordedInput).toHaveAttribute("data-availability", "available");
          await expect(recordedInput).toHaveAttribute("data-value-type", "string");
          input = recordedInput.locator(".business-value-text");
          await expect(inputSection.locator(".run-copy-value")).toHaveCount(0);
        }
        await revealSource(input);
        await expect(input).toBeVisible();
        await expect(input).toHaveText('{"id":9007199254740993}');
        await expect(detail).not.toContainText("9007199254740992");
      }
      const issue = detail.locator(".trajectory-detail-value").filter({ has: page.locator("small", { hasText: /^错误$/ }) });
      await expectErrorCapture("workbench", issue, availability, payload.error.message);
      if (variant === "numeric-text") {
        await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async (text) => { window.copiedIndependentError = text; },
        } }));
        await issue.locator(".run-copy-value").click();
        await expect.poll(() => page.evaluate(() => window.copiedIndependentError)).toBe(payload.error.message);
        await expect(output).toHaveText(expected);
      }
      await expect(detail).toHaveAttribute("data-trajectory-detail", "tool:call-tool-recovered");
      const sourceIndexes = JSON.parse(await issue.locator(".business-value").getAttribute("data-evidence-indexes"));
      expect(sourceIndexes).toContain(index);
      if (mode === "embedded") await expectAgentAPIEvidence(page, agentReader(page), index, record.evidence[index], "readingViewer");
      if (mode === "workbench") await expectSelectedEvidence(page, index, record.evidence[index]);
      await expectOriginalRecord(page, mode, record);
    }
  });

  test(`${mode} applies body capture flags consistently to final, step and local values`, { tag: ["@P0", "@data-matrix"] }, async ({ page }) => {
    await openReader(page, mode);
    for (const [variant, path, expected] of [["metadata", undefined, "truncated"], ["metadata-and-diagnostic", "/payload/body", "truncated"], ["unscoped-diagnostic", "/payload/body", "available"], ["unrelated", "/payload/name", "available"]]) {
      for (const id of ["graph-io-structured", "agent-nested-distinct-results"]) {
        const record = fixture(id);
        for (const entry of record.evidence) {
          if (entry.kind !== "component.io") continue;
          if (variant.startsWith("metadata")) entry.metadata = { ...entry.metadata, capture: { status: "captured", truncated: true } };
        }
        // Saved-record diagnostics use relative paths, without envelopeIndex.
        // They cannot label one particular body unless its capture metadata does.
        if (path) record.diagnostics = [...(record.diagnostics || []), { path, code: "projection.truncated", severity: "warning", message: "Recorded body shortened" }];
        const explained = explanation(record);
        await importRecord(page, mode, record);
        if (id === "graph-io-structured") {
          for (const direction of ["input", "output"]) {
            const rootSelector = mode === "workbench" ? "#run-result-summary" : "[data-run-summary]";
            const rootValue = page.locator(`${rootSelector} [data-run-channel="${direction}"] [data-run-value]`);
            await revealSource(rootValue);
            await expect(rootValue).toBeVisible();
            await expect(rootValue).toHaveAttribute("data-availability", expected);
            const item = explained.run[direction].items[0];
            const index = item.evidenceEnvelopeIndexes[0];
            const node = explained.nodes.find((entry) => entry[direction].items.some((value) => value.evidenceEnvelopeIndexes.includes(index)));
            await selectStep(page, mode, node.id);
            const stepValue = page.locator(mode === "workbench" ? `#node-detail [data-business-channel="${direction}"] > .business-value` : `[data-step-detail] [data-run-channel="${direction}"] .erv-value`).first();
            await revealSource(stepValue);
            await expect(stepValue).toBeVisible();
            await expect(stepValue).toHaveAttribute("data-availability", expected);
          }
        } else {
          const group = explained.groups.find((entry) => entry.parentId);
          await selectGroup(page, mode, explained.groups, group.id);
          for (const direction of ["input", "output"]) {
            const value = agentBoundary(agentReader(page), direction, { local: true }).locator("[data-run-value]");
            await revealSource(value);
            await expect(value).toBeVisible();
            await expect(value).toHaveAttribute("data-availability", expected);
          }
        }
        await expectOriginalRecord(page, mode, record);
      }
    }
  });
}
