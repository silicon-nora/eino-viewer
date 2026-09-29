import {
  adaptWorkflowSnapshot,
  validateAgentEventEnvelope,
  validateCallbackEventEnvelope,
  validateComponentIOEnvelope,
  validateComposeGraphEnvelope,
  validateEinoDAGEnvelope,
  validateSchemaAgenticMessageEnvelope,
  validateSchemaDocumentEnvelope,
  validateSchemaMessageEnvelope,
  validateSchemaToolEnvelope,
} from "./protocol.js";
import { buildExecutionDAG } from "./execution-dag.js";
import { runCompletion } from "./run-lifecycle.js";
import { boundaryTiming, createTimingContext, nodeTiming, runTiming, workflowTiming } from "./execution-timing.js";
import { explanationGroups } from "./execution-scopes.js";
import { recordedBodyCapture, recordedValueAvailability } from "./content-presentation.js";
import { parseRecordJSON } from "./record-input.js";

export const EXPLANATION_SCHEMA_VERSION = 1;

const DOMAIN_VALIDATORS = new Map([
  ["agent.event", validateAgentEventEnvelope],
  ["callback.event", validateCallbackEventEnvelope],
  ["component.io", validateComponentIOEnvelope],
  ["compose.graph", validateComposeGraphEnvelope],
  ["schema.agentic_message", validateSchemaAgenticMessageEnvelope],
  ["schema.document", validateSchemaDocumentEnvelope],
  ["schema.message", validateSchemaMessageEnvelope],
  ["schema.tool", validateSchemaToolEnvelope],
]);

function own(value, key) {
  const descriptor = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function localeOf(options) {
  return own(options, "locale") === "zh" ? "zh" : "en";
}

function phrase(locale, english, chinese) {
  return locale === "zh" ? chinese : english;
}

function copyJSON(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function succeeded(explanation, diagnostics = []) {
  return freeze({ ok: true, explanation, diagnostics });
}

function failed(code, path, message, diagnostics) {
  return freeze({
    ok: false,
    diagnostics: diagnostics || [{ severity: "error", code, path, message }],
  });
}

function parseJSON(value) {
  if (typeof value !== "string") return copyJSON(value);
  try { return parseRecordJSON(value); } catch { return value; }
}

function messageDetails(payload) {
  const message = own(own(payload, "output"), "message") || payload;
  const value = own(message, "value") || message;
  return {
    message,
    value,
    role: own(message, "role") || own(value, "role"),
    content: own(value, "content"),
    toolCalls: Array.isArray(own(value, "tool_calls")) ? own(value, "tool_calls") : [],
  };
}

function toolCallName(call) {
  return own(own(call, "function"), "name") || own(call, "name") || "tool";
}

function envelopeValidation(envelope) {
  const base = validateEinoDAGEnvelope(envelope);
  if (!base.valid) return base;
  const kind = own(envelope, "kind");
  if (kind === "workflow.snapshot") return adaptWorkflowSnapshot(own(envelope, "payload"));
  return DOMAIN_VALIDATORS.get(kind)?.(envelope) || base;
}

function evidenceDirection(envelope, role) {
  const kind = own(envelope, "kind");
  const payload = own(envelope, "payload");
  if (kind === "schema.tool") return "definition";
  if (kind === "component.io") return own(payload, "direction");
  if (kind === "schema.message" || kind === "schema.agentic_message") {
    const messageRole = messageDetails(payload).role;
    return messageRole === "user" || messageRole === "system" ? "input" : "output";
  }
  if (kind === "agent.event") {
    return "output";
  }
  if (kind === "callback.event") {
    return own(payload, "phase") === "start" ? "input" : "output";
  }
  return "event";
}

function evidenceClaim(envelope, index, role, locale) {
  const kind = own(envelope, "kind");
  const payload = own(envelope, "payload");
  if (kind === "schema.tool") {
    const name = own(payload, "name") || "tool";
    const count = Object.keys(own(payload, "params") || {}).length;
    return phrase(locale, `Declares the ${name} tool with ${count} parameter${count === 1 ? "" : "s"}.`, `声明工具 ${name}，包含 ${count} 个参数。`);
  }
  if (kind === "component.io") {
    const direction = own(payload, "direction");
    const component = own(payload, "component") || "component";
    const name = own(payload, "name");
    if (own(payload, "streaming") === true && own(payload, "body") === undefined) {
      return phrase(locale,
        `Records component.io for ${component}${name ? ` ${name}` : ""} with direction ${direction}; the streaming body is not present.`,
        `记录 component.io：${component}${name ? ` ${name}` : ""}，direction=${direction}；流式 body 未包含在记录中。`,
      );
    }
    return phrase(locale,
      `Records component.io for ${component}${name ? ` ${name}` : ""} with direction ${direction}.`,
      `记录 component.io：${component}${name ? ` ${name}` : ""}，direction=${direction}。`,
    );
  }
  if (kind === "schema.message" || kind === "schema.agentic_message") {
    const details = messageDetails(payload);
    return phrase(locale,
      `Records ${kind} with role ${details.role || "message"}.`,
      `记录 ${kind}，role=${details.role || "message"}。`,
    );
  }
  if (kind === "agent.event") {
    const agent = own(payload, "agentName") || "Agent";
    const details = messageDetails(payload);
    const error = own(payload, "error");
    const transfer = own(own(payload, "action"), "transfer");
    if (error) return phrase(locale, `Records agent.event error from ${agent}: ${own(error, "message") || "unknown error"}.`, `记录 ${agent} 的 agent.event error：${own(error, "message") || "未知错误"}。`);
    if (transfer) return phrase(locale, `Records agent.event action.transfer from ${agent} to ${own(transfer, "destinationAgent")}.`, `记录 ${agent} 的 agent.event action.transfer，目标为 ${own(transfer, "destinationAgent")}。`);
    if (details.toolCalls.length) {
      const names = details.toolCalls.map(toolCallName).join(", ");
      return phrase(locale, `Records agent.event from ${agent} with tool_calls for ${names}.`, `记录 ${agent} 的 agent.event，其中 tool_calls 包含 ${names}。`);
    }
    if (details.role) return phrase(locale, `Records agent.event from ${agent} with message role ${details.role}.`, `记录 ${agent} 的 agent.event，消息 role=${details.role}。`);
    return phrase(locale, `Records agent.event from ${agent}.`, `记录 ${agent} 的 agent.event。`);
  }
  if (kind === "callback.event") {
    const phase = own(payload, "phase") || "event";
    const name = own(own(payload, "run"), "name") || own(own(payload, "run"), "component") || "component";
    if (phase === "error") return phrase(locale, `${name} reported an execution error.`, `${name} 报告执行错误。`);
    return phrase(locale, `${name} reported its ${phase} boundary.`, `${name} 报告了 ${phase} 边界。`);
  }
  if (kind === "compose.graph" || kind === "workflow.snapshot") {
    const graph = kind === "workflow.snapshot" ? own(own(payload, "workflow"), "nodes") : own(payload, "nodes");
    const count = Array.isArray(graph) ? graph.length : 0;
    return phrase(locale, `Declares a graph with ${count} node${count === 1 ? "" : "s"}.`, `声明包含 ${count} 个节点的图。`);
  }
  if (kind === "schema.document") {
    return phrase(locale, `Carries document ${own(payload, "id") || index + 1}.`, `携带文档 ${own(payload, "id") || index + 1}。`);
  }
  return phrase(locale, `Records one ${kind} event.`, `记录一条 ${kind} 事件。`);
}

function evidenceValue(envelope) {
  const kind = own(envelope, "kind");
  const payload = own(envelope, "payload");
  if (kind === "component.io") return copyJSON(own(payload, "body"));
  if (kind === "agent.event") {
    const details = messageDetails(payload);
    if (details.toolCalls.length) {
      return details.toolCalls.map((call) => ({
        id: own(call, "id"),
        name: toolCallName(call),
        arguments: parseJSON(own(own(call, "function"), "arguments")),
      }));
    }
    if (details.content !== undefined) return parseJSON(details.content);
    if (own(payload, "action") !== undefined) return copyJSON(own(payload, "action"));
    if (own(payload, "error") !== undefined) return copyJSON(own(payload, "error"));
  }
  return copyJSON(payload);
}

function explainEvidenceUnchecked(envelope, index, role, locale) {
  const direction = evidenceDirection(envelope, role);
  const kind = own(envelope, "kind");
  const value = evidenceValue(envelope);
  return {
    envelopeIndex: index,
    kind,
    ...(role ? { role } : {}),
    direction,
    claim: evidenceClaim(envelope, index, role, locale),
    basis: "observed",
    ...(own(envelope, "observedAtMs") !== undefined ? { observedAtMs: own(envelope, "observedAtMs") } : {}),
    ...(own(envelope, "source") ? { source: copyJSON(own(envelope, "source")) } : {}),
    ...(value !== undefined ? { value } : {}),
    payload: copyJSON(own(envelope, "payload")),
  };
}

/** Explain one validated Eino envelope without requiring a complete run. */
export function explainEinoEnvelope(envelope, options = {}) {
  const validation = envelopeValidation(envelope);
  if (validation.ok === false || validation.valid === false) {
    return failed("explanation.invalid_envelope", "root", "Expected a valid Eino DAG envelope.", validation.diagnostics);
  }
  const locale = localeOf(options);
  const index = Number.isSafeInteger(own(options, "envelopeIndex")) ? own(options, "envelopeIndex") : 0;
  return succeeded(explainEvidenceUnchecked(envelope, index, own(options, "role"), locale));
}

function relationSummary(kind, direction, peerLabel, locale) {
  const inbound = direction === "cause";
  const messages = {
    "tool-call": inbound
      ? phrase(locale, `A recorded tool_call links ${peerLabel} to this node.`, `记录中的 tool_call 将 ${peerLabel} 关联到此节点。`)
      : phrase(locale, `A recorded tool_call links this node to ${peerLabel}.`, `记录中的 tool_call 将此节点关联到 ${peerLabel}。`),
    observation: inbound
      ? phrase(locale, `A recorded result links ${peerLabel} to this node.`, `记录中的结果将 ${peerLabel} 关联到此节点。`)
      : phrase(locale, `A recorded result links this node to ${peerLabel}.`, `记录中的结果将此节点关联到 ${peerLabel}。`),
    transfer: inbound
      ? phrase(locale, `${peerLabel} transferred control here.`, `${peerLabel} 将控制权转交到这里。`)
      : phrase(locale, `Control transfers to ${peerLabel}.`, `控制权将转交给 ${peerLabel}。`),
    data: inbound
      ? phrase(locale, `Data from ${peerLabel} feeds this step.`, `${peerLabel} 的数据进入这个步骤。`)
      : phrase(locale, `This step supplies data to ${peerLabel}.`, `这个步骤向 ${peerLabel} 提供数据。`),
    "parent-child": inbound
      ? phrase(locale, `${peerLabel} contains this execution.`, `${peerLabel} 包含这次执行。`)
      : phrase(locale, `${peerLabel} runs as a child operation.`, `${peerLabel} 作为子操作运行。`),
    control: inbound
      ? phrase(locale, `${peerLabel} completed before this step.`, `${peerLabel} 完成后进入这个步骤。`)
      : phrase(locale, `${peerLabel} follows this step.`, `${peerLabel} 在这个步骤之后执行。`),
  };
  return messages[kind] || phrase(locale, `${peerLabel} is related through ${kind}.`, `${peerLabel} 通过 ${kind} 关系相连。`);
}

function channelItem(label, value, evidenceIndex, capture = {}) {
  const omitted = own(capture, "status") === "omitted";
  const copied = omitted ? undefined : copyJSON(value);
  const availability = recordedValueAvailability(copied, capture);
  return {
    label,
    availability,
    ...(omitted ? { reason: own(capture, "reason") || "not_captured" } : {}),
    ...(copied !== undefined ? { value: copied } : {}),
    basis: "observed",
    evidenceEnvelopeIndexes: [evidenceIndex],
  };
}

function addNodeChannels(node, explainedEvidence, envelopes, locale, bodyDiagnostics) {
  const inputs = [];
  const outputs = [];
  for (const item of explainedEvidence) {
    const envelope = envelopes[item.envelopeIndex];
    const payload = own(envelope, "payload");
    if (node.kind === "workflow" && own(envelope, "kind") === "workflow.snapshot") {
      const path = JSON.stringify(own(node.metadata, "sourceNodePath"));
      const outcome = own(own(payload, "execution"), "nodes")?.find((entry) => JSON.stringify(own(entry, "path")) === path);
      if (own(outcome, "errorMessage")) outputs.push(channelItem(phrase(locale, "Execution error", "执行错误"), own(outcome, "errorMessage"), item.envelopeIndex));
      continue;
    }
    if (node.kind === "tool" && own(envelope, "kind") === "agent.event" && messageDetails(payload).toolCalls.length) {
      const callId = own(node.correlation, "toolCallId");
      const call = messageDetails(payload).toolCalls.find((candidate) => own(candidate, "id") === callId)
        || messageDetails(payload).toolCalls[0];
      if (call) inputs.push(channelItem(phrase(locale, "Tool arguments", "工具参数"), parseJSON(own(own(call, "function"), "arguments")), item.envelopeIndex));
      continue;
    }
    if (node.kind === "tool" && own(envelope, "kind") === "agent.event" && messageDetails(payload).role === "tool") {
      outputs.push(channelItem(phrase(locale, "Tool result", "工具结果"), parseJSON(messageDetails(payload).content), item.envelopeIndex));
      continue;
    }
    if (item.role === "error") {
      outputs.push(channelItem(
        phrase(locale, "Execution error", "执行错误"),
        own(payload, "error"),
        item.envelopeIndex,
        recordedBodyCapture(envelope, item.envelopeIndex, bodyDiagnostics?.get(item.envelopeIndex), "/payload/error"),
      ));
      continue;
    }
    if (own(envelope, "kind") === "component.io") {
      if (item.role === "context") continue;
      // Model planning/context attached to a tool is not the tool's own I/O.
      if (node.kind === "tool" && own(payload, "component") !== "Tool") continue;
      const target = own(payload, "direction") === "input" ? inputs : outputs;
      target.push(channelItem(
        own(payload, "direction") === "input" ? phrase(locale, "Component input", "组件输入") : phrase(locale, "Component output", "组件输出"),
        own(payload, "body"),
        item.envelopeIndex,
        recordedBodyCapture(envelope, item.envelopeIndex, bodyDiagnostics?.get(item.envelopeIndex)),
      ));
      continue;
    }
    if ((node.kind === "input" || node.kind === "output") && ["schema.message", "schema.agentic_message"].includes(own(envelope, "kind"))) {
      const target = node.kind === "input" ? inputs : outputs;
      target.push(channelItem(`${own(envelope, "kind")} · ${messageDetails(payload).role || "message"}`, payload, item.envelopeIndex));
      continue;
    }
    if (node.kind === "agent" && own(envelope, "kind") === "agent.event") {
      outputs.push(channelItem(`agent.event · ${messageDetails(payload).role || item.role || "event"}`, evidenceValue(envelope), item.envelopeIndex));
    }
  }
  const channel = (items, direction) => {
    const available = items.filter((item) => item.availability !== "not-observed");
    const summary = available.length
      ? phrase(locale, `${available.length} observed ${direction} item${available.length === 1 ? "" : "s"}.`, `观察到 ${available.length} 项${direction === "input" ? "输入" : "输出"}。`)
      : phrase(locale, `No ${direction} value was observed.`, `没有观察到${direction === "input" ? "输入" : "输出"}值。`);
    const limitations = [];
    if (items.some((item) => item.availability === "not-observed")) limitations.push(phrase(locale, "A value was not captured.", "有值未采集。"));
    if (items.some((item) => item.availability === "redacted")) limitations.push(phrase(locale, "Captured values were redacted.", "采集值已经脱敏。"));
    if (items.some((item) => item.availability === "truncated")) limitations.push(phrase(locale, "Captured values were truncated.", "采集值已截断。"));
    const reasons = [...new Set(items.map((item) => item.reason).filter(Boolean))];
    return { availability: available.length ? "available" : "not-observed",
      summary: [summary, ...limitations, ...(reasons.length ? [`(${reasons.join(", ")})`] : [])].join(" "), items };
  };
  return { input: channel(inputs, "input"), output: channel(outputs, "output") };
}

function nodeHeadline(node, channels, locale) {
  if (node.status === "failed" && node.errorMessage) return `${node.label} · ${node.errorMessage}`;
  return node.label;
}

function nodeSummary(node, channels, locale) {
  if (node.metadata?.executionState === "planned") return phrase(locale, "A tool call was planned; its execution was not observed.", "记录了工具调用计划，但未观察到执行。");
  if (node.metadata?.executionState === "interrupted") return phrase(locale, "This step was interrupted; no final result was recorded.", "此步骤已中断，没有记录最终结果。");
  if (node.metadata?.executionState === "unrecorded") return phrase(locale, "The run ended without a recorded result for this step.", "运行已结束，但没有记录此步骤的结果。");
  return phrase(locale,
    `${node.evidence.length} source record${node.evidence.length === 1 ? " is" : "s are"} attached to this node.`,
    `此节点关联 ${node.evidence.length} 条源记录。`,
  );
}

function explainTiming(timing, locale) {
  const reasons = {
    "boundaries-not-recorded": ["Execution start and end were not recorded.", "没有记录执行开始和结束时间。"],
    "start-not-recorded": ["The execution start was not recorded; duration is unknown.", "没有记录执行开始边界，耗时未知。"],
    "end-not-recorded": ["The execution end was not recorded; duration is unknown.", "尚无执行结束记录，耗时未知。"],
    "timestamp-not-recorded": ["A recorded boundary has no timestamp; duration is unknown.", "执行边界缺少时间戳，耗时未知。"],
    "invalid-timestamp": ["An execution timestamp is invalid; duration is unknown.", "执行时间戳无效，耗时未知。"],
    "clock-reversed": ["The recorded end precedes the start; duration is unknown.", "记录的结束时间早于开始时间，耗时未知。"],
    "ambiguous-boundary": ["Execution boundaries cannot be paired unambiguously; duration is unknown.", "无法明确配对执行边界，耗时未知。"],
  };
  return { ...timing, summary: timing.availability === "available"
    ? phrase(locale, `Recorded execution duration: ${timing.durationMs} ms.`, `记录的执行耗时：${timing.durationMs} 毫秒。`)
    : phrase(locale, ...reasons[timing.reason]) };
}

function executionNodeLabel(node, locale) {
  return node.label;
}

function adjacency(edges) {
  const incoming = new Map(), outgoing = new Map();
  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    incoming.get(edge.to).push(edge);
    outgoing.get(edge.from).push(edge);
  }
  return { incoming, outgoing };
}

function explainExecutionNode(context, node, envelopes, locale) {
  const { labels, incoming, outgoing } = context;
  const evidence = node.evidence.map((reference) => {
    const envelope = envelopes[reference.envelopeIndex];
    return envelope
      ? explainEvidenceUnchecked(envelope, reference.envelopeIndex, reference.role, locale)
      : {
          envelopeIndex: reference.envelopeIndex,
          kind: reference.kind,
          ...(reference.role ? { role: reference.role } : {}),
          direction: "event",
          claim: phrase(locale, "The referenced source record was not supplied.", "未提供所引用的源记录。"),
          basis: "inferred",
        };
  });
  const channels = addNodeChannels(node, evidence, envelopes, locale, context.bodyDiagnostics);
  const causes = (incoming.get(node.id) || []).map((edge) => ({
    nodeId: edge.from,
    label: labels.get(edge.from) || edge.from,
    relation: edge.kind,
    summary: relationSummary(edge.kind, "cause", labels.get(edge.from) || edge.from, locale),
    basis: "observed",
  }));
  const effects = (outgoing.get(node.id) || []).map((edge) => ({
    nodeId: edge.to,
    label: labels.get(edge.to) || edge.to,
    relation: edge.kind,
    summary: relationSummary(edge.kind, "effect", labels.get(edge.to) || edge.to, locale),
    basis: "observed",
  }));
  const limitations = [];
  if (node.metadata?.agentScopeUnresolved) limitations.push(phrase(locale,
    "The recorded Agent path does not identify one invocation. This evidence is not assigned to a child call.",
    "记录中的 Agent 名称路径不能唯一确定调用实例；此证据未分配给任何子调用。"));
  if (!evidence.length) limitations.push(phrase(locale, "No source record was linked to this node.", "这个节点没有关联源记录。"));
  if (channels.input.availability === "not-observed") limitations.push(phrase(locale, "The node input was not captured.", "没有捕获这个节点的输入。"));
  if (channels.output.availability === "not-observed") limitations.push(phrase(locale, "The node output was not captured.", "没有捕获这个节点的输出。"));
  return {
    id: node.id,
    path: [node.id],
    label: executionNodeLabel(node, locale),
    kind: node.kind,
    component: node.component,
    status: node.status,
    basis: "observed",
    headline: nodeHeadline(node, channels, locale),
    summary: nodeSummary(node, channels, locale),
    rationale: causes.length
      ? causes.map((cause) => cause.summary).join(" ")
      : phrase(locale, "This is an entry point in the observed run.", "这是当前运行中观察到的入口。"),
    input: channels.input,
    output: channels.output,
    causes,
    effects,
    timing: explainTiming(nodeTiming(node, context.timing), locale),
    evidence,
    technical: {
      correlation: copyJSON(node.correlation),
      metadata: copyJSON(node.metadata),
    },
    limitations,
  };
}

function validateExecutionDAG(dag) {
  return isObject(dag)
    && own(dag, "schemaVersion") === 1
    && typeof own(dag, "runId") === "string"
    && Array.isArray(own(dag, "nodes"))
    && Array.isArray(own(dag, "edges"));
}

function rootBoundary(payload) {
  const address = own(payload, "address");
  return Array.isArray(address) && address.length === 1 && own(address[0], "type") === "runnable";
}

function sameJSON(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameJSON(left[key], right[key]));
}

// Run-level values require source identity. A graph's last child output or a
// model's intermediate assistant message is never a substitute for root I/O.
function runSummary(envelopes, dag, options, definitionOnly = false, timingContext = createTimingContext(envelopes), snapshot) {
  const locale = localeOf(options);
  const entries = envelopes.map((envelope, index) => ({ envelope, index, payload: own(envelope, "payload") }))
    .filter(({ envelope }) => !dag?.runId || !own(own(envelope, "correlation"), "runId") || own(envelope.correlation, "runId") === dag.runId);
  const completion = runCompletion(entries.map(({ envelope }) => envelope));
  const markers = entries.filter(({ envelope }) => envelope.kind === "run.lifecycle");
  const end = markers.find(({ payload }) => own(payload, "state") === "ended");
  const diagnostics = Array.isArray(own(options, "diagnostics")) ? own(options, "diagnostics") : [];
  const issues = [];
  for (const node of dag?.nodes || []) {
    const interrupted = node.metadata?.executionState === "interrupted";
    if (!node.errorMessage && !interrupted) continue;
    const references = node.evidence.filter(({ role, kind }) => interrupted ? role === "interruption" : role === "error" || kind === "workflow.snapshot");
    const indexes = (references.length ? references : node.evidence).map(({ envelopeIndex }) => envelopeIndex);
    const lastError = indexes.reduce((last, index) => Math.max(last, index), -1);
    const recovered = !interrupted && node.status === "success" && node.evidence.some(({ envelopeIndex, role }) => envelopeIndex > lastError && ["output", "tool", "tool-result", "end"].includes(role));
    const nested = Boolean(node.metadata?.parentAgentScopeId || node.metadata?.agentScopeUnresolved);
    issues.push({ kind: interrupted ? "interruption" : "error", scope: !nested && (node.metadata?.scope === "run" || node.kind === "error" || rootBoundary(entries.find(({ index }) => indexes.includes(index))?.payload)) ? "run" : "step", message: node.metadata?.interruptionReason || node.errorMessage || phrase(locale, "Run interrupted", "运行中断"), nodeId: node.id, recovered, evidenceEnvelopeIndexes: [...new Set(indexes)] });
  }
  const hasRuntime = entries.some(({ envelope, payload }) => ["agent.event", "callback.event", "component.io", "schema.message", "schema.agentic_message"].includes(envelope.kind) || envelope.kind === "workflow.snapshot" && own(own(payload, "execution"), "nodes")?.length);
  const declared = !hasRuntime && !markers.length && (definitionOnly || entries.some(({ envelope }) => ["compose.graph", "workflow.snapshot"].includes(envelope.kind)));
  const state = declared ? "definition-only" : end && completion.outcome !== "unknown" ? completion.outcome : issues.some(({ kind }) => kind === "interruption") ? "interrupted" : "unknown";
  const resultLabels = { success: ["Succeeded", "执行成功"], failed: ["Failed", "执行失败"], cancelled: ["Cancelled", "已取消"], interrupted: ["Interrupted", "已中断"], unknown: ["Final outcome not recorded", "最终结果未确认"], "definition-only": ["Definition only · no execution recorded", "仅定义 · 没有执行记录"] };
  const valueItem = (entry, value, label, indexes = [entry.index]) => {
    const pointer = entry.envelope.kind === "component.io" ? "/payload/body" : "/payload/content";
    const captured = recordedBodyCapture(entry.envelope, entry.index, diagnostics, pointer);
    const availability = recordedValueAvailability(value, captured);
    return { label, availability, ...(value !== undefined && own(captured, "status") !== "omitted" ? { value: copyJSON(value) } : {}), evidenceEnvelopeIndexes: indexes,
      ...(own(captured, "status") === "omitted" ? { reason: own(captured, "reason") || "not_captured" } : {}) };
  };
  const roots = entries.filter(({ envelope, payload }) => envelope.kind === "component.io" && ["Graph", "Workflow"].includes(own(payload, "component")) && rootBoundary(payload)
    && !["node"].includes(own(own(own(envelope, "metadata"), "io"), "scope")))
    .filter(({ envelope, payload, index }) => {
      if (end && index > end.index) return false;
      const entityId = own(own(envelope, "correlation"), "entityId");
      if (entityId && entityId !== `runnable:${own(payload.address[0], "id")}`) return false;
      const eventId = own(own(envelope, "correlation"), "eventId");
      const invocationId = own(envelope.correlation, "invocationId");
      if (!eventId) return payload.direction !== "output" || !invocationId || entries.some((entry) => entry.index < index && entry.envelope.kind === "component.io"
        && own(entry.payload, "direction") === "input" && rootBoundary(entry.payload) && sameJSON(entry.payload.address, payload.address)
        && own(own(entry.envelope, "correlation"), "invocationId") === invocationId);
      const callback = entries.find((entry) => entry.envelope.kind === "callback.event" && own(own(entry.envelope, "correlation"), "eventId") === eventId);
      const start = invocationId && entries.find((entry) => entry.envelope.kind === "callback.event" && own(entry.payload, "phase") === "start"
        && (own(entry.envelope.correlation, "invocationId") || own(entry.envelope.correlation, "eventId")) === invocationId
        && own(entry.envelope.correlation, "entityId") === entityId && sameJSON(entry.payload.address, payload.address));
      return callback && rootBoundary(callback.payload) && own(callback.payload, "phase") === (payload.direction === "input" ? "start" : "end")
        && own(callback.envelope.correlation, "entityId") === entityId
        && own(own(callback.payload, "run"), "component") === payload.component
        && own(callback.payload, "streaming") === own(payload, "streaming")
        && sameJSON(callback.payload.address, payload.address) && sameJSON(callback.payload.nodePath || [], payload.nodePath || [])
        && (!invocationId || start && (payload.direction === "input" ? start.index === callback.index : start.index < callback.index))
        && (!invocationId || invocationId === (own(callback.envelope.correlation, "invocationId") || (callback.payload.phase === "start" ? eventId : undefined)));
    });
  const inputs = roots.filter(({ payload }) => payload.direction === "input").map((entry) => valueItem(entry, own(entry.payload, "body"), phrase(locale, "Root input", "根调用输入")));
  const outputs = roots.filter(({ payload }) => payload.direction === "output").map((entry) => valueItem(entry, own(entry.payload, "body"), phrase(locale, "Root output", "根调用输出")));
  const agentEvents = entries.filter(({ envelope }) => envelope.kind === "agent.event");
  if (!roots.length && (agentEvents.length || entries.some(({ envelope }) => envelope.kind === "schema.message"))) {
    const firstRuntime = entries.find(({ envelope }) => ["agent.event", "component.io", "callback.event"].includes(envelope.kind))?.index ?? Infinity;
    for (const entry of entries) {
      if (entry.envelope.kind === "schema.message" && entry.index < firstRuntime && own(entry.payload, "role") === "user") inputs.push(valueItem(entry, own(entry.payload, "content"), phrase(locale, "User input", "用户输入")));
    }
    const last = agentEvents.filter(({ payload }) => Array.isArray(own(payload, "runPath")) && own(payload, "runPath").length === 1).at(-1);
    const details = messageDetails(last?.payload);
    const root = own(last?.payload, "runPath");
    if (end && completion.outcome === "success" && Array.isArray(root) && root.length === 1 && details.role === "assistant" && !details.toolCalls.length && own(details.message, "streaming") !== true && !own(last.payload, "action") && !own(last.payload, "error")) {
      const message = entries.find(({ envelope, index, payload }) => envelope.kind === "schema.message" && index > last.index && index < end.index && own(payload, "role") === "assistant" && sameJSON(payload, details.value));
      if (message) outputs.push(valueItem(message, own(message.payload, "content"), phrase(locale, "Final assistant answer", "最终回答"), [last.index, message.index]));
    }
  }
  const channel = (items, direction) => {
    const available = items.filter(({ availability }) => availability !== "not-observed");
    const availability = !available.length ? "not-observed" : available.every((item) => item.availability === "redacted") ? "redacted" : items.some((item) => ["redacted", "truncated", "not-observed"].includes(item.availability)) ? "partial" : "available";
    const reason = items.map((item) => item.reason).filter(Boolean).join(", ");
    const summary = availability === "not-observed" ? direction === "input" ? phrase(locale, "Root input was not recorded; this does not mean an empty input.", "没有记录根输入，不代表输入为空。") : phrase(locale, "No verified final root output was recorded; intermediate results are shown only in their steps.", "没有记录可确认的最终根输出；中间结果仅在对应步骤展示。") : direction === "input" ? phrase(locale, "Recorded root input", "已记录根输入") : phrase(locale, "Recorded final root output", "已记录最终根输出");
    return { availability, summary: reason ? `${summary} (${reason})` : summary, items };
  };
  const input = channel(inputs, "input"), output = channel(outputs, "output");
  const capture = completion.capture || "unknown";
  const limitations = [...new Set(diagnostics.filter(({ code }) => /^projection\./.test(code)).map(({ message }) => message))];
  for (const { envelope } of entries) {
    const captured = own(own(envelope, "metadata"), "capture");
    const reason = own(captured, "reason");
    if (own(captured, "status") === "omitted") limitations.push(phrase(locale, `A body was not captured${reason ? ` (${reason})` : ""}.`, `有正文未采集${reason ? `（${reason}）` : ""}。`));
    if (own(captured, "redacted") === true) limitations.push(phrase(locale, "Captured values were redacted.", "采集值已经脱敏。"));
  }
  if (capture === "partial") limitations.unshift(phrase(locale, "Some evidence was omitted or altered during capture.", "部分证据在采集时被省略或修改。"));
  if (capture === "unknown") limitations.unshift(phrase(locale, "Capture completeness was not recorded.", "未记录采集完整性。"));
  if (input.availability === "not-observed") limitations.push(input.summary);
  if (output.availability === "not-observed") limitations.push(output.summary);
  return {
    result: { state, basis: declared ? "declared" : completion.basis, label: phrase(locale, ...resultLabels[state]), evidenceEnvelopeIndexes: (declared ? entries.filter(({ envelope }) => ["compose.graph", "workflow.snapshot"].includes(envelope.kind)) : markers).map(({ index }) => index) },
    input, output, issues,
    timing: explainTiming(declared ? boundaryTiming() : runTiming(timingContext, dag?.runId, snapshot), locale),
    capture: { status: capture, label: phrase(locale, `Evidence capture: ${capture}`, `证据采集：${capture === "complete" ? "完整" : capture === "partial" ? "部分" : "未知"}`), evidenceEnvelopeIndexes: end ? [end.index] : [], limitations: [...new Set(limitations)] },
  };
}

/** Explain a correlated execution DAG and retain traceability to its source envelopes. */
export function explainExecutionDAG(dag, envelopes = [], options = {}) {
  if (!validateExecutionDAG(dag)) {
    return failed("explanation.invalid_execution_dag", "root", "Expected an ExecutionDAG schemaVersion 1 document.");
  }
  if (!Array.isArray(envelopes)) {
    return failed("explanation.invalid_envelopes", "root.envelopes", "Expected source envelopes to be an array.");
  }
  const locale = localeOf(options);
  const bodyDiagnostics = new Map();
  for (const entry of own(options, "diagnostics") || []) {
    if (!Number.isSafeInteger(entry.envelopeIndex)) continue;
    if (!["projection.redacted", "projection.truncated"].includes(entry.code)) continue;
    if (!bodyDiagnostics.has(entry.envelopeIndex)) bodyDiagnostics.set(entry.envelopeIndex, []);
    bodyDiagnostics.get(entry.envelopeIndex).push(entry);
  }
  const context = { ...adjacency(dag.edges), labels: new Map(dag.nodes.map((node) => [node.id, executionNodeLabel(node, locale)])), timing: createTimingContext(envelopes), bodyDiagnostics };
  const run = runSummary(envelopes, dag, options, false, context.timing);
  if (run.result.state === "definition-only") {
    const workflow = envelopes.find((envelope) => envelope.kind === "workflow.snapshot");
    if (workflow) return explainWorkflowSnapshot(workflow.payload, { ...options, envelopes });
    const nodes = dag.nodes.map((node) => {
      const explained = explainExecutionNode(context, node, envelopes, locale);
      const relation = (item) => ({ ...item, basis: "declared", summary: phrase(locale, `Declared ${item.relation} relation with ${item.label}.`, `与 ${item.label} 声明了 ${item.relation} 关系。`) });
      return { ...explained, status: "declared", basis: "declared",
        headline: phrase(locale, `${node.label} is declared; no execution was recorded.`, `${node.label} 已声明；没有执行记录。`),
        summary: phrase(locale, "Declared graph structure, not an observed execution.", "这是声明的图结构，不代表已经执行。"),
        rationale: phrase(locale, "Declared topology does not establish which steps ran.", "声明的拓扑不能证明哪些步骤实际运行过。"),
        timing: explainTiming(boundaryTiming(), locale), causes: explained.causes.map(relation), effects: explained.effects.map(relation),
      };
    });
    return succeeded({ schemaVersion: EXPLANATION_SCHEMA_VERSION, subject: "graph", title: phrase(locale, "Graph definition", "Graph 定义"),
      summary: phrase(locale, `The graph declares ${nodes.length} nodes; no execution was recorded.`, `图中声明了 ${nodes.length} 个节点；没有执行记录。`),
      status: "declared", basis: "declared", runId: dag.runId, run, nodes, groups: explanationGroups(nodes, envelopes, locale, undefined, dag.runId),
      statistics: { nodeCount: nodes.length, edgeCount: dag.edges.length, toolCallCount: 0, agentToolCallNodeCount: 0, failedNodeCount: 0, evidenceCount: new Set(nodes.flatMap((node) => node.evidence.map(({ envelopeIndex }) => envelopeIndex))).size },
      limitations: [phrase(locale, "A graph definition does not contain runtime inputs, outputs, or timing.", "图定义不包含运行输入、输出或执行时间。")],
    });
  }
  const nodes = dag.nodes.map((node) => explainExecutionNode(context, node, envelopes, locale));
  const toolCount = dag.nodes.filter((node) => node.kind === "tool" && node.metadata?.executionState !== "planned").length;
  const failedCount = dag.nodes.filter((node) => node.status === "failed").length;
  const agentToolCallNodeCount = dag.nodes.filter((node) => node.kind === "agent" && Array.isArray(own(node.metadata, "toolCalls"))).length;
  const summary = dag.status === "failed"
    ? phrase(locale, `Run ${dag.runId} failed at ${failedCount} node${failedCount === 1 ? "" : "s"}.`, `运行 ${dag.runId} 在 ${failedCount} 个节点发生失败。`)
    : dag.status === "running"
      ? phrase(locale, `Run ${dag.runId} has no recorded end.`, `运行 ${dag.runId} 尚无结束记录。`)
      : dag.status === "cancelled"
        ? phrase(locale, `Run ${dag.runId} was cancelled; ${toolCount} tool executions were observed.`, `运行 ${dag.runId} 已取消；观察到 ${toolCount} 次工具执行。`)
        : dag.status === "incomplete"
          ? phrase(locale, `Run ${dag.runId} has no known final outcome.`, `运行 ${dag.runId} 的最终结果未知。`)
      : phrase(locale, `Run ${dag.runId} completed through ${dag.nodes.length} observed nodes and ${toolCount} tool call${toolCount === 1 ? "" : "s"}.`, `运行 ${dag.runId} 已完成，共经过 ${dag.nodes.length} 个可观察节点并调用 ${toolCount} 个工具。`);
  return succeeded({
    schemaVersion: EXPLANATION_SCHEMA_VERSION,
    subject: "execution",
    title: phrase(locale, `Explanation of ${dag.runId}`, `${dag.runId} 的运行解释`),
    summary,
    status: dag.status,
    basis: "observed",
    runId: dag.runId,
    run,
    nodes,
    groups: explanationGroups(nodes, envelopes, locale, undefined, dag.runId),
    statistics: {
      nodeCount: dag.nodes.length,
      edgeCount: dag.edges.length,
      toolCallCount: toolCount,
      agentToolCallNodeCount,
      failedNodeCount: failedCount,
      evidenceCount: new Set(dag.nodes.flatMap((node) => node.evidence.map((item) => item.envelopeIndex))).size,
    },
    limitations: envelopes.length
      ? []
      : [phrase(locale, "Source envelopes were not supplied, so inputs and outputs cannot be shown.", "未提供源信封，因此无法展示输入和输出。")],
  });
}

function workflowNodeSummary(node, locale) {
  const label = node.name || node.id;
  const descriptions = {
    llm: phrase(locale, `${label} invokes a model-oriented step.`, `${label} 执行模型相关步骤。`),
    io: phrase(locale, `${label} reads or returns workflow data.`, `${label} 读取或返回工作流数据。`),
    cpu: phrase(locale, `${label} performs a deterministic processing step.`, `${label} 执行确定性处理步骤。`),
    branch: phrase(locale, `${label} selects which path runs next.`, `${label} 决定下一条执行路径。`),
    merge: phrase(locale, `${label} combines preceding paths.`, `${label} 汇合之前的执行路径。`),
    graph: phrase(locale, `${label} contains a nested workflow.`, `${label} 包含一个嵌套工作流。`),
  };
  return descriptions[node.kind] || phrase(locale, `${label} is a declared workflow step.`, `${label} 是工作流中声明的步骤。`);
}

function flattenWorkflow(context, graph, prefix, locale, target) {
  const labels = new Map((graph.nodes || []).map((node) => [node.id, node.name || node.id]));
  const { incoming, outgoing } = adjacency(graph.edges || []);
  labels.set("start", phrase(locale, "Workflow start", "工作流开始"));
  labels.set("end", phrase(locale, "Workflow end", "工作流结束"));
  for (const node of graph.nodes || []) {
    const path = [...prefix, node.id];
    const execution = context.executions.get(JSON.stringify(path));
    const causes = (incoming.get(node.id) || []).map((edge) => ({
      nodeId: [...prefix, edge.from].join("/"),
      label: labels.get(edge.from) || edge.from,
      relation: (edge.channels || []).join("+") || "control",
      summary: relationSummary((edge.channels || []).includes("data") ? "data" : "control", "cause", labels.get(edge.from) || edge.from, locale),
      basis: "declared",
    }));
    const effects = (outgoing.get(node.id) || []).map((edge) => ({
      nodeId: [...prefix, edge.to].join("/"),
      label: labels.get(edge.to) || edge.to,
      relation: (edge.channels || []).join("+") || "control",
      summary: relationSummary((edge.channels || []).includes("data") ? "data" : "control", "effect", labels.get(edge.to) || edge.to, locale),
      basis: "declared",
    }));
    target.push({
      id: path.join("/"),
      path,
      label: node.name || node.id,
      kind: node.kind,
      component: node.component,
      status: execution?.status || "declared",
      basis: execution ? "observed" : "declared",
      headline: execution
        ? phrase(locale, `${node.name || node.id} finished with status ${execution.status}`, `${node.name || node.id} 的执行状态为${execution.status}`)
        : phrase(locale, `${node.name || node.id} is declared but not observed`, `${node.name || node.id} 已声明但尚未观察到运行`),
      summary: workflowNodeSummary(node, locale),
      rationale: causes.length
        ? causes.map((cause) => cause.summary).join(" ")
        : phrase(locale, "This node has no declared predecessor.", "这个节点没有声明的前置节点。"),
      input: { availability: "not-observed", summary: phrase(locale, "Runtime input was not captured by this snapshot.", "这个快照没有捕获运行时输入。"), items: [] },
      output: { availability: "not-observed", summary: phrase(locale, "Runtime output was not captured by this snapshot.", "这个快照没有捕获运行时输出。"), items: [] },
      causes,
      effects,
      timing: explainTiming(workflowTiming(execution?.status === "skipped" ? undefined : execution, context.envelopeIndex), locale),
      evidence: [],
      technical: { correlation: {}, metadata: copyJSON(node.metadata || {}) },
      limitations: [phrase(locale, "Topology explains what may run; runtime evidence is required to explain the actual values.", "拓扑只能解释可能执行什么；解释实际数据仍需要运行证据。")],
    });
    if (node.workflow) flattenWorkflow(context, node.workflow, path, locale, target);
  }
}

/** Explain a legacy or current Workflow snapshot without inventing runtime evidence. */
export function explainWorkflowSnapshot(snapshot, options = {}) {
  const adapted = adaptWorkflowSnapshot(snapshot);
  if (!adapted.ok) return failed("explanation.invalid_workflow", "root", "Expected a valid workflow snapshot.", adapted.diagnostics);
  const locale = localeOf(options);
  const nodes = [];
  const envelopes = own(options, "envelopes") || [];
  const envelopeIndex = envelopes.findIndex((envelope) => envelope.kind === "workflow.snapshot" && (envelope.payload === snapshot || sameJSON(envelope.payload, snapshot)));
  flattenWorkflow({ executions: new Map((snapshot.execution?.nodes || []).map((entry) => [JSON.stringify(entry.path), entry])), envelopeIndex: envelopeIndex < 0 ? undefined : envelopeIndex }, snapshot.workflow, [], locale, nodes);
  const observedCount = nodes.filter((node) => node.basis === "observed").length;
  const failedCount = nodes.filter((node) => node.status === "failed").length;
  return succeeded({
    schemaVersion: EXPLANATION_SCHEMA_VERSION,
    subject: "workflow",
    title: snapshot.workflow.name || phrase(locale, "Workflow explanation", "工作流解释"),
    summary: phrase(locale,
      `The workflow declares ${nodes.length} node${nodes.length === 1 ? "" : "s"}; ${observedCount} include execution outcomes.`,
      `这个工作流声明了 ${nodes.length} 个节点，其中 ${observedCount} 个包含执行结果。`,
    ),
    status: failedCount ? "failed" : observedCount ? "success" : "declared",
    basis: observedCount ? "observed" : "declared",
    ...(snapshot.execution?.id ? { runId: snapshot.execution.id } : {}),
    run: runSummary(envelopes, snapshot.execution?.id ? { runId: snapshot.execution.id } : undefined, options, observedCount === 0, createTimingContext(envelopes), snapshot),
    nodes,
    groups: explanationGroups(nodes, envelopes, locale, snapshot),
    statistics: {
      nodeCount: nodes.length,
      edgeCount: nodes.reduce((count, node) => count + node.effects.length, 0),
      toolCallCount: 0,
      agentToolCallNodeCount: 0,
      failedNodeCount: failedCount,
      evidenceCount: 0,
    },
    limitations: [phrase(locale, "A Workflow snapshot describes topology and outcomes, but not complete runtime inputs and outputs.", "Workflow 快照描述拓扑和执行结果，但不包含完整的运行时输入输出。")],
  });
}

function explainEnvelopeCollection(envelopes, options) {
  const locale = localeOf(options);
  const evidence = [];
  const diagnostics = [];
  for (const [index, envelope] of envelopes.entries()) {
    const result = explainEinoEnvelope(envelope, { locale, envelopeIndex: index });
    if (result.ok) evidence.push(result.explanation);
    else diagnostics.push(...result.diagnostics);
  }
  if (diagnostics.length) return freeze({ ok: false, diagnostics });
  const nodes = evidence.map((item) => {
    const inputBoundary = item.direction === "input";
    const outputBoundary = item.direction === "output";
    const valueObserved = item.value !== undefined;
    const inputAvailable = inputBoundary && valueObserved;
    const outputAvailable = outputBoundary && valueObserved;
    const limitations = [phrase(locale, "A single envelope cannot establish causal order by itself.", "单个信封本身无法确定因果顺序。")];
    if ((inputBoundary || outputBoundary) && !valueObserved) {
      limitations.push(inputBoundary
        ? phrase(locale, "The input boundary was observed, but its value was not captured.", "观察到了输入边界，但没有捕获输入值。")
        : phrase(locale, "The output boundary was observed, but its value was not captured.", "观察到了输出边界，但没有捕获输出值。"));
    }
    return {
      id: `envelope:${item.envelopeIndex}`,
      path: [`envelope:${item.envelopeIndex}`],
      label: item.kind,
      kind: "event",
      component: item.source?.module || "eino",
      status: "observed",
      basis: "observed",
      headline: item.claim,
      summary: item.claim,
      rationale: phrase(locale, "This explanation is based directly on one validated envelope.", "这项解释直接来自一个已校验的信封。"),
      input: {
        availability: inputAvailable ? "available" : "not-observed",
        summary: inputAvailable
          ? item.claim
          : inputBoundary
            ? phrase(locale, "The input boundary was observed, but no input value was captured.", "观察到了输入边界，但没有捕获输入值。")
            : phrase(locale, "No input is represented.", "这条记录不表示输入。"),
        items: inputAvailable ? [channelItem(item.kind, item.value, item.envelopeIndex)] : [],
      },
      output: {
        availability: outputAvailable ? "available" : "not-observed",
        summary: outputAvailable
          ? item.claim
          : outputBoundary
            ? phrase(locale, "The output boundary was observed, but no output value was captured.", "观察到了输出边界，但没有捕获输出值。")
            : phrase(locale, "No output is represented.", "这条记录不表示输出。"),
        items: outputAvailable ? [channelItem(item.kind, item.value, item.envelopeIndex)] : [],
      },
      causes: [],
      effects: [],
      // A message observation is not a zero-duration execution.
      timing: explainTiming(boundaryTiming(), locale),
      evidence: [item],
      technical: { correlation: copyJSON(own(envelopes[item.envelopeIndex], "correlation") || {}), metadata: copyJSON(own(envelopes[item.envelopeIndex], "metadata") || {}) },
      limitations,
    };
  });
  return succeeded({
    schemaVersion: EXPLANATION_SCHEMA_VERSION,
    subject: "envelope",
    title: phrase(locale, "Eino information explanation", "Eino 信息解释"),
    summary: phrase(locale, `${evidence.length} validated envelope${evidence.length === 1 ? " is" : "s are"} explained independently.`, `已分别解释 ${evidence.length} 个通过校验的信封。`),
    status: "observed",
    basis: "observed",
    nodes,
    groups: explanationGroups(nodes, envelopes, locale),
    run: runSummary(envelopes, undefined, options),
    statistics: { nodeCount: nodes.length, edgeCount: 0, toolCallCount: 0, agentToolCallNodeCount: 0, failedNodeCount: 0, evidenceCount: evidence.length },
    limitations: [phrase(locale, "Independent envelopes do not establish a complete run unless correlation data is available.", "独立信封只有在具备关联信息时才能构成完整运行。")],
  });
}

/** Explain any supported Eino information form through one deterministic entry point. */
export function explainEino(value, options = {}) {
  if (Array.isArray(value)) {
    if (!value.length) return failed("explanation.empty_collection", "root", "At least one Eino value is required.");
    const execution = buildExecutionDAG(value, own(options, "runId") ? { runId: own(options, "runId") } : {});
    if (execution.ok && (execution.dag.nodes.length || value.some(({ kind }) => ["compose.graph", "workflow.snapshot"].includes(kind)))) {
      const runId = own(options, "runId");
      const indexes = runId ? value.flatMap((entry, index) => own(own(entry, "correlation"), "runId") === runId ? [index] : []) : value.map((_, index) => index);
      const dag = runId ? { ...execution.dag, nodes: execution.dag.nodes.map((node) => ({ ...node,
        evidence: node.evidence.map((reference) => ({ ...reference, envelopeIndex: indexes[reference.envelopeIndex] })),
      })) } : execution.dag;
      return explainExecutionDAG(dag, value, options);
    }
    if (execution.ok) return explainEnvelopeCollection(value, options);
    return freeze({ ok: false, diagnostics: execution.diagnostics });
  }
  if (validateExecutionDAG(value)) return explainExecutionDAG(value, own(options, "envelopes") || [], options);
  if (isObject(value) && own(value, "schemaVersion") === 1 && isObject(own(value, "workflow"))) {
    return explainWorkflowSnapshot(value, options);
  }
  if (isObject(value) && own(value, "protocol") === "eino-dag") return ["compose.graph", "workflow.snapshot"].includes(own(value, "kind")) ? explainEino([value], options) : explainEnvelopeCollection([value], options);
  return failed("explanation.unsupported_input", "root", "Expected Eino envelopes, an ExecutionDAG, or a Workflow snapshot.");
}
