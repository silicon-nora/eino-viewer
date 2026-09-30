import { buildRepeatedInvocationLabels, buildStepIdentityLabels, workflowAccessibilityLabel, workflowNodeLabel, workflowPresentationSnapshot } from "../src/renderer-presentation.js";
import { buildScopeReading } from "../src/scope-reading.js";
import { buildReadingStepPresentation, buildWorkflowReadingOrder, readingTerms } from "../src/reading-presentation.js";
import { recordedValueText, compactRecordedValue, envelopeMessage, messageReadingValue, preferredRecordedItem, channelReadingValue, isRecordedErrorItem, previewRecordedText, recordedIssueValue, recordedBodyCapture } from "../src/content-presentation.js";
import { parseRecordJSON, inputFailureSummary } from "../src/record-input.js";
import { captureViewerViewport, restoreViewerViewport, revealViewerSelection, captureViewerLayout, restoreViewerLayout } from "../src/viewer-state.js";
import { createRenderedValueFoldObserver } from "../src/rendered-value-fold.js";
import { createEinoRunViewer, setRunViewerLocale, inspectRunViewer } from "./agent-reader.js?v=__EINO_VIEWER_ASSET_REVISION__";
import { buildGraphReading } from "./graph-reading.js?v=__EINO_VIEWER_ASSET_REVISION__";
import { buildGraphTopology } from "./graph-topology.js?v=__EINO_VIEWER_ASSET_REVISION__";
import { createGraphTopologyView } from "./graph-topology-view.js?v=__EINO_VIEWER_ASSET_REVISION__";

const messages = {
  en: {
    readingDirectory: "Calls and steps",
    unappliedDraft: "Unapplied draft",
    examplesLoading: "Loading examples…", examplesUnavailable: "Examples unavailable",
    exploreRuns: "Explore an Eino run", openTrajectory: "View trajectory", openPath: "View path", connectEino: "Connect your Eino application",
    previewQuestion: "Question", previewCities: "Singapore or Tokyo?", previewWeather: "Weather",
    previewSingaporeWeather: "Singapore · thunderstorms", previewTokyoWeather: "Tokyo · sunny, 24°C",
    previewAir: "Air quality", previewTokyoAir: "Tokyo · AQI 42", previewRecommendation: "Result", previewTokyoResult: "Visit Tokyo",
    previewPrepareRoute: "Prepare", previewEvaluateRoute: "Evaluate", previewReviseRoute: "Revise", previewFinishRoute: "Finish",
    previewPrepareOrder: "Prepare", previewOrder: "order", previewShipping: "Shipping", previewInventory: "Inventory", previewMergeCharges: "Merge", previewCharges: "charges",
    pasteRecord: "Paste record", examples: "More examples", chooseSample: "Choose an example…", clearSearch: "Clear search", noSearchResults: "No matching steps", locateIssue: "View problem step", changeRecord: "Change record",
    openDetails: "Step details",
    pathControls: "Path view controls",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    inspectionTitle: "Find steps and evidence",
    agentInspectionTitle: "Find steps",
    graphInspectionTitle: "Steps",
    graphVisit: "Execution",
    graphFlow: "Flow",
    graphCallsView: "Call relationships",
    graphCalls: "{count} calls",
    graphFailedCalls: "{count} failed",
    agentInspectionSearch: "Search names or status",
    agentUnconfirmedRecord: "Agent record",
    hierarchyScope: "Call scope",
    hierarchyAgent: "Agent calls",
    hierarchyGraph: "Graph calls",
    hierarchyWorkflow: "Workflow hierarchy",
    hierarchyAll: "All steps",
    hierarchyUngrouped: "Unconfirmed scope",
    hierarchyUngroupedHint: "No invocation is guessed for these records. All original evidence is retained.",
    hierarchyContext: "{count} / {total} steps",
    scopeResultTitle: "Selected call", scopeTopLevel: "Top-level scope", scopeInput: "Call input", scopeOutput: "Call return",
    scopeLocalHint: "This call's return is not the overall final output. Child steps keep their own results and errors.",
    scopeTopLevelHint: "This top-level scope shares the whole run's result; it is not an additional execution.",
    scopeBackToResult: "Overall result", scopePath: "Path · {count} steps", scopeDeclaredPath: "Declared structure",
    scopeBoundary: "Cross-scope connections · {incoming} in / {outgoing} out",
    scopeNoSteps: "No steps in this scope", scopeNoStepsHint: "The record is unchanged. Choose a parent scope or all steps to continue.",
    scopeTrajectoryHint: "Trajectory shows the complete run. Switching to it returns to all steps.", scopeTrajectoryTab: "Whole-run trajectory",
    scopeCallerError: "Caller boundary error",
    scopeCallerHandledError: "Handled by caller",
    scopeCallerHandledHint: "The caller handled this error; this does not make the child call successful.",
    hierarchyDeclared: "Declared only",
    hierarchyObserved: "Recorded scope",
    hierarchyMembers: "{count} steps · {children} child scopes",
    hierarchyNoChildren: "No further child scopes. The steps below belong to this scope.",
    hierarchyPages: "Call directory pages",
    hierarchyStepScope: "This step belongs to",
    viewAgentTrajectory: "View trajectory",
    agentScopeUnconfirmed: "Invocation unconfirmed",
    hierarchyLocalValue: "These are this step's values, not necessarily the whole run's final output.",
    localFailureRunSucceeded: "Local failure · overall run succeeded",
    unconfirmedAgentEvidence: "Agent evidence · invocation unconfirmed",
    unconfirmedScopeState: "Recorded · invocation unconfirmed",
    inspectionSearch: "Search names, IDs or status",
    inspectionScope: "Show",
    inspectionSteps: "Steps",
    inspectionIssues: "Problem steps",
    inspectionEvidence: "All evidence",
    inspectionUnassigned: "Unassigned evidence",
    inspectionNextIssue: "Next error / interruption",
    inspectionHint: "Search covers labels and metadata, not full payload bodies. Unassigned does not mean invalid.",
    inspectionPages: "Search pages",
    inspectionPrevious: "Previous",
    inspectionNext: "Next",
    inspectionCount: "{start}–{end} / {total}",
    runDuration: "Execution time",
    timingBoundaries: "Recorded start and end (UTC)",
    timingStart: "Started",
    timingEnd: "Finished",
    timingMissing: "Not recorded",
    timingInvalid: "Timestamp conflict",
    inspectionMore: "Show next 50 fields",
    largeRecordTitle: "Large saved run · start with the index",
    largeRecordHint: "All {count} steps are available in the paged index. Drawing the complete path may take several seconds; no evidence has been removed.",
    largeRecordDraw: "Draw complete view",
    overviewLimited: "Showing the first 100 steps here. Use Find steps and evidence to inspect every step.",
    pageTitle: "Eino Viewer · See one Eino run",
    pageDescription: "Open one Eino Run Record and see its observed path from input to output or failure.",
    playgroundHome: "Eino Viewer home",
    brandSubtitle: "Visual viewer",
    projectLinks: "Project links",
    language: "Language",
    docs: "Docs",
    hero: "One Eino run. Made visible.",
    intro: "Recorder captures one real run. Viewer opens that record and shows only the observed path, result, and evidence you ask for.",
    workflowPlayground: "Eino run viewer",
    playgroundControls: "Run examples",
    input: "Open",
    workflowCase: "A captured run",
    objectType: "Example type",
    agentObject: "Agent",
    graphObject: "Graph",
    workflowObject: "Workflow",
    testMode: "Test mode",
    singleDomain: "Single domain",
    combinedScenario: "Combined scenario",
    domain: "Protocol domain",
    view: "View",
    viewAuto: "Automatic standard view",
    viewGeneric: "Generic envelope inspector",
    coverage: "Built-in + extension",
    supportedDomains: "Supported Eino domains",
    sample: "Sample",
    currentExample: "This run",
    openRecord: "Open saved record",
    localRecord: "Opened locally in this browser.",
    recordOpened: "Opened {name}",
    recordRejected: "Record not opened. See the validation details.",
    agentRecordRejected: "This record could not be opened. Its format or contents are not supported.",
    importedRecord: "Your captured run",
    importedRecordNote: "The run source is detected from this record. All data stays in this tab.",
    restoreDraft: "Restore unapplied draft",
    showingAcceptedRecord: "Showing the opened record. Your unapplied draft is saved.",
    recordWarnings: "Opened with {count} recording notice(s)",
    runCancelled: "Run cancelled",
    runCompletionUnknown: "Completion not recorded",
    runCapturePartial: "Run ended · capture incomplete",
    exampleAgentWeather: "Multi-city trip Agent",
    exampleAgentNested: "Parent–child Agents",
    exampleAgentWeatherNote: "A production-shaped Eino ADK run: three model turns, two weather lookups, one air-quality lookup, and one portable Run Record.",
    exampleAgentFailure: "Trip Agent with late failure",
    exampleAgentFailureNote: "Both weather calls succeed, then air quality fails. Earlier results stay visible and no assistant output is invented.",
    exampleAgentIncomplete: "Incomplete Agent run",
    exampleAgentIncompleteNote: "Capture stopped after the user input. Viewer shows the run as incomplete and leaves the output absent.",
    exampleGraphStructured: "Route planning Graph",
    exampleGraphMultistep: "Multi-round route revision",
    exampleGraphMultistepFailed: "Second-round evaluation failure",
    exampleWorkflowParallel: "Parallel order total",
    exampleWorkflowParallelFailed: "Inventory lookup failure",
    exampleGraphStructuredNote: "A real invoked Graph with recorded root input and structured final output. Every displayed value comes from the Recorder.",
    exampleGraphLoop: "Cyclic Graph run",
    exampleGraphLoopNote: "A real Pregel Graph run. The declared self-loop is preserved while two observed visits remain separate steps.",
    exampleWorkflowComplete: "Trip summary Workflow",
    exampleWorkflowCompleteNote: "A real compiled Workflow with recorded root input, node input/output, and final root output.",
    exampleWorkflowWeather: "Weather Workflow",
    exampleWorkflowWeatherNote: "A compiled and invoked Eino Workflow captured as one portable run record.",
    scenario: "Scenario",
    scenarioSupportMatrix: "Complete support matrix",
    scenarioSupportMatrixNote: "All nine built-in domains share one run and retain their own deterministic view.",
    scenarioWeatherWorkflow: "Real Agent run → Execution DAG",
    scenarioWeatherWorkflowNote: "Twenty records from a three-turn Eino ADK run are correlated by runId and toolCallId. The canvas shows only user input, three actual tool calls, and assistant output.",
    scenarioWeatherAgent: "Weather Agent · protocol evidence",
    scenarioWeatherAgentNote: "The same eleven source envelopes before causal correlation, captured automatically from Eino ADK Runner.",
    scenarioRealExecution: "REAL EINO ADK EXECUTION",
    userInput: "User input",
    assistantOutput: "Assistant output",
    scenarioQuestion: "User input",
    scenarioAnswer: "schema.message · assistant",
    scenarioWeatherQuestion: "Compare Singapore and Tokyo for outdoor plans, including air quality.",
    scenarioWeatherAnswer: "Choose Tokyo: clear, 24°C, 10% rain, and good air quality (AQI 42).",
    weatherStepQuestion: "User input",
    weatherStepToolContract: "schema.tool · get_weather",
    weatherStepModelContext: "component.io · ChatModel · input",
    weatherStepToolDecision: "agent.event · weather-agent · assistant",
    weatherStepToolInput: "component.io · get_weather · input",
    weatherStepToolOutput: "component.io · get_weather · output",
    weatherStepToolObservation: "agent.event · weather-agent · tool",
    weatherStepModelWithResult: "component.io · ChatModel · input",
    weatherStepFinalAgent: "agent.event · weather-agent · assistant",
    weatherStepFinalMessage: "schema.message · assistant",
    scenarioMultiRun: "Interleaved runs",
    scenarioMultiRunNote: "Two runs arrive out of order without losing input order or correlation identity.",
    scenarioPartialFailure: "Partial failure containment",
    scenarioPartialFailureNote: "One invalid message rejects the collection and preserves the last valid rendered scenario.",
    scenarioDomains: "domains",
    scenarioRuns: "runs",
    expectedFailure: "EXPECTED FAILURE",
    viewSettings: "View settings",
    geometry: "Geometry",
    layoutDirection: "Layout direction",
    right: "Right",
    down: "Down",
    left: "Left",
    up: "Up",
    appearance: "Appearance",
    rendererTheme: "Renderer theme",
    themeClassic: "Classic",
    themeInk: "Ink",
    themeMidnight: "Midnight",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    fitCanvas: "Fit canvas",
    runView: "Run view",
    pathView: "Path",
    trajectoryView: "Trajectory",
    trajectoryTurn: "Turn {turn}",
    trajectoryUngrouped: "Before model turn",
    trajectoryUser: "User",
    trajectoryAssistant: "Assistant",
    trajectoryTool: "Tool",
    trajectoryError: "Error",
    trajectorySuccess: "Success",
    trajectoryRunning: "Running",
    trajectoryFailed: "Failed",
    trajectoryIncomplete: "Incomplete",
    trajectoryCancelled: "Cancelled",
    trajectorySkipped: "Skipped",
    stepPlanned: "Planned · execution not observed",
    stepInterrupted: "Interrupted",
    stepUnrecorded: "Result not recorded",
    interruptionReason: "Interruption reason",
    trajectoryRecords: "records",
    trajectoryTurns: "turns",
    trajectoryEvidence: "evidence",
    rainChance: "{value}% rain",
    renderedWorkflow: "Rendered Eino information",
    loadingRenderer: "Loading renderer",
    selectedNode: "Selected step",
    selectNodePrompt: "Select a step",
    layouts: "layouts",
    patches: "patches",
    cacheHits: "cache hits",
    items: "items",
    renders: "renders",
    viewMetric: "view",
    snapshotEditor: "Eino envelope editor",
    inspectorView: "Inspector view",
    inspectorSection: "Evidence",
    inspectorTitle: "Run details",
    graphConnectionDetails: "Connection details",
    graphConnection: "Flow connection",
    graphBranch: "Conditional branch",
    graphDefinition: "Flow definition",
    nodeDetails: "Key information",
    explainedNodes: "Source highlights",
    rawRecords: "Raw records",
    noNodeSelected: "No node selected",
    noNodeSelectedHint: "Choose a node in the DAG to inspect its execution evidence.",
    nodeIdentity: "Identity",
    nodeRelationships: "Relationships",
    nodeEvidence: "Source evidence",
    nodeMetadata: "Metadata",
    nodeKind: "Kind",
    nodeComponent: "Component",
    nodeDuration: "Duration",
    nodeCorrelation: "Correlation",
    nodeNoRelationships: "No observed incoming or outgoing relationships.",
    nodeNoEvidence: "This compatibility node has no source envelope evidence.",
    openRawRecord: "Locate raw record",
    explanationOverview: "Key information",
    whatHappened: "Steps",
    nodeInput: "Input",
    nodeOutput: "Output",
    explanationLimits: "What is not known",
    explanationEvidence: "What proves this",
    observedSpan: "Observed span",
    declaredDuration: "Declared duration",
    explanationBasis: "Basis",
    explanationObserved: "Observed",
    explanationDeclared: "Declared",
    inspectExplanationNode: "Inspect source information",
    technicalDetails: "Technical details",
    additionalRecordedValues: "Other recorded values ({count})",
    observedTime: "Recorded at",
    firstObserved: "First observed",
    lastObserved: "Last observed",
    notRecorded: "Not recorded",
    userMessage: "User",
    assistantMessage: "Assistant",
    systemMessage: "System",
    toolMessage: "Tool message",
    toolCall: "Tool call",
    toolResult: "Tool result",
    agentOutput: "Agent output",
    errorOutput: "Error",
    componentInput: "Component input",
    componentOutput: "Component output",
    sourceRecord: "Source record",
    workflowNode: "Workflow node",
    graphNode: "Graph node",
    toolDefinition: "Tool definition",
    protocol: "Protocol",
    format: "Format",
    snapshotJson: "Eino protocol JSON",
    applyHint: "⌘ / Ctrl + Enter to apply",
    waitingRenderer: "Waiting for the renderer.",
    validationIssues: "Validation issues",
    copyJson: "Copy JSON",
    copied: "Copied",
    applySnapshot: "Apply document",
    footerProduct: "Apache-2.0 · Read-only Eino viewer",
    footerPrivacy: "Source data stays in this tab.",
    validSnapshot: "Valid schema-v1 snapshot · rendered locally",
    moreIssues: "{count} more issues",
    protocolIssues: "{count} protocol {noun} · canvas unchanged",
    issue: "issue",
    issues: "issues",
    rendererError: "Renderer error",
    invalidJson: "Invalid JSON",
    fixSyntax: "Fix syntax to render",
    snapshotRejected: "Snapshot rejected",
    snapshotRendered: "Snapshot rendered",
    renderSummary: "{nodes} nodes · {edges} edges · {outcomes} outcomes",
    runSucceeded: "Run succeeded",
    runFailed: "Run failed",
    runIncomplete: "Run incomplete",
    runSummary: "{steps} visible steps",
    runResultTitle: "Run result",
    runInputTitle: "Input",
    runOutputTitle: "Final result",
    runAgentOutputTitle: "Final answer",
    runGraphOutputTitle: "Graph output",
    runWorkflowOutputTitle: "Workflow output",
    runExecutionTitle: "Execution",
    runCaptureTitle: "Capture",
    runMissingValue: "Not recorded",
    runEmptyValue: "Empty string",
    runNullValue: "Recorded null",
    runRedactedValue: "Redacted",
    runTruncatedValue: "Source truncated",
    runRecoveredIssue: "Recovered step error",
    runStepIssue: "Step error",
    runResultIssue: "Run error",
    runInterruptionIssue: "Interruption",
    runExpandValue: "Show full content",
    runFoldedValue: "Preview folded; the record is unchanged.",
    runCopyValue: "Copy value",
    runCopyFailed: "Copy unavailable; select the value to copy.",
    runResultEvidence: "Source record {index}",
    runOmittedSize: "Size limit exceeded",
    runOmittedUnsafe: "Unsupported value type",
    runOmittedStream: "Stream not captured",
    runSources: "Sources · {count}",
    runInformation: "Run information",
    editCopy: "Edit copy",
    runIssues: "Errors / interruptions · {count}",
    recordDiagnostics: "Recording diagnostics",
    sourceRecords: "{count} source records",
    jsonFormatted: "JSON formatted · apply to validate",
    selectAndCopy: "Select and copy the highlighted JSON",
    rendererUnavailable: "Renderer unavailable",
    checkDistribution: "Check the built distribution files",
    validEnvelope: "Valid {kind} · {view}",
    envelopeRendered: "Envelope rendered",
    collectionRendered: "Collection rendered",
    projectionSummary: "{count} projection(s) · {kind}",
    fixtureLoadFailed: "Fixture catalog unavailable",
    customFixture: "Custom envelope fallback",
  },
  zh: {
    readingDirectory: "调用与步骤",
    unappliedDraft: "未应用草稿",
    examplesLoading: "示例加载中…", examplesUnavailable: "示例暂不可用",
    exploreRuns: "查看 Eino 执行结果", openTrajectory: "查看轨迹", openPath: "查看路径", connectEino: "接入自己的 Eino 应用",
    previewQuestion: "提问", previewCities: "新加坡，还是东京？", previewWeather: "天气查询",
    previewSingaporeWeather: "新加坡 · 雷阵雨", previewTokyoWeather: "东京 · 晴，24°C",
    previewAir: "空气质量", previewTokyoAir: "东京 · AQI 42", previewRecommendation: "结果", previewTokyoResult: "建议前往东京",
    previewPrepareRoute: "准备路线", previewEvaluateRoute: "评估路线", previewReviseRoute: "修订路线", previewFinishRoute: "完成",
    previewPrepareOrder: "准备", previewOrder: "订单", previewShipping: "运费报价", previewInventory: "库存小计", previewMergeCharges: "费用", previewCharges: "汇总",
    pasteRecord: "粘贴记录", examples: "更多示例", chooseSample: "选择一个示例…", clearSearch: "清除查询", noSearchResults: "没有匹配的步骤", locateIssue: "查看异常步骤", changeRecord: "更换记录",
    openDetails: "步骤详情",
    pathControls: "路径显示控制",
    zoomIn: "放大",
    zoomOut: "缩小",
    inspectionTitle: "查找步骤与证据",
    agentInspectionTitle: "查找步骤",
    graphInspectionTitle: "步骤",
    graphVisit: "执行记录",
    graphFlow: "流程",
    graphCallsView: "调用关系",
    graphCalls: "执行 {count} 次",
    graphFailedCalls: "{count} 次失败",
    agentInspectionSearch: "搜索名称或状态",
    agentUnconfirmedRecord: "Agent 记录",
    hierarchyScope: "调用范围",
    hierarchyAgent: "Agent 调用层级",
    hierarchyGraph: "Graph 调用层级",
    hierarchyWorkflow: "Workflow 编排层级",
    hierarchyAll: "全部步骤",
    hierarchyUngrouped: "归属未确认",
    hierarchyUngroupedHint: "这些记录缺少明确的调用层级，不猜测归属，原始证据全部保留。",
    hierarchyContext: "{count} / {total} 步",
    scopeResultTitle: "当前调用", scopeTopLevel: "顶层范围", scopeInput: "调用输入", scopeOutput: "调用返回",
    scopeLocalHint: "本次调用的返回不是整次运行的最终输出。下级步骤的结果和错误分别保留。",
    scopeTopLevelHint: "此顶层范围与整次运行共享结果，不代表额外执行了一次。",
    scopeBackToResult: "整次结果", scopePath: "路径 · {count} 步", scopeDeclaredPath: "声明结构",
    scopeBoundary: "跨范围连接 · {incoming} 条进入 / {outgoing} 条离开",
    scopeNoSteps: "当前范围没有步骤", scopeNoStepsHint: "原始记录没有改变。可返回上级范围或全部步骤继续查看。",
    scopeTrajectoryHint: "轨迹展示整次运行，切换时将返回全部步骤。", scopeTrajectoryTab: "整次运行轨迹",
    scopeCallerError: "调用方记录的边界错误",
    scopeCallerHandledError: "调用方已处理",
    scopeCallerHandledHint: "调用方处理了此错误，不代表子调用内部成功。",
    hierarchyDeclared: "仅声明",
    hierarchyObserved: "已记录的调用范围",
    hierarchyMembers: "{count} 步 · {children} 个下级范围",
    hierarchyNoChildren: "没有更深的下级范围，下方可查看当前范围的步骤。",
    hierarchyPages: "调用目录分页",
    hierarchyStepScope: "当前步骤所属范围",
    viewAgentTrajectory: "查看轨迹",
    agentScopeUnconfirmed: "归属未确认",
    hierarchyLocalValue: "这里展示当前步骤的值，不等于整次运行的最终输出。",
    localFailureRunSucceeded: "局部失败，整体成功",
    unconfirmedAgentEvidence: "Agent 证据 · 未确认调用归属",
    unconfirmedScopeState: "已记录 · 调用归属未确认",
    inspectionSearch: "搜索名称、ID 或状态",
    inspectionScope: "查看范围",
    inspectionSteps: "执行步骤",
    inspectionIssues: "异常步骤",
    inspectionEvidence: "全部证据",
    inspectionUnassigned: "未归属证据",
    inspectionNextIssue: "下一个错误 / 中断",
    inspectionHint: "检索名称和元数据，不检索正文全文；未归属不代表记录无效。",
    inspectionPages: "检索分页",
    inspectionPrevious: "上一页",
    inspectionNext: "下一页",
    inspectionCount: "{start}–{end} / {total}",
    runDuration: "执行耗时",
    timingBoundaries: "记录的起止时间（UTC）",
    timingStart: "开始",
    timingEnd: "结束",
    timingMissing: "未记录",
    timingInvalid: "时间记录冲突",
    inspectionMore: "再显示 50 项",
    largeRecordTitle: "较长的运行记录 · 先从目录查看",
    largeRecordHint: "全部 {count} 个步骤均可在分页目录中查阅。绘制完整视图可能需要数秒，没有删除任何证据。",
    largeRecordDraw: "绘制完整视图",
    overviewLimited: "此处列出前 100 个步骤；可在“查找步骤与证据”中查看全部步骤。",
    pageTitle: "Eino Viewer · 看见一次 Eino 运行",
    pageDescription: "打开一份 Eino Run Record，看见从输入到输出或失败的真实运行路径。",
    playgroundHome: "Eino Viewer 首页",
    brandSubtitle: "可视化展示库",
    projectLinks: "项目链接",
    language: "语言",
    docs: "文档",
    hero: "看见一次 Eino 运行。",
    intro: "Recorder 采集一次真实运行，Viewer 直接打开这份记录；默认只展示实际路径、结果，以及你主动查看的证据。",
    workflowPlayground: "Eino 运行查看器",
    playgroundControls: "运行样例",
    input: "打开",
    workflowCase: "一份运行记录",
    objectType: "示例类型",
    agentObject: "Agent",
    graphObject: "Graph",
    workflowObject: "Workflow",
    testMode: "测试模式",
    singleDomain: "单协议域",
    combinedScenario: "组合场景",
    domain: "协议域",
    view: "视图",
    viewAuto: "自动标准视图",
    viewGeneric: "通用封装检查器",
    coverage: "内置域 + 扩展",
    supportedDomains: "已支持的 Eino 协议域",
    sample: "示例",
    currentExample: "这次运行",
    openRecord: "打开已有记录",
    localRecord: "数据仅在当前浏览器中打开。",
    recordOpened: "已打开 {name}",
    recordRejected: "记录未打开，请查看校验详情。",
    agentRecordRejected: "无法打开这份记录：记录格式或内容不符合要求。",
    importedRecord: "你采集的运行",
    importedRecordNote: "已从记录中识别运行来源，数据仅保留在当前页面。",
    restoreDraft: "恢复未应用的草稿",
    showingAcceptedRecord: "正在显示已打开的记录，未应用的草稿已保留。",
    recordWarnings: "已打开，有 {count} 条采集提示",
    runCancelled: "运行已取消",
    runCompletionUnknown: "未记录完成状态",
    runCapturePartial: "运行已结束 · 采集不完整",
    exampleAgentWeather: "多城市出行 Agent",
    exampleAgentNested: "父子 Agent 协作",
    exampleAgentWeatherNote: "接近真实应用的 Eino ADK 运行：三个模型回合、两次天气查询、一次空气质量查询，最终形成一份 Run Record。",
    exampleAgentFailure: "后期失败的出行 Agent",
    exampleAgentFailureNote: "两次天气查询成功后，空气质量查询失败；已成功的结果仍然可见，也不会虚构助手输出。",
    exampleAgentIncomplete: "未完成的 Agent 运行",
    exampleAgentIncompleteNote: "采集在用户输入后停止。Viewer 明确显示未完成，并保持输出为空。",
    exampleGraphStructured: "路线整理 Graph",
    exampleGraphMultistep: "多轮路线修订",
    exampleGraphMultistepFailed: "第二轮评估失败",
    exampleWorkflowParallel: "并行费用汇总",
    exampleWorkflowParallelFailed: "库存查询失败",
    exampleGraphStructuredNote: "真实执行的 Graph：完整记录根输入和结构化最终输出，展示值均来自 Recorder。",
    exampleGraphLoop: "循环 Graph 运行",
    exampleGraphLoopNote: "真实执行的 Pregel Graph：保留声明的自循环，并将两次实际进入分别展示。",
    exampleWorkflowComplete: "行程整理 Workflow",
    exampleWorkflowCompleteNote: "真实编译并执行的 Workflow，包含根输入、节点输入输出以及最终根输出。",
    exampleWorkflowWeather: "天气 Workflow",
    exampleWorkflowWeatherNote: "真实编译并执行的 Eino Workflow，由 Recorder 保存为一份可携带的运行记录。",
    scenario: "组合场景",
    scenarioSupportMatrix: "完整支持矩阵",
    scenarioSupportMatrixNote: "九个内置协议域共享同一次运行，并分别使用确定性的标准视图。",
    scenarioWeatherWorkflow: "真实 Agent 运行 → 执行 DAG",
    scenarioWeatherWorkflowNote: "按 runId 与 toolCallId 关联三个 Eino ADK 回合自动采集的二十条记录；画布只显示用户输入、三次真实工具调用和助手输出。",
    scenarioWeatherAgent: "天气 Agent · 协议证据",
    scenarioWeatherAgentNote: "AgentRecorder 从 Eino ADK Runner 自动采集、尚未进行因果关联的同一组十一条源协议记录。",
    scenarioRealExecution: "真实 EINO ADK 执行",
    userInput: "用户输入",
    assistantOutput: "助手输出",
    scenarioQuestion: "用户输入",
    scenarioAnswer: "schema.message · assistant",
    scenarioWeatherQuestion: "比较新加坡和东京今天的天气，选一个适合户外活动的城市，并确认空气质量。",
    scenarioWeatherAnswer: "建议东京：晴，24°C，降雨概率 10%，空气质量良好（AQI 42）。",
    weatherStepQuestion: "用户输入",
    weatherStepToolContract: "schema.tool · get_weather",
    weatherStepModelContext: "component.io · ChatModel · input",
    weatherStepToolDecision: "agent.event · weather-agent · assistant",
    weatherStepToolInput: "component.io · get_weather · input",
    weatherStepToolOutput: "component.io · get_weather · output",
    weatherStepToolObservation: "agent.event · weather-agent · tool",
    weatherStepModelWithResult: "component.io · ChatModel · input",
    weatherStepFinalAgent: "agent.event · weather-agent · assistant",
    weatherStepFinalMessage: "schema.message · assistant",
    scenarioMultiRun: "双运行交错",
    scenarioMultiRunNote: "两个运行交错到达，同时保持输入顺序与各自的关联身份。",
    scenarioPartialFailure: "局部失败隔离",
    scenarioPartialFailureNote: "一个无效消息使集合校验失败，同时保留上一次有效组合的渲染结果。",
    scenarioDomains: "协议域",
    scenarioRuns: "运行",
    expectedFailure: "预期失败",
    viewSettings: "显示设置",
    geometry: "几何布局",
    layoutDirection: "布局方向",
    right: "向右",
    down: "向下",
    left: "向左",
    up: "向上",
    appearance: "外观",
    rendererTheme: "渲染主题",
    themeClassic: "经典",
    themeInk: "墨色",
    themeMidnight: "午夜",
    expandAll: "全部展开",
    collapseAll: "全部收起",
    fitCanvas: "适应画布",
    runView: "运行视图",
    pathView: "路径",
    trajectoryView: "轨迹",
    trajectoryTurn: "第 {turn} 回合",
    trajectoryUngrouped: "模型回合之前",
    trajectoryUser: "用户",
    trajectoryAssistant: "助手",
    trajectoryTool: "工具",
    trajectoryError: "错误",
    trajectorySuccess: "成功",
    trajectoryRunning: "运行中",
    trajectoryFailed: "失败",
    trajectoryIncomplete: "未完成",
    trajectoryCancelled: "已取消",
    trajectorySkipped: "已跳过",
    stepPlanned: "仅计划 · 未观察到执行",
    stepInterrupted: "已中断",
    stepUnrecorded: "结果未记录",
    interruptionReason: "中断原因",
    trajectoryRecords: "记录",
    trajectoryTurns: "回合",
    trajectoryEvidence: "证据",
    rainChance: "降雨概率 {value}%",
    renderedWorkflow: "Eino 信息渲染结果",
    loadingRenderer: "正在加载渲染器",
    selectedNode: "当前步骤",
    selectNodePrompt: "选择步骤",
    layouts: "布局次数",
    patches: "数据更新",
    cacheHits: "缓存命中",
    items: "数据项",
    renders: "渲染次数",
    viewMetric: "视图",
    snapshotEditor: "Eino 封装编辑器",
    inspectorView: "检查器视图",
    inspectorSection: "证据",
    inspectorTitle: "运行详情",
    graphConnectionDetails: "连线详情",
    graphConnection: "流程连接",
    graphBranch: "条件分支",
    graphDefinition: "流程定义",
    nodeDetails: "关键信息",
    explainedNodes: "原始信息摘要",
    rawRecords: "原始运行记录",
    noNodeSelected: "尚未选择节点",
    noNodeSelectedHint: "点击 DAG 中的节点，查看对应的执行证据。",
    nodeIdentity: "节点身份",
    nodeRelationships: "上下游关系",
    nodeEvidence: "源记录证据",
    nodeMetadata: "元数据",
    nodeKind: "类型",
    nodeComponent: "组件",
    nodeDuration: "耗时",
    nodeCorrelation: "关联标识",
    nodeNoRelationships: "没有观察到上游或下游关系。",
    nodeNoEvidence: "这个兼容节点没有源信封证据。",
    openRawRecord: "定位原始记录",
    explanationOverview: "关键信息",
    whatHappened: "步骤",
    nodeInput: "输入",
    nodeOutput: "输出",
    explanationLimits: "哪些信息尚不确定",
    explanationEvidence: "这些结论有什么证据",
    observedSpan: "观测时间跨度",
    declaredDuration: "声明耗时",
    explanationBasis: "解释依据",
    explanationObserved: "运行观测",
    explanationDeclared: "拓扑声明",
    inspectExplanationNode: "查看原始信息",
    technicalDetails: "技术详情",
    additionalRecordedValues: "其他已记录值（{count}）",
    observedTime: "记录时间",
    firstObserved: "首次记录",
    lastObserved: "末次记录",
    notRecorded: "未记录",
    userMessage: "用户",
    assistantMessage: "助手",
    systemMessage: "系统",
    toolMessage: "工具消息",
    toolCall: "工具调用",
    toolResult: "工具结果",
    agentOutput: "Agent 输出",
    errorOutput: "错误",
    componentInput: "组件输入",
    componentOutput: "组件输出",
    sourceRecord: "原始记录",
    workflowNode: "Workflow 节点",
    graphNode: "Graph 节点",
    toolDefinition: "工具定义",
    protocol: "协议",
    format: "格式化",
    snapshotJson: "Eino 协议 JSON",
    applyHint: "⌘ / Ctrl + Enter 应用",
    waitingRenderer: "正在等待渲染器。",
    validationIssues: "校验问题",
    copyJson: "复制 JSON",
    copied: "已复制",
    applySnapshot: "应用文档",
    footerProduct: "Apache-2.0 · 只读 Eino 查看器",
    footerPrivacy: "源数据仅保留在当前标签页。",
    validSnapshot: "有效的 schema-v1 快照 · 已在本地渲染",
    moreIssues: "另有 {count} 个问题",
    protocolIssues: "{count} 个协议问题 · 画布未改变",
    issue: "问题",
    issues: "问题",
    rendererError: "渲染器错误",
    invalidJson: "JSON 无效",
    fixSyntax: "修正语法后即可渲染",
    snapshotRejected: "快照未通过校验",
    snapshotRendered: "快照已渲染",
    renderSummary: "{nodes} 个节点 · {edges} 条边 · {outcomes} 个执行结果",
    runSucceeded: "运行成功",
    runFailed: "运行失败",
    runIncomplete: "运行未完成",
    runSummary: "{steps} 个可见步骤",
    runResultTitle: "本次运行结果",
    runInputTitle: "输入",
    runOutputTitle: "最终结果",
    runAgentOutputTitle: "最终回答",
    runGraphOutputTitle: "Graph 输出",
    runWorkflowOutputTitle: "Workflow 输出",
    runExecutionTitle: "执行结果",
    runCaptureTitle: "采集完整度",
    runMissingValue: "未记录",
    runEmptyValue: "空字符串",
    runNullValue: "已记录 null",
    runRedactedValue: "已脱敏",
    runTruncatedValue: "源内容已截断",
    runRecoveredIssue: "已恢复的步骤错误",
    runStepIssue: "步骤错误",
    runResultIssue: "运行错误",
    runInterruptionIssue: "中断原因",
    runExpandValue: "展开全文",
    runFoldedValue: "仅折叠预览，原记录未改变。",
    runCopyValue: "复制内容",
    runCopyFailed: "无法自动复制，请选中内容复制。",
    runResultEvidence: "原始记录 {index}",
    runOmittedSize: "超出大小限制",
    runOmittedUnsafe: "不支持的值类型",
    runOmittedStream: "未采集流式内容",
    runSources: "来源 · {count}",
    runInformation: "运行信息",
    editCopy: "编辑副本",
    runIssues: "错误 / 中断 · {count}",
    recordDiagnostics: "采集诊断",
    sourceRecords: "{count} 条原始记录",
    jsonFormatted: "JSON 已格式化 · 应用后进行校验",
    selectAndCopy: "请复制已选中的 JSON",
    rendererUnavailable: "渲染器不可用",
    checkDistribution: "请检查构建后的发布文件",
    validEnvelope: "有效的 {kind} · {view}",
    envelopeRendered: "封装已渲染",
    collectionRendered: "集合已渲染",
    projectionSummary: "{count} 个投影 · {kind}",
    fixtureLoadFailed: "夹具目录不可用",
    customFixture: "自定义封装回退",
  },
};

const rendererLocales = {
  en: undefined,
  zh: {
    kinds: {
      start: "开始",
      end: "结束",
      io: "输入/输出",
      llm: "大模型",
      cpu: "代码",
      branch: "分支",
      merge: "合并",
      subgraph: "子图",
      graph: "工作流",
    },
    statuses: { success: "成功", failed: "失败", skipped: "已跳过" },
    tooltip: {
      status: "状态",
      duration: "耗时",
      error: "错误",
      tokenUsage: "Token 用量",
      metrics: "指标",
    },
    collapseSubgraphTitle: "收起子图",
  },
};

const ui = {
  opening: document.querySelector("#record-opening"),
  stage: document.querySelector(".canvas-stage"),
  readingSidebar: document.querySelector("#reading-sidebar"),
  agentRunMeta: document.querySelector("#agent-run-meta"),
  readerTools: document.querySelector(".reader-tools"),
  readerDetailActions: document.querySelector(".reader-detail-actions"),
  readingMain: document.querySelector("#reading-main"),
  globalSummary: document.querySelector("#global-summary"),
  globalSummaryTitle: document.querySelector("#global-summary-title"),
  clearSearch: document.querySelector("#clear-step-search"),
  sampleStatus: document.querySelector("#sample-status"),
  pasteRecord: document.querySelector("#paste-record"),
  recordKind: document.querySelector("#record-kind"),
  workbench: document.querySelector(".workbench"),
  inspector: document.querySelector("#inspector-panel"),
  inspectorTitle: document.querySelector("#editor-title"),
  openDetails: document.querySelector("#open-details"),
  openRaw: document.querySelector("#open-raw"),
  diagramTools: document.querySelector("#diagram-tools"),
  host: document.querySelector("#dag"),
  domainView: document.querySelector("#domain-view"),
  mode: document.querySelector("#test-mode"),
  domainField: document.querySelector("#domain-field"),
  domain: document.querySelector("#domain"),
  sample: document.querySelector("#sample"),
  sampleLabel: document.querySelector("#sample-label"),
  sampleTitle: document.querySelector("#sample-title"),
  sampleNote: document.querySelector("#sample-note"),
  view: document.querySelector("#view-select"),
  editor: document.querySelector("#snapshot-json"),
  editorWrap: document.querySelector("#raw-records"),
  nodeDetail: document.querySelector("#node-detail"),
  inspectorTabs: document.querySelector("#inspector-tabs"),
  nodeDetailTab: document.querySelector("#node-detail-tab"),
  rawRecordsTab: document.querySelector("#raw-records-tab"),
  apply: document.querySelector("#apply-json"),
  format: document.querySelector("#format-json"),
  copy: document.querySelector("#copy-json"),
  edit: document.querySelector("#edit-json"),
  editorActions: document.querySelector(".editor-actions"),
  issues: document.querySelector("#issue-list"),
  validation: document.querySelector("#validation-result"),
  statusLight: document.querySelector("#status-light"),
  renderStatus: document.querySelector("#render-status"),
  renderSummary: document.querySelector("#render-summary"),
  runResultSummary: document.querySelector("#run-result-summary"),
  scopeResultSummary: document.querySelector("#scope-result-summary"),
  inspection: document.querySelector("#run-inspection"),
  inspectionSearch: document.querySelector("#inspection-search"),
  inspectionScope: document.querySelector("#inspection-scope"),
  inspectionResults: document.querySelector("#inspection-results"),
  inspectionCount: document.querySelector("#inspection-count"),
  inspectionPrevious: document.querySelector("#inspection-previous"),
  inspectionNext: document.querySelector("#inspection-next"),
  inspectionNextIssue: document.querySelector("#inspection-next-issue"),
  hierarchy: document.querySelector("#inspection-hierarchy"),
  hierarchyBreadcrumbs: document.querySelector("#hierarchy-breadcrumbs"),
  hierarchyContext: document.querySelector("#hierarchy-context"),
  hierarchyDirectory: document.querySelector("#hierarchy-directory"),
  hierarchyTitle: document.querySelector("#hierarchy-title"),
  hierarchyGroups: document.querySelector("#hierarchy-groups"),
  hierarchyPagination: document.querySelector("#hierarchy-pagination"),
  hierarchyPrevious: document.querySelector("#hierarchy-previous"),
  hierarchyNext: document.querySelector("#hierarchy-next"),
  hierarchyCount: document.querySelector("#hierarchy-count"),
  hierarchyUngrouped: document.querySelector("#hierarchy-ungrouped"),
  selectedPath: document.querySelector("#selected-path"),
  layouts: document.querySelector("#metric-layouts"),
  patches: document.querySelector("#metric-patches"),
  cache: document.querySelector("#metric-cache"),
  themes: document.querySelector("#theme-controls"),
  workflowControls: document.querySelector("#workflow-controls"),
  matrix: document.querySelector("#domain-matrix"),
  signalProtocol: document.querySelector("#signal-protocol"),
  signalKind: document.querySelector("#signal-kind"),
  signalCorrelation: document.querySelector("#signal-correlation"),
  runViewTabs: document.querySelector("#run-view-tabs"),
  importStatus: document.querySelector("#import-status"),
  restoreDraft: document.querySelector("#restore-draft"),
};
const inspectionOptions = [...ui.inspectionScope.options];
const readingSlot = document.createComment("record reading surface");
ui.stage.before(readingSlot);
const agentHost = document.createElement("section");
agentHost.className = "agent-reader-host";
agentHost.dataset.agentReaderHost = "";
let agentReader;

// Mount the three reading regions once; subsequent renders only replace content.
ui.globalSummary.append(ui.runResultSummary);
ui.readingSidebar.append(ui.hierarchy, ui.inspection);
ui.readingMain.append(document.querySelector(".reader-tools"), ui.scopeResultSummary,
  document.querySelector(".canvas-host"), document.querySelector(".canvas-footer"));
ui.stage.append(ui.inspector);
ui.readingSidebar.append(ui.workflowControls);
ui.pathRegion = document.createElement("details");
ui.pathRegion.id = "path-region";
ui.pathRegion.open = true;
const pathHeading = document.createElement("summary");
pathHeading.dataset.i18n = "pathView";
pathHeading.textContent = "Path";
const pathCanvas = document.querySelector(".canvas-host");
pathCanvas.before(ui.pathRegion);
ui.pathRegion.append(pathHeading, pathCanvas);
// Graph has a fixed reading panel. Keep Workflow's existing disclosure and
// move the same canvas/controls between shells without duplicating listeners.
const workflowPathRegion = ui.pathRegion;
const graphPathRegion = document.createElement("section");
graphPathRegion.id = "path-region";
graphPathRegion.setAttribute("aria-labelledby", "graph-path-title");
const graphPathHeader = document.createElement("header");
graphPathHeader.className = "graph-path-header";
const graphPathTitle = document.createElement("h2");
graphPathTitle.id = "graph-path-title";
graphPathHeader.append(graphPathTitle);
graphPathRegion.append(graphPathHeader);

let workflowAPI;
let einoAPI;
let viewRegistry;
let workflowInstance;
let graphViewerInstance;
let graphTopologyInstance;
let currentGraphTopology;
let currentSnapshot;
let currentDocument;
let currentDocumentText = "";
let currentDocumentJSON = "";
let savedDraftText;
let currentRecordName;
let currentFixture;
let openingRejectionDiagnostics;
let currentProjection;
let currentExecutionDAG;
let currentGraphReading;
let currentTrajectory;
let currentExplanation;
let currentInspection;
let currentReadingOrder = new Map();
let currentReadingRoles = new Map();
let currentScopeReading;
let currentSnapshotPrefix = [];
let inspectionOffset = 0;
let inspectionIssueOffset = 0;
let inspectionGroupId;
let inspectionUngrouped = false;
let hierarchyOffset = 0;
let largeVisualRequested = false;
let editorRangeCache;
let selectedNodeDetail;
let currentInvocationLabels = new Map();
let currentIdentityLabels = new Map();
let selectedRenderedNode;
let currentDomain = "workflow.snapshot";
let currentDirection = "RIGHT";
let currentTheme = "classic";
let currentLanguage = "en";
let selectedPathIsPrompt = true;
let workbenchReady = false;
let coreLoadFailed = false;
let catalogState = "idle";
let domainCatalog = {};
let scenarioCatalog = [];
let viewerCatalog = {};
let currentObjectKind = "agent";
let currentRunView = "path";
let selectedEvidenceIndexes = [];
let selectedExecutionNodeId;
let selectedTrajectoryRecordId;
let currentMode = "domain";
let renderState = { kind: "", titleKey: "loadingRenderer", summaryKey: null, params: {} };
let validationState = { kind: "neutral", key: "waitingRenderer", params: {} };
let visibleIssues = [];
let inspectorReturnFocus;
let inspectorReturnSelection;
let inspectorPresentationLocked = false;
const readingDisclosures = new Map();
let workflowMountFrame;
let workflowMountObserver;
let workflowRevealFrame;
let pathMountRevision = 0;
let valueFolds = createRenderedValueFoldObserver(ui.workbench);
window.addEventListener("pagehide", (event) => { if (!event.persisted) valueFolds.dispose(); });
const siteAssetRevision = "__EINO_VIEWER_ASSET_REVISION__";

function rememberDisclosures(root, prefix) {
  root.querySelectorAll("details").forEach((details, index) => {
    const key = `${prefix}:${index}`;
    if (readingDisclosures.has(key)) details.open = readingDisclosures.get(key);
    details.addEventListener("toggle", () => {
      if (details.isConnected) readingDisclosures.set(key, details.open);
    });
  });
}

const readingScrollRegions = [ui.readingSidebar, ui.readingMain, ui.domainView, ui.nodeDetail, ui.editor];

function translate(key, params = {}) {
  const sharedKey = { runResultTitle: "runResult", runOutputTitle: "finalResult", runAgentOutputTitle: "finalResult", runGraphOutputTitle: "finalResult", runWorkflowOutputTitle: "finalResult", nodeOutput: "stepOutput", scopeResultTitle: "callResult", scopeInput: "callInput", scopeOutput: "callOutput", hierarchyGraph: "graphCalls", hierarchyWorkflow: "workflowHierarchy", runDuration: "duration", rawRecords: "rawRecord" }[key];
  const template = (sharedKey && readingTerms(currentLanguage)[sharedKey]) || messages[currentLanguage][key] || messages.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function htmlElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function configuredBase(name, fallback) {
  const configured = document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || fallback;
  return new URL(configured, document.baseURI);
}

function versionedAssetURL(name, base) {
  const url = new URL(name, base);
  url.searchParams.set("v", siteAssetRevision);
  return url;
}

function loadWorkflowRenderer() {
  const base = configuredBase("eino-workflow-dag-asset-base", "./dist/");
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = versionedAssetURL("eino-workflow-dag.css", base).href;
  document.head.append(stylesheet);
  const stylesheetReady = new Promise((resolve, reject) => {
    stylesheet.addEventListener("load", resolve, { once: true });
    stylesheet.addEventListener("error", () => reject(new Error("Unable to load the workflow stylesheet.")), { once: true });
  });
  const scriptReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = versionedAssetURL("eino-workflow-dag.umd.js", base).href;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Unable to load the workflow renderer.")), { once: true });
    document.head.append(script);
  });
  return Promise.all([stylesheetReady, scriptReady]);
}

async function loadEinoAPI() {
  const base = configuredBase("eino-viewer-asset-base", "../dist/");
  return import(versionedAssetURL("eino-viewer.js", base).href);
}

async function fixture(name) {
  const base = configuredBase("eino-viewer-fixture-base", "../fixtures/");
  const response = await fetch(versionedAssetURL(name, base), { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${name}: ${response.status}`);
  return response.json();
}

function fixtureItem(id, label, document, note = "", expected = "valid", expectedCode = "") {
  return { id, label, document, note, expected, expectedCode };
}

async function loadFixtureCatalog() {
  const [composeGraph, cyclicGraph, cyclicGraphRun, callbacks, agents, schemas, components, weatherAgentScenario, realisticAgentRun, weatherAgentFailure, weatherAgentIncomplete, workflowSnapshot, weatherWorkflowRun, structuredGraphRun, completeWorkflowRun, loopSuccess, loopFailed, parallelSuccess, parallelFailed, nestedAgentRun] = await Promise.all([
    fixture("eino-compose-graph-envelope-v1.json"),
    fixture("eino-compose-cyclic-graph-envelope-v1.json"),
    fixture("eino-graph-recorder-cyclic-completed-v1.json"),
    fixture("eino-callback-events-v1.json"),
    fixture("eino-agent-events-v1.json"),
    fixture("eino-schema-domains-v1.json"),
    fixture("eino-component-io-v1.json"),
    fixture("eino-agent-recorder-weather-v1.json"),
    fixture("eino-agent-recorder-trip-planner-completed-v1.json"),
    fixture("eino-agent-recorder-trip-planner-failure-completed-v1.json"),
    fixture("eino-agent-recorder-incomplete-v1.json"),
    fixture("eino-workflow-v1.json"),
    fixture("eino-workflow-recorder-weather-completed-v1.json"),
    fixture("recorder-matrix/graph-io-structured.json"),
    fixture("recorder-matrix/workflow-io-success.json"),
    fixture("recorder-matrix/graph-multistep-loop-success.json"),
    fixture("recorder-matrix/graph-multistep-loop-failed.json"),
    fixture("recorder-matrix/workflow-parallel-join-success.json"),
    fixture("recorder-matrix/workflow-parallel-join-failed.json"),
    fixture("recorder-matrix/agent-nested-distinct-results.json"),
  ]);
  const byKind = (kind) => schemas.filter((entry) => entry.kind === kind);
  const componentItems = components.map((entry, index) => {
    const payload = entry.payload;
    const boundary = payload.streaming ? "stream boundary" : payload.direction;
    return fixtureItem(`component-${index}`, `${payload.component} · ${boundary}`, entry, payload.format);
  });
  const invalidFixture = (id, label, source, mutate, expectedCode) => {
    const documentValue = cloneJSON(source);
    mutate(documentValue);
    return fixtureItem(id, `INVALID · ${label}`, documentValue, `Expected diagnostic: ${expectedCode}`, "invalid", expectedCode);
  };
  const domains = {
    "workflow.snapshot": [
      fixtureItem("workflow-support", "Workflow · support assistant", workflowSnapshot, "Compiled and invoked Eino Workflow"),
      fixtureItem("workflow-envelope", "workflow.snapshot@1 · envelope", {
        protocol: "eino-dag",
        protocolVersion: 1,
        kind: "workflow.snapshot",
        kindVersion: 1,
        payload: cloneJSON(workflowSnapshot),
        source: { module: "eino-workflow-dag", format: "EinoWorkflowSnapshot" },
        correlation: { runId: "run-workflow-envelope" },
      }, "Lossless compatibility envelope around WorkflowSnapshot schema v1"),
      invalidFixture("workflow-invalid-kind", "unsupported node kind", workflowSnapshot, (documentValue) => {
        documentValue.workflow.nodes[0].kind = "unknown";
      }, "invalid_node_kind"),
    ],
    "compose.graph": [
      fixtureItem("compose-cyclic-graph", "GraphInfo · ReAct loop", cyclicGraph, "Pregel Graph · cycle preserved"),
      fixtureItem("compose-graph", "GraphInfo · nested graph", composeGraph, "Official compose.GraphInfo projection"),
      invalidFixture("compose-invalid-target", "edge target does not exist", composeGraph, (documentValue) => {
        documentValue.payload.edges[0].to = "missing";
      }, "compose.unknown_edge_target"),
    ],
    "callback.event": [
      fixtureItem("callback-run", "Run lifecycle · 4 events", callbacks, "start / end / streaming / error"),
      invalidFixture("callback-invalid-phase", "unsupported lifecycle phase", callbacks[0], (documentValue) => {
        documentValue.payload.phase = "paused";
      }, "callback.invalid_phase"),
    ],
    "agent.event": [
      fixtureItem("agent-run", "Agent run · message / action / error", agents, "ADK execution event collection"),
      invalidFixture("agent-invalid-name", "empty agent name", agents[0], (documentValue) => {
        documentValue.payload.agentName = "";
      }, "agent.invalid_agent_name"),
    ],
    "schema.message": [
      fixtureItem("message-tool-call", "Message · assistant tool call", byKind("schema.message")[0]),
      invalidFixture("message-invalid-role", "non-string message role", byKind("schema.message")[0], (documentValue) => {
        documentValue.payload.role = 7;
      }, "schema_message.invalid_role"),
    ],
    "schema.agentic_message": [
      fixtureItem("agentic-message", "AgenticMessage · content blocks", byKind("schema.agentic_message")[0]),
      invalidFixture("agentic-invalid-blocks", "content_blocks is not an array", byKind("schema.agentic_message")[0], (documentValue) => {
        documentValue.payload.content_blocks = {};
      }, "schema_agentic_message.invalid_content_blocks"),
    ],
    "schema.tool": [
      fixtureItem("tool-info", "ToolInfo · weather", byKind("schema.tool")[0]),
      invalidFixture("tool-invalid-name", "missing tool name", byKind("schema.tool")[0], (documentValue) => {
        delete documentValue.payload.name;
      }, "schema_tool.invalid_name"),
    ],
    "schema.document": [
      fixtureItem("document", "Document · metadata", byKind("schema.document")[0]),
      invalidFixture("document-invalid-metadata", "metadata is not an object", byKind("schema.document")[0], (documentValue) => {
        documentValue.payload.meta_data = [];
      }, "schema_document.invalid_metadata"),
    ],
    "component.io": [
      ...componentItems,
      invalidFixture("component-invalid-missing-body", "non-stream input without body", components[0], (documentValue) => {
        delete documentValue.payload.body;
      }, "component_io.missing_body"),
      invalidFixture("component-invalid-stream-body", "live stream with body", components.at(-1), (documentValue) => {
        documentValue.payload.body = { consumed: true };
      }, "component_io.live_stream_body"),
      invalidFixture("component-invalid-direction", "unknown direction", components[0], (documentValue) => {
        documentValue.payload.direction = "sideways";
      }, "component_io.invalid_direction"),
    ],
    "custom.envelope": [fixtureItem("custom", "custom.telemetry@2 · generic fallback", {
      protocol: "eino-dag",
      protocolVersion: 1,
      kind: "custom.telemetry",
      kindVersion: 2,
      payload: { signal: "cache.warm", value: 0.94, tags: ["custom", "portable"] },
      source: { module: "example-extension", format: "CustomTelemetry" },
      correlation: { runId: "run-custom-1", entityId: "cache:semantic" },
      observedAtMs: 1789000000300,
    }, translate("customFixture")),
    invalidFixture("custom-invalid-envelope", "missing envelope payload", {
      protocol: "eino-dag",
      protocolVersion: 1,
      kind: "custom.telemetry",
      kindVersion: 2,
      payload: { value: true },
    }, (documentValue) => {
      delete documentValue.payload;
    }, "envelope.missing_payload")],
  };

  const withRun = (source, runId) => {
    const documentValue = cloneJSON(source);
    documentValue.correlation = { ...(documentValue.correlation || {}), runId };
    return documentValue;
  };
  const workflowEnvelope = domains["workflow.snapshot"].find((item) => item.id === "workflow-envelope").document;
  const completeKinds = [
    "workflow.snapshot",
    "compose.graph",
    "callback.event",
    "agent.event",
    "schema.message",
    "schema.agentic_message",
    "schema.tool",
    "schema.document",
    "component.io",
  ];
  const completeDocuments = [
    workflowEnvelope,
    composeGraph,
    callbacks[0],
    agents[0],
    byKind("schema.message")[0],
    byKind("schema.agentic_message")[0],
    byKind("schema.tool")[0],
    byKind("schema.document")[0],
    components[0],
  ].map((entry) => withRun(entry, "run-complete-1"));
  const interleavedKinds = [
    "callback.event",
    "agent.event",
    "schema.message",
    "schema.document",
    "component.io",
    "callback.event",
  ];
  const interleavedDocuments = [
    withRun(callbacks[0], "run-blue"),
    withRun(agents[0], "run-amber"),
    withRun(byKind("schema.message")[0], "run-blue"),
    withRun(byKind("schema.document")[0], "run-amber"),
    withRun(components[0], "run-blue"),
    withRun(callbacks[1], "run-amber"),
  ];
  const invalidMessage = cloneJSON(byKind("schema.message")[0]);
  invalidMessage.payload.role = 7;

  const scenarios = [
    {
      id: "agent-weather-workflow",
      labelKey: "scenarioWeatherWorkflow",
      noteKey: "scenarioWeatherWorkflowNote",
      document: realisticAgentRun,
      domains: realisticAgentRun.evidence.map((entry) => entry.kind),
      executionDAG: true,
      expected: "valid",
    },
    {
      id: "agent-weather-evidence",
      labelKey: "scenarioWeatherAgent",
      noteKey: "scenarioWeatherAgentNote",
      document: weatherAgentScenario,
      domains: weatherAgentScenario.evidence.map((entry) => entry.kind),
      steps: [
        "weatherStepQuestion",
        "weatherStepToolContract",
        "weatherStepModelContext",
        "weatherStepToolDecision",
        "weatherStepToolInput",
        "weatherStepToolOutput",
        "weatherStepToolObservation",
        "weatherStepModelWithResult",
        "weatherStepFinalAgent",
        "weatherStepFinalMessage",
      ],
      story: {
        kickerKey: "scenarioRealExecution",
        questionKey: "scenarioWeatherQuestion",
        answerKey: "scenarioWeatherAnswer",
      },
      expected: "valid",
    },
    {
      id: "complete-support-matrix",
      labelKey: "scenarioSupportMatrix",
      noteKey: "scenarioSupportMatrixNote",
      document: completeDocuments,
      domains: completeKinds,
      expected: "valid",
    },
    {
      id: "interleaved-runs",
      labelKey: "scenarioMultiRun",
      noteKey: "scenarioMultiRunNote",
      document: interleavedDocuments,
      domains: interleavedKinds,
      expected: "valid",
    },
    {
      id: "partial-failure",
      labelKey: "scenarioPartialFailure",
      noteKey: "scenarioPartialFailureNote",
      document: [
        withRun(callbacks[0], "run-partial-1"),
        withRun(invalidMessage, "run-partial-1"),
        withRun(byKind("schema.document")[0], "run-partial-1"),
      ],
      domains: ["callback.event", "schema.message", "schema.document"],
      expected: "invalid",
      expectedCode: "schema_message.invalid_role",
    },
  ];

  const viewer = {
    agent: [
      {
        ...scenarios[0],
        labelKey: "exampleAgentWeather",
        noteKey: "exampleAgentWeatherNote",
      },
      {
        id: "agent-nested-distinct-results",
        document: nestedAgentRun,
        domains: nestedAgentRun.evidence.map((entry) => entry.kind),
        executionDAG: true,
        expected: "valid",
        labelKey: "exampleAgentNested",
      },
      {
        id: "agent-weather-failure",
        document: weatherAgentFailure,
        domains: weatherAgentFailure.evidence.map((entry) => entry.kind),
        executionDAG: true,
        expected: "valid",
        labelKey: "exampleAgentFailure",
        noteKey: "exampleAgentFailureNote",
      },
      {
        id: "agent-incomplete",
        document: weatherAgentIncomplete,
        domains: weatherAgentIncomplete.evidence.map((entry) => entry.kind),
        executionDAG: true,
        expected: "valid",
        labelKey: "exampleAgentIncomplete",
        noteKey: "exampleAgentIncompleteNote",
      },
    ],
    graph: [{
      id: "graph-io-structured",
      document: structuredGraphRun,
      expected: "valid",
      labelKey: "exampleGraphStructured",
      noteKey: "exampleGraphStructuredNote",
    }, {
      id: "graph-multistep-loop-success",
      document: loopSuccess,
      expected: "valid",
      labelKey: "exampleGraphMultistep",
    }, {
      id: "graph-multistep-loop-failed",
      document: loopFailed,
      expected: "valid",
      labelKey: "exampleGraphMultistepFailed",
    }, {
      ...domains["compose.graph"][0],
      document: cyclicGraphRun,
      labelKey: "exampleGraphLoop",
      noteKey: "exampleGraphLoopNote",
    }],
    workflow: [{
      id: "workflow-io-success",
      document: completeWorkflowRun,
      expected: "valid",
      labelKey: "exampleWorkflowComplete",
      noteKey: "exampleWorkflowCompleteNote",
    }, {
      id: "workflow-parallel-join-success",
      document: parallelSuccess,
      expected: "valid",
      labelKey: "exampleWorkflowParallel",
    }, {
      id: "workflow-parallel-join-failed",
      document: parallelFailed,
      expected: "valid",
      labelKey: "exampleWorkflowParallelFailed",
    }, {
      id: "workflow-weather",
      document: weatherWorkflowRun,
      expected: "valid",
      labelKey: "exampleWorkflowWeather",
      noteKey: "exampleWorkflowWeatherNote",
    }],
  };
  return { domains, scenarios, viewer };
}

function preferredWorkbenchLanguage() {
  const queryLanguage = new URLSearchParams(window.location.search).get("lang");
  if (queryLanguage === "zh" || queryLanguage === "en") return queryLanguage;
  try {
    const stored = localStorage.getItem("eino-workflow-dag-playground-language");
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // Browser language remains a safe fallback.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function displayRenderState() {
  ui.statusLight.className = `status-light ${renderState.kind}`;
  ui.renderStatus.textContent = translate(renderState.titleKey, renderState.params);
  ui.renderSummary.textContent = renderState.summaryKey
    ? translate(renderState.summaryKey, renderState.params)
    : (renderState.summaryText ?? "—");
}

function displayValidationState() {
  ui.validation.className = `validation-result${validationState.kind === "neutral" ? "" : ` ${validationState.kind}`}`;
  ui.validation.textContent = translate(validationState.key, validationState.params);
}

function renderIssueList() {
  ui.issues.replaceChildren();
  for (const error of visibleIssues.slice(0, 8)) {
    const item = document.createElement("li");
    item.textContent = `${error.path || "root"} · ${error.code || "error"}: ${error.message}`;
    ui.issues.append(item);
  }
  if (visibleIssues.length > 8) {
    ui.issues.append(htmlElement("li", "", translate("moreIssues", { count: visibleIssues.length - 8 })));
  }
  ui.issues.classList.toggle("visible", visibleIssues.length > 0);
}

function showIssues(errors, valid = { key: "validSnapshot", params: {} }) {
  visibleIssues = errors || [];
  if (visibleIssues.length === 0) {
    validationState = { kind: "valid", key: valid.key, params: valid.params || {} };
  } else if (valid.accepted || visibleIssues.every((entry) => entry.severity === "warning")) {
    validationState = { kind: "warning", key: "recordWarnings", params: { count: visibleIssues.length } };
  } else {
    validationState = {
      kind: "invalid",
      key: "protocolIssues",
      params: { count: visibleIssues.length, noun: translate(visibleIssues.length === 1 ? "issue" : "issues") },
    };
  }
  displayValidationState();
  renderIssueList();
}

function setRenderState(kind, titleKey, summaryKey, params = {}, summaryText) {
  renderState = { kind, titleKey, summaryKey, params, summaryText };
  displayRenderState();
}

function currentFixtureDocument(item) {
  return cloneJSON(item.document);
}

function activeFixtureItems(kind = currentObjectKind) {
  return viewerCatalog[kind] || [];
}

function updateOpeningStatus() {
  const status = document.querySelector("#opening-example-status");
  const rejected = !currentDocument && openingRejectionDiagnostics;
  status.textContent = coreLoadFailed ? translate("rendererUnavailable") : rejected
    ? inputFailureSummary(openingRejectionDiagnostics, currentLanguage, false) || translate("agentRecordRejected")
    : ui.sampleStatus.textContent;
  status.hidden = !status.textContent;
}

function populateSamples({ preserve = false } = {}) {
  const previous = preserve ? currentFixture?.id || "" : "";
  const items = activeFixtureItems();
  ui.sample.hidden = false;
  ui.sampleLabel.hidden = false;
  ui.sample.replaceChildren();
  if (!currentFixture || !items.some(({ id }) => id === currentFixture.id)) {
    const placeholder = htmlElement("option", "", currentDocument
      ? currentRecordName || translate("importedRecord") : translate("chooseSample"));
    placeholder.value = "";
    placeholder.disabled = true;
    ui.sample.append(placeholder);
  }
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.dataset.expected = item.expected || "valid";
    option.dataset.expectedCode = item.expectedCode || "";
    option.textContent = item.labelKey ? translate(item.labelKey) : item.label;
    ui.sample.append(option);
  }
  if (preserve) ui.sample.value = previous;
  ui.sample.disabled = !workbenchReady || catalogState !== "ready";
  ui.sampleStatus.hidden = catalogState !== "loading" && catalogState !== "failed";
  ui.sampleStatus.textContent = catalogState === "loading" ? translate("examplesLoading")
    : catalogState === "failed" ? translate("examplesUnavailable") : "";
  updateOpeningStatus();
  for (const action of ui.opening.querySelectorAll("[data-open-example]")) {
    action.disabled = !workbenchReady || catalogState !== "ready";
  }
}

async function initializeFixtureCatalog() {
  catalogState = "loading";
  populateSamples({ preserve: true });
  try {
    const loadedCatalog = await loadFixtureCatalog();
    domainCatalog = loadedCatalog.domains;
    scenarioCatalog = loadedCatalog.scenarios;
    viewerCatalog = loadedCatalog.viewer;
    catalogState = "ready";
    renderDomainMatrix();
  } catch {
    // Optional examples never replace a record or alter its reading state.
    catalogState = "failed";
  }
  populateSamples({ preserve: true });
}

function renderDomainMatrix() {
  ui.matrix.replaceChildren();
  for (const domain of Object.keys(domainCatalog)) {
    const button = htmlElement("button", "coverage-chip", domain === "custom.envelope" ? "custom.*" : `${domain}@1`);
    button.type = "button";
    button.dataset.domainTarget = domain;
    button.setAttribute("aria-pressed", String(currentMode === "domain" && domain === currentDomain));
    button.addEventListener("click", () => {
      ui.domain.value = domain;
      changeDomain(domain);
    });
    ui.matrix.append(button);
  }
}

function selectedFixture(kind = currentObjectKind, id = ui.sample.value) {
  return activeFixtureItems(kind).find((entry) => entry.id === id);
}

function loadSelectedFixture({ fit = true, kind = currentObjectKind, id = ui.sample.value } = {}) {
  const item = selectedFixture(kind, id);
  if (!item) return;
  const documentValue = currentFixtureDocument(item);
  if (!applyDocument({ fit, text: JSON.stringify(documentValue, null, 2), fixtureItem: item, expectedKind: kind })) {
    populateSamples({ preserve: true });
  }
}

function changeDomain(domain) {
  currentDomain = Object.hasOwn(domainCatalog, domain) ? domain : "workflow.snapshot";
  currentMode = "domain";
  ui.domainField.hidden = false;
  selectPressed(ui.mode, "[data-mode]", "mode", currentMode);
  populateSamples();
  renderDomainMatrix();
  loadSelectedFixture();
}

function changeMode(mode) {
  const nextMode = mode === "scenario" ? "scenario" : "domain";
  if (nextMode === currentMode) return;
  currentMode = nextMode;
  ui.domainField.hidden = currentMode === "scenario";
  selectPressed(ui.mode, "[data-mode]", "mode", currentMode);
  populateSamples();
  renderDomainMatrix();
  loadSelectedFixture();
}

function updateRecordLabel() {
  ui.sampleTitle.closest(".example-summary").hidden = !currentDocument;
  ui.sampleTitle.textContent = currentFixture
    ? currentFixture.labelKey ? translate(currentFixture.labelKey) : currentFixture.label
    : currentRecordName || currentDocument?.runId || translate("importedRecord");
  ui.sampleNote.textContent = "";
  ui.recordKind.textContent = { agent: "Agent", graph: "Graph", workflow: "Workflow" }[currentObjectKind];
}

function applyLanguage(language, { persist = true, updateUrl = true } = {}) {
  cancelAnimationFrame(workflowRevealFrame);
  const graphViewport = captureViewerViewport(activePathRenderer());
  if (graphViewport) graphViewport.layout = captureViewerLayout(activePathRenderer());
  // Read our owned scroll containers at the moment of the language change.
  // Scroll events can arrive a frame later, especially after a keyboard jump.
  const positions = new Map(readingScrollRegions.map((region) => [region, { top: region.scrollTop, left: region.scrollLeft }]));
  positions.set(window, { top: window.scrollY, left: window.scrollX });
  const validationBefore = validationState;
  const issuesBefore = visibleIssues;
  const inspectorWasOpen = !ui.inspector.hidden;
  const inspectorPreviousPanel = ui.editorWrap.hidden ? "node" : "raw";
  currentLanguage = language === "zh" ? "zh" : "en";
  // Capture the Agent's reading position before translating the surrounding
  // shell: intermediate layout changes can otherwise shift its saved viewport.
  if (agentReader) setRunViewerLocale(agentReader, currentLanguage);
  document.querySelector(".identity").setAttribute("href", `./?lang=${currentLanguage}`);
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  document.title = translate("pageTitle");
  document.querySelector('meta[name="description"]').content = translate("pageDescription");
  // Graph/Workflow controls remain owned while detached on the Agent surface.
  // Translate them too, so switching record type never revives an old locale.
  const languageRoots = [document, ...[ui.stage, ui.readingSidebar, ui.globalSummary, ui.scopeResultSummary].filter((element) => !element.isConnected)];
  for (const root of languageRoots) {
    root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = translate(element.dataset.i18n); });
    root.querySelectorAll("[data-i18n-html]").forEach((element) => { element.innerHTML = translate(element.dataset.i18nHtml); });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel));
    });
  }
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === currentLanguage));
  });
  ui.inspectionSearch.placeholder = translate("inspectionSearch");
  populateSamples({ preserve: true });
  updateRecordLabel();
  if (coreLoadFailed) ui.importStatus.textContent = translate("rendererUnavailable");
  else if (ui.importStatus.dataset.error === "true") ui.importStatus.textContent = inputFailureSummary(issuesBefore, currentLanguage, Boolean(currentDocument))
    || translate(currentObjectKind !== "workflow" ? "agentRecordRejected" : "recordRejected");
  if (selectedPathIsPrompt) ui.selectedPath.textContent = translate("selectNodePrompt");
  displayRenderState();
  displayValidationState();
  renderIssueList();
  // Translation refreshes content, not the user's reading context. Suppress
  // intermediate reveals so a selected step cannot resize or scroll the page.
  inspectorPresentationLocked = true;
  try {
    workflowInstance?.setLocale(rendererLocales[currentLanguage]);
    if (currentDocument) renderCurrentDocument({ fit: false, graphViewport });
  } finally {
    inspectorPresentationLocked = false;
    if (!agentReader) {
      inspectorPanel(inspectorPreviousPanel, { reveal: false });
      setInspectorOpen(inspectorWasOpen);
    }
    validationState = validationBefore;
    visibleIssues = issuesBefore;
    displayValidationState();
    renderIssueList();
    for (const [region, position] of positions) region.scrollTo(position);
  }
  if (persist) {
    try { localStorage.setItem("eino-workflow-dag-playground-language", currentLanguage); } catch { /* local only */ }
  }
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", currentLanguage);
    history.replaceState(null, "", url);
  }
}

function graphCounts(graph) {
  let nodes = 0;
  let edges = graph.edges.length;
  for (const node of graph.nodes) {
    nodes += 1;
    if (node.workflow) {
      const nested = graphCounts(node.workflow);
      nodes += nested.nodes;
      edges += nested.edges;
    }
  }
  return { nodes, edges };
}

function subgraphPaths(graph, prefix = []) {
  const paths = [];
  for (const node of graph.nodes) {
    if (!node.workflow) continue;
    const path = [...prefix, node.id];
    paths.push(path, ...subgraphPaths(node.workflow, path));
  }
  return paths;
}

function clearNodePointerState() {
  const accessor = workflowInstance?.[Symbol.for("eino-workflow-dag.cytoscape")];
  const cy = typeof accessor === "function" ? accessor() : null;
  cy?.nodes(".hover, .press").removeClass("hover press");
}

function locateNodeInEditor(path) {
  const needle = `"id": ${JSON.stringify(path.at(-1))}`;
  const start = ui.editor.value.indexOf(needle);
  selectedPathIsPrompt = false;
  ui.selectedPath.textContent = path.join(" / ");
  if (start < 0) return;
  ui.editor.focus({ preventScroll: true });
  ui.editor.setSelectionRange(start, start + needle.length);
}

function rememberInspectorTrigger(trigger = document.activeElement) {
  if (!inspectorPresentationLocked && trigger instanceof Element && typeof trigger.focus === "function" && ![document.body, document.documentElement].includes(trigger) && !ui.inspector.contains(trigger)) {
    inspectorReturnFocus = trigger;
    inspectorReturnSelection = ["data-trajectory-record", "data-inspection-node", "data-agent-outcome", "data-agent-capture", "data-graph-node", "data-graph-edge-control"]
      .map((attribute) => [attribute, inspectorReturnFocus.getAttribute(attribute)])
      .find(([, value]) => value !== null);
  }
}

function visibleReadingTrigger(element) {
  if (!element?.isConnected || [document.body, document.documentElement].includes(element)) return undefined;
  let target = element;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS" && !parent.open && !parent.querySelector(":scope > summary")?.contains(element)) {
      target = parent.querySelector(":scope > summary");
    }
  }
  return target?.getClientRects().length ? target : undefined;
}

function setInspectorOpen(open, { returnFocus = false } = {}) {
  if (inspectorPresentationLocked) return;
  if (open && ui.inspector.hidden) rememberInspectorTrigger();
  ui.inspector.hidden = !open;
  if (!currentDocument) ui.stage.hidden = !open;
  ui.workbench.classList.toggle("has-inspector", open);
  ui.openDetails.setAttribute("aria-expanded", String(open && !ui.nodeDetail.hidden));
  ui.openRaw.setAttribute("aria-expanded", String(open && !ui.editorWrap.hidden));
  if (!open && returnFocus) {
    const restoredTrigger = inspectorReturnSelection && ui.workbench.querySelector(
      `[${inspectorReturnSelection[0]}="${CSS.escape(inspectorReturnSelection[1])}"]`);
    const target = visibleReadingTrigger(inspectorReturnFocus) || visibleReadingTrigger(restoredTrigger)
      || (inspectorReturnSelection?.[0] === "data-inspection-node" && !ui.readingSidebar.open
        ? visibleReadingTrigger(ui.readingSidebar.querySelector(":scope > summary")) : undefined)
      || visibleReadingTrigger(ui.openDetails) || visibleReadingTrigger(ui.sample);
    target?.focus();
  }
}

function inspectorPanel(panel, { focus = false, reveal = true } = {}) {
  if (inspectorPresentationLocked) return;
  const readingOnly = currentObjectKind !== "workflow";
  // Agent and Graph read saved values; only Workflow retains the raw editor.
  if (readingOnly) panel = "node";
  const showNode = panel === "node";
  ui.inspectorTabs.hidden = readingOnly;
  const titleKey = currentObjectKind === "graph" && selectedNodeDetail?.graphEdgeId ? "graphConnectionDetails" : "inspectorTitle";
  const title = ui.inspectorTitle;
  title.dataset.i18n = titleKey;
  title.textContent = translate(titleKey);
  title.tabIndex = -1;
  ui.inspector.dataset.i18nAriaLabel = readingOnly ? titleKey : "snapshotEditor";
  ui.inspector.setAttribute("aria-label", translate(ui.inspector.dataset.i18nAriaLabel));
  ui.editor.dataset.i18nAriaLabel = readingOnly ? "pasteRecord" : "snapshotJson";
  ui.editor.setAttribute("aria-label", translate(ui.editor.dataset.i18nAriaLabel));
  for (const [region, tab] of [[ui.nodeDetail, ui.nodeDetailTab], [ui.editorWrap, ui.rawRecordsTab]]) {
    region.setAttribute("role", readingOnly ? "region" : "tabpanel");
    region.setAttribute("aria-labelledby", readingOnly ? title.id : tab.id);
  }
  ui.nodeDetail.hidden = !showNode;
  ui.editorWrap.hidden = showNode;
  ui.format.hidden = showNode || ui.editor.readOnly;
  ui.apply.hidden = ui.editor.readOnly;
  ui.edit.hidden = readingOnly || !ui.editor.readOnly;
  ui.validation.hidden = showNode;
  ui.issues.hidden = showNode;
  ui.editorActions.hidden = showNode;
  for (const tab of [ui.nodeDetailTab, ui.rawRecordsTab]) {
    const selected = tab.dataset.inspectorPanel === panel;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  if (reveal) {
    setInspectorOpen(true);
    if (ui.workbench.clientWidth < 1200) requestAnimationFrame(() => {
      if (!ui.inspector.hidden) ui.inspector.scrollIntoView({ block: "start" });
    });
  }
  ui.openDetails.setAttribute("aria-expanded", String(!ui.inspector.hidden && showNode));
  ui.openRaw.setAttribute("aria-expanded", String(!ui.inspector.hidden && !showNode));
  if (focus) (readingOnly ? title : (showNode ? ui.nodeDetailTab : ui.rawRecordsTab)).focus();
}

function openRawInspector() {
  if (currentObjectKind !== "workflow") return;
  // Reopening a collapsed Raw panel must not replace an unapplied draft.
  if (!ui.editorWrap.hidden) {
    inspectorPanel("raw");
    return;
  }
  if (selectedNodeDetail?.evidence?.length) {
    locateEnvelopeInEditor(selectedNodeDetail.evidence[0].envelopeIndex);
  } else {
    inspectorPanel("raw");
    if (selectedRenderedNode) locateNodeInEditor(selectedRenderedNode.path);
  }
}

function emptyNodeDetail() {
  const empty = htmlElement("div", "node-detail-empty");
  const mark = htmlElement("span", "", "◇");
  mark.setAttribute("aria-hidden", "true");
  empty.append(
    mark,
    htmlElement("strong", "", translate("noNodeSelected")),
  );
  ui.nodeDetail.replaceChildren(empty);
}

function clearNodeDetail({ showRaw = false, preservePanel = false } = {}) {
  selectedNodeDetail = undefined;
  selectedRenderedNode = undefined;
  emptyNodeDetail();
  if (!preservePanel) inspectorPanel(showRaw ? "raw" : "node", { reveal: false });
}

function evidenceIndexes(evidence) {
  return [...new Set((evidence || [])
    .map((entry) => Number.isSafeInteger(entry) ? entry : entry?.envelopeIndex)
    .filter(Number.isSafeInteger))].sort((left, right) => left - right);
}

function intersectsEvidence(evidence, indexes = selectedEvidenceIndexes) {
  if (!indexes.length) return false;
  const selected = new Set(indexes);
  return evidenceIndexes(evidence).some((index) => selected.has(index));
}

function executionNodesForEvidence(indexes = selectedEvidenceIndexes) {
  return (currentExecutionDAG?.nodes || []).filter((node) => intersectsEvidence(node.evidence, indexes));
}

function clearLinkedSelection() {
  selectedEvidenceIndexes = [];
  selectedExecutionNodeId = undefined;
  selectedTrajectoryRecordId = undefined;
  delete ui.editor.dataset.selectedEnvelopeIndex;
  updateTrajectorySelectionState();
}

function selectLinkedEvidence(evidence, { executionNodeId, trajectoryRecordId } = {}) {
  selectedEvidenceIndexes = evidenceIndexes(evidence);
  selectedTrajectoryRecordId = trajectoryRecordId;
  if (executionNodeId) {
    selectedExecutionNodeId = executionNodeId;
  } else {
    const matches = executionNodesForEvidence(selectedEvidenceIndexes);
    selectedExecutionNodeId = matches.length === 1 ? matches[0].id : undefined;
  }
  updateTrajectorySelectionState();
}

function refreshExecutionSelection() {
  if (!selectedEvidenceIndexes.length) {
    selectedExecutionNodeId = undefined;
    return;
  }
  const matches = executionNodesForEvidence();
  if (!matches.some(({ id }) => id === selectedExecutionNodeId)) {
    selectedExecutionNodeId = matches.length === 1 ? matches[0].id : undefined;
  }
}

function updateTrajectorySelectionState() {
  const records = new Map((currentTrajectory?.records || []).map((record) => [record.id, record]));
  ui.domainView.querySelectorAll("[data-trajectory-record]").forEach((button) => {
    const record = records.get(button.dataset.trajectoryRecord);
    const linked = Boolean(record && intersectsEvidence(record.evidence));
    const selected = button.dataset.trajectoryRecord === selectedTrajectoryRecordId;
    button.classList.toggle("linked", linked);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function restorePathSelection() {
  refreshExecutionSelection();
  const id = selectedExecutionNodeId || selectedNodeDetail?.explanationNode?.id;
  const node = currentInspection?.getNode(id);
  if (!node || !activePathRenderer() || (!currentSnapshot && !currentGraphTopology) || !currentScopeReading?.nodeIds.includes(id)) return;
  const executionNode = currentExecutionDAG?.nodes?.find((entry) => entry.id === id);
  const renderedNode = { id: executionNode?.id || node.path.at(-1), path: node.path,
    name: node.label, component: node.component, metadata: node.technical?.metadata || {}, status: node.status };
  activateReadingPath(node.id, node.path);
  renderExplanationNode(node, { renderedNode, executionNode, synchronize: false, activate: false });
  selectedPathIsPrompt = false;
  ui.selectedPath.textContent = selectedNodeDetail?.presentation?.title || renderedNode.name || renderedNode.id;
}

function appendNodeFact(parent, label, value) {
  const item = htmlElement("div", "");
  item.append(htmlElement("dt", "", label), htmlElement("dd", "", value ?? "—"));
  parent.append(item);
}

function nodeDuration(renderedNode, executionNode) {
  if (Number.isFinite(renderedNode.durationMs)) return `${renderedNode.durationMs} ms`;
  if (Number.isFinite(executionNode?.startedAtMs) && Number.isFinite(executionNode?.finishedAtMs)) {
    const elapsed = executionNode.finishedAtMs - executionNode.startedAtMs;
    return elapsed >= 0 ? `${elapsed} ms` : translate("timingInvalid");
  }
  return "—";
}

function workflowNodeContext(path) {
  let graph = currentSnapshot?.workflow;
  let node;
  const localPath = (path || []).slice(currentSnapshotPrefix.length);
  for (const [index, segment] of localPath.entries()) {
    node = graph?.nodes?.find((candidate) => candidate.id === segment);
    if (!node) return {};
    if (index < localPath.length - 1) graph = node.workflow;
  }
  return { graph, node };
}

function relationshipsForNode(renderedNode, executionNode) {
  if (executionNode && currentExecutionDAG) {
    return currentExecutionDAG.edges
      .filter((edge) => edge.from === executionNode.id || edge.to === executionNode.id)
      .map((edge) => ({
        direction: edge.to === executionNode.id ? "IN" : "OUT",
        kind: edge.kind,
        peer: edge.to === executionNode.id ? edge.from : edge.to,
        metadata: edge.metadata,
      }));
  }
  const { graph, node } = workflowNodeContext(renderedNode.path);
  if (!graph || !node) return [];
  return (graph.edges || [])
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => ({
      direction: edge.to === node.id ? "IN" : "OUT",
      kind: (edge.channels || []).join(" + ") || "control",
      peer: edge.to === node.id ? edge.from : edge.to,
      metadata: edge.metadata,
    }));
}

function sourceEnvelope(index) {
  if (Array.isArray(currentDocument?.evidence)) return currentDocument.evidence[index];
  if (Array.isArray(currentDocument)) return currentDocument[index];
  return index === 0 ? currentDocument : undefined;
}

function issueReadingValue(issue) {
  return recordedIssueValue(issue, sourceEnvelope, recordDiagnostics());
}

function stepIssueReadingValue(node, message) {
  const recorded = currentExplanation?.run?.issues.find((issue) => issue.nodeId === node.id && issue.message === message);
  return issueReadingValue(recorded || {
    kind: node.technical?.metadata?.executionState === "interrupted" ? "interruption" : "error",
    message, evidenceEnvelopeIndexes: (node.evidence || []).filter(({ role }) => role === "error").map(({ envelopeIndex }) => envelopeIndex),
  });
}

function issuePreview(item) {
  if (item.availability === "not-observed") return item.reason ? recordedValueReason(item.reason) : translate("runMissingValue");
  const state = { redacted: "runRedactedValue", truncated: "runTruncatedValue" }[item.availability];
  return [state && translate(state), String(item.value ?? "").split("\n")[0]].filter(Boolean).join(" · ");
}

function valuePreview(text) {
  const firstLines = text.split("\n", 7).slice(0, 6).join("\n");
  const preview = previewRecordedText(firstLines, 361);
  return preview === firstLines && firstLines !== text ? previewRecordedText(`${preview}…`, 361) : preview;
}

function appendFoldableValue(block, full, text, { isText, business = false } = {}) {
  const preview = htmlElement(isText ? "div" : "pre", "");
  preview.hidden = true;
  const expanded = htmlElement("details", `run-result-expanded${business ? " business-value-expanded" : ""}`);
  expanded.hidden = true;
  expanded.append(htmlElement("summary", "", translate("runExpandValue")));
  // Keep every value's disclosure slot stable before asynchronous measuring.
  // The existing disclosure state owns user expansion, never the observer.
  block.append(preview, expanded, full);
  const fold = () => {
    preview.className = `run-result-preview${isText ? "" : " structured-value"}`;
    preview.textContent = valuePreview(text);
    preview.hidden = false;
    expanded.hidden = false;
    if (!business) expanded.dataset.runExpand = "";
    full.remove();
    expanded.append(full);
  };
  if (text.length > 320 || text.split("\n").length > 6) fold();
  else valueFolds.observe(full, fold);
}

function appendBusinessValue(parent, value, { availability, reason, copy = true, fold = false } = {}) {
  const block = htmlElement("div", "business-value");
  const state = ["redacted", "truncated", "not-observed"].includes(availability) ? availability
    : value === undefined ? "not-observed" : value === null ? "null" : value === "" ? "empty" : "available";
  block.dataset.availability = state;
  block.dataset.valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const labels = { "not-observed": "runMissingValue", redacted: "runRedactedValue", truncated: "runTruncatedValue", empty: "runEmptyValue", null: "runNullValue" };
  if (labels[state]) block.append(htmlElement("small", "business-value-state", translate(labels[state])));
  if (reason) block.append(htmlElement("small", "business-value-state", recordedValueReason(reason)));
  if (value !== undefined && state !== "not-observed") {
    const raw = recordedValueText(value);
    const shown = raw === "" ? '""' : raw;
    if (typeof value === "string" && /^(?:null|true|false|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|[\[{])/i.test(raw.trim())) {
      block.append(htmlElement("small", "business-value-state", currentLanguage === "zh" ? "文本" : "Text"));
    }
    const isText = typeof value === "string" && value !== "";
    const full = htmlElement(isText ? "div" : "pre", `run-result-value business-value-text${isText ? "" : " structured-value"}`, shown);
    if (fold) appendFoldableValue(block, full, shown, { isText, business: true });
    else block.append(full);
    if (copy) appendReadingCopy(block, raw);
  }
  parent.append(block);
}

function appendReadingCopy(parent, value) {
  const button = htmlElement("button", "run-copy-value", translate("runCopyValue"));
  button.type = "button";
  button.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(value); button.textContent = translate("copied"); }
    catch { button.textContent = translate("runCopyFailed"); }
  });
  parent.append(button);
}

function appendExplanationValue(parent, item, direction, { copy = true } = {}) {
  appendBusinessValue(parent, channelReadingValue(item, direction, sourceEnvelope), { ...item, copy });
}

function recordedValueReason(reason) {
  return translate(({ size_limit: "runOmittedSize", unsupported_value: "runOmittedUnsafe", stream_not_consumed: "runOmittedStream", not_captured: "runMissingValue" })[reason] || "runMissingValue");
}

function appendExplanationChannel(parent, title, channel, direction, { omitError = false, node, copy = true } = {}) {
  const section = htmlElement("section", "node-detail-section explanation-channel");
  section.dataset.businessChannel = direction;
  section.append(htmlElement("h4", "", title));
  const items = (channel?.items || []).filter((item) => !omitError || !isRecordedErrorItem(node, item, sourceEnvelope));
  const preferred = preferredChannelItem({ items }, direction);
  if (preferred) appendExplanationValue(section, preferred, direction, { copy });
  else if (!omitError || !channel?.items?.length) appendBusinessValue(section, undefined);
  const remaining = items.filter((item) => item !== preferred);
  if (remaining.length) {
    const other = htmlElement("details", "business-value-expanded");
    const states = [...new Set(remaining.map(({ availability }) => ({ redacted: "runRedactedValue", truncated: "runTruncatedValue", "not-observed": "runMissingValue" })[availability]).filter(Boolean))];
    other.append(htmlElement("summary", "", [translate("additionalRecordedValues", { count: remaining.length }), ...states.map((key) => translate(key))].join(" · ")));
    for (const item of remaining) appendExplanationValue(other, item, direction, { copy });
    section.append(other);
  }
  if (section.childElementCount > 1) parent.append(section);
}

function compactText(value, limit = 110) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const preview = previewRecordedText(text, limit);
  return preview === text ? preview : preview.replace(/\s+…$/u, "…");
}

function parsedJSON(value) {
  if (typeof value !== "string" || !/^[\[{]/.test(value.trim())) return value;
  try {
    return parseRecordJSON(value);
  } catch {
    return value;
  }
}

function compactExplanationValue(value) {
  return compactRecordedValue(value) ?? translate("notRecorded");
}

function preferredChannelItem(channel, direction) {
  return preferredRecordedItem(channel, direction, sourceEnvelope);
}

function compactChannelValue(channel, direction) {
  const item = preferredChannelItem(channel, direction);
  if (item?.availability === "not-observed") return item.reason ? recordedValueReason(item.reason) : translate("runMissingValue");
  return item ? compactExplanationValue(channelReadingValue(item, direction, sourceEnvelope)) : undefined;
}

function primaryEvidence(node) {
  const evidence = node.evidence || [];
  const score = (item) => {
    if (node.status === "failed" && item.role === "error") return 100;
    if (item.kind === "schema.message") return 95;
    if (node.kind === "tool" && item.kind === "agent.event" && item.payload?.output?.message?.role === "tool") return 90;
    if (item.kind === "agent.event") return 85;
    if (item.role === "action") return 75;
    if (item.kind === "component.io") return item.payload?.direction === "output" ? 65 : 60;
    if (item.kind === "schema.tool") return 50;
    return 10;
  };
  return [...evidence].sort((left, right) => score(right) - score(left))[0];
}

function invocationLabel(id, label) {
  if (currentObjectKind === "agent") return label;
  return [label, currentInvocationLabels.get(id), currentIdentityLabels.get(id)].filter(Boolean).join(" · ");
}

function sourcePresentation(node, renderedNode) {
  const presentation = sourcePresentationBase(node, renderedNode);
  const reading = buildReadingStepPresentation(node, { locale: currentLanguage,
    envelopes: currentProjection?.document.evidence || [], invocationLabels: currentInvocationLabels,
    identityLabels: currentObjectKind === "agent" ? undefined : currentIdentityLabels });
  if (currentObjectKind === "graph") {
    const logicalId = currentGraphTopology?.nodeIdByExecutionId.get(node.id);
    const logical = currentGraphTopology?.nodes.find(({ id }) => id === logicalId);
    if (logical) {
      const callbacks = (node.evidence || []).map(({ envelopeIndex }) => currentProjection.document.evidence[envelopeIndex])
        .filter((envelope) => envelope?.kind === "callback.event");
      // A component-type fallback is not an application-owned name. Prefer
      // the confirmed definition name only when the source supplied no name;
      // an explicit custom name equal to its component remains untouched.
      if (node.label === node.component && callbacks.length
        && callbacks.every(({ payload }) => !payload.run?.name)) {
        reading.name = logical.name;
        reading.title = invocationLabel(node.id, logical.name);
      } else if (reading.name !== logical.name) reading.role = logical.name;
    }
  }
  if (currentObjectKind === "agent" && node.technical?.metadata?.agentScopeUnresolved) reading.role = translate("agentUnconfirmedRecord");
  return { ...presentation, title: reading.title, name: reading.name, overviewLabel: reading.title, role: reading.role };
}

function sourcePresentationBase(node, renderedNode) {
  const executionNode = currentExecutionDAG?.nodes.find(({ id }) => id === node.id);
  const metadata = executionNode?.metadata || node.technical?.metadata || {};
  if (metadata.agentScopeUnresolved) {
    return { sourceKind: "agent.event", eyebrow: translate("unconfirmedAgentEvidence"),
      title: metadata.agentName || node.label, overviewLabel: translate("unconfirmedAgentEvidence"),
      overviewValue: compactChannelValue(node.output, "output"), showFlow: true };
  }
  if (metadata.executionState || node.kind === "workflow" || node.kind === "error") {
    const title = metadata.toolName || node.label || renderedNode?.name || node.id;
    const reason = metadata.interruptionReason || executionNode?.errorMessage;
    return {
      sourceKind: node.kind === "workflow" ? "workflow.snapshot" : "agent.event",
      eyebrow: node.kind === "workflow" ? translate("workflowNode") : translate("sourceRecord"),
      title,
      overviewLabel: title,
      overviewValue: (reason && issuePreview(stepIssueReadingValue(node, reason))) || compactChannelValue(node.kind === "input" ? node.input : node.output, node.kind === "input" ? "input" : "output") || translate("notRecorded"),
      showFlow: true,
    };
  }
  const item = primaryEvidence(node);
  const payload = item?.payload || {};
  if (!item) {
    const title = renderedNode?.name || node.label || node.id;
    return {
      sourceKind: "workflow.snapshot",
      eyebrow: translate(renderedNode?.kind === "graph" ? "graphNode" : "workflowNode"),
      title,
      overviewLabel: title,
      overviewValue: renderedNode?.component || node.component,
      dedupeValue: undefined,
    };
  }

  if (["schema.message", "schema.agentic_message"].includes(item.kind)) {
    const role = item.role || payload.role || item.value?.role;
    const content = messageReadingValue(payload);
    const recordLabel = role === "user"
      ? translate("userInput")
      : role === "assistant" && node.kind === "output"
        ? translate("assistantOutput")
        : translate(role === "system" ? "systemMessage" : role === "assistant" ? "assistantMessage" : "sourceRecord");
    return {
      sourceKind: item.kind,
      sourceRole: role,
      eyebrow: recordLabel,
      title: recordLabel,
      overviewLabel: recordLabel,
      overviewValue: compactText(compactExplanationValue(content), 92),
      showFlow: true,
    };
  }

  if (item.role === "error") {
    const metadata = node.technical?.metadata || {};
    const name = node.kind === "tool" ? (metadata.toolName || node.label) : (payload.agentName || node.label);
    const title = name;
    const rawError = item.value?.message || payload.error?.message || compactExplanationValue(item.value);
    const errorLine = issuePreview(stepIssueReadingValue(node, rawError));
    const error = errorLine.includes("err=")
      ? errorLine.slice(errorLine.lastIndexOf("err=") + 4)
      : errorLine.replace(/^\[[^\]]+\]\s*failed to invoke tool\[[^\]]+\]:\s*/i, "");
    return {
      sourceKind: item.kind,
      sourceRole: item.role,
      eyebrow: translate("errorOutput"),
      title,
      overviewLabel: `${title} · ${translate("errorOutput")}`,
      overviewValue: compactText(error, 92),
      showFlow: true,
    };
  }

  if (item.kind === "agent.event" && node.kind === "tool") {
    const name = payload.output?.message?.toolName
      || payload.output?.message?.value?.tool_name
      || node.technical?.metadata?.toolName
      || node.label;
    const title = name;
    const result = compactChannelValue(node.output, "output") ?? translate("notRecorded");
    return {
      sourceKind: item.kind,
      sourceRole: payload.output?.message?.role || item.role,
      eyebrow: translate("toolCall"),
      title,
      overviewLabel: title,
      overviewValue: compactText(result, 92),
      showFlow: node.kind === "tool",
    };
  }

  if (item.kind === "agent.event") {
    const message = payload.output?.message;
    const messageValue = message?.value || {};
    const role = message?.role || messageValue.role || item.role || "event";
    const agentName = payload.agentName || "agent";
    const toolCalls = Array.isArray(messageValue.tool_calls) ? messageValue.tool_calls : [];
    const recordedValue = compactExplanationValue(messageReadingValue(messageValue));
    return {
      sourceKind: item.kind,
      sourceRole: role,
      eyebrow: translate(toolCalls.length ? "toolCall" : role === "assistant" ? "assistantMessage" : "sourceRecord"),
      title: agentName,
      overviewLabel: agentName,
      overviewValue: compactText(recordedValue, 92),
      showFlow: true,
    };
  }

  if (item.kind === "component.io") {
    const direction = payload.direction === "input" ? translate("componentInput") : translate("componentOutput");
    const title = payload.name || payload.component || node.label;
    const rawValue = Object.hasOwn(item, "value") ? item.value : payload.body;
    const value = rawValue === undefined ? translate("notRecorded") : compactExplanationValue(rawValue);
    return {
      sourceKind: item.kind,
      sourceRole: item.role,
      eyebrow: direction,
      title,
      value,
      overviewLabel: title,
      overviewValue: compactText(value, 92),
      showFlow: true,
    };
  }

  if (item.kind === "schema.tool") {
    const title = payload.name || node.label;
    const value = payload.desc || compactExplanationValue(item.value);
    return {
      sourceKind: item.kind,
      sourceRole: item.role,
      eyebrow: translate("toolDefinition"),
      title,
      value,
      overviewLabel: title,
      overviewValue: compactText(value, 92),
    };
  }

  const title = payload.name || payload.agentName || node.label || item.kind;
  const rawValue = Object.hasOwn(item, "value") ? item.value : payload;
  const value = compactExplanationValue(rawValue);
  return {
    sourceKind: item.kind,
    sourceRole: item.role,
    eyebrow: translate("sourceRecord"),
    title,
    value,
    overviewLabel: title,
    overviewValue: compactText(value, 92),
  };
}

function sourceHighlights(explanation) {
  const sourceNodes = explanation.nodes || [];
  const byID = new Map(sourceNodes.map((node) => [node.id, node]));
  const position = new Map(sourceNodes.map((node, index) => [node.id, index]));
  const indegree = new Map(sourceNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(sourceNodes.map((node) => [node.id, []]));
  for (const node of sourceNodes) {
    for (const cause of node.causes || []) {
      if (!byID.has(cause.nodeId)) continue;
      indegree.set(node.id, indegree.get(node.id) + 1);
      outgoing.get(cause.nodeId).push(node.id);
    }
  }
  const ready = sourceNodes.filter((node) => indegree.get(node.id) === 0);
  ready.sort((left, right) => position.get(left.id) - position.get(right.id));
  const ordered = [];
  while (ready.length) {
    const node = ready.shift();
    ordered.push(node);
    for (const targetID of outgoing.get(node.id)) {
      indegree.set(targetID, indegree.get(targetID) - 1);
      if (indegree.get(targetID) === 0) {
        ready.push(byID.get(targetID));
        ready.sort((left, right) => position.get(left.id) - position.get(right.id));
      }
    }
  }
  const displayNodes = ordered.length === sourceNodes.length ? ordered : sourceNodes;
  return displayNodes.map((node) => ({ node, presentation: sourcePresentation(node) }));
}

function appendCompactFlow(parent, explanationNode, { omitError = false, issue } = {}) {
  const flow = htmlElement("div", "business-content");
  // Pure message steps need only their recorded message channel. Executable
  // operations keep missing input/output explicit rather than borrowing a value.
  if (explanationNode.kind !== "output" && (explanationNode.kind !== "agent" || explanationNode.input?.items?.length)) {
    appendExplanationChannel(flow, translate("nodeInput"), explanationNode.input, "input", { copy: false });
  }
  if (issue) appendTrajectoryValue(flow, issue.label, issue.item.value, issue.item);
  if (explanationNode.kind !== "input") {
    appendExplanationChannel(flow, translate("nodeOutput"), explanationNode.output, "output", { omitError, node: explanationNode, copy: false });
  }
  if (flow.childElementCount) parent.append(flow);
}

function recordedTimingLabel(timing) {
  return translate(timing?.semantics === "observed-span" ? "observedSpan" : timing?.semantics === "declared-duration" ? "declaredDuration" : "nodeDuration");
}

function recordedTimingText(timing) {
  if (timing?.semantics === "observed-at") return `${translate("observedTime")} · ${timingTimestamp(timing.startedAtMs ?? timing.finishedAtMs)} (UTC)`;
  return `${recordedTimingLabel(timing)} · ${timingText(timing)}`;
}

function appendRecordedTimingFacts(parent, timing) {
  if (timing?.semantics === "observed-at") {
    const at = timing.startedAtMs ?? timing.finishedAtMs;
    if (Number.isFinite(at)) appendNodeFact(parent, `${translate("observedTime")} (UTC)`, timingTimestamp(at));
    return;
  }
  const observed = timing?.semantics === "observed-span";
  if (Number.isFinite(timing?.startedAtMs)) appendNodeFact(parent, `${translate(observed ? "firstObserved" : "timingStart")} (UTC)`, timingTimestamp(timing.startedAtMs));
  if (Number.isFinite(timing?.finishedAtMs)) appendNodeFact(parent, `${translate(observed ? "lastObserved" : "timingEnd")} (UTC)`, timingTimestamp(timing.finishedAtMs));
}

function evidenceReadingLabel(item) {
  if (item.role === "error" || item.payload?.error) return translate("errorOutput");
  const envelope = item.envelope || sourceEnvelope(item.envelopeIndex) || item;
  const message = envelopeMessage(envelope);
  if (message?.tool_calls?.length) return translate("toolCall");
  if (message?.role === "tool") return translate("toolResult");
  if (message?.role === "user") return translate("userInput");
  if (message?.role === "assistant") return translate("assistantMessage");
  if (envelope.kind === "component.io") return translate(envelope.payload?.direction === "input" ? "componentInput" : "componentOutput");
  if (envelope.kind === "schema.tool") return translate("toolDefinition");
  return translate("sourceRecord");
}

function appendTechnicalDetails(parent, explanationNode, relationships, evidence) {
  if (currentObjectKind !== "workflow") return;
  const disclosure = htmlElement("details", "technical-disclosure");
  disclosure.append(htmlElement("summary", "", translate("technicalDetails")));
  const body = htmlElement("div", "technical-disclosure-body");
  const relationshipSection = htmlElement("section", "node-detail-section");
  relationshipSection.append(htmlElement("h4", "", translate("nodeRelationships")));
  if (!relationships.length) {
    relationshipSection.append(htmlElement("p", "node-detail-note", translate("nodeNoRelationships")));
  } else {
    const list = htmlElement("div", "relationship-list");
    // A root call can relate to thousands of steps. Keep its folded technical
    // content out of the initial reading DOM; preserve every row on expansion.
    let populated = false;
    disclosure.addEventListener("toggle", () => {
      if (!disclosure.open || !disclosure.isConnected || populated) return;
      populated = true;
      for (const relationship of relationships) {
        const row = htmlElement("div", "relationship-row");
        const rowBody = htmlElement("div", "");
        rowBody.append(htmlElement("strong", "", relationship.label || relationship.peer));
        row.append(htmlElement("b", "", relationship.direction === "IN" ? "←" : "→"), rowBody);
        rowBody.append(htmlElement("code", "", relationship.peer));
        list.append(row);
      }
    });
    relationshipSection.append(list);
  }
  if (relationships.length) body.append(relationshipSection);

  const evidenceSection = htmlElement("section", "node-detail-section");
  evidenceSection.append(htmlElement("h4", "", translate("explanationEvidence")));
  if (!evidence.length) {
    evidenceSection.append(htmlElement("p", "node-detail-note", translate("nodeNoEvidence")));
  } else {
    const list = htmlElement("div", "evidence-list");
    for (const item of evidence) {
      const card = htmlElement("details", "evidence-card");
      const summary = htmlElement("summary", "");
      summary.append(
        htmlElement("span", "evidence-index", String(item.envelopeIndex + 1).padStart(2, "0")),
        htmlElement("strong", "", evidenceReadingLabel(item)),
      );
      const evidenceBody = htmlElement("div", "evidence-body");
      evidenceBody.append(jsonTree(item.payload ?? item.envelope?.payload, "payload"));
      const action = htmlElement("button", "evidence-action", translate("openRawRecord"));
      action.type = "button";
      action.dataset.envelopeIndex = String(item.envelopeIndex);
      evidenceBody.append(action);
      card.append(summary, evidenceBody);
      list.append(card);
    }
    evidenceSection.append(list);
  }
  body.append(evidenceSection);

  const factsSection = htmlElement("section", "node-detail-section technical-facts");
  factsSection.append(htmlElement("h4", "", translate("nodeMetadata")));
  const facts = htmlElement("dl", "node-facts");
  appendNodeFact(facts, "ID", explanationNode.id);
  appendReadingCopy(factsSection, explanationNode.id);
  appendNodeFact(facts, translate("nodeKind"), explanationNode.kind);
  if (explanationNode.component) appendNodeFact(facts, translate("nodeComponent"), explanationNode.component);
  appendRecordedTimingFacts(facts, explanationNode.timing);
  appendNodeFact(facts, translate("explanationBasis"), explanationNode.basis === "observed" ? translate("explanationObserved") : translate("explanationDeclared"));
  const correlation = explanationNode.technical?.correlation || {};
  factsSection.append(facts);
  if (Object.keys(correlation).length) factsSection.append(jsonTree(correlation, translate("nodeCorrelation")));
  const metadata = explanationNode.technical?.metadata;
  if (metadata && Object.keys(metadata).length) factsSection.append(jsonTree(metadata, "metadata"));
  body.append(factsSection);
  disclosure.append(body);
  parent.append(disclosure);
}

function fallbackExplanation(renderedNode, executionNode, relationships, evidence) {
  const status = executionNode?.status || renderedNode.status || "declared";
  return {
    id: executionNode?.id || renderedNode.id,
    path: renderedNode.path,
    label: executionNode?.label || renderedNode.name || renderedNode.id,
    kind: executionNode?.kind || renderedNode.kind,
    component: executionNode?.component || renderedNode.component,
    status,
    basis: executionNode ? "observed" : "declared",
    headline: executionNode?.label || renderedNode.name || renderedNode.id,
    summary: executionNode
      ? `${evidence.length} source record${evidence.length === 1 ? "" : "s"} support this execution node.`
      : translate("nodeNoEvidence"),
    rationale: relationships.length ? relationships.map((item) => `${item.direction} · ${item.kind} · ${item.peer}`).join(" ") : translate("nodeNoRelationships"),
    input: { availability: "not-observed", summary: translate("nodeNoEvidence"), items: [] },
    output: { availability: "not-observed", summary: translate("nodeNoEvidence"), items: [] },
    causes: relationships.filter((item) => item.direction === "IN").map((item) => ({ nodeId: item.peer, label: item.peer, relation: item.kind, summary: `${item.peer} → ${item.kind}` })),
    effects: relationships.filter((item) => item.direction === "OUT").map((item) => ({ nodeId: item.peer, label: item.peer, relation: item.kind, summary: `${item.kind} → ${item.peer}` })),
    timing: { semantics: renderedNode.durationMs === undefined ? "not-observed" : "declared-duration", durationMs: renderedNode.durationMs },
    evidence,
    technical: { correlation: executionNode?.correlation || {}, metadata: executionNode?.metadata || renderedNode.metadata || {} },
    limitations: evidence.length ? [] : [translate("nodeNoEvidence")],
  };
}

function renderExplanationNode(explanationNode, { renderedNode, executionNode, activate = true, synchronize = true } = {}) {
  const evidence = (explanationNode.evidence || []).map((entry) => ({
    ...entry,
    envelope: sourceEnvelope(entry.envelopeIndex),
  }));
  if (synchronize && evidence.length) {
    selectLinkedEvidence(evidence, { executionNodeId: executionNode?.id });
  }
  const relationships = [
    ...(explanationNode.causes || []).map((item) => ({ direction: "IN", kind: item.relation, peer: item.nodeId, ...item })),
    ...(explanationNode.effects || []).map((item) => ({ direction: "OUT", kind: item.relation, peer: item.nodeId, ...item })),
  ];
  const presentation = sourcePresentation(explanationNode, renderedNode);
  const content = htmlElement("div", "node-detail-content");
  const stateNode = executionNode || { status: explanationNode.status, metadata: explanationNode.technical?.metadata };
  if (stateNode.metadata?.executionState) content.dataset.executionState = stateNode.metadata.executionState;
  const hero = htmlElement("div", "node-detail-hero");
  const heading = htmlElement("h3", "", presentation.name || presentation.title);
  heading.title = presentation.name || presentation.title;
  if (currentInvocationLabels.has(explanationNode.id)) heading.append(htmlElement("span", "heading-fact", currentInvocationLabels.get(explanationNode.id)));
  hero.append(heading);
  if (presentation.role) hero.append(htmlElement("small", "", presentation.role));
  if (currentObjectKind === "graph" ? !confirmedStepSuccess(stateNode) : stateNode.status !== "declared") hero.append(htmlElement("p", `step-state ${stateNode.status}`, stepStatusLabel(stateNode)));
  if (!["input", "output"].includes(explanationNode.kind)) hero.append(htmlElement("p", "step-duration", recordedTimingText(explanationNode.timing)));
  if (presentation.value && !presentation.showFlow) {
    hero.append(htmlElement("p", "source-primary-value", presentation.value));
  }
  content.append(hero);
  appendGraphVisitPicker(content, explanationNode.id);
  const identity = currentIdentityLabels.get(explanationNode.id);
  if (identity && currentObjectKind === "graph") {
    const label = htmlElement("p", "step-reading-identity", identity);
    label.title = identity;
    content.append(label);
  } else if (identity && currentObjectKind !== "agent") {
    const disclosure = htmlElement("details", "step-identity");
    disclosure.dataset.stepIdentity = "";
    disclosure.append(htmlElement("summary", "", `${currentLanguage === "zh" ? "身份" : "Identity"} · ${previewRecordedText(identity, 72)}`), htmlElement("pre", "", identity));
    appendReadingCopy(disclosure, identity);
    content.append(disclosure);
  }

  appendStepScopeContext(content, currentInspection?.getNodeGroups(explanationNode.id) || [], {
    unresolved: Boolean(stateNode.metadata?.agentScopeUnresolved),
  });

  const errorEvidence = evidence.find((item) => item.role === "error");
  const reason = stateNode.metadata?.interruptionReason || executionNode?.errorMessage || errorEvidence?.payload?.error?.message;
  const issue = reason ? {
    label: translate(stateNode.metadata?.executionState === "interrupted" ? "interruptionReason" : "errorOutput"),
    item: stepIssueReadingValue(explanationNode, reason),
  } : undefined;
  if (presentation.showFlow) appendCompactFlow(content, explanationNode, { omitError: Boolean(reason), issue });
  else if (issue) appendTrajectoryValue(content, issue.label, issue.item.value, issue.item);

  appendTechnicalDetails(content, explanationNode, relationships, evidence);

  ui.nodeDetail.replaceChildren(content);
  rememberDisclosures(ui.nodeDetail, `step:${explanationNode.id}`);
  selectedRenderedNode = renderedNode;
  selectedNodeDetail = { renderedNode, executionNode, explanationNode, relationships, evidence, presentation };
  markInspectionSelection();
  if (activate) {
    inspectorPanel("node");
    if (!inspectorPresentationLocked) schedulePathSelectionReveal();
  }
}

function renderNodeDetail(renderedNode, { synchronize = true, activate = true } = {}) {
  const executionNode = currentExecutionDAG?.nodes?.find((node) => node.id === renderedNode.id);
  const fallbackRelationships = relationshipsForNode(renderedNode, executionNode);
  const fallbackEvidence = (executionNode?.evidence || []).map((entry) => ({
    ...entry,
    envelope: sourceEnvelope(entry.envelopeIndex),
  }));
  const declaredMatches = !currentExecutionDAG && currentObjectKind === "graph"
    ? currentExplanation?.nodes.filter((node) => node.technical?.metadata?.sourceNodeId === renderedNode.id) || [] : [];
  const explanationNode = currentExplanation?.nodes?.find((node) => node.id === (executionNode?.id || renderedNode.path.join("/")))
    || (declaredMatches.length === 1 ? declaredMatches[0] : undefined)
    || fallbackExplanation(renderedNode, executionNode, fallbackRelationships, fallbackEvidence);
  renderExplanationNode(explanationNode, { renderedNode, executionNode, synchronize, activate });
}

let runSummaryCopyValues = [];
let scopeSummaryCopyValues = [];

function timingText(timing) {
  if (Number.isFinite(timing?.durationMs) && timing.durationMs >= 0) return `${timing.durationMs} ms`;
  return timing?.availability === "invalid" ? translate("timingInvalid") : translate("timingMissing");
}

function timingTimestamp(value) {
  if (!Number.isFinite(value)) return translate("timingMissing");
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : translate("timingInvalid");
}

function selectInspectionStep(id, trigger, { activate = true } = {}) {
  const explanationNode = currentInspection?.getNode(id);
  if (!explanationNode) return;
  rememberInspectorTrigger(trigger);
  const executionNode = currentExecutionDAG?.nodes.find((node) => node.id === id);
  const renderedNode = { id, path: explanationNode.path || [id], name: explanationNode.label,
    component: explanationNode.component, metadata: explanationNode.technical?.metadata || {} };
  renderExplanationNode(explanationNode, { renderedNode, executionNode, activate });
  activateReadingPath(id, renderedNode.path);
  selectedPathIsPrompt = false;
  ui.selectedPath.textContent = invocationLabel(explanationNode.id, explanationNode.label);
}

function collectReadingSteps(query, options = {}) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const page = currentInspection.searchSteps(query, { ...options, offset, limit: 200 });
    items.push(...page.items);
    if (offset + 200 >= page.total) break;
  }
  return items;
}

function readingSteps(query, options = {}) {
  const items = new Map(collectReadingSteps(query, options).map((node) => [node.id, node]));
  let remaining = String(query);
  const requested = [];
  const roles = [...new Set([...currentReadingRoles.values()].flatMap((values) => [...values]))];
  for (const role of roles) {
    const phrase = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_]|\\s*\\d)`, "giu");
    let found = false;
    remaining = remaining.replace(pattern, (_match, prefix) => { found = true; return prefix; });
    if (found) requested.push(role);
  }
  if (requested.length) for (const node of collectReadingSteps(remaining.trim(), options)) {
    if (requested.every((role) => currentReadingRoles.get(node.id)?.has(role))) items.set(node.id, node);
  }
  return [...items.values()].sort((a, b) => currentReadingOrder.get(a.id) - currentReadingOrder.get(b.id));
}

function readingStepsPage(query, options = {}) {
  const items = readingSteps(query, options);
  const limit = 25;
  const offset = Math.min(inspectionOffset, Math.max(0, Math.floor((items.length - 1) / limit) * limit));
  return { items: items.slice(offset, offset + limit), offset, limit, total: items.length };
}

function markInspectionSelection() {
  for (const button of ui.inspectionResults.querySelectorAll("[data-inspection-node]")) {
    const active = button.dataset.inspectionNode === (selectedNodeDetail?.explanationNode?.id || selectedExecutionNodeId);
    if (active) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function jumpToInspectionStep(id, trigger = document.activeElement, { scroll = true, activate = true } = {}) {
  if (!currentInspection?.getNode(id)) return;
  if (!currentScopeReading?.nodeIds.includes(id)) selectInspectionGroup(undefined);
  if (currentObjectKind === "agent") {
    selectInspectionStep(id, trigger);
    ui.inspector.scrollIntoView({ block: "start" });
    return;
  }
  if (currentObjectKind === "graph") ui.inspectionScope.value = "steps";
  const mode = ui.inspectionScope.value;
  if (!["steps", "issues"].includes(mode) || mode === "issues" && !readingSteps("", { ...inspectionRange(), issuesOnly: true }).some((node) => node.id === id)) ui.inspectionScope.value = "steps";
  const options = { ...inspectionRange(), issuesOnly: ui.inspectionScope.value === "issues" };
  let matches = readingSteps(ui.inspectionSearch.value, options);
  if (!matches.some((node) => node.id === id)) {
    ui.inspectionSearch.value = "";
    matches = readingSteps("", options);
  }
  inspectionOffset = Math.max(0, Math.floor(matches.findIndex((node) => node.id === id) / 25) * 25);
  renderInspectionResults();
  selectInspectionStep(id, trigger, { activate });
  if (scroll) ui.inspector.scrollIntoView({ block: "start" });
}

function renderInspectionResults() {
  if (!currentInspection) return;
  if (currentObjectKind === "agent") {
    ui.inspectionResults.replaceChildren();
    return;
  }
  // Graph has one step list. Never retain an invisible filter when switching
  // records, languages, or scopes; Workflow keeps its inspection controls.
  if (currentObjectKind === "graph") ui.inspectionScope.value = "steps";
  const scope = ui.inspectionScope.value;
  const isSteps = scope === "steps" || scope === "issues";
  const range = inspectionRange();
  const page = isSteps
    ? readingStepsPage(ui.inspectionSearch.value, { ...range, issuesOnly: scope === "issues" })
    : currentInspection.searchEvidence(ui.inspectionSearch.value, { ...inspectionEvidenceRange(), offset: inspectionOffset, limit: 25, scope: scope === "unassigned" ? "unassigned" : "all" });
  inspectionOffset = page.offset;
  ui.inspectionResults.replaceChildren();
  for (const item of page.items) {
    const row = htmlElement("li", "");
    const action = htmlElement("button", "inspection-item");
    action.type = "button";
    if (isSteps) {
      action.dataset.inspectionNode = item.id;
      const presentation = sourcePresentation(item);
      const facts = [currentInvocationLabels.get(item.id), presentation.role,
        currentObjectKind === "graph" && confirmedStepSuccess(item) ? undefined : stepStatusLabel(item)].filter(Boolean);
      if (Number.isFinite(item.timing?.durationMs)) facts.push(timingText(item.timing));
      action.append(htmlElement("strong", "", presentation.name || item.label), htmlElement("small", "", facts.join(" · ")));
      const identity = currentIdentityLabels.get(item.id);
      if (identity && currentObjectKind !== "agent") {
        const label = htmlElement("small", "inspection-identity", identity);
        label.title = identity;
        action.append(label);
      }
    } else {
      action.dataset.inspectionEvidence = String(item.envelopeIndex);
      action.append(htmlElement("strong", "", `#${item.envelopeIndex + 1} · ${item.label}`), htmlElement("small", "", item.nodeIds.map((id) => invocationLabel(id, currentInspection.getNode(id)?.label || id)).join(" · ") || (item.scope === "run" ? translate("runResultTitle") : translate("inspectionUnassigned"))));
    }
    row.append(action);
    ui.inspectionResults.append(row);
  }
  ui.inspectionCount.textContent = translate("inspectionCount", { start: page.total ? page.offset + 1 : 0, end: Math.min(page.total, page.offset + page.limit), total: page.total });
  ui.inspectionPrevious.disabled = page.offset === 0;
  ui.inspectionNext.disabled = page.offset + page.limit >= page.total;
  ui.inspectionNextIssue.disabled = !inspectionIssues().length && !currentInspection.searchSteps("", { ...range, issuesOnly: true, limit: 1 }).total;
  ui.inspectionNextIssue.hidden = currentObjectKind === "graph";
  ui.inspectionCount.closest("nav").hidden = currentObjectKind === "graph" && page.total <= page.limit;
  if (!page.total && ui.inspectionSearch.value) ui.inspectionResults.append(htmlElement("li", "search-empty", translate("noSearchResults")));
  ui.clearSearch.hidden = Boolean(page.total || !ui.inspectionSearch.value);
  markInspectionSelection();
}

function inspectionRange() {
  return inspectionUngrouped ? { ungroupedOnly: true } : inspectionGroupId ? { groupId: inspectionGroupId } : {};
}

function inspectionEvidenceRange() {
  return currentScopeReading && currentScopeReading.mode !== "all"
    ? { evidenceEnvelopeIndexes: currentScopeReading.evidenceEnvelopeIndexes } : {};
}

function inspectionIssues() {
  const issues = currentExplanation?.run?.issues || [];
  if (!inspectionGroupId && !inspectionUngrouped) return issues;
  // The same index governs scope filtering for navigation and problem selection.
  const ids = new Set();
  for (let offset = 0; ; offset += 200) {
    const page = currentInspection.searchSteps("", { ...inspectionRange(), offset, limit: 200 });
    for (const node of page.items) ids.add(node.id);
    if (offset + 200 >= page.total) break;
  }
  return issues.filter((issue) => issue.nodeId && ids.has(issue.nodeId));
}

function selectInspectionGroup(id, { ungrouped = false, focus = false } = {}) {
  if (id && !currentInspection?.getGroup(id)) return;
  inspectionGroupId = id || undefined;
  inspectionUngrouped = ungrouped;
  inspectionOffset = inspectionIssueOffset = hierarchyOffset = 0;
  largeVisualRequested = false;
  currentRunView = currentObjectKind === "agent" ? "trajectory" : "path";
  currentScopeReading = buildScopeReading(currentProjection.document, currentExplanation, { ...inspectionRange(), locale: currentLanguage });
  if (selectedNodeDetail?.explanationNode && (inspectionGroupId || inspectionUngrouped)) {
    const id = selectedNodeDetail.explanationNode.id;
    const belongs = currentInspection.getNodeGroups(id).some((group) => currentInspection.getGroupPath(group.id).some((parent) => parent.id === inspectionGroupId));
    if (inspectionUngrouped ? currentInspection.getNodeGroups(id).length > 0 : !belongs) {
      clearLinkedSelection();
      clearNodeDetail({ preservePanel: true });
      selectedPathIsPrompt = true;
      ui.selectedPath.textContent = translate("selectNodePrompt");
    }
  }
  const rawIndex = ui.editor.dataset.selectedEnvelopeIndex;
  if (rawIndex !== undefined && !currentScopeReading.evidenceEnvelopeIndexes.includes(Number(rawIndex))) clearLinkedSelection();
  renderCurrentDocument({ scopeOnly: true });
  if (currentObjectKind === "agent") ui.readingMain.scrollIntoView({ block: "start" });
  if (focus) {
    const target = visibleReadingTrigger(ui.hierarchyBreadcrumbs.querySelector('[aria-current="location"]'))
      || visibleReadingTrigger(ui.domainView.querySelector(".trajectory-view"));
    target?.focus({ preventScroll: true });
  }
}

function renderHierarchyNavigation() {
  const groups = currentExplanation?.groups || [];
  if (currentObjectKind === "agent" && groups.length && (inspectionGroupId || inspectionUngrouped)) {
    ui.readingMain.prepend(ui.hierarchyBreadcrumbs);
  } else {
    ui.hierarchy.prepend(ui.hierarchyBreadcrumbs);
  }
  ui.hierarchy.hidden = !groups.length;
  if (currentObjectKind === "graph" && hasSingleGraphScope() && !inspectionGroupId && !inspectionUngrouped) {
    ui.hierarchy.hidden = true;
    ui.hierarchyBreadcrumbs.replaceChildren();
    ui.hierarchyGroups.replaceChildren();
    return;
  }
  if (!groups.length) return;
  const selected = currentInspection.getGroup(inspectionGroupId);
  const path = selected ? currentInspection.getGroupPath(selected.id) : [];
  ui.hierarchyBreadcrumbs.replaceChildren();
  const addCrumb = (label, id, current, ungrouped = false) => {
    const action = htmlElement("button", "", label);
    action.type = "button";
    if (ungrouped) action.dataset.hierarchyUngrouped = "";
    else action.dataset.hierarchyGroup = id || "";
    if (current) action.setAttribute("aria-current", "location");
    ui.hierarchyBreadcrumbs.append(action);
  };
  addCrumb(translate("hierarchyAll"), undefined, !selected && !inspectionUngrouped);
  for (const group of path) addCrumb(group.label, group.id, group.id === selected.id);
  if (inspectionUngrouped) addCrumb(translate("hierarchyUngrouped"), undefined, true, true);
  if (currentObjectKind === "agent") {
    ui.hierarchyGroups.replaceChildren();
    return;
  }
  const count = currentInspection.searchSteps("", { ...inspectionRange(), limit: 1 }).total;
  ui.hierarchyContext.textContent = translate("hierarchyContext", { count, total: currentInspection.nodeCount });
  ui.hierarchyContext.hidden = !selected && !inspectionUngrouped;
  if (selected?.basis === "declared") ui.hierarchyContext.textContent = `${translate("hierarchyDeclared")} · ${ui.hierarchyContext.textContent}`;
  ui.hierarchyTitle.textContent = translate(currentObjectKind === "agent" ? "hierarchyAgent" : currentObjectKind === "graph" ? "hierarchyGraph" : "hierarchyWorkflow");
  const children = groups.filter((group) => selected ? group.parentId === selected.id : !group.parentId || !currentInspection.getGroup(group.parentId));
  hierarchyOffset = children.length ? Math.min(hierarchyOffset, Math.floor((children.length - 1) / 25) * 25) : 0;
  ui.hierarchyGroups.replaceChildren();
  const childCounts = new Map();
  for (const group of groups) childCounts.set(group.parentId, (childCounts.get(group.parentId) || 0) + 1);
  for (const group of children.slice(hierarchyOffset, hierarchyOffset + 25)) {
    const row = htmlElement("li", "");
    const action = htmlElement("button", "hierarchy-group");
    action.type = "button";
    action.dataset.hierarchyGroup = group.id;
    action.title = currentObjectKind === "agent" ? group.label : group.id;
    const count = currentInspection.searchSteps("", { groupId: group.id, limit: 1 }).total;
    const children = childCounts.get(group.id) || 0;
    const facts = [currentLanguage === "zh" ? `${count} 步` : `${count} steps`];
    if (children) facts.push(currentLanguage === "zh" ? `${children} 个子调用` : `${children} child calls`);
    if (group.basis === "declared") facts.push(translate("hierarchyDeclared"));
    action.append(htmlElement("strong", "", group.label), htmlElement("small", "", facts.join(" · ")));
    row.append(action);
    ui.hierarchyGroups.append(row);
  }
  const ungroupedCount = currentInspection.searchSteps("", { ungroupedOnly: true, limit: 1 }).total;
  ui.hierarchyUngrouped.hidden = !ungroupedCount;
  ui.hierarchyUngrouped.textContent = `${translate("hierarchyUngrouped")} · ${ungroupedCount}`;
  ui.hierarchyDirectory.hidden = !children.length && !ungroupedCount;
  ui.hierarchyPagination.hidden = children.length <= 25;
  ui.hierarchyPrevious.disabled = hierarchyOffset === 0;
  ui.hierarchyNext.disabled = hierarchyOffset + 25 >= children.length;
  ui.hierarchyCount.textContent = translate("inspectionCount", { start: children.length ? hierarchyOffset + 1 : 0, end: Math.min(children.length, hierarchyOffset + 25), total: children.length });
  ui.hierarchyUngrouped.setAttribute("aria-pressed", String(inspectionUngrouped));
}

function rebuildInspection() {
  currentInspection = currentExplanation ? einoAPI.createRunInspectionIndex(currentExplanation, currentProjection.document.evidence) : undefined;
  currentReadingOrder = buildWorkflowReadingOrder(currentExplanation, { kind: currentObjectKind });
  currentReadingRoles = new Map((currentExplanation?.nodes || []).map((node) => [node.id, new Set(["en", "zh"].map((locale) =>
    buildReadingStepPresentation(node, { locale, envelopes: currentProjection.document.evidence }).role).filter(Boolean).map((role) => role.toLocaleLowerCase().replace(/\s+/gu, " ")))]));
  ui.inspection.hidden = !currentInspection;
  if (inspectionGroupId && !currentInspection?.getGroup(inspectionGroupId)) inspectionGroupId = undefined;
  currentScopeReading = currentExplanation ? buildScopeReading(currentProjection.document, currentExplanation, { ...inspectionRange(), locale: currentLanguage }) : undefined;
}

function appendRunEvidence(container, indexes = []) {
  if (currentObjectKind !== "workflow") return;
  const valid = [...new Set(indexes)].filter((index) => Number.isSafeInteger(index) && sourceEnvelope(index));
  if (!valid.length) return;
  const disclosure = htmlElement("details", "run-sources");
  disclosure.append(htmlElement("summary", "", translate("runSources", { count: valid.length })));
  const links = htmlElement("div", "run-result-evidence");
  for (const index of valid) {
    const button = htmlElement("button", "", translate("runResultEvidence", { index: index + 1 }));
    button.type = "button";
    button.dataset.envelopeIndex = String(index);
    links.append(button);
  }
  disclosure.append(links);
  container.append(disclosure);
}

function runValueText(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function createRunChannel(direction, title) {
  const section = htmlElement("section", `run-result-channel ${direction}`);
  section.append(htmlElement("h3", "", title));
  return section;
}

function appendRunValue(container, item, { local = false, fold = false } = {}) {
  const block = htmlElement("div", "run-result-item");
  block.dataset.availability = item.availability;
  // Retain a body's unique original source without adding a technical action.
  if (currentObjectKind === "graph" && item.evidenceEnvelopeIndexes?.length === 1) {
    const index = item.evidenceEnvelopeIndexes[0];
    if (Number.isSafeInteger(index) && sourceEnvelope(index)) block.dataset.envelopeIndex = String(index);
  }
  const stateKeys = {
    empty: "runEmptyValue", null: "runNullValue", redacted: "runRedactedValue",
    truncated: "runTruncatedValue", "not-observed": "runMissingValue",
  };
  if (stateKeys[item.availability]) block.append(htmlElement("small", "run-value-state", translate(stateKeys[item.availability])));
  const omittedReasons = { size_limit: "runOmittedSize", unsupported_value: "runOmittedUnsafe", stream_not_consumed: "runOmittedStream" };
  if (omittedReasons[item.reason]) block.append(htmlElement("p", "run-channel-note", translate(omittedReasons[item.reason])));
  if (Object.prototype.hasOwnProperty.call(item, "value")) {
    const raw = runValueText(item.value);
    // Input/output bodies are complete by default. Error previews can still
    // fold without changing copy or the original evidence.
    const shown = raw === "" ? '""' : raw;
    const type = item.value === null ? "null" : Array.isArray(item.value) ? "array" : typeof item.value;
    block.dataset.valueType = type;
    if (type === "string" && /^(?:null|true|false|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$|^[\[{]/i.test(raw.trim())) {
      block.append(htmlElement("small", "run-value-state", currentLanguage === "zh" ? "文本" : "Text"));
    }
    const isText = typeof item.value === "string" && item.value !== "";
    const value = htmlElement(isText ? "div" : "pre", `run-result-value${isText ? "" : " structured-value"}`, shown);
    value.dataset.runValue = "";
    value.dataset.availability = item.availability;
    if (fold) appendFoldableValue(block, value, shown, { isText });
    else block.append(value);
    const copy = htmlElement("button", "run-copy-value", translate("runCopyValue"));
    copy.type = "button";
    if (local) copy.dataset.scopeCopyIndex = String(scopeSummaryCopyValues.push(raw) - 1);
    else copy.dataset.runCopyIndex = String(runSummaryCopyValues.push(raw) - 1);
    block.append(copy);
  }
  appendRunEvidence(block, item.evidenceEnvelopeIndexes);
  container.append(block);
}

function renderScopeResultSummary() {
  const scope = currentScopeReading;
  const scoped = Boolean(scope && scope.mode !== "all" && !scope.topLevel);
  if (currentObjectKind === "workflow" && ui.globalSummary.dataset.scoped !== String(scoped)) ui.globalSummary.open = !scoped;
  ui.globalSummary.dataset.scoped = String(scoped);
  ui.globalSummaryTitle.textContent = currentObjectKind === "agent" ? translate("runInformation")
    : `${translate("scopeBackToResult")} · ${currentExplanation?.run?.result.label || ""}`;
  scopeSummaryCopyValues = [];
  ui.scopeResultSummary.replaceChildren();
  ui.scopeResultSummary.hidden = !scope || scope.mode === "all" || scope.topLevel;
  if (!scope) return;
  ui.scopeResultSummary.dataset.scopeMode = scope.mode;
  ui.scopeResultSummary.dataset.scopeId = scope.group?.id || "";
  if (ui.scopeResultSummary.hidden) return;
  const topLevel = scope.topLevel;
  const header = htmlElement("header", "scope-result-heading");
  const heading = htmlElement("div", "");
  heading.append(htmlElement("small", "", translate(scope.mode === "unassigned" ? "hierarchyUngrouped" : topLevel ? "scopeTopLevel" : "scopeResultTitle")),
    htmlElement("h2", "", scope.group?.label || translate("hierarchyUngrouped")));
  header.append(heading);
  const global = htmlElement("button", "", translate(currentObjectKind === "graph" ? "hierarchyAll" : "scopeBackToResult"));
  global.type = "button";
  global.dataset.scopeGlobalResult = "";
  header.append(global);
  const status = htmlElement("p", "scope-result-state", scope.result.label);
  status.dataset.scopeResult = scope.result.state;
  ui.scopeResultSummary.append(header, status);
  const exchange = htmlElement("div", "run-result-exchange");
  for (const direction of ["output", "input"]) {
    const channel = scope[direction];
    const section = createRunChannel(direction, translate(direction === "input" ? "scopeInput" : "scopeOutput"));
    section.dataset.scopeChannel = direction;
    section.dataset.availability = channel.availability;
    if (!channel.items.length) section.append(htmlElement("small", "run-value-state", translate("runMissingValue")));
    for (const item of channel.items) appendRunValue(section, item, { local: true });
    exchange.append(section);
  }
  const issues = htmlElement("div", "run-result-issues");
  for (const issue of scope.issues) {
    const item = htmlElement("section", "run-result-issue");
    item.dataset.scopeIssue = issue.nodeId || "boundary";
    item.dataset.recovered = String(Boolean(issue.recovered));
    const node = currentInspection.getNode(issue.nodeId);
    const callerBoundary = issue.nodeId && !scope.nodeIds.includes(issue.nodeId);
    item.dataset.scopeIssueOrigin = callerBoundary ? "caller" : "local";
    const label = callerBoundary ? issue.recovered ? "scopeCallerHandledError" : "scopeCallerError" : issue.recovered ? "runRecoveredIssue" : "runStepIssue";
    item.append(htmlElement("h3", "", `${translate(label)}${node ? ` · ${sourcePresentation(node).title}` : ""}`));
    appendRunValue(item, issueReadingValue(issue), { local: true, fold: true });
    if (node) {
      const locate = htmlElement("button", "issue-locate", translate("locateIssue"));
      locate.type = "button";
      locate.dataset.runIssueStep = node.id;
      locate.dataset.issueStep = node.id;
      item.append(locate);
    }
    issues.append(item);
  }
  if (scope.result.state === "failed") ui.scopeResultSummary.append(issues, exchange);
  else ui.scopeResultSummary.append(exchange, issues);
  if (currentObjectKind !== "agent") {
    const note = htmlElement("div", "scope-path-note");
    note.append(htmlElement("strong", "", translate(scope.execution ? "scopePath" : "scopeDeclaredPath", { count: scope.nodeIds.length })));
    if (scope.boundary.total) note.append(htmlElement("p", "", translate("scopeBoundary", { incoming: scope.boundary.incoming.length, outgoing: scope.boundary.outgoing.length })));
    ui.scopeResultSummary.append(note);
  }
  if (scope.group && currentObjectKind === "workflow") {
    const identity = htmlElement("details", "step-identity");
    identity.append(htmlElement("summary", "", currentLanguage === "zh" ? "调用身份" : "Call identity"), htmlElement("pre", "", scope.group.id));
    appendReadingCopy(identity, scope.group.id);
    ui.scopeResultSummary.append(identity);
  }
  rememberDisclosures(ui.scopeResultSummary, `scope:${scope.group?.id || scope.mode}`);
}

function renderRunResultSummary(explanation) {
  const run = explanation?.run;
  ui.runResultSummary.replaceChildren();
  runSummaryCopyValues = [];
  // The real root step is Graph's single entry for overall input/output.
  const showSummary = Boolean(run) && currentObjectKind !== "graph";
  ui.runResultSummary.hidden = !showSummary;
  ui.globalSummary.hidden = !showSummary;
  document.body.classList.toggle("has-run", Boolean(run));
  if (!showSummary) return;
  const header = htmlElement("header", "run-result-heading");
  header.append(htmlElement("h2", "", currentObjectKind === "agent" ? translate("runAgentOutputTitle")
    : `${{ graph: "Graph", workflow: "Workflow" }[currentObjectKind]} · ${translate("runResultTitle")}`));
  const status = htmlElement("div", "run-result-states");
  const resultLabel = htmlElement("span", "run-result-state", run.result.label);
  resultLabel.dataset.runResult = run.result.state;
  const captureLabel = htmlElement("span", "run-capture-state", run.capture.label);
  captureLabel.setAttribute("aria-label", `${translate("runCaptureTitle")} · ${run.capture.label}`);
  captureLabel.dataset.runCapture = run.capture.status;
  status.append(resultLabel);
  if (run.capture.status !== "complete") status.append(captureLabel);
  const duration = htmlElement("span", "run-duration", `${translate("runDuration")} · ${timingText(run.timing)}`);
  duration.dataset.runDuration = "";
  status.append(duration);
  header.append(status);
  ui.runResultSummary.append(header);
  const information = htmlElement("details", "run-result-timing run-information");
  information.append(htmlElement("summary", "", translate("runInformation")));
  const facts = htmlElement("dl", "node-facts");
  if (explanation.runId) appendNodeFact(facts, "Run ID", explanation.runId);
  if (Number.isFinite(run.timing?.startedAtMs)) appendNodeFact(facts, `${translate("timingStart")} (UTC)`, timingTimestamp(run.timing.startedAtMs));
  if (Number.isFinite(run.timing?.finishedAtMs)) appendNodeFact(facts, `${translate("timingEnd")} (UTC)`, timingTimestamp(run.timing.finishedAtMs));
  information.append(facts);
  appendRunEvidence(information, run.timing?.evidenceEnvelopeIndexes);
  if (run.capture.status === "complete") information.append(captureLabel);
  if (run.capture.limitations.length) {
    const diagnostics = htmlElement("details", "run-diagnostics");
    diagnostics.append(htmlElement("summary", "", translate("recordDiagnostics")));
    const list = htmlElement("ul", "run-result-limitations");
    for (const text of run.capture.limitations) list.append(htmlElement("li", "", text));
    diagnostics.append(list);
    information.append(diagnostics);
  }

  const exchange = htmlElement("div", "run-result-exchange");
  const outputTitles = { agent: "runAgentOutputTitle", graph: "runGraphOutputTitle", workflow: "runWorkflowOutputTitle" };
  for (const direction of ["output", "input"]) {
    const channel = run[direction];
    const section = createRunChannel(direction, translate(direction === "input" ? "runInputTitle"
      : outputTitles[currentProjection?.document.kind] || "runOutputTitle"));
    section.dataset.runChannel = direction;
    section.dataset.availability = channel.availability;
    if (!channel.items.length) section.append(htmlElement("small", "run-value-state", translate("runMissingValue")));
    for (const item of channel.items) appendRunValue(section, item);
    exchange.append(section);
  }
  ui.runResultSummary.append(exchange);

  if (run.issues.length) {
    const issues = htmlElement("div", "run-result-issues");
    for (const issue of run.issues) {
      const item = htmlElement("section", "run-result-issue");
      item.dataset.runIssue = issue.kind;
      item.dataset.recovered = String(issue.recovered);
      const title = issue.kind === "interruption" ? "runInterruptionIssue"
        : issue.recovered ? "runRecoveredIssue" : issue.scope === "step" && run.result.state === "success" ? "localFailureRunSucceeded"
          : issue.scope === "step" ? "runStepIssue" : "runResultIssue";
      const sourceNode = issue.scope === "step" && explanation.nodes.find(({ id }) => id === issue.nodeId);
      const stepLabel = sourceNode && sourcePresentation(sourceNode).title;
      item.append(htmlElement("h3", "", `${translate(title)}${stepLabel ? ` · ${stepLabel}` : ""}`));
      appendRunValue(item, issueReadingValue(issue), { fold: true });
      if (issue.nodeId && explanation.nodes.some(({ id }) => id === issue.nodeId)) {
        const locate = htmlElement("button", "issue-locate", translate("locateIssue"));
        locate.type = "button";
        locate.dataset.runIssueStep = issue.nodeId;
        locate.dataset.issueStep = issue.nodeId;
        item.append(locate);
      }
      issues.append(item);
    }
    if (["failed", "cancelled", "interrupted"].includes(run.result.state)) ui.runResultSummary.insertBefore(issues, exchange);
    else {
      const disclosure = htmlElement("details", "run-issue-disclosure");
      disclosure.append(htmlElement("summary", "", translate("runIssues", { count: run.issues.length })), issues);
      ui.runResultSummary.append(disclosure);
    }
  }
  if (currentObjectKind === "workflow") ui.runResultSummary.append(information);
  rememberDisclosures(ui.runResultSummary, "run");
}

function renderExplanationOverview(explanation, { activate = false } = {}) {
  const content = htmlElement("div", "node-detail-content explanation-overview");
  const scopedIds = currentScopeReading?.mode !== "all" && currentScopeReading ? new Set(currentScopeReading.nodeIds) : undefined;
  const highlights = sourceHighlights(scopedIds ? { ...explanation, nodes: explanation.nodes.filter(({ id }) => scopedIds.has(id)) } : explanation);
  const hero = htmlElement("div", "node-detail-hero source-overview-hero");
  hero.append(htmlElement("h3", "", translate("explanationOverview")));
  content.append(hero);
  const section = htmlElement("section", "node-detail-section source-highlight-section");
  section.append(htmlElement("h4", "", translate("whatHappened")));
  const list = htmlElement("div", "explanation-node-list");
  for (const { node, presentation } of highlights.slice(0, 100)) {
    const button = htmlElement("button", "explanation-node-button");
    button.type = "button";
    button.dataset.explanationNode = node.id;
    const stateNode = currentExecutionDAG?.nodes.find(({ id }) => id === node.id) || { status: node.status, metadata: node.technical?.metadata };
    if (stateNode.metadata?.executionState) button.dataset.executionState = stateNode.metadata.executionState;
    button.append(
      htmlElement("strong", "", presentation.overviewLabel),
    );
    if (presentation.overviewValue) button.append(htmlElement("small", "", presentation.overviewValue));
    if (currentObjectKind === "graph" ? !confirmedStepSuccess(stateNode) : stateNode.status !== "declared") button.append(htmlElement("small", `step-state ${stateNode.status}`, stepStatusLabel(stateNode)));
    button.setAttribute("aria-label", `${translate("inspectExplanationNode")}: ${presentation.overviewLabel}`);
    list.append(button);
  }
  section.append(list);
  if (highlights.length > 100) section.append(htmlElement("p", "node-detail-note", translate("overviewLimited")));
  content.append(section);
  if (currentObjectKind === "workflow") {
  const disclosure = htmlElement("details", "technical-disclosure overview-technical");
  disclosure.append(htmlElement("summary", "", translate("technicalDetails")));
  const technicalBody = htmlElement("div", "technical-disclosure-body");
  const facts = htmlElement("dl", "node-facts explanation-stats");
  appendNodeFact(facts, translate("explainedNodes"), highlights.length);
  appendNodeFact(facts, translate("nodeRelationships"), scopedIds ? currentScopeReading.execution?.edges.length ?? 0 : explanation.statistics.edgeCount);
  appendNodeFact(facts, "TOOL CALLS", scopedIds ? explanation.nodes.filter((node) => scopedIds.has(node.id) && node.kind === "tool").length : explanation.statistics.toolCallCount);
  appendNodeFact(facts, translate("explanationEvidence"), scopedIds ? currentScopeReading.evidenceEnvelopeIndexes.length : explanation.statistics.evidenceCount);
  technicalBody.append(facts);
  if (explanation.limitations?.length) {
    const limits = htmlElement("section", "node-detail-section explanation-limits");
    limits.append(htmlElement("h4", "", translate("explanationLimits")));
    const listElement = htmlElement("ul", "");
    for (const limitation of explanation.limitations) listElement.append(htmlElement("li", "", limitation));
    limits.append(listElement);
    technicalBody.append(limits);
  }
  disclosure.append(technicalBody);
  content.append(disclosure);
  }
  ui.nodeDetail.replaceChildren(content);
  selectedNodeDetail = undefined;
  selectedRenderedNode = undefined;
  if (activate) inspectorPanel("node");
}

// Scan JSON syntax, not repeated field values. Offsets remain correct for compact
// JSON, escaped strings, nested "kind" fields, and equal observed timestamps.
function envelopeSourceRanges(text) {
  let offset = 0;
  const whitespace = () => { while (/\s/.test(text[offset] || "") && offset < text.length) offset += 1; };
  function stringEnd() {
    offset += 1;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === "\\") offset += 1;
      else if (char === '"') return;
    }
  }
  function value() {
    whitespace();
    if (text[offset] === '"') { stringEnd(); return; }
    if (text[offset] === "[" || text[offset] === "{") {
      const close = text[offset++] === "[" ? "]" : "}";
      whitespace();
      while (offset < text.length && text[offset] !== close) {
        if (text[offset] === "," || text[offset] === ":") offset += 1;
        else value();
        whitespace();
      }
      offset += 1;
      return;
    }
    while (offset < text.length && !/[\s,\]}]/.test(text[offset])) offset += 1;
  }
  function array() {
    const ranges = [];
    offset += 1;
    whitespace();
    while (offset < text.length && text[offset] !== "]") {
      const start = offset;
      value();
      ranges.push({ start, end: offset });
      whitespace();
      if (text[offset] === ",") { offset += 1; whitespace(); }
    }
    offset += 1;
    return ranges;
  }
  whitespace();
  const rootStart = offset;
  if (text[offset] === "[") return array();
  if (text[offset] !== "{") { value(); return [{ start: rootStart, end: offset }]; }
  offset += 1;
  let evidenceRanges;
  whitespace();
  while (offset < text.length && text[offset] !== "}") {
    const keyStart = offset;
    stringEnd();
    const key = JSON.parse(text.slice(keyStart, offset));
    whitespace();
    offset += 1;
    whitespace();
    if (key === "evidence") {
      evidenceRanges = text[offset] === "[" ? array() : undefined;
      if (!evidenceRanges) value();
    } else value();
    whitespace();
    if (text[offset] === ",") { offset += 1; whitespace(); }
  }
  return evidenceRanges || [{ start: rootStart, end: offset + 1 }];
}

function showAcceptedRecordInEditor() {
  if (ui.editor.value === currentDocumentText) return;
  let matches = false;
  try { matches = JSON.stringify(parseRecordJSON(ui.editor.value)) === currentDocumentJSON; } catch { /* retain draft */ }
  if (!matches) {
    savedDraftText = ui.editor.value;
    ui.restoreDraft.hidden = false;
    ui.editor.value = currentDocumentText;
    ui.editor.readOnly = true;
    ui.importStatus.textContent = translate("showingAcceptedRecord");
    ui.importStatus.dataset.error = "false";
  }
}

function locateEnvelopeInEditor(index) {
  if (currentObjectKind !== "workflow") return;
  if (!sourceEnvelope(index)) return;
  if (currentScopeReading?.mode !== "all" && !currentScopeReading?.evidenceEnvelopeIndexes.includes(index)) {
    selectInspectionGroup(undefined);
  }
  showAcceptedRecordInEditor();
  if (editorRangeCache?.text !== ui.editor.value) editorRangeCache = { text: ui.editor.value, ranges: envelopeSourceRanges(ui.editor.value) };
  const range = editorRangeCache.ranges[index];
  if (!range) return;
  inspectorPanel("raw");
  ui.editor.dataset.selectedEnvelopeIndex = String(index);
  ui.editor.focus({ preventScroll: true });
  ui.editor.setSelectionRange(range.start, range.end);
}

function activePathRenderer() { return graphTopologyInstance || workflowInstance; }

function activateReadingPath(executionId, path = [executionId]) {
  if (graphTopologyInstance) {
    const id = currentGraphTopology.nodeIdByExecutionId.get(executionId)
      || (!currentExecutionDAG && currentInspection?.getNode(executionId)?.technical?.metadata?.sourceNodeId);
    graphTopologyInstance.setActiveNodePath(id ? [id] : null);
    return;
  }
  const graphId = currentObjectKind === "graph" && currentGraphReading?.nodeIdByExecutionId.get(executionId);
  workflowInstance?.setActiveNodePath(graphId ? [graphId] : path.slice(currentSnapshotPrefix.length));
}

function graphVisitIds(executionId) {
  if (currentObjectKind !== "graph") return [];
  const reading = currentGraphTopology || currentGraphReading;
  const graphId = reading?.nodeIdByExecutionId.get(executionId);
  return reading?.memberIdsByNodeId.get(graphId) || [];
}

function appendGraphVisitPicker(content, executionId) {
  const members = graphVisitIds(executionId);
  if (members.length < 2) return;
  const label = htmlElement("label", "graph-visit-picker");
  label.append(htmlElement("span", "", translate("graphVisit")));
  const select = htmlElement("select");
  select.dataset.graphVisit = "";
  select.setAttribute("aria-label", translate("graphVisit"));
  for (const id of members) {
    const node = currentInspection.getNode(id);
    const state = currentExecutionDAG.nodes.find((item) => item.id === id);
    const sourceLabel = Number.isSafeInteger(state?.sequence)
      ? `${currentLanguage === "zh" ? "记录" : "Record"} #${state.sequence}` : id;
    const option = htmlElement("option", "", [currentInvocationLabels.get(id) || sourceLabel,
      !confirmedStepSuccess(state) && stepStatusLabel(state), recordedTimingText(node?.timing)].filter(Boolean).join(" · "));
    option.value = id;
    select.append(option);
  }
  select.value = executionId;
  label.append(select);
  content.append(label);
}

function readingPresentationSnapshot(snapshot) {
  const timings = new Map((currentExplanation?.nodes || []).map((node) => [node.id, node.timing]));
  const invocations = new Map(currentInvocationLabels);
  const identities = new Map(currentIdentityLabels);
  if (currentObjectKind === "graph") for (const [id, members] of currentGraphReading?.memberIdsByNodeId || []) {
    if (members.length === 1) {
      if (members[0] !== id) {
        timings.set(id, timings.get(members[0]));
        invocations.set(id, invocations.get(members[0]));
        identities.set(id, identities.get(members[0]));
      }
      continue;
    }
    timings.delete(id);
    invocations.delete(id);
    identities.delete(id);
  }
  const presented = workflowPresentationSnapshot(snapshot, currentLanguage, timings, invocations, identities);
  if (currentObjectKind !== "graph") return presented;
  return { ...presented, workflow: { ...presented.workflow, nodes: presented.workflow.nodes.map((node) => {
    const members = currentGraphReading?.memberIdsByNodeId.get(node.id);
    if (!members || members.length < 2) return node;
    const counts = node.metadata.graphReading.statusCounts;
    const states = Object.entries(counts).filter(([state]) => state !== "success").map(([state, count]) =>
      state === "failed" ? translate("graphFailedCalls", { count }) : `${count} · ${stepStatusLabel({ status: state })}`);
    const presentation = { ...node.metadata.einoViewerPresentation, invocation: translate("graphCalls", { count: members.length }), state: states.join(" · ") };
    delete presentation.timing;
    // Aggregate labels describe the group, never the first visit's outcome or duration.
    return { ...node, name: [presentation.name, presentation.invocation, presentation.state].filter(Boolean).join(" · "),
      metadata: { ...node.metadata, einoViewerPresentation: presentation } };
  }) } };
}

function mountWorkflow(snapshot) {
  workflowInstance = workflowAPI.createWorkflowDAG(ui.host, {
    snapshot: readingPresentationSnapshot(snapshot),
    direction: currentDirection,
    theme: readingGraphTheme(),
    locale: rendererLocales[currentLanguage],
    expanded: subgraphPaths(snapshot.workflow),
    activeNodePath: null,
    nodeLabelFormatter: workflowNodeLabel,
    accessibilityLabelFormatter: (summary, visible) => workflowAccessibilityLabel(summary, visible, currentLanguage),
    onNodeClick(node) {
      const members = currentObjectKind === "graph" && currentGraphReading?.memberIdsByNodeId.get(node.id);
      if (members?.length) {
        const selectedId = selectedNodeDetail?.explanationNode?.id;
        const memberNodes = members.map((id) => currentExecutionDAG.nodes.find((entry) => entry.id === id));
        const id = members.includes(selectedId) ? selectedId
          : memberNodes.find((entry) => entry.status === "failed")?.id
            || memberNodes.find((entry) => !confirmedStepSuccess(entry))?.id || members[0];
        jumpToInspectionStep(id, document.activeElement, { scroll: ui.workbench.getBoundingClientRect().width < 1200 });
        scheduleDiagnostics();
        return;
      }
      workflowInstance.setActiveNodePath(node.path);
      selectedPathIsPrompt = false;
      renderNodeDetail({ ...node, path: [...currentSnapshotPrefix, ...node.path] });
      ui.selectedPath.textContent = selectedNodeDetail?.presentation?.title || node.name || node.path.join(" / ");
      scheduleDiagnostics();
    },
    onEdgeClick(edge) {
      selectedPathIsPrompt = false;
      ui.selectedPath.textContent = `${edge.source.join(" / ")} → ${edge.target.join(" / ")}`;
    },
    onExpandedChange: scheduleDiagnostics,
    onError(error) { setRenderState("invalid", "rendererError", null, {}, error.message); },
  });
}

function cancelPathMount() {
  pathMountRevision += 1;
  cancelAnimationFrame(workflowMountFrame);
  workflowMountFrame = undefined;
  workflowMountObserver?.disconnect();
  workflowMountObserver = undefined;
}

function schedulePathSelectionReveal() {
  cancelAnimationFrame(workflowRevealFrame);
  const record = currentDocument;
  const snapshot = currentSnapshot;
  const id = selectedNodeDetail?.explanationNode?.id;
  workflowRevealFrame = requestAnimationFrame(() => {
    if (!id || record !== currentDocument || snapshot !== currentSnapshot
      || id !== selectedNodeDetail?.explanationNode?.id || inspectorPresentationLocked
      || ui.inspector.hidden || ui.nodeDetail.hidden || ui.host.hidden || !ui.host.isConnected) return;
    // The detail column has taken its final width. Refresh native dimensions
    // and pan only an out-of-view selection; never fit or change the zoom.
    revealViewerSelection(activePathRenderer());
  });
}

function readingGraphTheme() {
  return { base: currentTheme, tokens: { canvas: { bg: "#F3F6FA" }, node: {
    width: 212, height: 88, textMaxWidth: 192, fontSize: 13, fontWeight: 500,
  } } };
}

function whenPathReady(action) {
  cancelPathMount();
  const record = currentDocument;
  const mountRevision = pathMountRevision;
  const attempt = () => {
    if (mountRevision !== pathMountRevision || record !== currentDocument || !currentDocument) return;
    if (!ui.host.isConnected || !ui.host.clientWidth || !ui.host.clientHeight) return;
    cancelPathMount();
    action();
    updateRunViewTabs();
  };
  const schedule = () => {
    if (mountRevision !== pathMountRevision || record !== currentDocument || !currentDocument
      || workflowMountFrame !== undefined) return;
    // Resize notifications only request work. Mounting or updating the graph
    // inside that notification can feed dimensions back into the same pass.
    workflowMountFrame = requestAnimationFrame(() => {
      workflowMountFrame = undefined;
      attempt();
    });
  };
  workflowMountObserver = new ResizeObserver(schedule);
  workflowMountObserver.observe(ui.host);
  schedule();
}

function scheduleDiagnostics() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!workflowInstance || ui.host.hidden) return;
    const diagnostics = workflowInstance.getDiagnostics();
    ui.layouts.textContent = String(diagnostics.layoutRuns);
    ui.patches.textContent = String(diagnostics.dataPatches);
    ui.cache.textContent = String(diagnostics.layoutCacheHits);
  }));
}

function setMetricLabels(keys) {
  [ui.layouts, ui.patches, ui.cache].forEach((value, index) => {
    value.previousElementSibling.textContent = translate(keys[index]);
  });
}

function showWorkflow(snapshot, { fit = true, pathPrefix = [], graphViewport } = {}) {
  graphTopologyInstance?.destroy();
  graphTopologyInstance = undefined;
  if (graphViewerInstance) {
    graphViewerInstance.destroy();
    graphViewerInstance = undefined;
    workflowInstance = undefined;
  }
  ui.domainView.hidden = true;
  ui.host.hidden = false;
  ui.workflowControls.hidden = false;
  setMetricLabels(["layouts", "patches", "cacheHits"]);
  currentSnapshot = snapshot;
  currentSnapshotPrefix = pathPrefix;
  clearNodeDetail();
  const applySnapshot = () => {
    if (!workflowInstance) mountWorkflow(snapshot);
    else workflowInstance.update(readingPresentationSnapshot(snapshot), { preserveExpanded: true, fit });
    workflowInstance.setActiveNodePath(null);
    restorePathSelection();
    if (fit) workflowInstance.resetView();
    // Translation can relayout nodes even with fit disabled. Restore only
    // after the guarded deferred update and selection have both completed.
    if (graphViewport) {
      restoreViewerLayout(workflowInstance, graphViewport.layout);
      restoreViewerViewport(workflowInstance, graphViewport);
    }
    scheduleDiagnostics();
  };
  whenPathReady(applySnapshot);
  clearNodePointerState();
  if (currentExplanation) renderExplanationOverview(currentExplanation);
  const counts = graphCounts(snapshot.workflow);
  const outcomes = snapshot.execution?.nodes?.length || 0;
  setRenderState("valid", "snapshotRendered", "renderSummary", { nodes: counts.nodes, edges: counts.edges, outcomes });
  showIssues([], { key: "validSnapshot", params: {} });
}

function selectGraphDefinition(node, { activate = true } = {}) {
  // A declared but unobserved branch has no invocation body to borrow. Keep
  // its definition separate from both the run's result and actual step data.
  clearLinkedSelection();
  if (!currentExecutionDAG) {
    renderNodeDetail({ id: node.definitionId, path: node.path, name: node.name,
      component: node.component, kind: "graph", status: "declared", metadata: node.definition?.metadata || {} }, { activate });
  } else {
    const content = htmlElement("div", "node-detail-content");
    const hero = htmlElement("div", "node-detail-hero");
    hero.append(htmlElement("h3", "", node.name), htmlElement("p", "step-state", currentLanguage === "zh" ? "未观测到执行" : "No execution observed"));
    content.append(hero);
    ui.nodeDetail.replaceChildren(content);
    selectedNodeDetail = { graphDefinitionNodeId: node.id };
    markInspectionSelection();
    if (activate) inspectorPanel("node");
  }
  selectedNodeDetail.graphDefinitionNodeId = node.id;
  graphTopologyInstance?.setActiveNodePath([node.id]);
  selectedPathIsPrompt = false;
  ui.selectedPath.textContent = node.name;
}

function selectGraphEdge(edge, model, { activate = true } = {}) {
  // A connection belongs to the definition, not an observed invocation. It
  // must not retain the previous step's input/output, status, or evidence.
  clearLinkedSelection();
  selectedRenderedNode = undefined;
  selectedNodeDetail = { graphEdgeId: edge.id, graphDefinitionEdge: edge };
  const endpointName = (id) => {
    const node = model.nodes.find((entry) => entry.id === id);
    if (node.kind === "start") return currentLanguage === "zh" ? "开始" : "Start";
    if (node.kind === "end") return currentLanguage === "zh" ? "结束" : "End";
    return node.name || node.id;
  };
  const name = `${endpointName(edge.from)} → ${endpointName(edge.to)}`;
  const content = htmlElement("div", "node-detail-content");
  const hero = htmlElement("div", "node-detail-hero");
  hero.append(htmlElement("h3", "", name), htmlElement("p", "step-state",
    `${translate(edge.kind === "branch" ? "graphBranch" : "graphConnection")} · ${translate("graphDefinition")}`));
  content.append(hero);
  ui.nodeDetail.replaceChildren(content);
  markInspectionSelection();
  graphTopologyInstance?.setActiveEdge(edge.id);
  selectedPathIsPrompt = false;
  ui.selectedPath.textContent = name;
  inspectorPanel("node", { reveal: activate });
}

function showGraphTopology(model, { graphViewport, previousDefinitionId, previousEdgeId } = {}) {
  workflowInstance?.destroy();
  workflowInstance = undefined;
  graphViewerInstance?.destroy();
  graphViewerInstance = undefined;
  graphTopologyInstance?.destroy();
  graphTopologyInstance = undefined;
  currentSnapshot = undefined;
  currentSnapshotPrefix = [];
  ui.domainView.hidden = true;
  ui.host.hidden = false;
  ui.workflowControls.hidden = true;
  clearNodeDetail();
  whenPathReady(() => {
    graphTopologyInstance = createGraphTopologyView(ui.host, model, {
      locale: currentLanguage,
      onNodeClick({ id, node }) {
        rememberInspectorTrigger(document.activeElement);
        const members = model.memberIdsByNodeId.get(id) || [];
        if (members.length) {
          const selected = selectedNodeDetail?.explanationNode?.id;
          const visits = members.map((member) => currentExecutionDAG.nodes.find((entry) => entry.id === member));
          const target = members.includes(selected) ? selected
            : visits.find((entry) => entry.status === "failed")?.id
              || visits.find((entry) => !confirmedStepSuccess(entry))?.id || members[0];
          jumpToInspectionStep(target, document.activeElement, { scroll: ui.workbench.getBoundingClientRect().width < 1200 });
        } else {
          selectGraphDefinition(node);
          if (ui.workbench.getBoundingClientRect().width < 1200) ui.inspectorTitle.scrollIntoView({ block: "start" });
        }
      },
      onEdgeClick({ edge }) {
        rememberInspectorTrigger(document.activeElement);
        selectGraphEdge(edge, model);
      },
    });
    restorePathSelection();
    if (previousDefinitionId) {
      const node = model.nodes.find((entry) => entry.id === previousDefinitionId);
      if (node) selectGraphDefinition(node, { activate: false });
    }
    if (selectedNodeDetail?.graphEdgeId) graphTopologyInstance.setActiveEdge(selectedNodeDetail.graphEdgeId);
    if (graphViewport) restoreViewerViewport(graphTopologyInstance, graphViewport);
  });
  if (currentExplanation) renderExplanationOverview(currentExplanation);
  const previousEdge = model.edges.find(({ id }) => id === previousEdgeId);
  // Restore text synchronously as well as selection after mounting: locale
  // refresh and collapsed/hidden canvases must not leave stale step details.
  if (previousEdge) selectGraphEdge(previousEdge, model, { activate: false });
  setRenderState("valid", "snapshotRendered", "renderSummary", {
    nodes: model.nodes.length, edges: model.edges.length, outcomes: currentExecutionDAG?.nodes.length || 0,
  });
}

function appendBadge(parent, value, tone = "") {
  parent.append(htmlElement("span", `data-badge ${tone}`.trim(), value));
}

function appendKeyValue(parent, key, value) {
  const row = htmlElement("div", "kv-row");
  row.append(htmlElement("dt", "", key));
  row.append(htmlElement("dd", "", typeof value === "string" ? value : JSON.stringify(value)));
  parent.append(row);
}

function jsonTree(value, label = "root", depth = 0) {
  const complex = value !== null && typeof value === "object";
  if (!complex) {
    const row = htmlElement("div", "tree-leaf");
    row.append(htmlElement("span", "tree-key", label), htmlElement("code", "", JSON.stringify(value)));
    return row;
  }
  const details = htmlElement("details", "tree-branch");
  details.open = depth < 2;
  const count = Array.isArray(value) ? `${value.length} items` : `${Object.keys(value).length} fields`;
  const summary = htmlElement("summary", "");
  summary.append(htmlElement("span", "tree-key", label), htmlElement("small", "", count));
  details.append(summary);
  const body = htmlElement("div", "tree-body");
  const keys = Object.keys(value);
  let shown = 0;
  const more = htmlElement("button", "evidence-action", translate("inspectionMore"));
  more.type = "button";
  function appendPage() {
    more.remove();
    const end = Math.min(shown + 50, keys.length);
    while (shown < end) {
      const key = keys[shown++];
      body.append(jsonTree(value[key], key, depth + 1));
    }
    if (shown < keys.length) body.append(more);
  }
  more.addEventListener("click", appendPage);
  if (details.open) appendPage();
  details.addEventListener("toggle", () => { if (details.open && shown === 0) appendPage(); });
  details.append(body);
  return details;
}

function renderTrace(outputs) {
  const view = htmlElement("section", "trace-view standard-panel");
  const list = htmlElement("ol", "trace-list");
  for (const output of outputs) {
    const event = output.event;
    const item = htmlElement("li", `trace-event phase-${event.phase}`);
    const heading = htmlElement("header", "");
    heading.append(htmlElement("span", "sequence", String(event.sequence).padStart(2, "0")), htmlElement("h3", "", event.run?.name || event.phase));
    appendBadge(heading, event.phase, event.phase === "error" ? "danger" : "");
    if (event.streaming) appendBadge(heading, "STREAM", "cyan");
    item.append(heading, htmlElement("p", "mono-path", (event.address || []).map((part) => `${part.type}:${part.id}`).join(" / ")));
    if (event.error) item.append(htmlElement("p", "event-error", event.error.message));
    list.append(item);
  }
  view.append(list);
  return view;
}

function renderConversation(output) {
  const message = output.message;
  const view = htmlElement("section", "conversation-view standard-panel");
  const header = htmlElement("header", "conversation-header");
  header.append(htmlElement("span", "avatar", (message.role || "?").slice(0, 1).toUpperCase()), htmlElement("div", ""));
  header.lastChild.append(htmlElement("h3", "", message.role || "message"), htmlElement("small", "", output.format));
  view.append(header);
  if (message.content) view.append(htmlElement("p", "message-copy", message.content));
  if (message.content_blocks) view.append(jsonTree(message.content_blocks, "content_blocks"));
  if (message.tool_calls) view.append(jsonTree(message.tool_calls, "tool_calls"));
  return view;
}

function renderTool(output) {
  const tool = output.tool;
  const view = htmlElement("section", "tool-view standard-panel");
  const header = htmlElement("header", "object-heading");
  header.append(htmlElement("span", "object-icon", "ƒ"), htmlElement("div", ""));
  header.lastChild.append(htmlElement("h3", "", tool.name), htmlElement("p", "", tool.desc || ""));
  view.append(header);
  const params = htmlElement("div", "parameter-list");
  for (const [name, definition] of Object.entries(tool.params || {})) {
    const row = htmlElement("article", "parameter-row");
    row.append(htmlElement("code", "", name), htmlElement("span", "", definition.Type || "any"), htmlElement("p", "", definition.Desc || ""));
    if (definition.Required) appendBadge(row, "REQUIRED", "amber");
    params.append(row);
  }
  view.append(params);
  return view;
}

function renderDocument(output) {
  const documentValue = output.document;
  const view = htmlElement("section", "document-view standard-panel");
  const header = htmlElement("header", "object-heading");
  header.append(htmlElement("span", "object-icon", "§"), htmlElement("div", ""));
  header.lastChild.append(htmlElement("h3", "", documentValue.id || "document"), htmlElement("p", "", `${String(documentValue.content || "").length} characters`));
  view.append(header, htmlElement("blockquote", "document-copy", documentValue.content || ""));
  const metadata = htmlElement("dl", "metadata-grid");
  for (const [key, value] of Object.entries(documentValue.meta_data || {})) appendKeyValue(metadata, key, value);
  view.append(metadata);
  return view;
}

function renderComponent(output) {
  const event = output.event;
  const view = htmlElement("section", "component-view standard-panel");
  const header = htmlElement("header", "component-heading");
  const title = htmlElement("div", "");
  title.append(htmlElement("span", "component-glyph", "IO"), htmlElement("div", ""));
  title.lastChild.append(htmlElement("h3", "", event.component), htmlElement("p", "", event.format));
  header.append(title);
  appendBadge(header, event.streaming ? "STREAM" : event.direction.toUpperCase(), event.streaming ? "cyan" : "");
  view.append(header, htmlElement("p", "mono-path", (event.address || []).map((part) => `${part.type}:${part.id}`).join(" / ")));
  const meta = htmlElement("dl", "metadata-grid");
  appendKeyValue(meta, "name", event.name || "—");
  appendKeyValue(meta, "type", event.type || "—");
  appendKeyValue(meta, "run", output.runId || "—");
  view.append(meta);
  if (event.body !== undefined) view.append(jsonTree(event.body, "body"));
  else view.append(htmlElement("p", "stream-notice", "Live reader intentionally omitted · boundary metadata only"));
  return view;
}

function renderInspector(output) {
  const view = htmlElement("section", "inspector-view standard-panel");
  view.append(jsonTree(output.envelope, "envelope"));
  return view;
}

function renderWorkflowSummary(output) {
  const view = htmlElement("section", "workflow-summary-view standard-panel");
  const counts = graphCounts(output.workflow);
  const header = htmlElement("header", "object-heading");
  header.append(htmlElement("span", "object-icon", "◇"), htmlElement("div", ""));
  header.lastChild.append(
    htmlElement("h3", "", output.workflow.name || "workflow"),
    htmlElement("p", "", `${counts.nodes} nodes · ${counts.edges} edges`),
  );
  view.append(header);
  const nodes = htmlElement("div", "workflow-node-strip");
  for (const node of output.workflow.nodes.slice(0, 8)) appendBadge(nodes, node.id, node.kind === "llm" ? "cyan" : "");
  if (output.workflow.nodes.length > 8) appendBadge(nodes, `+${output.workflow.nodes.length - 8}`);
  view.append(nodes);
  return view;
}

function renderSingleOutput(output) {
  if (output?.schemaVersion === 1 && output?.workflow) return renderWorkflowSummary(output);
  if (output.type === "trace") return renderTrace([output]);
  if (output.type === "conversation") return renderConversation(output);
  if (output.type === "tool") return renderTool(output);
  if (output.type === "data-flow") return renderDocument(output);
  if (output.type === "component-io") return renderComponent(output);
  return renderInspector(output);
}

function renderScenarioRoute(item, documentValue) {
  const route = htmlElement("section", "scenario-route");
  const header = htmlElement("header", "scenario-route-heading");
  const title = htmlElement("div", "");
  title.append(
    htmlElement("span", "scenario-kicker", translate("combinedScenario")),
    htmlElement("h3", "", item?.labelKey ? translate(item.labelKey) : item?.label || translate("combinedScenario")),
  );
  const runIds = [...new Set((Array.isArray(documentValue) ? documentValue : [])
    .map((entry) => entry?.correlation?.runId)
    .filter(Boolean))];
  const uniqueDomains = new Set(item?.domains || []);
  const stats = htmlElement("div", "scenario-stats");
  appendBadge(stats, `${uniqueDomains.size} ${translate("scenarioDomains")}`, "cyan");
  appendBadge(stats, `${runIds.length} ${translate("scenarioRuns")}`);
  header.append(title, stats);
  route.append(header);

  if (item?.story) {
    const story = htmlElement("section", "scenario-story");
    story.append(htmlElement("p", "scenario-story-proof", translate(item.story.kickerKey)));
    const exchange = htmlElement("div", "scenario-story-exchange");
    const question = htmlElement("article", "scenario-story-message question");
    question.append(htmlElement("span", "", translate("scenarioQuestion")), htmlElement("p", "", translate(item.story.questionKey)));
    const answer = htmlElement("article", "scenario-story-message answer");
    answer.append(htmlElement("span", "", translate("scenarioAnswer")), htmlElement("p", "", translate(item.story.answerKey)));
    exchange.append(question, htmlElement("span", "scenario-story-arrow", "→"), answer);
    story.append(exchange);
    route.append(story);
  }

  const track = htmlElement("ol", "scenario-track");
  track.setAttribute("aria-label", translate("combinedScenario"));
  for (const [index, domain] of (item?.domains || []).entries()) {
    const step = htmlElement("li", "scenario-step");
    step.append(
      htmlElement("span", "", String(index + 1).padStart(2, "0")),
      htmlElement("strong", "", item.steps?.[index] ? translate(item.steps[index]) : domain),
      htmlElement("code", "", domain),
    );
    track.append(step);
  }
  route.append(track);
  if (runIds.length > 0) route.append(htmlElement("p", "scenario-run-list", runIds.join(" · ")));
  return route;
}

function renderScenarioOutputs(outputs, projections) {
  const stack = htmlElement("div", "scenario-output-stack");
  const documents = Array.isArray(currentDocument) ? currentDocument : [];
  for (const [index, output] of outputs.entries()) {
    const frame = htmlElement("article", "scenario-output");
    const heading = htmlElement("header", "scenario-output-heading");
    const identity = htmlElement("div", "scenario-output-identity");
    const item = selectedFixture();
    identity.append(
      htmlElement("strong", "", item?.steps?.[index] ? translate(item.steps[index]) : (documents[index]?.kind || "unknown")),
      htmlElement("code", "", documents[index]?.kind || "unknown"),
    );
    heading.append(
      htmlElement("span", "scenario-output-index", String(index + 1).padStart(2, "0")),
      identity,
      htmlElement("small", "", projections[index]?.viewId || "view"),
    );
    frame.append(heading, renderSingleOutput(output));
    stack.append(frame);
  }
  return stack;
}

function renderStandardOutputs(outputs, viewId, projections = []) {
  clearNodeDetail();
  ui.host.hidden = true;
  ui.domainView.hidden = false;
  ui.workflowControls.hidden = true;
  setMetricLabels(["items", "renders", "viewMetric"]);
  ui.domainView.replaceChildren();
  ui.domainView.dataset.viewId = viewId;
  const types = new Set(outputs.map((output) => output?.type || "inspector"));
  const type = types.size === 1 ? [...types][0] : "mixed";
  ui.domainView.dataset.viewType = type;
  let rendered;
  if (currentMode === "scenario") {
    ui.domainView.dataset.scenarioId = selectedFixture()?.id || "custom";
    ui.domainView.append(renderScenarioRoute(selectedFixture(), currentDocument));
    rendered = renderScenarioOutputs(outputs, projections);
  } else {
    delete ui.domainView.dataset.scenarioId;
    if (type === "trace") rendered = renderTrace(outputs);
    else if (outputs.length === 1) rendered = renderSingleOutput(outputs[0]);
    else {
      rendered = htmlElement("div", "output-stack");
      for (const output of outputs) rendered.append(renderSingleOutput(output));
    }
  }
  ui.domainView.append(rendered);
  if (currentExplanation) renderExplanationOverview(currentExplanation);
  ui.layouts.textContent = String(outputs.length);
  ui.patches.textContent = "1";
  ui.cache.textContent = type.toUpperCase();
}

function trajectoryStatusLabel(status) {
  if (status === "declared") return translate("hierarchyDeclared");
  return translate(`trajectory${status[0].toUpperCase()}${status.slice(1)}`);
}

function stepStatusLabel(record) {
  const metadata = record.metadata || record.technical?.metadata || {};
  if (metadata.agentScopeUnresolved && record.status !== "failed") return translate("unconfirmedScopeState");
  const key = { planned: "stepPlanned", interrupted: "stepInterrupted", unrecorded: "stepUnrecorded" }[metadata.executionState];
  return key ? translate(key) : trajectoryStatusLabel(record.status);
}

function confirmedStepSuccess(record) {
  const metadata = record.metadata || record.technical?.metadata || {};
  return record.status === "success" && !metadata.agentScopeUnresolved
    && !["planned", "interrupted", "unrecorded"].includes(metadata.executionState);
}

function hasSingleGraphScope() {
  return currentExplanation?.groups?.length === 1
    && currentInspection.searchSteps("", { ungroupedOnly: true, limit: 1 }).total === 0;
}

function appendTrajectoryValue(parent, label, value, options = {}) {
  const item = htmlElement("div", "trajectory-detail-value");
  if (options.direction) item.dataset.businessChannel = options.direction;
  item.append(htmlElement("small", "", label));
  appendBusinessValue(item, value, { fold: !options.direction, ...options });
  parent.append(item);
  return item;
}

function appendStepScopeContext(content, groups) {
  if (!currentInspection?.groupCount) return;
  if (currentObjectKind === "graph" && hasSingleGraphScope()) return;
  const context = htmlElement("section", "step-scope-context");
  context.append(htmlElement("small", "", currentObjectKind === "graph" ? "Graph" : translate("hierarchyStepScope")));
  for (const group of groups) {
    const action = htmlElement("button", "", currentInspection.getGroupPath(group.id).map(({ label }) => label).join(" / "));
    action.type = "button";
    action.dataset.hierarchyGroup = group.id;
    context.append(action);
  }
  if (!groups.length) context.append(htmlElement("p", "", translate("hierarchyUngrouped")));
  content.append(context);
}

function selectInitialReadingDetail() {
  // Start from the real reading order, without simulating a click, moving focus
  // or scrolling the page to a lower details panel on narrow screens.
  const first = currentInspection && readingSteps("", inspectionRange())[0];
  if (!first) return false;
  selectInspectionStep(first.id, undefined, { activate: false });
  inspectorPanel("node", { reveal: false });
  setInspectorOpen(true);
  return true;
}

function updateRunViewTabs() {
  ui.runViewTabs.hidden = true;
  const graphReading = currentObjectKind === "graph";
  const pathRegion = graphReading ? graphPathRegion : workflowPathRegion;
  if (ui.pathRegion !== pathRegion) {
    ui.pathRegion.replaceWith(pathRegion);
    pathRegion.append(pathCanvas);
    ui.pathRegion = pathRegion;
  }
  const heading = graphReading ? graphPathTitle : pathHeading;
  heading.dataset.i18n = currentObjectKind === "agent" ? "trajectoryView" : graphReading
    ? currentGraphTopology ? "graphFlow" : "graphCallsView" : "pathView";
  heading.textContent = translate(heading.dataset.i18n);
  ui.readerTools.hidden = graphReading;
  if (graphReading) {
    if (ui.diagramTools.parentElement !== graphPathHeader) graphPathHeader.append(ui.diagramTools);
  } else if (ui.diagramTools.parentElement !== ui.readerTools) ui.runViewTabs.after(ui.diagramTools);
  ui.workbench.dataset.readingKind = currentObjectKind;
  const agentReading = currentObjectKind === "agent";
  const readingOnly = currentObjectKind !== "workflow";
  ui.openDetails.hidden = readingOnly;
  ui.openRaw.hidden = readingOnly;
  ui.pasteRecord.hidden = readingOnly;
  if (currentObjectKind === "graph") ui.workflowControls.hidden = true;
  const inspectionTitle = ui.inspection.querySelector(":scope > summary");
  inspectionTitle.dataset.i18n = agentReading ? "agentInspectionTitle" : currentObjectKind === "graph" ? "graphInspectionTitle" : "inspectionTitle";
  inspectionTitle.textContent = translate(inspectionTitle.dataset.i18n);
  const searchLabel = ui.inspectionSearch.closest("label").querySelector("span");
  searchLabel.dataset.i18n = readingOnly ? "agentInspectionSearch" : "inspectionSearch";
  searchLabel.textContent = translate(searchLabel.dataset.i18n);
  ui.inspectionSearch.dataset.i18nAriaLabel = searchLabel.dataset.i18n;
  ui.inspectionSearch.setAttribute("aria-label", searchLabel.textContent);
  ui.inspectionSearch.placeholder = searchLabel.textContent;
  const inspectionMode = ui.inspectionScope.value;
  ui.inspectionScope.replaceChildren(...inspectionOptions.filter((option) => !readingOnly || ["steps", "issues"].includes(option.value)));
  for (const option of ui.inspectionScope.options) option.textContent = translate(option.dataset.i18n);
  ui.inspectionScope.value = currentObjectKind === "graph" || readingOnly && !["steps", "issues"].includes(inspectionMode) ? "steps" : inspectionMode;
  ui.inspectionScope.closest("label").hidden = currentObjectKind === "graph";
  ui.inspectionScope.disabled = currentObjectKind === "graph";
  inspectorPanel(ui.editorWrap.hidden ? "node" : "raw", { reveal: false });
  if (agentReading) {
    ui.readingSidebar.remove();
    ui.globalSummary.remove();
    if (ui.scopeResultSummary.hidden) ui.scopeResultSummary.remove();
  } else {
    if (ui.readingSidebar.parentElement !== ui.stage) ui.stage.prepend(ui.readingSidebar);
    ui.globalSummary.append(ui.runResultSummary);
    ui.stage.before(ui.globalSummary);
    ui.pathRegion.before(ui.scopeResultSummary);
    ui.runResultSummary.classList.remove("agent-reading-content");
    ui.scopeResultSummary.classList.remove("agent-reading-content");
  }
  ui.agentRunMeta.hidden = true;
  ui.diagramTools.hidden = ui.host.hidden || !activePathRenderer();
}

function selectRunView(view) {
  const nextView = currentObjectKind === "agent" ? "trajectory" : "path";
  if (nextView === currentRunView) return;
  currentRunView = nextView;
  renderCurrentDocument();
}

function firstEnvelope(documentValue) {
  if (Array.isArray(documentValue)) return documentValue[0];
  if (documentValue?.protocol === "eino-dag") return documentValue;
  return null;
}

function updateSignalBus(documentValue, viewId = "") {
  const evidence = Array.isArray(documentValue?.evidence) ? documentValue.evidence : documentValue;
  const envelope = firstEnvelope(evidence);
  if (Array.isArray(documentValue?.evidence)) {
    ui.signalProtocol.textContent = `${(documentValue.source || documentValue.kind || currentObjectKind).toUpperCase()} RUN`;
    ui.signalKind.textContent = translate("sourceRecords", { count: documentValue.evidence.length });
    ui.signalCorrelation.textContent = documentValue.runId;
  } else if (currentMode === "scenario" && Array.isArray(documentValue)) {
    ui.signalProtocol.textContent = envelope ? `${envelope.protocol.toUpperCase()} / V${envelope.protocolVersion}` : "RUN";
    const domains = new Set(documentValue.map((entry) => entry?.kind).filter(Boolean));
    const runs = new Set(documentValue.map((entry) => entry?.correlation?.runId).filter(Boolean));
    ui.signalKind.textContent = `${domains.size} DOMAINS · ${documentValue.length} ITEMS`;
    ui.signalCorrelation.textContent = `${runs.size} RUN${runs.size === 1 ? "" : "S"}`;
  } else {
    ui.signalProtocol.textContent = envelope ? `${envelope.protocol.toUpperCase()} / V${envelope.protocolVersion}` : "WORKFLOW / V1";
    ui.signalKind.textContent = envelope ? `${envelope.kind}@${envelope.kindVersion}` : "workflow.snapshot@1";
    ui.signalCorrelation.textContent = envelope?.correlation?.runId || documentValue?.execution?.id || viewId || "LOCAL";
  }
}

function showRunState(record, execution) {
  if (!Array.isArray(record?.evidence) || !execution) return;
  const completion = execution.completion || currentProjection?.document?.completion;
  if (completion?.basis !== "recorded" || completion.state !== "ended") {
    setRenderState("incomplete", completion?.state === "open" ? "runIncomplete" : "runCompletionUnknown",
      "runSummary", { steps: execution.nodes?.length || execution.records?.length || 0 });
    updateSignalBus(record);
    return;
  }
  const failed = completion.outcome === "failed";
  const cancelled = completion.outcome === "cancelled";
  const incomplete = completion.outcome === "unknown";
  setRenderState(
    failed ? "invalid" : cancelled || incomplete || completion.capture === "partial" ? "incomplete" : "valid",
    cancelled ? "runCancelled" : failed ? "runFailed" : incomplete ? "runIncomplete"
      : completion.capture === "partial" ? "runCapturePartial" : "runSucceeded",
    "runSummary",
    { steps: execution.nodes?.length || execution.records?.length || 0, records: record.evidence.length },
  );
  updateSignalBus(record);
}

function normalizeDiagnostics(entries) {
  return (entries || []).map((entry) => ({
    severity: entry.severity || "error",
    path: entry.path || "root",
    code: entry.code || "projection.error",
    message: entry.message || String(entry),
  }));
}

function projectEnvelopeCollection(documentValue) {
  const envelopes = Array.isArray(documentValue?.evidence)
    ? documentValue.evidence
    : (Array.isArray(documentValue) ? documentValue : [documentValue]);
  if (ui.view.value === "generic.inspector-v1") {
    const projections = [];
    const diagnostics = [];
    for (const envelope of envelopes) {
      const result = viewRegistry.project(envelope, { viewId: "generic.inspector-v1" });
      if (result.ok) projections.push({ viewId: result.viewId, output: result.output });
      else diagnostics.push(...result.diagnostics);
    }
    return { ok: diagnostics.length === 0, projections, diagnostics };
  }
  return einoAPI.projectEinoDAGEnvelopes(envelopes, { registry: viewRegistry, includeUnknown: true });
}

function rejectDocument(diagnostics) {
  const normalized = normalizeDiagnostics(diagnostics);
  showIssues(normalized);
  ui.importStatus.textContent = inputFailureSummary(diagnostics, currentLanguage, Boolean(currentDocument))
    || translate(currentObjectKind !== "workflow" ? "agentRecordRejected" : "recordRejected");
  ui.importStatus.dataset.error = "true";
  // A draft is not the opened run. Preserve the rendered result and its cursor.
  if (!currentDocument) {
    openingRejectionDiagnostics = normalized;
    updateOpeningStatus();
    setRenderState("invalid", "snapshotRejected", "fixSyntax");
  }
  return false;
}

function executionSnapshot(execution, documentValue = currentProjection?.document, { local = false } = {}) {
  const snapshot = cloneJSON(einoAPI.executionDAGToWorkflowSnapshot(execution));
  if (local) snapshot.workflow.edges = snapshot.workflow.edges.filter((edge) => !edge.metadata?.synthetic);
  if (documentValue?.kind === "workflow") {
    snapshot.workflow.name = documentValue.definition.workflow.name || snapshot.workflow.name;
    snapshot.metadata = { ...documentValue.definition.metadata, ...snapshot.metadata };
  }
  return workflowAPI.parseWorkflowSnapshot(snapshot);
}

function recordDiagnostics() {
  const entries = [
    ...(currentProjection?.diagnostics || []),
    ...(currentDocument?.diagnostics || []),
  ];
  const seen = new Set();
  return entries.filter((entry) => {
    const key = JSON.stringify([entry.envelopeIndex, entry.code, entry.path, entry.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderCurrentDocument({ fit = true, scopeOnly = false, graphViewport } = {}) {
  if (!currentProjection?.ok) return;
  if (currentProjection.document.kind === "agent") {
    currentGraphReading = undefined;
    currentGraphTopology = undefined;
    graphTopologyInstance?.destroy();
    graphTopologyInstance = undefined;
    cancelAnimationFrame(workflowRevealFrame);
    cancelPathMount();
    workflowInstance?.destroy();
    graphViewerInstance?.destroy();
    workflowInstance = undefined;
    graphViewerInstance = undefined;
    currentSnapshot = undefined;
    currentSnapshotPrefix = [];
    currentRunView = "trajectory";
    currentExplanation = agentReader.explanation;
    ui.stage.remove();
    ui.globalSummary.remove();
    readingSlot.after(agentHost);
    ui.workbench.dataset.readingKind = "agent";
    ui.workbench.classList.remove("has-inspector");
    ui.agentRunMeta.hidden = true;
    showIssues(recordDiagnostics(), { key: "validSnapshot", accepted: true });
    return;
  }
  agentHost.remove();
  readingSlot.after(ui.stage);
  cancelAnimationFrame(workflowRevealFrame);
  cancelPathMount();
  const previousLock = inspectorPresentationLocked;
  const previousPanel = ui.editorWrap.hidden ? "node" : "raw";
  const previousSelection = selectedNodeDetail?.explanationNode?.id;
  const previousDefinitionId = selectedNodeDetail?.graphDefinitionNodeId;
  const previousEdgeId = selectedNodeDetail?.graphEdgeId;
  if (scopeOnly) inspectorPresentationLocked = true;
  try {
  const projected = currentProjection.document;
  if (!scopeOnly || !currentExplanation) {
  const explained = currentExecutionDAG
    ? einoAPI.explainExecutionDAG(currentExecutionDAG, projected.evidence, { locale: currentLanguage, diagnostics: recordDiagnostics() })
    : projected.kind === "workflow"
      ? einoAPI.explainWorkflowSnapshot(projected.definition, { locale: currentLanguage, envelopes: projected.evidence, diagnostics: recordDiagnostics() })
      : einoAPI.explainEino(projected.evidence, { locale: currentLanguage, diagnostics: recordDiagnostics() });
  currentExplanation = explained.ok ? explained.explanation : undefined;
  currentInvocationLabels = buildRepeatedInvocationLabels(currentExecutionDAG, projected.evidence, currentLanguage);
  currentIdentityLabels = buildStepIdentityLabels(currentExecutionDAG, projected.evidence);
  }
  rebuildInspection();
  const scoped = currentScopeReading?.mode !== "all";
  const visibleExecution = currentScopeReading?.execution || currentExecutionDAG;
  // A filtered execution scope does not necessarily describe another declared
  // graph. Only use the root topology for the full run (or its complete group).
  const fullGraphScope = !scoped || visibleExecution && visibleExecution.nodes.length === currentExecutionDAG?.nodes.length
    || !currentExecutionDAG && currentScopeReading?.group?.kind === "graph";
  currentGraphTopology = projected.kind === "graph" && fullGraphScope ? buildGraphTopology(projected, { visibleExecution }) : undefined;
  const scopeSize = Math.max(currentScopeReading?.nodeIds.length ?? visibleExecution?.nodes.length ?? 0, currentGraphTopology?.nodes.length ?? 0);
  if (previousEdgeId && (!currentGraphTopology?.edges.some(({ id }) => id === previousEdgeId)
    || scopeSize > 500 && !largeVisualRequested)) {
    clearLinkedSelection();
    clearNodeDetail({ preservePanel: true });
    selectedPathIsPrompt = true;
    ui.selectedPath.textContent = translate("selectNodePrompt");
  }
  currentGraphReading = projected.kind === "graph" && currentExecutionDAG && !currentGraphTopology
    ? buildGraphReading(currentExecutionDAG, projected.evidence, { visibleExecution }) : undefined;
  for (const node of currentGraphTopology?.nodes || []) for (const id of node.memberIds) {
    currentReadingRoles.get(id)?.add(node.name.toLocaleLowerCase().replace(/\s+/gu, " "));
  }
  renderHierarchyNavigation();
  renderInspectionResults();
  if (!scopeOnly || projected.kind === "agent") renderRunResultSummary(currentExplanation);
  renderScopeResultSummary();
  if (projected.kind === "graph") ui.workbench.style.setProperty("--graph-reading-height", `${Math.min(1200, Math.max(500, currentGraphTopology
    ? currentGraphTopology.nodes.length * 105 : (currentGraphReading?.execution.nodes.length ?? scopeSize) * 85))}px`);
  else ui.workbench.style.removeProperty("--graph-reading-height");
  const emptyScope = scopeSize === 0;
  if (emptyScope || scopeSize > 500 && !largeVisualRequested) {
    graphTopologyInstance?.destroy();
    graphTopologyInstance = undefined;
    workflowInstance?.destroy();
    workflowInstance = undefined;
    graphViewerInstance?.destroy();
    graphViewerInstance = undefined;
    currentSnapshot = undefined;
    currentSnapshotPrefix = [];
    ui.host.hidden = true;
    ui.domainView.hidden = false;
    ui.workflowControls.hidden = true;
    delete ui.domainView.dataset.viewType;
    const notice = htmlElement("section", "large-record-notice");
    notice.append(htmlElement("h3", "", translate(emptyScope ? "scopeNoSteps" : "largeRecordTitle")));
    if (!emptyScope) {
    const action = htmlElement("button", "", translate("largeRecordDraw"));
    action.type = "button";
    action.dataset.drawGraph = "";
    action.addEventListener("click", () => { largeVisualRequested = true; renderCurrentDocument(); });
    notice.append(action);
    }
    ui.domainView.replaceChildren(notice);
    ui.inspection.open = true;
    renderExplanationOverview(currentExplanation);
  } else if (currentGraphTopology) {
    showGraphTopology(currentGraphTopology, { graphViewport, previousDefinitionId, previousEdgeId });
  } else if (projected.kind === "workflow" || currentExecutionDAG) {
    showWorkflow(visibleExecution ? executionSnapshot(currentGraphReading?.execution || visibleExecution, projected, { local: scoped })
      : workflowAPI.parseWorkflowSnapshot(currentScopeReading?.definitionSnapshot || projected.definition),
    { fit, pathPrefix: currentScopeReading?.definitionPathPrefix || [], graphViewport });
    restorePathSelection();
  } else {
    graphTopologyInstance?.destroy();
    graphTopologyInstance = undefined;
    workflowInstance?.destroy();
    workflowInstance = undefined;
    graphViewerInstance?.destroy();
    currentSnapshot = undefined;
    currentSnapshotPrefix = [];
    clearNodeDetail();
    ui.domainView.hidden = true;
    ui.host.hidden = false;
    whenPathReady(() => { graphViewerInstance = einoAPI.createEinoViewer(ui.host, projected, {
      onNodeClick({ id, node }) {
        selectedPathIsPrompt = false;
        ui.selectedPath.textContent = id;
        renderNodeDetail({
          id, path: [id], name: node?.name || node?.label || id,
          component: node?.component || "Node", kind: "graph",
          metadata: node?.metadata || {}, status: node?.status,
        });
      },
    }); });
    ui.domainView.hidden = true;
    ui.host.hidden = false;
    ui.workflowControls.hidden = true;
    setMetricLabels(["layouts", "patches", "cacheHits"]);
    ui.layouts.textContent = "1";
    ui.patches.textContent = "0";
    ui.cache.textContent = "GRAPH";
    setRenderState("valid", "snapshotRendered", "renderSummary", {
      nodes: projected.definition.nodes?.length || 0,
      edges: projected.definition.edges?.length || 0, outcomes: 0,
    });
    if (currentExplanation) renderExplanationOverview(currentExplanation);
  }
  if (previousSelection && currentScopeReading?.nodeIds.includes(previousSelection)) {
    const node = currentInspection.getNode(previousSelection);
    if (node) {
      const renderedNode = { id: node.path.at(-1), path: node.path, name: node.label, component: node.component, metadata: node.technical?.metadata || {} };
      const executionNode = currentExecutionDAG?.nodes.find(({ id }) => id === previousSelection);
      renderExplanationNode(node, { renderedNode, executionNode, activate: false, synchronize: false });
      activateReadingPath(node.id, node.path);
    }
  }
  updateRunViewTabs();
  updateSignalBus(currentDocument);
  showRunState(currentDocument, currentRunView === "trajectory" ? currentTrajectory : visibleExecution);
  showIssues(recordDiagnostics(), { key: "validSnapshot", accepted: true });
  ui.diagramTools.hidden = ui.host.hidden || !activePathRenderer();
  if (selectedPathIsPrompt) ui.selectedPath.textContent = translate("selectNodePrompt");
  } finally {
    if (scopeOnly) {
      inspectorPresentationLocked = previousLock;
      if (!previousLock) inspectorPanel(previousPanel, { reveal: false });
    }
  }
}

function applyDocument({ fit = true, text = ui.editor.value, fixtureItem, expectedKind } = {}) {
  let candidate, projected, next, trajectoryResult;
  try {
    candidate = parseRecordJSON(text);
    // Prepare all source-derived views before committing opened-run state.
    projected = einoAPI.projectEinoViewerDocument(candidate);
    if (!projected.ok) return rejectDocument(projected.diagnostics);
    next = projected.document;
    if (expectedKind && next.kind !== expectedKind) return rejectDocument([
      { path: "root", code: "viewer.unexpected_kind", message: "The example does not match the selected record type." },
    ]);
    trajectoryResult = next.kind === "agent"
      ? einoAPI.buildExecutionTrajectory(next.evidence, { runId: next.execution.runId })
      : undefined;
    if (next.execution) executionSnapshot(next.execution, next);
    else if (next.kind === "workflow") workflowAPI.parseWorkflowSnapshot(next.definition);
    if (next.kind === "agent") {
      if (agentReader) agentReader.update(candidate);
      else agentReader = createEinoRunViewer(agentHost, candidate, { locale: currentLanguage });
    }
  } catch (error) {
    return rejectDocument(error.diagnostics || [{ path: "root", code: "viewer.invalid_document", message: error.message }]);
  }
  const changedSource = currentObjectKind !== next.kind;
  if (next.kind !== "agent") {
    agentReader?.destroy();
    agentReader = undefined;
  }
  openingRejectionDiagnostics = undefined;
  clearLinkedSelection();
  clearNodeDetail({ preservePanel: true });
  selectedPathIsPrompt = true;
  if (changedSource) {
    graphTopologyInstance?.destroy();
    graphTopologyInstance = undefined;
    workflowInstance?.destroy();
    workflowInstance = undefined;
    graphViewerInstance?.destroy();
    graphViewerInstance = undefined;
    currentRunView = "path";
  }
  currentDocument = candidate;
  valueFolds.dispose();
  valueFolds = createRenderedValueFoldObserver(ui.workbench);
  currentRunView = next.kind === "agent" ? "trajectory" : "path";
  readingDisclosures.clear();
  ui.readingSidebar.open = next.kind !== "agent";
  ui.globalSummary.open = next.kind !== "agent";
  inspectorReturnFocus = undefined;
  inspectorReturnSelection = undefined;
  ui.opening.hidden = true;
  ui.stage.hidden = false;
  document.body.classList.add("has-record");
  ui.inspection.open = true;
  ui.inspectionScope.value = "steps";
  workflowPathRegion.open = true;
  largeVisualRequested = false;
  editorRangeCache = undefined;
  inspectionOffset = 0;
  inspectionIssueOffset = 0;
  inspectionGroupId = undefined;
  inspectionUngrouped = false;
  hierarchyOffset = 0;
  ui.hierarchyDirectory.open = ui.workbench.clientWidth >= 768;
  ui.inspectionSearch.value = "";
  currentDocumentText = text;
  currentDocumentJSON = JSON.stringify(candidate);
  currentProjection = projected;
  currentExecutionDAG = next.execution;
  currentTrajectory = trajectoryResult?.ok ? trajectoryResult.trajectory : undefined;
  currentObjectKind = next.kind;
  currentMode = next.kind === "agent" ? "scenario" : "domain";
  currentDomain = next.kind === "graph" ? "compose.graph" : "workflow.snapshot";
  currentFixture = fixtureItem;
  currentRecordName = candidate.runId;
  if (next.kind !== "agent") currentRunView = "path";
  ui.editor.value = text;
  ui.editor.readOnly = true;
  savedDraftText = undefined;
  ui.restoreDraft.hidden = true;
  populateSamples();
  ui.sample.value = fixtureItem?.id || "";
  updateRecordLabel();
  renderCurrentDocument({ fit });
  if (next.kind !== "agent" && !selectInitialReadingDetail()) setInspectorOpen(false);
  window.scrollTo({ top: 0 });
  ui.domainView.scrollTop = 0;
  ui.importStatus.textContent = "";
  ui.importStatus.dataset.error = "false";
  return true;
}

function selectPressed(container, selector, attribute, value) {
  container.querySelectorAll(selector).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === value));
  });
}

function initializeThemes() {
  for (const theme of workflowAPI.listWorkflowDAGThemes()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.theme = theme;
    button.setAttribute("aria-pressed", String(theme === currentTheme));
    button.dataset.i18n = `theme${theme[0].toUpperCase()}${theme.slice(1)}`;
    button.textContent = translate(button.dataset.i18n);
    button.addEventListener("click", () => {
      currentTheme = theme;
      selectPressed(ui.themes, "[data-theme]", "theme", theme);
      workflowInstance?.setTheme(readingGraphTheme());
      scheduleDiagnostics();
    });
    ui.themes.append(button);
  }
}

ui.openDetails.addEventListener("click", () => {
  ui.openDetails.focus({ preventScroll: true });
  inspectorPanel("node", { focus: true });
});
ui.openRaw.addEventListener("click", () => {
  if (currentObjectKind !== "workflow") return;
  ui.openRaw.focus({ preventScroll: true });
  openRawInspector();
  ui.rawRecordsTab.focus();
});
ui.inspector.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setInspectorOpen(false, { returnFocus: true });
  }
});
document.querySelector("#zoom-in").addEventListener("click", () => activePathRenderer()?.zoomIn());
document.querySelector("#zoom-out").addEventListener("click", () => activePathRenderer()?.zoomOut());
document.querySelector("#fit-reading").addEventListener("click", () => activePathRenderer()?.resetView());
ui.pasteRecord.addEventListener("click", () => {
  if (currentObjectKind !== "workflow" && currentDocument) return;
  ui.pasteRecord.focus({ preventScroll: true });
  rememberInspectorTrigger(ui.pasteRecord);
  if (ui.editor.readOnly) {
    if (savedDraftText !== undefined) ui.editor.value = savedDraftText;
    else ui.editor.value = "";
  }
  ui.editor.readOnly = false;
  delete ui.editor.dataset.selectedEnvelopeIndex;
  validationState = { kind: "neutral", key: "unappliedDraft", params: {} };
  visibleIssues = [];
  displayValidationState();
  renderIssueList();
  inspectorPanel("raw");
  ui.editor.focus({ preventScroll: true });
});
ui.opening.addEventListener("click", (event) => {
  const action = event.target.closest("[data-open-example]");
  if (!action || action.disabled) return;
  loadSelectedFixture({ kind: action.dataset.exampleKind, id: action.dataset.openExample });
});
ui.clearSearch.addEventListener("click", () => {
  ui.inspectionSearch.value = "";
  inspectionOffset = 0;
  renderInspectionResults();
  ui.inspectionSearch.focus({ preventScroll: true });
});
for (const type of ["dragover", "drop"]) {
  document.addEventListener(type, (event) => {
    if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
  });
}
ui.restoreDraft.addEventListener("click", () => {
  if (savedDraftText === undefined) return;
  ui.editor.value = savedDraftText;
  ui.editor.readOnly = false;
  savedDraftText = undefined;
  ui.restoreDraft.hidden = true;
  delete ui.editor.dataset.selectedEnvelopeIndex;
  inspectorPanel("raw");
  ui.editor.focus({ preventScroll: true });
});
window.addEventListener("pagehide", (event) => {
  cancelPathMount();
  if (!event.persisted) {
    agentReader?.destroy();
    graphTopologyInstance?.destroy();
    graphTopologyInstance = undefined;
  }
});

for (const control of [ui.inspectionSearch, ui.inspectionScope]) {
  control.addEventListener(control === ui.inspectionSearch ? "input" : "change", () => {
    inspectionOffset = 0;
    renderInspectionResults();
  });
}
ui.inspectionPrevious.addEventListener("click", () => { inspectionOffset = Math.max(0, inspectionOffset - 25); renderInspectionResults(); });
ui.inspectionNext.addEventListener("click", () => { inspectionOffset += 25; renderInspectionResults(); });
function onHierarchyClick(event) {
  // Agent breadcrumbs live directly above the trajectory.
  if (event.currentTarget === ui.hierarchy && event.composedPath().includes(ui.hierarchyBreadcrumbs)) return;
  const group = event.target.closest("[data-hierarchy-group]");
  const ungrouped = event.target.closest("[data-hierarchy-ungrouped]");
  if (group) selectInspectionGroup(group.dataset.hierarchyGroup, { focus: true });
  else if (ungrouped) selectInspectionGroup(undefined, { ungrouped: true, focus: true });
}
ui.hierarchy.addEventListener("click", onHierarchyClick);
ui.hierarchyBreadcrumbs.addEventListener("click", onHierarchyClick);
ui.hierarchyPrevious.addEventListener("click", () => { hierarchyOffset = Math.max(0, hierarchyOffset - 25); renderHierarchyNavigation(); });
ui.hierarchyNext.addEventListener("click", () => { hierarchyOffset += 25; renderHierarchyNavigation(); });
ui.inspectionResults.addEventListener("click", (event) => {
  const step = event.target.closest("[data-inspection-node]");
  const evidence = event.target.closest("[data-inspection-evidence]");
  if (step) {
    step.focus({ preventScroll: true });
    selectInspectionStep(step.dataset.inspectionNode, step);
  }
  if (evidence) locateEnvelopeInEditor(Number(evidence.dataset.inspectionEvidence));
});
ui.inspectionNextIssue.addEventListener("click", () => {
  const issues = inspectionIssues();
  if (issues.length) {
    const issue = issues[inspectionIssueOffset++ % issues.length];
    if (issue.nodeId && currentInspection.getNode(issue.nodeId)) jumpToInspectionStep(issue.nodeId);
    else if (issue.evidenceEnvelopeIndexes.length) locateEnvelopeInEditor(issue.evidenceEnvelopeIndexes[0]);
  } else {
    const page = currentInspection.searchSteps("", { ...inspectionRange(), issuesOnly: true, offset: inspectionIssueOffset, limit: 1 });
    if (page.items.length) {
      jumpToInspectionStep(page.items[0].id);
      inspectionIssueOffset = (page.offset + 1) % page.total;
    }
  }
});

ui.mode.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button) changeMode(button.dataset.mode);
});
ui.domain.addEventListener("change", () => changeDomain(ui.domain.value));
ui.sample.addEventListener("change", () => loadSelectedFixture());
ui.view.addEventListener("change", () => applyDocument());
ui.runViewTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-run-view]");
  if (button) selectRunView(button.dataset.runView);
});
ui.runViewTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  selectRunView(event.target.dataset.runView === "path" ? "trajectory" : "path");
  ui.runViewTabs.querySelector(`[data-run-view="${currentRunView}"]`)?.focus();
});
ui.inspectorTabs.addEventListener("click", (event) => {
  if (currentObjectKind !== "workflow") return;
  const tab = event.target.closest("[data-inspector-panel]");
  if (!tab) return;
  if (tab.dataset.inspectorPanel === "node") {
    inspectorPanel("node");
  } else openRawInspector();
});
ui.inspectorTabs.addEventListener("keydown", (event) => {
  if (currentObjectKind !== "workflow") return;
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const panel = event.target.dataset.inspectorPanel === "node" ? "raw" : "node";
  inspectorPanel(panel, { focus: true });
});
ui.nodeDetail.addEventListener("click", (event) => {
  const scope = event.target.closest("[data-hierarchy-group]");
  if (scope) selectInspectionGroup(scope.dataset.hierarchyGroup, { focus: true });
  const button = event.target.closest("button[data-envelope-index]");
  if (button) {
    locateEnvelopeInEditor(Number(button.dataset.envelopeIndex));
    return;
  }
  const explanationButton = event.target.closest("[data-explanation-node]");
  if (!explanationButton || !currentExplanation) return;
  const explanationNode = currentExplanation.nodes.find((node) => node.id === explanationButton.dataset.explanationNode);
  if (!explanationNode) return;
  const renderedNode = {
    id: explanationNode.path.at(-1),
    path: explanationNode.path,
    name: explanationNode.label,
    kind: explanationNode.kind,
    component: explanationNode.component,
    metadata: explanationNode.technical?.metadata || {},
    status: explanationNode.status,
    durationMs: explanationNode.timing?.durationMs,
  };
  const executionNode = currentExecutionDAG?.nodes?.find((node) => node.id === explanationNode.id);
  if (!ui.host.hidden && activePathRenderer()) activateReadingPath(explanationNode.id, explanationNode.path);
  selectedPathIsPrompt = false;
  renderExplanationNode(explanationNode, { renderedNode, executionNode });
  ui.selectedPath.textContent = selectedNodeDetail?.presentation?.title || explanationNode.label;
});
ui.nodeDetail.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-graph-visit]");
  if (!select || !graphVisitIds(selectedNodeDetail?.explanationNode?.id).includes(select.value)) return;
  // Replacing the list can temporarily shrink a narrow page in WebKit. Keep
  // the reader's viewport after both the list and the detail regain their size.
  const position = { top: window.scrollY, left: window.scrollX };
  const detailPosition = { top: ui.nodeDetail.scrollTop, left: ui.nodeDetail.scrollLeft };
  jumpToInspectionStep(select.value, inspectorReturnFocus, { scroll: false, activate: false });
  ui.nodeDetail.querySelector("select[data-graph-visit]")?.focus({ preventScroll: true });
  ui.nodeDetail.scrollTo(detailPosition);
  window.scrollTo(position);
});
ui.runResultSummary.addEventListener("click", async (event) => {
  const issue = event.target.closest("[data-run-issue-step]");
  if (issue) { jumpToInspectionStep(issue.dataset.runIssueStep); return; }
  const evidence = event.target.closest("button[data-envelope-index]");
  if (evidence) {
    locateEnvelopeInEditor(Number(evidence.dataset.envelopeIndex));
    return;
  }
  const copy = event.target.closest("[data-run-copy-index]");
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(runSummaryCopyValues[Number(copy.dataset.runCopyIndex)]);
    copy.textContent = translate("copied");
  } catch {
    copy.textContent = translate("runCopyFailed");
  }
});
ui.scopeResultSummary.addEventListener("click", async (event) => {
  const issue = event.target.closest("[data-run-issue-step]");
  if (issue) { jumpToInspectionStep(issue.dataset.runIssueStep); return; }
  if (event.target.closest("[data-scope-global-result]")) {
    if (currentObjectKind === "graph") {
      selectInspectionGroup(undefined, { focus: true });
      return;
    }
    ui.globalSummary.open = true;
    ui.runResultSummary.scrollIntoView({ block: "start", behavior: "instant" });
    ui.runResultSummary.focus({ preventScroll: true });
    return;
  }
  const evidence = event.target.closest("button[data-envelope-index]");
  if (evidence) {
    locateEnvelopeInEditor(Number(evidence.dataset.envelopeIndex));
    return;
  }
  const copy = event.target.closest("[data-scope-copy-index]");
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(scopeSummaryCopyValues[Number(copy.dataset.scopeCopyIndex)]);
    copy.textContent = translate("copied");
  } catch {
    copy.textContent = translate("runCopyFailed");
  }
});
document.querySelector(".language-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-language]");
  if (button && button.dataset.language !== currentLanguage) applyLanguage(button.dataset.language);
});
document.querySelector("#direction-controls").addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button) return;
  currentDirection = button.dataset.direction;
  selectPressed(document.querySelector("#direction-controls"), "[data-direction]", "direction", currentDirection);
  workflowInstance?.setDirection(currentDirection);
  scheduleDiagnostics();
});
ui.apply.addEventListener("click", () => applyDocument());
ui.edit.addEventListener("click", () => {
  ui.editor.readOnly = false;
  validationState = { kind: "neutral", key: "unappliedDraft", params: {} };
  displayValidationState();
  inspectorPanel("raw");
  ui.editor.focus({ preventScroll: true });
});
ui.format.addEventListener("click", () => {
  try {
    ui.editor.value = JSON.stringify(parseRecordJSON(ui.editor.value), null, 2);
    validationState = { kind: "neutral", key: "jsonFormatted", params: {} };
    displayValidationState();
  } catch (error) {
    showIssues(error.diagnostics || [{ path: "JSON", code: "invalid_json", message: error.message }]);
  }
});
ui.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.editor.value);
    ui.copy.textContent = translate("copied");
    setTimeout(() => { ui.copy.textContent = translate("copyJson"); }, 1200);
  } catch {
    ui.editor.select();
    validationState = { kind: "neutral", key: "selectAndCopy", params: {} };
    displayValidationState();
  }
});
ui.editor.addEventListener("input", () => {
  if (ui.editor.readOnly) return;
  validationState = { kind: "neutral", key: "unappliedDraft", params: {} };
  visibleIssues = [];
  displayValidationState();
  renderIssueList();
});
ui.editor.addEventListener("keydown", (event) => {
  if (!ui.editor.readOnly && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    applyDocument();
  }
});
document.querySelector("#expand-all").addEventListener("click", () => { workflowInstance?.expandAll(); scheduleDiagnostics(); });
document.querySelector("#collapse-all").addEventListener("click", () => { workflowInstance?.collapseAll(); scheduleDiagnostics(); });
document.querySelector("#fit").addEventListener("click", () => workflowInstance?.resetView());

window.playground = {
  get api() { return workflowAPI; },
  get einoAPI() { return einoAPI; },
  get instance() { return workflowInstance; },
  get graphTopology() { return currentGraphTopology; },
  get graphTopologyInstance() { return graphTopologyInstance; },
  get snapshot() { return currentSnapshot; },
  get document() { return currentDocument; },
  get projection() { return currentProjection; },
  get executionDAG() { return currentExecutionDAG; },
  get trajectory() { return currentTrajectory; },
  get runView() { return currentRunView; },
  get explanation() { return currentExplanation; },
  get inspectionScope() { return agentReader
    ? { groupId: agentReader.selectedGroupId || undefined, ungroupedOnly: inspectRunViewer(agentReader)?.ungroupedOnly || false }
    : { groupId: inspectionGroupId, ungroupedOnly: inspectionUngrouped }; },
  get scopeReading() { return agentReader ? inspectRunViewer(agentReader)?.scopeReading : currentScopeReading; },
  get selectedNodeDetail() { return agentReader ? inspectRunViewer(agentReader)?.selectedNodeDetail : selectedNodeDetail; },
  get linkedSelection() {
    if (agentReader) return inspectRunViewer(agentReader)?.linkedSelection;
    return {
      evidenceIndexes: [...selectedEvidenceIndexes],
      executionNodeId: selectedExecutionNodeId,
      trajectoryRecordId: selectedTrajectoryRecordId,
      rawEnvelopeIndex: Number.isSafeInteger(Number(ui.editor.dataset.selectedEnvelopeIndex))
        ? Number(ui.editor.dataset.selectedEnvelopeIndex)
        : undefined,
    };
  },
  get catalog() { return domainCatalog; },
  get scenarios() { return scenarioCatalog; },
  get domain() { return currentDomain; },
  get mode() { return currentMode; },
  get objectKind() { return currentObjectKind; },
  get language() { return currentLanguage; },
  get validation() { return { ...validationState }; },
  get diagnostics() { return [...visibleIssues]; },
  get ready() { return workbenchReady; },
  apply: applyDocument,
  setLanguage: applyLanguage,
  selectDomain: changeDomain,
  selectMode: changeMode,
  selectRunView,
};

applyLanguage(preferredWorkbenchLanguage(), { persist: false, updateUrl: false });

try {
  const [, loadedEinoAPI] = await Promise.all([
    loadWorkflowRenderer(),
    loadEinoAPI(),
  ]);
  workflowAPI = window.EinoWorkflowDAG;
  einoAPI = loadedEinoAPI;
  if (!workflowAPI || typeof einoAPI.createEinoDAGViewRegistry !== "function") {
    throw new Error("The Eino DAG browser APIs are unavailable.");
  }
  viewRegistry = einoAPI.createEinoDAGViewRegistry();
  initializeThemes();
  currentMode = "scenario";
  workbenchReady = true;
  ui.pasteRecord.disabled = false;
  updateRecordLabel();
  void initializeFixtureCatalog();
} catch (error) {
  coreLoadFailed = true;
  populateSamples({ preserve: true });
  showIssues([{ path: "workbench", code: "load_failed", message: error.message }]);
  setRenderState("invalid", "rendererUnavailable", "checkDistribution");
  ui.importStatus.textContent = translate("rendererUnavailable");
  ui.importStatus.dataset.error = "true";
}
