// The package build aliases this source import to the published compatibility
// dependency. Keeping the local path here also makes repository source tests
// exercise the exact renderer implementation without a workspace symlink.
import { createWorkflowDAG } from "eino-workflow-dag";
import { registerViewerState, selectViewerGraphPath, captureViewerViewport, restoreViewerViewport, revealViewerSelection } from "./viewer-state.js";
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
import { buildExecutionDAG, executionDAGToWorkflowSnapshot } from "./execution-dag.js";
import { validateEinoRunRecord } from "./run-record.js";
import { completedRunStatus, runCompletion, runCompletionDiagnostics, validateRunLifecycleEnvelope, validateRunLifecycleSequence } from "./run-lifecycle.js";
import { buildRepeatedInvocationLabels, buildStepIdentityLabels, workflowAccessibilityLabel, workflowNodeLabel, workflowPresentationSnapshot } from "./renderer-presentation.js";
import { createTimingContext, nodeTiming } from "./execution-timing.js";
import { findJSONValueIssues } from "./json-value.js";
import { projectRunRecordV2Document } from "./viewer-v2.js";
import { createRunViewerV2 } from "./run-viewer-v2.js";
import { createVersionedViewer } from "./versioned-viewer.js";

export const EINO_VIEWER_SCHEMA_VERSION = 1;
export const EINO_VIEWER_KINDS = Object.freeze(["agent", "graph", "workflow"]);
const EXECUTION_NODE_KINDS = new Set([
  "input", "output", "agent", "tool", "tool-definition", "component", "workflow", "data", "event", "error",
]);
const EXECUTION_NODE_STATUSES = new Set(["running", "success", "failed", "skipped", "cancelled", "incomplete"]);
const EXECUTION_EDGE_KINDS = new Set(["control", "data", "tool-call", "observation", "transfer", "parent-child"]);
const EXECUTION_STATUSES = new Set(["running", "success", "failed", "cancelled", "incomplete"]);
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
let graphInstanceSequence = 0;

function own(object, key) {
  const descriptor = object && typeof object === "object"
    ? Object.getOwnPropertyDescriptor(object, key)
    : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code, path, message, severity = "error") {
  return Object.freeze({ severity, code, path, message });
}

function freezeDiagnostics(diagnostics) {
  return Object.freeze(diagnostics.map((entry) => Object.freeze({ ...entry })));
}

export class EinoViewerError extends TypeError {
  constructor(code, message, diagnostics = []) {
    super(message);
    this.name = "EinoViewerError";
    this.code = code;
    this.diagnostics = freezeDiagnostics(diagnostics);
  }
}

function finish(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) finish(nested);
  return Object.freeze(value);
}

function failed(code, path, message, diagnostics = []) {
  return finish({
    ok: false,
    diagnostics: [...diagnostics, diagnostic(code, path, message)],
  });
}

function workflowSnapshot(value) {
  return isObject(value) && own(value, "schemaVersion") === 1 && isObject(own(value, "workflow"));
}

function viewerDocumentCandidate(value) {
  return isObject(value)
    && own(value, "protocol") === undefined
    && (EINO_VIEWER_KINDS.includes(own(value, "kind")) || own(value, "evidence") !== undefined);
}

function rebaseDiagnostics(diagnostics, prefix) {
  return diagnostics.map((entry) => diagnostic(
    entry.code,
    entry.path === "root" ? prefix : `${prefix}${entry.path.slice(4)}`,
    entry.message,
    entry.severity,
  ));
}

function validateSourceEnvelope(envelope) {
  const base = validateEinoDAGEnvelope(envelope);
  if (!base.valid) return base;
  if (own(envelope, "kind") === "workflow.snapshot") {
    const adapted = adaptWorkflowSnapshot(own(envelope, "payload"));
    return { valid: adapted.ok, diagnostics: adapted.diagnostics };
  }
  const validator = DOMAIN_VALIDATORS.get(own(envelope, "kind"));
  return validator ? validator(envelope) : base;
}

function jsonEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => jsonEqual(entry, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(own(left, key), own(right, key)));
}

function validateGraphDefinition(definition, path) {
  const validation = validateComposeGraphEnvelope({
    protocol: "eino-dag",
    protocolVersion: 1,
    kind: "compose.graph",
    kindVersion: 1,
    payload: definition,
  });
  return rebaseDiagnostics(validation.diagnostics, path);
}

function validateExecutionDAG(execution, evidence, path) {
  const diagnostics = [];
  if (!isObject(execution)) return [diagnostic("viewer.invalid_execution", path, "Expected an ExecutionDAG object.")];
  if (own(execution, "schemaVersion") !== 1) diagnostics.push(diagnostic("viewer.invalid_execution_schema", `${path}.schemaVersion`, "Expected ExecutionDAG schemaVersion 1."));
  const runId = own(execution, "runId");
  if (typeof runId !== "string" || !runId.length) diagnostics.push(diagnostic("viewer.invalid_execution_run_id", `${path}.runId`, "Expected a non-empty runId."));
  if (!EXECUTION_STATUSES.has(own(execution, "status"))) diagnostics.push(diagnostic("viewer.invalid_execution_status", `${path}.status`, "Expected status to be running, success, failed, cancelled, or incomplete."));
  const completion = runCompletion(evidence);
  if (own(execution, "completion") !== undefined && !jsonEqual(own(execution, "completion"), completion)) {
    diagnostics.push(diagnostic("viewer.completion_mismatch", `${path}.completion`, "Completion must match its lifecycle source evidence."));
  }
  if (completion.basis === "recorded" && own(execution, "status") !== completedRunStatus(completion, own(execution, "status"))) {
    diagnostics.push(diagnostic("viewer.execution_status_mismatch", `${path}.status`, "Execution status must match its lifecycle source evidence."));
  }
  if (!isObject(own(execution, "metadata"))) diagnostics.push(diagnostic("viewer.invalid_execution_metadata", `${path}.metadata`, "Expected a metadata object."));
  for (const field of ["startedAtMs", "finishedAtMs"]) {
    const value = own(execution, field);
    if (value !== undefined && !Number.isFinite(value)) diagnostics.push(diagnostic("viewer.invalid_execution_time", `${path}.${field}`, "Expected a finite timestamp."));
  }
  if (Number.isFinite(own(execution, "startedAtMs")) && Number.isFinite(own(execution, "finishedAtMs"))
    && own(execution, "finishedAtMs") < own(execution, "startedAtMs")) {
    diagnostics.push(diagnostic("viewer.invalid_execution_time", `${path}.finishedAtMs`, "finishedAtMs cannot precede startedAtMs."));
  }
  const nodes = own(execution, "nodes");
  const edges = own(execution, "edges");
  if (!Array.isArray(nodes)) diagnostics.push(diagnostic("viewer.invalid_execution_nodes", `${path}.nodes`, "Expected an array of execution nodes."));
  if (!Array.isArray(edges)) diagnostics.push(diagnostic("viewer.invalid_execution_edges", `${path}.edges`, "Expected an array of execution edges."));
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return diagnostics;

  const nodeIds = new Set();
  for (const [index, node] of nodes.entries()) {
    const nodePath = `${path}.nodes[${index}]`;
    if (!isObject(node)) {
      diagnostics.push(diagnostic("viewer.invalid_execution_node", nodePath, "Expected an execution node object."));
      continue;
    }
    const id = own(node, "id");
    if (typeof id !== "string" || !id.length) diagnostics.push(diagnostic("viewer.invalid_execution_node_id", `${nodePath}.id`, "Expected a non-empty node id."));
    else if (nodeIds.has(id)) diagnostics.push(diagnostic("viewer.duplicate_execution_node", `${nodePath}.id`, `Duplicate execution node id "${id}".`));
    else nodeIds.add(id);
    if (!EXECUTION_NODE_KINDS.has(own(node, "kind"))) diagnostics.push(diagnostic("viewer.invalid_execution_node_kind", `${nodePath}.kind`, "Unknown execution node kind."));
    if (!EXECUTION_NODE_STATUSES.has(own(node, "status"))) diagnostics.push(diagnostic("viewer.invalid_execution_node_status", `${nodePath}.status`, "Unknown execution node status."));
    for (const field of ["label", "component"]) {
      if (typeof own(node, field) !== "string" || !own(node, field).length) diagnostics.push(diagnostic("viewer.invalid_execution_node", `${nodePath}.${field}`, `Expected a non-empty ${field}.`));
    }
    if (!Number.isSafeInteger(own(node, "sequence")) || own(node, "sequence") < 1) diagnostics.push(diagnostic("viewer.invalid_execution_sequence", `${nodePath}.sequence`, "Expected a positive integer sequence."));
    if (!isObject(own(node, "correlation"))) diagnostics.push(diagnostic("viewer.invalid_execution_correlation", `${nodePath}.correlation`, "Expected a correlation object."));
    if (!isObject(own(node, "metadata"))) diagnostics.push(diagnostic("viewer.invalid_execution_metadata", `${nodePath}.metadata`, "Expected a metadata object."));
    const references = own(node, "evidence");
    if (!Array.isArray(references)) {
      diagnostics.push(diagnostic("viewer.invalid_execution_evidence", `${nodePath}.evidence`, "Expected an evidence reference array."));
    } else {
      for (const [referenceIndex, reference] of references.entries()) {
        const referencePath = `${nodePath}.evidence[${referenceIndex}]`;
        const envelopeIndex = own(reference, "envelopeIndex");
        if (!isObject(reference) || !Number.isSafeInteger(envelopeIndex) || envelopeIndex < 0 || envelopeIndex >= evidence.length) {
          diagnostics.push(diagnostic("viewer.invalid_execution_evidence", referencePath, "Expected an in-range evidence envelopeIndex."));
        } else if (own(reference, "kind") !== own(evidence[envelopeIndex], "kind")) {
          diagnostics.push(diagnostic("viewer.execution_evidence_mismatch", `${referencePath}.kind`, "Evidence kind does not match the referenced source record."));
        }
      }
    }
  }

  const edgeIds = new Set();
  const adjacency = new Map([...nodeIds].map((id) => [id, []]));
  const indegree = new Map([...nodeIds].map((id) => [id, 0]));
  for (const [index, edge] of edges.entries()) {
    const edgePath = `${path}.edges[${index}]`;
    if (!isObject(edge)) {
      diagnostics.push(diagnostic("viewer.invalid_execution_edge", edgePath, "Expected an execution edge object."));
      continue;
    }
    const id = own(edge, "id");
    if (typeof id !== "string" || !id.length) diagnostics.push(diagnostic("viewer.invalid_execution_edge_id", `${edgePath}.id`, "Expected a non-empty edge id."));
    else if (edgeIds.has(id)) diagnostics.push(diagnostic("viewer.duplicate_execution_edge", `${edgePath}.id`, `Duplicate execution edge id "${id}".`));
    else edgeIds.add(id);
    if (!EXECUTION_EDGE_KINDS.has(own(edge, "kind"))) diagnostics.push(diagnostic("viewer.invalid_execution_edge_kind", `${edgePath}.kind`, "Unknown execution edge kind."));
    if (!Number.isSafeInteger(own(edge, "sequence")) || own(edge, "sequence") < 1) diagnostics.push(diagnostic("viewer.invalid_execution_sequence", `${edgePath}.sequence`, "Expected a positive integer sequence."));
    if (!isObject(own(edge, "metadata"))) diagnostics.push(diagnostic("viewer.invalid_execution_metadata", `${edgePath}.metadata`, "Expected a metadata object."));
    const from = own(edge, "from");
    const to = own(edge, "to");
    if (!nodeIds.has(from)) diagnostics.push(diagnostic("viewer.unknown_execution_edge_source", `${edgePath}.from`, `Unknown execution node "${String(from)}".`));
    if (!nodeIds.has(to)) diagnostics.push(diagnostic("viewer.unknown_execution_edge_target", `${edgePath}.to`, `Unknown execution node "${String(to)}".`));
    if (nodeIds.has(from) && nodeIds.has(to)) {
      adjacency.get(from).push(to);
      indegree.set(to, indegree.get(to) + 1);
    }
  }
  const queue = [...nodeIds].filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of adjacency.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (visited !== nodeIds.size) diagnostics.push(diagnostic("viewer.execution_cycle", `${path}.edges`, "ExecutionDAG edges must be acyclic."));
  return diagnostics;
}

function normalizeInput(input) {
  if (isObject(input) && own(input, "runId") !== undefined && own(input, "source") !== undefined && own(input, "evidence") !== undefined) {
    const validation = validateEinoRunRecord(input);
    return validation.valid
      ? { evidence: own(input, "evidence"), runRecord: input }
      : { diagnostics: validation.diagnostics };
  }
  if (viewerDocumentCandidate(input)) return { candidate: input };
  if (workflowSnapshot(input)) {
    const adapted = adaptWorkflowSnapshot(input);
    return adapted.ok ? { evidence: [adapted.envelope], rawWorkflow: input } : { diagnostics: adapted.diagnostics };
  }
  const evidence = Array.isArray(input) ? input : [input];
  if (evidence.length === 0) {
    return { diagnostics: [diagnostic("viewer.empty_input", "root", "At least one Eino source record is required.")] };
  }
  const diagnostics = [];
  for (const [index, envelope] of evidence.entries()) {
    const validation = validateSourceEnvelope(envelope);
    for (const entry of validation.diagnostics) {
      diagnostics.push(diagnostic(entry.code, `root[${index}]${entry.path === "root" ? "" : entry.path.slice(4)}`, entry.message));
    }
  }
  diagnostics.push(...validateRunLifecycleSequence(evidence));
  return diagnostics.length ? { diagnostics } : { evidence };
}

function classify(evidence, requestedKind, sourceDeclared = false) {
  if (requestedKind !== undefined && !EINO_VIEWER_KINDS.includes(requestedKind)) {
    return failed("viewer.invalid_kind", "root.options.kind", "Expected kind to be agent, graph, or workflow.");
  }
  const kinds = evidence.map((envelope) => own(envelope, "kind"));
  const workflow = kinds.includes("workflow.snapshot");
  const agent = kinds.includes("agent.event");
  const graph = kinds.includes("compose.graph");
  if (!requestedKind && workflow && agent) {
    return failed("viewer.ambiguous_kind", "root", "Workflow and Agent anchors require an explicit viewer kind.");
  }
  const kind = requestedKind || (workflow ? "workflow" : agent ? "agent" : graph ? "graph" : undefined);
  if (!kind) {
    return failed("viewer.missing_anchor", "root", "Expected a WorkflowSnapshot, agent.event, or compose.graph anchor.");
  }
  const matched = kind === "workflow" ? workflow : kind === "agent" ? agent : graph;
  if (!matched && !sourceDeclared) {
    return failed("viewer.missing_anchor", "root", `Viewer kind "${kind}" requires a matching source anchor.`);
  }
  return { ok: true, kind };
}

function runIds(evidence) {
  return [...new Set(evidence.map((entry) => own(own(entry, "correlation"), "runId")).filter(Boolean))];
}

function validateViewerDocument(documentValue, options) {
  // projectEinoViewerDocument already checked every JSON value before this
  // canonical-document branch can access or compare any of its fields.
  const diagnostics = [];
  if (own(documentValue, "schemaVersion") !== EINO_VIEWER_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("viewer.invalid_schema_version", "root.schemaVersion", `Expected ViewerDocument schemaVersion ${EINO_VIEWER_SCHEMA_VERSION}.`));
  }
  const kind = own(documentValue, "kind");
  if (!EINO_VIEWER_KINDS.includes(kind)) {
    diagnostics.push(diagnostic("viewer.invalid_kind", "root.kind", "Expected kind to be agent, graph, or workflow."));
  }
  const evidence = own(documentValue, "evidence");
  if (!Array.isArray(evidence) || evidence.length === 0) {
    diagnostics.push(diagnostic("viewer.invalid_evidence", "root.evidence", "Expected at least one Eino source record."));
  }
  if (diagnostics.length || !Array.isArray(evidence)) return diagnostics;

  for (const [index, envelope] of evidence.entries()) {
    const validation = validateSourceEnvelope(envelope);
    diagnostics.push(...rebaseDiagnostics(validation.diagnostics, `root.evidence[${index}]`));
  }
  diagnostics.push(...validateRunLifecycleSequence(evidence, "root.evidence"));
  if (own(documentValue, "completion") !== undefined && !jsonEqual(own(documentValue, "completion"), runCompletion(evidence))) {
    diagnostics.push(diagnostic("viewer.completion_mismatch", "root.completion", "Completion must match its lifecycle source evidence."));
  }
  if (diagnostics.length) return diagnostics;
  if (own(options, "kind") !== undefined && own(options, "kind") !== kind) {
    diagnostics.push(diagnostic("viewer.kind_mismatch", "root.options.kind", `ViewerDocument kind is "${kind}", not "${own(options, "kind")}".`));
  }
  const ids = runIds(evidence);
  const requestedRunId = own(options, "runId");
  if (ids.length > 1) diagnostics.push(diagnostic("viewer.mixed_run", "root.evidence", "A ViewerDocument cannot contain multiple run IDs."));
  if (requestedRunId && !ids.includes(requestedRunId)) {
    diagnostics.push(diagnostic("viewer.run_not_found", "root.options.runId", `No source record belongs to run "${requestedRunId}".`));
  }
  const classification = classify(evidence, kind);
  if (!classification.ok) diagnostics.push(...classification.diagnostics);

  const graphAnchors = evidence.filter((entry) => own(entry, "kind") === "compose.graph");
  const workflowAnchors = evidence.filter((entry) => own(entry, "kind") === "workflow.snapshot");
  const definition = own(documentValue, "definition");
  if (kind === "workflow") {
    if (workflowAnchors.length !== 1) {
      diagnostics.push(diagnostic("viewer.ambiguous_definition", "root.evidence", "A Workflow viewer document requires exactly one workflow.snapshot definition."));
    } else if (!jsonEqual(definition, own(workflowAnchors[0], "payload"))) {
      diagnostics.push(diagnostic("viewer.definition_mismatch", "root.definition", "Workflow definition must match its source evidence."));
    }
    const adapted = adaptWorkflowSnapshot(definition);
    if (!adapted.ok) diagnostics.push(...rebaseDiagnostics(adapted.diagnostics, "root.definition"));
  } else {
    if (graphAnchors.length > 1) {
      diagnostics.push(diagnostic("viewer.ambiguous_definition", "root.evidence", `A ${kind === "graph" ? "Graph" : "Agent"} viewer document accepts at most one compose.graph definition.`));
    }
    if (kind === "graph" && graphAnchors.length !== 1) {
      diagnostics.push(diagnostic("viewer.missing_definition", "root.definition", "A Graph viewer document requires one compose.graph definition."));
    }
    if (graphAnchors.length === 1) {
      if (!jsonEqual(definition, own(graphAnchors[0], "payload"))) {
        diagnostics.push(diagnostic("viewer.definition_mismatch", "root.definition", `${kind === "graph" ? "Graph" : "Agent"} definition must match its source evidence.`));
      }
      diagnostics.push(...validateGraphDefinition(definition, "root.definition"));
    } else if (definition !== undefined) {
      diagnostics.push(diagnostic("viewer.unanchored_definition", "root.definition", "A definition must be backed by compose.graph source evidence."));
    }
  }

  const execution = own(documentValue, "execution");
  if (kind === "agent" && execution === undefined) {
    diagnostics.push(diagnostic("viewer.missing_execution", "root.execution", "An Agent viewer document requires an ExecutionDAG."));
  }
  if (execution !== undefined) {
    diagnostics.push(...validateExecutionDAG(execution, evidence, "root.execution"));
    if (ids.length === 1 && own(execution, "runId") !== ids[0]) {
      diagnostics.push(diagnostic("viewer.execution_run_mismatch", "root.execution.runId", "Execution runId must match its source evidence."));
    }
  }
  return diagnostics;
}

function executionFor(evidence, runId) {
  const runtimeKinds = new Set(["agent.event", "callback.event", "component.io", "schema.message", "schema.agentic_message"]);
  if (!evidence.some((entry) => runtimeKinds.has(own(entry, "kind")))) return undefined;
  return buildExecutionDAG(evidence, runId ? { runId } : {});
}

/** Project source records into one Agent, Graph, or Workflow viewer document. */
export function projectEinoViewerDocument(input, options = {}) {
  if (own(input, "schemaVersion") === 2 && own(input, "run") !== undefined) return projectRunRecordV2Document(input, options);
  const jsonIssues = findJSONValueIssues(input);
  if (jsonIssues.length) return finish({ ok: false, diagnostics: jsonIssues.map((entry) => diagnostic(
    entry.code === "recursive_reference" || entry.code === "unsafe_integer" || entry.code.startsWith("max_")
      ? `viewer.${entry.code}` : "viewer.invalid_json_value", entry.path, entry.message,
  )) });
  const requestedKind = own(options, "kind");
  if (requestedKind !== undefined && !EINO_VIEWER_KINDS.includes(requestedKind)) {
    return failed("viewer.invalid_kind", "root.options.kind", "Expected kind to be agent, graph, or workflow.");
  }
  const requestedRunId = own(options, "runId");
  if (requestedRunId !== undefined && (typeof requestedRunId !== "string" || requestedRunId.length === 0)) {
    return failed("viewer.invalid_run_id", "root.options.runId", "Expected runId to be a non-empty string.");
  }
  const normalized = normalizeInput(input);
  if (normalized.candidate) {
    const diagnostics = validateViewerDocument(normalized.candidate, options);
    const completion = diagnostics.length ? undefined : runCompletion(normalized.candidate.evidence);
    const candidate = normalized.candidate;
    const document = candidate.completion && (!candidate.execution || candidate.execution.completion)
      ? candidate : { ...candidate, completion, ...(candidate.execution ? { execution: { ...candidate.execution, completion } } : {}) };
    return diagnostics.length
      ? finish({ ok: false, diagnostics })
      : finish({ ok: true, document, diagnostics: runCompletionDiagnostics(completion) });
  }
  if (normalized.diagnostics) return finish({ ok: false, diagnostics: normalized.diagnostics });
  const evidence = normalized.evidence;
  const recordKind = own(normalized.runRecord, "source");
  const recordRunId = own(normalized.runRecord, "runId");
  if (requestedKind && recordKind && requestedKind !== recordKind) {
    return failed("viewer.kind_mismatch", "root.options.kind", `Eino Run Record source is "${recordKind}", not "${requestedKind}".`);
  }
  if (requestedRunId && recordRunId && requestedRunId !== recordRunId) {
    return failed("viewer.run_not_found", "root.options.runId", `Eino Run Record belongs to run "${recordRunId}", not "${requestedRunId}".`);
  }
  const effectiveKind = requestedKind || recordKind;
  const effectiveRunId = requestedRunId || recordRunId;
  const ids = runIds(evidence);
  if (!effectiveRunId && ids.length > 1) {
    return failed("viewer.mixed_run", "root", "Multiple run IDs require an explicit runId.");
  }
  const selected = effectiveRunId
    ? evidence.filter((entry) => !own(own(entry, "correlation"), "runId") || own(own(entry, "correlation"), "runId") === effectiveRunId)
    : evidence;
  if (effectiveRunId && !selected.some((entry) => own(own(entry, "correlation"), "runId") === effectiveRunId)) {
    return failed("viewer.run_not_found", "root.options.runId", `No source record belongs to run "${effectiveRunId}".`);
  }
  const classification = classify(selected, effectiveKind, Boolean(normalized.runRecord));
  if (!classification.ok) return classification;
  const kind = classification.kind;
  const diagnostics = [...(own(normalized.runRecord, "diagnostics") || [])];
  let definition;
  if (kind === "workflow") {
    const anchors = selected.filter((entry) => own(entry, "kind") === "workflow.snapshot");
    if (anchors.length > 1) {
      return failed("viewer.ambiguous_definition", "root", "A Workflow viewer document requires one workflow.snapshot definition.");
    }
    definition = normalized.rawWorkflow || own(anchors[0], "payload");
  } else {
    const graphAnchors = selected.filter((entry) => own(entry, "kind") === "compose.graph");
    if (kind === "graph" && graphAnchors.length > 1) {
      return failed("viewer.ambiguous_definition", "root", "A Graph viewer document requires one compose.graph definition.");
    }
    if (graphAnchors.length) {
      const validation = validateComposeGraphEnvelope(graphAnchors[0]);
      if (!validation.valid) return finish({ ok: false, diagnostics: validation.diagnostics });
      definition = own(graphAnchors[0], "payload");
    }
  }
  const execution = executionFor(selected, effectiveRunId || ids[0]);
  if (execution && !execution.ok) return finish({ ok: false, diagnostics: execution.diagnostics });
  if (kind === "agent" && !execution) {
    return failed("viewer.missing_execution", "root", "An Agent viewer document requires observed execution records.");
  }
  const unknownKinds = selected.filter((entry) => ![
    "workflow.snapshot", "compose.graph", "agent.event", "callback.event", "component.io",
    "schema.message", "schema.agentic_message", "schema.tool", "schema.document", "run.lifecycle",
  ].includes(own(entry, "kind")));
  if (unknownKinds.length) {
    diagnostics.push(diagnostic("viewer.unknown_evidence", "root", `${unknownKinds.length} unknown source record(s) were retained as evidence.`, "warning"));
  }
  const document = {
    schemaVersion: EINO_VIEWER_SCHEMA_VERSION,
    kind,
    evidence: selected,
    completion: runCompletion(selected),
  };
  if (definition !== undefined) document.definition = definition;
  if (execution?.ok) document.execution = execution.dag;
  return finish({ ok: true, document, diagnostics: [...diagnostics, ...(execution?.diagnostics || runCompletionDiagnostics(document.completion))] });
}

function graphSnapshot(document) {
  if (document.execution) {
    const snapshot = executionDAGToWorkflowSnapshot(document.execution);
    if (document.kind === "workflow") {
      return {
        ...snapshot,
        workflow: { ...snapshot.workflow, name: document.definition.workflow.name || snapshot.workflow.name },
        metadata: { ...document.definition.metadata, ...snapshot.metadata },
      };
    }
    return snapshot;
  }
  if (document.kind === "workflow") return document.definition;
  return undefined;
}

function workflowDefinitionNode(snapshot, renderedNode) {
  const path = Array.isArray(own(renderedNode, "path"))
    ? own(renderedNode, "path")
    : [own(renderedNode, "id")];
  let graph = own(snapshot, "workflow");
  let node;
  for (const id of path) {
    node = Array.isArray(own(graph, "nodes"))
      ? own(graph, "nodes").find((entry) => own(entry, "id") === id)
      : undefined;
    if (!node) return renderedNode;
    graph = own(node, "workflow");
  }
  return node || renderedNode;
}

function canonicalViewerNode(viewerDocumentValue, renderedNode) {
  if (viewerDocumentValue.execution) {
    return viewerDocumentValue.execution.nodes.find((node) => node.id === own(renderedNode, "id")) || renderedNode;
  }
  return workflowDefinitionNode(viewerDocumentValue.definition, renderedNode);
}

function usesGraphStructure(documentValue) {
  return documentValue.kind === "graph"
    && !documentValue.evidence.some((envelope) => own(envelope, "kind") !== "compose.graph");
}

function renderingSnapshot(document, locale) {
  const context = createTimingContext(document.evidence);
  const timings = document.execution && new Map(document.execution.nodes.map((node) => [node.id, nodeTiming(node, context)]));
  return workflowPresentationSnapshot(graphSnapshot(document), locale, timings,
    buildRepeatedInvocationLabels(document.execution, document.evidence, locale), buildStepIdentityLabels(document.execution, document.evidence));
}

function workflowMountOptions(options, snapshot, documentValue) {
  const rendererOptions = { ...options, snapshot };
  delete rendererOptions.kind;
  delete rendererOptions.runId;
  // The compatibility renderer cannot encode incomplete/cancelled outcomes.
  // Keep those outcomes out of its execution entries and label the source
  // state explicitly instead of silently mapping it to success or skipped.
  if (typeof options.nodeLabelFormatter !== "function") {
    rendererOptions.nodeLabelFormatter = workflowNodeLabel;
  }
  if (typeof options.accessibilityLabelFormatter !== "function" && options.ariaLabel === undefined) {
    rendererOptions.accessibilityLabelFormatter = (summary, visible) => workflowAccessibilityLabel(summary, visible, options.locale);
  }
  rendererOptions.onNodeClick = (renderedNode) => options.onNodeClick?.({
    id: own(renderedNode, "id"),
    node: canonicalViewerNode(documentValue(), renderedNode),
  });
  return rendererOptions;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function mountGraph(container, viewerDocumentValue, options) {
  const graph = viewerDocumentValue.definition;
  const declared = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const declaredEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const referenced = new Set(declaredEdges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = [
    ...(referenced.has("start") ? [{ id: "start", name: "Start", component: "Start" }] : []),
    ...declared,
    ...(referenced.has("end") ? [{ id: "end", name: "End", component: "End" }] : []),
  ];
  const width = Math.max(720, container.clientWidth || 720);
  const height = Math.max(440, container.clientHeight || 440);
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(180, width * 0.34);
  const radiusY = Math.max(120, height * 0.3);
  const positions = new Map(nodes.map((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, nodes.length);
    return [node.id, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY }];
  }));
  const renderedNodes = new Map();
  const wrapper = document.createElement("div");
  wrapper.className = "eino-viewer-graph";
  wrapper.style.cssText = "width:100%;height:100%;overflow:hidden;background:#f7f7f3";
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": graph?.name || "Eino Graph" });
  svg.style.cssText = "display:block;width:100%;height:100%;font-family:ui-sans-serif,system-ui,sans-serif";
  const defs = svgElement("defs");
  const markerId = `eino-viewer-arrow-${graphInstanceSequence += 1}`;
  const marker = svgElement("marker", { id: markerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#77766e" }));
  defs.append(marker);
  svg.append(defs);
  for (const [index, edge] of declaredEdges.entries()) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const self = edge.from === edge.to;
    const reverse = !self && declaredEdges.some((candidate, candidateIndex) => (
      candidateIndex !== index && candidate.from === edge.to && candidate.to === edge.from
    ));
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const start = { x: from.x + unitX * 76, y: from.y + unitY * 34 };
    const end = { x: to.x - unitX * 76, y: to.y - unitY * 34 };
    const midpoint = {
      x: (start.x + end.x) / 2 - unitY * 54,
      y: (start.y + end.y) / 2 + unitX * 54,
    };
    const path = svgElement("path", {
      d: self
        ? `M ${from.x + 38} ${from.y - 10} C ${from.x + 95} ${from.y - 90}, ${from.x - 95} ${from.y - 90}, ${from.x - 38} ${from.y - 10}`
        : reverse
          ? `M ${start.x} ${start.y} Q ${midpoint.x} ${midpoint.y} ${end.x} ${end.y}`
          : `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      fill: "none",
      stroke: "#77766e",
      "stroke-width": 2,
      "marker-end": `url(#${markerId})`,
      "data-edge-index": index,
    });
    svg.append(path);
  }
  for (const node of nodes) {
    const point = positions.get(node.id);
    const group = svgElement("g", { tabindex: 0, role: "button", "data-node-id": node.id, "aria-label": node.name || node.id });
    group.style.cursor = "pointer";
    const box = svgElement("rect", { x: point.x - 70, y: point.y - 29, width: 140, height: 58, rx: 12, fill: "#fff", stroke: "#24241f", "stroke-width": 1.5 });
    renderedNodes.set(node.id, { group, box });
    group.append(box);
    const title = svgElement("text", { x: point.x, y: point.y - 2, "text-anchor": "middle", fill: "#191915", "font-size": 14, "font-weight": 650 });
    title.textContent = node.name || node.id;
    const component = svgElement("text", { x: point.x, y: point.y + 17, "text-anchor": "middle", fill: "#76756e", "font-size": 10 });
    component.textContent = node.component || "Node";
    group.append(title, component);
    group.addEventListener("click", () => options.onNodeClick?.({ id: node.id, node }));
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      options.onNodeClick?.({ id: node.id, node });
    });
    svg.append(group);
  }
  wrapper.append(svg);
  container.replaceChildren(wrapper);
  let unregister;
  const renderer = { destroy() { unregister(); wrapper.remove(); } };
  unregister = registerViewerState(renderer, {
    select(path) {
      const id = path?.length === 1 ? path[0] : undefined;
      if (path !== null && !renderedNodes.has(id)) return false;
      for (const [nodeId, { group, box }] of renderedNodes) {
        const selected = nodeId === id;
        group.setAttribute("aria-pressed", String(selected));
        group.setAttribute("data-active", String(selected));
        box.setAttribute("stroke", selected ? "#2758c7" : "#24241f");
        box.setAttribute("stroke-width", selected ? "3" : "1.5");
        box.setAttribute("fill", selected ? "#eaf0ff" : "#fff");
      }
      return true;
    },
    capture: () => undefined,
    restore: () => false,
  });
  return renderer;
}

/** Mount one projected document. Graph definitions preserve cycles. */
export function createEinoViewer(container, input, options = {}) {
  return createVersionedViewer(container, input, options, createLegacyEinoViewer, createRunViewerV2, EinoViewerError);
}

function createLegacyEinoViewer(container, input, options = {}) {
  if (!container || container.nodeType !== 1 || typeof container.replaceChildren !== "function") {
    const diagnostics = [diagnostic("viewer.invalid_container", "root.container", "Expected an Element container.")];
    throw new EinoViewerError("viewer.invalid_container", diagnostics[0].message, diagnostics);
  }
  let current;
  let mounted;
  let destroyed = false;
  let unregister;

  function assertActive() {
    if (!destroyed) return;
    const diagnostics = [diagnostic("viewer.destroyed", "root", "Cannot update a destroyed Eino viewer.")];
    throw new EinoViewerError("viewer.destroyed", diagnostics[0].message, diagnostics);
  }

  function projectionError(diagnostics) {
    const summary = diagnostics
      .slice(0, 5)
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join("; ");
    const suffix = diagnostics.length > 5 ? `; and ${diagnostics.length - 5} more` : "";
    return new EinoViewerError(
      diagnostics[0]?.code || "viewer.invalid_input",
      `Invalid Eino viewer input: ${summary}${suffix}`,
      diagnostics,
    );
  }

  function mount(value, initial = false) {
    if (!initial) assertActive();
    const projected = projectEinoViewerDocument(value, options);
    if (!projected.ok) {
      throw projectionError(projected.diagnostics);
    }
    const nextDocument = projected.document;
    const currentGraphStructure = current ? usesGraphStructure(current) : false;
    const nextGraphStructure = usesGraphStructure(nextDocument);
    if (mounted && !currentGraphStructure && !nextGraphStructure) {
      mounted.update(renderingSnapshot(nextDocument, options.locale));
      current = nextDocument;
      return;
    }
    if (mounted && currentGraphStructure && nextGraphStructure) {
      const nextMounted = mountGraph(container, nextDocument, options);
      mounted.destroy();
      mounted = nextMounted;
      current = nextDocument;
      return;
    }
    mounted?.destroy();
    mounted = nextGraphStructure
      ? mountGraph(container, nextDocument, options)
      : createWorkflowDAG(
          container,
          workflowMountOptions(options, renderingSnapshot(nextDocument, options.locale), () => current || nextDocument),
        );
    current = nextDocument;
  }

  mount(input, true);
  const viewer = Object.freeze({
    get kind() { return current.kind; },
    get document() { return current; },
    update(value) { mount(value); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unregister?.();
      mounted?.destroy();
      mounted = undefined;
      container.replaceChildren();
    }
  });
  unregister = registerViewerState(viewer, {
    select: (path) => !destroyed && selectViewerGraphPath(mounted, path),
    capture: () => !destroyed ? captureViewerViewport(mounted) : undefined,
    restore: (viewport) => !destroyed && restoreViewerViewport(mounted, viewport),
    reveal: () => !destroyed && revealViewerSelection(mounted),
  });
  return viewer;
}
