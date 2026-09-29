// Private Graph workbench model. Declared topology and observed visits remain
// separate: a declared edge never claims that an execution took that route.
const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const statuses = ["failed", "cancelled", "incomplete", "running", "skipped", "success"];
const nonempty = (value) => typeof value === "string" && value.length > 0;
const pathValue = (value) => Array.isArray(value) && value.every(nonempty);
const topologyId = (path, id) => path.length ? `graph:${encodeURIComponent(JSON.stringify([...path, id]))}` : id;

function graphAtPath(definition, path) {
  let graph = definition;
  for (const id of path) {
    if (!Array.isArray(graph?.nodes)) return undefined;
    const matches = graph.nodes.filter((node) => node?.id === id);
    if (matches?.length !== 1) return undefined;
    graph = matches[0].workflow;
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
    || graph.branches !== undefined && !Array.isArray(graph.branches)) return undefined;
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!nonempty(node?.id) || ["start", "end"].includes(node.id) || ids.has(node.id)) return undefined;
    ids.add(node.id);
  }
  const source = (id) => id === "start" || ids.has(id);
  const target = (id) => id === "end" || ids.has(id);
  if (graph.edges.some((edge) => !source(edge?.from) || !target(edge?.to))
    || graph.branches?.some((branch) => !source(branch?.from) || !Array.isArray(branch.targets)
      || !branch.targets.length || branch.targets.some((id) => !target(id)))) return undefined;
  return graph;
}

function executionIndex(execution) {
  if (!execution || !Array.isArray(execution.nodes) || !nonempty(execution.runId)) return undefined;
  const nodes = new Map();
  for (const node of execution.nodes) {
    if (!nonempty(node?.id) || nodes.has(node.id)) return undefined;
    nodes.set(node.id, node);
  }
  return nodes;
}

function locationOf(node, envelopes, runId) {
  const correlation = node.correlation || {}, metadata = node.metadata || {};
  if (correlation.runId !== runId || !nonempty(correlation.entityId)
    || metadata.callbackCorrelation || metadata.ioCorrelation || metadata.agentScopeUnresolved) return undefined;
  let location, rank = Infinity;
  for (const reference of node.evidence || []) {
    if (["context", "topology"].includes(reference.role)) continue;
    const envelope = envelopes[reference.envelopeIndex];
    if (!["callback.event", "component.io"].includes(envelope?.kind)) continue;
    if (reference.kind && reference.kind !== envelope.kind) return undefined;
    const payload = envelope.payload || {}, source = envelope.correlation || {};
    const address = payload.address, path = payload.nodePath || [];
    const component = envelope.kind === "callback.event" ? payload.run?.component : payload.component;
    if (source.runId !== runId || source.entityId !== correlation.entityId
      || source.invocationId !== undefined && source.invocationId !== correlation.invocationId
      || source.parentEntityId !== correlation.parentEntityId
      || payload.streaming === true || component !== node.component
      || !Array.isArray(address) || !address.length || address[0]?.type !== "runnable" || !nonempty(address[0].id)
      || address.some((part, index) => !part || part.subId !== undefined || index > 0 && (part.type !== "node" || !nonempty(part.id)))
      || !pathValue(path) || !same(path, address.slice(1).map(({ id }) => id))) return undefined;
    const next = { root: address[0].id, path, component };
    if (location && !same(location, next)) return undefined;
    location = next;
    rank = Math.min(rank, reference.envelopeIndex);
  }
  return location && { ...location, rank };
}

/**
 * A declared graph with source-proven canonical visits attached to its nodes.
 * Missing/uncertain definitions return undefined, allowing the caller to retain
 * its existing execution view. No layout, body selection or execution mutation.
 */
export function buildGraphTopology(document, { visibleExecution = document?.execution, definitionPath = [] } = {}) {
  if (document?.kind !== "graph" || !pathValue(definitionPath) || !Array.isArray(document.evidence)) return undefined;
  const definition = document.definition;
  const anchors = document.evidence.filter((envelope) => envelope?.kind === "compose.graph");
  if (anchors.length !== 1 || !same(anchors[0].payload, definition)) return undefined;
  const graph = graphAtPath(definition, definitionPath);
  if (!graph) return undefined;
  const execution = document.execution, canonical = execution && executionIndex(execution);
  const visible = visibleExecution && executionIndex(visibleExecution);
  if (execution && (!canonical || !visible || execution.runId !== visibleExecution.runId
    || anchors[0].correlation?.runId !== undefined && anchors[0].correlation.runId !== execution.runId
    || [...visible].some(([id, node]) => !canonical.has(id) || !same(node, canonical.get(id))))) return undefined;
  if (!execution && visibleExecution) return undefined;

  const locations = new Map((execution?.nodes || []).flatMap((node) => {
    const location = locationOf(node, document.evidence, execution.runId);
    return location ? [[node.id, location]] : [];
  }));
  // An unnamed definition needs exactly one observed root Graph address. A
  // display label or the last segment of a nested address cannot supply it.
  const roots = new Set([...locations.values()].filter(({ path, component }) => !path.length && component === "Graph").map(({ root }) => root));
  const root = nonempty(definition.name) ? definition.name : roots.size === 1 ? [...roots][0] : undefined;
  const declared = new Map(graph.nodes.map((node) => [node.id, node]));
  const fullNodeIdByExecutionId = new Map();
  for (const [id, location] of locations) {
    if (!root || location.root !== root || location.path.length !== definitionPath.length + 1
      || !definitionPath.every((part, index) => part === location.path[index])) continue;
    const sourceId = location.path.at(-1), sourceNode = declared.get(sourceId);
    if (!sourceNode || sourceNode.component && sourceNode.component !== location.component) continue;
    fullNodeIdByExecutionId.set(id, topologyId(definitionPath, sourceId));
  }
  const nodeIdByExecutionId = new Map(), memberIdsByNodeId = new Map(), unmappedExecutionIds = [];
  for (const node of visibleExecution?.nodes || []) {
    const id = fullNodeIdByExecutionId.get(node.id);
    if (id === undefined) { unmappedExecutionIds.push(node.id); continue; }
    nodeIdByExecutionId.set(node.id, id);
    if (!memberIdsByNodeId.has(id)) memberIdsByNodeId.set(id, []);
    memberIdsByNodeId.get(id).push(node.id);
  }
  const sourceOrder = new Map((execution?.nodes || []).map(({ id }, index) => [id, index]));
  for (const members of memberIdsByNodeId.values()) members.sort((left, right) => locations.get(left).rank - locations.get(right).rank || sourceOrder.get(left) - sourceOrder.get(right));

  const referenced = new Set([
    ...graph.edges.flatMap(({ from, to }) => [from, to]),
    ...(graph.branches || []).flatMap(({ from, targets }) => [from, ...targets]),
  ]);
  const structural = (id) => ({ id: topologyId(definitionPath, id), definitionId: id, path: [...definitionPath, id], kind: id,
    name: id === "start" ? "Start" : "End", label: id === "start" ? "Start" : "End", component: id === "start" ? "Start" : "End",
    status: "structural", statusCounts: {}, memberIds: [] });
  const nodes = [
    ...(referenced.has("start") ? [structural("start")] : []),
    ...graph.nodes.map((node) => {
      const id = topologyId(definitionPath, node.id), memberIds = memberIdsByNodeId.get(id) || [];
      const statusCounts = {};
      for (const memberId of memberIds) {
        const status = canonical.get(memberId).status;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }
      return { id, definitionId: node.id, path: [...definitionPath, node.id], kind: "node", name: node.name || node.id, label: node.name || node.id,
        component: node.component || "Node", status: memberIds.length ? statuses.find((status) => statusCounts[status]) || "incomplete"
          : execution ? "not-observed" : "definition-only", statusCounts, memberIds: [...memberIds], definition: copy(node) };
    }),
    ...(referenced.has("end") ? [structural("end")] : []),
  ];
  for (const node of nodes) if (!memberIdsByNodeId.has(node.id)) memberIdsByNodeId.set(node.id, []);
  const edgeId = (kind, index, target) => `${kind}:${encodeURIComponent(JSON.stringify([...definitionPath, index, ...(target === undefined ? [] : [target])]))}`;
  const edges = [
    ...graph.edges.map((edge, sourceIndex) => ({ ...copy(edge), id: edgeId("edge", sourceIndex),
      from: topologyId(definitionPath, edge.from), to: topologyId(definitionPath, edge.to), kind: "edge", basis: "declared", sourceIndex })),
    ...(graph.branches || []).flatMap((branch, sourceIndex) => branch.targets.map((target, targetIndex) => ({ id: edgeId("branch", sourceIndex, targetIndex),
      from: topologyId(definitionPath, branch.from), to: topologyId(definitionPath, target), kind: "branch", basis: "declared", sourceIndex, targetIndex,
      ...(branch.metadata !== undefined ? { metadata: copy(branch.metadata) } : {}) }))),
  ];
  return { name: graph.name || (definitionPath.length ? definitionPath.at(-1) : definition.name) || "Graph", definitionPath: [...definitionPath],
    nodes, edges, memberIdsByNodeId, nodeIdByExecutionId, unmappedExecutionIds };
}
