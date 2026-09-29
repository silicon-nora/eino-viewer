import { expect } from "@playwright/test";
import { openStepSearch } from "./workbench-ui.js";

// Independent UI expectation: nested trajectory metadata records the complete
// invocation identity. A shared evidence envelope or tool name is not ownership.
export function expectedScopeTrajectoryIds(records, groups, { groupId, ungroupedOnly = false } = {}) {
  if (ungroupedOnly) return records.filter(({ metadata }) => metadata?.agentScopeUnresolved).map(({ id }) => id);
  if (!groupId) return records.map(({ id }) => id);
  const inScope = (id) => {
    const visited = new Set();
    while (id && !visited.has(id)) {
      if (id === groupId) return true;
      visited.add(id);
      id = groups.find((group) => group.id === id)?.parentId;
    }
    return false;
  };
  return records.filter(({ metadata }) => !metadata?.agentScopeUnresolved && inScope(metadata?.agentScopeId)).map(({ id }) => id);
}

// Source references remain real controls, disclosed only when requested.
// Open their native details ancestors using the same summary controls as a reader.
export async function revealSource(reference) {
  const disclosures = reference.locator("xpath=ancestor::details");
  for (let index = 0; index < await disclosures.count(); index += 1) {
    const details = disclosures.nth(index);
    if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
}

export async function clickSource(reference) {
  await revealSource(reference);
  await reference.click();
}

export async function openPasteEditor(page) {
  for (const selector of ["#import-editor", "#paste-editor"]) {
    const details = page.locator(selector);
    if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
}
export async function ensureDiagramVisible(container) {
  const trajectory = container.locator("[data-agent-trajectory]");
  if (await trajectory.count()) {
    await expect(trajectory).toBeVisible();
    await expect(container.locator("[data-run-graph] canvas, [data-run-graph] svg, [data-draw-graph]")).toHaveCount(0);
    return;
  }
  const diagram = container.locator("[data-scope-diagram]");
  if (await diagram.evaluate((element) => element.tagName === "DETAILS" && !element.open)) await diagram.locator(":scope > summary").click();
  const draw = diagram.locator("[data-draw-graph]");
  if (await draw.isVisible()) await draw.click();
  await expect.poll(() => diagram.locator("[data-run-graph]").evaluate((host) =>
    Boolean(host.querySelector("canvas,svg") || host.dataset.empty === "true"))).toBe(true);
}

// Browser mechanisms shared by the workbench and SDK. The single direct-answer
// stress record has one source-backed row for each user envelope and one final
// assistant record; no production paging/trajectory helper supplies the oracle.
export async function expectAgentTrajectoryPaging(page, { mode, record, pageSize, setLocale }) {
  const workbench = mode === "workbench";
  const scroller = page.locator(workbench ? ":is(#domain-view, .eino-agent-reader [data-agent-trajectory])" : "#first [data-trajectory-list]");
  const rows = page.locator(workbench ? ":is(#domain-view, .eino-agent-reader [data-agent-trajectory]) [data-trajectory-record]" : "#first [data-trajectory-record]");
  const row = (id) => page.locator(`${workbench ? ":is(#domain-view, .eino-agent-reader [data-agent-trajectory])" : "#first"} [data-trajectory-record=${JSON.stringify(id)}]`);
  const pager = page.locator(workbench ? ":is(#domain-view, .eino-agent-reader [data-agent-trajectory]) .trajectory-pagination" : "#first [data-trajectory-pagination]");
  const previous = pager.locator("button").first(), next = pager.locator("button").last();
  const users = record.evidence.flatMap((envelope, index) => envelope.kind === "schema.message" && envelope.payload.role === "user"
    ? [{ id: `user:evidence:${index}`, index, value: envelope.payload.content }] : []);
  const expected = [...users.map(({ id }) => id), "assistant:turn:1:1"];
  expect(expected).toHaveLength(105);
  const ids = () => rows.evaluateAll((entries) => entries.map((entry) => entry.dataset.trajectoryRecord));
  const scrollTop = () => scroller.evaluate((element) => element.scrollTop);
  const scrollAway = () => scroller.evaluate((element) => { element.scrollTop = 173; return element.scrollTop; });
  const pages = Math.ceil(expected.length / pageSize), collected = [];
  await expect(rows).toHaveCount(pageSize);
  await expect(page.locator(workbench ? "#dag canvas, #dag svg" : "#first [data-run-graph], #first [data-draw-graph]")).toHaveCount(0);
  for (let index = 0; index < pages; index += 1) {
    const slice = expected.slice(index * pageSize, (index + 1) * pageSize);
    await expect.poll(ids).toEqual(slice);
    collected.push(...await ids());
    for (const user of users.slice(index * pageSize, (index + 1) * pageSize)) {
      await expect(row(user.id)).toContainText(user.value);
    }
    if (index === pages - 1) { await expect(next).toBeDisabled(); break; }
    expect(await scrollAway()).toBeGreaterThan(0);
    await next.focus();
    await page.keyboard.press("Enter");
    await expect.poll(ids).toEqual(expected.slice((index + 1) * pageSize, (index + 2) * pageSize));
    await expect(index === pages - 2 ? previous : next).toBeFocused();
    await expect.poll(scrollTop).toBe(0);
  }
  expect(collected).toEqual(expected);
  expect(new Set(collected).size).toBe(expected.length);
  for (let index = pages - 1; index > 0; index -= 1) {
    await previous.focus();
    await page.keyboard.press("Enter");
    await expect.poll(ids).toEqual(expected.slice((index - 1) * pageSize, index * pageSize));
    await expect(index === 1 ? next : previous).toBeFocused();
    await expect.poll(scrollTop).toBe(0);
  }

  // Select the last row of this same page from the canonical directory. It
  // must become visible inside the trajectory's own scroll area, without
  // stealing focus from the directory that should receive it when closing.
  const target = users[pageSize - 1], stepId = `input:user:${target.index}`;
  if (workbench) await openStepSearch(page);
  const search = page.locator(workbench ? "#inspection-search" : "#first [data-step-search]");
  const step = page.locator(workbench ? `[data-inspection-node=${JSON.stringify(stepId)}]` : `#first [data-step-list] [data-step-id=${JSON.stringify(stepId)}]`);
  await search.fill(stepId);
  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await step.focus();
  await page.keyboard.press("Enter");
  const selected = row(target.id);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => scroller.evaluate((element, id) => {
    const row = element.querySelector(`[data-trajectory-record="${id}"]`);
    const bounds = element.getBoundingClientRect(), item = row?.getBoundingClientRect();
    return Boolean(item && item.top >= bounds.top - 1 && item.bottom <= bounds.bottom + 1);
  }, target.id)).toBe(true);
  const input = page.locator(workbench ? ':is(#node-detail, .eino-agent-reader [data-step-detail]) [data-business-channel="input"] .business-value-text'
    : '#first [data-step-detail] [data-run-channel="input"] [data-run-value]');
  await expect(input).toHaveText(target.value);
  const close = page.locator(workbench ? "#close-details" : "#first [data-close-step]");
  await close.click();
  await expect(step).toBeFocused();
  await page.keyboard.press("Enter");
  const position = await scrollAway();
  expect(position).toBeGreaterThan(0);
  await setLocale();
  await expect.poll(ids).toEqual(expected.slice(0, pageSize));
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect.poll(scrollTop).toBe(position);
  await expect(input).toHaveText(target.value);
  await close.click();
  await expect(step).toBeFocused();
}
