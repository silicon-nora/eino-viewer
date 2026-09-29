import { buildScopeReading } from "./scope-reading.js";
import { buildTrajectoryHierarchy, trajectoryRecordValue, trajectoryRecordPresentation } from "./trajectory-reading.js";
import { buildReadingStepPresentation } from "./reading-presentation.js";
import { channelReadingValue, compactRecordedValue, isRecordedErrorItem, preferredRecordedItem, previewRecordedText, recordedIssueValue, recordedValueText } from "./content-presentation.js";
import { parseRecordJSON } from "./record-input.js";
import { createRenderedValueFoldObserver } from "./rendered-value-fold.js";
import { agentReaderStyles } from "./agent-run-viewer-styles.js";

const words = {
  en: {
    trajectory: "Trajectory", details: "Step details", input: "Input", output: "Output", userInput: "User input", assistantOutput: "Assistant output",
    callInput: "Call input", callOutput: "Call output", all: "All steps", global: "Overall result", unconfirmed: "Unconfirmed scope",
    unknownRecord: "Agent record", unconfirmedState: "Recorded · invocation unconfirmed", unconfirmedCall: "Invocation unconfirmed", finalResult: "Final result",
    unknown: "Not recorded", redacted: "Redacted", truncated: "Source truncated", empty: "Empty string", null: "Recorded null", text: "Text",
    copy: "Copy value", copied: "Copied", copyFailed: "Copy failed", copyUnavailable: "Copy unavailable; select the value to copy.", expand: "Show full content", noSteps: "No steps in this scope", choose: "Select a step",
    error: "Error", interruption: "Interruption reason", duration: "Duration", noDuration: "Not recorded", invalidDuration: "Timestamp conflict",
    observedSpan: "Observed span", declaredDuration: "Declared duration", observedAt: "Recorded at", beforeTurn: "Before model turn",
    viewTrajectory: "View trajectory", issue: "Run error", stepIssue: "Step error", recovered: "Recovered step error", localFailure: "Local failure · overall run succeeded",
    callerRecovered: "Handled by caller", callerError: "Caller boundary error", locate: "View problem step", evidence: "Original evidence", source: "View original evidence",
    statuses: { success: "Success", failed: "Failed", cancelled: "Cancelled", incomplete: "Incomplete", running: "Running", declared: "Declared only", observed: "Observed", unknown: "Unknown", interrupted: "Interrupted", skipped: "Skipped" },
    states: { planned: "Planned · execution not observed", interrupted: "Interrupted", unrecorded: "Result not recorded" },
    reasons: { size_limit: "Size limit exceeded", unsupported_value: "Unsupported value type", stream_not_consumed: "Stream not captured", not_captured: "Not recorded" },
    turn: (value) => `Turn ${value}`, additional: (value) => `Other recorded values (${value})`, issues: (value) => `Errors / interruptions · ${value}`,
  },
  zh: {
    trajectory: "轨迹", details: "运行详情", input: "输入", output: "输出", userInput: "用户输入", assistantOutput: "助手输出",
    callInput: "调用输入", callOutput: "调用输出", all: "全部步骤", global: "整次结果", unconfirmed: "归属未确认",
    unknownRecord: "Agent 记录", unconfirmedState: "已记录 · 调用归属未确认", unconfirmedCall: "归属未确认", finalResult: "最终结果",
    unknown: "未记录", redacted: "已脱敏", truncated: "源内容已截断", empty: "空字符串", null: "已记录 null", text: "文本",
    copy: "复制内容", copied: "已复制", copyFailed: "复制失败", copyUnavailable: "无法自动复制，请选中内容复制。", expand: "展开全文", noSteps: "此范围无已记录节点", choose: "选择步骤",
    error: "错误", interruption: "中断原因", duration: "耗时", noDuration: "未记录", invalidDuration: "时间记录冲突",
    observedSpan: "观测时间跨度", declaredDuration: "声明耗时", observedAt: "记录时间", beforeTurn: "模型回合之前",
    viewTrajectory: "查看轨迹", issue: "运行错误", stepIssue: "步骤错误", recovered: "已恢复的步骤错误", localFailure: "局部失败，整体成功",
    callerRecovered: "调用方已处理", callerError: "调用方边界错误", locate: "查看异常步骤", evidence: "原始证据", source: "查看原始证据",
    statuses: { success: "成功", failed: "失败", cancelled: "已取消", incomplete: "未完成", running: "运行中", declared: "仅声明", observed: "已观察到", unknown: "未知", interrupted: "已中断", skipped: "已跳过" },
    states: { planned: "仅计划 · 未观察到执行", interrupted: "已中断", unrecorded: "结果未记录" },
    reasons: { size_limit: "超出大小限制", unsupported_value: "不支持的值类型", stream_not_consumed: "未采集流式内容", not_captured: "未记录" },
    turn: (value) => `第 ${value} 回合`, additional: (value) => `其他已记录值（${value}）`, issues: (value) => `错误 / 中断 · ${value}`,
  },
};

/**
 * Private Agent reading surface, shared by the workbench, embedded reader and
 * offline reader. Entry shells never render Agent rows or details themselves.
 * All identity, boundary and capture decisions stay in the existing read model.
 */
export function buildAgentRunView({ model, dom, locale = "en", options = {} }) {
  const t = words[locale], { explanation, inspection, trajectoryReading } = model;
  const run = explanation.run, evidence = model.document.evidence, records = model.trajectory?.records || [];
  const recordById = new Map(records.map((record) => [record.id, record]));
  const groups = explanation.groups || [], groupById = new Map(groups.map((group) => [group.id, group]));
  const source = (index) => evidence[index];
  const scopeOptions = () => ({ groupId: state.selectedGroupId, ungroupedOnly: state.ungroupedOnly });
  const state = { selectedStepId: null, selectedTrajectoryRecordId: null, selectedEnvelopeIndex: null,
    selectedGroupId: null, ungroupedOnly: false, disposed: false, restoring: false, graph: undefined };
  state.reading = buildScopeReading(model.document, explanation, { locale });
  const disclosures = new Map(), values = new Map(), rowControls = new Map(), foldObservers = new Map();
  let selectedNodeDetail, detailReturnFocus, detailReturnSelection, restoredScroll, restoreFrame, revealFrame;
  let selectedEvidenceIndexes = [], pointerStart = null, activeRaw;

  function element(tag, className = "", text) {
    const node = dom.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = "") {
    const node = element("button", className, text);
    node.type = "button";
    node.addEventListener("click", (event) => { if (!state.disposed) return action(event); });
    return node;
  }
  function setClass(node, name, enabled) {
    const classes = new Set((node.className || "").split(/\s+/).filter(Boolean));
    if (enabled) classes.add(name); else classes.delete(name);
    node.className = [...classes].join(" ");
  }
  function registerDisclosure(node, key) { disclosures.set(key, node); return node; }
  function clearRegion(region) {
    for (const key of disclosures.keys()) if (key.startsWith(`${region}:`)) disclosures.delete(key);
    for (const key of values.keys()) if (key.startsWith(`${region}:`)) values.delete(key);
    for (const [key, stop] of foldObservers) if (key.startsWith(`${region}:`)) { stop(); foldObservers.delete(key); }
  }
  function originalText(value) { return recordedValueText(value) ?? ""; }
  function duration(timing) {
    return Number.isFinite(timing?.durationMs) && timing.durationMs >= 0 ? `${timing.durationMs} ms`
      : timing?.availability === "invalid" ? t.invalidDuration : t.noDuration;
  }
  function timingText(timing) {
    if (timing?.semantics === "observed-at") {
      const at = timing.startedAtMs ?? timing.finishedAtMs;
      const date = Number.isFinite(at) ? new Date(at) : undefined;
      return `${t.observedAt} · ${date && Number.isFinite(date.getTime()) ? `${date.toISOString()} (UTC)` : t.noDuration}`;
    }
    const label = timing?.semantics === "observed-span" ? t.observedSpan : timing?.semantics === "declared-duration" ? t.declaredDuration : t.duration;
    return `${label} · ${duration(timing)}`;
  }
  function metadata(value) { return value.metadata || value.technical?.metadata || {}; }
  function hasException(value) {
    const meta = metadata(value);
    return value.status !== "success" || meta.agentScopeUnresolved || meta.interruptionReason
      || ["planned", "interrupted", "unrecorded"].includes(meta.executionState) || Boolean(value.error);
  }
  function statusText(value) {
    const meta = metadata(value);
    if (meta.agentScopeUnresolved && value.status !== "failed") return t.unconfirmedState;
    return t.states[meta.executionState] || t.statuses[value.status] || value.status || t.unknown;
  }
  function recordTitle(record) { return record.metadata?.agentScopeUnresolved ? t.unknownRecord : trajectoryRecordPresentation(record, { locale }).title; }
  function stepPresentation(node) {
    return buildReadingStepPresentation(node, { locale, envelopes: evidence,
      invocationLabels: model.invocationLabels, identityLabels: model.identityLabels });
  }
  function recordValue(record, direction) { return trajectoryRecordValue(record, direction, evidence, model.diagnostics); }
  function issueValue(issue) { return recordedIssueValue(issue, source, model.diagnostics); }
  function recordSummary(record) {
    if (record.metadata?.interruptionReason) return record.metadata.interruptionReason;
    if (record.error?.message) {
      const item = recordValue(record, "error");
      return item.availability === "not-observed" ? t.reasons[item.reason] || t.unknown
        : [t[item.availability], String(item.value ?? "").split("\n")[0]].filter(Boolean).join(" · ");
    }
    if (record.kind === "assistant" && record.metadata?.toolNames?.length) {
      const counts = new Map();
      for (const name of record.metadata.toolNames) counts.set(name, (counts.get(name) || 0) + 1);
      return [...counts].map(([name, count]) => count > 1 ? `${name} × ${count}` : name).join(" · ");
    }
    return compactRecordedValue(recordValue(record, record.kind === "user" ? "input" : "output").value) ?? t.unknown;
  }
  function visibleRecords() { return trajectoryReading?.recordsForScope(scopeOptions()) || []; }
  function groupPath(id) { return inspection.getGroupPath(id); }

  const root = element("section", "eino-run-viewer eino-agent-reader");
  root.lang = locale;
  root.tabIndex = -1;
  root.dataset.runTitle = "";
  root.dataset.einoRunViewer = "agent";
  root.setAttribute("aria-label", t.trajectory);
  const valueFolds = createRenderedValueFoldObserver(root);
  root.append(element("style", "", agentReaderStyles));
  const header = element("header", "agent-reader-header");
  const runMeta = element("div", "agent-run-meta");
  const runDuration = element("span", "run-duration", `${t.duration} · ${duration(run.timing)}`);
  runDuration.dataset.agentDuration = "";
  runDuration.dataset.runDuration = "";
  runMeta.append(runDuration);
  const result = button(run.result.label, () => {
    const targets = [...new Set(run.issues.filter((issue) => !issue.recovered && inspection.getNode(issue.nodeId)).map(({ nodeId }) => nodeId))];
    if (targets.length === 1) locateStep(targets[0], result);
    else showGlobalResult(true);
  }, "agent-run-exception");
  result.dataset.runResult = run.result.state;
  result.dataset.agentOutcome = run.result.state;
  result.hidden = run.result.state === "success";
  runMeta.append(result);
  const capture = button(run.capture.label, () => showGlobalResult(), "agent-run-exception");
  capture.dataset.runCapture = run.capture.status;
  capture.dataset.agentCapture = run.capture.status;
  capture.hidden = run.capture.status === "complete";
  if (run.capture.status !== "complete") runMeta.append(capture);
  header.append(runMeta);
  root.append(header);

  const layout = element("div", "agent-reader-layout agent-reader-workspace");
  layout.dataset.readingWorkspace = "";
  layout.dataset.detailOpen = "false";
  // The reader can live inside a host main or alongside another reader.
  // Its content is not a second document-level main landmark.
  const main = element("div", "agent-reader-main");
  main.dataset.readingMain = "";
  const breadcrumbs = element("nav", "scope-breadcrumbs");
  breadcrumbs.dataset.readingScope = "";
  breadcrumbs.setAttribute("aria-label", t.trajectory);
  const summaryHost = element("div", "agent-reader-content");
  main.append(breadcrumbs, summaryHost);
  const detailPanel = element("aside", "agent-reader-detail");
  detailPanel.dataset.stepPanel = "";
  detailPanel.hidden = true;
  detailPanel.open = false;
  const detailHeading = element("h2", "agent-detail-heading", t.details);
  detailHeading.tabIndex = -1;
  const detail = element("section", "node-detail");
  detail.dataset.stepDetail = "";
  detail.setAttribute("aria-label", t.details);
  const detailContent = element("div", "agent-reader-detail-content");
  detailContent.append(detailHeading, detail);
  detailPanel.append(detailContent);
  layout.append(main, detailPanel);
  root.append(layout);

  function appendCopy(parent, text) {
    const action = button(t.copy, async () => {
      let copied = false;
      try { await dom.defaultView?.navigator?.clipboard?.writeText(text); copied = Boolean(dom.defaultView?.navigator?.clipboard?.writeText); }
      catch { /* Keep both the content and current reading selection intact. */ }
      if (state.disposed) return;
      feedback.textContent = copied ? t.copied : t.copyFailed;
      feedback.setAttribute("aria-label", copied ? t.copied : t.copyUnavailable);
      feedback.title = copied ? t.copied : t.copyUnavailable;
      action.dataset.copyResult = copied ? "success" : "failed";
    }, "run-copy-value");
    action.dataset.copyValue = "";
    const feedback = element("span", "agent-copy-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const actions = element("div", "agent-copy-actions");
    actions.append(action, feedback);
    parent.append(actions);
  }

  function appendValue(parent, item, key, { copy = true, business = false, fold = false } = {}) {
    const value = item.value;
    // Canonical channels may decode scalar-looking message bodies. Once the
    // reading bridge recovers the original string, its ordinary availability
    // follows that original value; source capture restrictions remain binding.
    const availability = (!business || ["not-observed", "redacted", "truncated"].includes(item.availability)) && item.availability
      || (value === undefined ? "not-observed" : value === null ? "null" : value === "" ? "empty" : "available");
    const box = element("div", business ? "business-value" : "run-result-item");
    box.dataset.availability = availability;
    if (item.reason) box.dataset.captureReason = item.reason;
    box.dataset.evidenceIndexes = JSON.stringify(item.evidenceEnvelopeIndexes || []);
    if (item.evidenceEnvelopeIndexes?.length === 1) box.dataset.envelopeIndex = String(item.evidenceEnvelopeIndexes[0]);
    box.dataset.valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const label = availability === "not-observed" ? t.unknown : t[availability];
    if (label) box.append(element("small", business ? "business-value-state" : "run-value-state", label));
    if (item.reason && t.reasons[item.reason] && t.reasons[item.reason] !== label) {
      box.append(element("small", "business-value-state", t.reasons[item.reason]));
    }
    if (Object.hasOwn(item, "value") && value !== undefined && availability !== "not-observed") {
      const raw = originalText(value), text = raw === "" ? '""' : raw;
      const prose = typeof value === "string" && value !== "";
      if (typeof value === "string" && /^(?:null|true|false|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|[\[{])/i.test(raw.trim())) {
        box.append(element("small", "business-value-state", t.text));
      }
      const full = element(prose ? "div" : "pre", `run-result-value${business ? " business-value-text" : ""}${prose ? "" : " structured-value"}`, text);
      full.dataset.runValue = "";
      full.dataset.valueType = box.dataset.valueType;
      full.dataset.valueFormat = prose ? "text" : "json";
      full.dataset.availability = availability;
      values.set(key, full);
      if (fold) {
        const preview = element(prose ? "div" : "pre");
        preview.hidden = true;
        const expanded = registerDisclosure(element("details", "run-result-expanded business-value-expanded"), `${key}:expanded`);
        expanded.hidden = true;
        expanded.append(element("summary", "", t.expand));
        box.append(preview, expanded, full);
        const applyFold = () => {
          if (state.disposed || disclosures.get(`${key}:expanded`) !== expanded) return;
          const lines = text.split("\n", 7).slice(0, 6).join("\n");
          preview.className = `run-result-preview${prose ? "" : " structured-value"}`;
          preview.textContent = previewRecordedText(lines === text ? lines : `${lines}…`, 361);
          preview.hidden = false;
          expanded.hidden = false;
          expanded.dataset.runExpand = "";
          full.remove();
          expanded.append(full);
        };
        if (text.length > 320 || text.split("\n").length > 6) applyFold();
        else foldObservers.set(key, valueFolds.observe(full, applyFold));
      } else box.append(full);
      if (copy) appendCopy(box, raw);
    }
    parent.append(box);
    return box;
  }

  function appendChannel(parent, channel, direction, key, { boundary = false, local = false, copy = true } = {}) {
    const section = element("section", boundary ? `run-result-channel ${direction}` : "node-detail-section explanation-channel");
    section.dataset.businessChannel = direction;
    if (boundary) {
      section.dataset.runChannel = direction;
      if (local) section.dataset.scopeChannel = direction;
    }
    section.dataset.availability = channel?.availability || "not-observed";
    section.append(element(boundary ? "h3" : "h4", "", boundary ? local ? direction === "input" ? t.callInput : t.callOutput
      : direction === "input" ? t.input : t.finalResult : t[direction]));
    const items = channel?.items || [];
    if (boundary) {
      if (!items.length) appendValue(section, { availability: "not-observed" }, `${key}:empty`, { copy });
      items.forEach((item, index) => appendValue(section, item, `${key}:${index}`, { copy }));
    } else {
      const preferred = preferredRecordedItem(channel, direction, source);
      const append = (target, item, index) => appendValue(target,
        { ...item, value: channelReadingValue(item, direction, source) }, `${key}:${index}`, { copy, business: true });
      if (preferred) append(section, preferred, items.indexOf(preferred));
      else appendValue(section, { availability: "not-observed" }, `${key}:empty`, { copy, business: true });
      const remaining = items.filter((item) => item !== preferred);
      if (remaining.length) {
        const more = registerDisclosure(element("details", "business-value-expanded"), `${key}:additional`);
        const states = [...new Set(remaining.map(({ availability }) => ["redacted", "truncated", "not-observed"].includes(availability)
          ? availability === "not-observed" ? t.unknown : t[availability] : undefined).filter(Boolean))];
        more.append(element("summary", "", [t.additional(remaining.length), ...states].join(" · ")));
        for (const item of remaining) append(more, item, items.indexOf(item));
        section.append(more);
      }
    }
    parent.append(section);
    return section;
  }

  function appendScopeContext(parent, memberships, unresolved = false) {
    if (!unresolved && (groups.length <= 1 || !memberships.length)) return;
    const context = element("div", "step-scope-context agent-step-scope");
    context.append(element("small", "agent-scope-label", "Agent"));
    if (unresolved) context.append(element("span", "agent-scope-path", t.unconfirmedCall));
    else for (const group of memberships) {
      const path = groupPath(group.id).map(({ label }) => label).join(" / ");
      const roots = groups.filter(({ parentId }) => !parentId);
      const current = state.selectedGroupId === group.id || (!state.selectedGroupId && !state.ungroupedOnly
        && roots.length === 1 && roots[0].id === group.id);
      const line = element("div", "agent-scope-call");
      const control = current ? element("span", "agent-scope-path", path) : button(path, () => changeScope(group.id, false, true), "agent-scope-path agent-scope-action");
      if (!current) {
        control.dataset.hierarchyGroup = group.id;
        control.dataset.groupId = group.id;
        control.setAttribute("aria-label", `${t.viewTrajectory}: ${path}`);
      }
      control.dataset.stepGroupPath = group.id;
      line.append(control);
      context.append(line);
    }
    parent.append(context);
  }

  function appendIssues(parent, reading, local) {
    if (!reading.issues?.length) return;
    const issues = element("div", "run-result-issues");
    issues.dataset.runIssues = "";
    if (local) issues.dataset.scopeIssues = "";
    reading.issues.forEach((issue, index) => {
      const section = element("section", "run-result-issue");
      section.dataset.runIssue = issue.kind;
      if (local) section.dataset.scopeIssue = issue.nodeId || "boundary";
      section.dataset.recovered = String(Boolean(issue.recovered));
      const caller = local && issue.nodeId && !reading.nodeIds.includes(issue.nodeId);
      if (local) {
        section.dataset.scopeIssueOrigin = caller ? "caller" : "local";
        section.dataset.scopeIssueRole = caller ? "caller-boundary" : "local";
      }
      const node = inspection.getNode(issue.nodeId);
      const label = caller ? issue.recovered ? t.callerRecovered : t.callerError : issue.recovered ? t.recovered
        : issue.scope === "step" && run.result.state === "success" ? t.localFailure : issue.kind === "interruption" ? t.interruption : issue.scope === "step" ? t.stepIssue : t.issue;
      section.append(element("h3", "", `${label}${node ? ` · ${stepPresentation(node).title}` : ""}`));
      appendValue(section, issueValue(issue), `main:issue:${index}`, { fold: true });
      if (node) {
        const locate = button(t.locate, () => locateStep(node.id, locate), "issue-locate");
        locate.dataset.runIssueStep = node.id;
        locate.dataset.issueStep = node.id;
        section.append(locate);
      }
      issues.append(section);
    });
    if (reading.result.state === "success") {
      const disclosure = registerDisclosure(element("details", "run-issue-disclosure"), "main:issues");
      disclosure.append(element("summary", "", t.issues(reading.issues.length)), issues);
      parent.append(disclosure);
    } else parent.append(issues);
  }

  function renderBreadcrumbs() {
    breadcrumbs.replaceChildren();
    breadcrumbs.dataset.groupId = state.selectedGroupId || "";
    breadcrumbs.dataset.ungroupedOnly = String(state.ungroupedOnly);
    breadcrumbs.hidden = !state.selectedGroupId && !state.ungroupedOnly;
    const add = (label, id, current) => {
      const crumb = button(label, () => changeScope(id, false, true));
      crumb.dataset.hierarchyGroup = id || "";
      crumb.dataset.groupId = id || "";
      if (current) crumb.setAttribute("aria-current", "location");
      breadcrumbs.append(crumb);
    };
    add(t.all, null, !state.selectedGroupId && !state.ungroupedOnly);
    if (state.selectedGroupId) for (const group of groupPath(state.selectedGroupId)) add(group.label, group.id, group.id === state.selectedGroupId);
    if (state.ungroupedOnly) {
      const current = element("span", "", t.unconfirmed);
      current.setAttribute("aria-current", "location");
      breadcrumbs.append(current);
    }
  }

  function unmatchedInputs() {
    const represented = new Set(trajectoryReading?.nodeIdByRecordId.values() || []);
    return state.reading.nodeIds.flatMap((id) => {
      if (represented.has(id)) return [];
      const node = inspection.getNode(id);
      const items = node?.input?.items.filter((item) => item.evidenceEnvelopeIndexes?.length) || [];
      return items.length ? [{ node, items, order: Math.min(...items.flatMap((item) => item.evidenceEnvelopeIndexes)) }] : [];
    }).sort((left, right) => left.order - right.order);
  }
  function appendRecordedInput(parent, { node, items }) {
    const section = element("section", "agent-recorded-input");
    section.dataset.recordedInputNode = node.id;
    section.append(element("h3", "", stepPresentation(node).name));
    appendScopeContext(section, inspection.getNodeGroups(node.id), Boolean(metadata(node).agentScopeUnresolved));
    appendChannel(section, { items }, "input", `main:recorded:${node.id}`);
    parent.append(section);
  }

  function renderReading() {
    clearRegion("main");
    rowControls.clear();
    renderBreadcrumbs();
    const visible = visibleRecords(), hierarchy = buildTrajectoryHierarchy(visible), pending = unmatchedInputs();
    const supplementaryCount = pending.length;
    const local = state.reading.mode !== "all" && !state.reading.topLevel;
    const reading = local ? state.reading : run;
    const summary = element("section", "run-result-summary agent-reading-content");
    summary.dataset.groupId = state.selectedGroupId || "";
    summary.dataset.scopeMode = state.reading.mode;
    if (local) { summary.dataset.localResult = ""; summary.dataset.scopeId = state.selectedGroupId || ""; }
    else summary.dataset.runSummary = "";
    if (local) {
      const heading = element("header", "scope-result-heading");
      const global = button(t.global, () => showGlobalResult());
      global.dataset.scopeGlobalResult = "";
      global.dataset.globalResult = "";
      heading.append(global);
      const outcome = element("p", "scope-result-state", reading.result.label);
      outcome.dataset.scopeResult = reading.result.state;
      outcome.dataset.scopeOutcome = reading.result.state;
      outcome.hidden = reading.result.state === "success";
      summary.append(heading, outcome);
    }
    const view = element("section", "trajectory-view standard-panel");
    view.dataset.agentTrajectory = "";
    view.tabIndex = -1;
    view.setAttribute("aria-label", t.trajectory);
    const rows = new Map();
    let turnKey, list;
    for (const record of visible) {
      const direct = record.evidence.filter(({ role }) => !["context", "topology", "tool-call"].includes(role));
      const firstSource = Math.min(...(direct.length ? direct : record.evidence).map(({ envelopeIndex }) => envelopeIndex));
      while (pending.length && pending[0].order <= firstSource) { appendRecordedInput(view, pending.shift()); turnKey = undefined; }
      const nextTurn = trajectoryReading.turnKey(record);
      if (nextTurn !== turnKey) {
        turnKey = nextTurn;
        const turn = element("section", "trajectory-turn");
        turn.dataset.turn = String(record.turn || 0);
        const scopeId = trajectoryReading.scopeIdByRecordId.get(record.id);
        turn.dataset.trajectoryScope = scopeId || "";
        const scopeLabel = groupById.has(scopeId) ? groupPath(scopeId).map(({ label }) => label).join(" / ")
          : record.metadata?.agentScopeUnresolved ? t.unconfirmed : "";
        if (scopeLabel) turn.append(element("small", "trajectory-scope", scopeLabel));
        turn.append(element("h3", "", record.turn ? t.turn(record.turn) : t.beforeTurn));
        list = element("ol", "trajectory-list");
        list.dataset.trajectoryList = "";
        turn.append(list);
        view.append(turn);
      }
      const row = element("li");
      row.style?.setProperty("--trajectory-depth", hierarchy.depthByRecordId.get(record.id));
      const parent = hierarchy.parentByRecordId.get(record.id);
      if (parent) row.dataset.trajectoryParent = parent;
      const control = element("button", `trajectory-record ${record.status}`);
      control.type = "button";
      control.dataset.trajectoryRecord = record.id;
      const stepId = trajectoryReading.nodeIdByRecordId.get(record.id);
      if (stepId) control.dataset.trajectoryStep = stepId;
      if (record.metadata?.executionState) control.dataset.executionState = record.metadata.executionState;
      const identity = element("span", "trajectory-identity");
      identity.append(element("strong", "", recordTitle(record)));
      const group = groupById.get(trajectoryReading.scopeIdByRecordId.get(record.id));
      if (group?.parentId) identity.append(element("small", "", groupPath(group.id).map(({ label }) => label).join(" / ")));
      const preview = element("span", "trajectory-summary", recordSummary(record));
      const status = element("span", `trajectory-status ${record.status}`, statusText(record));
      status.hidden = !hasException(record);
      control.append(element("span", "trajectory-sequence", String(record.sequence).padStart(2, "0")), identity, preview, status);
      row.append(control);
      list.append(row);
      rowControls.set(record.id, control);
      rows.set(record.id, { row, control, preview });
    }
    for (const entry of pending) appendRecordedInput(view, entry);
    if (!visible.length && !supplementaryCount) view.append(element("p", "search-empty", t.noSteps));
    const fallbacks = {};
    for (const direction of ["input", "output"]) {
      const channel = reading[direction];
      const items = channel?.items || [];
      const matches = items.length === 1 && Object.hasOwn(items[0], "value") && items[0].availability !== "not-observed"
        ? visible.filter((record) => {
          if (direction === "input" && record.kind !== "user" || direction === "output" && record.kind !== "assistant") return false;
          const value = recordValue(record, direction);
          return value.availability === items[0].availability && value.reason === items[0].reason
            && JSON.stringify(value.value) === JSON.stringify(items[0].value)
            && value.evidenceEnvelopeIndexes.some((index) => items[0].evidenceEnvelopeIndexes.includes(index));
        }) : [];
      if (matches.length === 1) {
        const { row, control, preview } = rows.get(matches[0].id);
        setClass(row, "agent-boundary-row", true);
        preview.hidden = true;
        control.dataset.readingChannel = direction;
        const section = appendChannel(row, channel, direction, `main:boundary:${direction}`, { boundary: true, local });
        setClass(section, "agent-inline-value", true);
      } else {
        const section = appendChannel(summary, channel, direction, `main:boundary:${direction}`, { boundary: true, local });
        setClass(section, "agent-boundary-value", true);
        section.remove();
        fallbacks[direction] = section;
      }
    }
    if (fallbacks.input) summary.append(fallbacks.input);
    summary.append(view);
    if (fallbacks.output) summary.append(fallbacks.output);
    appendIssues(summary, reading, local);
    summaryHost.replaceChildren(summary);
    updateSelection();
  }

  function appendTrajectoryValue(parent, label, item, key, direction) {
    const section = element("div", "trajectory-detail-value");
    if (direction) section.dataset.businessChannel = direction;
    section.append(element("small", "", label));
    appendValue(section, item, key, { copy: !direction, business: true, fold: !direction });
    parent.append(section);
    return section;
  }
  function appendOtherInputs(parent, node, primary) {
    const comparableKey = (value, item) => JSON.stringify([value, item.availability, item.reason]);
    const seen = new Set([comparableKey(primary.value, primary)]);
    const remaining = (node?.input?.items || []).filter((item) => {
      let comparable = channelReadingValue(item, "input", source);
      if (node.kind === "tool" && comparable && typeof comparable === "object" && Object.keys(comparable).length === 1 && typeof comparable.argumentsJson === "string") {
        try { comparable = parseRecordJSON(comparable.argumentsJson); } catch { /* Preserve unsafe original JSON text. */ }
      }
      const key = comparableKey(comparable, item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!remaining.length) return;
    const more = registerDisclosure(element("details", "business-value-expanded"), "detail:additional-input");
    more.dataset.additionalInput = "";
    more.append(element("summary", "", t.additional(remaining.length)));
    remaining.forEach((item, index) => appendValue(more, { ...item, value: channelReadingValue(item, "input", source) }, `detail:additional-input:${index}`, { copy: false, business: true }));
    parent.append(more);
  }
  function renderTrajectoryDetail(record) {
    clearRegion("detail");
    const nodeId = trajectoryReading.nodeIdByRecordId.get(record.id), node = inspection.getNode(nodeId);
    detail.dataset.trajectoryDetail = record.id;
    if (nodeId) detail.dataset.stepId = nodeId; else delete detail.dataset.stepId;
    detail.dataset.executionState = record.metadata?.executionState || "";
    const content = element("div", "node-detail-content trajectory-record-detail");
    if (record.metadata?.executionState) content.dataset.executionState = record.metadata.executionState;
    const hero = element("div", "node-detail-hero");
    hero.append(element("small", "", record.turn ? t.turn(record.turn) : t.beforeTurn), element("h3", "", recordTitle(record)));
    if (hasException(record)) hero.append(element("p", `step-state execution-status ${record.status}`, statusText(record)));
    if (record.kind !== "user") hero.append(element("p", "step-duration", timingText(record.timing)));
    content.append(hero);
    const group = groupById.get(trajectoryReading.scopeIdByRecordId.get(record.id));
    appendScopeContext(content, group ? [group] : [], Boolean(record.metadata?.agentScopeUnresolved));
    const channels = element("div", "trajectory-detail-values");
    if (record.kind === "user" || record.input !== undefined || record.kind === "tool") {
      const primary = recordValue(record, "input");
      const input = appendTrajectoryValue(channels, t.input, primary, "detail:input", "input");
      appendOtherInputs(input, node, primary);
    } else if (node?.input?.items.length) appendChannel(channels, node.input, "input", "detail:input", { copy: false });
    if (record.error?.message) {
      const error = appendTrajectoryValue(channels, t.error, recordValue(record, "error"), "detail:error");
      error.dataset.trajectoryError = "";
      error.dataset.stepErrors = "";
      if (run.issues.some((issue) => issue.nodeId === nodeId && issue.recovered && issue.message === record.error.message)) {
        error.append(element("p", "step-state", t.recovered));
      }
    }
    const output = recordValue(record, "output");
    if (record.kind !== "user" && (!record.error?.message || output.value !== undefined)) appendTrajectoryValue(channels, t.output, output, "detail:output", "output");
    if (record.metadata?.interruptionReason && record.metadata.interruptionReason !== record.error?.message) {
      appendTrajectoryValue(channels, t.interruption, { value: record.metadata.interruptionReason }, "detail:interruption");
    }
    content.append(channels);
    detail.replaceChildren(content);
    selectedNodeDetail = { evidence: record.evidence, trajectoryRecord: record };
    appendSelectedEvidence();
  }

  function renderCanonicalDetail(node) {
    clearRegion("detail");
    delete detail.dataset.trajectoryDetail;
    detail.dataset.stepId = node.id;
    detail.dataset.executionState = metadata(node).executionState || "";
    const content = element("div", "node-detail-content explanation-node-detail");
    const hero = element("div", "node-detail-hero");
    const presentation = stepPresentation(node);
    const title = element("h3", "", presentation.name);
    title.title = presentation.name;
    hero.append(title);
    if (hasException(node)) hero.append(element("p", `step-state execution-status ${node.status}`, statusText(node)));
    if (node.kind !== "input") hero.append(element("p", "step-duration", timingText(node.timing)));
    content.append(hero);
    appendScopeContext(content, inspection.getNodeGroups(node.id), Boolean(metadata(node).agentScopeUnresolved));
    const channels = element("div", "trajectory-detail-values");
    appendChannel(channels, node.input, "input", "detail:input", { copy: false });
    const errors = node.output.items.filter((item) => isRecordedErrorItem(node, item, source));
    const related = run.issues.filter((issue) => issue.nodeId === node.id);
    const representsIssue = (item, issue) => issue.evidenceEnvelopeIndexes?.length > 0
      && issue.evidenceEnvelopeIndexes.every((id) => item.evidenceEnvelopeIndexes.includes(id))
      && (item.value === issue.message || item.value?.message === issue.message
        || !Object.hasOwn(item, "value") && item.availability === "not-observed" && issueValue(issue).availability === "not-observed");
    errors.forEach((item, index) => {
      const error = appendTrajectoryValue(channels, t.error, item, `detail:error:${index}`);
      error.dataset.stepErrors = "";
      if (related.some((issue) => issue.recovered && representsIssue(item, issue))) error.append(element("p", "step-state", t.recovered));
    });
    for (const [index, issue] of related.entries()) {
      if (errors.some((item) => representsIssue(item, issue))) continue;
      appendTrajectoryValue(channels, issue.recovered ? t.recovered : t.error, issueValue(issue), `detail:issue:${index}`);
    }
    if (node.kind !== "input") appendChannel(channels, { ...node.output, items: node.output.items.filter((item) => !errors.includes(item)) }, "output", "detail:output", { copy: false });
    if (metadata(node).interruptionReason && !related.some((issue) => issue.message === metadata(node).interruptionReason)) {
      appendTrajectoryValue(channels, t.interruption, { value: metadata(node).interruptionReason }, "detail:interruption");
    }
    content.append(channels);
    detail.replaceChildren(content);
    selectedNodeDetail = { evidence: node.evidence, explanationNode: node, presentation,
      executionNode: model.document.execution.nodes.find(({ id }) => id === node.id) };
    appendSelectedEvidence();
  }

  function updateSelection() {
    const selected = new Set(selectedEvidenceIndexes);
    for (const [id, control] of rowControls) {
      const record = recordById.get(id), active = id === state.selectedTrajectoryRecordId;
      setClass(control, "selected", active);
      setClass(control, "linked", record.evidence.some(({ envelopeIndex }) => selected.has(envelopeIndex)));
      control.setAttribute("aria-pressed", String(active));
    }
  }
  function rememberTrigger(trigger) {
    if (state.restoring) return;
    const origin = trigger || dom.activeElement;
    if (!origin || !trigger && detailPanel.contains?.(origin)) return;
    detailReturnFocus = origin;
    detailReturnSelection = origin.dataset?.trajectoryRecord ? { kind: "trajectory", id: origin.dataset.trajectoryRecord }
      : origin.dataset?.stepId ? { kind: "step", id: origin.dataset.stepId } : undefined;
  }
  function showDetail(focus) {
    detailPanel.hidden = false;
    detailPanel.open = true;
    layout.dataset.detailOpen = "true";
    if (focus && !state.restoring) detailHeading.focus?.({ preventScroll: true });
  }
  function revealDetail() {
    if (state.restoring || state.disposed || !root.isConnected) return;
    const view = dom.defaultView;
    if (revealFrame !== undefined) view?.cancelAnimationFrame?.(revealFrame);
    const reveal = () => {
      revealFrame = undefined;
      if (state.disposed || !root.isConnected || detailPanel.hidden) return;
      if ((root.getBoundingClientRect?.().width || 0) < 1200) detailHeading.scrollIntoView?.({ block: "nearest" });
    };
    if (view?.requestAnimationFrame) revealFrame = view.requestAnimationFrame(reveal); else reveal();
  }
  function notifyNode(id) {
    if (!id || state.restoring) return;
    const node = model.document.execution.nodes.find((entry) => entry.id === id) || inspection.getNode(id);
    options.onNodeClick?.({ id, node });
  }
  // A user-facing jump should open the same detail as clicking its proven
  // trajectory row. Public selectStep keeps its canonical-step contract.
  function locateStep(id, trigger) {
    const linked = [...(trajectoryReading?.nodeIdByRecordId || [])].filter(([, nodeId]) => nodeId === id);
    return linked.length === 1 ? selectTrajectoryRecord(linked[0][0], true, trigger) : selectStep(id, true, trigger);
  }
  function selectTrajectoryRecord(id, focus = false, trigger) {
    const record = recordById.get(id);
    if (!record || state.disposed) return false;
    rememberTrigger(trigger);
    if (!visibleRecords().some((entry) => entry.id === id)) changeScope(null);
    state.selectedTrajectoryRecordId = id;
    state.selectedStepId = trajectoryReading.nodeIdByRecordId.get(id) || null;
    selectedEvidenceIndexes = [...new Set(record.evidence.map(({ envelopeIndex }) => envelopeIndex))].sort((left, right) => left - right);
    renderTrajectoryDetail(record);
    showDetail(focus);
    updateSelection();
    notifyNode(state.selectedStepId);
    if (trigger || focus) revealDetail();
    return true;
  }
  function selectStep(id, focus = false, trigger) {
    const node = inspection.getNode(id);
    if (!node || state.disposed) return false;
    rememberTrigger(trigger);
    if (!state.reading.nodeIds.includes(id)) changeScope(null);
    const linked = [...(trajectoryReading?.nodeIdByRecordId || [])].filter(([, nodeId]) => nodeId === id);
    state.selectedStepId = id;
    state.selectedTrajectoryRecordId = linked.length === 1 ? linked[0][0] : null;
    selectedEvidenceIndexes = [...new Set(node.evidence.map(({ envelopeIndex }) => envelopeIndex))].sort((left, right) => left - right);
    renderCanonicalDetail(node);
    showDetail(focus);
    updateSelection();
    notifyNode(id);
    if (trigger || focus) revealDetail();
    return true;
  }
  function closeStep() {
    if (state.disposed) return;
    if (revealFrame !== undefined) dom.defaultView?.cancelAnimationFrame?.(revealFrame);
    revealFrame = undefined;
    detailPanel.hidden = true;
    detailPanel.open = false;
    layout.dataset.detailOpen = "false";
    const origin = detailReturnSelection?.kind === "trajectory" && rowControls.get(detailReturnSelection.id);
    const fallback = rowControls.get(state.selectedTrajectoryRecordId);
    const target = origin || (detailReturnFocus?.isConnected ? detailReturnFocus : fallback);
    target?.scrollIntoView?.({ block: "nearest" });
    target?.focus?.({ preventScroll: true });
  }
  detailPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeStep(); }
  });

  function changeScope(id, ungroupedOnly = false, focus = false) {
    if (state.disposed || id !== null && id !== undefined && !groupById.has(id)) return false;
    state.selectedGroupId = id ?? null;
    state.ungroupedOnly = Boolean(ungroupedOnly);
    state.reading = buildScopeReading(model.document, explanation, { ...scopeOptions(), locale });
    const retained = state.selectedTrajectoryRecordId ? visibleRecords().some(({ id: recordId }) => recordId === state.selectedTrajectoryRecordId)
      : state.selectedStepId ? state.reading.nodeIds.includes(state.selectedStepId) : true;
    if (!retained) {
      state.selectedTrajectoryRecordId = null;
      state.selectedStepId = null;
      selectedNodeDetail = undefined;
      selectedEvidenceIndexes = [];
      detail.replaceChildren();
      delete detail.dataset.stepId;
      delete detail.dataset.trajectoryDetail;
      delete detail.dataset.executionState;
      detailPanel.hidden = true;
      detailPanel.open = false;
      layout.dataset.detailOpen = "false";
    }
    if (state.selectedEnvelopeIndex !== null && !state.reading.evidenceEnvelopeIndexes.includes(state.selectedEnvelopeIndex)) state.selectedEnvelopeIndex = null;
    renderReading();
    if (selectedNodeDetail?.trajectoryRecord && state.selectedTrajectoryRecordId) renderTrajectoryDetail(recordById.get(state.selectedTrajectoryRecordId));
    else if (state.selectedStepId) renderCanonicalDetail(inspection.getNode(state.selectedStepId));
    else if (state.selectedEnvelopeIndex !== null) appendSelectedEvidence();
    if (focus && !state.restoring) {
      main.scrollIntoView?.({ block: "start" });
      const current = !breadcrumbs.hidden && [...breadcrumbs.children].find((control) => control.getAttribute?.("aria-current") === "location");
      const fallback = main.querySelector?.(".trajectory-view") || main;
      (current || fallback)?.focus?.({ preventScroll: true });
    }
    return true;
  }
  function selectGroup(id) { return id === undefined ? false : changeScope(id, false); }
  function showGlobalResult(preferIssue = false) {
    if (state.reading.mode !== "all") changeScope(null);
    if (preferIssue) {
      const issues = disclosures.get("main:issues");
      if (issues) issues.open = true;
    }
    const summary = summaryHost.children[0];
    const target = preferIssue ? summary?.querySelector?.("[data-run-issue]") || summary
      : summary?.querySelector?.('[data-run-channel="output"]') || summary;
    if (target) { target.tabIndex = -1; target.focus?.({ preventScroll: true }); target.scrollIntoView?.({ block: "center" }); }
  }
  function appendSelectedEvidence() {
    activeRaw?.remove();
    activeRaw = undefined;
    if (state.selectedEnvelopeIndex === null) return;
    const index = state.selectedEnvelopeIndex;
    const original = element("section", "agent-selected-evidence");
    original.append(element("h3", "", `${t.evidence} · #${index + 1}`));
    const raw = element("pre", "structured-value", JSON.stringify(evidence[index], null, 2));
    raw.dataset.rawEnvelope = "";
    raw.dataset.envelopeIndex = String(index);
    raw.tabIndex = 0;
    values.set("evidence:raw", raw);
    original.append(raw);
    detail.append(original);
    activeRaw = original;
  }
  function selectEvidence(index, focus = false) {
    if (state.disposed || !inspection.getEvidence(index)) return false;
    if (!state.reading.evidenceEnvelopeIndexes.includes(index)) changeScope(null);
    state.selectedEnvelopeIndex = index;
    appendSelectedEvidence();
    showDetail(false);
    if (focus && !state.restoring) values.get("evidence:raw")?.focus?.();
    if (!state.restoring) options.onEvidenceClick?.({ envelopeIndex: index, envelope: evidence[index] });
    return true;
  }

  function selectionRanges() {
    const selection = dom.defaultView?.getSelection?.();
    return selection && !selection.isCollapsed ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : [];
  }
  main.addEventListener("pointerdown", (event) => {
    const card = event.target.closest?.(".agent-boundary-row");
    pointerStart = card ? { card, x: event.clientX, y: event.clientY,
      ranges: selectionRanges().map(({ startContainer, startOffset, endContainer, endOffset }) => ({ startContainer, startOffset, endContainer, endOffset })) } : null;
  });
  main.addEventListener("pointercancel", () => { pointerStart = null; });
  main.addEventListener("click", (event) => {
    if (state.disposed) return;
    const started = pointerStart;
    pointerStart = null;
    let control = event.target.closest?.("[data-trajectory-record]");
    if (!control) {
      const card = event.target.closest?.(".agent-boundary-row");
      if (!card || event.defaultPrevented || event.target.closest?.("button,a,input,textarea,select,summary,label,[role=button],[contenteditable]:not([contenteditable=false])")) return;
      const ranges = selectionRanges();
      if (ranges.some((range) => range.intersectsNode(card)) && (event.detail > 1 || !started || started.card !== card
        || Math.hypot(event.clientX - started.x, event.clientY - started.y) > 3 || ranges.length !== started.ranges.length
        || ranges.some((range, index) => ["startContainer", "startOffset", "endContainer", "endOffset"].some((key) => range[key] !== started.ranges[index][key])))) return;
      control = card.querySelector(":scope > [data-trajectory-record]");
    }
    if (!control) return;
    control.focus?.({ preventScroll: true });
    selectTrajectoryRecord(control.dataset.trajectoryRecord, false, control);
  });

  function scrollPosition(target) { return { top: target?.scrollTop || 0, left: target?.scrollLeft || 0 }; }
  function captureReading() {
    return {
      selectedStepId: state.selectedStepId, selectedTrajectoryRecordId: state.selectedTrajectoryRecordId,
      selectedEnvelopeIndex: state.selectedEnvelopeIndex, selectedGroupId: state.selectedGroupId, ungroupedOnly: state.ungroupedOnly,
      trajectoryDetail: Boolean(selectedNodeDetail?.trajectoryRecord), detailOpen: !detailPanel.hidden,
      detailReturnSelection: detailReturnSelection && { ...detailReturnSelection },
      disclosures: [...disclosures].map(([key, control]) => [key, control.open === true]),
      scroll: [root, main, detailPanel].map(scrollPosition), valueScroll: [...values].map(([key, node]) => [key, scrollPosition(node)]),
      viewport: { left: dom.defaultView?.scrollX || 0, top: dom.defaultView?.scrollY || 0 },
    };
  }
  function restore(saved) {
    if (!saved || state.disposed) return;
    state.restoring = true;
    try {
      state.selectedStepId = state.selectedTrajectoryRecordId = state.selectedEnvelopeIndex = null;
      selectedNodeDetail = undefined;
      selectedEvidenceIndexes = [];
      detail.replaceChildren();
      delete detail.dataset.stepId;
      delete detail.dataset.trajectoryDetail;
      delete detail.dataset.executionState;
      changeScope(saved.selectedGroupId ?? null, saved.ungroupedOnly);
      if (saved.trajectoryDetail && saved.selectedTrajectoryRecordId) selectTrajectoryRecord(saved.selectedTrajectoryRecordId);
      else if (saved.selectedStepId) selectStep(saved.selectedStepId);
      if (saved.selectedEnvelopeIndex !== null && saved.selectedEnvelopeIndex !== undefined) selectEvidence(saved.selectedEnvelopeIndex);
      detailReturnSelection = saved.detailReturnSelection && { ...saved.detailReturnSelection };
      for (const [key, open] of saved.disclosures || []) {
        const control = disclosures.get(key);
        if (control) control.open = open;
      }
      detailPanel.hidden = !saved.detailOpen;
      detailPanel.open = Boolean(saved.detailOpen);
      layout.dataset.detailOpen = String(Boolean(saved.detailOpen));
      restoredScroll = saved;
    } finally { state.restoring = false; }
  }
  function activate() {
    if (state.disposed || !restoredScroll) return;
    const restoreScroll = () => {
      restoreFrame = undefined;
      if (state.disposed || !restoredScroll) return;
      const saved = restoredScroll;
      restoredScroll = undefined;
      [root, main, detailPanel].forEach((target, index) => {
        target.scrollTop = saved.scroll?.[index]?.top || 0;
        target.scrollLeft = saved.scroll?.[index]?.left || 0;
      });
      for (const [key, position] of saved.valueScroll || []) {
        const node = values.get(key);
        if (node) { node.scrollTop = position.top; node.scrollLeft = position.left; }
      }
      dom.defaultView?.scrollTo?.(saved.viewport?.left || 0, saved.viewport?.top || 0);
    };
    if (dom.defaultView?.requestAnimationFrame) restoreFrame = dom.defaultView.requestAnimationFrame(restoreScroll); else restoreScroll();
  }
  function inspect() {
    return { selectedNodeDetail, scopeReading: state.reading, ungroupedOnly: state.ungroupedOnly,
      selectedTrajectoryRecordId: state.selectedTrajectoryRecordId,
      linkedSelection: { evidenceIndexes: [...selectedEvidenceIndexes], executionNodeId: state.selectedStepId || undefined,
        trajectoryRecordId: state.selectedTrajectoryRecordId || undefined,
        rawEnvelopeIndex: state.selectedEnvelopeIndex ?? undefined } };
  }

  renderReading();
  // Initial selection is reading state, not a synthetic user click.
  state.restoring = true;
  if (visibleRecords().length) selectTrajectoryRecord(visibleRecords()[0].id);
  state.restoring = false;

  return { root, state, selectStep, selectEvidence, selectGroup, selectTrajectoryRecord, closeStep, inspect,
    capture: captureReading, restore, activate,
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      if (restoreFrame !== undefined) dom.defaultView?.cancelAnimationFrame?.(restoreFrame);
      if (revealFrame !== undefined) dom.defaultView?.cancelAnimationFrame?.(revealFrame);
      valueFolds.dispose();
      foldObservers.clear(); disclosures.clear(); values.clear(); rowControls.clear(); pointerStart = null; restoredScroll = undefined;
      root.remove();
    } };
}
