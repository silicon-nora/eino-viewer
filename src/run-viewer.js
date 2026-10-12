import { createEinoViewer, EinoViewerError, projectEinoViewerDocument } from "./viewer.js";
import { explainEino, explainExecutionDAG, explainWorkflowSnapshot } from "./explanation.js";
import { createRunInspectionIndex } from "./inspection.js";
import { findJSONValueIssues } from "./json-value.js";
import { buildScopeReading } from "./scope-reading.js";
import { channelReadingValue, compactRecordedValue, isRecordedErrorItem, previewRecordedText, recordedIssueValue } from "./content-presentation.js";
import { createWorkflowDAG } from "eino-workflow-dag";
import { executionDAGToWorkflowSnapshot } from "./execution-dag.js";
import { buildRepeatedInvocationLabels, buildStepIdentityLabels, workflowAccessibilityLabel, workflowNodeLabel, workflowPresentationSnapshot } from "./renderer-presentation.js";
import { readingStyles } from "./run-viewer-styles.js";
import { registerRunViewerState } from "./run-viewer-state.js";
import { selectViewerGraphPath, captureViewerViewport, restoreViewerViewport, revealViewerSelection } from "./viewer-state.js";
import { buildReadingStepPresentation, buildWorkflowReadingOrder, readingTerms } from "./reading-presentation.js";
import { createRenderedValueFoldObserver } from "./rendered-value-fold.js";
import { buildExecutionTrajectory } from "./trajectory.js";
import { buildTrajectoryReading } from "./trajectory-reading.js";
import { buildAgentRunView } from "./agent-run-viewer.js";
import { createRunViewerV2 } from "./run-viewer-v2.js";
import { createVersionedViewer } from "./versioned-viewer.js";

// All styles are instance-scoped; mounting the component does not alter the host page.
const stylesheet = `
.eino-run-viewer{--erv-ink:#172536;--erv-muted:#526275;--erv-line:#cfd9e2;--erv-paper:#fff;--erv-ice:#eef4f7;--erv-blue:#2758c7;color:var(--erv-ink);background:var(--erv-paper);border:1px solid var(--erv-line);border-radius:12px;font:14px/1.55 "Avenir Next","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;overflow:hidden;min-width:0;container-type:inline-size}
.eino-run-viewer *{box-sizing:border-box}.eino-run-viewer [hidden]{display:none!important}
.eino-run-viewer h2,.eino-run-viewer h3,.eino-run-viewer p{margin:0}.eino-run-viewer h2{font:700 25px/1.2 "Avenir Next Condensed","DIN Alternate","Arial Narrow",sans-serif;overflow-wrap:anywhere}.eino-run-viewer h3{font-size:14px}
.eino-run-viewer button,.eino-run-viewer input,.eino-run-viewer select{font:inherit}.eino-run-viewer button{border:1px solid var(--erv-line);border-radius:6px;padding:6px 10px;background:var(--erv-paper);color:var(--erv-ink);cursor:pointer;text-align:left;overflow-wrap:anywhere}.eino-run-viewer button:hover{background:var(--erv-ice)}.eino-run-viewer button:disabled{opacity:.5;cursor:default}
.eino-run-viewer :is(button,input,select,summary,pre,.erv-prose):focus-visible{outline:3px solid #2758c770;outline-offset:2px}.eino-run-viewer input,.eino-run-viewer select{max-width:100%;padding:7px 9px;color:var(--erv-ink);background:#fff;border:1px solid var(--erv-line);border-radius:6px}.eino-run-viewer input[type=search]{width:100%;min-width:0}
.eino-run-viewer summary{cursor:pointer;font-weight:650;overflow-wrap:anywhere}.eino-run-viewer pre{margin:6px 0 0;padding:12px;background:var(--erv-ice);border:1px solid var(--erv-line);border-radius:6px;font:12px/1.6 "SFMono-Regular","Cascadia Code",ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:380px;overflow:auto;min-width:0}
.eino-run-viewer .erv-header{display:block;margin:0;padding:16px 24px 14px;border-bottom:1px solid var(--erv-line);border-top:4px solid var(--erv-blue)}.eino-run-viewer .erv-title-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.eino-run-viewer .erv-eyebrow{font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.08em;color:var(--erv-muted);overflow-wrap:anywhere}.eino-run-viewer .erv-statuses,.eino-run-viewer .erv-actions,.eino-run-viewer .erv-pagination{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.eino-run-viewer .erv-run-meta{display:flex;align-items:baseline;gap:8px 16px;flex-wrap:wrap;margin-top:8px}.eino-run-viewer .erv-timing{display:flex;align-items:baseline;gap:6px 14px;flex-wrap:wrap}.eino-run-viewer .erv-run-identity{font-size:12px;min-width:0;max-width:100%}.eino-run-viewer .erv-run-identity summary{color:var(--erv-muted)}.eino-run-viewer .erv-badge{display:inline-block;background:var(--erv-ice);padding:3px 8px;border-radius:4px;font-size:12px;font-weight:650}.eino-run-viewer [data-run-result=success]{color:#13634c;background:#e6f4ee}.eino-run-viewer [data-run-result=failed]{color:#983d38;background:#fbeeed}.eino-run-viewer [data-run-capture=partial]{color:#835018;background:#fff3dc}
.eino-run-viewer .erv-muted{color:var(--erv-muted);font-size:12px;overflow-wrap:anywhere}.eino-run-viewer .erv-summary{padding:20px 24px;border-bottom:1px solid var(--erv-line)}.eino-run-viewer .erv-channels{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:24px}.eino-run-viewer .erv-channel{min-width:0}.eino-run-viewer .erv-summary>.erv-channels>[data-run-channel=output]{border-left:3px solid var(--erv-blue);padding-left:14px}.eino-run-viewer .erv-summary>.erv-channels>[data-run-channel=input]{padding-left:20px;border-left:1px solid var(--erv-line)}.eino-run-viewer .erv-value{margin-top:10px}.eino-run-viewer .erv-value-label{font-size:12px;color:var(--erv-muted);overflow-wrap:anywhere}.eino-run-viewer .erv-value-preview{max-height:105px}.eino-run-viewer .erv-evidence-link{font:11px/1.4 ui-monospace,monospace;padding:3px 6px}.eino-run-viewer .erv-issues{border-left:3px solid #c77a23;padding:10px 14px;margin-top:16px;background:#fff8eb}.eino-run-viewer .erv-summary>.erv-issues:first-child{margin:0 0 16px}.eino-run-viewer .erv-issues p+p{margin-top:8px}.eino-run-viewer .erv-issues p{white-space:pre-wrap;overflow-wrap:anywhere}.eino-run-viewer .erv-limits{margin-top:12px}.eino-run-viewer .erv-limits ul{margin:8px 0;padding-left:20px;overflow-wrap:anywhere}
.eino-run-viewer .erv-body{display:grid;grid-template-columns:minmax(220px,32%) minmax(0,1fr)}.eino-run-viewer .erv-body[data-detail-open=false]{grid-template-columns:1fr}.eino-run-viewer .erv-steps{padding:20px;min-width:0}.eino-run-viewer .erv-detail-panel{min-width:0;border-left:1px solid var(--erv-line)}.eino-run-viewer .erv-detail-panel>summary{padding:14px 24px;background:var(--erv-ice)}.eino-run-viewer .erv-body[data-detail-open=false]>.erv-detail-panel{border-left:0;border-top:1px solid var(--erv-line)}.eino-run-viewer .erv-detail{padding:20px 24px;min-width:0}.eino-run-viewer .erv-list{display:grid;gap:6px;margin-top:12px;max-height:570px;overflow:auto;padding:3px}.eino-run-viewer .erv-body[data-detail-open=false] .erv-list{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));max-height:330px}.eino-run-viewer .erv-step{display:grid;gap:2px;width:100%;border-left:3px solid transparent}.eino-run-viewer .erv-step[aria-pressed=true]{border-left-color:var(--erv-blue);background:#eaf0ff}.eino-run-viewer .erv-step small{color:var(--erv-muted);font-size:11px}.eino-run-viewer .erv-search-label{display:grid;gap:6px;font-size:12px;margin-top:10px}.eino-run-viewer .erv-detail .erv-channels{margin-top:16px;grid-template-columns:1fr}.eino-run-viewer .erv-pagination{justify-content:space-between;font-size:12px}.eino-run-viewer .erv-empty{padding:16px 0;color:var(--erv-muted)}
.eino-run-viewer .erv-filter-label{display:flex;gap:6px;align-items:center;font-size:12px;margin-top:10px}.eino-run-viewer .erv-filter-label input{margin:0;width:auto}
.eino-run-viewer .erv-prose{margin-top:10px;font:15px/1.8 "Avenir Next","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;max-height:480px;overflow:auto;min-width:0}.eino-run-viewer .erv-prose.erv-value-preview{max-height:105px}.eino-run-viewer .erv-value-actions{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:10px}.eino-run-viewer .erv-sources{font-size:12px;min-width:0}.eino-run-viewer .erv-sources>summary{color:var(--erv-muted);font-weight:500}.eino-run-viewer .erv-sources>.erv-actions{margin-top:6px}.eino-run-viewer .erv-value-actions>.erv-sources>.erv-actions{max-width:360px}.eino-run-viewer .erv-feedback:empty{display:none}.eino-run-viewer .erv-empty-state{margin-top:10px;color:var(--erv-muted)}
.eino-run-viewer .erv-local-result{margin-top:16px;padding:16px 18px;background:var(--erv-paper);border:1px solid var(--erv-line);border-left:3px solid var(--erv-blue);border-radius:6px;min-width:0}.eino-run-viewer .erv-local-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}.eino-run-viewer .erv-local-result .erv-channels{margin-top:14px}.eino-run-viewer .erv-local-result>.erv-issues{margin:12px 0}.eino-run-viewer .erv-boundary-note{margin-top:10px}.eino-run-viewer .erv-diagram-summary{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}.eino-run-viewer .erv-diagram-summary span{font-weight:400}.eino-run-viewer .erv-graph[data-empty=true]{height:auto;min-height:64px}
.eino-run-viewer .erv-context{padding:16px 24px;border-bottom:1px solid var(--erv-line);background:var(--erv-ice);min-width:0}.eino-run-viewer .erv-breadcrumbs{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px}.eino-run-viewer .erv-breadcrumbs button{font-size:12px}.eino-run-viewer .erv-breadcrumbs [aria-current=location],.eino-run-viewer [data-group-select][aria-pressed=true]{border-color:var(--erv-blue);background:#eaf0ff}.eino-run-viewer .erv-groups{margin-top:12px;max-height:370px;overflow:auto;padding:3px}.eino-run-viewer .erv-group-row{margin:6px 0;min-width:0}.eino-run-viewer .erv-group-row>button{display:grid;width:100%;gap:2px}.eino-run-viewer .erv-group-children{margin:6px 0 8px 12px;border-left:2px solid var(--erv-line);padding-left:12px}.eino-run-viewer .erv-group-children>summary{font-size:12px;color:var(--erv-muted)}.eino-run-viewer .erv-scope-note{margin-top:8px}.eino-run-viewer .erv-step-path{margin-bottom:10px;font:11px/1.5 ui-monospace,monospace;color:var(--erv-muted);overflow-wrap:anywhere}
.eino-run-viewer .erv-raw{padding:18px 24px;border-top:1px solid var(--erv-line)}.eino-run-viewer .erv-evidence-controls{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:10px}.eino-run-viewer .erv-evidence-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;max-height:190px;overflow:auto;padding:3px}.eino-run-viewer .erv-evidence-list [aria-pressed=true]{border-color:var(--erv-blue);background:#eaf0ff}.eino-run-viewer .erv-diagram{padding:16px 24px;border-top:1px solid var(--erv-line)}.eino-run-viewer .erv-graph{height:420px;position:relative;overflow:hidden;margin-top:12px}.eino-run-viewer .erv-graph .cy-overlays{position:absolute;inset:0;pointer-events:none}.eino-run-viewer .erv-graph .cy-node-tip{position:absolute;max-width:320px;max-height:220px;overflow:auto;white-space:pre-wrap;pointer-events:auto;padding:10px;background:white;border:1px solid var(--erv-line);z-index:6}.eino-run-viewer .erv-graph .cy-zoom{position:absolute;right:12px;top:12px;display:grid;z-index:5}.eino-run-viewer .erv-graph .cy-zoom button{width:36px;height:36px;text-align:center}.eino-run-viewer .erv-graph .cy-subgraph-title{position:absolute;pointer-events:auto;z-index:3}.eino-run-viewer .erv-notice{padding:8px 24px;min-height:32px;border-top:1px solid var(--erv-line);color:var(--erv-muted);font-size:12px;overflow-wrap:anywhere}
@container (max-width:650px){.eino-run-viewer .erv-body,.eino-run-viewer .erv-channels{grid-template-columns:1fr}.eino-run-viewer .erv-summary>.erv-channels>[data-run-channel=input]{padding:14px 0 0;border-left:0;border-top:1px solid var(--erv-line)}.eino-run-viewer .erv-detail-panel{border-left:0;border-top:1px solid var(--erv-line)}.eino-run-viewer .erv-list,.eino-run-viewer .erv-body[data-detail-open=false] .erv-list{grid-template-columns:1fr;max-height:260px}.eino-run-viewer .erv-header,.eino-run-viewer .erv-summary,.eino-run-viewer .erv-detail,.eino-run-viewer .erv-raw,.eino-run-viewer .erv-diagram,.eino-run-viewer .erv-context{padding:16px}.eino-run-viewer .erv-evidence-controls{grid-template-columns:1fr}}
`;

const words = {
  en: {
    trajectory: "Trajectory", trajectoryRecords: "records", trajectoryTurn: "Turn", trajectoryBeforeTurn: "Before model turn", trajectoryEmpty: "No trajectory entries recorded in this scope",
    clear: "Clear", close: "Close", drawGraph: "Draw path", largeGraph: "Large path", stepIdentity: "Identity", fullName: "Full name",
    scopeUnconfirmed: "Recorded · invocation unconfirmed",
    title: "Saved result", identity: "Run details", runId: "Run ID", recordTitle: "Record title", stepDetails: "Step details", failure: "Failure / interruption", executionError: "Execution error", input: "Input", output: "Final output", stepOutput: "Step output", steps: "Steps", declared: "Declared nodes",
    choose: "Select a step", stepSearch: "Find a step", searchHint: "Name, ID or status", issuesOnly: "Errors / interruptions",
    evidence: "Original evidence", evidenceSearch: "Find evidence", all: "All evidence", run: "Run", step: "Step", unassigned: "Unassigned",
    previous: "Previous", next: "Next", noMatches: "No matching records", raw: "Complete original record", diagram: "Execution path", declaredDiagram: "Declared structure", copied: "Copied", copy: "Copy", copyUnavailable: "Unable to copy. Select the value to copy it.", sources: "Sources",
    expand: "Show full value", textValue: "Text", unknown: "Not recorded", redacted: "Redacted", truncated: "Truncated at source", timing: "Duration", noTiming: "Duration not recorded", timingEvidence: "Timing sources", boundaries: "Start / end", started: "Start", finished: "End", limits: "Technical details", recovered: "Recovered", noEvidence: "No source recorded", capturePartial: "Partial record", captureUnknown: "Completeness unknown",
    reason: { size_limit: "Size limit exceeded", unsupported_value: "Unsupported value", not_captured: "Not captured" },
    status: { success: "Succeeded", failed: "Failed", cancelled: "Cancelled", incomplete: "Result not recorded", running: "End not recorded", declared: "Declared", observed: "Observed", unknown: "Unknown" },
    state: { planned: "Planned · execution not observed", interrupted: "Interrupted", unrecorded: "Result not recorded" },
    hierarchy: { agent: "Agent calls", graph: "Graph scopes", workflow: "Workflow levels" }, allSteps: "All steps", ungrouped: "Unconfirmed scope", childScopes: "Child scopes", scope: "Reading scope", declaredScope: "Declared", total: "total", directSteps: "steps", scopeEvidence: "Sources in scope", scopeIdentity: "Scope ID",
    localFailure: "Local failure · overall run succeeded",
    callerRecovered: "Handled by caller", callerError: "Caller error", callerStep: "View caller step",
    localResult: "Local call result", localInput: "Call input", localOutput: "Call output", globalResult: "Final run result", unassignedResult: "Unconfirmed scope", boundaryEdges: "Cross-scope connections", incoming: "incoming", outgoing: "outgoing", emptyScope: "No recorded nodes in this scope", localDiagram: "Call path", ambiguousBoundary: "Conflicting call boundaries",
  },
  zh: {
    trajectory: "轨迹", trajectoryRecords: "条记录", trajectoryTurn: "回合", trajectoryBeforeTurn: "模型回合之前", trajectoryEmpty: "此范围无已记录轨迹",
    clear: "清除", close: "关闭", drawGraph: "绘制路径", largeGraph: "较长的路径", stepIdentity: "身份", fullName: "完整名称",
    scopeUnconfirmed: "已记录 · 调用归属未确认",
    title: "运行结果", identity: "运行信息", runId: "运行 ID", recordTitle: "记录标题", stepDetails: "步骤详情", failure: "失败 / 中断原因", executionError: "执行错误", input: "输入", output: "最终输出", stepOutput: "步骤输出", steps: "步骤", declared: "声明节点",
    choose: "选择步骤", stepSearch: "查找步骤", searchHint: "名称、ID 或状态", issuesOnly: "错误 / 中断",
    evidence: "原始证据", evidenceSearch: "查找证据", all: "全部证据", run: "运行", step: "步骤", unassigned: "未归属",
    previous: "上一页", next: "下一页", noMatches: "没有匹配记录", raw: "完整原始记录", diagram: "执行路径", declaredDiagram: "声明结构", copied: "已复制", copy: "复制", copyUnavailable: "无法复制，请选中原文后复制。", sources: "来源",
    expand: "展开全文", textValue: "文本", unknown: "未记录", redacted: "已脱敏", truncated: "源内容已截断", timing: "耗时", noTiming: "耗时未记录", timingEvidence: "耗时来源", boundaries: "起止时间", started: "开始", finished: "结束", limits: "技术详情", recovered: "已恢复", noEvidence: "未记录来源", capturePartial: "记录不完整", captureUnknown: "完整性未知",
    reason: { size_limit: "超出大小限制", unsupported_value: "类型不支持", not_captured: "未采集" },
    status: { success: "成功", failed: "失败", cancelled: "已取消", incomplete: "结果未记录", running: "结束未记录", declared: "声明", observed: "已观察到", unknown: "未知" },
    state: { planned: "仅计划 · 未观察到执行", interrupted: "已中断", unrecorded: "结果未记录" },
    hierarchy: { agent: "Agent 调用层级", graph: "Graph 作用域", workflow: "Workflow 层级" }, allSteps: "全部步骤", ungrouped: "归属未确认", childScopes: "子调用", scope: "阅读范围", declaredScope: "仅声明", total: "总计", directSteps: "步骤", scopeEvidence: "范围内来源", scopeIdentity: "范围 ID",
    localFailure: "局部失败，整体成功",
    callerRecovered: "调用方已处理", callerError: "调用方错误", callerStep: "查看调用方步骤",
    localResult: "局部调用结果", localInput: "调用输入", localOutput: "调用输出", globalResult: "整次结果", unassignedResult: "归属未确认", boundaryEdges: "跨范围连接", incoming: "进入", outgoing: "离开", emptyScope: "此范围无已记录节点", localDiagram: "调用路径", ambiguousBoundary: "调用边界冲突",
  },
};

function invalid(code, message, diagnostics = [{ code, path: "root", message, severity: "error" }]) {
  return new EinoViewerError(code, message, diagnostics);
}

function formatValue(value) {
  return typeof value === "string" ? (value === "" ? '""' : value) : JSON.stringify(value, null, 2);
}

function prepare(input, locale) {
  // Validate descriptors before copying: never invoke getters or application serializers.
  const jsonIssues = findJSONValueIssues(input);
  if (jsonIssues.length) throw invalid("viewer.invalid_input", "Expected plain JSON data.", jsonIssues);
  const originalJSON = JSON.stringify(input);
  const ownedInput = JSON.parse(originalJSON);
  const projected = projectEinoViewerDocument(ownedInput);
  if (!projected.ok) throw invalid(projected.diagnostics[0]?.code || "viewer.invalid_input", "Invalid saved Eino record.", projected.diagnostics);
  // Projectors may freeze their inputs. Only our copy is ever passed to them.
  const document = projected.document;
  const diagnostics = [...projected.diagnostics, ...(Array.isArray(ownedInput?.diagnostics) ? ownedInput.diagnostics : [])];
  const options = { locale, diagnostics, envelopes: document.evidence };
  const explained = document.execution
    ? explainExecutionDAG(document.execution, document.evidence, options)
    : document.kind === "workflow" ? explainWorkflowSnapshot(document.definition, options) : explainEino(document.evidence, options);
  if (!explained.ok) throw invalid(explained.diagnostics[0]?.code || "viewer.invalid_explanation", "Cannot explain this saved Eino record.", explained.diagnostics);
  const order = buildWorkflowReadingOrder(explained.explanation, { kind: document.kind });
  const readingExplanation = { ...explained.explanation, nodes: [...explained.explanation.nodes]
    .sort((left, right) => order.get(left.id) - order.get(right.id)) };
  const trajectoryResult = document.kind === "agent" ? buildExecutionTrajectory(document.evidence, { runId: document.execution.runId }) : undefined;
  const trajectory = trajectoryResult?.ok ? trajectoryResult.trajectory : undefined;
  return { document, explanation: explained.explanation, diagnostics, originalJSON,
    trajectory, trajectoryReading: document.kind === "agent" ? buildTrajectoryReading(trajectory, document.execution, document.evidence, explained.explanation.groups) : undefined,
    invocationLabels: buildRepeatedInvocationLabels(document.execution, document.evidence, locale),
    identityLabels: buildStepIdentityLabels(document.execution, document.evidence),
    inspection: createRunInspectionIndex(readingExplanation, document.evidence) };
}

/** A read-only, self-contained result inspector for one saved Eino run. No execution or live subscription. */
export function createEinoRunViewer(container, input, options = {}) {
  return createVersionedViewer(container, input, options, createLegacyEinoRunViewer, createRunViewerV2, EinoViewerError, true);
}

function createLegacyEinoRunViewer(container, input, options = {}) {
  if (!container || container.nodeType !== 1 || typeof container.replaceChildren !== "function" || !container.ownerDocument) {
    throw invalid("viewer.invalid_container", "Expected an Element container.");
  }
  if (options.locale !== undefined && !["zh", "en"].includes(options.locale)) throw invalid("viewer.invalid_locale", "Expected locale en or zh.");
  let locale = options.locale || "en";
  const pageSize = Number.isInteger(options.pageSize) ? Math.min(200, Math.max(1, options.pageSize)) : 30;
  const dom = container.ownerDocument;
  let current;
  let mounted;
  let destroyed = false;
  let unregisterState;

  function element(tag, className, text) {
    const value = dom.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function button(text, action, className = "") {
    const value = element("button", className, text);
    value.type = "button";
    value.addEventListener("click", action);
    return value;
  }
  function assertActive() {
    if (destroyed) throw invalid("viewer.destroyed", "Cannot update a destroyed Eino run viewer.");
  }

  function build(model) {
    if (model.document.kind === "agent") return buildAgentRunView({ model, dom, locale, options, pageSize });
    const terms = readingTerms(locale);
    const t = { ...words[locale], title: terms.runResult, output: terms.finalResult,
      stepOutput: terms.stepOutput, localResult: terms.callResult, localInput: terms.callInput,
      localOutput: terms.callOutput, timing: terms.duration, raw: terms.rawRecord,
      hierarchy: { ...words[locale].hierarchy, graph: terms.graphCalls, workflow: terms.workflowHierarchy } };
    const root = element("section", "eino-run-viewer");
    root.dataset.einoRunViewer = model.document.kind;
    root.setAttribute("aria-label", t.title);
    root.lang = locale;
    // Keep mixed Agent/Graph embeds independent without changing Graph selector specificity.
    const scopedStyles = `${stylesheet}\n${readingStyles}`.replaceAll(".eino-run-viewer", ".eino-run-viewer:where(:not(.eino-agent-reader))");
    root.append(element("style", "", scopedStyles));
    const state = { selectedStepId: null, selectedEnvelopeIndex: null, selectedGroupId: null, ungroupedOnly: false, graph: undefined, disposed: false, restoring: false, graphRequested: false };
    const valueFolds = createRenderedValueFoldObserver(root);
    const disclosures = new Map();
    const valueScroll = new Map();
    const valueScrollCounts = new Map();
    const disclosureCounts = new Map();
    let disclosureRegion = "run";
    function rememberDisclosure(control, key) {
      const base = `${disclosureRegion}:${key}`;
      const count = disclosureCounts.get(base) || 0;
      disclosureCounts.set(base, count + 1);
      disclosures.set(`${base}:${count}`, control);
      return control;
    }
    function resetDisclosures(region) {
      for (const key of disclosures.keys()) if (key.startsWith(`${region}:`)) disclosures.delete(key);
      for (const key of disclosureCounts.keys()) if (key.startsWith(`${region}:`)) disclosureCounts.delete(key);
      for (const key of valueScroll.keys()) if (key.startsWith(`${region}:`)) valueScroll.delete(key);
      for (const key of valueScrollCounts.keys()) if (key.startsWith(`${region}:`)) valueScrollCounts.delete(key);
      disclosureRegion = region;
    }
    let detailReturnFocus;
    let detailReturnSelection;
    function rememberDetailTrigger(trigger) {
      const source = trigger || dom.activeElement;
      if (state.restoring || !source || !trigger && detailPanel.contains?.(source)) return;
      // Pointer activation does not focus buttons in every browser. Internal
      // controls pass their actual origin; external API calls retain the focus
      // fallback without exposing DOM arguments through the public API.
      detailReturnFocus = source;
      const { stepId } = detailReturnFocus.dataset || {};
      detailReturnSelection = stepId ? { kind: "step", id: stepId } : undefined;
    }
    function referenceButtons(indexes) {
      const references = [...new Set(indexes || [])];
      const details = element("details", "erv-sources");
      rememberDisclosure(details, `sources:${references.join(",")}`);
      details.dataset.evidenceSources = "";
      details.hidden = references.length === 0;
      details.append(element("summary", "", `${t.sources} · ${references.length}`));
      const actions = element("div", "erv-actions");
      for (const index of references) {
        const control = button(`#${index + 1}`, () => selectEvidence(index, true), "erv-evidence-link");
        control.dataset.envelopeIndex = String(index);
        control.setAttribute("aria-label", `${t.evidence} ${index + 1}`);
        actions.append(control);
      }
      details.append(actions);
      return details;
    }

    function valueItem(item, showLabel = false, { foldLong = true } = {}) {
      const box = element("div", "erv-value");
      box.dataset.availability = item.availability || (Object.hasOwn(item, "value") ? item.value === null ? "null" : item.value === "" ? "empty" : "available" : "not-observed");
      if (showLabel && item.label) box.append(element("p", "erv-value-label", item.label));
      if (["redacted", "truncated"].includes(box.dataset.availability)) box.append(element("p", "erv-badge", t[box.dataset.availability]));
      if (Object.hasOwn(item, "value")) {
        const value = formatValue(item.value);
        const prose = typeof item.value === "string" && item.value !== "";
        const type = item.value === null ? "null" : Array.isArray(item.value) ? "array" : typeof item.value;
        box.dataset.valueType = type;
        if (type === "string" && (/^(null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(item.value.trim()) || !item.value.trim())) {
          box.append(element("span", "erv-value-label", t.textValue));
        }
        const full = element(prose ? "div" : "pre", prose ? "erv-prose" : "", value);
        full.dataset.runValue = "";
        full.dataset.valueFormat = prose ? "text" : "json";
        full.dataset.valueType = type;
        full.dataset.availability = box.dataset.availability;
        full.tabIndex = 0;
        const valueBase = `${disclosureRegion}:body:${(item.evidenceEnvelopeIndexes || []).join(",")}`;
        const valueIndex = valueScrollCounts.get(valueBase) || 0;
        valueScrollCounts.set(valueBase, valueIndex + 1);
        const valueKey = `${valueBase}:${valueIndex}`;
        valueScroll.set(valueKey, full);
        if (foldLong) {
          const preview = element(prose ? "div" : "pre");
          preview.hidden = true;
          const previewFrame = prose ? preview : element("div", "erv-preview-frame");
          if (!prose) {
            previewFrame.hidden = true;
            previewFrame.append(preview);
          }
          const expanded = element("details");
          // Reserve disclosure identity before layout measurement. Translations
          // restore this same control even if a short body only wraps narrowly.
          rememberDisclosure(expanded, `value:${(item.evidenceEnvelopeIndexes || []).join(",")}`);
          expanded.hidden = true;
          expanded.append(element("summary", "", t.expand));
          box.append(previewFrame, expanded, full);
          const fold = () => {
            preview.className = `${prose ? "erv-prose " : ""}erv-value-preview`;
            preview.textContent = previewRecordedText(value, 321);
            preview.hidden = false;
            previewFrame.hidden = false;
            expanded.hidden = false;
            expanded.dataset.runExpand = "";
            full.remove();
            expanded.append(full);
          };
          if (value.length > 320 || value.split("\n").length > 6) fold();
          else valueFolds.observe(full, fold);
        } else box.append(full);
        const feedback = element("span", "erv-feedback erv-muted");
        feedback.setAttribute("role", "status");
        const copy = button(t.copy, async () => {
          try {
            const clipboard = dom.defaultView?.navigator.clipboard;
            if (!clipboard) throw new Error("Clipboard unavailable");
            await clipboard.writeText(typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2));
            if (!state.disposed) feedback.textContent = t.copied;
          } catch { if (!state.disposed) feedback.textContent = t.copyUnavailable; }
        });
        copy.dataset.copyValue = "";
        const actions = element("div", "erv-value-actions");
        actions.append(copy, referenceButtons(item.evidenceEnvelopeIndexes), feedback);
        box.append(actions);
      } else {
        const missing = element("p", "erv-empty-state", item.reason ? `${t.unknown} · ${t.reason[item.reason] || item.reason}` : t.unknown);
        if (item.reason) missing.dataset.captureReason = item.reason;
        box.append(missing, referenceButtons(item.evidenceEnvelopeIndexes));
      }
      return box;
    }

    function channel(channelValue, label, direction) {
      const box = element("section", "erv-channel");
      box.dataset.runChannel = direction;
      box.dataset.availability = channelValue.availability;
      box.setAttribute("aria-label", label);
      box.append(element("h3", "", label));
      if (!channelValue.items.length) box.append(element("p", "erv-empty-state", t.unknown));
      for (const item of channelValue.items) box.append(valueItem(item, channelValue.items.length > 1));
      return box;
    }

    function stepReadingChannel(channelValue, direction) {
      const items = channelValue.items.map((item) => {
        const value = channelReadingValue(item, direction, (index) => model.document.evidence[index]);
        const { value: originalValue, ...facts } = item;
        const availability = ["redacted", "truncated", "not-observed"].includes(item.availability) ? item.availability
          : value === undefined ? "not-observed" : value === null ? "null" : value === "" ? "empty" : "available";
        return { ...facts, availability, ...(value !== undefined ? { value } : {}) };
      });
      return { ...channelValue, items, availability: items.some((item) => item.availability !== "not-observed") ? "available" : "not-observed" };
    }

    function timing(value) {
      const box = element("p", "erv-muted");
      box.dataset.runTiming = value?.semantics || "not-observed";
      box.dataset.availability = value?.availability || "not-observed";
      box.textContent = Number.isFinite(value?.durationMs) ? `${t.timing} · ${value.durationMs} ms` : t.noTiming;
      if (value?.summary) box.title = value.summary;
      const group = element("div", "erv-timing");
      group.append(box);
      const hasBoundaries = Number.isFinite(value?.startedAtMs) || Number.isFinite(value?.finishedAtMs);
      if (hasBoundaries || value?.evidenceEnvelopeIndexes?.length) {
        const boundaries = element("details");
        rememberDisclosure(boundaries, `timing:${(value?.evidenceEnvelopeIndexes || []).join(",")}`);
        boundaries.dataset.timingBoundaries = "";
        boundaries.append(element("summary", "erv-muted", hasBoundaries ? t.boundaries : t.timingEvidence));
        for (const [field, label] of hasBoundaries ? [["startedAtMs", t.started], ["finishedAtMs", t.finished]] : []) {
          const time = value[field];
          const date = new Date(time);
          const text = Number.isFinite(time) && Number.isFinite(date.getTime()) ? date.toISOString() : t.unknown;
          const line = element("p", "erv-muted", `${label} · ${text}`);
          line.dataset.timingBoundary = field;
          boundaries.append(line);
        }
        if (value?.evidenceEnvelopeIndexes?.length) boundaries.append(referenceButtons(value.evidenceEnvelopeIndexes));
        group.append(boundaries);
      }
      return group;
    }

    function limitations(entries) {
      const unique = [...new Set(entries.filter(Boolean))];
      if (!unique.length) return undefined;
      const details = element("details", "erv-limits");
      rememberDisclosure(details, "limits");
      details.append(element("summary", "", `${t.limits} · ${unique.length}`));
      const list = element("ul");
      for (const message of unique) list.append(element("li", "", message));
      details.append(list);
      return details;
    }

    const { explanation } = model;
    const readingRoles = new Map(explanation.nodes.map((node) => [node.id, new Set(["en", "zh"]
      .map((locale) => buildReadingStepPresentation(node, { locale, envelopes: model.document.evidence }).role)
      .filter(Boolean).map((role) => role.toLocaleLowerCase().replace(/\s+/gu, " ")))]));
    const roleNames = [...new Set([...readingRoles.values()].flatMap((roles) => [...roles]))];
    const readingOrder = buildWorkflowReadingOrder(explanation, { kind: model.document.kind });
    function searchReadingSteps(query = "", queryOptions = {}) {
      let remaining = String(query), requested = [];
      for (const role of roleNames) {
        const phrase = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
        // A role is a complete phrase, not separate tokens collected from IDs.
        // In particular, never consume the call in the existing Call N syntax.
        const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_]|\\s*\\d)`, "giu");
        let found = false;
        remaining = remaining.replace(pattern, (_match, prefix) => { found = true; return prefix; });
        if (found) requested.push(role);
      }
      if (!requested.length) return model.inspection.searchSteps(query, queryOptions);
      const collect = (text, accept = () => true) => {
        const matches = [];
        for (let offset = 0; offset < model.inspection.nodeCount; offset += 200) {
          const page = model.inspection.searchSteps(text, { ...queryOptions, offset, limit: 200 });
          matches.push(...page.items.filter(accept));
          if (page.offset + page.items.length >= page.total) break;
        }
        return matches;
      };
      const matches = new Map(collect(query).map((node) => [node.id, node]));
      for (const node of collect(remaining.trim(), (node) => requested.every((role) => readingRoles.get(node.id)?.has(role)))) matches.set(node.id, node);
      const items = [...matches.values()].sort((left, right) => readingOrder.get(left.id) - readingOrder.get(right.id));
      const limit = Number.isSafeInteger(queryOptions.limit) ? Math.min(200, Math.max(1, queryOptions.limit)) : 50;
      const requestedOffset = Number.isSafeInteger(queryOptions.offset) ? Math.max(0, queryOptions.offset) : 0;
      const offset = items.length ? Math.min(requestedOffset, Math.floor((items.length - 1) / limit) * limit) : 0;
      return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
    }
    const definitionByStep = new Map();
    if (!model.document.execution) {
      const byPath = new Map(explanation.nodes.map((node) => [
        JSON.stringify(model.document.kind === "graph" ? node.technical.metadata.sourceNodePath : node.path), node.id,
      ]));
      function collectDefinition(graph, prefix = []) {
        for (const node of graph?.nodes || []) {
          const path = [...prefix, node.id];
          const id = byPath.get(JSON.stringify(path));
          if (id) definitionByStep.set(id, node);
          if (node.workflow) collectDefinition(node.workflow, path);
        }
      }
      collectDefinition(model.document.kind === "workflow" ? model.document.definition.workflow : model.document.definition);
    }
    const run = explanation.run;
    function issueValue(issue, prefix = issue.recovered ? t.recovered : run.result.state === "success" && issue.scope === "step" ? t.localFailure : "") {
      const value = element("div");
      if (prefix) value.append(element("p", "erv-badge", prefix));
      // Prefixes describe the outcome, not the recorded error. The same value
      // reader folds long errors and copies only their exact original text.
      value.append(valueItem(recordedIssueValue(issue, (index) => model.document.evidence[index], model.diagnostics)));
      return value;
    }
    function stepLabel(node) {
      return buildReadingStepPresentation(node, { locale, envelopes: model.document.evidence,
        invocationLabels: model.invocationLabels, identityLabels: model.identityLabels }).title;
    }
    function stepIdentity(node) {
      return model.identityLabels.get(node.id);
    }
    function appendIssueNavigation(target, issue, label = t.step) {
      if (issue.nodeId && model.inspection.getNode(issue.nodeId)) {
        const action = button(label, () => selectStep(issue.nodeId, true, action));
        action.dataset.issueStep = issue.nodeId;
        target.append(action);
      }
      // issueValue already exposes all exact source references. Without a
      // verified node ID those remain the only navigation; do not guess a step.
    }
    const header = element("header", "erv-header");
    const titleRow = element("div", "erv-title-row");
    const title = element("h2", "", `${model.document.kind === "workflow" ? "Workflow" : model.document.kind === "graph" ? "Graph" : "Agent"} · ${t.title}`);
    title.dataset.runTitle = "";
    title.tabIndex = -1;
    titleRow.append(title);
    header.append(titleRow);
    const statuses = element("div", "erv-statuses");
    const result = element("span", "erv-badge", run.result.label);
    result.dataset.runResult = run.result.state;
    const capture = element("span", "erv-badge", run.capture.status === "partial" ? t.capturePartial : run.capture.status === "unknown" ? t.captureUnknown : run.capture.label);
    capture.dataset.runCapture = run.capture.status;
    statuses.append(result);
    if (run.capture.status !== "complete") statuses.append(capture);
    const identity = element("details", "erv-run-identity");
    rememberDisclosure(identity, "identity");
    identity.dataset.runIdentity = "";
    identity.append(element("summary", "", t.identity));
    if (run.capture.status === "complete") identity.append(capture);
    if (explanation.runId) identity.append(element("p", "erv-muted", t.runId), element("pre", "", explanation.runId));
    if (explanation.title) identity.append(element("p", "erv-muted", t.recordTitle), element("pre", "", explanation.title));
    identity.append(referenceButtons(run.result.evidenceEnvelopeIndexes));
    const metadata = element("div", "erv-run-meta");
    metadata.append(timing(run.timing), identity);
    header.append(statuses, metadata);
    root.append(header);

    const summary = element("section", "erv-summary");
    summary.dataset.runSummary = "";
    const channels = element("div", "erv-channels");
    // Output comes first in both DOM and visual order: narrow screens and
    // assistive readers must reach the saved result before the original input.
    channels.append(channel(run.output, t.output, "output"), channel(run.input, t.input, "input"));
    function renderIssues(entries) {
      const issues = element("div", "erv-issues");
      issues.dataset.runIssues = "";
      if (run.result.state !== "success") issues.append(element("h3", "", t.failure));
      for (const issue of entries) {
        const entry = element("div");
        entry.append(issueValue(issue));
        appendIssueNavigation(entry, issue);
        issues.append(entry);
      }
      return issues;
    }
    if (run.issues.length && run.result.state !== "success") summary.append(renderIssues(run.issues));
    summary.append(channels);
    if (run.issues.length && run.result.state === "success") {
      const recoveredIssues = element("details", "erv-limits");
      rememberDisclosure(recoveredIssues, "recovered");
      recoveredIssues.dataset.runRecoveredIssues = "";
      recoveredIssues.append(element("summary", "", `${t.issuesOnly} · ${run.issues.length}`), renderIssues(run.issues));
      summary.append(recoveredIssues);
    }
    const runLimits = limitations(model.diagnostics.map((item) => `${item.code}: ${item.message}`));
    if (runLimits) identity.append(runLimits);
    const globalSummary = element("details", "erv-global-summary");
    globalSummary.dataset.globalSummary = "";
    globalSummary.dataset.local = "false";
    globalSummary.open = true;
    globalSummary.append(element("summary", "", t.globalResult), summary);
    root.append(globalSummary);

    // Groups are navigation contexts supplied by the explanation, never inferred
    // from labels, last outputs, timestamps, or the currently expanded branches.
    const groups = explanation.groups || [];
    const groupById = new Map(groups.map((group) => [group.id, group]));
    state.reading = buildScopeReading(model.document, explanation, { locale });
    const unassignedReading = buildScopeReading(model.document, explanation, { ungroupedOnly: true, locale });
    const hasUnassigned = unassignedReading.nodeIds.length > 0 || unassignedReading.evidenceEnvelopeIndexes.length > 0;
    const childrenById = new Map();
    for (const group of groups) {
      const parent = groupById.has(group.parentId) ? group.parentId : null;
      if (!childrenById.has(parent)) childrenById.set(parent, []);
      childrenById.get(parent).push(group);
    }
    const context = element("section", "erv-context");
    context.dataset.readingScope = "";
    context.setAttribute("aria-label", t.scope);
    const directory = element("details");
    directory.dataset.groupDirectory = "";
    directory.append(element("summary", "", `${t.hierarchy[model.document.kind]} · ${groups.length}`));
    const groupList = element("div", "erv-groups");
    const groupOffsets = new Map();
    const groupBranches = new Map();
    groupList.dataset.groupList = "";
    directory.append(groupList);
    const breadcrumbs = element("nav", "erv-breadcrumbs");
    breadcrumbs.dataset.groupBreadcrumbs = "";
    breadcrumbs.setAttribute("aria-label", t.scope);
    const scopeNote = element("div", "erv-scope-note");
    scopeNote.dataset.groupDescription = "";
    const localSummary = element("section", "erv-local-result");
    localSummary.dataset.scopeResult = "";
    localSummary.setAttribute("aria-label", t.localResult);
    directory.hidden = groups.length === 0;
    context.append(breadcrumbs, scopeNote, localSummary);

    // A chosen scope controls the nearby path, not only the step list. Mount
    // lazily so opening the saved result remains inexpensive for large records.
    const diagram = element("details", "erv-diagram");
    diagram.dataset.scopeDiagram = "";
    diagram.open = true;
    const diagramLabel = element("summary");
    diagram.append(diagramLabel);
    const graphHost = element("div", "erv-graph");
    graphHost.dataset.runGraph = "";
    diagram.append(graphHost);
    diagram.addEventListener("toggle", () => {
      // Native toggle events may already be queued when update/destroy removes
      // this instance. Never resize a graph after its owning view is disposed.
      if (state.disposed) return;
      if (diagram.open) scheduleDiagram();
    });
    function groupPath(id) { return model.inspection.getGroupPath?.(id) || []; }
    function nodeGroups(id) { return model.inspection.getNodeGroups?.(id) || []; }
    function scopeOptions() { return state.ungroupedOnly ? { ungroupedOnly: true } : state.selectedGroupId ? { groupId: state.selectedGroupId } : {}; }
    function scopeContainsNode(id) {
      return state.reading.nodeIds.includes(id);
    }
    function scopeContainsEvidence(index) {
      if (!state.selectedGroupId && !state.ungroupedOnly) return true;
      return state.reading.evidenceEnvelopeIndexes.includes(index);
    }
    function renderGroupPage(target, entries, offset = 0) {
      groupOffsets.set(target === groupList ? "root" : target.dataset.groupPage, offset);
      const rows = element("div");
      for (const group of entries.slice(offset, offset + pageSize)) {
        const row = element("div", "erv-group-row");
        const choose = button("", () => selectGroup(group.id));
        choose.dataset.groupSelect = group.id;
        choose.setAttribute("aria-pressed", String(state.selectedGroupId === group.id));
        choose.append(element("span", "", group.label), element("small", "erv-muted", `${group.basis === "declared" ? `${t.declaredScope} · ` : ""}${group.nodeIds.length} ${t.directSteps}`));
        row.append(choose);
        const children = childrenById.get(group.id) || [];
        if (children.length) {
          const branch = element("details", "erv-group-children");
          branch.dataset.groupChildren = group.id;
          branch.append(element("summary", "", `${t.childScopes} · ${children.length}`));
          const nested = element("div");
          nested.dataset.groupPage = group.id;
          branch.append(nested);
          groupBranches.set(group.id, { branch, nested, children });
          branch.addEventListener("toggle", () => { if (branch.open && !nested.children.length) renderGroupPage(nested, children); });
          row.append(branch);
        }
        rows.append(row);
      }
      const pager = element("div", "erv-pagination");
      pageControls(pager, { total: entries.length, offset, limit: pageSize }, (next) => renderGroupPage(target, entries, next));
      target.replaceChildren(rows, pager);
      if (!entries.length) rows.append(element("p", "erv-muted", t.noMatches));
    }
    directory.addEventListener("toggle", () => {
      if (directory.open && !groupList.children.length) renderGroupPage(groupList, childrenById.get(null) || []);
    });

    function renderScope() {
      const previousRegion = disclosureRegion;
      resetDisclosures("scope");
      const all = button(`${t.allSteps} · ${model.inspection.nodeCount}`, () => selectGroup(null));
      all.dataset.allGroups = "";
      if (!state.selectedGroupId && !state.ungroupedOnly) all.setAttribute("aria-current", "location");
      breadcrumbs.replaceChildren(all);
      for (const group of groupPath(state.selectedGroupId)) {
        const crumb = button(group.label, () => selectGroup(group.id));
        crumb.dataset.groupBreadcrumb = group.id;
        if (group.id === state.selectedGroupId) crumb.setAttribute("aria-current", "location");
        breadcrumbs.append(element("span", "erv-muted", "/"), crumb);
      }
      if (hasUnassigned) {
        const ungrouped = button(t.ungrouped, () => changeScope(null, true));
        ungrouped.dataset.ungroupedScope = "";
        if (state.ungroupedOnly) ungrouped.setAttribute("aria-current", "location");
        breadcrumbs.append(ungrouped);
      }
      scopeNote.replaceChildren();
      const group = groupById.get(state.selectedGroupId);
      context.dataset.groupId = state.selectedGroupId || "";
      context.dataset.ungroupedOnly = String(state.ungroupedOnly);
      if (group) {
        if (group.basis === "declared") scopeNote.append(element("p", "erv-badge", t.declaredScope));
        const identity = element("details");
        rememberDisclosure(identity, "identity");
        identity.append(element("summary", "erv-muted", t.scopeIdentity), valueItem({ value: group.id, availability: "available", evidenceEnvelopeIndexes: [] }, false, { foldLong: false }));
        scopeNote.append(identity);
      }
      for (const control of groupList.querySelectorAll("[data-group-select]")) control.setAttribute("aria-pressed", String(control.dataset.groupSelect === state.selectedGroupId));
      const reading = state.reading;
      localSummary.hidden = reading.mode === "all" || reading.topLevel;
      const local = !localSummary.hidden;
      if (globalSummary.dataset.local !== String(local)) globalSummary.open = !local;
      globalSummary.dataset.local = String(local);
      localSummary.dataset.scopeMode = reading.mode;
      localSummary.dataset.groupId = state.selectedGroupId || "";
      localSummary.replaceChildren();
      diagramLabel.textContent = `${!model.document.execution ? t.declaredDiagram : reading.mode === "all" ? t.diagram : t.localDiagram} · ${reading.nodeIds.length}`;
      diagram.dataset.groupId = state.selectedGroupId || "";
      diagram.dataset.scopeMode = reading.mode;
      if (!localSummary.hidden) {
        const heading = element("div", "erv-local-heading");
        const global = button(t.globalResult, () => {
          globalSummary.open = true;
          title.focus();
          header.scrollIntoView?.({ block: "start" });
        });
        global.dataset.globalResult = "";
        heading.append(element("h3", "", `${reading.mode === "unassigned" ? t.unassignedResult : t.localResult}${reading.group ? ` · ${reading.group.label}` : ""}`), global);
        localSummary.append(heading);
        const result = element("p", "erv-badge", reading.result.label);
        result.dataset.scopeOutcome = reading.result.state;
        result.dataset.outcomeBasis = reading.result.basis;
        localSummary.append(result);
        if (reading.issues.length) {
          const issues = element("div", "erv-issues");
          issues.dataset.scopeIssues = "";
          for (const issue of reading.issues) {
            const entry = element("div");
            // A boundary reference can belong to the calling parent. Keep its
            // recorded recovery, but never present it as recovery of this call.
            const callerBoundary = issue.nodeId && !reading.nodeIds.includes(issue.nodeId);
            entry.dataset.scopeIssueRole = callerBoundary ? "caller-boundary" : "local";
            entry.append(issueValue(issue, callerBoundary ? issue.recovered ? t.callerRecovered : t.callerError : undefined));
            appendIssueNavigation(entry, issue, callerBoundary ? t.callerStep : t.step);
            issues.append(entry);
          }
          localSummary.append(issues);
        }
        if (reading.mode !== "unassigned") {
          const values = element("div", "erv-channels");
          values.append(channel(reading.output, t.localOutput, "output"), channel(reading.input, t.localInput, "input"));
          localSummary.append(values);
        }
        if (reading.boundary.total > 0) {
          const boundary = element("details", "erv-muted erv-boundary-note");
          rememberDisclosure(boundary, "boundary");
          boundary.dataset.scopeBoundary = String(reading.boundary.total);
          boundary.append(element("summary", "", `${t.boundaryEdges} · ${reading.boundary.total}`),
            element("p", "", `${t.incoming} ${reading.boundary.incoming.length} / ${t.outgoing} ${reading.boundary.outgoing.length}`));
          localSummary.append(boundary);
        }
        if (reading.limitations.some((message) => message.includes("contradictory call boundaries") || message.includes("调用边界重复或互相矛盾"))) {
          localSummary.append(element("p", "erv-badge", t.ambiguousBoundary));
        }
      }
      disclosureRegion = previousRegion;
    }

    function changeScope(id, ungroupedOnly = false) {
      if (state.disposed || (id !== null && !groupById.has(id))) return false;
      state.selectedGroupId = id;
      state.ungroupedOnly = ungroupedOnly;
      state.graphRequested = false;
      pendingGraphViewport = undefined;
      revealGraphSelection = false;
      state.reading = buildScopeReading(model.document, explanation, { ...scopeOptions(), locale });
      stepOffset = 0;
      evidenceOffset = 0;
      if (state.selectedStepId && !scopeContainsNode(state.selectedStepId)) {
        state.selectedStepId = null;
        delete detail.dataset.stepId;
        delete detail.dataset.executionState;
        detail.replaceChildren(element("p", "erv-empty", t.choose));
        detailPanel.open = false;
        body.dataset.detailOpen = "false";
      }
      if (state.selectedEnvelopeIndex !== null && !scopeContainsEvidence(state.selectedEnvelopeIndex)) {
        state.selectedEnvelopeIndex = null;
        raw.hidden = true;
        raw.textContent = "";
        rawHeading.textContent = "";
        delete raw.dataset.envelopeIndex;
      }
      renderScope();
      renderDiagram();
      renderSteps();
      renderEvidence();
      return true;
    }
    function selectGroup(id) { return changeScope(id, false); }
    renderScope();

    const body = element("div", "erv-body");
    body.dataset.readingWorkspace = "";
    body.dataset.detailOpen = "false";
    const steps = element("section", "erv-steps");
    const stepTitle = element("h3", "", `${run.result.state === "definition-only" ? t.declared : t.steps} · ${model.inspection.nodeCount}`);
    const stepSearchLabel = element("label", "erv-search-label", t.stepSearch);
    const stepSearch = element("input");
    stepSearch.type = "search";
    stepSearch.placeholder = t.searchHint;
    stepSearch.dataset.stepSearch = "";
    const searchRow = element("div", "erv-search-row");
    const clearSearch = button(t.clear, () => { stepSearch.value = ""; stepOffset = 0; renderSteps(); stepSearch.focus(); });
    clearSearch.dataset.clearStepSearch = "";
    searchRow.append(stepSearch, clearSearch);
    stepSearchLabel.append(searchRow);
    const issuesLabel = element("label", "erv-filter-label");
    const issuesOnly = element("input");
    issuesOnly.type = "checkbox";
    issuesOnly.dataset.issuesOnly = "";
    issuesLabel.append(issuesOnly, dom.createTextNode(t.issuesOnly));
    const stepList = element("div", "erv-list");
    stepList.dataset.stepList = "";
    const stepPager = element("div", "erv-pagination");
    let stepOffset = 0;
    steps.append(directory, stepTitle, stepSearchLabel, issuesLabel, stepList, stepPager);
    const detail = element("section", "erv-detail");
    detail.dataset.stepDetail = "";
    detail.setAttribute("aria-label", t.step);
    detail.append(element("p", "erv-empty", t.choose));
    const detailPanel = element("details", "erv-detail-panel");
    detailPanel.dataset.stepPanel = "";
    detailPanel.append(element("summary", "", t.stepDetails), detail);
    detailPanel.addEventListener("toggle", () => { body.dataset.detailOpen = String(detailPanel.open); scheduleDiagram(); });
    detailPanel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeStep(); } });
    const readingMain = element("div", "erv-reading-main");
    readingMain.dataset.readingMain = "";
    readingMain.append(context, diagram);
    body.append(readingMain, steps, detailPanel);
    root.append(body);

    function pageControls(target, resultPage, change) {
      const previous = button(t.previous, () => change(Math.max(0, resultPage.offset - resultPage.limit)));
      previous.disabled = resultPage.offset === 0;
      const next = button(t.next, () => change(resultPage.offset + resultPage.limit));
      next.disabled = resultPage.offset + resultPage.limit >= resultPage.total;
      const range = resultPage.total ? `${resultPage.offset + 1}–${Math.min(resultPage.offset + resultPage.limit, resultPage.total)} / ${resultPage.total}` : "0 / 0";
      target.replaceChildren(previous, element("span", "erv-muted", range), next);
      target.hidden = resultPage.total <= resultPage.limit;
    }

    function stepStatus(node) {
      const metadata = node.technical?.metadata || node.metadata || {};
      if (metadata.agentScopeUnresolved && node.status !== "failed") return t.scopeUnconfirmed;
      return t.state[metadata.executionState] || t.status[node.status] || node.status;
    }

    function isRecordedErrorValue(node, item) {
      return isRecordedErrorItem(node, item, (index) => model.document.evidence[index]);
    }

    function errorValueRepresentsIssue(item, issue) {
      return issue.evidenceEnvelopeIndexes?.length > 0
        && issue.evidenceEnvelopeIndexes.every((index) => item.evidenceEnvelopeIndexes.includes(index))
        && (item.value === issue.message || item.value?.message === issue.message
          || !Object.hasOwn(item, "value") && item.availability === "not-observed"
            && recordedIssueValue(issue, (index) => model.document.evidence[index], model.diagnostics).availability === "not-observed");
    }

    function renderSteps() {
      const page = searchReadingSteps(stepSearch.value, { offset: stepOffset, limit: pageSize, issuesOnly: issuesOnly.checked, ...scopeOptions() });
      stepOffset = page.offset;
      clearSearch.disabled = !stepSearch.value;
      stepTitle.textContent = `${run.result.state === "definition-only" ? t.declared : t.steps} · ${page.total === model.inspection.nodeCount ? page.total : `${page.total} / ${model.inspection.nodeCount}`}`;
      stepList.replaceChildren();
      for (const node of page.items) {
        const control = button("", () => selectStep(node.id, false, control), "erv-step");
        control.dataset.stepId = node.id;
        control.dataset.executionState = node.technical.metadata.executionState || "";
        control.setAttribute("aria-pressed", String(state.selectedStepId === node.id));
        const presentation = buildReadingStepPresentation(node, { locale, envelopes: model.document.evidence,
          invocationLabels: model.invocationLabels, identityLabels: model.identityLabels });
        const name = element("span", "erv-step-name", presentation.name);
        name.title = presentation.name;
        const facts = element("small", "", [model.invocationLabels.get(node.id), stepStatus(node), presentation.role].filter(Boolean).join(" · "));
        control.append(name, facts);
        const identity = stepIdentity(node);
        if (identity) {
          const label = element("small", "erv-step-identity", identity);
          label.title = identity;
          control.append(label);
        }
        control.setAttribute("aria-label", `${presentation.title} · ${stepStatus(node)}`);
        stepList.append(control);
      }
      if (!page.items.length) stepList.append(element("p", "erv-empty", t.noMatches));
      pageControls(stepPager, page, (offset) => { stepOffset = offset; renderSteps(); });
    }

    function stepPosition(id) {
      for (let offset = 0; offset < model.inspection.nodeCount; offset += 200) {
        const page = searchReadingSteps(stepSearch.value, { offset, limit: 200, issuesOnly: issuesOnly.checked, ...scopeOptions() });
        const index = page.items.findIndex((node) => node.id === id);
        if (index !== -1) return page.offset + index;
        if (page.offset + page.items.length >= page.total) break;
      }
      return -1;
    }

    function closeStep() {
      detailPanel.open = false;
      body.dataset.detailOpen = "false";
      const fallback = [...stepList.querySelectorAll("[data-step-id]")].find((control) => control.dataset.stepId === state.selectedStepId);
      const restoredTrigger = detailReturnSelection?.kind === "step"
        ? [...stepList.querySelectorAll("[data-step-id]")].find((control) => control.dataset.stepId === detailReturnSelection.id)
        : undefined;
      const target = restoredTrigger || (detailReturnFocus?.isConnected ? detailReturnFocus : fallback);
      target?.focus?.({ preventScroll: true });
      scheduleDiagram();
    }

    function selectStep(id, focus = false, trigger) {
      const node = model.inspection.getNode(id);
      if (!node || state.disposed) return false;
      rememberDetailTrigger(trigger);
      if (!scopeContainsNode(id)) changeScope(null);
      if (!state.restoring) {
        let position = stepPosition(id);
        if (position === -1) {
          stepSearch.value = "";
          issuesOnly.checked = false;
          position = stepPosition(id);
        }
        if (position !== -1) stepOffset = Math.floor(position / pageSize) * pageSize;
        renderSteps();
      }
      state.selectedStepId = id;
      detailPanel.open = true;
      body.dataset.detailOpen = "true";
      detail.dataset.stepId = id;
      detail.dataset.executionState = node.technical.metadata.executionState || "";
      const previousRegion = disclosureRegion;
      resetDisclosures("step");
      const detailHeading = element("div", "erv-detail-header");
      const close = button(t.close, closeStep);
      close.dataset.closeStep = "";
      const presentation = buildReadingStepPresentation(node, { locale, envelopes: model.document.evidence,
        invocationLabels: model.invocationLabels, identityLabels: model.identityLabels });
      const heading = element("h2", "", presentation.name);
      heading.title = presentation.name;
      const headingName = element("div", "erv-detail-name");
      headingName.append(heading);
      if (model.invocationLabels.has(node.id)) headingName.append(element("span", "erv-heading-fact", model.invocationLabels.get(node.id)));
      detailHeading.append(headingName, close);
      detail.replaceChildren(detailHeading, element("p", "erv-badge", stepStatus(node)), timing(node.timing));
      if (presentation.role && !stepStatus(node).includes(presentation.role)) {
        const role = element("p", "erv-muted", presentation.role);
        role.dataset.stepRole = "";
        detail.append(role);
      }
      const identity = stepIdentity(node);
      if (identity) {
        const fullIdentity = element("details", "erv-identity-value");
        fullIdentity.dataset.stepIdentity = "";
        rememberDisclosure(fullIdentity, "identity");
        fullIdentity.append(element("summary", "", `${t.stepIdentity} · ${previewRecordedText(identity, 72)}`),
          valueItem({ availability: "available", value: identity, evidenceEnvelopeIndexes: [] }, false, { foldLong: false }));
        detail.append(fullIdentity);
      }
      if (presentation.name.length > 80) {
        const fullName = element("details", "erv-identity-value");
        fullName.dataset.stepFullName = "";
        rememberDisclosure(fullName, "name");
        fullName.append(element("summary", "", t.fullName), valueItem({ availability: "available", value: presentation.name, evidenceEnvelopeIndexes: [] }, false, { foldLong: false }));
        detail.append(fullName);
      }
      const memberships = nodeGroups(id);
      for (const group of memberships) {
        const path = element("p", "erv-step-path", groupPath(group.id).map((entry) => entry.label).join(" / "));
        path.dataset.stepGroupPath = group.id;
        detail.append(path);
      }
      const values = element("div", "erv-channels");
      // Source roles distinguish errors from business values; field names and
      // translated item labels cannot establish whether an output is an error.
      const errorValues = node.output.items.filter((item) => isRecordedErrorValue(node, item));
      const outputItems = node.output.items.filter((item) => !errorValues.includes(item));
      const output = stepReadingChannel({ ...node.output, items: outputItems }, "output");
      const relatedIssues = run.issues.filter((issue) => issue.nodeId === id);
      if (errorValues.length) {
        const errors = element("section", "erv-issues");
        errors.dataset.stepErrors = "";
        errors.append(element("h3", "", t.executionError));
        for (const item of errorValues) {
          const related = relatedIssues.find((issue) => errorValueRepresentsIssue(item, issue));
          if (related?.recovered) errors.append(element("p", "erv-badge", t.recovered));
          errors.append(valueItem(item));
        }
        detail.append(errors);
      }
      for (const issue of relatedIssues) {
        if (!errorValues.some((item) => errorValueRepresentsIssue(item, issue))) {
          const error = issueValue(issue);
          error.className = "erv-issues";
          detail.append(error);
        }
      }
      if (node.technical.metadata.interruptionReason && !relatedIssues.some((issue) => issue.message === node.technical.metadata.interruptionReason)) {
        const interruption = issueValue({ kind: "interruption", message: node.technical.metadata.interruptionReason, evidenceEnvelopeIndexes: [] }, "");
        interruption.className = "erv-issues";
        detail.append(interruption);
      }
      values.append(channel(output, t.stepOutput, "output"), channel(stepReadingChannel(node.input, "input"), t.input, "input"));
      detail.append(values);
      const references = node.evidence.map(({ envelopeIndex }) => envelopeIndex);
      detail.append(references.length ? referenceButtons(references) : element("p", "erv-muted", t.noEvidence));
      for (const control of stepList.querySelectorAll("[data-step-id]")) control.setAttribute("aria-pressed", String(control.dataset.stepId === id));
      if (focus) { detail.tabIndex = -1; detail.focus(); }
      const canonical = model.document.execution?.nodes.find((item) => item.id === id) || definitionByStep.get(id);
      disclosureRegion = previousRegion;
      if (!state.restoring) options.onNodeClick?.({ id, node: canonical || node });
      syncGraphSelection();
      if (!state.restoring) revealGraphSelection = true;
      scheduleDiagram();
      if (!focus && !state.restoring && !state.disposed && detailReturnSelection?.kind === "step" && detailReturnSelection.id === id) {
        [...stepList.querySelectorAll("[data-step-id]")].find((control) => control.dataset.stepId === id)?.focus?.({ preventScroll: true });
      }
      return true;
    }

    stepSearch.addEventListener("input", () => { stepOffset = 0; renderSteps(); });
    issuesOnly.addEventListener("change", () => { stepOffset = 0; renderSteps(); });
    renderSteps();

    let diagramFrame;
    let graphObserver;
    let pendingGraphViewport;
    let revealGraphSelection = false;
    function syncGraphSelection() {
      if (!state.graph) return;
      const node = state.selectedStepId && model.inspection.getNode(state.selectedStepId);
      let path = null;
      if (node && scopeContainsNode(node.id)) {
        if (model.document.execution) path = [node.id];
        else {
          const sourcePath = model.document.kind === "graph" ? node.technical.metadata.sourceNodePath : node.path;
          path = sourcePath?.slice(state.reading.mode === "all" ? 0 : (state.reading.definitionPathPrefix || []).length);
        }
      }
      selectViewerGraphPath(state.graph, path || null);
    }
    function scheduleDiagram() {
      const view = dom.defaultView;
      if (state.disposed || diagramFrame !== undefined || !view?.requestAnimationFrame) return;
      diagramFrame = view.requestAnimationFrame(() => {
        diagramFrame = undefined;
        if (state.disposed || !diagram.open || !graphHost.isConnected) return;
        const bounds = graphHost.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return;
        // The compatibility renderer's public resize() always fits. Its own
        // default autoResize preserves the viewport on real size changes.
        // Selection and disclosure changes must never invoke public resize.
        if (!state.graph) drawDiagram();
        if (state.graph) {
          syncGraphSelection();
          if (pendingGraphViewport) {
            restoreViewerViewport(state.graph, pendingGraphViewport);
            pendingGraphViewport = undefined;
            revealGraphSelection = false;
          } else if (revealGraphSelection) {
            revealViewerSelection(state.graph);
            revealGraphSelection = false;
          }
        }
      });
    }

    function renderDiagram() {
      state.graph?.destroy();
      state.graph = undefined;
      graphHost.replaceChildren();
      const count = state.reading.nodeIds.length;
      graphHost.dataset.empty = String(count === 0);
      graphHost.dataset.deferred = String(count > 500 && !state.graphRequested);
      if (!count) graphHost.append(element("p", "erv-empty", t.emptyScope));
      else if (count > 500 && !state.graphRequested) {
        const draw = button(t.drawGraph, () => { state.graphRequested = true; renderDiagram(); });
        draw.dataset.drawGraph = "";
        graphHost.append(element("p", "erv-muted", `${t.largeGraph} · ${count} ${t.steps}`), draw);
      }
      scheduleDiagram();
    }

    function drawDiagram() {
      if (!diagram.open || state.disposed) return;
      const reading = state.reading;
      if (!reading.nodeIds.length || reading.nodeIds.length > 500 && !state.graphRequested) return;
      graphHost.replaceChildren();
      const graphOptions = { direction: "RIGHT", locale: locale === "zh" ? { statuses: { success: "成功", failed: "失败", skipped: "已跳过" } } : undefined,
        theme: { base: "classic", tokens: { node: { width: 212, height: 88, textMaxWidth: 192, fontSize: 13, fontWeight: 500 }, canvas: { bg: "#F3F6FA" } } } };
      try {
        // A pure Graph declaration may contain cycles, which the workflow
        // compatibility renderer cannot accept. Its sole top-level group is
        // the exact original graph, so retain the cycle-aware public renderer.
        if (reading.mode === "all" || (!model.document.execution && model.document.kind === "graph" && reading.topLevel)) {
          state.graph = createEinoViewer(graphHost, model.document, { ...graphOptions, onNodeClick: ({ id, node: sourceNode }) => {
            if (model.inspection.getNode(id)) { selectStep(id, true); return; }
            const target = [...definitionByStep].find(([, node]) => node === sourceNode);
            if (target) selectStep(target[0], true);
          } });
          return;
        }
        // The local view is not a new ViewerDocument or a completed run. It is
        // only a read-only renderer snapshot of the shared scope model. Never
        // re-project its evidence or inherit a global outcome as a local one.
        let snapshot = reading.definitionSnapshot;
        if (reading.execution) {
          const projected = executionDAGToWorkflowSnapshot(reading.execution);
          snapshot = { ...projected, workflow: { ...projected.workflow,
            name: reading.group?.label || t.ungrouped,
            // Compatibility projection adds start/end edges for layout. They
            // are not recorded edges and would invent local scope boundaries.
            edges: projected.workflow.edges.filter((edge) => !edge.metadata?.synthetic),
          } };
        }
        if (!snapshot) {
          graphHost.dataset.empty = "true";
          graphHost.append(element("p", "erv-empty", t.emptyScope));
          return;
        }
        const timings = new Map(explanation.nodes.map((node) => [node.id, node.timing]));
        state.graph = createWorkflowDAG(graphHost, { ...graphOptions,
          snapshot: workflowPresentationSnapshot(snapshot, locale, timings, model.invocationLabels, model.identityLabels),
          nodeLabelFormatter: workflowNodeLabel,
          accessibilityLabelFormatter: (summary, visible) => workflowAccessibilityLabel(summary, visible, locale),
          onNodeClick: (renderedNode) => {
            if (reading.execution) {
              if (reading.nodeIds.includes(renderedNode.id)) selectStep(renderedNode.id, true);
              return;
            }
            const localPath = Array.isArray(renderedNode.path) ? renderedNode.path : [renderedNode.id];
            const path = JSON.stringify([...(reading.definitionPathPrefix || []), ...localPath]);
            const target = explanation.nodes.find((node) => reading.nodeIds.includes(node.id)
              && JSON.stringify(model.document.kind === "graph" ? node.technical.metadata.sourceNodePath : node.path) === path);
            if (target) selectStep(target.id, true);
          },
        });
      } catch (error) { graphHost.replaceChildren(element("p", "erv-issues", error.message)); }
    }

    const rawSection = element("section", "erv-raw");
    rawSection.setAttribute("aria-label", t.evidence);
    const rawDetails = element("details");
    rawDetails.dataset.evidencePanel = "";
    rawDetails.append(element("summary", "", `${t.evidence} · ${model.inspection.evidenceCount}`));
    const evidenceControls = element("div", "erv-evidence-controls");
    const evidenceSearchLabel = element("label", "erv-search-label", t.evidenceSearch);
    const evidenceSearch = element("input");
    evidenceSearch.type = "search";
    evidenceSearch.dataset.evidenceSearch = "";
    const evidenceSearchRow = element("div", "erv-search-row");
    const clearEvidenceSearch = button(t.clear, () => { evidenceSearch.value = ""; evidenceOffset = 0; renderEvidence(); evidenceSearch.focus(); });
    clearEvidenceSearch.dataset.clearEvidenceSearch = "";
    evidenceSearchRow.append(evidenceSearch, clearEvidenceSearch);
    evidenceSearchLabel.append(evidenceSearchRow);
    const scopeLabel = element("label", "erv-search-label", t.evidence);
    const scope = element("select");
    scope.dataset.evidenceScope = "";
    for (const value of ["all", "run", "step", "unassigned"]) {
      const option = element("option", "", t[value]);
      option.value = value;
      scope.append(option);
    }
    scopeLabel.append(scope);
    evidenceControls.append(evidenceSearchLabel, scopeLabel);
    const evidenceList = element("div", "erv-evidence-list");
    evidenceList.dataset.evidenceList = "";
    const evidencePager = element("div", "erv-pagination");
    const evidenceCount = element("p", "erv-muted");
    evidenceCount.dataset.scopeEvidenceCount = "";
    const rawHeading = element("p", "erv-muted");
    const raw = element("pre");
    raw.dataset.rawEnvelope = "";
    raw.tabIndex = 0;
    raw.hidden = true;
    let evidenceOffset = 0;
    rawDetails.append(evidenceControls, evidenceCount, evidenceList, evidencePager, rawHeading, raw);
    rawSection.append(rawDetails);
    const fullRecord = element("details");
    fullRecord.append(element("summary", "", t.raw));
    const recordJSON = element("pre");
    recordJSON.dataset.originalRecord = "";
    recordJSON.tabIndex = 0;
    fullRecord.append(recordJSON);
    fullRecord.addEventListener("toggle", () => { if (fullRecord.open && !recordJSON.textContent) recordJSON.textContent = JSON.stringify(JSON.parse(model.originalJSON), null, 2); });
    rawSection.append(fullRecord);
    root.append(rawSection);

    function renderEvidence() {
      const page = model.inspection.searchEvidence(evidenceSearch.value, { scope: scope.value, offset: evidenceOffset, limit: pageSize,
        evidenceEnvelopeIndexes: state.reading.evidenceEnvelopeIndexes });
      evidenceOffset = page.offset;
      clearEvidenceSearch.disabled = !evidenceSearch.value;
      evidenceCount.textContent = `${t.scopeEvidence} · ${page.total} / ${model.inspection.evidenceCount} ${t.total}`;
      evidenceList.replaceChildren();
      for (const item of page.items) {
        const control = button(`#${item.envelopeIndex + 1} · ${item.label || item.kind}`, () => selectEvidence(item.envelopeIndex), "erv-evidence-link");
        control.dataset.envelopeIndex = String(item.envelopeIndex);
        control.setAttribute("aria-pressed", String(item.envelopeIndex === state.selectedEnvelopeIndex));
        evidenceList.append(control);
      }
      if (!page.items.length) evidenceList.append(element("p", "erv-empty", t.noMatches));
      pageControls(evidencePager, page, (offset) => { evidenceOffset = offset; renderEvidence(); });
    }

    function selectEvidence(index, focus = false) {
      const item = model.inspection.getEvidence(index);
      if (!item || state.disposed) return false;
      // A global-result reference remains reachable from a child scope, but the
      // active filter must not imply that this outside evidence belongs to it.
      if (!scopeContainsEvidence(index)) changeScope(null);
      if (!state.restoring) {
        let position = -1;
        const findPosition = () => {
          for (let offset = 0; offset < model.inspection.evidenceCount; offset += 200) {
            const page = model.inspection.searchEvidence(evidenceSearch.value, { scope: scope.value, offset, limit: 200, evidenceEnvelopeIndexes: state.reading.evidenceEnvelopeIndexes });
            const match = page.items.findIndex((entry) => entry.envelopeIndex === index);
            if (match !== -1) return page.offset + match;
            if (page.offset + page.items.length >= page.total) break;
          }
          return -1;
        };
        position = findPosition();
        if (position === -1) { evidenceSearch.value = ""; scope.value = "all"; position = findPosition(); }
        if (position !== -1) evidenceOffset = Math.floor(position / pageSize) * pageSize;
        renderEvidence();
      }
      state.selectedEnvelopeIndex = index;
      rawDetails.open = true;
      rawHeading.textContent = `#${index + 1} · ${item.kind} · ${t[item.scope] || item.scope}`;
      raw.hidden = false;
      raw.dataset.envelopeIndex = String(index);
      raw.textContent = JSON.stringify(model.document.evidence[index], null, 2);
      for (const control of evidenceList.querySelectorAll("[data-envelope-index]")) control.setAttribute("aria-pressed", String(Number(control.dataset.envelopeIndex) === index));
      if (focus) raw.focus();
      if (!state.restoring) options.onEvidenceClick?.({ envelopeIndex: index, envelope: model.document.evidence[index] });
      return true;
    }
    evidenceSearch.addEventListener("input", () => { evidenceOffset = 0; renderEvidence(); });
    scope.addEventListener("change", () => { evidenceOffset = 0; renderEvidence(); });
    renderEvidence();
    function captureReading() {
      const scroll = (target) => ({ top: target.scrollTop || 0, left: target.scrollLeft || 0 });
      return {
        selectedStepId: state.selectedStepId, selectedEnvelopeIndex: state.selectedEnvelopeIndex,
        detailReturnSelection: detailReturnSelection && { ...detailReturnSelection },
        selectedGroupId: state.selectedGroupId, ungroupedOnly: state.ungroupedOnly,
        stepSearch: stepSearch.value, issuesOnly: issuesOnly.checked, stepOffset,
        evidenceSearch: evidenceSearch.value, evidenceScope: scope.value, evidenceOffset,
        directoryOpen: directory.open === true, diagramOpen: diagram.open === true,
        detailOpen: detailPanel.open === true, evidenceOpen: rawDetails.open === true,
        originalOpen: fullRecord.open === true, globalOpen: globalSummary.open === true,
        graphRequested: state.graphRequested,
        graphViewport: captureViewerViewport(state.graph) || pendingGraphViewport,
        groupOffsets: [...groupOffsets], groupBranches: [...groupBranches].filter(([, entry]) => entry.branch.open).map(([id]) => id),
        disclosures: [...disclosures].map(([key, entry]) => [key, entry.open === true]).sort(([a], [b]) => a.localeCompare(b)),
        scroll: [root, stepList, detailPanel, evidenceList, groupList, raw, recordJSON].map(scroll),
        valueScroll: [...valueScroll].map(([key, entry]) => [key, scroll(entry)]).sort(([a], [b]) => a.localeCompare(b)),
        viewport: { left: dom.defaultView?.scrollX || 0, top: dom.defaultView?.scrollY || 0 },
      };
    }
    let restoredScroll;
    let restoreFrame;
    function restore(saved) {
      if (!saved) return;
      state.restoring = true;
      try {
        changeScope(saved.selectedGroupId, saved.ungroupedOnly);
        stepSearch.value = saved.stepSearch;
        issuesOnly.checked = saved.issuesOnly;
        stepOffset = saved.stepOffset;
        evidenceSearch.value = saved.evidenceSearch;
        scope.value = saved.evidenceScope;
        evidenceOffset = saved.evidenceOffset;
        if (saved.selectedStepId) selectStep(saved.selectedStepId);
        detailReturnSelection = saved.detailReturnSelection && { ...saved.detailReturnSelection };
        if (saved.selectedEnvelopeIndex !== null) selectEvidence(saved.selectedEnvelopeIndex);
        directory.open = saved.directoryOpen;
        const offsets = new Map(saved.groupOffsets);
        if (saved.directoryOpen || offsets.size) renderGroupPage(groupList, childrenById.get(null) || [], offsets.get("root") || 0);
        const expanded = new Set(saved.groupBranches);
        // Rendering an expanded parent registers its child controls. Iterating
        // the Map includes those additions without replaying native events.
        for (const [id, entry] of groupBranches) {
          entry.branch.open = expanded.has(id);
          if (entry.branch.open || offsets.has(id)) renderGroupPage(entry.nested, entry.children, offsets.get(id) || 0);
        }
        for (const [key, open] of saved.disclosures) {
          const control = disclosures.get(key);
          if (control) control.open = open;
        }
        diagram.open = saved.diagramOpen;
        detailPanel.open = saved.detailOpen;
        body.dataset.detailOpen = String(saved.detailOpen);
        rawDetails.open = saved.evidenceOpen;
        fullRecord.open = saved.originalOpen;
        if (fullRecord.open) recordJSON.textContent = JSON.stringify(JSON.parse(model.originalJSON), null, 2);
        globalSummary.open = saved.globalOpen;
        state.graphRequested = saved.graphRequested;
        pendingGraphViewport = saved.graphViewport;
        revealGraphSelection = false;
        renderSteps();
          renderEvidence();
        restoredScroll = saved;
      } finally { state.restoring = false; }
    }
    function activate() {
      renderDiagram();
      const view = dom.defaultView;
      if (view?.ResizeObserver) {
        graphObserver = new view.ResizeObserver(scheduleDiagram);
        graphObserver.observe(graphHost);
      }
      const restoreScroll = () => {
        restoreFrame = undefined;
        if (state.disposed || !restoredScroll) return;
        const saved = restoredScroll;
        restoredScroll = undefined;
        [root, stepList, detailPanel, evidenceList, groupList, raw, recordJSON].forEach((target, index) => {
          target.scrollTop = saved.scroll[index]?.top || 0;
          target.scrollLeft = saved.scroll[index]?.left || 0;
        });
        for (const [key, position] of saved.valueScroll) {
          const target = valueScroll.get(key);
          if (target) { target.scrollTop = position.top; target.scrollLeft = position.left; }
        }
        view?.scrollTo?.(saved.viewport.left, saved.viewport.top);
      };
      if (restoredScroll) {
        if (view?.requestAnimationFrame) restoreFrame = view.requestAnimationFrame(restoreScroll);
        else restoreScroll();
      }
    }
    return { root, state, selectStep, selectEvidence, selectGroup, capture: captureReading, restore, activate, dispose() {
      state.disposed = true;
      valueFolds.dispose();
      graphObserver?.disconnect();
      if (diagramFrame !== undefined) dom.defaultView?.cancelAnimationFrame?.(diagramFrame);
      if (restoreFrame !== undefined) dom.defaultView?.cancelAnimationFrame?.(restoreFrame);
      state.graph?.destroy();
      state.graph = undefined;
      root.remove();
    } };
  }

  function update(value) {
    assertActive();
    const next = prepare(value, locale);
    const view = build(next);
    const previous = mounted;
    container.replaceChildren(view.root);
    mounted = view;
    current = next;
    previous?.dispose();
    view.activate();
  }

  update(input);
  const viewer = Object.freeze({
    get kind() { return current.document.kind; },
    get document() { return current.document; },
    get explanation() { return current.explanation; },
    get selectedStepId() { return mounted?.state.selectedStepId ?? null; },
    get selectedEnvelopeIndex() { return mounted?.state.selectedEnvelopeIndex ?? null; },
    get selectedGroupId() { return mounted?.state.selectedGroupId ?? null; },
    selectGroup(id) { assertActive(); return mounted.selectGroup(id); },
    selectStep(id) { assertActive(); return mounted.selectStep(id); },
    selectEvidence(index) { assertActive(); return mounted.selectEvidence(index); },
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unregisterState?.();
      mounted?.dispose();
      mounted = undefined;
    },
  });
  unregisterState = registerRunViewerState(viewer, {
    capture: () => mounted.capture(),
    inspect: () => mounted.inspect?.(),
    setLocale(nextLocale) {
      assertActive();
      if (!["en", "zh"].includes(nextLocale)) throw invalid("viewer.invalid_locale", "Expected locale en or zh.");
      if (nextLocale === locale) return;
      const saved = mounted.capture();
      const previousLocale = locale;
      let view;
      try {
        locale = nextLocale;
        const next = prepare(JSON.parse(current.originalJSON), locale);
        view = build(next);
        view.restore(saved);
        const previous = mounted;
        container.replaceChildren(view.root);
        mounted = view;
        current = next;
        previous.dispose();
        view.activate();
      } catch (error) {
        locale = previousLocale;
        if (view !== mounted) view?.dispose();
        throw error;
      }
    },
  });
  return viewer;
}
