import assert from "node:assert/strict";
import { recordedValueText, previewRecordedText, compactRecordedValue, envelopeMessage, messageReadingValue, preferredRecordedItem, channelReadingValue, recordedBodyCapture, recordedValueAvailability, recordedIssueValue, isRecordedErrorItem } from "../src/content-presentation.js";

for (const [value, expected] of [[undefined, undefined], [null, "null"], ["", ""], [false, "false"], [0, "0"], ["literal", "literal"]]) {
  assert.equal(recordedValueText(value), expected);
}
assert.equal(compactRecordedValue(""), '""');
assert.equal(compactRecordedValue(undefined), undefined);
assert.equal(compactRecordedValue(null), "null");
for (const [text, limit, expected] of [
  ["", 0, ""], ["", 4, ""], ["short", 5, "short"], ["short", 6, "short"],
  ["long", 0, ""], ["long", -1, ""], ["long", 1, "…"], ["long", 4, "long"], ["longer", 4, "lon…"],
  ["中文结果", 4, "中文结果"], ["中文结果", 3, "中文…"],
  ["😀", 1, "😀"], ["😀😀", 1, "…"], ["😀😀", 2, "😀😀"], ["😀中文", 2, "😀…"],
  ["  text\n", 20, "  text\n"], ["a  b", 3, "a …"],
  ["a".repeat(359) + "😀" + "tail", 361, "a".repeat(359) + "😀…"],
]) {
  const preview = previewRecordedText(text, limit);
  assert.equal(preview, expected, `preview ${JSON.stringify(text)} at ${limit}`);
  assert.ok([...preview].length <= Math.max(0, limit), "preview budget includes the ellipsis");
  assert.doesNotMatch(preview, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u, "well-formed input never acquires an unpaired surrogate");
}
assert.throws(() => previewRecordedText(undefined, 3), TypeError);
for (const limit of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => previewRecordedText("text", limit), RangeError);
assert.equal(compactRecordedValue("a".repeat(108) + "😀" + "tail"), "a".repeat(108) + "😀…");
assert.equal(compactRecordedValue("😀".repeat(110)), "😀".repeat(110), "a short code-point value is not folded because of UTF-16 width");
assert.equal(compactRecordedValue("  first\n\tsecond  "), "first second", "ordinary compact whitespace behavior is unchanged");
assert.equal(compactRecordedValue("abc def", 5), "abc…", "compact truncation still trims a space immediately before the ellipsis");

{
  const large = "😀".repeat(1_000_000);
  const originalIterator = String.prototype[Symbol.iterator];
  let reads = 0;
  let preview;
  try {
    String.prototype[Symbol.iterator] = function () {
      const iterator = originalIterator.call(this);
      if (String(this) !== large) return iterator;
      return {
        next() {
          reads += 1;
          assert.ok(reads <= 6, "a five-code-point preview must not traverse the complete large value");
          return iterator.next();
        },
        [Symbol.iterator]() { return this; },
      };
    };
    preview = previewRecordedText(large, 5);
  } finally {
    String.prototype[Symbol.iterator] = originalIterator;
  }
  assert.equal(preview, "😀😀😀😀…");
  assert.equal(reads, 6, "only the budget plus one lookahead code point is inspected");
  assert.equal(recordedValueText(large), large, "previewing never changes the full recorded value");
}
const business = { response: { content: "answer", extra: 3 }, condition: "ready", temperatureC: 19, messages: [{ role: "system", content: "business data" }] };
const before = structuredClone(business);
assert.equal(recordedValueText(business), JSON.stringify(business, null, 2));
assert.match(compactRecordedValue(business, 1000), /"response".*"content".*"extra".*"condition".*"temperatureC".*"messages"/);
assert.equal(recordedValueText('{"response":"literal JSON string"}'), '{"response":"literal JSON string"}');
assert.deepEqual(business, before);
assert.equal(envelopeMessage({ kind: "component.io", payload: { body: { role: "assistant", content: "not a message" } } }), undefined);

const message = { role: "assistant", content: "", tool_calls: [{ id: "private-call-id", function: { name: "lookup_item", arguments: '{"key":"one"}' } }] };
const messageBefore = structuredClone(message);
assert.deepEqual(messageReadingValue(message), [{ name: "lookup_item", arguments: { key: "one" } }]);
assert.deepEqual(messageReadingValue({ ...message, content: "Planning" }), { content: "Planning", tool_calls: [{ name: "lookup_item", arguments: { key: "one" } }] });
for (const value of [null, "", false, 0, undefined]) assert.equal(messageReadingValue({ role: "assistant", content: value }), value);
assert.deepEqual(message, messageBefore);
for (const argumentsText of ['{"id":9007199254740993}', '{"decimal":0.1234567890123456789}', '{"underflow":1e-9999}']) {
  const protectedMessage = { role: "assistant", content: "", tool_calls: [{ function: { name: "lookup_item", arguments: argumentsText } }] };
  assert.equal(messageReadingValue(protectedMessage)[0].arguments, argumentsText, "unsafe embedded numeric text remains its exact original string");
}

const envelopes = [
  { kind: "component.io", payload: { direction: "output", body: business } },
  { kind: "agent.event", payload: { output: { message: { value: { role: "tool", content: "observed tool result" } } } } },
  { kind: "schema.message", payload: { role: "user", content: "user question" } },
  { kind: "agent.event", payload: { output: { message: { value: message } } } },
];
const envelopeAt = (index) => envelopes[index];
const component = { label: "Final message 工具结果", value: business, evidenceEnvelopeIndexes: [0] };
const tool = { label: "wrong localized label", value: "observed tool result", evidenceEnvelopeIndexes: [1] };
assert.equal(preferredRecordedItem({ items: [component, tool] }, "output", envelopeAt), tool);
assert.equal(preferredRecordedItem({ items: [{ ...component, label: "" }, { ...tool, label: "" }] }, "output", envelopeAt).value, tool.value);
assert.deepEqual(channelReadingValue(component, "output", envelopeAt), business);
assert.equal(channelReadingValue({ value: envelopes[2].payload, evidenceEnvelopeIndexes: [2] }, "input", envelopeAt), "user question");
assert.deepEqual(channelReadingValue({ value: "", evidenceEnvelopeIndexes: [3] }, "output", envelopeAt), [{ name: "lookup_item", arguments: { key: "one" } }]);
assert.equal(channelReadingValue({ value: "do not restore", availability: "not-observed", evidenceEnvelopeIndexes: [2] }, "input", envelopeAt), undefined);
for (const content of ["null", "false", "0", '{"response":"do not parse"}', ""]) {
  const envelope = { kind: "agent.event", payload: { output: { message: { value: { role: "tool", content } } } } };
  assert.equal(channelReadingValue({ value: null, evidenceEnvelopeIndexes: [0] }, "output", () => envelope), content);
  assert.equal(typeof channelReadingValue({ value: null, evidenceEnvelopeIndexes: [0] }, "output", () => envelope), "string");
}
console.log("OK content presentation preserves recorded values and selects by source semantics");

{
  const source = { metadata: { capture: { status: "captured", truncated: true } } };
  const snapshot = structuredClone(source);
  const diagnostic = { envelopeIndex: 4, code: "projection.redacted", path: "/payload/body/result" };
  assert.equal(recordedValueAvailability("partial", recordedBodyCapture(source, 4)), "truncated");
  assert.equal(recordedValueAvailability("replacement", recordedBodyCapture(source, 4, [diagnostic])), "redacted");
  for (const change of [{ envelopeIndex: 3 }, { envelopeIndex: undefined }, { path: "/payload/name" }, { path: "/payload/bodyName" }, { path: "/payload/bodyguard/result" }]) {
    assert.equal(recordedValueAvailability("partial", recordedBodyCapture(source, 4, [{ ...diagnostic, ...change }])), "truncated", "unrelated diagnostics never mark a body");
  }
  assert.equal(recordedValueAvailability("answer", recordedBodyCapture({}, 4, [{ ...diagnostic, code: "projection.truncated", path: "/payload/content" }], "/payload/content")), "truncated");
  assert.equal(recordedValueAvailability(undefined, { redacted: true, truncated: true }), "not-observed");
  assert.equal(recordedValueAvailability("must stay hidden", { status: "omitted", redacted: true }), "not-observed");
  for (const [value, expected] of [[null, "null"], ["", "empty"], [false, "available"], [0, "available"]]) assert.equal(recordedValueAvailability(value), expected);
  assert.deepEqual(source, snapshot);
}

{
  const error = { message: "provider unavailable" };
  const mixed = { kind: "agent.event", payload: { error, output: { message: { value: { role: "tool", content: JSON.stringify(error) } } } } };
  const node = { kind: "tool", evidence: [{ envelopeIndex: 0, role: "error" }] };
  // Even an identical parsed value is an independent business Tool result.
  assert.equal(isRecordedErrorItem(node, { value: error, evidenceEnvelopeIndexes: [0] }, () => mixed), false);
  const errorOnly = { kind: "agent.event", payload: { error } };
  assert.equal(isRecordedErrorItem(node, { value: { ...error }, evidenceEnvelopeIndexes: [0] }, () => errorOnly), true);
  assert.equal(isRecordedErrorItem(node, { value: { ...error, detail: "business value" }, evidenceEnvelopeIndexes: [0] }, () => errorOnly), false);
  assert.equal(isRecordedErrorItem(node, { value: error, evidenceEnvelopeIndexes: [] }, () => errorOnly), false);
  assert.equal(isRecordedErrorItem(node, { value: error, evidenceEnvelopeIndexes: [0, 1] }, (index) => index === 0 ? errorOnly : mixed), false);
  const snapshot = { kind: "workflow.snapshot", payload: { execution: { nodes: [{ path: ["left", "same"], errorMessage: "left error" }, { path: ["right", "same"], errorMessage: "right error" }] } } };
  const workflow = { kind: "workflow", path: ["same"], technical: { metadata: { sourceNodePath: ["left", "same"] } } };
  assert.equal(isRecordedErrorItem(workflow, { value: "left error", evidenceEnvelopeIndexes: [0] }, () => snapshot), true);
  assert.equal(isRecordedErrorItem(workflow, { value: "right error", evidenceEnvelopeIndexes: [0] }, () => snapshot), false);
}
console.log("OK shared capture and error semantics keep independent business values and exact source identity");

{
  const error = { message: "exact recorded error" };
  const envelope = (capture = {}, kind = "callback.event") => ({ kind, payload: { phase: "error", error }, metadata: { capture } });
  const issue = { kind: "error", message: error.message, evidenceEnvelopeIndexes: [4] };
  for (const kind of ["callback.event", "agent.event"]) {
    for (const [capture, availability] of [
      [{}, "available"], [{ redacted: true }, "redacted"], [{ truncated: true }, "truncated"],
      [{ redacted: true, truncated: true }, "redacted"], [{ redacted: "true", truncated: 1 }, "available"],
      [{ status: "omitted", reason: "size_limit", redacted: true }, "not-observed"], [{ status: "omitted" }, "not-observed"],
    ]) {
      const source = envelope(capture, kind), original = JSON.stringify({ source, issue });
      const value = recordedIssueValue(issue, (index) => index === 4 ? source : undefined);
      assert.equal(value.availability, availability);
      assert.deepEqual(value.evidenceEnvelopeIndexes, [4]);
      assert.equal(Object.hasOwn(value, "value"), availability !== "not-observed");
      if (availability !== "not-observed") assert.equal(value.value, error.message, "flags annotate the exact source text without replacement");
      else assert.equal(value.reason, capture.reason || "not_captured");
      assert.equal(JSON.stringify({ source, issue }), original, "omitted placeholders remain untouched in Raw");
    }
  }
  const diagnostic = { envelopeIndex: 4, code: "projection.redacted", path: "/payload/error/message" };
  const at = (index) => index === 4 ? envelope() : undefined;
  for (const path of ["/payload/error", "/payload/error/message", "/payload/error/details/secret"]) {
    assert.equal(recordedIssueValue(issue, at, [{ ...diagnostic, path }]).availability, "redacted");
  }
  assert.equal(recordedIssueValue(issue, at, [{ ...diagnostic, code: "projection.truncated" }]).availability, "truncated");
  for (const change of [
    { envelopeIndex: 3 }, { envelopeIndex: undefined }, { envelopeIndex: "4" },
    { path: "/payload/body" }, { path: "/payload/errorMessage" }, { path: "/payload/errors/message" },
    { path: "/metadata/capture" }, { path: "/payload/name" }, { code: "projection.other" },
  ]) assert.equal(recordedIssueValue(issue, at, [{ ...diagnostic, ...change }]).availability, "available", "diagnostics need this envelope and the exact error subtree");

  const truncated = envelope({ truncated: true });
  const unrelated = envelope({ status: "omitted" });
  assert.equal(recordedIssueValue(issue, (index) => index === 4 ? truncated : unrelated).availability, "truncated", "unreferenced identical messages do not change capture");
  assert.equal(recordedIssueValue({ ...issue, message: `${error.message}!` }, () => unrelated).availability, "available", "even near-identical messages cannot borrow capture");
  assert.equal(recordedIssueValue({ ...issue, evidenceEnvelopeIndexes: [] }, () => unrelated).availability, "available");
  assert.equal(recordedIssueValue({ ...issue, evidenceEnvelopeIndexes: [-1, "4", NaN] }, () => unrelated).availability, "available");
  assert.equal(recordedIssueValue({ ...issue, kind: "interruption" }, () => unrelated).availability, "available", "an interruption reason is not an error payload");
  for (const source of [
    { ...unrelated, kind: "component.io" }, { ...unrelated, kind: "workflow.snapshot" },
    { ...unrelated, payload: { phase: "end", error } },
  ]) assert.equal(recordedIssueValue(issue, () => source).availability, "available", "nearby or snapshot-wide capture is not per-error provenance");

  const multiple = { ...issue, evidenceEnvelopeIndexes: [4, 5, 4, 6] };
  const sources = new Map([[4, envelope({ truncated: true })], [5, envelope({ truncated: true }, "agent.event")],
    [6, { ...unrelated, payload: { phase: "error", error: { message: "different error" } } }]]);
  assert.deepEqual(recordedIssueValue(multiple, (index) => sources.get(index)), {
    value: error.message, availability: "truncated", evidenceEnvelopeIndexes: [4, 5],
  }, "consistent matching sources retain exact provenance without unrelated references or duplicates");
  sources.set(5, envelope({ status: "omitted", reason: "size_limit" }));
  assert.deepEqual(recordedIssueValue(multiple, (index) => sources.get(index)), {
    availability: "not-observed", evidenceEnvelopeIndexes: [4, 5],
  }, "conflicting capture never chooses the readable source or fabricates an omission reason");
  sources.set(4, envelope({ status: "omitted", reason: "size_limit" }));
  assert.deepEqual(recordedIssueValue(multiple, (index) => sources.get(index)), {
    availability: "not-observed", reason: "size_limit", evidenceEnvelopeIndexes: [4, 5],
  });
  sources.set(5, envelope({ status: "omitted", reason: "unsupported_value" }));
  assert.equal(recordedIssueValue(multiple, (index) => sources.get(index)).reason, undefined, "conflicting omission reasons are not arbitrarily selected");
  assert.deepEqual(recordedIssueValue({ message: "", evidenceEnvelopeIndexes: [4] }, () => envelope()), {
    value: "", availability: "empty", evidenceEnvelopeIndexes: [4],
  }, "fallback values keep their original empty-string semantics");
}
{
  const omitted = { kind: "callback.event", payload: { phase: "error", error: { message: "placeholder stays in Raw" } }, metadata: { capture: { status: "omitted", reason: "size_limit" } } };
  const node = { kind: "callback", evidence: [{ envelopeIndex: 4, role: "error" }] };
  const item = { availability: "not-observed", reason: "size_limit", evidenceEnvelopeIndexes: [4] };
  assert.equal(isRecordedErrorItem(node, item, () => omitted), true, "an omitted error remains an error item even without a value");
  assert.equal(isRecordedErrorItem(node, { ...item, evidenceEnvelopeIndexes: [] }, () => omitted), false);
  assert.equal(isRecordedErrorItem({ ...node, evidence: [{ envelopeIndex: 4, role: "output" }] }, item, () => omitted), false);
  assert.equal(isRecordedErrorItem(node, { ...item, availability: "available" }, () => omitted), false);
  assert.equal(isRecordedErrorItem(node, item, () => ({ ...omitted, metadata: { capture: { redacted: true } } })), false);
  assert.equal(isRecordedErrorItem(node, item, () => ({ ...omitted, payload: { phase: "end", error: omitted.payload.error } })), false);
  const fallback = { ...omitted, kind: "agent.event", payload: { error: omitted.payload.error, output: { message: { value: { role: "tool", content: "independent fallback" } } } } };
  assert.equal(isRecordedErrorItem({ ...node, kind: "tool" }, item, () => fallback), false, "omitted metadata cannot turn a Tool business result into an error");
  assert.equal(isRecordedErrorItem(node, { ...item, evidenceEnvelopeIndexes: [4, 5] }, (index) => index === 4 ? omitted : fallback), false, "every item reference must prove the same error role");
}
console.log("OK error capture follows exact issue provenance, preserves Raw, and suppresses conflicting or omitted placeholders");
