import { createAgentScopeContext } from "./execution-scopes.js";
import { recordedBodyCapture, recordedValueAvailability } from "./content-presentation.js";

// An internal read model over a validated document and its explanation. This is
// not another projection: original IDs, nodes, edges and evidence stay intact.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addressKey = (address) => JSON.stringify(address?.map(({ type, id, subId }) => [type, id, subId ?? null]));
const phrase = (locale, en, zh) => locale === "zh" ? zh : en;
const unique = (values) => [...new Set(values)];

function workflowScopes(definition) {
  const scopes = new Map();
  function visit(workflow, path = []) {
    if (!workflow) return;
    scopes.set(`workflow:${encodeURIComponent(JSON.stringify(path))}`, { workflow, path });
    for (const node of workflow.nodes || []) if (node.workflow) visit(node.workflow, [...path, node.id]);
  }
  visit(definition?.workflow);
  return scopes;
}

function valueItem(entry, direction, explanation, locale) {
  const { envelope, index } = entry;
  const capture = recordedBodyCapture(envelope, index);
  // The explanation has already applied run-record redaction/truncation
  // diagnostics; use those flags without changing or decoding the source body.
  const existing = [explanation.run, ...(explanation.nodes || [])].flatMap((node) => node?.[direction]?.items || [])
    .find((item) => item.evidenceEnvelopeIndexes?.length === 1 && item.evidenceEnvelopeIndexes[0] === index);
  const value = envelope.payload.body;
  const availability = recordedValueAvailability(value, { ...capture,
    redacted: capture.redacted || existing?.availability === "redacted",
    truncated: capture.truncated || existing?.availability === "truncated",
  });
  return { label: direction === "input" ? phrase(locale, "Recorded call input", "已记录调用输入") : phrase(locale, "Recorded call return", "已记录调用返回"),
    availability, basis: "observed", evidenceEnvelopeIndexes: [index],
    ...(value !== undefined && capture.status !== "omitted" ? { value } : {}),
    ...(capture.status === "omitted" ? { reason: capture.reason || "not_captured" } : {}) };
}

function channel(items, direction, locale) {
  const available = items.filter((item) => item.availability !== "not-observed");
  const availability = !available.length ? "not-observed" : available.every((item) => item.availability === "redacted") ? "redacted"
    : items.some((item) => ["redacted", "truncated", "not-observed"].includes(item.availability)) ? "partial" : "available";
  const summary = availability === "not-observed"
    ? direction === "input" ? phrase(locale, "No verified call input was recorded; this does not mean empty input.", "没有记录可确认的调用输入，不代表输入为空。")
      : phrase(locale, "No verified call return was recorded; the last step or a child answer is not a call result.", "没有记录可确认的调用返回；末步骤或子调用答案不能作为本次调用结果。")
    : direction === "input" ? phrase(locale, "Input at this call boundary", "本次调用边界的输入")
      : phrase(locale, "Return at this call boundary · not the overall final output", "本次调用边界的返回 · 不是整次运行的最终输出");
  return { availability, summary, items };
}

function boundaryResult(entries, explanation, locale, identifiedInvocation = false) {
  const inputs = entries.filter(({ envelope }) => envelope.kind === "component.io" && envelope.payload.direction === "input");
  const outputs = entries.filter(({ envelope }) => envelope.kind === "component.io" && envelope.payload.direction === "output");
  const errors = entries.filter(({ envelope }) => envelope.kind === "callback.event" && envelope.payload.phase === "error");
  const start = inputs[0], end = outputs[0];
  const hasContradictoryIdentity = start && end && (end.index <= start.index
    || start.envelope.correlation?.invocationId !== end.envelope.correlation?.invocationId
    || start.envelope.correlation?.entityId && end.envelope.correlation?.entityId
      && start.envelope.correlation.entityId !== end.envelope.correlation.entityId);
  // Reused addresses without distinct invocation identity are not one result.
  // Do not select the first/last body merely because it appears to finish last.
  const ambiguous = inputs.length > 1 || outputs.length > 1 || errors.length > 1 || outputs.length > 0 && errors.length > 0 || hasContradictoryIdentity;
  const acceptedInputs = !ambiguous && start ? [start] : [];
  const acceptedOutputs = !ambiguous && (start || identifiedInvocation) && end && !errors.length ? [end] : [];
  const acceptedErrors = !ambiguous && errors.length === 1 && (!start || errors[0].index > start.index)
    && (!start || !errors[0].envelope.correlation?.invocationId || start.envelope.correlation?.invocationId === errors[0].envelope.correlation.invocationId) ? errors : [];
  const state = acceptedErrors.length ? "failed" : acceptedOutputs.length ? "success" : "unknown";
  const refs = unique([...acceptedInputs, ...acceptedOutputs, ...acceptedErrors].map(({ index }) => index)).sort((a, b) => a - b);
  return {
    input: channel(acceptedInputs.map((entry) => valueItem(entry, "input", explanation, locale)), "input", locale),
    output: channel(acceptedOutputs.map((entry) => valueItem(entry, "output", explanation, locale)), "output", locale),
    result: { state, basis: state === "unknown" ? "unknown" : "observed",
      label: state === "success" ? phrase(locale, "Call returned", "调用已返回") : state === "failed" ? phrase(locale, "Call failed", "调用失败") : phrase(locale, "Call outcome unconfirmed", "调用结果未确认"),
      evidenceEnvelopeIndexes: refs },
    evidenceEnvelopeIndexes: refs,
    ambiguous,
  };
}

function hasConsistentCallback(entry, entries) {
  const { envelope } = entry, id = envelope.correlation?.eventId;
  if (envelope.kind !== "component.io" || !id) return true;
  const matches = entries.filter(({ envelope: candidate }) => candidate.kind === "callback.event" && candidate.correlation?.eventId === id);
  if (matches.length !== 1) return false;
  const callback = matches[0].envelope, payload = envelope.payload, boundary = callback.payload;
  return boundary.phase === (payload.direction === "input" ? "start" : "end")
    && boundary.run?.component === payload.component && boundary.streaming === payload.streaming
    && addressKey(boundary.address) === addressKey(payload.address) && same(boundary.nodePath || [], payload.nodePath || [])
    && callback.correlation?.entityId === envelope.correlation?.entityId
    && (!envelope.correlation?.invocationId || envelope.correlation.invocationId === (callback.correlation?.invocationId || (boundary.phase === "start" ? id : undefined)));
}

/**
 * Read one existing group, including its descendants, without rewriting the
 * canonical document. `execution` is a renderer-only induced subgraph, never a
 * valid replacement ViewerDocument. Only `result` describes the selected call.
 * No status, completion or whole-run timestamps are inherited by a local graph.
 */
export function buildScopeReading(document, explanation, { groupId, ungroupedOnly = false, locale = "en" } = {}) {
  const groups = explanation.groups || [], nodes = explanation.nodes || [], envelopes = document.evidence || [];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const mode = ungroupedOnly ? "unassigned" : groupId !== undefined && groupId !== null ? "group" : "all";
  const group = mode === "group" ? byId.get(groupId) : undefined;
  const path = [], pathSeen = new Set();
  for (let next = group; next && !pathSeen.has(next.id); next = byId.get(next.parentId)) { path.unshift(next); pathSeen.add(next.id); }
  const scopeIds = new Set(), pending = group ? [group.id] : [];
  while (pending.length) {
    const id = pending.pop();
    if (scopeIds.has(id)) continue;
    scopeIds.add(id);
    pending.push(...groups.filter(({ parentId }) => parentId === id).map(({ id: childId }) => childId));
  }
  const assigned = new Set(groups.flatMap(({ nodeIds = [] }) => nodeIds));
  const selectedIds = new Set(groups.filter(({ id }) => scopeIds.has(id)).flatMap(({ nodeIds = [] }) => nodeIds));
  const nodeIds = nodes.filter(({ id }) => mode === "all" || (mode === "unassigned" ? !assigned.has(id) : selectedIds.has(id))).map(({ id }) => id);
  const selected = new Set(nodeIds);
  const incoming = [], outgoing = [], edges = [];
  for (const edge of document.execution?.edges || []) {
    const from = selected.has(edge.from), to = selected.has(edge.to);
    if (from && to) edges.push(edge);
    else if (to) incoming.push(edge);
    else if (from) outgoing.push(edge);
  }
  const execution = document.execution && (mode === "all" ? document.execution : {
    schemaVersion: document.execution.schemaVersion, runId: document.execution.runId,
    nodes: document.execution.nodes.filter(({ id }) => selected.has(id)), edges,
  });
  const runId = document.execution?.runId || explanation.runId;
  const sameRun = (envelope) => !runId || !envelope.correlation?.runId || envelope.correlation.runId === runId;
  const source = envelopes.map((envelope) => sameRun(envelope) ? envelope : {});
  const entries = envelopes.flatMap((envelope, index) => sameRun(envelope) ? [{ envelope, index }] : []);
  const scopeEvidence = new Set();
  const groupedEvidence = new Set(groups.flatMap(({ evidenceEnvelopeIndexes = [] }) => evidenceEnvelopeIndexes));
  for (const node of nodes) {
    if (assigned.has(node.id)) for (const evidence of node.evidence || []) groupedEvidence.add(evidence.envelopeIndex);
    if (selected.has(node.id)) for (const evidence of node.evidence || []) scopeEvidence.add(evidence.envelopeIndex);
  }
  for (const item of groups) if (scopeIds.has(item.id)) for (const index of item.evidenceEnvelopeIndexes || []) scopeEvidence.add(index);
  let evidenceEnvelopeIndexes = entries.filter(({ index }) => mode === "all" || (mode === "unassigned" ? !groupedEvidence.has(index) : scopeEvidence.has(index))).map(({ index }) => index);
  const local = boundaryResult([], explanation, locale);
  let input = local.input, output = local.output, result = local.result;
  const limitations = [];
  const workflows = workflowScopes(document.kind === "workflow" ? document.definition : undefined);
  const workflow = group && workflows.get(group.id);
  let boundaryEntries = [], identifiedInvocation = false, boundaryEvidenceIndexes = [];
  // An Agent's calling Tool has a full address ending immediately before the
  // child Agent segment. Names, observation order and final model turns do not
  // establish the identity or return value of this invocation.
  if (group?.kind === "agent" && group.parentId) {
    const context = createAgentScopeContext(source);
    const scope = [...context.scopes.values()].find(({ id }) => id === group.id);
    const caller = scope?.address.slice(0, -1);
    if (scope?.callerToolCallId && caller?.at(-1)?.type === "tool" && caller.at(-1).subId === scope.callerToolCallId) {
      identifiedInvocation = true;
      boundaryEntries = entries.filter(({ envelope }) => addressKey(envelope.payload?.address) === addressKey(caller)
        && envelope.payload.streaming !== true && (envelope.kind === "component.io" && envelope.payload.component === "Tool"
          || envelope.kind === "callback.event" && envelope.payload.run?.component === "Tool"));
    }
  } else if (workflow?.path.length) {
    boundaryEntries = entries.filter(({ envelope }) => {
      const payload = envelope.payload, address = payload?.address;
      return payload?.streaming !== true && same(payload?.nodePath, workflow.path)
        && Array.isArray(address) && address.length === workflow.path.length + 1 && address[0]?.type === "runnable"
        && (!document.definition.workflow.name || address[0].id === document.definition.workflow.name)
        && address.slice(1).every((part, index) => part.type === "node" && part.id === workflow.path[index])
        && (envelope.kind === "component.io" && payload.component === "Workflow"
          || envelope.kind === "callback.event" && payload.run?.component === "Workflow");
    });
  }
  // An explicit callback/invocation mismatch already rejected by the canonical
  // projection cannot become a verified result merely by matching its address.
  const unresolvedEvidence = new Set(nodes.filter((node) => node.technical?.metadata?.ioCorrelation === "unresolved"
    || node.technical?.metadata?.callbackCorrelation === "unresolved").flatMap((node) => (node.evidence || []).map(({ envelopeIndex }) => envelopeIndex)));
  boundaryEntries = boundaryEntries.filter((entry) => !unresolvedEvidence.has(entry.index) && hasConsistentCallback(entry, entries));
  const topLevel = Boolean(group && !group.parentId && (group.kind === "graph" || group.kind === "workflow"
    || group.kind === "agent" && groups.filter((item) => item.kind === "agent" && !item.parentId).length === 1));
  if (mode === "all" || topLevel) {
    ({ input, output, result } = explanation.run);
  } else if (group?.basis === "declared") {
    result = { state: "definition-only", basis: "declared", label: phrase(locale, "Declared scope · no execution recorded", "声明范围 · 没有执行记录"), evidenceEnvelopeIndexes: group.evidenceEnvelopeIndexes || [] };
  } else {
    const values = boundaryResult(boundaryEntries, explanation, locale, identifiedInvocation);
    ({ input, output, result } = values);
    boundaryEvidenceIndexes = values.evidenceEnvelopeIndexes;
    evidenceEnvelopeIndexes = unique([...evidenceEnvelopeIndexes, ...values.evidenceEnvelopeIndexes]).sort((a, b) => a - b);
    if (values.ambiguous) limitations.push(phrase(locale, "Multiple or contradictory call boundaries prevent a unique local result.", "调用边界重复或互相矛盾，无法确认唯一局部结果。"));
  }
  let definitionSnapshot, definitionPathPrefix = [];
  if (!document.execution && document.definition && (mode === "all" || workflow || group?.kind === "graph")) {
    if (document.kind === "workflow") {
      const subtree = mode === "all" ? { workflow: document.definition.workflow, path: [] } : workflow;
      if (subtree) {
        definitionPathPrefix = subtree.path;
        const outcomes = document.definition.execution?.nodes?.filter(({ path: nodePath }) => subtree.path.every((part, index) => nodePath[index] === part) && nodePath.length > subtree.path.length)
          .map((node) => ({ ...node, path: node.path.slice(subtree.path.length) }));
        definitionSnapshot = { schemaVersion: document.definition.schemaVersion, workflow: subtree.workflow,
          ...(outcomes?.length ? { execution: { id: document.definition.execution.id, nodes: outcomes } } : {}) };
      }
    } else definitionSnapshot = { schemaVersion: 1, workflow: document.definition };
  }
  const issues = (explanation.run?.issues || []).filter((issue) => mode === "all" || selected.has(issue.nodeId)
    || issue.evidenceEnvelopeIndexes?.some((index) => boundaryEvidenceIndexes.includes(index)));
  if (mode === "group") evidenceEnvelopeIndexes = unique([...evidenceEnvelopeIndexes, ...(result.evidenceEnvelopeIndexes || []),
    ...[input, output].flatMap((value) => value.items.flatMap((item) => item.evidenceEnvelopeIndexes || []))]).sort((a, b) => a - b);
  if (mode !== "all" && output.availability === "not-observed") limitations.push(output.summary);
  if (group?.kind === "agent" && group.parentId && output.items.length) limitations.push(phrase(locale,
    "This is the Agent-tool boundary return. A handled return does not prove every child step succeeded; local errors remain separate.",
    "这里展示 Agent 工具边界的返回；经过错误处理的返回不代表子调用内部全部成功，局部错误仍独立保留。"));
  if (mode === "unassigned") limitations.push(phrase(locale, "These records have no confirmed invocation scope; they are not one call.", "这些记录的调用归属未确认，不能当作同一次调用。"));
  return { mode, group, topLevel, path, nodeIds, execution, definitionSnapshot, definitionPathPrefix,
    boundary: { incoming, outgoing, edges: [...incoming, ...outgoing], total: incoming.length + outgoing.length },
    input, output, result, issues, evidenceEnvelopeIndexes, limitations };
}
