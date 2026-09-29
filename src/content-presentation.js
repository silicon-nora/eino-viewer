import { parseRecordJSON } from "./record-input.js";

// Private reading helpers. Only known envelope schemas receive message handling;
// arbitrary business objects retain their keys, values and nesting.
export function recordedValueText(value) {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

// limit counts Unicode code points INCLUDING the ellipsis. Short text is
// returned unchanged; truncation inspects at most limit + 1 code points and
// never splits a valid UTF-16 surrogate pair. This is not grapheme segmentation.
export function previewRecordedText(text, limit) {
  if (typeof text !== "string") throw new TypeError("Expected recorded text.");
  if (!Number.isSafeInteger(limit)) throw new RangeError("Expected a safe integer preview limit.");
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  let count = 0;
  let prefixEnd = 0;
  for (const character of text) {
    if (count === limit) return `${text.slice(0, prefixEnd)}…`;
    if (count < limit - 1) prefixEnd += character.length;
    count += 1;
  }
  return text;
}

export function compactRecordedValue(value, limit = 110) {
  const text = recordedValueText(value);
  if (text === undefined) return undefined;
  if (text === "") return '""';
  const compact = text.replace(/\s+/g, " ").trim();
  const preview = previewRecordedText(compact, limit);
  return preview === compact ? preview : preview.replace(/\s+…$/u, "…");
}

export function envelopeMessage(envelope) {
  if (["schema.message", "schema.agentic_message"].includes(envelope?.kind)) return envelope.payload;
  if (envelope?.kind === "agent.event") return envelope.payload?.output?.message?.value;
  return undefined;
}

export function messageReadingValue(message) {
  if (!message || typeof message !== "object") return undefined;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    const calls = message.tool_calls.map((call) => {
      const value = { name: call.function?.name ?? call.name };
      const args = call.function?.arguments ?? call.arguments;
      if (args !== undefined) {
        // arguments is a schema-defined JSON string, unlike arbitrary bodies.
        try { value.arguments = typeof args === "string" ? parseRecordJSON(args) : args; }
        catch { value.arguments = args; }
      }
      return value;
    });
    return message.content !== undefined && message.content !== ""
      ? { content: message.content, tool_calls: calls } : calls;
  }
  return message.content;
}

export function preferredRecordedItem(channel, direction, envelopeAt) {
  const score = (item) => Math.max(0, ...(item.evidenceEnvelopeIndexes || []).map((index) => {
    const envelope = envelopeAt(index);
    const message = envelopeMessage(envelope);
    if (direction === "input") {
      if (["schema.message", "schema.agentic_message"].includes(envelope?.kind) && ["user", "system"].includes(message?.role)) return 100;
      if (envelope?.kind === "agent.event" && message?.tool_calls?.length) return 90;
      if (envelope?.kind === "component.io" && envelope.payload?.direction === "input") return 80;
    } else {
      if (["schema.message", "schema.agentic_message"].includes(envelope?.kind) && message?.role === "assistant") return 100;
      if (envelope?.kind === "agent.event" && message?.role === "tool") return 90;
      if (envelope?.kind === "agent.event" && message?.role === "assistant") return 85;
      if (envelope?.kind === "component.io" && envelope.payload?.direction === "output") return 80;
    }
    return 0;
  }));
  return (channel?.items || []).reduce((best, item) => !best || score(item) > score(best) ? item : best, undefined);
}

export function channelReadingValue(item, direction, envelopeAt) {
  if (!item || item.availability === "not-observed") return undefined;
  for (const index of item.evidenceEnvelopeIndexes || []) {
    const envelope = envelopeAt(index);
    if (["schema.message", "schema.agentic_message"].includes(envelope?.kind)) return messageReadingValue(envelopeMessage(envelope));
    if (direction === "output" && envelope?.kind === "agent.event" && ["assistant", "tool"].includes(envelopeMessage(envelope)?.role)) {
      return messageReadingValue(envelopeMessage(envelope));
    }
  }
  return item.value;
}

// Capture flags describe the recorded body, not arbitrary nearby metadata.
// Diagnostics must identify both the source envelope and this exact body path.
export function recordedBodyCapture(envelope, envelopeIndex, diagnostics = [], bodyPath = "/payload/body") {
  const capture = envelope?.metadata?.capture || {};
  const flags = Number.isSafeInteger(envelopeIndex) ? diagnostics.filter((entry) => entry.envelopeIndex === envelopeIndex
    && typeof entry.path === "string" && (entry.path === bodyPath || entry.path.startsWith(`${bodyPath}/`))) : [];
  return { ...capture,
    redacted: capture.redacted === true || flags.some(({ code }) => code === "projection.redacted"),
    truncated: capture.truncated === true || flags.some(({ code }) => code === "projection.truncated"),
  };
}

export function recordedValueAvailability(value, capture = {}) {
  if (capture.status === "omitted" || value === undefined) return "not-observed";
  if (capture.redacted === true) return "redacted";
  if (capture.truncated === true) return "truncated";
  return value === null ? "null" : value === "" ? "empty" : "available";
}

function errorSource(envelope) {
  return (envelope?.kind === "callback.event" && envelope.payload?.phase === "error" || envelope?.kind === "agent.event")
    && envelope.payload?.error !== undefined;
}

// Issues can quote one of several sources. Capture belongs only to an exact
// referenced error, never another envelope with the same message. Conflicting
// capture descriptions cannot establish one readable value, so keep only the
// matching provenance rather than choose a source or restore an omitted value.
export function recordedIssueValue(issue, envelopeAt, diagnostics = []) {
  const indexes = [...new Set((issue?.evidenceEnvelopeIndexes || []).filter((index) => Number.isSafeInteger(index) && index >= 0))];
  const value = issue?.message;
  const fallback = { ...(value !== undefined ? { value } : {}), availability: recordedValueAvailability(value), evidenceEnvelopeIndexes: indexes };
  if (issue?.kind !== undefined && issue.kind !== "error" || typeof value !== "string") return fallback;
  const sources = indexes.flatMap((index) => {
    const envelope = envelopeAt(index);
    if (!errorSource(envelope) || envelope.payload.error?.message !== value) return [];
    const capture = recordedBodyCapture(envelope, index, diagnostics, "/payload/error");
    const omitted = capture.status === "omitted";
    return [{ index, availability: recordedValueAvailability(value, capture),
      ...(omitted ? { reason: capture.reason || "not_captured" } : {}) }];
  });
  if (!sources.length) return fallback;
  const evidenceEnvelopeIndexes = sources.map(({ index }) => index);
  const { availability, reason } = sources[0];
  if (sources.some((source) => source.availability !== availability || source.reason !== reason)) {
    return { availability: "not-observed", evidenceEnvelopeIndexes };
  }
  return { ...(availability !== "not-observed" ? { value } : {}), availability,
    ...(reason !== undefined ? { reason } : {}), evidenceEnvelopeIndexes };
}

// An error on an envelope does not make every value in it an error. In
// particular, a Tool message can carry an independent fallback business result.
export function isRecordedErrorItem(node, item, envelopeAt) {
  const indexes = item.evidenceEnvelopeIndexes || [];
  if (!indexes.length) return false;
  return indexes.every((index) => {
    const envelope = envelopeAt(index);
    if (node?.kind === "tool" && envelope?.kind === "agent.event" && envelopeMessage(envelope)?.role === "tool") return false;
    if (node?.evidence?.some((entry) => entry.envelopeIndex === index && entry.role === "error")
      && errorSource(envelope)) {
      if (Object.hasOwn(item, "value")) return JSON.stringify(item.value) === JSON.stringify(envelope.payload.error);
      return item.availability === "not-observed" && envelope.metadata?.capture?.status === "omitted";
    }
    if (!Object.hasOwn(item, "value") || node?.kind !== "workflow" || envelope?.kind !== "workflow.snapshot") return false;
    const path = node.technical?.metadata?.sourceNodePath || node.path;
    const outcome = envelope.payload.execution?.nodes?.find((entry) => JSON.stringify(entry.path) === JSON.stringify(path));
    return typeof outcome?.errorMessage === "string" && item.value === outcome.errorMessage;
  });
}
