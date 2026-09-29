import { buildRepeatedInvocationLabels } from "../src/renderer-presentation.js";

// Private workbench projection. The execution document remains the source of
// every visit, body, error and clock; these nodes only represent diagram groups.
const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function nodeIndex(execution) {
  if (!execution || !Array.isArray(execution.nodes) || !Array.isArray(execution.edges)) {
    throw new TypeError("Expected a saved execution graph");
  }
  const index = new Map();
  for (const node of execution.nodes) {
    if (typeof node.id !== "string" || index.has(node.id)) throw new TypeError("Expected unique execution node IDs");
    index.set(node.id, node);
  }
  return index;
}

function commonObject(members, field) {
  const first = members[0][field] || {};
  return Object.fromEntries(Object.entries(first).filter(([key, value]) =>
    members.every((node) => Object.hasOwn(node[field] || {}, key) && same(node[field][key], value)))
    .map(([key, value]) => [key, copy(value)]));
}

function aggregateNode(id, members) {
  const node = copy(members[0]);
  node.id = id;
  const statusCounts = {};
  for (const member of members) statusCounts[member.status] = (statusCounts[member.status] || 0) + 1;
  if (members.length > 1) {
    // Any exceptional visit remains exceptional. A later success cannot turn
    // a failed visit green, nor can a partial/running visit become completed.
    node.status = ["failed", "cancelled", "incomplete", "running", "skipped", "success"]
      .find((status) => statusCounts[status]) || "incomplete";
    node.correlation = commonObject(members, "correlation");
    node.metadata = commonObject(members, "metadata");
    const evidence = new Map();
    for (const member of members) for (const reference of member.evidence || []) {
      const key = JSON.stringify([reference.envelopeIndex, reference.kind, reference.role]);
      if (!evidence.has(key)) evidence.set(key, copy(reference));
    }
    node.evidence = [...evidence.values()].sort((left, right) => left.envelopeIndex - right.envelopeIndex);
    // A diagram aggregate is not an invocation. In particular it has neither
    // the first visit's duration nor a made-up sum spanning different calls.
    delete node.startedAtMs;
    delete node.finishedAtMs;
    delete node.durationMs;
    delete node.errorMessage;
  }
  node.metadata = { ...node.metadata, graphReading: { memberIds: members.map(({ id }) => id), statusCounts } };
  return node;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function edgeIdentity(from, to, edge) {
  return JSON.stringify([from, to, edge.kind, stableValue(edge.metadata || {})]);
}

function canRenderGroups(execution, groups) {
  const diagramId = (id) => groups.get(id)?.[0].node.id || id;
  const nodes = new Set(execution.nodes.map(({ id }) => diagramId(id)));
  const outgoing = new Map([...nodes].map((id) => [id, []]));
  const incoming = new Map([...nodes].map((id) => [id, 0]));
  const relations = new Set(), endpoints = new Set();
  for (const edge of execution.edges) {
    const from = diagramId(edge.from), to = diagramId(edge.to);
    if (from === to || !nodes.has(from) || !nodes.has(to)) return false;
    const relation = edgeIdentity(from, to, edge);
    if (relations.has(relation)) continue;
    relations.add(relation);
    const pair = JSON.stringify([from, to]);
    // The compatibility renderer accepts only one edge per endpoint pair,
    // even when its channels or source metadata describe different relations.
    if (endpoints.has(pair)) return false;
    endpoints.add(pair);
    outgoing.get(from).push(to);
    incoming.set(to, incoming.get(to) + 1);
  }
  const ready = [...nodes].filter((id) => incoming.get(id) === 0);
  for (let index = 0; index < ready.length; index += 1) for (const next of outgoing.get(ready[index])) {
    incoming.set(next, incoming.get(next) - 1);
    if (incoming.get(next) === 0) ready.push(next);
  }
  return ready.length === nodes.size;
}

/**
 * Collapse only source-proven repeats in a Graph diagram. Identity is always
 * checked against the complete run; visibleExecution is its induced subgraph,
 * not a search result. Maps contain visible original IDs, in recorded order.
 * The returned execution is a renderer-only clone, never a replacement record.
 */
export function buildGraphReading(execution, envelopes, { visibleExecution = execution } = {}) {
  const originals = nodeIndex(execution), visible = nodeIndex(visibleExecution);
  if (!Array.isArray(envelopes) || visibleExecution.runId !== execution.runId) throw new TypeError("Expected evidence and a visible scope from the same run");
  for (const [id, node] of visible) {
    if (!originals.has(id) || !same(node, originals.get(id))) throw new TypeError("Visible nodes must retain their original execution facts");
  }
  // Reuse the established strict boundary verifier, not its translated text:
  // unique callback identity, matching address/component, complete boundaries,
  // a unique enclosing parent invocation and non-overlapping repeated calls.
  const confirmed = buildRepeatedInvocationLabels(execution, envelopes);
  const parents = new Map();
  for (const edge of execution.edges) if (edge.kind === "parent-child") parents.set(edge.to, edge.from);
  const groups = new Map(), groupByExecutionId = new Map();
  for (const node of execution.nodes) {
    if (!confirmed.has(node.id)) continue;
    const start = node.evidence.find(({ envelopeIndex, role }) => role === "start" && envelopes[envelopeIndex]?.kind === "callback.event");
    const source = envelopes[start.envelopeIndex].payload;
    const parent = originals.get(parents.get(node.id));
    const key = JSON.stringify([execution.runId, node.correlation.entityId,
      source.address.map(({ type, id, subId }) => [type, id, subId ?? null]), source.nodePath || [],
      source.run.component, parent ? [parent.id, parent.correlation.invocationId] : null]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ node, start: start.envelopeIndex });
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.start - right.start);
    // The identity verifier already requires repeats, but keeping this check
    // prevents any future verifier broadening from inventing a grouped call.
    if (group.length < 2) continue;
    for (const member of group) groupByExecutionId.set(member.node.id, group);
  }
  // Identifying a repeat does not prove its quotient is a renderable DAG. A
  // self edge, cycle or pair of distinct relations cannot be discarded merely
  // to make the picture fit. Retain all original nodes in that case. Decide on
  // the complete run so every visible scope uses the same stable identities.
  // This is only an aggregation guard, not new validation of the input graph.
  if (groupByExecutionId.size && !canRenderGroups(execution, groupByExecutionId)) groupByExecutionId.clear();
  const membersByNodeId = new Map(), nodeIdByExecutionId = new Map();
  for (const node of visibleExecution.nodes) {
    const group = groupByExecutionId.get(node.id), id = group?.[0].node.id || node.id;
    nodeIdByExecutionId.set(node.id, id);
    if (!membersByNodeId.has(id)) membersByNodeId.set(id, []);
    membersByNodeId.get(id).push(node);
  }
  // A filtered scope keeps the same representative ID and recorded visit order
  // even when its first visible visit was the second call of the full run.
  for (const [id, members] of membersByNodeId) {
    const group = groupByExecutionId.get(id);
    if (group) {
      const rank = new Map(group.map(({ node }, index) => [node.id, index]));
      members.sort((left, right) => rank.get(left.id) - rank.get(right.id));
    }
  }
  const edgeGroups = new Map();
  for (const original of visibleExecution.edges) {
    const from = nodeIdByExecutionId.get(original.from), to = nodeIdByExecutionId.get(original.to);
    if (from === undefined || to === undefined) throw new TypeError("Visible edges must stay inside the visible scope");
    // Distinct relation kinds or metadata are not interchangeable. No link is
    // inferred from visit order; a source-proven self edge remains a self edge.
    const key = edgeIdentity(from, to, original);
    if (!edgeGroups.has(key)) {
      const edge = copy(original);
      edge.from = from;
      edge.to = to;
      edge.metadata = { ...edge.metadata, graphReading: { edgeIds: [] } };
      edgeGroups.set(key, edge);
    }
    edgeGroups.get(key).metadata.graphReading.edgeIds.push(original.id);
  }
  const projected = copy(visibleExecution);
  projected.nodes = [...membersByNodeId].map(([id, members]) => aggregateNode(id, members));
  projected.edges = [...edgeGroups.values()];
  const memberIdsByNodeId = new Map([...membersByNodeId].map(([id, members]) => [id, members.map(({ id: sourceId }) => sourceId)]));
  return { execution: projected, memberIdsByNodeId, nodeIdByExecutionId };
}
