// Private, read-only labels and reading order. Neither helper changes source
// identity, execution order, business values, or the public inspection index.
const words = {
  en: { user: "User input", output: "Assistant output", assistant: "Assistant message", system: "System message",
    tool: "Tool message", toolCall: "Tool call", agent: "Agent message", unconfirmed: "Agent evidence" },
  zh: { user: "用户输入", output: "助手输出", assistant: "助手消息", system: "系统消息",
    tool: "工具消息", toolCall: "工具调用", agent: "Agent 消息", unconfirmed: "Agent 证据" },
};

const terms = {
  en: Object.freeze({ runResult: "Run result", finalResult: "Final result", stepOutput: "Output",
    callResult: "Call result", callInput: "Call input", callOutput: "Call output", graphCalls: "Graph calls",
    workflowHierarchy: "Workflow hierarchy", duration: "Duration", rawRecord: "Original record" }),
  zh: Object.freeze({ runResult: "运行结果", finalResult: "最终结果", stepOutput: "输出",
    callResult: "调用结果", callInput: "调用输入", callOutput: "调用输出", graphCalls: "Graph 调用",
    workflowHierarchy: "Workflow 层级", duration: "耗时", rawRecord: "原始记录" }),
};

function language(locale) {
  return locale === "zh" || locale?.statuses?.success === "成功" ? "zh" : "en";
}

/** Package-private UI terms, independent of source names and recorded values. */
export function readingTerms(locale = "en") {
  return terms[language(locale)];
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.length);
}

function metadataOf(node) {
  return node.technical?.metadata || node.metadata || {};
}

function sourcesOf(node, metadata, envelopes) {
  const references = node.evidence || (metadata.evidenceEnvelopeIndexes || []).map((envelopeIndex) => ({ envelopeIndex }));
  return references.filter(({ role }) => role !== "context" && role !== "topology").map((reference) => {
    const source = envelopes[reference.envelopeIndex];
    if (source && (!reference.kind || source.kind === reference.kind)) return source;
    return reference.payload ? reference : undefined;
  }).filter(Boolean);
}

/** Name from structural source facts only; title adds existing full-run labels. */
export function buildReadingStepPresentation(node, { locale = "en", envelopes = [], invocationLabels, identityLabels } = {}) {
  const metadata = metadataOf(node), correlation = node.technical?.correlation || node.correlation || metadata.correlation || {};
  const kind = metadata.executionKind || node.kind;
  const original = firstText(metadata.einoViewerPresentation?.sourceName, node.label, node.name, node.id) || "";
  const text = words[language(locale)];
  let name = original, role;
  // A Workflow name is application-owned, even when it looks like protocol
  // syntax. The same rule protects custom component/callback names.
  if (kind !== "workflow" && metadata.sourceKind !== "workflow.snapshot") {
    const sources = sourcesOf(node, metadata, envelopes);
    const messageRole = firstText(metadata.role, metadata.messageRole);
    if (kind === "tool") {
      const toolName = firstText(metadata.toolName);
      if (toolName && original === `tool · ${toolName}`) name = toolName;
      role = text.toolCall;
    } else if (["input", "output"].includes(kind) && ["schema.Message", "schema.AgenticMessage"].includes(node.component)
      && ["user", "assistant", "system", "tool"].includes(messageRole)
      && [`schema.message · ${messageRole}`, `schema.agentic_message · ${messageRole}`].includes(original)) {
      name = messageRole === "assistant" && kind === "output" ? text.output : text[messageRole];
    } else if (["agent", "event", "error"].includes(kind)) {
      const agentSources = sources.filter(({ kind }) => kind === "agent.event");
      const sourceNames = [...new Set(agentSources.map(({ payload }) => payload.agentName).filter((value) => typeof value === "string" && value))];
      const sourceName = sourceNames.length === 1 ? sourceNames[0] : undefined;
      const agentName = firstText(metadata.agentName, correlation.agentName, sourceName,
        metadata.agentScopeUnresolved && metadata.runPath?.at(-1));
      const eventNames = agentName ? [agentName, ...["user", "assistant", "system", "tool", "error", "action", "event"].map((role) => `${agentName} · ${role}`)] : [];
      const component = node.component?.replace(/^components\./, "");
      const isModel = kind === "agent" && ["ChatModel", "AgenticModel"].includes(component)
        && [`component.io · ${component} · input`, `component.io · ${component} · output`].includes(original);
      if (agentName && (node.component === "adk.AgentEvent" && eventNames.some((value) => original === `agent.event · ${value}`) || isModel)) name = agentName;
      if (metadata.agentScopeUnresolved) role = text.unconfirmed;
      else if (kind === "agent" || node.component === "adk.AgentEvent") role = text.agent;
    }
  }
  const title = [name, invocationLabels?.get(node.id), identityLabels?.get(node.id)].filter(Boolean).join(" · ");
  return { name, title, ...(role && role !== name ? { role } : {}) };
}

/** UI-only dependency order; same rank layer does not assert concurrency. */
export function buildWorkflowReadingOrder(explanation, { kind } = {}) {
  const nodes = explanation?.nodes || [];
  const original = new Map(nodes.map((node, index) => [node.id, index]));
  const order = new Map(original);
  // A per-ID map cannot represent the positions of duplicate IDs. Equal ranks
  // preserve the caller's stable array order instead of moving either copy.
  if (original.size !== nodes.length) return new Map(nodes.map(({ id }) => [id, 0]));
  if (kind !== "workflow") return order;
  const byID = new Map(nodes.map((node) => [node.id, node]));
  const memberships = new Map(), groups = explanation.groups || [];
  for (const group of groups) for (const id of group.nodeIds || []) {
    if (!memberships.has(id)) memberships.set(id, []);
    memberships.get(id).push(group);
  }
  for (const group of groups) {
    const ids = group.nodeIds || [];
    if (group.kind !== "workflow" || group.basis !== "observed" || ids.length < 2 || new Set(ids).size !== ids.length) continue;
    const members = ids.map((id) => byID.get(id));
    if (members.some((node) => !node || node.kind !== "workflow" || node.basis !== "observed"
      || metadataOf(node).sourceKind !== "workflow.snapshot" || memberships.get(node.id)?.length !== 1)) continue;
    const paths = members.map((node) => metadataOf(node).sourceNodePath);
    if (paths.some((path) => !Array.isArray(path) || !path.length || path.some((part) => typeof part !== "string"))
      || new Set(paths.map((path) => JSON.stringify(path))).size !== paths.length
      || new Set(paths.map((path) => JSON.stringify(path.slice(0, -1)))).size !== 1) continue;
    const local = new Set(ids), incoming = new Map(ids.map((id) => [id, new Set()])), outgoing = new Map(ids.map((id) => [id, new Set()]));
    let reliable = true;
    for (const node of members) {
      if (!Array.isArray(node.causes) || !Array.isArray(node.effects)) { reliable = false; break; }
      for (const [direction, relations] of [["in", node.causes], ["out", node.effects]]) for (const relation of relations) {
        if (!["data", "control"].includes(relation.relation)) continue;
        const peer = byID.get(relation.nodeId);
        if (!peer || relation.basis !== "observed") { reliable = false; break; }
        if (!local.has(peer.id)) continue;
        const reverse = direction === "in" ? peer.effects : peer.causes;
        if (!reverse?.some((entry) => entry.nodeId === node.id && entry.relation === relation.relation && entry.basis === "observed")) { reliable = false; break; }
        const from = direction === "in" ? peer.id : node.id, to = direction === "in" ? node.id : peer.id;
        outgoing.get(from).add(to);
        incoming.get(to).add(from);
      }
    }
    if (!reliable || ids.some((id) => !incoming.get(id).size && !outgoing.get(id).size)) continue;
    const indegrees = new Map(ids.map((id) => [id, incoming.get(id).size]));
    let ready = ids.filter((id) => !indegrees.get(id));
    const sorted = [];
    while (ready.length) {
      ready.sort((a, b) => original.get(a) - original.get(b));
      const next = [];
      for (const id of ready) {
        sorted.push(id);
        for (const target of outgoing.get(id)) {
          indegrees.set(target, indegrees.get(target) - 1);
          if (!indegrees.get(target)) next.push(target);
        }
      }
      ready = next;
    }
    if (sorted.length !== ids.length) continue;
    // Reorder only the slots of this direct scope. Do not move nested children
    // across their sibling scopes or turn cross-scope edges into local order.
    const slots = ids.map((id) => original.get(id)).sort((a, b) => a - b);
    sorted.forEach((id, index) => order.set(id, slots[index]));
  }
  return order;
}
