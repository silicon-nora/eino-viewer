import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateEinoRunRecord } from "../src/run-record.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { buildExecutionTrajectory } from "../src/trajectory.js";
import { explainEino, explainExecutionDAG, explainWorkflowSnapshot } from "../src/explanation.js";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/recorder-matrix/", import.meta.url));
export const recorderMatrix = JSON.parse(readFileSync(resolve(fixtureDirectory, "manifest.json"), "utf8")).cases;

export function loadRecorderMatrixRecord(id) {
  if (!recorderMatrix.some((entry) => entry.id === id)) throw new Error(`Unknown matrix case: ${id}`);
  return JSON.parse(readFileSync(resolve(fixtureDirectory, `${id}.json`), "utf8"));
}

function isRootIO(envelope) {
  const { payload } = envelope;
  return envelope.kind === "component.io" && ["Graph", "Workflow"].includes(payload.component)
    && payload.address?.length === 1 && payload.address[0].type === "runnable";
}

// This source oracle deliberately does not reuse the production presentation
// helper: an omitted capture flag in that helper must fail these gates. A
// relative Recorder diagnostic without an exact envelope index cannot identify
// which body/error it describes, even when adjacent records have equal text.
function sourceValue(envelope, index, value, pointer, diagnostics = []) {
  const capture = envelope.metadata?.capture;
  const flags = diagnostics.filter((entry) => Number.isSafeInteger(entry.envelopeIndex) && entry.envelopeIndex === index
    && typeof entry.path === "string" && (entry.path === pointer || entry.path.startsWith(`${pointer}/`)));
  const omitted = capture?.status === "omitted";
  const hasValue = !omitted && value !== undefined;
  const redacted = capture?.redacted === true || flags.some(({ code }) => code === "projection.redacted");
  const truncated = capture?.truncated === true || flags.some(({ code }) => code === "projection.truncated");
  const availability = !hasValue ? "not-observed" : redacted ? "redacted" : truncated ? "truncated"
    : value === null ? "null" : value === "" ? "empty" : "available";
  return { index, value, hasValue, availability, ...(omitted ? { reason: capture.reason || "not_captured" } : {}) };
}

// Source callback boundaries define visits independently of projected node IDs.
// Historical records lack invocationId; only their same-location pending pair
// is used, never a global arrival order across unrelated components.
function graphSourceVisits(record) {
  const visits = [], pending = new Map();
  for (const [index, envelope] of record.evidence.entries()) {
    if (envelope.kind !== "callback.event") continue;
    const { payload, correlation = {} } = envelope;
    const location = JSON.stringify([correlation.entityId, payload.address, payload.nodePath || [], payload.run?.component]);
    const active = pending.get(location) || [];
    if (payload.phase === "start") {
      const visit = { start: { index, envelope }, invocationId: correlation.invocationId || correlation.eventId };
      visits.push(visit);
      active.push(visit);
      pending.set(location, active);
    } else {
      const visit = correlation.invocationId ? active.find((entry) => entry.invocationId === correlation.invocationId) : active.at(-1);
      if (visit) {
        visit.terminal = { index, envelope };
        active.splice(active.indexOf(visit), 1);
      }
    }
  }
  return visits;
}

/** Check step values against their own source invocation/path, not another view. */
export function findRecorderStepIssues(scenario, record, document, explanation) {
  if (!["graph", "workflow"].includes(scenario.source) || scenario.definitionOnly) return [];
  const findings = [];
  const add = (code, detail) => findings.push({ code, severity: "error", detail, affectedViews: ["step-details"] });
  const nodes = document?.execution?.nodes || [], explained = explanation?.nodes || [];
  const sources = record.evidence.map((envelope, index) => ({ envelope, index }));
  const steps = scenario.source === "graph" ? graphSourceVisits(record).map((visit) => ({
    label: `invocation ${visit.invocationId}`,
    owners: nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === visit.start.index)),
    io: sources.filter(({ envelope }) => envelope.kind === "component.io" && envelope.correlation?.invocationId === visit.invocationId
      && isDeepStrictEqual(envelope.payload.address, visit.start.envelope.payload.address)
      && isDeepStrictEqual(envelope.payload.nodePath || [], visit.start.envelope.payload.nodePath || [])),
    error: visit.terminal?.envelope.payload.phase === "error"
      ? sourceValue(visit.terminal.envelope, visit.terminal.index, visit.terminal.envelope.payload.error, "/payload/error", record.diagnostics) : undefined,
  })) : (() => {
    const anchor = sources.find(({ envelope }) => envelope.kind === "workflow.snapshot");
    const outcomes = anchor?.envelope.payload.execution?.nodes || [];
    const paths = new Map(outcomes.filter(({ status }) => status !== "skipped").map(({ path }) => [JSON.stringify(path), path]));
    for (const { envelope } of sources) {
      if (envelope.kind === "component.io" && envelope.payload.nodePath?.length) paths.set(JSON.stringify(envelope.payload.nodePath), envelope.payload.nodePath);
    }
    return [...paths].map(([key, path]) => {
      const error = outcomes.find((entry) => JSON.stringify(entry.path) === key)?.errorMessage;
      return {
        label: `Workflow path ${JSON.stringify(path)}`,
        owners: nodes.filter((node) => JSON.stringify(node.metadata?.sourceNodePath) === key),
        io: sources.filter(({ envelope }) => envelope.kind === "component.io" && JSON.stringify(envelope.payload.nodePath) === key),
        // An anchor-wide capture annotation does not identify this path's
        // errorMessage. Workflow outcomes retain their own recorded values.
        error: error ? { index: anchor.index, value: error, hasValue: true, availability: "available" } : undefined,
      };
    });
  })();
  const expectedIds = new Set();
  for (const step of steps) {
    if (step.owners.length !== 1) continue; // The projection gate reports source ownership failures.
    const id = step.owners[0].id;
    expectedIds.add(id);
    const matches = explained.filter((node) => node.id === id);
    if (matches.length !== 1) {
      add("step.explanation_missing_or_duplicated", `${step.label} has ${matches.length} step explanations.`);
      continue;
    }
    for (const direction of ["input", "output"]) {
      const expected = step.io.filter(({ envelope }) => envelope.payload.direction === direction)
        .map(({ envelope, index }) => sourceValue(envelope, index, envelope.payload.body, "/payload/body", record.diagnostics));
      if (direction === "output" && step.error) expected.push(step.error);
      const items = matches[0][direction]?.items || [];
      for (const source of expected) {
        const values = items.filter((item) => isDeepStrictEqual(item.evidenceEnvelopeIndexes, [source.index]));
        if (values.length !== 1) {
          add("step.source_value_missing_or_duplicated", `${step.label} ${direction} at envelope ${source.index} has ${values.length} detail items.`);
          continue;
        }
        const item = values[0];
        if (Object.hasOwn(item, "value") !== source.hasValue || source.hasValue && !isDeepStrictEqual(item.value, source.value)
          || item.availability !== source.availability) {
          add("step.source_value_mismatch", `${step.label} ${direction} at envelope ${source.index} changed the recorded value or availability.`);
        }
        if (item.reason !== source.reason) {
          add("step.source_capture_reason_mismatch", `${step.label} ${direction} at envelope ${source.index} changed its capture omission reason.`);
        }
      }
      for (const item of items) {
        if (!expected.some(({ index }) => isDeepStrictEqual(item.evidenceEnvelopeIndexes, [index]))) {
          add("step.unverified_value", `${step.label} claims a ${direction} value without evidence at its own invocation/path.`);
        }
      }
      const availability = expected.some((item) => item.availability !== "not-observed") ? "available" : "not-observed";
      if (matches[0][direction]?.availability !== availability) add("step.channel_availability_mismatch", `${step.label} ${direction} requires ${availability}.`);
    }
  }
  for (const node of explained) {
    if (!expectedIds.has(node.id)) add("step.unverified_explanation", `${node.id} has no uniquely observed source step.`);
  }
  return findings;
}

// A parent answer is not evidence that a failed child recovered. Require a
// later result at this exact source boundary. Name-only tool events are usable
// only when the source contains one matching invocation address at that path.
function recordedLocalRecovery(evidence, errorIndex) {
  const address = evidence[errorIndex]?.payload?.address;
  if (!Array.isArray(address)) return false;
  const tool = address.at(-1);
  if (tool?.type !== "tool" || !tool.subId) return false;
  const agentPath = address.filter(({ type }) => type === "agent").map(({ id }) => id);
  const invocationAddresses = new Set(evidence.filter(({ kind, payload }) => kind === "component.io" && payload.component === "Tool"
    && payload.address?.at(-1)?.id === tool.id && payload.address?.at(-1)?.subId === tool.subId
    && isDeepStrictEqual(payload.address.filter(({ type }) => type === "agent").map(({ id }) => id), agentPath))
    .map(({ payload }) => JSON.stringify(payload.address)));
  return evidence.some(({ kind, payload }, index) => {
    if (index <= errorIndex) return false;
    if (kind === "component.io" && payload.component === "Tool" && payload.direction === "output") {
      return isDeepStrictEqual(payload.address, address);
    }
    const message = payload.output?.message?.value;
    return invocationAddresses.size === 1 && kind === "agent.event" && isDeepStrictEqual(payload.runPath, agentPath)
      && message?.role === "tool" && message.tool_call_id === tool.subId && message.tool_name === tool.id;
  });
}

/** Compare the first-screen result against source facts, not against another view. */
export function findRecorderSummaryIssues(scenario, record, summary) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, severity: "error", detail, affectedViews: ["run-summary"] });
  if (!summary) {
    add("summary.missing", "The accepted record has no run-level result summary.");
    return findings;
  }
  const ending = record.evidence.find(({ kind, payload }) => kind === "run.lifecycle" && payload.state === "ended");
  const interrupted = record.evidence.some(({ kind, payload }) => kind === "agent.event" && payload.action?.interrupted);
  const result = scenario.definitionOnly ? "definition-only" : ending?.payload.outcome === "unknown" && interrupted
    ? "interrupted" : ending?.payload.outcome ?? "unknown";
  if (summary.result?.state !== result) add("summary.result_mismatch", `Source outcome requires ${result}; summary reports ${summary.result?.state}.`);
  if (summary.capture?.status !== (ending?.payload.capture ?? "unknown")) {
    add("summary.capture_mismatch", "Execution result and capture completeness do not independently match the lifecycle evidence.");
  }
  if (scenario.nestedAgent) {
    const outputs = summary.output?.items ?? [];
    if (scenario.finalAnswer !== undefined) {
      if (outputs.length !== 1 || outputs[0].value !== scenario.finalAnswer) {
        add("agent.root_answer_mismatch", "The nested scenario must show the parent's final answer, not a child answer or intermediate tool result.");
      }
      for (const item of outputs) {
        const events = (item.evidenceEnvelopeIndexes ?? []).map((index) => record.evidence[index]).filter((entry) => entry?.kind === "agent.event");
        if (!events.length || events.some(({ payload }) => payload.runPath?.length !== 1 || payload.output?.message?.value?.content !== item.value)) {
          add("agent.root_answer_evidence_mismatch", "Final output must be backed by the root Agent's own final event.");
        }
      }
    } else if (outputs.length || summary.output?.availability !== "not-observed") {
      add("agent.failed_root_answer_invented", "This failed nested run has no final parent answer.");
    }
    for (const [index, source] of record.evidence.entries()) {
      if (source.kind !== "callback.event" || source.payload.phase !== "error") continue;
      const issue = summary.issues?.find((item) => item.evidenceEnvelopeIndexes?.includes(index));
      if (!issue || issue.message !== source.payload.error?.message || issue.scope !== "step" || !issue.nodeId) {
        add("agent.nested_error_missing", `Nested error at envelope ${index} must retain its source message and local owner.`);
      } else if (issue.recovered !== recordedLocalRecovery(record.evidence, index)) {
        add("agent.nested_error_recovery_mismatch", "Local recovery must match a later result at the same proven invocation; an ancestor's success is a separate fact.");
      }
    }
  }
  if (!["graph", "workflow"].includes(scenario.source)) return findings;
  const roots = record.evidence.map((envelope, index) => ({ envelope, index })).filter(({ envelope }) => isRootIO(envelope));
  for (const direction of ["input", "output"]) {
    const sources = roots.filter(({ envelope }) => envelope.payload.direction === direction);
    const items = summary[direction]?.items || [];
    const expected = new Map(sources.map(({ envelope, index }) => [index,
      sourceValue(envelope, index, envelope.payload.body, "/payload/body", record.diagnostics)]));
    const states = [...expected.values()].map(({ availability }) => availability);
    const captured = states.filter((availability) => availability !== "not-observed");
    const channelAvailability = !captured.length ? "not-observed" : captured.every((availability) => availability === "redacted")
      ? "redacted" : states.some((availability) => ["redacted", "truncated", "not-observed"].includes(availability)) ? "partial" : "available";
    if (summary[direction]?.availability !== channelAvailability) {
      add("summary.channel_availability_mismatch", `${direction}: source values require ${channelAvailability}; summary reports ${summary[direction]?.availability}.`);
    }
    for (const { envelope, index } of sources) {
      const matches = items.filter(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes?.includes(index));
      if (matches.length !== 1) {
        add("summary.root_io_missing_or_duplicated", `${direction} source at envelope ${index} has ${matches.length} summary items.`);
        continue;
      }
      const item = matches[0];
      const source = expected.get(index);
      if (Object.hasOwn(item, "value") !== source.hasValue || source.hasValue && !isDeepStrictEqual(item.value, source.value)) {
        add("summary.root_value_mismatch", `${direction} at envelope ${index} changed its JSON value or confused an absent body with null/empty.`);
      }
      if (item.availability !== source.availability) {
        add("summary.root_availability_mismatch", `${direction} at envelope ${index}: source=${source.availability}, summary=${item.availability}.`);
      }
      if (item.reason !== source.reason) {
        add("summary.root_omission_reason_missing", `${direction} at envelope ${index} lost its recorded omission reason.`);
      }
    }
    for (const item of items) {
      if (!item.evidenceEnvelopeIndexes?.some((index) => sources.some((source) => source.index === index))) {
        add("summary.unverified_root_value", `${direction} claims a root value without evidence for that root boundary.`);
      }
    }
    if (!sources.length && summary[direction]?.availability !== "not-observed") {
      add("summary.unrecorded_root_claimed", `${direction} is presented as captured although no root I/O was recorded.`);
    }
  }
  return findings;
}

/** Pure comparison helper, also tested with deliberately damaged projection copies. */
export function findRecorderDisplayIssues(scenario, record, document, trajectory) {
  const findings = [];
  const add = (code, severity, detail, affectedViews) => findings.push({ code, severity, detail, ...(affectedViews && { affectedViews }) });
  const nodes = document?.execution?.nodes || [];
  const sourceSnapshot = record.evidence.find((entry) => entry.kind === "workflow.snapshot")?.payload;
  const sourceOutcomes = sourceSnapshot?.execution?.nodes || [];
  const runtimePaths = new Set(sourceOutcomes.map(({ path }) => JSON.stringify(path)));
  const observedWorkflowPaths = new Set(sourceOutcomes.filter(({ status }) => status !== "skipped").map(({ path }) => JSON.stringify(path)));
  for (const envelope of record.evidence) {
    if (envelope.kind === "component.io" && Array.isArray(envelope.payload.nodePath)) {
      runtimePaths.add(JSON.stringify(envelope.payload.nodePath));
      observedWorkflowPaths.add(JSON.stringify(envelope.payload.nodePath));
    }
  }
  if (scenario.source === "workflow" && !scenario.definitionOnly) {
    for (const key of runtimePaths) {
      const matching = nodes.filter((node) => JSON.stringify(node.metadata?.sourceNodePath) === key);
      if (matching.length !== 1) {
        add("workflow.executed_step_missing_or_duplicated", "error", `${JSON.parse(key).join("/")} has runtime evidence but maps to ${matching.length} execution nodes.`);
      } else if (!matching[0].evidence.some(({ envelopeIndex }) => {
        const source = record.evidence[envelopeIndex];
        return (source?.kind === "component.io" && JSON.stringify(source.payload.nodePath) === key)
          || (source?.kind === "workflow.snapshot" && source.payload.execution?.nodes?.some(({ path }) => JSON.stringify(path) === key));
      })) {
        add("workflow.execution_evidence_missing", "error", `${JSON.parse(key).join("/")} has no linked execution evidence.`);
      }
    }
    for (const node of nodes) {
      const path = node.metadata?.sourceNodePath;
      if (!Array.isArray(path)) {
        add("workflow.source_path_missing", "error", `${node.id} cannot be matched to a source path.`);
        continue;
      }
      const key = JSON.stringify(path);
      if (!runtimePaths.has(key)) {
        add("workflow.unexecuted_step_projected", "error", `${path.join("/")} has no execution evidence but appears in ExecutionDAG as ${node.status}.`);
      }
      const outcome = sourceOutcomes.find((entry) => JSON.stringify(entry.path) === key);
      if (outcome && (outcome.status !== node.status || outcome.errorMessage !== node.errorMessage)) {
        add("workflow.outcome_mismatch", "error", `${path.join("/")} does not preserve its recorded status and error message.`);
      }
      for (const { envelopeIndex } of node.evidence) {
        const source = record.evidence[envelopeIndex];
        if (source?.kind === "component.io" && JSON.stringify(source.payload.nodePath) !== key) {
          add("workflow.io_path_mismatch", "error", `${path.join("/")} borrowed I/O at envelope ${envelopeIndex} from a different source path.`);
        }
      }
    }
    for (const [index, envelope] of record.evidence.entries()) {
      if (envelope.kind !== "component.io" || !envelope.payload.nodePath?.length) continue;
      const owners = nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      if (owners.length !== 1) add("workflow.io_step_missing_or_duplicated", "error", `Workflow I/O at envelope ${index} has ${owners.length} execution owners.`);
    }

    // Dependency is declared by the Workflow, not inferred from callback or
    // completion order. Preserve complete paths so nested same-name nodes can
    // never supply an edge for a different scope. Boundary/never-run nodes
    // remain in the definition but do not create execution dependencies.
    const expectedDependencies = new Map();
    const graphs = [{ graph: sourceSnapshot?.workflow, parentPath: [] }];
    while (graphs.length) {
      const { graph, parentPath } = graphs.pop();
      const declared = new Set((graph?.nodes || []).map(({ id }) => id));
      for (const edge of graph?.edges || []) {
        if (!declared.has(edge.from) || !declared.has(edge.to)) continue;
        const from = [...parentPath, edge.from], to = [...parentPath, edge.to];
        if (!observedWorkflowPaths.has(JSON.stringify(from)) || !observedWorkflowPaths.has(JSON.stringify(to))) continue;
        const kind = edge.channels?.includes("data") ? "data" : "control";
        expectedDependencies.set(JSON.stringify([from, to, kind]), `${JSON.stringify(from)} → ${JSON.stringify(to)} (${kind})`);
      }
      for (const node of graph?.nodes || []) {
        if (node.workflow) graphs.push({ graph: node.workflow, parentPath: [...parentPath, node.id] });
      }
    }
    const nodesById = new Map();
    for (const node of nodes) nodesById.set(node.id, [...(nodesById.get(node.id) || []), node]);
    const dependencyCounts = new Map();
    for (const edge of document?.execution?.edges || []) {
      const from = nodesById.get(edge.from), to = nodesById.get(edge.to);
      const fromPath = from?.length === 1 ? from[0].metadata?.sourceNodePath : undefined;
      const toPath = to?.length === 1 ? to[0].metadata?.sourceNodePath : undefined;
      const key = JSON.stringify([fromPath, toPath, edge.kind]);
      if (!Array.isArray(fromPath) || !Array.isArray(toPath) || !expectedDependencies.has(key)) {
        add("workflow.unverified_dependency", "error", `${edge.from} → ${edge.to} (${edge.kind}) has no matching declared dependency between observed source paths.`);
        continue;
      }
      dependencyCounts.set(key, (dependencyCounts.get(key) || 0) + 1);
    }
    for (const [key, label] of expectedDependencies) {
      const count = dependencyCounts.get(key) || 0;
      if (count !== 1) add("workflow.dependency_missing_or_duplicated", "error", `${label} maps to ${count} execution dependencies.`);
    }
  }
  if (scenario.source === "graph" && !scenario.definitionOnly && !record.evidence.some((entry) => entry.kind === "component.io")) {
    add("graph.io_not_captured", "limitation", "Callbacks record visits and errors, but do not capture node input/output bodies.");
  }
  if (scenario.source === "graph" && record.evidence.some((entry) => entry.kind === "callback.event")) {
    const visits = graphSourceVisits(record);
    for (const [index, envelope] of record.evidence.entries()) {
      if (envelope.kind !== "callback.event") continue;
      const owners = nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      if (owners.length !== 1) add("graph.callback_missing_or_duplicated", "error", `Callback at envelope ${index} has ${owners.length} execution owners.`);
    }
    for (const node of nodes) {
      const references = node.evidence.filter(({ envelopeIndex }) => record.evidence[envelopeIndex]?.kind === "callback.event");
      const starts = references.filter(({ envelopeIndex }) => record.evidence[envelopeIndex].payload.phase === "start");
      const visit = starts.length === 1 ? visits.find(({ start }) => start.index === starts[0].envelopeIndex) : undefined;
      if (!visit || node.correlation?.invocationId !== visit.invocationId
        || node.correlation?.entityId !== visit.start.envelope.correlation?.entityId) {
        add("graph.visit_identity_mismatch", "error", `${node.id} does not identify exactly one source callback visit.`);
        continue;
      }
      const expected = [visit.start, ...(visit.terminal ? [visit.terminal] : [])];
      if (references.length !== expected.length || references.some((ref) => !expected.some(({ index, envelope }) => index === ref.envelopeIndex
        && ref.kind === "callback.event" && ref.role === envelope.payload.phase))) {
        add("graph.visit_boundary_mismatch", "error", `${node.id} has callbacks from a different or incomplete invocation.`);
      }
      const phase = visit.terminal?.envelope.payload.phase;
      const status = phase === "end" ? "success" : phase === "error" ? "failed" : document?.completion?.state === "ended" ? "incomplete" : "running";
      if (node.status !== status || node.errorMessage !== (phase === "error" ? visit.terminal.envelope.payload.error?.message : undefined)) {
        add("graph.visit_outcome_mismatch", "error", `${node.id} does not preserve its own callback outcome and error.`);
      }
    }
  }
  if (scenario.source === "graph" && record.evidence.some((entry) => entry.kind === "component.io")) {
    const rootCallbacks = record.evidence.filter(({ kind, payload }) => kind === "callback.event"
      && payload.address?.length === 1 && payload.address[0].type === "runnable");
    for (const [direction, phase] of [["input", "start"], ["output", "end"]]) {
      if (rootCallbacks.some(({ payload }) => payload.phase === phase)
        && !record.evidence.some((entry) => isRootIO(entry) && entry.payload.direction === direction)) {
        add("graph.root_io_not_captured", "limitation", `The root ${direction} boundary was recorded but its body was not captured; node I/O is not a substitute.`);
      }
    }
    const omitted = record.evidence.filter(({ kind, metadata }) => kind === "component.io" && metadata?.capture?.status === "omitted");
    if (omitted.length) add("graph.io_body_omitted", "limitation", `${omitted.length} I/O bodies were intentionally omitted: ${[...new Set(omitted.map(({ metadata }) => metadata.capture.reason))].join(", ")}.`);
    for (const [index, envelope] of record.evidence.entries()) {
      if (envelope.kind !== "component.io") continue;
      if (!["node", "root"].includes(envelope.metadata?.io?.scope)) continue;
      const owners = nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      if (owners.length !== 1) {
        add("graph.io_step_missing_or_duplicated", "error", `Node I/O at envelope ${index} is linked to ${owners.length} execution steps.`);
        continue;
      }
      const eventID = envelope.correlation?.eventId;
      const callback = record.evidence.find((entry) => entry.kind === "callback.event" && entry.correlation?.eventId === eventID);
      const start = owners[0].evidence.map(({ envelopeIndex }) => record.evidence[envelopeIndex])
        .find((entry) => entry?.kind === "callback.event" && entry.payload.phase === "start");
      const phase = envelope.payload.direction === "input" ? "start" : "end";
      if (!eventID || !callback || callback.payload.phase !== phase
        || !isDeepStrictEqual(callback.payload.address, envelope.payload.address)
        || envelope.correlation?.invocationId !== start?.correlation?.eventId
        || !owners[0].evidence.some(({ envelopeIndex }) => record.evidence[envelopeIndex] === callback)) {
        add("graph.io_callback_mismatch", "error", `Node I/O at envelope ${index} is not linked to its exact callback boundary and invocation.`);
      }
    }
  }
  if (scenario.source === "agent" && document?.completion?.state === "ended") {
    const views = [{ name: "path", records: nodes }, { name: "trajectory", records: trajectory?.records || [] }];
    const callId = (item) => item.toolCallId || item.metadata?.toolCallId || item.correlation?.toolCallId;
    const unsettled = new Map();
    const cancelled = new Map();
    const remember = (map, key, view) => map.set(key, [...(map.get(key) || []), view]);
    // Group the same source defect across views without allowing a one-view fix
    // to clear the gate, or counting it twice as a separate product defect.
    for (const view of views) {
      for (const item of view.records) {
        if (item.status === "running") remember(unsettled, callId(item) || item.id, view.name);
        if (scenario.id === "agent-cancelled" && item.kind === "tool" && item.status === "failed") {
          remember(cancelled, callId(item) || item.id, view.name);
        }
      }
      for (const [envelopeIndex, envelope] of record.evidence.entries()) {
        if (envelope.kind !== "component.io" || envelope.payload.component !== "Tool" || envelope.payload.direction !== "input") continue;
        if (!view.records.some((item) => item.kind === "tool" && item.evidence.some((ref) => ref.envelopeIndex === envelopeIndex))) {
          add("agent.executed_tool_missing", "error", `Actual tool input at envelope ${envelopeIndex} is not linked to a tool in ${view.name}.`, [view.name]);
        }
      }
    }
    for (const [id, affectedViews] of unsettled) add("agent.unsettled_step_after_end", "error", `${id} remains running in an ended run; no terminal step result was captured.`, [...new Set(affectedViews)]);
    for (const [id, affectedViews] of cancelled) add("agent.cancel_misattributed_to_unexecuted_tool", "error", `${id} is marked failed by a run-level cancellation although the real Go test verifies zero tool invocations.`, [...new Set(affectedViews)]);
    // A fix may omit unexecuted tools from Path, but must not discard the
    // assistant's recorded plan from the more detailed Trajectory.
    if (scenario.id === "agent-cancelled") {
      for (const [envelopeIndex, envelope] of record.evidence.entries()) {
        if (envelope.kind !== "agent.event" || !envelope.payload.output?.message?.value?.tool_calls?.length) continue;
        if (!trajectory?.records.some((item) => item.kind === "assistant" && item.evidence.some((ref) => ref.envelopeIndex === envelopeIndex))) {
          add("agent.tool_plan_missing", "error", `The assistant's unexecuted tool plan at envelope ${envelopeIndex} is missing from Trajectory.`, ["trajectory"]);
        }
      }
    }
  }
  if (scenario.nestedAgent) {
    for (const view of [{ name: "path", records: nodes }, { name: "trajectory", records: trajectory?.records || [] }]) {
      for (const [index, envelope] of record.evidence.entries()) {
        if (envelope.kind === "callback.event" && envelope.payload.phase === "error" && envelope.payload.run?.component === "Tool") {
          const owners = view.records.filter((item) => item.kind === "tool" && item.evidence.some((ref) => ref.envelopeIndex === index));
          if (owners.length !== 1) {
            add("agent.scoped_error_missing_or_duplicated", "error", `Tool error at envelope ${index} has ${owners.length} owners in ${view.name}.`, [view.name]);
          } else {
            const inputs = owners[0].evidence.map((ref) => record.evidence[ref.envelopeIndex])
              .filter((entry) => entry?.kind === "component.io" && entry.payload.component === "Tool" && entry.payload.direction === "input");
            if (inputs.length !== 1 || !isDeepStrictEqual(inputs[0].payload.address, envelope.payload.address)) {
              add("agent.scoped_error_crossed", "error", `Tool error at envelope ${index} was attached to a different invocation in ${view.name}.`, [view.name]);
            }
            if (!recordedLocalRecovery(record.evidence, index) && owners[0].status !== "failed") {
              add("agent.failed_call_rewritten", "error", `Tool error at envelope ${index} has no same-invocation recovery but is ${owners[0].status} in ${view.name}.`, [view.name]);
            }
          }
        }
        if (envelope.kind !== "component.io" || envelope.payload.component !== "Tool") continue;
        const owners = view.records.filter((item) => item.kind === "tool" && item.evidence.some((ref) => ref.envelopeIndex === index));
        if (owners.length !== 1) {
          add("agent.scoped_tool_missing_or_duplicated", "error", `Tool I/O at envelope ${index} has ${owners.length} owners in ${view.name}.`, [view.name]);
          continue;
        }
        const toolIO = owners[0].evidence.map((ref) => record.evidence[ref.envelopeIndex])
          .filter((entry) => entry?.kind === "component.io" && entry.payload.component === "Tool");
        if (toolIO.some((entry) => !isDeepStrictEqual(entry.payload.address, envelope.payload.address))) {
          add("agent.scoped_tool_crossed", "error", `Tool I/O at envelope ${index} was mixed with another invocation address in ${view.name}.`, [view.name]);
        }
      }
    }
    if (scenario.id === "agent-nested-parallel-scopes") {
      add("agent.event_scope_unresolved", "limitation", "Parallel child AgentEvent runPath contains names but no invocation ID; ambiguous events remain outside confirmed call groups instead of being matched by order.");
    }
  }
  return findings;
}

/** Assess display fidelity separately from transport acceptance. No source facts are repaired. */
export function assessRecorderCase(scenario, record = loadRecorderMatrixRecord(scenario.id)) {
  const validation = validateEinoRunRecord(record);
  const projection = projectEinoViewerDocument(record);
  const trajectory = scenario.source === "agent" ? buildExecutionTrajectory(record.evidence) : undefined;
  const findings = findRecorderDisplayIssues(scenario, record, projection.document, trajectory?.trajectory);
  const explained = projection.document?.execution
    ? explainExecutionDAG(projection.document.execution, record.evidence, { diagnostics: record.diagnostics })
    : projection.document?.kind === "workflow"
      ? explainWorkflowSnapshot(projection.document.definition, { diagnostics: record.diagnostics })
      : projection.document?.kind === "graph" ? explainEino(projection.document.evidence, { diagnostics: record.diagnostics }) : undefined;
  const summary = explained?.explanation?.run;
  findings.push(...findRecorderSummaryIssues(scenario, record, summary));
  findings.push(...findRecorderStepIssues(scenario, record, projection.document, explained?.explanation));
  if (!validation.valid || !projection.ok || trajectory?.ok === false) {
    findings.unshift({ code: "projection.rejected", severity: "error", detail: "Recorder output was not accepted by every applicable projector." });
  }
  const execution = projection.document?.execution;
  const nodes = execution?.nodes || [];
  const sourceOutcomes = record.evidence.find((entry) => entry.kind === "workflow.snapshot")?.payload.execution?.nodes || [];
  const completion = projection.document?.completion;
  return {
    id: scenario.id,
    label: scenario.label,
    source: record.source,
    accepted: validation.valid && projection.ok && trajectory?.ok !== false,
    completion,
    runStatus: execution?.status ?? "definition-only",
    summaryState: summary?.result.state,
    inputAvailability: summary?.input.availability,
    outputAvailability: summary?.output.availability,
    evidenceCount: record.evidence.length,
    projectedStepCount: nodes.length,
    trajectoryRecordCount: trajectory?.ok ? trajectory.trajectory.records.length : 0,
    replayEligible: Boolean(trajectory?.ok && trajectory.trajectory.records.length && completion?.state === "ended"),
    callbackVisits: record.evidence.filter(({ kind, payload }) => kind === "callback.event" && payload.phase === "start" && payload.nodePath?.length).map(({ payload }) => payload.nodePath),
    workflowOutcomes: sourceOutcomes.map(({ path, status }) => ({ path, status })),
    diagnostics: [...new Set([...validation.diagnostics, ...projection.diagnostics, ...(trajectory?.diagnostics || [])].map(({ code }) => code))],
    findings,
  };
}

export function assessRecorderMatrix() {
  return recorderMatrix.map((scenario) => assessRecorderCase(scenario));
}
