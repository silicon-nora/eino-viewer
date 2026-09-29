import { validateEinoDAGEnvelope } from "./protocol.js";

const OUTCOMES = new Set(["success", "failed", "cancelled", "unknown"]);
const CAPTURES = new Set(["complete", "partial"]);
const EXECUTION_KINDS = new Set(["agent.event", "callback.event", "component.io", "schema.message", "schema.agentic_message", "workflow.snapshot"]);

function own(object, key) {
  const descriptor = object && typeof object === "object"
    ? Object.getOwnPropertyDescriptor(object, key)
    : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function diagnostic(code, path, message, severity = "error") {
  return { severity, code, path, message };
}

/** Internal source-fact validator; lifecycle is additive to the v1 envelope. */
export function validateRunLifecycleEnvelope(envelope) {
  const base = validateEinoDAGEnvelope(envelope);
  if (!base.valid) return base;
  const diagnostics = [];
  if (own(envelope, "kind") !== "run.lifecycle" || own(envelope, "kindVersion") !== 1) {
    diagnostics.push(diagnostic("lifecycle.invalid_version", "root.kindVersion", "Expected run.lifecycle kindVersion 1."));
  }
  const runId = own(own(envelope, "correlation"), "runId");
  if (typeof runId !== "string" || runId.trim().length === 0) {
    diagnostics.push(diagnostic("lifecycle.missing_run_id", "root.correlation.runId", "Run lifecycle evidence requires a run ID."));
  }
  const payload = own(envelope, "payload");
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    diagnostics.push(diagnostic("lifecycle.invalid_payload", "root.payload", "Expected a lifecycle payload object."));
  } else {
    const state = own(payload, "state");
    const fields = state === "ended" ? ["state", "outcome", "capture"] : ["state"];
    for (const key of Object.keys(payload)) {
      if (!fields.includes(key)) diagnostics.push(diagnostic("lifecycle.unknown_field", `root.payload.${key}`, `Unknown lifecycle field "${key}".`));
    }
    if (state !== "started" && state !== "ended") {
      diagnostics.push(diagnostic("lifecycle.invalid_state", "root.payload.state", "Expected state to be started or ended."));
    }
    if (state === "ended") {
      if (!OUTCOMES.has(own(payload, "outcome"))) diagnostics.push(diagnostic("lifecycle.invalid_outcome", "root.payload.outcome", "Expected outcome to be success, failed, cancelled, or unknown."));
      if (!CAPTURES.has(own(payload, "capture"))) diagnostics.push(diagnostic("lifecycle.invalid_capture", "root.payload.capture", "Expected capture to be complete or partial."));
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

/** Validate sequence per run without requiring a start marker in partial captures. */
export function validateRunLifecycleSequence(envelopes, path = "root") {
  const diagnostics = [];
  const states = new Map();
  let anyEnded = false;
  for (const [index, envelope] of envelopes.entries()) {
    const runId = own(own(envelope, "correlation"), "runId");
    const kind = own(envelope, "kind");
    if (kind !== "run.lifecycle") {
      const closed = states.get(runId) === "ended" || (runId === undefined && anyEnded);
      if (closed && EXECUTION_KINDS.has(kind)) {
        diagnostics.push({ ...diagnostic("lifecycle.evidence_after_end", `${path}[${index}]`, "Execution evidence cannot follow the recorded end of its run."), envelopeIndex: index });
      }
      continue;
    }
    const state = own(own(envelope, "payload"), "state");
    const previous = states.get(runId);
    if (previous === "ended" || (previous === "started" && state === "started")) {
      diagnostics.push({ ...diagnostic("lifecycle.conflicting_markers", `${path}[${index}].payload.state`, "Each run accepts at most one started marker followed by at most one ended marker."), envelopeIndex: index });
    }
    states.set(runId, state);
    if (state === "ended") anyEnded = true;
  }
  return diagnostics;
}

export function runCompletion(envelopes) {
  const lifecycle = envelopes.filter((envelope) => own(envelope, "kind") === "run.lifecycle");
  const ended = lifecycle.find((envelope) => own(own(envelope, "payload"), "state") === "ended");
  if (ended) return { state: "ended", basis: "recorded", outcome: own(ended.payload, "outcome"), capture: own(ended.payload, "capture") };
  return lifecycle.length ? { state: "open", basis: "recorded" } : { state: "unknown", basis: "legacy" };
}

export function completedRunStatus(completion, inferredStatus) {
  if (completion.state === "open") return "running";
  if (completion.state !== "ended") return inferredStatus;
  return completion.outcome === "unknown" ? "incomplete" : completion.outcome;
}

export function runCompletionDiagnostics(completion) {
  if (completion.state === "unknown") {
    return [diagnostic("lifecycle.completion_unknown", "root", "Legacy evidence has no recorded run end; displayed status is inferred and does not establish completion.", "warning")];
  }
  if (completion.state === "open") {
    return [diagnostic("lifecycle.end_not_recorded", "root", "A run start was recorded, but its end has not been recorded.", "warning")];
  }
  const diagnostics = [];
  if (completion.capture === "partial") diagnostics.push(diagnostic("lifecycle.partial_capture", "root", "The run ended, but its captured evidence is partial.", "warning"));
  if (completion.outcome === "unknown") diagnostics.push(diagnostic("lifecycle.unknown_outcome", "root", "The run ended, but its final outcome could not be established.", "warning"));
  return diagnostics;
}
