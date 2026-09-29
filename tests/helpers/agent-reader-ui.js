import { expect } from "@playwright/test";

export const agentReader = (page) => page.locator('[data-eino-run-viewer="agent"]');
export const agentDetail = (reader) => reader.locator("[data-step-detail]");
export const agentValue = (reader, direction) => agentDetail(reader).locator(`[data-business-channel=${JSON.stringify(direction)}] [data-run-value]`);
export const agentBoundary = (reader, direction, { local = false } = {}) => reader.locator(`${local ? "[data-local-result]" : "[data-run-summary]"} [data-${local ? "scope" : "run"}-channel=${JSON.stringify(direction)}]`);

// Exercise the actual trajectory and scope-path controls. A test must not
// restore the removed directory or use a private selection hook as a UI action.
export async function selectAgentReaderStep(reader, id) {
  const row = reader.locator(`[data-trajectory-step=${JSON.stringify(id)}]`);
  if (!await row.count()) {
    const all = reader.locator('[data-reading-scope] [data-hierarchy-group=""]');
    await expect(all, `Step ${id} must be reachable from the current reading scope`).toBeVisible();
    await all.click();
  }
  await expect(row, `Canonical step ${id} must own exactly one trajectory row`).toHaveCount(1);
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(agentDetail(reader)).toHaveAttribute("data-step-id", id);
  return row;
}

export async function openAgentReaderScope(reader, id, { keyboard = false } = {}) {
  const nav = reader.locator("[data-reading-scope]");
  if (await nav.getAttribute("data-group-id") === id) return;
  const rows = reader.locator(`.trajectory-turn[data-trajectory-scope=${JSON.stringify(id)}] [data-trajectory-record]`);
  if (!await rows.count()) {
    const all = nav.locator('[data-hierarchy-group=""]');
    await expect(all, `Scope ${id} must be reachable from all trajectory records`).toBeVisible();
    await all.click();
  }
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  const path = agentDetail(reader).locator(`button[data-hierarchy-group=${JSON.stringify(id)}]`);
  await expect(path).toHaveCount(1);
  if (keyboard) {
    await path.focus();
    await path.press("Enter");
  } else await path.click();
  await expect(nav).toHaveAttribute("data-group-id", id);
}

export async function showAgentGlobalResult(reader) {
  const back = reader.locator('[data-reading-scope] [data-hierarchy-group=""]');
  if (await back.isVisible()) await back.click();
  await expect(reader.locator("[data-reading-scope]")).toHaveAttribute("data-group-id", "");
}

// Hosts may explicitly request evidence through the public API; the default
// Agent UI intentionally has no Raw/source toolbar. Keep the exact source
// assertion without resurrecting a user-rejected technical control.
export async function expectAgentAPIEvidence(page, reader, index, original, viewerName = "viewer") {
  const result = await page.evaluate(({ index, viewerName }) => {
    const viewer = window[viewerName];
    const selected = viewer.selectEvidence(index);
    return { selected, index: viewer.selectedEnvelopeIndex, envelope: viewer.document.evidence[index] };
  }, { index, viewerName });
  expect(result.selected).toBe(true);
  expect(result.index).toBe(index);
  expect(result.envelope).toEqual(original);
  const evidence = reader.locator("[data-raw-envelope]");
  await expect(evidence).toBeVisible();
  expect(JSON.parse(await evidence.textContent())).toEqual(original);
}
