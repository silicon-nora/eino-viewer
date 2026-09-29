// Presentation-only adaptation for the published compatibility renderer. The
// source document, ExecutionDAG and public snapshot projection stay untouched.
import { createAgentScopeContext } from "./execution-scopes.js";
import { buildReadingStepPresentation } from "./reading-presentation.js";

const words = {
  en: {
    unconfirmed: "Invocation unconfirmed", failedUnconfirmed: "Failed · invocation unconfirmed",
    planned: "Planned only", interrupted: "Interrupted", unrecorded: "Result not recorded",
    cancelled: "Cancelled", incomplete: "Incomplete", running: "End not recorded",
    success: "Succeeded", failed: "Failed", skipped: "Skipped",
    user: "User input", assistant: "Assistant message", system: "System message", tool: "Tool message",
  },
  zh: {
    unconfirmed: "调用归属未确认", failedUnconfirmed: "失败 · 调用归属未确认",
    planned: "仅计划", interrupted: "已中断", unrecorded: "结果未记录",
    cancelled: "已取消", incomplete: "结果未记录", running: "结束未记录",
    success: "成功", failed: "失败", skipped: "已跳过",
    user: "用户输入", assistant: "助手消息", system: "系统消息", tool: "工具消息",
  },
};

export function presentationLocale(locale) {
  return locale === "zh" || locale?.statuses?.success === "成功" ? "zh" : "en";
}

// A presentation hint for repeated, non-overlapping calls at one exact source
// location. It is computed from the full run once; filtered views only consume
// the resulting IDs and must never renumber their visible subset.
export function buildRepeatedInvocationLabels(execution, envelopes, locale = "en") {
  const labels = new Map();
  if (!Array.isArray(execution?.nodes) || !Array.isArray(envelopes) || typeof execution.runId !== "string") return labels;
  const nodeById = new Map(), duplicateNodeIds = new Set(), invocationCounts = new Map(), parents = new Map(), callbackIndexes = new Map();
  for (const node of execution.nodes) {
    if (nodeById.has(node.id)) duplicateNodeIds.add(node.id);
    nodeById.set(node.id, node);
    const id = node.correlation?.invocationId;
    if (id) invocationCounts.set(id, (invocationCounts.get(id) || 0) + 1);
  }
  for (const edge of execution.edges || []) if (edge.kind === "parent-child") {
    if (!parents.has(edge.to)) parents.set(edge.to, []);
    parents.get(edge.to).push(edge.from);
  }
  envelopes.forEach((envelope, index) => {
    if (envelope?.kind !== "callback.event" || envelope.correlation?.runId !== execution.runId || !envelope.correlation?.invocationId) return;
    const id = envelope.correlation.invocationId;
    if (!callbackIndexes.has(id)) callbackIndexes.set(id, []);
    callbackIndexes.get(id).push(index);
  });
  const location = (payload) => {
    const address = payload?.address, path = payload?.nodePath === undefined ? [] : payload.nodePath;
    if (!Array.isArray(address) || !address.length || !Array.isArray(path) || path.some((part) => typeof part !== "string")
      || typeof payload.run?.component !== "string" || !payload.run.component
      || address.some((part) => !part || typeof part.type !== "string" || typeof part.id !== "string" || (part.subId !== undefined && typeof part.subId !== "string"))) return undefined;
    return JSON.stringify([address.map(({ type, id, subId }) => [type, id, subId ?? null]), path, payload.run.component]);
  };
  const observations = new Map(), blocked = new Set(), groups = new Map();
  for (const node of execution.nodes) {
    const references = (node.evidence || []).filter(({ envelopeIndex }) => envelopes[envelopeIndex]?.kind === "callback.event");
    if (!references.length && !node.correlation?.invocationId) continue;
    const correlation = node.correlation || {}, parentIds = parents.get(node.id) || [];
    // If a call at this entity cannot be assigned to a valid parent/boundary,
    // suppress numbering rather than silently counting only its intact peers.
    const coarseKey = JSON.stringify([correlation.runId, correlation.entityId]);
    const start = references.find(({ envelopeIndex }) => envelopes[envelopeIndex].payload?.phase === "start");
    const terminal = references.find(({ envelopeIndex }) => ["end", "error"].includes(envelopes[envelopeIndex].payload?.phase));
    const startEnvelope = start && envelopes[start.envelopeIndex], terminalEnvelope = terminal && envelopes[terminal.envelopeIndex];
    const source = startEnvelope?.payload, end = terminalEnvelope?.payload;
    const sourceLocation = location(source);
    const knownIndexes = callbackIndexes.get(correlation.invocationId) || [];
    const valid = references.length === 2 && start && terminal && start.role === "start" && terminal.role === end.phase
      && Number.isSafeInteger(start.envelopeIndex) && start.envelopeIndex >= 0 && start.envelopeIndex < terminal.envelopeIndex
      && sourceLocation !== undefined && sourceLocation === location(end) && source.streaming === false && end.streaming === false
      && !duplicateNodeIds.has(node.id) && invocationCounts.get(correlation.invocationId) === 1
      && knownIndexes.length === 2 && knownIndexes[0] === start.envelopeIndex && knownIndexes[1] === terminal.envelopeIndex
      && typeof correlation.entityId === "string" && correlation.entityId !== "" && correlation.runId === execution.runId
      && typeof correlation.invocationId === "string" && correlation.invocationId !== ""
      && source.run.component === node.component
      && [startEnvelope, terminalEnvelope].every((envelope) => envelope.correlation?.runId === correlation.runId
        && envelope.correlation?.entityId === correlation.entityId && envelope.correlation?.invocationId === correlation.invocationId
        && envelope.correlation?.parentEntityId === correlation.parentEntityId)
      && !node.metadata?.agentScopeUnresolved && !node.metadata?.callbackCorrelation && !node.metadata?.ioCorrelation;
    const observation = { node, coarseKey, parentIds, sourceLocation, start: start?.envelopeIndex, terminal: terminal?.envelopeIndex, valid: Boolean(valid) };
    observations.set(node.id, observation);
    if (!valid) blocked.add(coarseKey);
  }
  for (const observation of observations.values()) {
    const { node, parentIds, coarseKey } = observation;
    if (!observation.valid) continue;
    let parentId;
    if (parentIds.length === 1) {
      const parent = observations.get(parentIds[0]);
      if (!parent?.valid || parent.node.correlation.entityId !== node.correlation.parentEntityId
        || parent.start >= observation.start || parent.terminal <= observation.terminal) {
        blocked.add(coarseKey);
        continue;
      }
      parentId = [parent.node.id, parent.node.correlation.invocationId];
    } else if (parentIds.length > 1 || node.correlation.parentEntityId) {
      blocked.add(coarseKey);
      continue;
    }
    const key = JSON.stringify([node.correlation.runId, node.correlation.entityId, observation.sourceLocation, parentId ?? null]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(observation);
  }
  const language = presentationLocale(locale);
  for (const group of groups.values()) {
    if (group.length < 2 || group.some(({ coarseKey }) => blocked.has(coarseKey))) continue;
    group.sort((left, right) => left.start - right.start);
    if (group.some((entry, index) => index > 0 && group[index - 1].terminal >= entry.start)) continue;
    group.forEach(({ node }, index) => labels.set(node.id, language === "zh" ? `第 ${index + 1} 次` : `Call ${index + 1}`));
  }
  return labels;
}

// Identity is not execution order. Only colliding source names receive these
// facts, and a full-run map remains authoritative in every filtered view.
export function buildStepIdentityLabels(execution, envelopes) {
  const labels = new Map();
  if (!Array.isArray(execution?.nodes) || !Array.isArray(envelopes) || typeof execution.runId !== "string") return labels;
  const scopeContext = createAgentScopeContext(envelopes);
  const addressKey = (address) => JSON.stringify(address.map(({ type, id, subId }) => [type, id, subId ?? null]));
  const displayParts = (parts) => parts.some((part) => /[\/\u0000-\u001f]/.test(part) || part.trim() !== part)
    ? JSON.stringify(parts) : parts.join(" / ");
  const sourceDefinitions = new Map();
  const definitionNodes = (index) => {
    if (sourceDefinitions.has(index)) return sourceDefinitions.get(index);
    const paths = new Map(), envelope = envelopes[index];
    if (envelope?.kind === "workflow.snapshot" && envelope.correlation?.runId === execution.runId) {
      const pending = [{ graph: envelope.payload?.workflow, path: [] }];
      while (pending.length) {
        const { graph, path } = pending.pop();
        for (const node of graph?.nodes || []) {
          const next = [...path, node.id], key = JSON.stringify(next);
          if (!paths.has(key)) paths.set(key, []);
          paths.get(key).push(node);
          if (node.workflow) pending.push({ graph: node.workflow, path: next });
        }
      }
    }
    sourceDefinitions.set(index, paths);
    return paths;
  };
  const candidates = [], identityCounts = new Map(), idCounts = new Map();
  for (const node of execution.nodes) idCounts.set(node.id, (idCounts.get(node.id) || 0) + 1);
  for (const node of execution.nodes) {
    if (idCounts.get(node.id) !== 1 || node.correlation?.runId !== execution.runId) continue;
    const metadata = node.metadata || {}, references = node.evidence || [];
    if (metadata.agentScopeUnresolved || metadata.ioCorrelation || metadata.callbackCorrelation) continue;
    let candidate;
    if (node.kind === "tool") {
      const callId = node.correlation?.toolCallId || metadata.toolCallId, name = metadata.toolName;
      if (typeof name !== "string" || !name || typeof callId !== "string" || !callId
        || node.correlation?.toolCallId !== undefined && node.correlation.toolCallId !== callId
        || metadata.toolCallId !== undefined && metadata.toolCallId !== callId) continue;
      const sources = references.map(({ envelopeIndex }) => envelopes[envelopeIndex])
        .filter((envelope) => envelope?.kind === "component.io" && envelope.payload?.component === "Tool");
      if (!sources.length) continue;
      let identity, scope, valid = true;
      for (const envelope of sources) {
        const payload = envelope.payload, address = payload.address, tool = Array.isArray(address) ? address.at(-1) : undefined;
        if (envelope.correlation?.runId !== execution.runId || payload.streaming !== false || tool?.type !== "tool"
          || tool.id !== name || tool.subId !== callId || payload.name !== undefined && payload.name !== name
          || address.some((part) => !part || typeof part.type !== "string" || typeof part.id !== "string" || part.subId !== undefined && typeof part.subId !== "string")) {
          valid = false;
          break;
        }
        const sourceScope = scopeContext.forEnvelope(envelope), sourceIdentity = addressKey(address);
        if (!sourceScope || identity !== undefined && identity !== sourceIdentity
          || metadata.agentScopeId !== undefined && metadata.agentScopeId !== sourceScope.id
          || metadata.agentScopePath !== undefined && JSON.stringify(metadata.agentScopePath) !== JSON.stringify(sourceScope.path)) {
          valid = false;
          break;
        }
        identity = sourceIdentity;
        scope = sourceScope;
      }
      if (!valid) continue;
      const callers = scope.address.filter(({ type, subId }) => type === "tool" && typeof subId === "string" && subId).map(({ subId }) => subId);
      candidate = { node, bucket: JSON.stringify(["tool", name]), identity: JSON.stringify(["tool", execution.runId, identity]),
        value: callId, qualified: displayParts([...callers, callId]), scoped: displayParts([...scope.path, ...callers, callId]) };
    } else if (node.kind === "workflow" && metadata.sourceKind === "workflow.snapshot") {
      const path = metadata.sourceNodePath;
      if (!Array.isArray(path) || !path.length || path.some((part) => typeof part !== "string" || !part)) continue;
      const key = JSON.stringify(path);
      const definitions = references.filter(({ kind }) => kind === "workflow.snapshot").flatMap(({ envelopeIndex }) => definitionNodes(envelopeIndex).get(key) || []);
      if (definitions.length !== 1 || (definitions[0].name || definitions[0].id) !== node.label
        || (definitions[0].component || "compose.Graph") !== node.component) continue;
      const sources = references.map(({ envelopeIndex }) => envelopes[envelopeIndex]).filter((envelope) => envelope?.kind === "component.io");
      if (sources.some((envelope) => envelope.correlation?.runId !== execution.runId || JSON.stringify(envelope.payload?.nodePath) !== key)) continue;
      candidate = { node, bucket: JSON.stringify(["workflow", node.label]), identity: JSON.stringify(["workflow", execution.runId, path]), value: displayParts(path) };
    }
    if (!candidate) continue;
    candidates.push(candidate);
    identityCounts.set(candidate.identity, (identityCounts.get(candidate.identity) || 0) + 1);
  }
  const buckets = new Map();
  for (const candidate of candidates) {
    if (identityCounts.get(candidate.identity) !== 1) continue;
    if (!buckets.has(candidate.bucket)) buckets.set(candidate.bucket, []);
    buckets.get(candidate.bucket).push(candidate);
  }
  const counts = (items, field) => {
    const result = new Map();
    for (const item of items) result.set(item[field], (result.get(item[field]) || 0) + 1);
    return result;
  };
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const values = counts(bucket, "value");
    for (const item of bucket) item.label = values.get(item.value) > 1 ? item.qualified || item.value : item.value;
    const qualified = counts(bucket, "label");
    for (const item of bucket) if (qualified.get(item.label) > 1) item.label = item.scoped || item.label;
    const final = counts(bucket, "label");
    for (const item of bucket) if (final.get(item.label) === 1) labels.set(item.node.id, item.label);
  }
  return labels;
}

function stateLabel(metadata, status, language) {
  const text = words[language];
  if (metadata?.agentScopeUnresolved) return status === "failed" ? text.failedUnconfirmed : text.unconfirmed;
  if (status === "failed") return text.failed;
  return text[metadata?.executionState] || (["cancelled", "incomplete", "running", "skipped"].includes(status) ? text[status] : undefined);
}

function shortComponent(component) {
  return component?.replace(/^(?:components|compose|schema|adk)\./, "");
}

function boundaryDuration(value) {
  const start = value?.startedAtMs, end = value?.finishedAtMs;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start ? end - start : undefined;
}

function recordedDuration(timing, outcome) {
  if (timing === undefined) return boundaryDuration(outcome);
  // An explicit unknown/invalid result is authoritative. Never fall back to a
  // supplied duration or an observation span after boundary validation failed.
  if (timing.semantics !== "recorded-boundaries" || timing.availability !== "available") return undefined;
  const duration = boundaryDuration(timing);
  return duration !== undefined && (timing.durationMs === undefined || timing.durationMs === duration) ? duration : undefined;
}

export function workflowNodeLabel(node) {
  const presentation = node.metadata?.einoViewerPresentation;
  const name = presentation?.name || node.name || node.id;
  const component = shortComponent(node.component);
  const detail = [component?.toLowerCase() === name.toLowerCase() ? undefined : component, presentation?.invocation, presentation?.identity, presentation?.state, presentation?.timing].filter(Boolean);
  return [name, detail.join(" · ")].filter(Boolean).join("\n");
}

export function workflowPresentationSnapshot(snapshot, locale = "en", timings, invocationLabels, identityLabels) {
  const language = presentationLocale(locale);
  const execution = new Map((snapshot.execution?.nodes || []).map((node) => [JSON.stringify(node.path), node]));
  const neutralPaths = new Set();
  function graph(value, path = []) {
    return { ...value, nodes: value.nodes.map((node) => {
      const nodePath = [...path, node.id];
      const key = JSON.stringify(nodePath);
      const outcome = execution.get(key);
      const metadata = node.metadata || {};
      const status = metadata.executionStatus || outcome?.status;
      const isExecution = status !== undefined || metadata.agentScopeUnresolved || metadata.executionState;
      if (status !== "failed" && (metadata.agentScopeUnresolved || metadata.executionState === "planned"
        || ["running", "incomplete", "cancelled"].includes(status))) neutralPaths.add(key);
      const copy = { ...node, ...(node.workflow ? { workflow: graph(node.workflow, nodePath) } : {}) };
      if (!isExecution) return copy;
      const { name } = buildReadingStepPresentation(node, { locale: language });
      const state = stateLabel(metadata, status, language);
      // Native workflow timing uses the full path; repeated local node IDs in
      // sibling subgraphs must not borrow one another's execution duration.
      const sourceTiming = timings?.get(nodePath.join("/"));
      const duration = metadata.agentScopeUnresolved || metadata.executionState === "planned" ? undefined : recordedDuration(sourceTiming, outcome);
      const timing = duration === undefined ? undefined : `${duration} ms`;
      const invocation = invocationLabels === undefined ? metadata.einoViewerPresentation?.invocation : invocationLabels.get(node.id);
      const identity = identityLabels === undefined ? metadata.einoViewerPresentation?.identity : identityLabels.get(node.id);
      const sourceName = metadata.einoViewerPresentation?.sourceName || node.name || node.id;
      copy.metadata = { ...metadata, einoViewerPresentation: { sourceName, name, ...(invocation ? { invocation } : {}), ...(identity ? { identity } : {}), ...(state ? { state } : {}), ...(timing ? { timing } : {}) } };
      // The renderer's keyboard node description has no formatter. Its source
      // name therefore carries the same truthful state as the visible label.
      copy.name = [name, invocation, identity, state, timing].filter(Boolean).join(" · ");
      return copy;
    }) };
  }
  const workflow = graph(snapshot.workflow);
  return { ...snapshot, workflow, ...(snapshot.execution ? { execution: {
    ...snapshot.execution,
    // The compatibility renderer has no unknown/incomplete/cancelled outcome.
    // Omit misleading colors/statuses (including its running→skipped fallback),
    // but retain every node, its truthful label, and all recorded failures.
    ...(Array.isArray(snapshot.execution.nodes) ? {
      nodes: snapshot.execution.nodes.filter((node) => !neutralPaths.has(JSON.stringify(node.path))),
    } : {}),
  } } : {}) };
}

export function workflowAccessibilityLabel(summary, visible, locale = "en") {
  const language = presentationLocale(locale);
  const text = words[language];
  const states = new Map();
  for (const node of visible.nodes || []) {
    const metadata = node.metadata || {};
    const status = metadata.executionStatus || node.status;
    const label = stateLabel(metadata, status, language) || text[status] || status;
    if (label) states.set(label, (states.get(label) || 0) + 1);
  }
  const counts = [...states].map(([label, count]) => `${label}: ${count}`).join("; ");
  return language === "zh"
    ? [`已保存的路径图：${summary.nodeCount} 个节点，${summary.edgeCount} 条边。`, counts].filter(Boolean).join(" ")
    : [`Saved path with ${summary.nodeCount} nodes and ${summary.edgeCount} edges.`, counts].filter(Boolean).join(" ");
}
