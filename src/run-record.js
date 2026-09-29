import { validateEinoDAGEnvelope } from "./protocol.js";
import { validateRunLifecycleEnvelope, validateRunLifecycleSequence } from "./run-lifecycle.js";
import { findJSONValueIssues } from "./json-value.js";

export const EINO_RUN_RECORD_SCHEMA_VERSION = 1;
export const EINO_RUN_SOURCES = Object.freeze(["agent", "graph", "workflow"]);

const TOP_LEVEL_FIELDS = new Set(["schemaVersion", "runId", "source", "evidence", "diagnostics", "metadata"]);
const DIAGNOSTIC_FIELDS = new Set(["severity", "code", "path", "message", "adapterId"]);

function own(object, key) {
  const descriptor = object && typeof object === "object"
    ? Object.getOwnPropertyDescriptor(object, key)
    : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function diagnostic(code, path, message) {
  return Object.freeze({ severity: "error", code, path, message });
}

function finish(diagnostics) {
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

function isObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return typeof constructor === "function" && constructor.name === "Object";
  } catch {
    return false;
  }
}

function validateRecordDiagnostic(value, path, diagnostics) {
  if (!isObject(value)) {
    diagnostics.push(diagnostic("run_record.invalid_diagnostic", path, "Expected a diagnostic object."));
    return;
  }
  for (const key of Object.keys(value)) {
    if (!DIAGNOSTIC_FIELDS.has(key)) {
      diagnostics.push(diagnostic("run_record.invalid_diagnostic", `${path}.${key}`, `Unknown diagnostic field "${key}".`));
    }
  }
  if (own(value, "severity") !== "warning" && own(value, "severity") !== "error") {
    diagnostics.push(diagnostic("run_record.invalid_diagnostic", `${path}.severity`, "Expected severity to be warning or error."));
  }
  for (const key of ["code", "path", "message"]) {
    if (typeof own(value, key) !== "string" || own(value, key).length === 0) {
      diagnostics.push(diagnostic("run_record.invalid_diagnostic", `${path}.${key}`, `Expected ${key} to be a non-empty string.`));
    }
  }
  const adapterId = own(value, "adapterId");
  if (adapterId !== undefined && (typeof adapterId !== "string" || adapterId.length === 0)) {
    diagnostics.push(diagnostic("run_record.invalid_diagnostic", `${path}.adapterId`, "Expected adapterId to be a non-empty string."));
  }
}

/** Validate one canonical, self-contained Eino run artifact. */
export function validateEinoRunRecord(input) {
  // Validate the complete input before accessing its fields or walking evidence.
  // This also bounds the later protocol/projection work on deeply nested input.
  const jsonIssues = findJSONValueIssues(input);
  if (jsonIssues.length) return finish(jsonIssues.map((entry) => {
    const code = entry.code === "recursive_reference" || entry.code === "unsafe_integer" || entry.code.startsWith("max_")
      ? `run_record.${entry.code}`
      : /^root\.diagnostics\[\d+\]$/.test(entry.path) && ["non_json_value", "non_json_object"].includes(entry.code)
        ? "run_record.invalid_diagnostic" : "run_record.unsafe_json";
    return diagnostic(code, entry.path, entry.message);
  }));
  const diagnostics = [];
  if (!isObject(input)) return finish([diagnostic("run_record.invalid_record", "root", "Expected an Eino Run Record object.")]);
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_FIELDS.has(key)) diagnostics.push(diagnostic("run_record.unknown_field", `root.${key}`, `Unknown Eino Run Record field "${key}".`));
  }
  if (own(input, "schemaVersion") !== EINO_RUN_RECORD_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("run_record.invalid_schema_version", "root.schemaVersion", `Expected schemaVersion ${EINO_RUN_RECORD_SCHEMA_VERSION}.`));
  }
  const runId = own(input, "runId");
  if (typeof runId !== "string" || runId.trim().length === 0) {
    diagnostics.push(diagnostic("run_record.invalid_run_id", "root.runId", "Expected a non-empty runId."));
  }
  const source = own(input, "source");
  if (!EINO_RUN_SOURCES.includes(source)) {
    diagnostics.push(diagnostic("run_record.invalid_source", "root.source", "Expected source to be agent, graph, or workflow."));
  }
  const evidence = own(input, "evidence");
  if (!Array.isArray(evidence) || evidence.length === 0) {
    diagnostics.push(diagnostic("run_record.invalid_evidence", "root.evidence", "Expected at least one source record."));
  } else {
    for (const [index, envelope] of evidence.entries()) {
      const validation = own(envelope, "kind") === "run.lifecycle"
        ? validateRunLifecycleEnvelope(envelope) : validateEinoDAGEnvelope(envelope);
      for (const entry of validation.diagnostics) {
        diagnostics.push(diagnostic(entry.code, `root.evidence[${index}]${entry.path === "root" ? "" : entry.path.slice(4)}`, entry.message));
      }
      const evidenceRunId = own(own(envelope, "correlation"), "runId");
      if (typeof runId === "string" && evidenceRunId !== runId) {
        diagnostics.push(diagnostic("run_record.mismatched_run_id", `root.evidence[${index}].correlation.runId`, `Expected runId "${runId}".`));
      }
    }
    diagnostics.push(...validateRunLifecycleSequence(evidence, "root.evidence"));
  }
  const recordDiagnostics = own(input, "diagnostics");
  if (recordDiagnostics !== undefined && !Array.isArray(recordDiagnostics)) {
    diagnostics.push(diagnostic("run_record.invalid_diagnostics", "root.diagnostics", "Expected diagnostics to be an array."));
  } else if (recordDiagnostics !== undefined) {
    recordDiagnostics.forEach((entry, index) => validateRecordDiagnostic(entry, `root.diagnostics[${index}]`, diagnostics));
  }
  const metadata = own(input, "metadata");
  if (metadata !== undefined && !isObject(metadata)) {
    diagnostics.push(diagnostic("run_record.invalid_metadata", "root.metadata", "Expected metadata to be an object."));
  }
  return finish(diagnostics);
}

export function parseEinoRunRecord(input) {
  const result = validateEinoRunRecord(input);
  if (!result.valid) {
    const error = new TypeError("Invalid Eino Run Record");
    error.code = result.diagnostics[0].code;
    error.diagnostics = result.diagnostics;
    throw error;
  }
  return input;
}
