// Internal identity/navigation helpers. Names and observation order are not
// invocation identities: only an address (including outer tool subId) is.
const addressKey = (address) => JSON.stringify(address.map(({ type, id, subId }) => [type, id, subId ?? null]));
const agentPath = (address) => address.filter(({ type }) => type === "agent").map(({ id }) => id);

export function createAgentScopeContext(envelopes) {
  const scopes = new Map();
  const byPath = new Map();
  const add = (address) => {
    const key = addressKey(address);
    if (scopes.has(key)) return scopes.get(key);
    const last = address.length - 1;
    const parentIndex = address.findLastIndex((part, index) => index < last && part.type === "agent");
    const parent = parentIndex >= 0 ? add(address.slice(0, parentIndex + 1)) : undefined;
    const caller = address.slice(parentIndex + 1, last).findLast(({ type }) => type === "tool");
    const scope = { id: `agent:${encodeURIComponent(key)}`, key, address, path: agentPath(address),
      name: address[last].id, ordinal: scopes.size + 1,
      ...(parent ? { parentId: parent.id, parentKey: parent.key } : {}),
      ...(caller?.subId ? { callerToolCallId: caller.subId, callerToolName: caller.id } : {}) };
    scopes.set(key, scope);
    const pathKey = JSON.stringify(scope.path);
    byPath.set(pathKey, [...(byPath.get(pathKey) || []), scope]);
    return scope;
  };
  for (const envelope of envelopes) {
    const address = envelope.payload?.address;
    if (!Array.isArray(address)) continue;
    const index = address.findLastIndex(({ type }) => type === "agent");
    if (index >= 0) add(address.slice(0, index + 1));
  }
  for (const envelope of envelopes) {
    if (envelope.kind !== "agent.event") continue;
    const path = envelope.payload?.runPath;
    if (Array.isArray(path) && path.length === 1 && !byPath.has(JSON.stringify(path))) add([{ type: "agent", id: path[0] }]);
  }
  const roots = [...scopes.values()].filter(({ parentId }) => !parentId);
  // A damaged/partial record may retain only one child's component address
  // while still proving that the same Agent-tool was invoked more than once.
  // Such a surviving address must not absorb every name-only child event.
  const callerIds = new Map();
  const noteCaller = (parentKey, name, id) => {
    if (!parentKey || typeof name !== "string" || !name || typeof id !== "string" || !id) return;
    const key = JSON.stringify([parentKey, name]);
    if (!callerIds.has(key)) callerIds.set(key, new Set());
    callerIds.get(key).add(id);
  };
  for (const envelope of envelopes) {
    const address = envelope.payload?.address;
    const agentIndex = Array.isArray(address) ? address.findLastIndex(({ type }) => type === "agent") : -1;
    const addressedScope = agentIndex >= 0 ? scopes.get(addressKey(address.slice(0, agentIndex + 1))) : undefined;
    if (addressedScope && envelope.payload?.component === "Tool") {
      const caller = address.slice(agentIndex + 1).findLast(({ type }) => type === "tool");
      noteCaller(addressedScope.key, caller?.id, caller?.subId);
    }
    // Tool requests/results in model or Agent messages also disprove a unique
    // caller when its entire component address was lost. They are used only
    // to reject a name-only match, never to create or assign a child scope.
    const namedScopes = envelope.kind === "agent.event" ? byPath.get(JSON.stringify(envelope.payload?.runPath)) || [] : [];
    const owner = addressedScope || (namedScopes.length === 1 ? namedScopes[0] : undefined);
    if (!owner) continue;
    const payload = envelope.payload;
    const messages = envelope.kind === "agent.event" ? [payload.output?.message?.value]
      : envelope.kind === "component.io" && ["ChatModel", "AgenticModel"].includes(payload.component)
        ? [payload.body?.message, ...(Array.isArray(payload.body?.messages) ? payload.body.messages : [])] : [];
    for (const message of messages) {
      for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) noteCaller(owner.key, call.function?.name || call.name, call.id);
      if (message?.role === "tool") noteCaller(owner.key, message.tool_name || payload.output?.message?.toolName, message.tool_call_id);
    }
  }
  const forEnvelope = (envelope) => {
    const address = envelope.payload?.address;
    if (Array.isArray(address)) {
      const index = address.findLastIndex(({ type }) => type === "agent");
      if (index >= 0) return scopes.get(addressKey(address.slice(0, index + 1)));
    }
    if (envelope.kind === "agent.event") {
      const path = envelope.payload?.runPath;
      const candidates = byPath.get(JSON.stringify(path)) || [];
      if (candidates.length === 1) {
        const candidate = candidates[0];
        const siblings = callerIds.get(JSON.stringify([candidate.parentKey, candidate.callerToolName]));
        if (!candidate.parentId || !siblings || siblings.size <= 1) return candidate;
      }
      // Legacy root events sometimes omit runPath. Never use this fallback for
      // an explicit nested path or a name that also belongs to child scopes.
      if ((!path || path.length === 0) && roots.length === 1 && envelope.payload?.agentName === roots[0].name
        && [...scopes.values()].filter(({ name }) => name === roots[0].name).length === 1) return roots[0];
      return undefined;
    }
    if (["schema.message", "schema.agentic_message"].includes(envelope.kind) && roots.length === 1) return roots[0];
    return undefined;
  };
  return { scopes, roots, forEnvelope, hasNested: [...scopes.values()].some(({ parentId }) => parentId)
    || envelopes.some((envelope) => envelope.kind === "agent.event" && envelope.payload?.runPath?.length > 1) };
}

export function scopePartitions(envelopes, context) {
  const partitions = new Map([...context.scopes.values()].map((scope) => [scope.key, { scope, entries: [] }]));
  const unassigned = [];
  const shared = [];
  envelopes.forEach((envelope, index) => {
    const entry = { envelope, index };
    if (["run.lifecycle", "schema.tool"].includes(envelope.kind)) { shared.push(entry); return; }
    const scope = context.forEnvelope(envelope);
    if (scope) partitions.get(scope.key).entries.push(entry);
    else unassigned.push(entry);
  });
  for (const partition of partitions.values()) partition.entries = [...partition.entries, ...shared].sort((a, b) => a.index - b.index);
  return { partitions: [...partitions.values()], unassigned };
}

/** Direct membership only. Groups never add execution steps or infer results. */
export function explanationGroups(nodes, sourceEnvelopes, locale = "en", snapshot, runId) {
  const envelopes = sourceEnvelopes.map((envelope) => runId && envelope.correlation?.runId && envelope.correlation.runId !== runId ? {} : envelope);
  const groups = new Map();
  const context = createAgentScopeContext(envelopes);
  const add = (group) => {
    if (!groups.has(group.id)) groups.set(group.id, { ...group, nodeIds: [], evidenceEnvelopeIndexes: [] });
    return groups.get(group.id);
  };
  for (const scope of context.scopes.values()) add({ id: scope.id,
    label: scope.callerToolCallId ? `${scope.name} · ${scope.callerToolCallId}` : scope.name,
    kind: "agent", basis: "observed", ...(scope.parentId ? { parentId: scope.parentId } : {}) });
  envelopes.forEach((envelope, index) => {
    const scope = context.forEnvelope(envelope);
    if (scope) groups.get(scope.id)?.evidenceEnvelopeIndexes.push(index);
  });
  for (const node of nodes) {
    const metadata = node.technical?.metadata || node.metadata || {};
    if (metadata.agentScopeUnresolved) continue;
    const explicit = groups.get(metadata.agentScopeId);
    const scopeIds = new Set((node.evidence || []).map(({ envelopeIndex }) => context.forEnvelope(envelopes[envelopeIndex] || {})?.id).filter(Boolean));
    const group = explicit || (scopeIds.size === 1 ? groups.get([...scopeIds][0]) : undefined);
    if (group) group.nodeIds.push(node.id);
  }
  const topology = snapshot || envelopes.find(({ kind }) => kind === "workflow.snapshot")?.payload;
  const workflowNodes = nodes.filter((node) => {
    const metadata = node.technical?.metadata || node.metadata || {};
    return metadata.sourceKind === "workflow.snapshot" || topology && node.path?.length && node.kind !== "agent" && !metadata.agentScopeId;
  });
  const pathGroups = new Map();
  const addWorkflow = (graph, path = [], parentId) => {
    const id = `workflow:${encodeURIComponent(JSON.stringify(path))}`;
    const basis = workflowNodes.some((node) => {
      const sourcePath = (node.technical?.metadata || node.metadata || {}).sourceNodePath || node.path;
      return node.basis === "observed" && path.every((part, index) => sourcePath[index] === part);
    }) ? "observed" : "declared";
    const group = add({ id, label: graph.name || path.at(-1) || "Workflow", kind: "workflow", basis, ...(parentId ? { parentId } : {}) });
    group.evidenceEnvelopeIndexes.push(...envelopes.flatMap((envelope, index) => envelope.kind === "workflow.snapshot" ? [index] : []));
    pathGroups.set(JSON.stringify(path), group);
    for (const node of graph.nodes || []) if (node.workflow) addWorkflow(node.workflow, [...path, node.id], id);
  };
  if (topology?.workflow) addWorkflow(topology.workflow);
  for (const node of workflowNodes) {
    const metadata = node.technical?.metadata || node.metadata || {};
    const path = metadata.sourceNodePath || node.path;
    const group = pathGroups.get(JSON.stringify(path.slice(0, -1)));
    if (!group) continue;
    group.nodeIds.push(node.id);
    group.evidenceEnvelopeIndexes.push(...(node.evidence || []).map(({ envelopeIndex }) => envelopeIndex));
  }
  const assigned = new Set([...groups.values()].flatMap(({ nodeIds }) => nodeIds));
  const workflowSet = new Set(workflowNodes);
  const graphNodes = nodes.filter((node) => {
    const metadata = node.technical?.metadata || node.metadata || {};
    return !assigned.has(node.id) && !metadata.agentScopeId && !metadata.agentScopeUnresolved && !workflowSet.has(node)
      && (metadata.sourceKind === "compose.graph" || node.evidence?.some(({ envelopeIndex }) => envelopes[envelopeIndex]?.kind === "callback.event"));
  });
  if (graphNodes.length) {
    const declared = graphNodes.every(({ basis }) => basis === "declared");
    const group = add({ id: `graph:${declared ? "declared" : "observed"}`, kind: "graph", basis: declared ? "declared" : "observed",
      label: locale === "zh" ? declared ? "Graph 声明结构" : "Graph 实际访问" : declared ? "Graph definition" : "Graph visits" });
    for (const node of graphNodes) { group.nodeIds.push(node.id); group.evidenceEnvelopeIndexes.push(...node.evidence.map(({ envelopeIndex }) => envelopeIndex)); }
  }
  return [...groups.values()].map((group) => ({ ...group, nodeIds: [...new Set(group.nodeIds)], evidenceEnvelopeIndexes: [...new Set(group.evidenceEnvelopeIndexes)].sort((a, b) => a - b) }));
}
