import { createAgentScopeContext } from "./execution-scopes.js";
import { envelopeMessage, messageReadingValue, recordedBodyCapture, recordedIssueValue, recordedValueAvailability } from "./content-presentation.js";

// Private presentation hierarchy for one complete reading scope. Canonical
// `depth` combines Agent and tool levels, not the full parent-record chain.
// Only existing, unique identities establish a visible parent; never names,
// source order or the numeric depth. Missing/ambiguous parents remain roots.
export function buildTrajectoryHierarchy(records) {
  const byId = new Map(), duplicates = new Set();
  for (const record of records) {
    if (byId.has(record.id)) duplicates.add(record.id);
    byId.set(record.id, record);
  }
  const parentByRecordId = new Map(), depthByRecordId = new Map();
  for (const record of records) {
    const parent = byId.get(record.parentId);
    if (!duplicates.has(record.id) && !record.metadata?.agentScopeUnresolved
      && parent && parent !== record && !duplicates.has(parent.id) && !parent.metadata?.agentScopeUnresolved) {
      parentByRecordId.set(record.id, parent.id);
    }
  }
  for (const record of records) {
    const chain = [], positions = new Map();
    let id = record.id;
    while (id !== undefined && !depthByRecordId.has(id)) {
      if (positions.has(id)) {
        // Cyclic edges cannot express a hierarchy. Remove those edges only;
        // independently proven descendants may still belong to these roots.
        for (const member of chain.slice(positions.get(id))) {
          parentByRecordId.delete(member);
          depthByRecordId.set(member, 0);
        }
        break;
      }
      positions.set(id, chain.length);
      chain.push(id);
      id = parentByRecordId.get(id);
    }
    while (chain.length) {
      const member = chain.pop();
      if (depthByRecordId.has(member)) continue;
      const parent = parentByRecordId.get(member);
      depthByRecordId.set(member, parent === undefined ? 0 : depthByRecordId.get(parent) + 1);
    }
  }
  return { depthByRecordId, parentByRecordId };
}

// Private view bridges. Neither a common label nor a shared model-message
// envelope proves that a trajectory entry is one particular tool invocation.
export function buildTrajectoryReading(trajectory, execution, envelopes, groups = []) {
  const records = trajectory?.records || [], nodes = execution?.nodes || [];
  const context = createAgentScopeContext(envelopes);
  const knownScopes = new Set([...context.scopes.values()].map(({ id }) => id));
  const metadata = (value) => value.metadata || value.technical?.metadata || {};
  function scopeOf(value) {
    const meta = metadata(value);
    if (meta.agentScopeUnresolved) return undefined;
    const sources = new Set((value.evidence || []).map(({ envelopeIndex }) => context.forEnvelope(envelopes[envelopeIndex] || {})?.id).filter(Boolean));
    if (meta.agentScopeId) return knownScopes.has(meta.agentScopeId) && [...sources].every((id) => id === meta.agentScopeId) ? meta.agentScopeId : undefined;
    return sources.size === 1 ? [...sources][0] : undefined;
  }
  const scopeIdByRecordId = new Map(records.flatMap((record) => {
    const id = scopeOf(record);
    return id ? [[record.id, id]] : [];
  }));
  const nodeScopes = new Map(nodes.map((node) => [node, scopeOf(node)]));
  const directRefs = (value) => new Set((value.evidence || []).filter(({ role }) => !["context", "topology"].includes(role)).map(({ envelopeIndex }) => envelopeIndex));
  const nodeRefs = new Map(nodes.map((node) => [node, directRefs(node)]));
  const nodeIDCounts = new Map();
  for (const node of nodes) nodeIDCounts.set(node.id, (nodeIDCounts.get(node.id) || 0) + 1);
  function provesToolCall(index, callId) {
    const envelope = envelopes[index], payload = envelope?.payload;
    const message = envelopeMessage(envelope) || (envelope?.kind === "component.io" && payload?.body?.message);
    if (message?.tool_calls?.some((call) => call.id === callId) || message?.role === "tool" && message.tool_call_id === callId) return true;
    return (envelope?.kind === "component.io" && payload?.component === "Tool" || envelope?.kind === "callback.event" && payload?.run?.component === "Tool")
      && payload.address?.findLast(({ type }) => type === "tool")?.subId === callId;
  }
  const compatible = (record, node) => {
    if (record.metadata?.agentScopeUnresolved) return metadata(node).agentScopeUnresolved === true;
    if (metadata(node).agentScopeUnresolved) return false;
    if (record.kind === "tool") return node.kind === "tool" && typeof record.toolCallId === "string" && record.toolCallId.length > 0
      && (node.correlation?.toolCallId || node.technical?.correlation?.toolCallId) === record.toolCallId;
    if (record.kind === "user") return node.kind === "input" && (metadata(node).role || metadata(node).messageRole) === "user";
    if (record.kind === "assistant") return node.kind === "agent" || node.kind === "output" && (metadata(node).role || metadata(node).messageRole) === "assistant";
    return record.kind === "error" && node.kind === "error";
  };
  const nodeIdByRecordId = new Map();
  for (const record of records) {
    const refs = directRefs(record), scope = scopeIdByRecordId.get(record.id);
    const matches = nodes.filter((node) => compatible(record, node) && nodeScopes.get(node) === scope
      && [...refs].some((index) => nodeRefs.get(node).has(index) && (record.kind !== "tool" || provesToolCall(index, record.toolCallId))));
    if (matches.length === 1 && nodeIDCounts.get(matches[0].id) === 1) nodeIdByRecordId.set(record.id, matches[0].id);
  }
  const groupById = new Map(groups.map((group) => [group.id, group]));
  function recordsForScope({ groupId = null, ungroupedOnly = false } = {}) {
    if (ungroupedOnly) return records.filter((record) => !scopeIdByRecordId.has(record.id));
    if (groupId === null || groupId === undefined) return records.slice();
    if (!groupById.has(groupId)) return [];
    const descendants = new Set(), pending = [groupId];
    while (pending.length) {
      const id = pending.pop();
      if (descendants.has(id)) continue;
      descendants.add(id);
      for (const group of groups) if (group.parentId === id) pending.push(group.id);
    }
    return records.filter((record) => descendants.has(scopeIdByRecordId.get(record.id)));
  }
  return { nodeIdByRecordId, scopeIdByRecordId, recordsForScope,
    turnKey: (record) => JSON.stringify([scopeIdByRecordId.get(record.id) || null, record.turn || null]) };
}

/** Original readable value and capture facts from this entry's own sources. */
export function trajectoryRecordValue(record, direction, envelopes, diagnostics = []) {
  const refs = record.evidence || [];
  if (direction === "error") return recordedIssueValue({ kind: "error", message: record.error?.message,
    evidenceEnvelopeIndexes: refs.map(({ envelopeIndex }) => envelopeIndex) }, (index) => envelopes[index], diagnostics);
  const sources = refs.flatMap((entry) => {
    const envelope = envelopes[entry.envelopeIndex];
    return envelope ? [{ entry, envelope }] : [];
  });
  let value = record[direction];
  const messageSource = sources.find(({ envelope }) => {
    const message = envelopeMessage(envelope);
    if (!message) return false;
    // A name-only child event may contain a Tool message while its trajectory
    // entry intentionally remains unassigned. Keep that exact message visible
    // without turning it into an identified child-tool result.
    if (record.metadata?.agentScopeUnresolved && direction === "output") return true;
    if (direction === "input") return record.kind === "user" ? message.role === "user"
      : record.kind === "tool" && message.tool_calls?.some((call) => call.id === record.toolCallId);
    return message.role === (record.kind === "tool" ? "tool" : record.kind === "assistant" ? "assistant" : undefined)
      && (record.kind !== "tool" || message.tool_call_id === record.toolCallId);
  });
  const component = sources.find(({ envelope }) => envelope.kind === "component.io" && envelope.payload?.direction === direction
    && (record.kind === "tool" ? envelope.payload.component === "Tool"
      && envelope.payload.address?.findLast(({ type }) => type === "tool")?.subId === record.toolCallId
      : ["ChatModel", "AgenticModel"].includes(envelope.payload.component)));
  if (messageSource && (record.kind === "user" && direction === "input" || direction === "output")) {
    const message = envelopeMessage(messageSource.envelope);
    value = record.metadata?.agentScopeUnresolved && message.role !== record.kind ? message : messageReadingValue(message);
  } else if (direction === "output" && component) {
    value = record.kind === "tool" ? component.envelope.payload.body
      : component.envelope.payload.body?.message;
  }
  const selected = messageSource || component;
  if (!selected) value = undefined;
  const evidenceEnvelopeIndexes = selected ? [selected.entry.envelopeIndex] : refs.map(({ envelopeIndex }) => envelopeIndex);
  let capture = {};
  if (selected) {
    const { envelope, entry } = selected;
    const independentToolResult = direction === "output" && record.kind === "tool" && envelope.kind === "agent.event"
      && envelope.payload?.error !== undefined && envelopeMessage(envelope)?.role === "tool";
    const source = independentToolResult ? { ...envelope, metadata: { ...envelope.metadata, capture: {} } } : envelope;
    const path = envelope.kind === "component.io" ? "/payload/body" : envelope.kind === "agent.event" ? "/payload/output/message/value" : "/payload";
    capture = recordedBodyCapture(source, entry.envelopeIndex, diagnostics, path);
  }
  const availability = recordedValueAvailability(value, capture);
  return { ...(availability !== "not-observed" ? { value } : {}), availability, evidenceEnvelopeIndexes,
    ...(capture.status === "omitted" ? { reason: capture.reason || "not_captured" } : {}) };
}

export function trajectoryRecordPresentation(record, { locale = "en", identityLabel } = {}) {
  const zh = locale === "zh";
  let name = record.label, role;
  if (record.metadata?.agentScopeUnresolved) name = zh ? "Agent 证据" : "Agent evidence";
  else if (record.kind === "user") name = zh ? "用户输入" : "User input";
  else if (record.kind === "assistant") name = record.metadata?.publicOutput ? zh ? "助手输出" : "Assistant output" : zh ? "助手消息" : "Assistant message";
  else if (record.kind === "tool") role = zh ? "工具调用" : "Tool call";
  else if (record.kind === "error") name = zh ? "执行错误" : "Execution error";
  return { name, title: [name, identityLabel].filter(Boolean).join(" · "), ...(role ? { role } : {}) };
}
