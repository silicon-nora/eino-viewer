import { validateRunRecordV2 } from "./run-record-v2.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** V2 is projected directly. No v1 callback, message or lifecycle is invented. */
export function projectRunRecordV2Document(input, options = {}) {
  // A projected document can be passed back in, but only its original record
  // is authoritative. Derived nodes, summaries and relations are rebuilt.
  const candidate = Object.getOwnPropertyDescriptor(input || {}, "record")?.value;
  const sourceInput = candidate && Object.getOwnPropertyDescriptor(candidate, "schemaVersion")?.value === 2 ? candidate : input;
  const validation = validateRunRecordV2(sourceInput);
  const diagnostics = [
    ...(validation.errors || []).map((entry) => ({ ...entry, severity: "error" })),
    ...(validation.warnings || []).map((entry) => ({ ...entry, severity: "warning" })),
  ];
  if (!validation.ok) return freeze({ ok: false, diagnostics });
  const record = clone(sourceInput);
  const source = record.run.source;
  const kind = source === "application"
    ? record.definitions.some((definition) => definition.kind === "workflow") ? "workflow"
      : record.invocations.some((invocation) => invocation.kind === "agent") ? "agent" : "graph"
    : source;
  if (options.kind !== undefined && options.kind !== kind) return freeze({ ok: false, diagnostics: [{ severity: "error", code: "viewer.kind_mismatch", path: "root.options.kind", message: `RunRecord v2 has ${kind} reading semantics.` }] });
  if (options.runId !== undefined && options.runId !== record.run.id) return freeze({ ok: false, diagnostics: [{ severity: "error", code: "viewer.run_not_found", path: "root.options.runId", message: "RunRecord v2 belongs to another run." }] });
  const contentById = new Map(record.contents.map((entry) => [entry.id, entry]));
  const firstEvent = new Map();
  const eventsByOwner = new Map(), usageByOwner = new Map(), annotationsByOwner = new Map(), childrenByParent = new Map();
  const append = (index, key, entry) => { if (!index.has(key)) index.set(key, []); index.get(key).push(entry); };
  record.events.forEach((entry) => {
    if (entry.owner.kind === "invocation") {
      if (!firstEvent.has(entry.owner.id)) firstEvent.set(entry.owner.id, entry.sequence);
      append(eventsByOwner, entry.owner.id, entry);
    }
  });
  record.usage.forEach((entry) => append(usageByOwner, entry.invocationId, entry));
  record.annotations.forEach((entry) => { if (entry.owner.kind === "invocation") append(annotationsByOwner, entry.owner.id, entry); });
  record.invocations.forEach((entry) => { if (entry.parent.state === "known") append(childrenByParent, entry.parent.invocationId, entry.id); });
  const nodes = record.invocations.map((invocation, index) => ({
    ...invocation,
    input: invocation.inputRefs.map((id) => contentById.get(id)),
    output: invocation.outputRefs.map((id) => contentById.get(id)),
    events: eventsByOwner.get(invocation.id) || [],
    usage: usageByOwner.get(invocation.id) || [],
    annotations: annotationsByOwner.get(invocation.id) || [],
    children: childrenByParent.get(invocation.id) || [],
    readingOrder: firstEvent.get(invocation.id) ?? record.events.length + index,
  })).sort((left, right) => left.readingOrder - right.readingOrder);
  return freeze({ ok: true, diagnostics, document: {
    schemaVersion: 2, kind, record, run: record.run, nodes,
    definitions: record.definitions, events: record.events, relations: record.relations,
    contents: record.contents, usage: record.usage, annotations: record.annotations,
    ...(record.sourceRecords ? { sourceRecords: record.sourceRecords } : {}),
  } });
}

/** A view of original content availability, independent of display folding. */
export function contentReadingV2(content) {
  const data = content.data;
  return {
    id: content.id, role: content.role, availability: data.availability,
    completeness: content.completeness, provenance: content.provenance,
    redacted: content.transforms.some((entry) => entry.kind === "redacted"),
    truncated: content.transforms.some((entry) => entry.kind === "truncated"),
    ...(data.availability === "inline" ? { value: data.value }
      : data.availability === "missing" ? { reason: data.reason }
        : { key: data.key, sha256: data.sha256, byteLength: data.byteLength }),
  };
}

/** Original times remain visible; duration is never synthesized from event order. */
export function timingReadingV2(timing) {
  const reversed = timing.startedAtMs !== undefined && timing.endedAtMs !== undefined && timing.endedAtMs < timing.startedAtMs;
  return { ...timing, clockReversed: reversed,
    availability: timing.durationMs !== undefined ? "available" : "not-observed" };
}

export function invocationScopeV2(document, id) {
  if (id === null) return new Set(document.nodes.map((node) => node.id));
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  if (!byId.has(id)) return undefined;
  const result = new Set(), pending = [id];
  while (pending.length) {
    const next = pending.pop();
    if (result.has(next)) continue;
    result.add(next);
    pending.push(...(byId.get(next)?.children || []));
  }
  return result;
}

export function explainRunRecordV2(document) {
  const root = document.nodes.find((node) => node.id === document.run.rootInvocationId);
  return freeze({ schemaVersion: 2, run: {
    id: document.run.id, mode: document.run.mode, status: document.run.status,
    timing: timingReadingV2(document.run.timing), capture: document.run.capture,
    input: (root?.input || []).map(contentReadingV2), output: (root?.output || []).map(contentReadingV2),
    ...(root?.error ? { error: root.error } : {}),
  }, nodes: document.nodes.map((node) => ({ ...node, timing: timingReadingV2(node.timing),
    input: node.input.map(contentReadingV2), output: node.output.map(contentReadingV2) })),
  relations: document.relations });
}
