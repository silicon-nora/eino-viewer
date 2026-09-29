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
import { createAgentScopeContext, scopePartitions } from "./execution-scopes.js";
import { createTimingContext, nodeTiming } from "./execution-timing.js";
import { parseRecordJSON } from "./record-input.js";

export const EXECUTION_TRAJECTORY_SCHEMA_VERSION = 1;

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

function freezeResult(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeResult(nested);
  return Object.freeze(value);
}

function cloneJSON(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function diagnostic(code, path, message, severity = "error", envelopeIndex) {
  const result = { severity, code, path, message };
  if (envelopeIndex !== undefined) result.envelopeIndex = envelopeIndex;
  return result;
}

function validateDomainEnvelope(envelope) {
  const base = validateEinoDAGEnvelope(envelope);
  if (!base.valid) return base;
  if (own(envelope, "kind") === "workflow.snapshot") {
    const result = adaptWorkflowSnapshot(own(envelope, "payload"));
    return { valid: result.ok, diagnostics: result.diagnostics };
  }
  const validator = DOMAIN_VALIDATORS.get(own(envelope, "kind"));
  return validator ? validator(envelope) : base;
}

function envelopeRunId(envelope) {
  return own(own(envelope, "correlation"), "runId");
}

function evidence(index, envelope, role) {
  const result = { envelopeIndex: index, kind: own(envelope, "kind") };
  if (role) result.role = role;
  return result;
}

function addEvidence(record, index, envelope, role) {
  if (!record.evidence.some((entry) => entry.envelopeIndex === index)) {
    record.evidence.push(evidence(index, envelope, role));
  }
}

function parseJSON(value) {
  if (typeof value !== "string") return value;
  try {
    return parseRecordJSON(value);
  } catch {
    return value;
  }
}

function messageValue(payload) {
  return own(own(own(payload, "output"), "message"), "value");
}

function messageRole(payload) {
  const message = own(own(payload, "output"), "message");
  return own(messageValue(payload), "role") || own(message, "role");
}

function toolCalls(value) {
  const calls = own(value, "tool_calls");
  return Array.isArray(calls) ? calls : [];
}

function toolCallId(call, index) {
  return own(call, "id") || `anonymous-${index + 1}`;
}

function toolCallName(call) {
  return own(own(call, "function"), "name") || own(call, "name") || "tool";
}

function toolCallArguments(call) {
  return parseJSON(own(own(call, "function"), "arguments") ?? own(call, "arguments"));
}

function toolAddress(payload) {
  const address = own(payload, "address");
  if (!Array.isArray(address)) return undefined;
  return [...address].reverse().find((segment) => own(segment, "type") === "tool");
}

function componentToolCallId(payload) {
  return own(toolAddress(payload), "subId") || own(payload, "name") || "";
}

function agentEventShape(envelope) {
  const payload = own(envelope, "payload");
  const value = messageValue(payload);
  return {
    role: messageRole(payload),
    toolCallCount: toolCalls(value).length,
    toolCallId: own(value, "tool_call_id"),
  };
}

// Recorder evidence stays in immutable observation order. Projection is allowed
// to process explicitly correlated records in causal order while retaining each
// record's original envelope index for Raw-record navigation and timing.
function causalAgentEvidence(envelopes) {
  const prefix = [];
  const toolDefinitions = [];
  const agentEvents = [];
  const assistantMessages = [];
  const modelGroups = [];
  const toolGroups = new Map();
  const toolGroupOrder = [];
  const remainder = [];
  let currentModelGroup = [];
  const flushModelGroup = () => {
    if (currentModelGroup.length) modelGroups.push(currentModelGroup);
    currentModelGroup = [];
  };

  envelopes.forEach((envelope, index) => {
    const entry = { envelope, index };
    const kind = own(envelope, "kind");
    const payload = own(envelope, "payload");
    if (kind === "schema.message" || kind === "schema.agentic_message") {
      if (own(payload, "role") === "assistant") assistantMessages.push(entry);
      else prefix.push(entry);
      return;
    }
    if (kind === "schema.tool") {
      toolDefinitions.push(entry);
      return;
    }
    if (kind === "agent.event") {
      agentEvents.push(entry);
      return;
    }
    if (kind !== "component.io") {
      remainder.push(entry);
      return;
    }
    if (isModelComponent(payload)) {
      if (own(payload, "direction") === "input") flushModelGroup();
      currentModelGroup.push(entry);
      if (own(payload, "direction") === "output") flushModelGroup();
      return;
    }
    if (own(payload, "component") === "Tool") {
      const callId = componentToolCallId(payload);
      if (!toolGroups.has(callId)) toolGroupOrder.push(callId);
      toolGroups.set(callId, [...(toolGroups.get(callId) || []), entry]);
      return;
    }
    remainder.push(entry);
  });
  flushModelGroup();

  const result = [...prefix, ...toolDefinitions];
  const usedToolGroups = new Set();
  let modelIndex = 0;
  let assistantIndex = 0;
  for (const entry of agentEvents) {
    const shape = agentEventShape(entry.envelope);
    if (shape.role === "assistant" && modelIndex < modelGroups.length) {
      result.push(...modelGroups[modelIndex]);
      modelIndex += 1;
    }
    if (shape.role === "tool" && toolGroups.has(shape.toolCallId)) {
      result.push(...toolGroups.get(shape.toolCallId));
      usedToolGroups.add(shape.toolCallId);
    }
    result.push(entry);
    if (shape.role === "assistant" && shape.toolCallCount === 0 && assistantIndex < assistantMessages.length) {
      result.push(assistantMessages[assistantIndex]);
      assistantIndex += 1;
    }
  }
  for (; modelIndex < modelGroups.length; modelIndex += 1) result.push(...modelGroups[modelIndex]);
  for (const callId of toolGroupOrder) {
    if (!usedToolGroups.has(callId)) result.push(...toolGroups.get(callId));
  }
  result.push(...assistantMessages.slice(assistantIndex), ...remainder);
  return result;
}

function hasAgentAddress(payload) {
  const address = own(payload, "address");
  return Array.isArray(address) && address.some((segment) => own(segment, "type") === "agent");
}

function isModelComponent(payload) {
  const component = own(payload, "component");
  return component === "ChatModel" || component === "AgenticModel";
}

function messageContent(value) {
  return own(value, "content");
}

function makeState(runId, envelopes) {
  return {
    runId,
    envelopes,
    records: [],
    recordsById: new Map(),
    toolsByCallId: new Map(),
    observedToolCalls: new Set(),
    interruptions: [],
    completion: runCompletion(envelopes),
    modelEvidenceByTurn: new Map(),
    pendingSystemEvidence: [],
    assistantOrdinalByTurn: new Map(),
    diagnostics: [],
    modelTurn: 0,
    firstModelInputIndex: undefined,
    sawAgentAnchor: false,
    terminalAssistant: false,
  };
}

function addRecord(state, definition, index, envelope, role) {
  const record = {
    id: definition.id,
    sequence: state.records.length + 1,
    kind: definition.kind,
    status: definition.status || "success",
    label: definition.label,
    depth: definition.depth || 0,
    evidence: [],
    metadata: definition.metadata || {},
  };
  for (const key of ["turn", "step", "parentId", "toolCallId", "input", "output", "error"]) {
    if (definition[key] !== undefined) record[key] = definition[key];
  }
  addEvidence(record, index, envelope, role);
  state.records.push(record);
  state.recordsById.set(record.id, record);
  return record;
}

function currentTurn(state) {
  return state.modelTurn || undefined;
}

function nextAssistantStep(state, turn) {
  const key = turn || 0;
  const value = (state.assistantOrdinalByTurn.get(key) || 0) + 1;
  state.assistantOrdinalByTurn.set(key, value);
  return value;
}

function attachModelEvidence(state, record, turn) {
  for (const entry of state.pendingSystemEvidence) {
    addEvidence(record, entry.index, entry.envelope, "system-message");
  }
  state.pendingSystemEvidence = [];
  if (!turn) return;
  for (const entry of state.modelEvidenceByTurn.get(turn) || []) {
    addEvidence(record, entry.index, entry.envelope, entry.role);
  }
}

function createToolRecord(state, assistant, call, callIndex, index, envelope) {
  const callId = toolCallId(call, callIndex);
  let record = state.toolsByCallId.get(callId);
  if (record) {
    addEvidence(record, index, envelope, "tool-call");
    if (!record.parentId) {
      record.parentId = assistant.id;
      record.turn = assistant.turn;
      record.step = assistant.step;
    }
    return record;
  }
  const name = toolCallName(call);
  const args = toolCallArguments(call);
  record = addRecord(state, {
    id: `tool:${callId}`,
    kind: "tool",
    status: "running",
    label: name,
    turn: assistant.turn,
    step: assistant.step,
    depth: 1,
    parentId: assistant.id,
    toolCallId: callId,
    input: args,
    metadata: { toolName: name, toolCallId: callId },
  }, index, envelope, "tool-call");
  state.toolsByCallId.set(callId, record);
  return record;
}

function handleSchemaMessage(state, envelope, index) {
  const payload = own(envelope, "payload");
  const role = own(payload, "role");
  if (role === "system") {
    state.pendingSystemEvidence.push({ index, envelope });
    return;
  }
  if (role !== "user" && role !== "assistant") return;
  state.sawAgentAnchor = true;
  const content = messageContent(payload);
  if (role === "user") {
    addRecord(state, {
      id: `user:evidence:${index}`,
      kind: "user",
      status: "success",
      label: "User",
      input: content,
      metadata: { messageRole: "user", firstEnvelopeIndex: index },
    }, index, envelope, "message");
    return;
  }

  const prior = [...state.records].reverse().find((record) =>
    record.kind === "assistant" && messageContent(record.output) === content,
  );
  if (prior) {
    addEvidence(prior, index, envelope, "public-output");
    prior.metadata.publicOutput = true;
    state.terminalAssistant = true;
    return;
  }
  const turn = currentTurn(state);
  const step = nextAssistantStep(state, turn);
  const record = addRecord(state, {
    id: `assistant:evidence:${index}`,
    kind: "assistant",
    status: "success",
    label: "Assistant",
    turn,
    step,
    output: payload,
    metadata: { messageRole: "assistant", publicOutput: true },
  }, index, envelope, "public-output");
  attachModelEvidence(state, record, turn);
  state.terminalAssistant = true;
}

function handleModelComponent(state, envelope, index, payload) {
  const direction = own(payload, "direction");
  if (direction === "input") {
    state.modelTurn += 1;
    if (state.firstModelInputIndex === undefined) state.firstModelInputIndex = index;
  }
  const turn = currentTurn(state);
  if (!turn) return;
  const entries = state.modelEvidenceByTurn.get(turn) || [];
  entries.push({ index, envelope, role: direction === "input" ? "model-input" : "model-output" });
  state.modelEvidenceByTurn.set(turn, entries);
}

function handleToolComponent(state, envelope, index, payload) {
  const address = toolAddress(payload);
  const callId = own(address, "subId");
  if (!callId) {
    state.diagnostics.push(diagnostic(
      "trajectory.unmatched_component",
      `/envelopes/${index}`,
      "Tool component evidence has no tool call ID and remains available only in Raw record.",
      "warning",
      index,
    ));
    return;
  }
  state.observedToolCalls.add(callId);
  let record = state.toolsByCallId.get(callId);
  if (!record) {
    record = addRecord(state, {
      id: `tool:${callId}`,
      kind: "tool",
      status: "running",
      label: own(payload, "name") || own(address, "id") || "Tool",
      turn: currentTurn(state),
      step: currentTurn(state) ? 1 : undefined,
      depth: 1,
      toolCallId: callId,
      metadata: { toolName: own(payload, "name") || own(address, "id"), toolCallId: callId },
    }, index, envelope, "component");
    state.toolsByCallId.set(callId, record);
  } else {
    addEvidence(record, index, envelope, own(payload, "direction") === "input" ? "tool-input" : "tool-output");
  }
  const body = own(payload, "body");
  if (own(payload, "direction") === "input") {
    const argumentsJSON = own(body, "argumentsJson");
    if (argumentsJSON !== undefined) record.input = parseJSON(argumentsJSON);
  } else {
    const response = own(body, "response");
    record.output = response === undefined ? body : parseJSON(response);
    if (record.status !== "failed") record.status = "success";
  }
}

function errorTool(state, envelope, errorMessage) {
  // Only explicit call identity can assign an error to a tool. A run-level
  // cancellation and the presence of one requested tool are not that proof.
  const explicitCallId = own(own(envelope, "correlation"), "toolCallId");
  if (explicitCallId) return state.toolsByCallId.get(explicitCallId);
  if (state.agentScope) return undefined;
  const matches = [...state.toolsByCallId.entries()]
    .filter(([callId]) => {
      if (typeof errorMessage !== "string") return false;
      const escaped = callId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^\\w.-])${escaped}(?=$|[^\\w.-])`).test(errorMessage);
    })
    .map(([, record]) => record);
  return matches.length === 1 ? matches[0] : undefined;
}

function handleAgentEvent(state, envelope, index) {
  state.sawAgentAnchor = true;
  const payload = own(envelope, "payload");
  const interrupted = own(own(payload, "action"), "interrupted");
  if (interrupted) state.interruptions.push({ interrupted, envelope, index });
  const error = own(payload, "error");
  if (error) {
    const message = own(error, "message") || "Agent run failed";
    const attributedTool = errorTool(state, envelope, message);
    if (attributedTool) {
      addEvidence(attributedTool, index, envelope, "error");
      attributedTool.status = "failed";
      attributedTool.error = { message };
      state.observedToolCalls.add(attributedTool.toolCallId);
      return;
    }
    const cancelled = state.completion.outcome === "cancelled";
    addRecord(state, {
      id: `error:evidence:${index}`,
      kind: "error",
      status: cancelled ? "cancelled" : "failed",
      label: cancelled ? "Run cancelled" : "Run error",
      turn: currentTurn(state),
      error: { message },
      metadata: { agentName: own(payload, "agentName") || "agent" },
    }, index, envelope, "error");
    return;
  }

  const value = messageValue(payload);
  const role = messageRole(payload);
  if (role === "tool") {
    const callId = own(value, "tool_call_id");
    const record = state.toolsByCallId.get(callId);
    if (!record) {
      state.diagnostics.push(diagnostic(
        "trajectory.unmatched_tool_result",
        `/envelopes/${index}`,
        `Tool result ${callId || "without an ID"} has no matching tool invocation.`,
        "warning",
        index,
      ));
      return;
    }
    state.observedToolCalls.add(callId);
    addEvidence(record, index, envelope, "tool-result");
    record.output = parseJSON(messageContent(value));
    if (record.status !== "failed") record.status = "success";
    return;
  }
  if (role !== "assistant") return;

  const turn = currentTurn(state);
  const step = nextAssistantStep(state, turn);
  const calls = toolCalls(value);
  const content = messageContent(value);
  const ordinal = state.assistantOrdinalByTurn.get(turn || 0);
  const record = addRecord(state, {
    id: turn ? `assistant:turn:${turn}:${ordinal}` : `assistant:evidence:${index}`,
    kind: "assistant",
    status: "success",
    label: calls.length ? "Assistant · tool calls" : "Assistant",
    turn,
    step,
    output: value,
    metadata: {
      agentName: own(payload, "agentName") || "agent",
      messageRole: "assistant",
      toolCallIds: calls.map((call, callIndex) => toolCallId(call, callIndex)),
      toolNames: calls.map(toolCallName),
    },
  }, index, envelope, "agent-message");
  attachModelEvidence(state, record, turn);
  calls.forEach((call, callIndex) => createToolRecord(state, record, call, callIndex, index, envelope));
  if (!calls.length && typeof content === "string" && content.length > 0) state.terminalAssistant = true;
}

function interruptionReason(interrupted, context) {
  const info = own(context, "info");
  if (typeof info === "string" && info.length) return info;
  if (info !== undefined && info !== null) return JSON.stringify(info);
  const data = own(interrupted, "data");
  if (typeof data === "string" && data.length) return data;
  if (data !== undefined && data !== null) return JSON.stringify(data);
  return "Agent run was interrupted";
}

function applyInterruptions(state) {
  // Component callbacks may be projected after their AgentEvent because they
  // are delivered independently. Resolve explicit contexts after all evidence
  // has been processed, without assigning an interrupt to an adjacent tool.
  for (const { interrupted, envelope, index } of state.interruptions) {
    const contexts = own(interrupted, "contexts");
    const candidates = Array.isArray(contexts) && contexts.length ? contexts : [undefined];
    const unresolvedReasons = [];
    for (const context of candidates) {
      const callId = own(toolAddress(context), "subId");
      const record = callId ? state.toolsByCallId.get(callId) : undefined;
      const reason = interruptionReason(interrupted, context);
      if (!record) {
        unresolvedReasons.push(reason);
        continue;
      }
      addEvidence(record, index, envelope, "interruption");
      state.observedToolCalls.add(callId);
      const laterTerminal = record.evidence.some((entry) => entry.envelopeIndex > index
        && ["tool-output", "tool-result", "error"].includes(entry.role));
      if (laterTerminal) continue;
      record.status = "incomplete";
      record.metadata.executionState = "interrupted";
      record.metadata.interruptionReason = reason;
    }
    if (unresolvedReasons.length) {
      const reason = [...new Set(unresolvedReasons)].join("; ");
      addRecord(state, {
        id: `interruption:evidence:${index}`,
        kind: "error",
        status: "incomplete",
        label: "Run interrupted",
        metadata: { executionState: "interrupted", interruptionReason: reason },
      }, index, envelope, "interruption");
      state.diagnostics.push(diagnostic(
        "trajectory.unmatched_interruption",
        `/envelopes/${index}/payload/action/interrupted`,
        "Interruption evidence has no matching tool call ID and remains a run-level observation.",
        "warning",
        index,
      ));
    }
  }
}

function handleEnvelope(state, envelope, index) {
  const kind = own(envelope, "kind");
  const payload = own(envelope, "payload");
  if (kind === "schema.message" || kind === "schema.agentic_message") {
    handleSchemaMessage(state, envelope, index);
    return;
  }
  if (kind === "agent.event") {
    handleAgentEvent(state, envelope, index);
    return;
  }
  if (kind !== "component.io") return;
  if (hasAgentAddress(payload)) state.sawAgentAnchor = true;
  if (isModelComponent(payload)) handleModelComponent(state, envelope, index, payload);
  else if (own(payload, "component") === "Tool") handleToolComponent(state, envelope, index, payload);
}

function timingFor(record, envelopes) {
  const timestamps = record.evidence
    .map(({ envelopeIndex }) => own(envelopes[envelopeIndex], "observedAtMs"))
    .filter(Number.isSafeInteger);
  if (!timestamps.length) return undefined;
  const startedAtMs = Math.min(...timestamps);
  const finishedAtMs = Math.max(...timestamps);
  if (startedAtMs === finishedAtMs) return { semantics: "observed-at", startedAtMs };
  const timing = {
    semantics: "observed-span",
    startedAtMs,
    finishedAtMs,
  };
  if (record.status !== "running") timing.durationMs = finishedAtMs - startedAtMs;
  return timing;
}

function finalize(state) {
  applyInterruptions(state);
  const completion = state.completion;
  if (completion.state === "ended") {
    for (const record of state.records) {
      if (record.kind !== "tool" || record.status !== "running") continue;
      record.status = "incomplete";
      record.metadata.executionState = state.observedToolCalls.has(record.toolCallId) ? "unrecorded" : "planned";
    }
  }
  if (state.modelTurn > 0 && state.firstModelInputIndex !== undefined) {
    for (const record of state.records) {
      if (record.kind === "user" && record.turn === undefined
        && record.metadata.firstEnvelopeIndex < state.firstModelInputIndex) {
        record.turn = 1;
      }
    }
  }
  for (const record of state.records) {
    delete record.metadata.firstEnvelopeIndex;
    record.evidence.sort((left, right) => left.envelopeIndex - right.envelopeIndex);
    const timing = timingFor(record, state.envelopes);
    if (timing) record.timing = timing;
  }
  for (const [turn, entries] of state.modelEvidenceByTurn.entries()) {
    const represented = state.records.some((record) =>
      record.turn === turn && record.kind === "assistant"
      && entries.some((entry) => record.evidence.some(({ envelopeIndex }) => envelopeIndex === entry.index)),
    );
    if (!represented && entries.length) {
      state.diagnostics.push(diagnostic(
        "trajectory.unmatched_model_turn",
        `/envelopes/${entries[0].index}`,
        `Model turn ${turn} has no matching Assistant record and remains available in Raw record.`,
        "warning",
        entries[0].index,
      ));
    }
  }
  const represented = new Set(state.records.flatMap((record) =>
    record.evidence.map(({ envelopeIndex }) => envelopeIndex),
  ));
  const failed = state.records.some((record) => record.status === "failed");
  const status = completedRunStatus(completion, failed ? "failed" : state.terminalAssistant ? "success" : "running");
  state.diagnostics.push(...runCompletionDiagnostics(completion));
  return {
    schemaVersion: EXECUTION_TRAJECTORY_SCHEMA_VERSION,
    runId: state.runId,
    status,
    completion,
    records: state.records,
    metadata: {
      envelopeCount: state.envelopes.length,
      representedEvidenceCount: represented.size,
      sourceKinds: [...new Set(state.envelopes.map((envelope) => own(envelope, "kind")))],
    },
  };
}

export function buildExecutionTrajectory(envelopes, options = {}) {
  if (!Array.isArray(envelopes) || envelopes.length === 0) {
    return freezeResult({
      ok: false,
      diagnostics: [diagnostic(
        "trajectory.empty",
        "/envelopes",
        "Execution trajectory requires at least one envelope.",
      )],
    });
  }
  const diagnostics = [];
  for (const [index, envelope] of envelopes.entries()) {
    const validation = validateDomainEnvelope(envelope);
    if (!validation.valid) {
      for (const item of validation.diagnostics || []) {
        diagnostics.push({ ...item, envelopeIndex: index });
      }
    }
  }
  diagnostics.push(...validateRunLifecycleSequence(envelopes));
  if (diagnostics.some(({ severity }) => severity !== "warning")) {
    return freezeResult({ ok: false, diagnostics });
  }

  const runIds = [...new Set(envelopes.map(envelopeRunId).filter(Boolean))];
  const selectedRunId = own(options, "runId");
  if (selectedRunId !== undefined && (typeof selectedRunId !== "string" || !selectedRunId.length)) {
    return freezeResult({
      ok: false,
      diagnostics: [diagnostic("trajectory.invalid_run_id", "/options/runId", "runId must be a non-empty string.")],
    });
  }
  if (selectedRunId && runIds.some((runId) => runId !== selectedRunId)) {
    return freezeResult({
      ok: false,
      diagnostics: [diagnostic("trajectory.mixed_run", "/envelopes", "All envelopes must belong to the selected run.")],
    });
  }
  if (!selectedRunId && runIds.length > 1) {
    return freezeResult({
      ok: false,
      diagnostics: [diagnostic("trajectory.mixed_run", "/envelopes", "Execution trajectory accepts one run at a time.")],
    });
  }
  const runId = selectedRunId || runIds[0];
  if (!runId) {
    return freezeResult({
      ok: false,
      diagnostics: [diagnostic("trajectory.missing_run_id", "/envelopes", "Execution trajectory requires a run ID.")],
    });
  }

  // Result objects are deeply frozen. Work on an owned JSON copy so projecting
  // a run never freezes objects that still belong to the caller.
  const ownedEnvelopes = cloneJSON(envelopes);
  const scopeContext = createAgentScopeContext(ownedEnvelopes);
  if (scopeContext.hasNested) return scopedTrajectory(ownedEnvelopes, runId, scopeContext, diagnostics);
  const state = makeState(runId, ownedEnvelopes);
  causalAgentEvidence(ownedEnvelopes).forEach(({ envelope, index }) => handleEnvelope(state, envelope, index));
  if (!state.sawAgentAnchor) {
    return freezeResult({
      ok: false,
      diagnostics: [diagnostic(
        "trajectory.missing_agent_anchor",
        "/envelopes",
        "The evidence does not establish an Agent run.",
      )],
    });
  }
  const trajectory = finalize(state);
  return freezeResult({ ok: true, trajectory, diagnostics: [...diagnostics, ...state.diagnostics] });
}

function scopedTrajectory(envelopes, runId, context, diagnostics) {
  const { partitions, unassigned } = scopePartitions(envelopes, context);
  const records = [];
  for (const { scope, entries } of partitions) {
    const local = entries.map(({ envelope }) => envelope);
    const state = makeState(runId, local);
    state.agentScope = scope;
    causalAgentEvidence(local).forEach(({ envelope, index }) => handleEnvelope(state, envelope, index));
    // When same-name child events are ambiguous, component output still proves
    // the model turn and its tool requests inside this exact address scope.
    for (const [turn, modelEntries] of state.modelEvidenceByTurn) {
      if (state.records.some((record) => record.kind === "assistant" && record.evidence.some(({ envelopeIndex }) => modelEntries.some(({ index }) => index === envelopeIndex)))) continue;
      const output = modelEntries.findLast(({ envelope }) => envelope.payload.direction === "output" && envelope.payload.streaming !== true);
      const value = output?.envelope.payload.body?.message;
      if (!value || value.role !== "assistant") continue;
      const record = addRecord(state, { id: `assistant:turn:${turn}:component`, kind: "assistant", label: "Assistant", turn, step: 1, output: value,
        metadata: { agentName: scope.name, messageRole: "assistant", source: "component.io" } }, output.index, output.envelope, "model-output");
      attachModelEvidence(state, record, turn);
      toolCalls(value).forEach((call, callIndex) => createToolRecord(state, record, call, callIndex, output.index, output.envelope));
    }
    // An error callback carries the complete address; the same ID in another
    // child scope cannot receive this failure.
    for (const [index, envelope] of local.entries()) {
      if (envelope.kind !== "callback.event" || envelope.payload.phase !== "error") continue;
      const payload = envelope.payload;
      const callId = own(toolAddress(payload), "subId");
      const target = payload.run?.component === "Tool" ? state.toolsByCallId.get(callId) : undefined;
      if (target) {
        addEvidence(target, index, envelope, "error");
        target.status = "failed";
        target.error = { message: payload.error?.message || "Component failed" };
      } else addRecord(state, { id: `error:evidence:${index}`, kind: "error", status: "failed", label: "Component error", error: { message: payload.error?.message || "Component failed" }, metadata: {} }, index, envelope, "error");
    }
    const trajectory = finalize(state);
    const id = (value) => scope.parentId || context.roots.length > 1 ? `nested:${scope.ordinal}:${value}` : value;
    for (const record of trajectory.records) {
      const copy = { ...record, id: id(record.id), ...(record.parentId ? { parentId: id(record.parentId) } : {}), depth: record.depth + scope.path.length - 1,
        evidence: record.evidence.map((item) => ({ ...item, envelopeIndex: entries[item.envelopeIndex].index })),
        metadata: { ...record.metadata, agentScopeId: scope.id, agentScopePath: scope.path, ...(scope.parentId ? { parentAgentScopeId: scope.parentId } : {}) } };
      delete copy.timing;
      records.push(copy);
    }
    diagnostics.push(...state.diagnostics.filter(({ code }) => !code.startsWith("lifecycle.")).map((entry) => ({ ...entry,
      ...(entry.envelopeIndex !== undefined ? { envelopeIndex: entries[entry.envelopeIndex]?.index } : {}) })));
  }
  for (const { envelope, index } of unassigned) {
    if (envelope.kind !== "agent.event") continue;
    const value = messageValue(envelope.payload), error = envelope.payload.error;
    records.push({ id: `unassigned:evidence:${index}`, sequence: 0, kind: error ? "error" : "assistant", status: error ? "failed" : "success",
      label: "Unassigned Agent evidence", depth: 0, ...(value ? { output: value } : {}), ...(error ? { error: { message: error.message } } : {}),
      evidence: [evidence(index, envelope, error ? "error" : "agent-message")], metadata: { agentScopeUnresolved: true, runPath: envelope.payload.runPath || [] } });
    diagnostics.push(diagnostic("trajectory.ambiguous_agent_scope", `/envelopes/${index}`, "Agent names do not uniquely identify this invocation; the event remains unassigned.", "warning", index));
  }
  for (const scope of context.scopes.values()) {
    if (!scope.parentId || !scope.callerToolCallId) continue;
    const parents = records.filter((record) => record.kind === "tool" && record.toolCallId === scope.callerToolCallId && record.metadata.agentScopeId === scope.parentId);
    if (parents.length !== 1) continue;
    for (const record of records) if (record.metadata.agentScopeId === scope.id && !record.parentId) record.parentId = parents[0].id;
  }
  records.sort((a, b) => Math.min(...a.evidence.map(({ envelopeIndex }) => envelopeIndex)) - Math.min(...b.evidence.map(({ envelopeIndex }) => envelopeIndex)));
  const timingContext = createTimingContext(envelopes);
  records.forEach((record, index) => {
    record.sequence = index + 1;
    const boundaries = nodeTiming({ kind: record.kind === "assistant" ? "agent" : record.kind, component: record.kind === "tool" ? "components.Tool" : "components.ChatModel",
      correlation: { toolCallId: record.toolCallId, agentName: record.metadata.agentName }, metadata: record.metadata,
      evidence: record.evidence.map((entry) => ({ ...entry, role: entry.kind === "component.io" ? envelopes[entry.envelopeIndex].payload.direction : entry.role })) }, timingContext);
    if (boundaries.availability === "available") record.timing = { semantics: "component-boundary", startedAtMs: boundaries.startedAtMs, finishedAtMs: boundaries.finishedAtMs, durationMs: boundaries.durationMs };
    else if (boundaries.startedAtMs !== undefined || boundaries.finishedAtMs !== undefined) record.timing = { semantics: "component-boundary", ...(boundaries.startedAtMs !== undefined ? { startedAtMs: boundaries.startedAtMs } : {}), ...(boundaries.finishedAtMs !== undefined ? { finishedAtMs: boundaries.finishedAtMs } : {}) };
  });
  const completion = runCompletion(envelopes);
  return freezeResult({ ok: true, trajectory: { schemaVersion: EXECUTION_TRAJECTORY_SCHEMA_VERSION, runId,
    status: completedRunStatus(completion, "running"), completion, records,
    metadata: { envelopeCount: envelopes.length, representedEvidenceCount: new Set(records.flatMap(({ evidence }) => evidence.map(({ envelopeIndex }) => envelopeIndex))).size,
      sourceKinds: [...new Set(envelopes.map(({ kind }) => kind))] } }, diagnostics: [...diagnostics, ...runCompletionDiagnostics(completion)] });
}

/** Create an append-only trajectory builder for live Agent evidence streams. */
export function createExecutionTrajectoryBuilder(options = {}) {
  const runId = own(options, "runId");
  if (runId !== undefined && (typeof runId !== "string" || runId.length === 0)) {
    throw new TypeError("Expected runId to be a non-empty string");
  }

  const envelopes = [];
  let current = buildExecutionTrajectory(envelopes, runId ? { runId } : {});

  function appendOwned(values) {
    const owned = cloneJSON(values);
    const candidate = buildExecutionTrajectory([...envelopes, ...owned], runId ? { runId } : {});
    if (candidate.ok) {
      envelopes.push(...owned);
      current = candidate;
    }
    return candidate;
  }

  return Object.freeze({
    append(envelope) {
      return appendOwned([envelope]);
    },
    appendAll(values) {
      if (!Array.isArray(values)) throw new TypeError("Expected envelopes to be an array");
      if (values.length === 0) return current;
      return appendOwned(values);
    },
    snapshot() {
      return current;
    },
    get size() {
      return envelopes.length;
    },
  });
}
