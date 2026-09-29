// Navigation over an already validated explanation. This index never infers
// execution identity or copies body payloads: the canonical projection owns both.
import { buildRepeatedInvocationLabels, buildStepIdentityLabels } from "./renderer-presentation.js";

function stepQuery(query) {
  const phrases = [];
  // Displayed ordinals are one fact, not the unrelated tokens "callback" and
  // "2". A literal source name/ID can still contain this same complete phrase.
  const rest = query.replace(/(^|[^\p{L}\p{N}_])call\s*(\d+)(?![\p{L}\p{N}_])|第\s*(\d+)\s*次/giu, (match, prefix, english, chinese) => {
    const digits = english || chinese;
    phrases.push({ ordinal: digits.replace(/^0+(?=\d)/, ""), literal: english
      ? new RegExp(`(^|[^\\p{L}\\p{N}_])call\\s*${digits}(?![\\p{L}\\p{N}_])`, "iu")
      : new RegExp(`第\\s*${digits}\\s*次`, "u") });
    return prefix || " ";
  });
  return { phrases, tokens: rest.trim().split(/\s+/u).filter((token) => token && token !== "·") };
}

function page(rows, query, options, predicate, steps = false) {
  const normalized = String(query ?? "").trim().toLocaleLowerCase();
  const { tokens, phrases } = steps ? stepQuery(normalized) : { tokens: normalized.split(/\s+/u).filter(Boolean), phrases: [] };
  const limit = Number.isSafeInteger(options.limit) ? Math.min(200, Math.max(1, options.limit)) : 50;
  const requested = Number.isSafeInteger(options.offset) ? Math.max(0, options.offset) : 0;
  const matches = rows.filter((row) => predicate(row.item) && tokens.every((token) => row.text.includes(token))
    && phrases.every(({ ordinal, literal }) => row.ordinal === ordinal || row.fields.some((field) => literal.test(field))));
  const offset = matches.length ? Math.min(requested, Math.floor((matches.length - 1) / limit) * limit) : 0;
  return { items: matches.slice(offset, offset + limit).map(({ item }) => item), total: matches.length, offset, limit };
}

function text(parts) {
  return parts.filter((value) => value !== undefined && value !== null).join(" ").toLocaleLowerCase();
}

const statusAliases = {
  success: "success succeeded 成功",
  failed: "failed failure error 失败 错误",
  cancelled: "cancelled canceled 已取消",
  incomplete: "incomplete result not recorded 未完成 结果未记录",
  running: "running end not recorded 运行中 结束未记录",
  skipped: "skipped 已跳过",
  declared: "declared 声明 已声明 仅声明",
  observed: "observed 已观察到",
  unknown: "unknown 未知",
};
const stateAliases = {
  planned: "planned only execution not observed 仅计划 未观察到执行",
  interrupted: "interrupted 已中断",
  unrecorded: "result not recorded 结果未记录",
};
function stepStatusAliases(node, metadata) {
  if (metadata.agentScopeUnresolved) {
    const unconfirmed = "recorded invocation unconfirmed 已记录 调用归属未确认 Agent evidence invocation unconfirmed Agent 证据 未确认调用归属";
    return node.status === "failed" ? `${unconfirmed} ${statusAliases.failed}` : unconfirmed;
  }
  return stateAliases[metadata.executionState] || statusAliases[node.status] || node.status;
}

function structuralNames(node, envelopes) {
  const names = [];
  for (const reference of node.evidence || []) {
    if (reference.role === "context" || reference.role === "topology") continue;
    const envelope = envelopes[reference.envelopeIndex], payload = envelope?.payload;
    if (!payload) continue;
    if (envelope.kind === "callback.event") names.push(payload.run?.name);
    if (envelope.kind === "component.io") names.push(payload.name);
    if (envelope.kind === "agent.event") names.push(payload.agentName);
  }
  return names;
}

/** Build once per accepted record; search covers labels/IDs/status, not bodies. */
export function createRunInspectionIndex(explanation, envelopes = []) {
  const nodes = explanation?.nodes ?? [];
  const byID = new Map(nodes.map((node) => [node.id, node]));
  // Groups are supplied by the canonical explanation, never reconstructed from
  // display names. Membership is direct; selecting a scope includes descendants.
  const groups = explanation?.groups ?? [];
  const byGroupID = new Map(groups.map((group) => [group.id, group]));
  const groupChildren = new Map();
  const nodeGroups = new Map();
  const groupedEvidence = new Set();
  for (const group of groups) {
    if (group.parentId && byGroupID.has(group.parentId)) {
      if (!groupChildren.has(group.parentId)) groupChildren.set(group.parentId, []);
      groupChildren.get(group.parentId).push(group.id);
    }
    for (const id of group.nodeIds ?? []) {
      if (!byID.has(id)) continue;
      if (!nodeGroups.has(id)) nodeGroups.set(id, []);
      nodeGroups.get(id).push(group);
      for (const item of byID.get(id).evidence ?? []) groupedEvidence.add(item.envelopeIndex);
    }
    for (const index of group.evidenceEnvelopeIndexes ?? []) groupedEvidence.add(index);
  }
  for (const list of nodeGroups.values()) Object.freeze(list);
  const emptyGroups = Object.freeze([]);
  const scopeCache = new Map();
  function groupScope(id) {
    if (scopeCache.has(id)) return scopeCache.get(id);
    const result = { nodeIds: new Set(), evidence: new Set() };
    const visited = new Set();
    const pending = [id];
    while (pending.length) {
      const next = pending.pop();
      if (visited.has(next)) continue;
      visited.add(next);
      const group = byGroupID.get(next);
      if (!group) continue;
      for (const nodeId of group.nodeIds ?? []) {
        const node = byID.get(nodeId);
        if (!node) continue;
        result.nodeIds.add(nodeId);
        for (const item of node.evidence ?? []) result.evidence.add(item.envelopeIndex);
      }
      for (const index of group.evidenceEnvelopeIndexes ?? []) result.evidence.add(index);
      pending.push(...(groupChildren.get(next) ?? []));
    }
    scopeCache.set(id, result);
    return result;
  }
  const owners = new Map();
  const runIndexes = new Set();
  const addRun = (indexes = []) => {
    for (const index of indexes) if (Number.isSafeInteger(index)) runIndexes.add(index);
  };
  const run = explanation?.run;
  addRun(run?.result?.evidenceEnvelopeIndexes);
  addRun(run?.capture?.evidenceEnvelopeIndexes);
  addRun(run?.timing?.evidenceEnvelopeIndexes);
  for (const channel of [run?.input, run?.output]) {
    for (const item of channel?.items ?? []) addRun(item.evidenceEnvelopeIndexes);
  }
  const issueIDs = new Set();
  for (const issue of run?.issues ?? []) {
    if (issue.nodeId) issueIDs.add(issue.nodeId);
    if (issue.scope === "run") addRun(issue.evidenceEnvelopeIndexes);
  }
  for (const node of nodes) {
    for (const evidence of node.evidence ?? []) {
      const index = evidence.envelopeIndex;
      if (!Number.isSafeInteger(index) || index < 0 || index >= envelopes.length) continue;
      if (!owners.has(index)) owners.set(index, new Set());
      owners.get(index).add(node.id);
    }
  }
  // This temporary view carries only canonical identity and boundary references,
  // not input/output channels or prose summaries. The shared presentation
  // helpers remain the sole authority for source labels and proven ordinals.
  const execution = { runId: explanation?.runId, nodes: nodes.map((node) => ({
    id: node.id, label: node.label, kind: node.kind, component: node.component, status: node.status,
    correlation: node.technical?.correlation || {}, metadata: node.technical?.metadata || {},
    evidence: (node.evidence || []).map(({ envelopeIndex, kind, role }) => ({ envelopeIndex, kind, role })),
  })), edges: nodes.flatMap((node) => (node.causes || []).filter((cause) => cause.relation === "parent-child" && cause.basis === "observed")
    .map((cause) => ({ from: cause.nodeId, to: node.id, kind: "parent-child" }))) };
  const invocationsEN = buildRepeatedInvocationLabels(execution, envelopes, "en");
  const invocationsZH = buildRepeatedInvocationLabels(execution, envelopes, "zh");
  const identities = buildStepIdentityLabels(execution, envelopes);
  const stepRows = nodes.map((node) => {
    const metadata = node.technical?.metadata || {}, correlation = node.technical?.correlation || {};
    const role = metadata.role || metadata.messageRole;
    const roleNames = role === "user" ? "User input 用户输入" : role === "system" ? "System message 系统消息"
      : role === "assistant" ? node.kind === "output" ? "Assistant output Assistant message 助手输出 助手消息" : "Assistant message 助手消息"
        : role === "tool" ? "Tool message 工具消息" : undefined;
    const fields = [node.id, node.label, node.component, node.kind, node.path?.join(" / "),
      metadata.sourceNodePath?.join(" / "), metadata.sourceNodePath?.join("/"), metadata.agentScopePath?.join(" / "),
      correlation.invocationId, correlation.entityId, correlation.toolCallId,
      metadata.sourceNodeId, metadata.toolCallId, metadata.toolName, correlation.agentName, metadata.agentName,
      identities.get(node.id), ...structuralNames(node, envelopes)].filter((field) => typeof field === "string");
    return { item: node, fields, ordinal: invocationsEN.get(node.id)?.match(/^Call (\d+)$/)?.[1],
      text: text([...fields, roleNames, stepStatusAliases(node, metadata), invocationsEN.get(node.id), invocationsZH.get(node.id)]) };
  });
  const evidenceRows = envelopes.map((envelope, envelopeIndex) => {
    const nodeIds = [...(owners.get(envelopeIndex) ?? [])];
    const scope = nodeIds.length ? "step" : runIndexes.has(envelopeIndex) ? "run" : "unassigned";
    const label = [envelope.kind, envelope.payload?.direction, envelope.payload?.component,
      envelope.payload?.name, envelope.payload?.phase, envelope.payload?.state].filter(Boolean).join(" · ");
    const item = Object.freeze({ envelopeIndex, kind: envelope.kind, label, nodeIds: Object.freeze(nodeIds), scope });
    return { item, text: text([envelopeIndex + 1, label, scope, ...nodeIds,
      ...Object.values(envelope.source ?? {}), ...Object.values(envelope.correlation ?? {})]) };
  });
  return Object.freeze({
    nodeCount: nodes.length,
    evidenceCount: envelopes.length,
    groupCount: groups.length,
    getNode: (id) => byID.get(id),
    getEvidence: (index) => evidenceRows[index]?.item,
    getGroup: (id) => byGroupID.get(id),
    getNodeGroups: (id) => nodeGroups.get(id) ?? emptyGroups,
    getGroupPath(id) {
      const path = [], visited = new Set();
      let group = byGroupID.get(id);
      while (group && !visited.has(group.id)) {
        path.unshift(group);
        visited.add(group.id);
        group = byGroupID.get(group.parentId);
      }
      return Object.freeze(path);
    },
    searchSteps(query = "", options = {}) {
      const scope = options.groupId !== undefined ? groupScope(options.groupId) : undefined;
      return page(stepRows, query, options, (node) => (!scope || scope.nodeIds.has(node.id))
        && (!options.ungroupedOnly || !nodeGroups.has(node.id))
        && (!options.issuesOnly || issueIDs.has(node.id) || ["failed", "cancelled", "incomplete"].includes(node.status)), true);
    },
    searchEvidence(query = "", options = {}) {
      const scope = options.groupId !== undefined ? groupScope(options.groupId) : undefined;
      // Internal result-reader allowlist can include verified call-boundary
      // references owned by a parent step without changing that ownership.
      const allowed = options.evidenceEnvelopeIndexes === undefined ? undefined : new Set(options.evidenceEnvelopeIndexes);
      return page(evidenceRows, query, options, (entry) => (!scope || scope.evidence.has(entry.envelopeIndex))
        && (!allowed || allowed.has(entry.envelopeIndex))
        && (!options.ungroupedOnly || !groupedEvidence.has(entry.envelopeIndex))
        && (!options.scope || options.scope === "all" || entry.scope === options.scope));
    },
  });
}
