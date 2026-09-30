import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";

export async function revealSource(button) {
  const containers = await button.locator("xpath=ancestor::details").all();
  for (const container of containers) {
    if (await container.getAttribute("open") === null) await container.locator(":scope > summary").click();
  }
}

export async function editCopy(page) {
  if (await page.locator("#snapshot-json").getAttribute("readonly") !== null) await page.locator("#edit-json").click();
}

export async function openStepSearch(page) {
  expect(await page.evaluate(() => window.playground.objectKind), "Agent reading has no step search").not.toBe("agent");
  await openReadingDirectory(page);
  const directory = page.locator("#run-inspection");
  if (await directory.evaluate((element) => element.tagName === "DETAILS" && !element.open)) await directory.locator(":scope > summary").click();
  await expect(page.locator("#inspection-search")).toBeVisible();
}

export async function openReadingDirectory(page) {
  expect(await page.evaluate(() => window.playground.objectKind), "Agent reading has no call or step directory").not.toBe("agent");
  const directory = page.locator("#reading-sidebar");
  await revealSource(directory.locator(":scope > summary"));
  if (await directory.getAttribute("open") === null) await directory.locator(":scope > summary").click();
  await expect(directory).toHaveAttribute("open");
}

export async function openRecordActions(page) {
  // Graph and Workflow controls are direct controls, not an Agent menu.
  expect(await page.evaluate(() => window.playground.objectKind)).not.toBe("agent");
}

export async function openRecordPicker(page) {
  await expect(page.locator("#sample")).toBeVisible();
  await expect(page.locator("#sample")).toBeEnabled();
}

export async function openRunInformation(page) {
  if (await page.evaluate(() => window.playground.objectKind === "graph")) {
    if (await page.evaluate(() => window.playground.scopeReading?.mode !== "all")) {
      const all = page.locator('#hierarchy-breadcrumbs [data-hierarchy-group=""]');
      await revealSource(all);
      await all.click();
    }
    await openStepSearch(page);
    const rootId = await page.evaluate(() => {
      const { explanation, document: record } = window.playground;
      const sources = Array.isArray(record) ? record : record.evidence || [record];
      const root = explanation.nodes.find((node) => node.evidence.some(({ envelopeIndex }) => {
        const source = sources[envelopeIndex];
        return source?.kind === "callback.event" && source.payload.run?.component === "Graph" && !source.payload.nodePath?.length;
      }));
      return (root || explanation.nodes[0])?.id;
    });
    expect(rootId).toBeTruthy();
    // The root result is read through its real step, including on later visits.
    // Declaration-only and legacy records without a root retain their first step.
    await page.locator("#inspection-search").fill(rootId);
    const root = page.locator(`[data-inspection-node=${JSON.stringify(rootId)}]`);
    await expect(root).toBeVisible();
    await root.click();
    await page.locator("#inspection-search").fill("");
    await expect(page.locator("#node-detail")).toBeVisible();
    return;
  }
  const summary = page.locator(":is(#run-result-summary, .eino-agent-reader [data-run-summary])");
  if (await page.evaluate(() => window.playground.objectKind === "agent")) {
    if (await page.evaluate(() => window.playground.scopeReading?.mode !== "all")) {
      const root = page.locator("[data-scope-global-result]");
      if (await root.isVisible()) await root.click();
      else {
        const all = page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]');
        await expect(all).toBeVisible();
        await all.click();
      }
    }
    await expect(summary).toBeVisible();
    const output = summary.locator('[data-run-channel="output"]').first();
    if (await output.count()) await output.scrollIntoViewIfNeeded();
    return;
  }
  await revealSource(summary);
  await expect(summary).toBeVisible();
}

export async function openScopeInformation(page) {
  const summary = page.locator(":is(#scope-result-summary, .eino-agent-reader [data-local-result])");
  if (!await page.evaluate(() => window.playground.objectKind === "agent")) await revealSource(summary);
  await expect(summary).toBeVisible();
}

export async function selectAgentStep(page, nodeId) {
  expect(await page.evaluate(() => window.playground.objectKind)).toBe("agent");
  const row = page.locator(`[data-trajectory-step=${JSON.stringify(nodeId)}]`);
  await expect(row, `Canonical step ${nodeId} must have one real trajectory row; use its recorded issue action when it has none`).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.click();
  expect(await page.evaluate(() => window.playground.linkedSelection.executionNodeId)).toBe(nodeId);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  return row;
}

export async function openAgentScope(page, groupId) {
  expect(await page.evaluate(() => window.playground.objectKind)).toBe("agent");
  if (await page.evaluate((id) => window.playground.inspectionScope.groupId === id
    && !window.playground.inspectionScope.ungroupedOnly, groupId)) {
    await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", groupId);
    return;
  }
  const rows = page.locator(`.trajectory-turn[data-trajectory-scope=${JSON.stringify(groupId)}] [data-trajectory-record]`);
  if (!await rows.count()) {
    const all = page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [data-hierarchy-group=""]');
    await expect(all, `Scope ${groupId} is not in the current trajectory; returning to all records must be a visible action`).toBeVisible();
    await all.click();
  }
  const row = rows.first();
  await expect(row, `Scope ${groupId} must own a real trajectory row`).toBeVisible();
  await row.click();
  const action = page.locator(`:is(#node-detail, .eino-agent-reader [data-step-detail]) .agent-step-scope [data-hierarchy-group=${JSON.stringify(groupId)}]`);
  await expect(action).toHaveCount(1);
  await expect(action).toBeVisible();
  await action.click();
  expect(await page.evaluate(() => window.playground.inspectionScope)).toEqual({ groupId, ungroupedOnly: false });
  await expect(page.locator(':is(#hierarchy-breadcrumbs, .eino-agent-reader [data-reading-scope]) [aria-current="location"]')).toHaveAttribute("data-hierarchy-group", groupId);
}

export async function openDetails(page) {
  const button = page.locator("#open-details");
  if (await page.evaluate(() => window.playground.objectKind === "agent")) {
    const selected = await page.evaluate(() => window.playground.linkedSelection);
    const trajectory = page.locator(`[data-trajectory-record=${JSON.stringify(selected.trajectoryRecordId || "")}]`);
    if (selected.trajectoryRecordId) {
      await expect(trajectory).toHaveCount(1);
      await expect(trajectory).toBeVisible();
      await trajectory.click();
    } else if (selected.executionNodeId) await selectAgentStep(page, selected.executionNodeId);
    else await page.locator("[data-trajectory-record]").first().click();
    await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toBeVisible();
    return;
  }
  if (await page.evaluate(() => window.playground.objectKind === "graph")) {
    const selected = page.locator('[data-inspection-node][aria-current="true"]');
    await expect(selected).toHaveCount(1);
    await revealSource(selected);
    await selected.click();
    await expect(page.locator("#node-detail")).toBeVisible();
    return;
  }
  await revealSource(button);
  await button.click();
}

export async function openRaw(page) {
  expect(await page.evaluate(() => window.playground.objectKind), "Only the unchanged Workflow workbench retains the Raw operation").toBe("workflow");
  const button = page.locator("#open-raw");
  await revealSource(button);
  await button.click();
}

export async function openPasteDraft(page) {
  expect(await page.evaluate(() => window.playground.objectKind), "Only Workflow exposes the raw editor").toBe("workflow");
  await openRaw(page);
  const button = page.locator("#paste-record");
  await revealSource(button);
  await button.click();
  await expect(page.locator("#snapshot-json")).toBeVisible();
  await expect(page.locator("#snapshot-json")).toBeEditable();
}

// The Agent and Graph workbench intentionally has no raw-source UI. Verify the current
// real UI selection owns the exact original envelope; do not open a hidden tab
// or substitute a document-only equality check for the association assertion.
export async function expectSelectedEvidence(page, index, expected) {
  const actual = await page.evaluate((envelopeIndex) => {
    const detail = window.playground.selectedNodeDetail;
    const selection = window.playground.linkedSelection;
    const indexes = (detail?.evidence || []).map((entry) => entry.envelopeIndex);
    return { selection, indexes, envelope: window.playground.document.evidence[envelopeIndex],
      stepId: detail?.explanationNode?.id || detail?.executionNode?.id,
      trajectoryId: detail?.trajectoryRecord?.id, kind: window.playground.objectKind,
      definitionOnly: !window.playground.executionDAG && detail?.explanationNode?.basis === "declared",
      title: detail?.presentation?.name || detail?.presentation?.title };
  }, index);
  expect(actual.indexes).toContain(index);
  expect(actual.selection.evidenceIndexes).toContain(index);
  if (actual.trajectoryId) {
    expect(actual.selection.trajectoryRecordId).toBe(actual.trajectoryId);
    await expect(page.locator(`[data-trajectory-record=${JSON.stringify(actual.trajectoryId)}]`)).toHaveAttribute("aria-pressed", "true");
  } else {
    expect(actual.stepId).toBeTruthy();
    if (actual.definitionOnly) expect(actual.selection.executionNodeId).toBeUndefined();
    else expect(actual.selection.executionNodeId).toBe(actual.stepId);
    if (actual.kind === "agent") {
      // A real run/step issue can select a canonical error without a matching
      // trajectory row. Its visible detail and exact source association remain
      // verifiable without inventing a directory or a trajectory identity.
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail])")).toBeVisible();
      expect(actual.title).toBeTruthy();
      await expect(page.locator(":is(#node-detail, .eino-agent-reader [data-step-detail]) .node-detail-hero h3")).toHaveAttribute("title", actual.title);
      await expect(page.locator("[data-inspection-node]")).toHaveCount(0);
    } else await expect(page.locator(`[data-inspection-node=${JSON.stringify(actual.stepId)}]`)).toHaveAttribute("aria-current", "true");
  }
  expect(actual.envelope).toEqual(expected);
  return actual.envelope;
}

export const defaultSamples = Object.freeze({
  agent: "agent-weather-workflow",
  graph: "graph-io-structured",
  workflow: "workflow-io-success",
});
const sampleFiles = {
  "agent-weather-workflow": "eino-agent-recorder-trip-planner-completed-v1.json",
  "agent-weather-failure": "eino-agent-recorder-trip-planner-failure-completed-v1.json",
  "agent-incomplete": "eino-agent-recorder-incomplete-v1.json",
  "compose-cyclic-graph": "eino-graph-recorder-cyclic-completed-v1.json",
  "workflow-weather": "eino-workflow-recorder-weather-completed-v1.json",
};

// Type belongs to the opened record. Changing type is an explicit trip through
// the real homepage, not a hidden category control or an application test hook.
export async function openExamples(page) {
  if (await page.locator("#record-opening").isVisible()) await page.locator('[data-open-example="agent-weather-workflow"]').click();
  await openRecordPicker(page);
}

export async function openSample(page, kind = "agent", id = defaultSamples[kind]) {
  const opening = page.locator("#record-opening");
  if (!await opening.isVisible() && await page.evaluate(() => window.playground.objectKind) !== kind) {
    const locale = await page.evaluate(() => window.playground.language);
    await page.locator(".identity").click();
    await page.waitForFunction(() => window.playground?.ready);
    await expect(opening).toBeVisible();
    expect(await page.evaluate(() => window.playground.language)).toBe(locale);
  }
  if (await opening.isVisible()) await page.locator(`[data-example-kind=${JSON.stringify(kind)}]`).click();
  await expect(page.locator("#sample")).toBeEnabled();
  await page.locator("#sample").selectOption(id);
  await expect(page.locator("#sample")).toHaveValue(id);
  await expect.poll(() => page.evaluate(() => window.playground?.objectKind)).toBe(kind);
  await expect.poll(() => page.evaluate(() => Boolean(window.playground?.document))).toBe(true);
  const file = sampleFiles[id] || `recorder-matrix/${id}.json`;
  const expected = JSON.parse(readFileSync(new URL(`../../fixtures/${file}`, import.meta.url), "utf8"));
  await expect.poll(() => page.evaluate(() => window.playground.document)).toEqual(expected);
}

// Display fixtures enter through the existing Workflow raw-copy editor.
// File import is intentionally absent from the workbench. This does not claim
// that an Agent or Graph can reject an import in place; those cases use a bad example.
export async function openWorkbenchRecord(page, recordOrText) {
  const text = typeof recordOrText === "string" ? recordOrText : JSON.stringify(recordOrText);
  const state = await page.evaluate(() => ({ opened: Boolean(window.playground.document), kind: window.playground.objectKind }));
  if (!state.opened || state.kind !== "workflow") await openSample(page, "workflow");
  await openRaw(page);
  await editCopy(page);
  await page.locator("#snapshot-json").fill(text);
  await page.locator("#apply-json").click();
  // apply is synchronous: malformed/invalid drafts legitimately leave the old
  // record in place. Callers keep their exact success or rejection assertions.
}

export async function expectAgentTrajectory(page) {
  await expect(page.locator('.eino-agent-reader [data-agent-trajectory]')).toBeVisible();
  await expect(page.locator("#run-view-tabs")).toBeHidden();
  await expect(page.locator("#dag canvas, #dag svg")).toHaveCount(0);
}
