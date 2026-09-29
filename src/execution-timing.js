// Internal, evidence-backed timing shared by the DAG and explanation projections.
// Observation spans and supplied duration-only values are not execution boundaries.
function own(value, key) {
  const descriptor = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;
const reference = (entry, time) => entry && ({ time, index: entry.index });
const root = (payload) => Array.isArray(own(payload, "address")) && payload.address.length === 1 && own(payload.address[0], "type") === "runnable";
const location = (payload) => JSON.stringify([
  own(payload, "address")?.map((segment) => [own(segment, "type"), own(segment, "id"), own(segment, "subId")]),
  own(payload, "nodePath") || [],
]);

export function boundaryTiming(start, end, basis = "unknown", ambiguous = false) {
  const evidenceEnvelopeIndexes = [...new Set([start?.index, end?.index].filter(Number.isInteger))];
  const startedAtMs = timestamp(start?.time) ? start.time : undefined;
  const finishedAtMs = timestamp(end?.time) ? end.time : undefined;
  const invalid = [start, end].some((boundary) => boundary && boundary.time !== undefined && !timestamp(boundary.time));
  const reversed = startedAtMs !== undefined && finishedAtMs !== undefined && finishedAtMs < startedAtMs;
  const reason = ambiguous ? "ambiguous-boundary" : invalid ? "invalid-timestamp" : reversed ? "clock-reversed"
    : !start && !end ? "boundaries-not-recorded" : !start ? "start-not-recorded" : !end ? "end-not-recorded"
      : startedAtMs === undefined || finishedAtMs === undefined ? "timestamp-not-recorded" : undefined;
  const availability = ambiguous || invalid || reversed ? "invalid" : !reason ? "available"
    : start || end ? "partial" : "not-observed";
  return {
    semantics: availability === "available" ? "recorded-boundaries" : "not-observed",
    availability, basis, evidenceEnvelopeIndexes,
    ...(reason ? { reason } : {}),
    ...(!ambiguous && startedAtMs !== undefined ? { startedAtMs } : {}),
    ...(!ambiguous && finishedAtMs !== undefined ? { finishedAtMs } : {}),
    ...(availability === "available" ? { durationMs: finishedAtMs - startedAtMs } : {}),
  };
}

function pairTiming(starts, ends, basis, matches = () => true, clock = (entry) => own(entry.envelope, "observedAtMs")) {
  const start = starts[0], end = ends[0];
  return boundaryTiming(reference(start, start && clock(start)), reference(end, end && clock(end)), basis,
    starts.length > 1 || ends.length > 1 || Boolean(start && end && (end.index < start.index || !matches(start, end))));
}

export function workflowTiming(execution, index) {
  return boundaryTiming(
    own(execution, "startedAtMs") !== undefined ? { time: own(execution, "startedAtMs"), index } : undefined,
    own(execution, "finishedAtMs") !== undefined ? { time: own(execution, "finishedAtMs"), index } : undefined,
    execution ? "workflow" : "unknown",
  );
}

export function createTimingContext(envelopes) {
  const entries = envelopes.map((envelope, index) => ({ envelope, index, payload: own(envelope, "payload") }));
  const workflows = new Map();
  for (const { envelope, index, payload } of entries) {
    if (own(envelope, "kind") !== "workflow.snapshot") continue;
    workflows.set(index, new Map((own(own(payload, "execution"), "nodes") || []).map((node) => [JSON.stringify(own(node, "path")), node])));
  }
  return { entries, workflows };
}

function callbackMatches(start, end) {
  const a = own(start.envelope, "correlation"), b = own(end.envelope, "correlation");
  const invocation = own(a, "invocationId") || own(a, "eventId");
  return own(a, "entityId") === own(b, "entityId") && location(start.payload) === location(end.payload)
    && own(own(start.payload, "run"), "component") === own(own(end.payload, "run"), "component")
    && (!own(b, "invocationId") || own(b, "invocationId") === invocation);
}

function callbacksTiming(entries) {
  return pairTiming(entries.filter(({ payload }) => own(payload, "phase") === "start"),
    entries.filter(({ payload }) => ["end", "error"].includes(own(payload, "phase")) && own(payload, "streaming") !== true),
    "callback", callbackMatches, ({ payload }) => own(payload, "timestampMs"));
}

export function runTiming(context, runId, snapshot) {
  const entries = context.entries.filter(({ envelope }) => !runId || !own(own(envelope, "correlation"), "runId") || own(envelope.correlation, "runId") === runId);
  const markers = entries.filter(({ envelope }) => own(envelope, "kind") === "run.lifecycle");
  if (markers.length) return pairTiming(markers.filter(({ payload }) => own(payload, "state") === "started"),
    markers.filter(({ payload }) => own(payload, "state") === "ended"), "lifecycle",
    (start, end) => own(own(start.envelope, "correlation"), "runId") === own(own(end.envelope, "correlation"), "runId"));
  const callbacks = entries.filter(({ envelope, payload }) => own(envelope, "kind") === "callback.event" && root(payload));
  if (callbacks.length) return callbacksTiming(callbacks);
  const workflows = entries.filter(({ envelope, payload }) => own(envelope, "kind") === "workflow.snapshot" && own(payload, "execution"));
  if (workflows.length > 1) return boundaryTiming(undefined, undefined, "workflow", true);
  return workflowTiming(workflows.length ? own(workflows[0].payload, "execution") : own(snapshot, "execution"), workflows[0]?.index);
}

export function nodeTiming(node, context) {
  if (own(node.metadata, "executionState") === "planned") return boundaryTiming();
  if (own(node.metadata, "callbackCorrelation") === "unresolved" || own(node.metadata, "ioCorrelation") === "unresolved") return boundaryTiming(undefined, undefined, "unknown", true);
  const entries = node.evidence.map((item) => {
    const entry = context.entries[item.envelopeIndex];
    return entry && { ...entry, role: item.role };
  }).filter(Boolean);
  const snapshots = entries.filter(({ envelope }) => own(envelope, "kind") === "workflow.snapshot");
  const path = own(node.metadata, "sourceNodePath");
  if (Array.isArray(path)) {
    const matching = snapshots.map(({ index }) => ({ index, execution: context.workflows.get(index)?.get(JSON.stringify(path)) }))
      .filter(({ execution }) => execution && own(execution, "status") !== "skipped");
    if (matching.length > 1) return boundaryTiming(undefined, undefined, "workflow", true);
    if (matching.length) return workflowTiming(matching[0].execution, matching[0].index);
  }
  const callbacks = entries.filter(({ envelope, role }) => own(envelope, "kind") === "callback.event" && ["start", "end", "error"].includes(role));
  if (callbacks.length && (callbacks.some(({ payload }) => own(payload, "phase") === "start")
    || !entries.some(({ envelope, payload }) => own(envelope, "kind") === "component.io" && own(payload, "direction") === "input"))) return callbacksTiming(callbacks);
  const components = entries.filter(({ envelope, payload, role }) => {
    if (own(envelope, "kind") !== "component.io" || !["input", "output"].includes(role)) return false;
    if (node.kind === "tool") {
      const address = own(payload, "address");
      const tool = Array.isArray(address) && address.findLast((segment) => own(segment, "type") === "tool");
      return own(payload, "component") === "Tool" && own(tool, "subId") === own(node.correlation, "toolCallId");
    }
    if (["input", "output", "error", "event", "data"].includes(node.kind)) return false;
    if (node.kind === "agent" && own(payload, "component") === "ChatModel") {
      const agent = own(payload, "address")?.findLast((segment) => own(segment, "type") === "agent");
      return Boolean(own(node.correlation, "agentName")) && own(agent, "id") === own(node.correlation, "agentName");
    }
    return own(payload, "component") === node.component.replace(/^components\./, "")
      || Array.isArray(path) && JSON.stringify(own(payload, "nodePath")) === JSON.stringify(path);
  });
  const interrupted = own(node.metadata, "executionState") === "interrupted";
  const interruptionIndex = interrupted ? entries.reduce((last, { role, index }) => role === "interruption" ? Math.max(last, index) : last, -1) : -1;
  const errors = callbacks.filter(({ payload }) => own(payload, "phase") === "error");
  if (errors.length) return pairTiming(components.filter(({ payload }) => own(payload, "direction") === "input"), errors, "component",
    (start, end) => location(start.payload) === location(end.payload) && own(start.payload, "component") === own(own(end.payload, "run"), "component"),
    ({ envelope, payload }) => own(envelope, "kind") === "callback.event" ? own(payload, "timestampMs") : own(envelope, "observedAtMs"));
  return pairTiming(components.filter(({ payload }) => own(payload, "direction") === "input"),
    components.filter(({ payload, index }) => own(payload, "direction") === "output" && own(payload, "streaming") !== true && index > interruptionIndex),
    components.length ? "component" : "unknown", (start, end) => location(start.payload) === location(end.payload)
      && own(start.payload, "component") === own(end.payload, "component")
      && own(own(start.envelope, "correlation"), "invocationId") === own(own(end.envelope, "correlation"), "invocationId"));
}
