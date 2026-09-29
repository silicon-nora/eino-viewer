import {
  adaptWorkflowSnapshot,
  validateAgentEventEnvelope,
  validateCallbackEventEnvelope,
  validateComposeGraphEnvelope,
  validateComponentIOEnvelope,
  validateEinoDAGEnvelope,
  validateSchemaAgenticMessageEnvelope,
  validateSchemaDocumentEnvelope,
  validateSchemaMessageEnvelope,
  validateSchemaToolEnvelope,
} from "./protocol.js";
import { completedRunStatus, runCompletion, runCompletionDiagnostics, validateRunLifecycleEnvelope, validateRunLifecycleSequence } from "./run-lifecycle.js";
import { createTimingContext, nodeTiming, runTiming } from "./execution-timing.js";
import { createAgentScopeContext, scopePartitions } from "./execution-scopes.js";

export const EXECUTION_DAG_SCHEMA_VERSION = 1;

const DOMAIN_VALIDATORS = new Map([
  ["run.lifecycle", validateRunLifecycleEnvelope],
  ["agent.event", validateAgentEventEnvelope],
  ["callback.event", validateCallbackEventEnvelope],
  ["compose.graph", validateComposeGraphEnvelope],
  ["component.io", validateComponentIOEnvelope],
  ["schema.agentic_message", validateSchemaAgenticMessageEnvelope],
  ["schema.document", validateSchemaDocumentEnvelope],
  ["schema.message", validateSchemaMessageEnvelope],
  ["schema.tool", validateSchemaToolEnvelope],
]);

function own(object, key) {
  const descriptor = object && typeof object === "object"
    ? Object.getOwnPropertyDescriptor(object, key)
    : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code, path, message, severity = "error", envelopeIndex) {
  const result = { severity, code, path, message };
  if (envelopeIndex !== undefined) result.envelopeIndex = envelopeIndex;
  return Object.freeze(result);
}

function freezeResult(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeResult(nested);
  return Object.freeze(value);
}

function slug(value, fallback = "event") {
  const result = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || fallback;
}

function roleOfMessage(payload) {
  return own(payload, "role") || own(own(payload, "value"), "role");
}

function messageValue(agentPayload) {
  return own(own(own(agentPayload, "output"), "message"), "value");
}

function messageOutput(agentPayload) {
  return own(own(agentPayload, "output"), "message");
}

function toolCallsOf(value) {
  const calls = own(value, "tool_calls");
  return Array.isArray(calls) ? calls : [];
}

function toolCallName(call) {
  return own(own(call, "function"), "name") || own(call, "name") || "tool";
}

function toolCallId(call, index) {
  return own(call, "id") || `anonymous-${index + 1}`;
}

function sourceLabel(...parts) {
  return parts.filter((part) => typeof part === "string" && part.length > 0).join(" · ");
}

function toolAddress(payload) {
  const address = own(payload, "address");
  if (!Array.isArray(address)) return undefined;
  return [...address].reverse().find((segment) => own(segment, "type") === "tool");
}

function envelopeRunId(envelope) {
  return own(own(envelope, "correlation"), "runId");
}

function sameCallbackLocation(left, right) {
  const same = (a, b, equal) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, index) => equal(entry, b[index]));
  return same(own(left, "address"), own(right, "address"), (a, b) => ["type", "id", "subId"].every((key) => own(a, key) === own(b, key)))
    && same(own(left, "nodePath") || [], own(right, "nodePath") || [], (a, b) => a === b);
}

function validateDomainEnvelope(envelope) {
  const base = validateEinoDAGEnvelope(envelope);
  if (!base.valid) return base;
  const validator = DOMAIN_VALIDATORS.get(own(envelope, "kind"));
  if (own(envelope, "kind") === "workflow.snapshot") {
    const result = adaptWorkflowSnapshot(own(envelope, "payload"));
    return { valid: result.ok, diagnostics: result.diagnostics };
  }
  return validator ? validator(envelope) : base;
}

function builderState(runId) {
  return {
    runId,
    nodes: [],
    edges: [],
    edgeKeys: new Set(),
    nodeById: new Map(),
    toolByCallId: new Map(),
    toolDefinitions: new Map(),
    pendingAgentNodes: [],
    callbackStacks: new Map(),
    callbackByEventId: new Map(),
    componentByEntity: new Map(),
    workflowByPath: new Map(),
    observedToolIds: new Set(),
    interruptions: [],
    lastSemanticId: undefined,
    lastAgentByName: new Map(),
    pendingTransfer: undefined,
    consumedToolCallIds: new Set(),
    counters: new Map(),
  };
}

function nextCounter(state, kind) {
  const next = (state.counters.get(kind) || 0) + 1;
  state.counters.set(kind, next);
  return next;
}

function evidence(index, envelope, role) {
  const result = { envelopeIndex: index, kind: own(envelope, "kind") };
  if (role) result.role = role;
  return result;
}

function addEvidence(node, index, envelope, role, includeTiming = true) {
  if (!node.evidence.some((entry) => entry.envelopeIndex === index)) {
    node.evidence.push(evidence(index, envelope, role));
  }
  const observedAtMs = own(envelope, "observedAtMs");
  if (includeTiming && Number.isSafeInteger(observedAtMs)) {
    node.startedAtMs = node.startedAtMs === undefined
      ? observedAtMs
      : Math.min(node.startedAtMs, observedAtMs);
    node.finishedAtMs = node.finishedAtMs === undefined
      ? observedAtMs
      : Math.max(node.finishedAtMs, observedAtMs);
  }
}

function addNode(state, definition, index, envelope, role) {
  let id = slug(definition.id);
  if (state.nodeById.has(id)) {
    const base = id;
    let suffix = 2;
    while (state.nodeById.has(`${base}:${suffix}`)) suffix += 1;
    id = `${base}:${suffix}`;
  }
  const node = {
    id,
    kind: definition.kind,
    label: definition.label,
    component: definition.component,
    status: definition.status || "success",
    sequence: state.nodes.length + 1,
    evidence: [],
    correlation: definition.correlation || {},
    metadata: definition.metadata || {},
  };
  if (definition.errorMessage) node.errorMessage = definition.errorMessage;
  addEvidence(node, index, envelope, role, definition.includeTiming !== false);
  state.nodes.push(node);
  state.nodeById.set(node.id, node);
  return node;
}

function addEdge(state, from, to, kind, metadata = {}) {
  if (!from || !to || from === to) return;
  const key = JSON.stringify([from, to, kind]);
  if (state.edgeKeys.has(key)) return;
  state.edgeKeys.add(key);
  state.edges.push({
    id: `${slug(from)}--${kind}--${slug(to)}`,
    from,
    to,
    kind,
    sequence: state.edges.length + 1,
    metadata,
  });
}

function connectFromLast(state, node, kind = "control") {
  if (state.lastSemanticId) addEdge(state, state.lastSemanticId, node.id, kind);
  state.lastSemanticId = node.id;
}

function createToolNode(state, call, callIndex, agentRecordNode, envelopeIndex, envelope) {
  const callId = toolCallId(call, callIndex);
  const name = toolCallName(call);
  const argumentsJson = own(own(call, "function"), "arguments");
  let node = state.toolByCallId.get(callId);
  if (!node) {
    node = addNode(state, {
      id: `tool:${name}:${callId}`,
      kind: "tool",
      label: sourceLabel("tool", name),
      component: "components.Tool",
      status: "running",
      includeTiming: false,
      correlation: { runId: state.runId, toolCallId: callId },
      metadata: {
        toolName: name,
        toolCallId: callId,
        executionState: "planned",
        ...(argumentsJson !== undefined
          ? { argumentsJson }
          : {}),
      },
    }, envelopeIndex, envelope, "tool-call");
    state.toolByCallId.set(callId, node);
  } else {
    // Tool callbacks may be observed before the Agent iterator yields the
    // assistant tool_call. Enrich that existing node with the authoritative
    // call name and arguments instead of depending on callback ordering.
    addEvidence(node, envelopeIndex, envelope, "tool-call", false);
    node.label = sourceLabel("tool", name);
    node.metadata.toolName = name;
    if (argumentsJson !== undefined) node.metadata.argumentsJson = argumentsJson;
  }
  const definitionIndexes = state.toolDefinitions.get(name) || [];
  for (const index of definitionIndexes) addEvidence(node, index, state.envelopes[index], "definition", false);
  addEdge(state, agentRecordNode.id, node.id, "tool-call", { toolName: name, toolCallId: callId });
  return node;
}

function toolNodeForAgentError(state, error, envelope) {
  const explicitCallId = own(own(envelope, "correlation"), "toolCallId");
  if (typeof explicitCallId === "string" && explicitCallId.length) return state.toolByCallId.get(explicitCallId);
  // Eino can wrap an inner failure in a root AgentEvent. Error text does not
  // carry the inner invocation scope, even if an ID also exists in this scope.
  if (state.agentScope) return undefined;
  const message = own(error, "message");
  if (typeof message !== "string" || !message.length) return undefined;
  const referenced = [...state.toolByCallId.entries()]
    .filter(([callId]) => new RegExp(`(^|[^\\w.-])${callId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\w.-])`).test(message))
    .map(([, node]) => node);
  return referenced.length === 1 ? referenced[0] : undefined;
}

function handleAgentEvent(state, envelope, index) {
  const payload = own(envelope, "payload");
  const agentName = own(payload, "agentName") || "agent";
  const eventOutput = own(payload, "output");
  const output = messageOutput(payload);
  const value = messageValue(payload);
  const role = roleOfMessage(output) || roleOfMessage(value);
  const calls = toolCallsOf(value);
  const action = own(payload, "action");
  const error = own(payload, "error");
  const interrupted = own(action, "interrupted");
  if (interrupted) {
    state.interruptions.push({ index, envelope, interrupted });
    if (!eventOutput && !error) return;
  }
  const runCancellation = error && state.completion.outcome === "cancelled" && index === state.lastAgentErrorIndex;

  // ADK can emit the terminal AgentEvent error before the recorder observes
  // the failed Tool callback boundary. When the error names one tool_call,
  // attribute the failure to that user-visible tool invocation instead of
  // inventing a separate internal agent.event node.
  if (error) {
    const failedTool = runCancellation ? undefined : toolNodeForAgentError(state, error, envelope);
    if (failedTool) {
      addEvidence(failedTool, index, envelope, "error");
      failedTool.status = "failed";
      state.observedToolIds.add(failedTool.id);
      delete failedTool.metadata.executionState;
      failedTool.errorMessage = own(error, "message") || "Tool failed";
      failedTool.metadata = {
        ...failedTool.metadata,
        agentNames: [...new Set([...(failedTool.metadata.agentNames || []), agentName])],
      };
      state.lastSemanticId = failedTool.id;
      state.lastAgentByName.set(agentName, failedTool.id);
      return;
    }
  }

  if (role === "tool") {
    const callId = own(value, "tool_call_id");
    let node = callId ? state.toolByCallId.get(callId) : undefined;
    if (!node) {
      const name = own(value, "tool_name") || own(output, "toolName") || "tool";
      node = addNode(state, {
        id: `tool:${name}:${callId || nextCounter(state, "tool")}`,
        kind: "tool",
        label: sourceLabel("tool", name),
        component: "components.Tool",
        correlation: { runId: state.runId, ...(callId ? { toolCallId: callId } : {}) },
        metadata: { toolName: name, ...(callId ? { toolCallId: callId } : {}) },
      }, index, envelope, "tool-result");
      if (callId) state.toolByCallId.set(callId, node);
      connectFromLast(state, node, "tool-call");
    } else {
      addEvidence(node, index, envelope, "tool");
    }
    node.status = "success";
    state.observedToolIds.add(node.id);
    delete node.metadata.executionState;
    state.lastSemanticId = node.id;
    return;
  }

  let node;
  if (eventOutput || error || action) {
    const eventShape = calls.length > 0 ? "tool-calls" : error ? "error" : action && !output ? "action" : "message";
    const number = nextCounter(state, "agent-event");
    const toolNames = calls.map(toolCallName);
    const pendingIndex = eventShape === "action"
      ? -1
      : state.pendingAgentNodes.findIndex((candidate) => candidate.correlation.agentName === agentName);
    node = pendingIndex >= 0 ? state.pendingAgentNodes.splice(pendingIndex, 1)[0] : undefined;
    const evidenceRole = error ? "error" : role || (action ? "action" : "event");
    const label = sourceLabel("agent.event", agentName, evidenceRole);
    const streaming = own(output, "streaming") === true && own(output, "value") === undefined;
    const metadata = {
        agentName,
        runPath: own(payload, "runPath") || [],
        ...(role ? { messageRole: role } : {}),
        ...(toolNames.length ? { toolCalls: toolNames } : {}),
        ...(own(output, "streaming") ? { streaming: true } : {}),
        ...(own(eventOutput, "customizedOutput") !== undefined
          ? { customizedOutput: own(eventOutput, "customizedOutput") }
          : {}),
        ...(action ? { action } : {}),
      };
    const reused = Boolean(node);
    if (node) {
      addEvidence(node, index, envelope, evidenceRole);
      node.kind = error ? "error" : "agent";
      node.label = label;
      node.component = "adk.AgentEvent";
      node.status = error ? runCancellation ? "cancelled" : "failed" : streaming ? "running" : "success";
      node.metadata = { ...node.metadata, ...metadata };
      if (error) node.errorMessage = own(error, "message");
    } else {
      node = addNode(state, {
        id: `agent:${agentName}:event:${number}`,
        kind: error ? "error" : "agent",
        label,
        component: "adk.AgentEvent",
        status: error ? runCancellation ? "cancelled" : "failed" : streaming ? "running" : "success",
        errorMessage: own(error, "message"),
        correlation: { runId: state.runId, agentName },
        metadata,
      }, index, envelope, evidenceRole);
    }

    const transfer = state.pendingTransfer;
    if (transfer && transfer.destinationAgent === agentName) {
      addEdge(state, transfer.from, node.id, "transfer", { destinationAgent: agentName });
      state.pendingTransfer = undefined;
    } else if (!reused) {
      connectFromLast(state, node, eventShape === "message" && state.lastSemanticId?.startsWith("tool:") ? "observation" : "control");
    }
    state.lastSemanticId = node.id;
    state.lastAgentByName.set(agentName, node.id);

    for (const [callIndex, call] of calls.entries()) createToolNode(state, call, callIndex, node, index, envelope);
  }

  const destinationAgent = own(own(action, "transfer"), "destinationAgent");
  if (destinationAgent) {
    const sourceId = node?.id || state.lastAgentByName.get(agentName) || state.lastSemanticId;
    if (sourceId) {
      state.pendingTransfer = { from: sourceId, destinationAgent };
      const source = state.nodeById.get(sourceId);
      if (source && source !== node) addEvidence(source, index, envelope, "transfer");
    }
  }
}

function handleSchemaMessage(state, envelope, index, format) {
  const payload = own(envelope, "payload");
  const role = roleOfMessage(payload) || "message";
  if (role === "tool") {
    const callId = own(payload, "tool_call_id");
    const tool = callId ? state.toolByCallId.get(callId) : undefined;
    if (tool) {
      addEvidence(tool, index, envelope, "tool");
      tool.status = "success";
      state.observedToolIds.add(tool.id);
      delete tool.metadata.executionState;
      state.lastSemanticId = tool.id;
      return;
    }
  }
  const isInput = role === "user" || role === "system";
  const number = nextCounter(state, isInput ? "input" : "output");
  const node = addNode(state, {
    id: `${isInput ? "input" : "output"}:${role}:${number}`,
    kind: isInput ? "input" : "output",
    label: sourceLabel(`schema.${format === "Message" ? "message" : "agentic_message"}`, role),
    component: `schema.${format}`,
    correlation: { runId: state.runId },
    metadata: { role, format },
  }, index, envelope, role);
  connectFromLast(state, node, isInput ? "data" : "data");
}

function handleComponentIO(state, envelope, index) {
  const payload = own(envelope, "payload");
  const component = own(payload, "component") || "Component";
  const direction = own(payload, "direction");
  const nodePath = own(payload, "nodePath");
  const address = own(payload, "address");
  // Workflow root I/O describes the whole run, not a declared workflow step.
  // Keep it available to the run summary without inventing a topology node.
  if (component === "Workflow" && own(own(own(envelope, "metadata"), "io"), "scope") === "root"
    && Array.isArray(address) && address.length === 1 && own(address[0], "type") === "runnable") return;
  const workflowNode = Array.isArray(nodePath) && nodePath.length
    ? state.workflowByPath.get(JSON.stringify(nodePath))
    : undefined;
  if (workflowNode) {
    const hasFinalSnapshot = workflowNode.metadata.executionStatusSource === "workflow.snapshot";
    addEvidence(workflowNode, index, envelope, direction, !hasFinalSnapshot);
    if (!hasFinalSnapshot) workflowNode.status = direction === "output" ? "success" : "running";
    workflowNode.metadata = {
      ...workflowNode.metadata,
      observedComponent: component,
      ...(own(payload, "format") ? { format: own(payload, "format") } : {}),
      ...(own(payload, "streaming") === true ? { streaming: true } : {}),
    };
    const entityId = own(own(envelope, "correlation"), "entityId");
    if (entityId) state.componentByEntity.set(entityId, workflowNode);
    return;
  }
  if (component === "ChatModel") {
    const address = own(payload, "address");
    const agentSegment = Array.isArray(address)
      ? address.findLast((segment) => own(segment, "type") === "agent")
      : undefined;
    const agentName = own(agentSegment, "id");
    if (agentName) {
      if (direction === "input") {
        const turn = nextCounter(state, `agent-turn:${agentName}`);
        const node = addNode(state, {
          id: `agent:${agentName}:turn:${turn}`,
          kind: "agent",
          label: sourceLabel("component.io", own(payload, "name") || component, direction),
          component: "components.ChatModel",
          status: "running",
          correlation: { runId: state.runId, agentName },
          metadata: { agentName, streaming: own(payload, "streaming") === true },
        }, index, envelope, direction);
        state.pendingAgentNodes.push(node);
        connectFromLast(state, node, state.lastSemanticId?.startsWith("tool:") ? "observation" : "control");
        // A model turn can consume several tool results produced by one prior
        // assistant message. The callback input is authoritative about that
        // join; record every newly consumed tool_call_id instead of guessing
        // from whichever callback happened to be observed last.
        const messages = own(own(payload, "body"), "messages");
        if (Array.isArray(messages)) {
          for (const message of messages) {
            if (roleOfMessage(message) !== "tool") continue;
            const callId = own(message, "tool_call_id");
            if (typeof callId !== "string" || !callId.length || state.consumedToolCallIds.has(callId)) continue;
            state.consumedToolCallIds.add(callId);
            const toolNode = state.toolByCallId.get(callId);
            if (toolNode) addEdge(state, toolNode.id, node.id, "observation", { toolCallId: callId });
          }
        }
      } else {
        const node = [...state.pendingAgentNodes].reverse().find((candidate) => candidate.correlation.agentName === agentName)
          || state.nodeById.get(state.lastAgentByName.get(agentName));
        if (node) {
          addEvidence(node, index, envelope, direction);
          if (own(payload, "streaming") !== true) node.status = "success";
        }
      }
      return;
    }
  }
  if (component === "Tool") {
    const address = toolAddress(payload);
    const callId = own(address, "subId");
    const name = own(payload, "name") || own(address, "id") || "tool";
    let node = callId ? state.toolByCallId.get(callId) : undefined;
    if (!node) {
      node = addNode(state, {
        id: `tool:${name}:${callId || nextCounter(state, "tool")}`,
        kind: "tool",
        label: sourceLabel("tool", name),
        component: "components.Tool",
        status: direction === "output" ? "success" : "running",
        correlation: { runId: state.runId, ...(callId ? { toolCallId: callId } : {}) },
        metadata: { toolName: name, ...(callId ? { toolCallId: callId } : {}) },
      }, index, envelope, direction);
      if (callId) state.toolByCallId.set(callId, node);
      connectFromLast(state, node, "tool-call");
    } else {
      addEvidence(node, index, envelope, direction);
    }
    if (direction === "output") node.status = "success";
    state.observedToolIds.add(node.id);
    delete node.metadata.executionState;
    state.lastSemanticId = node.id;
    return;
  }

  const correlation = own(envelope, "correlation");
  const entityId = own(correlation, "entityId") || `${component}:${own(payload, "name") || nextCounter(state, "component")}`;
  let node = state.componentByEntity.get(entityId);
  if (!node) {
    node = addNode(state, {
      id: `component:${entityId}`,
      kind: "component",
      label: own(payload, "name") || component,
      component,
      status: direction === "output" ? "success" : "running",
      correlation: { runId: state.runId, entityId },
      metadata: { format: own(payload, "format"), streaming: own(payload, "streaming") === true },
    }, index, envelope, direction);
    state.componentByEntity.set(entityId, node);
    connectFromLast(state, node);
  } else {
    addEvidence(node, index, envelope, direction);
  }
  if (direction === "output") node.status = "success";
}

function handleCallback(state, envelope, index) {
  const payload = own(envelope, "payload");
  // AgentRecorder emits errors at the same full component address as its I/O.
  // This is an end boundary for that invocation, not a second graph visit.
  if (own(payload, "phase") === "error" && state.agentScope) {
    const component = own(own(payload, "run"), "component");
    const callId = own(toolAddress(payload), "subId");
    const candidate = component === "Tool" ? state.toolByCallId.get(callId)
      : component === "ChatModel" ? [...state.pendingAgentNodes].reverse().find((node) => node.evidence.some((item) => {
        const source = state.envelopes[item.envelopeIndex];
        return source.kind === "component.io" && source.payload.direction === "input" && sameCallbackLocation(source.payload, payload);
      })) : undefined;
    if (candidate && candidate.evidence.some((item) => {
      const source = state.envelopes[item.envelopeIndex];
      return source.kind === "component.io" && source.payload.direction === "input" && sameCallbackLocation(source.payload, payload);
    })) {
      addEvidence(candidate, index, envelope, "error");
      candidate.status = "failed";
      candidate.errorMessage = own(own(payload, "error"), "message") || "Component failed";
      if (candidate.kind === "tool") state.observedToolIds.add(candidate.id);
      delete candidate.metadata.executionState;
      return;
    }
  }
  const correlation = own(envelope, "correlation");
  const entityId = own(correlation, "entityId") || `callback:${index}`;
  const phase = own(payload, "phase");
  let stack = state.callbackStacks.get(entityId);
  if (!stack) {
    stack = [];
    state.callbackStacks.set(entityId, stack);
  }
  const invocationId = own(correlation, "invocationId");
  let node = phase === "start" ? undefined : invocationId ? stack.find((candidate) => candidate.correlation.invocationId === invocationId) : stack.at(-1);
  if (node) {
    const start = node.evidence.find(({ kind, role }) => kind === "callback.event" && role === "start");
    const startPayload = start && own(state.envelopes[start.envelopeIndex], "payload");
    if (start && (!sameCallbackLocation(startPayload, payload)
      || own(own(startPayload, "run"), "component") !== own(own(payload, "run"), "component"))) node = undefined;
  }
  const unresolved = phase !== "start" && !node && (invocationId || stack.length > 0);
  if (!node) {
    const run = own(payload, "run");
    node = addNode(state, {
      id: `callback:${entityId}:${nextCounter(state, "callback")}`,
      kind: "component",
      label: own(run, "name") || own(run, "component") || entityId,
      component: own(run, "component") || "callbacks.Run",
      status: unresolved ? "incomplete" : phase === "error" ? "failed" : phase === "end" ? "success" : "running",
      includeTiming: !unresolved,
      errorMessage: own(own(payload, "error"), "message"),
      correlation: {
        runId: state.runId,
        entityId,
        ...(own(correlation, "invocationId") || phase === "start" && own(correlation, "eventId") ? { invocationId: own(correlation, "invocationId") || own(correlation, "eventId") } : {}),
        ...(own(correlation, "parentEntityId") ? { parentEntityId: own(correlation, "parentEntityId") } : {}),
      },
      metadata: { streaming: own(payload, "streaming") === true, ...(unresolved ? { callbackCorrelation: "unresolved", executionState: "unrecorded" } : {}) },
    }, index, envelope, phase);
    if (phase === "start") stack.push(node);
    const parentEntityId = own(correlation, "parentEntityId");
    const parent = parentEntityId ? state.componentByEntity.get(parentEntityId) : undefined;
    if (parent) addEdge(state, parent.id, node.id, "parent-child");
    else connectFromLast(state, node);
    state.componentByEntity.set(entityId, node);
  } else {
    addEvidence(node, index, envelope, phase);
  }
  if (phase === "end" && !unresolved) {
    node.status = "success";
    if (stack.includes(node)) stack.splice(stack.indexOf(node), 1);
  } else if (phase === "error" && !unresolved) {
    node.status = "failed";
    node.errorMessage = own(own(payload, "error"), "message") || "Callback failed";
    if (stack.includes(node)) stack.splice(stack.indexOf(node), 1);
  }
  if (own(correlation, "eventId")) state.callbackByEventId.set(own(correlation, "eventId"), { node, phase, envelope });
  state.lastSemanticId = node.id;
}

function attachCallbackIO(state, envelope, index) {
  const correlation = own(envelope, "correlation");
  const payload = own(envelope, "payload");
  const matched = state.callbackByEventId.get(own(correlation, "eventId"));
  const node = matched?.node;
  const invocationId = own(correlation, "invocationId");
  if (node && node.metadata.callbackCorrelation !== "unresolved" && matched.phase === (own(payload, "direction") === "input" ? "start" : "end")
    && node.correlation.entityId === own(correlation, "entityId") && node.component === own(payload, "component")
    && sameCallbackLocation(own(matched.envelope, "payload"), payload)
    && own(own(matched.envelope, "payload"), "streaming") === own(payload, "streaming")
    && (!invocationId || node.correlation.invocationId === invocationId)) {
    addEvidence(node, index, envelope, own(payload, "direction"), false);
    return;
  }
  // An explicit unknown callback identity must not fall back to whichever
  // visit of this entity happened to run last (especially in a loop).
  addNode(state, {
    id: `component-io:${index}`, kind: "component", label: own(payload, "name") || own(payload, "component"),
    component: own(payload, "component"), status: "incomplete", correlation: { ...correlation },
    metadata: { ioCorrelation: "unresolved", executionState: "unrecorded" }, includeTiming: false,
  }, index, envelope, own(payload, "direction"));
}

function handleGraph(state, envelope, index) {
  const kind = own(envelope, "kind");
  const payload = kind === "workflow.snapshot" ? own(own(envelope, "payload"), "workflow") : own(envelope, "payload");
  if (!isObject(payload) || !Array.isArray(own(payload, "nodes"))) return;
  const graphNumber = nextCounter(state, "graph");
  const prefix = `graph:${graphNumber}`;
  const executionNodes = own(own(own(envelope, "payload"), "execution"), "nodes");
  const executionByPath = new Map((Array.isArray(executionNodes) ? executionNodes : [])
    .map((node) => [JSON.stringify(own(node, "path")), node]));
  const addGraph = (graph, parentPath = []) => {
    const local = new Map();
    for (const sourceNode of own(graph, "nodes")) {
      const sourceId = own(sourceNode, "id");
      const sourcePath = [...parentPath, sourceId];
      const pathKey = sourcePath.join("/");
      const executionNode = executionByPath.get(JSON.stringify(sourcePath));
      const observedExecution = executionNode && own(executionNode, "status") !== "skipped";
      if (kind === "workflow.snapshot" && !observedExecution && !state.observedWorkflowPaths.has(JSON.stringify(sourcePath))) continue;
      const node = addNode(state, {
        id: kind === "workflow.snapshot" ? pathKey : `${prefix}:${pathKey}`,
        kind: "workflow",
        label: own(sourceNode, "name") || sourceId,
        component: own(sourceNode, "component") || "compose.Graph",
        status: observedExecution ? own(executionNode, "status") : kind === "workflow.snapshot" ? "running" : "success",
        errorMessage: own(executionNode, "errorMessage"),
        includeTiming: kind !== "workflow.snapshot",
        correlation: { runId: state.runId },
        metadata: { sourceNodeId: sourceId, sourceNodePath: sourcePath, sourceKind: kind,
          ...(observedExecution ? { executionStatusSource: "workflow.snapshot" } : {}) },
      }, index, envelope, "topology");
      if (observedExecution) {
        for (const field of ["startedAtMs", "finishedAtMs"]) {
          if (Number.isFinite(own(executionNode, field))) node[field] = own(executionNode, field);
        }
      }
      local.set(sourceId, node.id);
      if (kind === "workflow.snapshot") state.workflowByPath.set(JSON.stringify(sourcePath), node);
    }
    for (const edge of own(graph, "edges") || []) {
      const from = local.get(own(edge, "from"));
      const to = local.get(own(edge, "to"));
      if (from && to) {
        const channels = own(edge, "channels") || [];
        addEdge(state, from, to, channels.includes("data") ? "data" : "control");
      }
    }
    for (const sourceNode of own(graph, "nodes")) {
      const nested = own(sourceNode, "workflow");
      if (isObject(nested) && Array.isArray(own(nested, "nodes"))) {
        addGraph(nested, [...parentPath, own(sourceNode, "id")]);
      }
    }
  };
  addGraph(payload);
  const last = state.nodes.at(-1);
  if (last) state.lastSemanticId = last.id;
}

function handleGeneric(state, envelope, index) {
  const kind = own(envelope, "kind");
  const node = addNode(state, {
    id: `${kind}:${nextCounter(state, kind)}`,
    kind: kind === "schema.document" ? "data" : "event",
    label: kind === "schema.document" ? own(own(envelope, "payload"), "id") : kind,
    component: own(own(envelope, "source"), "module") || "eino",
    correlation: { runId: state.runId },
    metadata: { sourceKind: kind },
  }, index, envelope, "event");
  connectFromLast(state, node, kind === "schema.document" ? "data" : "control");
}

function interruptionReason(value) {
  if (typeof value === "string") return value;
  return value === undefined ? undefined : JSON.stringify(value);
}

function applyInterruptions(state) {
  for (const { index, envelope, interrupted } of state.interruptions) {
    const contexts = own(interrupted, "contexts");
    let unmatched = !Array.isArray(contexts) || contexts.length === 0;
    const reasons = [];
    for (const context of Array.isArray(contexts) ? contexts : []) {
      const address = own(context, "address");
      const tool = Array.isArray(address)
        ? [...address].reverse().find((segment) => own(segment, "type") === "tool")
        : undefined;
      const callId = own(tool, "subId");
      const node = callId ? state.toolByCallId.get(callId) : undefined;
      const reason = interruptionReason(own(context, "info") ?? own(interrupted, "data")) || "Run interrupted";
      if (reason) reasons.push(reason);
      if (!node) {
        unmatched = true;
        continue;
      }
      addEvidence(node, index, envelope, "interruption", false);
      const completedAfterInterruption = (node.status === "success" || node.status === "failed")
        && node.evidence.some((entry) => entry.envelopeIndex > index
          && ["output", "tool", "tool-result", "error"].includes(entry.role));
      if (!completedAfterInterruption) {
        node.status = "incomplete";
        node.metadata.executionState = "interrupted";
        if (reason) node.metadata.interruptionReason = reason;
        delete node.finishedAtMs;
      }
    }
    if (unmatched) {
      const reason = [...new Set(reasons)].join("; ")
        || interruptionReason(own(interrupted, "data")) || "Run interrupted";
      const node = addNode(state, {
        id: `interrupt:${index}`,
        kind: "error",
        label: "Run interrupted",
        component: "adk.AgentEvent",
        status: "incomplete",
        includeTiming: false,
        correlation: { runId: state.runId },
        metadata: { executionState: "interrupted", interruptionReason: reason, scope: "run" },
      }, index, envelope, "interruption");
      connectFromLast(state, node);
    }
  }
}

function settleIncompleteNodes(state) {
  if (state.completion.state !== "ended") return;
  const endIndex = state.envelopes.findIndex((envelope) => own(envelope, "kind") === "run.lifecycle"
    && own(own(envelope, "payload"), "state") === "ended");
  for (const node of state.nodes) {
    if (node.status !== "running") continue;
    node.status = "incomplete";
    const planned = node.kind === "tool" && !state.observedToolIds.has(node.id);
    node.metadata.executionState = planned ? "planned" : "unrecorded";
    if (planned) delete node.startedAtMs;
    delete node.finishedAtMs;
    addEvidence(node, endIndex, state.envelopes[endIndex], "run-end", false);
  }
}

function projectUserVisibleExecution(state, envelopes) {
  const messageRoles = envelopes
    .filter((envelope) => own(envelope, "kind") === "schema.message" || own(envelope, "kind") === "schema.agentic_message")
    .map((envelope) => roleOfMessage(own(envelope, "payload")));
  if (!messageRoles.includes("user")) return;

  const visible = (node) => (
    (node.kind === "input" && node.metadata.role === "user")
    || node.kind === "tool"
    || (node.kind === "output" && node.metadata.role === "assistant")
    || node.kind === "error"
  );
  const visibleNodes = state.nodes.filter(visible);
  if (visibleNodes.length === state.nodes.length || visibleNodes.length === 0) return;

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of state.edges) {
    const forward = outgoing.get(edge.from) || [];
    forward.push(edge);
    outgoing.set(edge.from, forward);
    const backward = incoming.get(edge.to) || [];
    backward.push(edge);
    incoming.set(edge.to, backward);
  }

  function nearestVisible(startId, direction) {
    const adjacency = direction === "outgoing" ? outgoing : incoming;
    const queue = [startId];
    const visited = new Set([startId]);
    let cursor = 0;
    while (cursor < queue.length) {
      const levelEnd = queue.length;
      const matches = [];
      while (cursor < levelEnd) {
        const current = queue[cursor++];
        for (const edge of adjacency.get(current) || []) {
          const next = direction === "outgoing" ? edge.to : edge.from;
          if (visited.has(next)) continue;
          visited.add(next);
          if (visibleIds.has(next)) matches.push(next);
          else queue.push(next);
        }
      }
      if (matches.length > 0) return [...new Set(matches)];
    }
    return [];
  }

  for (const hidden of state.nodes.filter((node) => !visibleIds.has(node.id))) {
    const targets = nearestVisible(hidden.id, "outgoing");
    const destinations = targets.length > 0 ? targets : nearestVisible(hidden.id, "incoming");
    for (const destinationId of destinations) {
      const destination = state.nodeById.get(destinationId);
      if (!destination) continue;
      for (const item of hidden.evidence) {
        if (!destination.evidence.some((entry) => entry.envelopeIndex === item.envelopeIndex)) {
          destination.evidence.push({
            ...item,
            ...(item.kind === "component.io" && item.role === "input" ? { role: "context" } : {}),
          });
        }
      }
      const agentName = hidden.correlation.agentName || hidden.metadata.agentName;
      if (agentName) {
        destination.metadata.agentNames = [...new Set([...(destination.metadata.agentNames || []), agentName])];
      }
    }
  }

  const projectedEdges = [];
  const projectedEdgeKeys = new Set();
  function projectedEdgeKind(source, target, pathKinds) {
    if (target.kind === "tool") return "tool-call";
    if (source.kind === "tool" && target.kind === "output") return "data";
    if (pathKinds.includes("transfer")) return "transfer";
    if (pathKinds.includes("data")) return "data";
    return "control";
  }
  function addProjectedEdge(source, target, pathKinds) {
    const kind = projectedEdgeKind(source, target, pathKinds);
    const key = JSON.stringify([source.id, target.id, kind]);
    if (projectedEdgeKeys.has(key)) return;
    projectedEdgeKeys.add(key);
    projectedEdges.push({
      id: `${slug(source.id)}--${kind}--${slug(target.id)}`,
      from: source.id,
      to: target.id,
      kind,
      sequence: projectedEdges.length + 1,
      metadata: { projectedFromHiddenRecords: pathKinds.length > 1 },
    });
  }
  for (const source of visibleNodes) {
    const queue = (outgoing.get(source.id) || []).map((edge) => ({ edge, pathKinds: [edge.kind] }));
    const visited = new Set();
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const { edge, pathKinds } = queue[cursor];
      const visitKey = `${edge.to}:${pathKinds.join(",")}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      const target = state.nodeById.get(edge.to);
      if (!target) continue;
      if (visibleIds.has(target.id)) {
        addProjectedEdge(source, target, pathKinds);
      } else {
        for (const next of outgoing.get(target.id) || []) {
          queue.push({ edge: next, pathKinds: [...pathKinds, next.kind] });
        }
      }
    }
  }

  for (const [index, node] of visibleNodes.entries()) {
    node.sequence = index + 1;
    node.evidence.sort((left, right) => left.envelopeIndex - right.envelopeIndex);
  }
  state.nodes = visibleNodes;
  state.edges = projectedEdges;
  state.nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
}

function compileScoped(envelopes, runId, context) {
  const { partitions, unassigned } = scopePartitions(envelopes, context);
  const nodes = [], edges = [];
  let hidden = 0;
  for (const { scope, entries } of partitions) {
    const local = compile(entries.map(({ envelope }) => envelope), runId, scope);
    const id = (value) => scope.parentId || context.roots.length > 1 ? `nested:${scope.ordinal}:${value}` : value;
    for (const node of local.nodes) nodes.push({ ...node, id: id(node.id),
      evidence: node.evidence.map((entry) => ({ ...entry, envelopeIndex: entries[entry.envelopeIndex].index })),
      metadata: { ...node.metadata, agentScopeId: scope.id, agentScopePath: scope.path, ...(scope.parentId ? { parentAgentScopeId: scope.parentId } : {}) } });
    for (const edge of local.edges) edges.push({ ...edge, id: id(edge.id), from: id(edge.from), to: id(edge.to) });
    hidden += local.metadata.hiddenRecordNodeCount;
  }
  // An AgentEvent runPath has names but no invocation IDs. If several child
  // addresses share it, preserve the event independently; never manufacture a
  // second tool execution or attach its body to whichever callback was last.
  for (const { envelope, index } of unassigned) {
    const payload = own(envelope, "payload");
    const error = own(payload, "error");
    nodes.push({ id: `unassigned:evidence:${index}`, kind: error ? "error" : "event",
      label: sourceLabel(own(envelope, "kind"), own(payload, "agentName")), component: own(envelope, "kind") === "agent.event" ? "adk.AgentEvent" : "eino",
      status: error ? "failed" : "success", sequence: 0,
      ...(error ? { errorMessage: own(error, "message") } : {}),
      evidence: [evidence(index, envelope, error ? "error" : "event")], correlation: { runId },
      metadata: { agentScopeUnresolved: true, runPath: own(payload, "runPath") || [], scope: "step" } });
  }
  for (const scope of context.scopes.values()) {
    if (!scope.parentId || !scope.callerToolCallId) continue;
    const parents = nodes.filter((node) => node.metadata.agentScopeId === scope.parentId && node.kind === "tool" && node.correlation.toolCallId === scope.callerToolCallId);
    const children = nodes.filter((node) => node.metadata.agentScopeId === scope.id);
    if (parents.length === 1 && children.length) edges.push({ id: `scope-parent:${scope.ordinal}`, from: parents[0].id, to: children[0].id, kind: "parent-child", sequence: 0, metadata: { basis: "recorded-address" } });
  }
  nodes.sort((a, b) => Math.min(...a.evidence.map(({ envelopeIndex }) => envelopeIndex)) - Math.min(...b.evidence.map(({ envelopeIndex }) => envelopeIndex)));
  nodes.forEach((node, index) => { node.sequence = index + 1; });
  edges.forEach((edge, index) => { edge.sequence = index + 1; });
  const completion = runCompletion(envelopes), timing = runTiming(createTimingContext(envelopes), runId);
  return freezeResult({ schemaVersion: EXECUTION_DAG_SCHEMA_VERSION, runId, nodes, edges, completion,
    status: completedRunStatus(completion, nodes.some(({ status }) => status === "failed") ? "failed" : "running"),
    ...(timing.availability !== "invalid" && timing.startedAtMs !== undefined ? { startedAtMs: timing.startedAtMs } : {}),
    ...(timing.availability !== "invalid" && timing.finishedAtMs !== undefined ? { finishedAtMs: timing.finishedAtMs } : {}),
    metadata: { envelopeCount: envelopes.length, failedNodeCount: nodes.filter(({ status }) => status === "failed").length,
      hiddenRecordNodeCount: hidden, sourceKinds: [...new Set(envelopes.map(({ kind }) => kind))],
      unresolvedAgentEvidenceCount: unassigned.length } });
}

function compile(envelopes, runId, agentScope) {
  if (!agentScope) {
    const context = createAgentScopeContext(envelopes);
    if (context.hasNested) return compileScoped(envelopes, runId, context);
  }
  const state = builderState(runId);
  state.agentScope = agentScope;
  const callbackIO = [];
  state.envelopes = envelopes;
  state.completion = runCompletion(envelopes);
  state.lastAgentErrorIndex = envelopes.findLastIndex((envelope) => own(envelope, "kind") === "agent.event"
    && own(own(envelope, "payload"), "error"));
  state.observedWorkflowPaths = new Set(envelopes
    .filter((envelope) => own(envelope, "kind") === "component.io" || own(envelope, "kind") === "callback.event")
    .map((envelope) => own(own(envelope, "payload"), "nodePath"))
    .filter((path) => Array.isArray(path) && path.length)
    .map((path) => JSON.stringify(path)));

  for (const [index, envelope] of envelopes.entries()) {
    if (own(envelope, "kind") === "schema.tool") {
      const name = own(own(envelope, "payload"), "name");
      const indexes = state.toolDefinitions.get(name) || [];
      indexes.push(index);
      state.toolDefinitions.set(name, indexes);
    }
    if (own(envelope, "kind") === "workflow.snapshot") handleGraph(state, envelope, index);
  }

  for (const [index, envelope] of envelopes.entries()) {
    const kind = own(envelope, "kind");
    if (kind === "schema.tool" || kind === "run.lifecycle" || kind === "workflow.snapshot") continue;
    if (kind === "agent.event") handleAgentEvent(state, envelope, index);
    else if (kind === "schema.message") handleSchemaMessage(state, envelope, index, "Message");
    else if (kind === "schema.agentic_message") handleSchemaMessage(state, envelope, index, "AgenticMessage");
    else if (kind === "component.io") {
      if (own(own(envelope, "correlation"), "eventId")) callbackIO.push({ envelope, index });
      else handleComponentIO(state, envelope, index);
    }
    else if (kind === "callback.event") handleCallback(state, envelope, index);
    else if (kind === "compose.graph") handleGraph(state, envelope, index);
    else handleGeneric(state, envelope, index);
  }

  for (const { envelope, index } of callbackIO) attachCallbackIO(state, envelope, index);

  applyInterruptions(state);
  settleIncompleteNodes(state);

  // compose.graph is declared structure, not an observed invocation. Once
  // runtime callbacks exist, keep the definition as evidence and let the
  // execution view show only actual callback instances (including repeats).
  if (envelopes.some((envelope) => own(envelope, "kind") === "compose.graph")
    && envelopes.some((envelope) => own(envelope, "kind") === "callback.event")) {
    const declaredNodeIds = new Set(state.nodes
      .filter((node) => node.metadata.sourceKind === "compose.graph")
      .map((node) => node.id));
    state.nodes = state.nodes.filter((node) => !declaredNodeIds.has(node.id));
    state.edges = state.edges.filter((edge) => !declaredNodeIds.has(edge.from) && !declaredNodeIds.has(edge.to));
    state.nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  }

  const observedNodeCount = state.nodes.length;
  projectUserVisibleExecution(state, envelopes);

  const timingContext = createTimingContext(envelopes);
  const timing = runTiming(timingContext, runId);
  for (const node of state.nodes) {
    node.evidence.sort((left, right) => left.envelopeIndex - right.envelopeIndex);
    // Supporting messages, plans and definitions are not execution clocks.
    const boundaries = nodeTiming(node, timingContext);
    delete node.startedAtMs;
    delete node.finishedAtMs;
    if (boundaries.availability !== "invalid" && boundaries.startedAtMs !== undefined) node.startedAtMs = boundaries.startedAtMs;
    if (boundaries.availability !== "invalid" && boundaries.finishedAtMs !== undefined) node.finishedAtMs = boundaries.finishedAtMs;
  }
  const failedCount = state.nodes.filter((node) => node.status === "failed").length;
  const awaitingOutput = state.nodes.length === 0 || (state.nodes.some((node) => node.kind === "input")
    && !state.nodes.some((node) => node.kind === "output" || node.kind === "error"));
  const completion = runCompletion(envelopes);
  return freezeResult({
    schemaVersion: EXECUTION_DAG_SCHEMA_VERSION,
    runId,
    nodes: state.nodes,
    edges: state.edges,
    status: completedRunStatus(completion, failedCount
      ? "failed"
      : (awaitingOutput || state.nodes.some((node) => node.status === "running")) ? "running" : "success"),
    completion,
    ...(timing.availability !== "invalid" && timing.startedAtMs !== undefined ? { startedAtMs: timing.startedAtMs } : {}),
    ...(timing.availability !== "invalid" && timing.finishedAtMs !== undefined ? { finishedAtMs: timing.finishedAtMs } : {}),
    metadata: {
      envelopeCount: envelopes.length,
      failedNodeCount: failedCount,
      hiddenRecordNodeCount: observedNodeCount - state.nodes.length,
      sourceKinds: [...new Set(envelopes.map((envelope) => own(envelope, "kind")))],
    },
  });
}

function normalizeCollection(envelopes, requestedRunId) {
  if (!Array.isArray(envelopes)) {
    return { ok: false, diagnostics: [diagnostic("execution.invalid_collection", "root", "Expected an array of Eino DAG envelopes.")] };
  }
  if (envelopes.length === 0) {
    return { ok: false, diagnostics: [diagnostic("execution.empty_collection", "root", "At least one Eino DAG envelope is required.")] };
  }
  const diagnostics = [];
  for (const [index, envelope] of envelopes.entries()) {
    const result = validateDomainEnvelope(envelope);
    for (const entry of result.diagnostics) {
      diagnostics.push(diagnostic(entry.code, `root[${index}]${entry.path === "root" ? "" : entry.path.slice(4)}`, entry.message, entry.severity, index));
    }
  }
  diagnostics.push(...validateRunLifecycleSequence(envelopes));
  if (diagnostics.some((entry) => entry.severity === "error")) return { ok: false, diagnostics };
  const runIds = [...new Set(envelopes.map(envelopeRunId).filter(Boolean))];
  if (requestedRunId !== undefined && (typeof requestedRunId !== "string" || requestedRunId.length === 0)) {
    return { ok: false, diagnostics: [diagnostic("execution.invalid_run_id", "root.options.runId", "Expected runId to be a non-empty string.")] };
  }
  const selectedRunId = requestedRunId || (runIds.length === 1 ? runIds[0] : runIds.length === 0 ? "unscoped" : undefined);
  if (!selectedRunId) {
    return { ok: false, diagnostics: [diagnostic("execution.mixed_run", "root", "Multiple run IDs require buildExecutionDAGs() or an explicit runId.")] };
  }
  const selected = envelopes.filter((envelope) => {
    const runId = envelopeRunId(envelope);
    return requestedRunId ? runId === requestedRunId : !runId || runId === selectedRunId;
  });
  if (selected.length === 0) {
    return { ok: false, diagnostics: [diagnostic("execution.run_not_found", "root.options.runId", `No envelopes belong to run \"${selectedRunId}\".`)] };
  }
  return { ok: true, runId: selectedRunId, envelopes: selected, diagnostics };
}

/** Correlate one observed Eino run into a causal, instance-level execution DAG. */
export function buildExecutionDAG(envelopes, options = {}) {
  const normalized = normalizeCollection(envelopes, own(options, "runId"));
  if (!normalized.ok) return freezeResult({ ok: false, diagnostics: normalized.diagnostics });
  const dag = compile(normalized.envelopes, normalized.runId);
  return freezeResult({ ok: true, dag, diagnostics: [...normalized.diagnostics, ...runCompletionDiagnostics(dag.completion)] });
}

/** Partition an interleaved event collection and correlate every run independently. */
export function buildExecutionDAGs(envelopes) {
  if (!Array.isArray(envelopes)) {
    return freezeResult({ ok: false, dags: [], diagnostics: [diagnostic("execution.invalid_collection", "root", "Expected an array of Eino DAG envelopes.")] });
  }
  const validation = normalizeCollection(envelopes, envelopes.length ? envelopeRunId(envelopes[0]) || "unscoped" : undefined);
  if (!envelopes.length || (!validation.ok && validation.diagnostics.some((entry) => entry.code !== "execution.run_not_found"))) {
    return freezeResult({ ok: false, dags: [], diagnostics: validation.diagnostics });
  }
  const partitions = new Map();
  for (const envelope of envelopes) {
    const runId = envelopeRunId(envelope) || "unscoped";
    const values = partitions.get(runId) || [];
    values.push(envelope);
    partitions.set(runId, values);
  }
  const dags = [];
  const diagnostics = [];
  for (const [runId, values] of partitions) {
    const result = buildExecutionDAG(values, { runId });
    if (result.ok) dags.push(result.dag);
    diagnostics.push(...result.diagnostics);
  }
  return freezeResult({ ok: !diagnostics.some(({ severity }) => severity === "error"), dags, diagnostics });
}

/** Create an append-only builder suitable for live callback and Agent streams. */
export function createExecutionDAGBuilder(options = {}) {
  const runId = own(options, "runId");
  if (runId !== undefined && (typeof runId !== "string" || runId.length === 0)) {
    throw new TypeError("Expected runId to be a non-empty string");
  }
  const envelopes = [];
  return Object.freeze({
    append(envelope) {
      envelopes.push(envelope);
      return this.snapshot();
    },
    appendAll(values) {
      if (!Array.isArray(values)) throw new TypeError("Expected envelopes to be an array");
      envelopes.push(...values);
      return this.snapshot();
    },
    snapshot() {
      return buildExecutionDAG(envelopes, runId ? { runId } : {});
    },
    get size() {
      return envelopes.length;
    },
  });
}

function workflowKind(node) {
  if (node.kind === "input" || node.kind === "output" || node.kind === "data") return "io";
  if (node.kind === "agent") return "llm";
  // Observed Workflow invocations are flattened execution nodes. A renderer
  // "graph" node requires a nested definition that this lossy adapter does
  // not carry, so use ordinary component semantics instead.
  if (node.kind === "workflow") return /ChatModel|AgenticModel/.test(node.component) ? "llm" : "cpu";
  if (node.kind === "tool" || node.kind === "tool-definition" || node.kind === "component") return "cpu";
  return "cpu";
}

/** Lossy compatibility projection for the existing eino-workflow-dag renderer. */
export function executionDAGToWorkflowSnapshot(dag) {
  if (!isObject(dag) || own(dag, "schemaVersion") !== EXECUTION_DAG_SCHEMA_VERSION || !Array.isArray(own(dag, "nodes")) || !Array.isArray(own(dag, "edges"))) {
    throw new TypeError("Expected an ExecutionDAG schemaVersion 1 document");
  }
  const nodes = dag.nodes.map((node) => ({
    id: node.id,
    name: node.label,
    component: node.component,
    kind: workflowKind(node),
    metadata: {
      executionKind: node.kind,
      executionStatus: node.status,
      evidenceEnvelopeIndexes: node.evidence.map((entry) => entry.envelopeIndex),
      correlation: node.correlation,
      ...node.metadata,
    },
  }));
  const incoming = new Set(dag.edges.map((edge) => edge.to));
  const outgoing = new Set(dag.edges.map((edge) => edge.from));
  const edges = dag.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    channels: edge.kind === "control" || edge.kind === "transfer" || edge.kind === "parent-child"
      ? ["control"]
      : ["control", "data"],
    metadata: { executionEdgeKind: edge.kind, ...edge.metadata },
  }));
  for (const node of nodes) {
    if (!incoming.has(node.id)) edges.push({ from: "start", to: node.id, channels: ["control", "data"], metadata: { synthetic: true } });
    if (!outgoing.has(node.id)) edges.push({ from: node.id, to: "end", channels: ["control", "data"], metadata: { synthetic: true } });
  }
  // The compatibility renderer cannot express missing outcomes or cancellation.
  // Keep those nodes in the definition with truthful metadata, but do not invent
  // success, failure, or an authoritative skipped result in its execution data.
  const executionNodes = dag.nodes.filter((node) => node.status !== "incomplete" && node.status !== "cancelled").map((node) => {
    const running = node.status === "running";
    return {
      path: [node.id],
      // WorkflowSnapshot v1 has final outcomes only. "skipped" is the
      // renderer-compatible visual placeholder; the canonical ExecutionDAG
      // and Run Record retain the truthful running state.
      status: node.status === "failed" ? "failed" : running ? "skipped" : node.status,
      // This adapter also accepts legacy DAG documents with observation-span
      // timestamps. Only evidence-backed explanations can establish duration;
      // the compatibility renderer must not infer it from unverified fields.
      durationMs: null,
      ...(node.errorMessage ? { errorMessage: node.errorMessage } : {}),
      metrics: { evidenceCount: node.evidence.length },
    };
  });
  return freezeResult({
    schemaVersion: 1,
    workflow: {
      name: `Eino execution · ${dag.runId}`,
      nodes,
      edges,
      metadata: { projection: "execution-dag-compatibility", sourceRunId: dag.runId },
    },
    execution: {
      id: dag.runId,
      ...(dag.startedAtMs !== undefined ? { startedAtMs: dag.startedAtMs } : {}),
      ...(dag.finishedAtMs !== undefined ? { finishedAtMs: dag.finishedAtMs } : {}),
      nodes: executionNodes,
    },
    metadata: { projection: "execution-dag-compatibility", source: "eino-dag.ExecutionDAG" },
  });
}
