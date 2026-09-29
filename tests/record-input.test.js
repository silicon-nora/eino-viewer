import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSON_INPUT_LIMITS } from "../src/json-value.js";
import { assertRecordFileSize, parseRecordJSON, inputFailureSummary } from "../src/record-input.js";

function rejects(text, code) {
  assert.throws(() => parseRecordJSON(text), (error) => {
    assert.ok(error instanceof TypeError, "input failures have a stable error type");
    assert.equal(error.code, code);
    assert.ok(Array.isArray(error.diagnostics) && error.diagnostics.length > 0);
    assert.equal(error.diagnostics[0].code, code);
    assert.equal(error.diagnostics[0].severity, "error");
    assert.equal(typeof error.diagnostics[0].path, "string");
    return true;
  });
}

assert.equal(inputFailureSummary([{ code: "viewer.unsafe_integer" }], "zh", true), "整数超出精确范围；当前结果已保留。");
assert.equal(inputFailureSummary([{ code: "max_depth_exceeded" }], "en"), "Record is nested too deeply; the record was not opened.");
assert.equal(inputFailureSummary([{ code: "invalid_json" }], "zh", true), undefined);

{
  const path = new URL("../fixtures/input-boundaries/graph-safe-integers.json", import.meta.url);
  const text = readFileSync(path, "utf8");
  const record = parseRecordJSON(text);
  assert.equal(record.source, "graph");
  assert.equal(record.runId, "run-graph-safe-integers");
  const bodies = record.evidence.filter((entry) => entry.kind === "component.io");
  assert.equal(bodies.length, 4, "real Recorder includes root/node input/output");
  assert.deepEqual(bodies.map((entry) => `${entry.metadata.io.scope}/${entry.payload.direction}`), [
    "root/input", "node/input", "node/output", "root/output",
  ]);
  for (const { payload } of bodies) {
    assert.deepEqual(payload.body, {
      signedMax: Number.MAX_SAFE_INTEGER,
      signedMaxText: "9223372036854775807",
      signedMin: Number.MIN_SAFE_INTEGER,
      signedMinText: "-9223372036854775808",
      unsignedMax: Number.MAX_SAFE_INTEGER,
      unsignedText: "18446744073709551615",
      zero: 0,
    });
  }
}

{
  const path = new URL("../fixtures/input-boundaries/graph-unsafe-integers.json", import.meta.url);
  const text = readFileSync(path, "utf8");
  for (const token of ["9007199254740993", "-9007199254740993", "9223372036854775807", "-9223372036854775808", "18446744073709551615"]) {
    assert.ok(text.includes(`: ${token},`), `real Recorder retains original numeric token ${token}`);
  }
  rejects(text, "unsafe_integer");
}
console.log("OK real Go Recorder JSON retains safe numeric values and text, and rejects unsafe integer tokens");

for (const [text, expected] of [
  ["0", 0], ["0.0", 0], ["0e-999", 0], ["1", 1], ["-12", -12],
  ["0.1", 0.1], ["1.2300", 1.23], ["1.2300e+2", 123], ["123.000e-2", 1.23],
  ["1E+0003", 1000], ["0.0000010", 0.000001], ["1.2345e-3", 0.0012345],
  ["-9.999e-7", -9.999e-7], ["5e-324", 5e-324],
  ["9007199254740991.0", Number.MAX_SAFE_INTEGER],
  ["90071992547409910e-1", Number.MAX_SAFE_INTEGER],
  ["-9.007199254740991e15", Number.MIN_SAFE_INTEGER],
]) {
  assert.equal(parseRecordJSON(text), expected, text);
  assert.deepEqual(parseRecordJSON(` { "value": ${text}, "nested": [true, null, ""] } `), {
    value: expected, nested: [true, null, ""],
  });
}
assert.ok(Object.is(parseRecordJSON("-0"), -0), "JSON's negative zero survives parsing");
for (const text of [
  "9007199254740992", "-9007199254740992", "9007199254740993", "-9007199254740993",
  "9007199254740993.0", "-9007199254740993.000", "9.007199254740993e15",
  "-9.007199254740993E+15", "900719925474099300e-2", "18446744073709551615",
]) {
  rejects(text, "unsafe_integer");
  rejects(`{"nested":[${text}]}`, "unsafe_integer");
}
for (const text of ["1.00000000000000001", "1e-999", "-1e-999", "0.100000000000000001", "9007199254740991.1"]) {
  rejects(text, "number_precision_loss");
  rejects(`{"value":${text}}`, "number_precision_loss");
}
for (const text of ["1e309", "-1e309", "1e999999"]) rejects(text, "non_json_number");
console.log("OK decimal and exponent equivalence is accepted without hiding unsafe integers or discarded precision");

{
  const strings = {
    numeric: "18446744073709551615 -9007199254740993 1e999 1e-999 1.00000000000000001",
    brackets: "[".repeat(8000) + "{".repeat(8000),
    escaped: 'quoted "9007199254740993" and "[[["; slash \\; escaped quote \\"; newline\n',
    unicode: "数字文本：9007199254740993 🧾",
    "9007199254740993": "numeric object key is not a number token",
  };
  assert.deepEqual(parseRecordJSON(JSON.stringify(strings)), strings);
  assert.equal(parseRecordJSON('"\\u0039\\u0030\\u0030\\u0037\\u0031\\u0039\\u0039\\u0032\\u0035\\u0034\\u0037\\u0034\\u0030\\u0039\\u0039\\u0033"'), "9007199254740993");
  rejects(`${JSON.stringify(strings).slice(0, -1)},"actualNumber":9007199254740993}`, "unsafe_integer");
}

{
  const text = '{"__proto__":{"polluted":"source data"},"constructor":{"prototype":{"safe":true}},"prototype":"literal"}';
  const parsed = parseRecordJSON(text);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, "__proto__"), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(parsed, "__proto__").value, { polluted: "source data" });
  assert.deepEqual(parsed.constructor, { prototype: { safe: true } });
  assert.equal(parsed.prototype, "literal");
  assert.equal(({}).polluted, undefined);
  assert.equal(JSON.stringify(parsed), text, "special property names remain ordinary source data");
}
console.log("OK quoted numbers, escaped strings and prototype-looking property names remain ordinary JSON data");

for (const text of [
  "", " ", "{", "[", '{"x":}', '{"x":1,}', "[1,]", '{"x":1} trailing',
  "undefined", "NaN", "Infinity", "01", "1.", ".1", "+1", "1e", "1e+", "--1",
  '"unterminated', '"bad\\q"', '"raw\nline"', "{]", "}{", '["escaped\\"',
]) rejects(text, "invalid_json");
for (const value of [null, undefined, 1, false, {}, [], new String("{}")]) rejects(value, "invalid_json");

{
  const nested = (depth) => "[".repeat(depth) + "0" + "]".repeat(depth);
  let result = parseRecordJSON(nested(JSON_INPUT_LIMITS.maxDepth));
  for (let index = 0; index < JSON_INPUT_LIMITS.maxDepth; index += 1) {
    assert.equal(result.length, 1);
    result = result[0];
  }
  assert.equal(result, 0);
  rejects(nested(JSON_INPUT_LIMITS.maxDepth + 1), "max_depth_exceeded");
  rejects(nested(8000), "max_depth_exceeded");
  rejects('{"child":'.repeat(8000) + "null" + "}".repeat(8000), "max_depth_exceeded");
}

// Only about 2 MiB of source text is needed to cross the value-count bound;
// no 64 MiB input allocation is necessary to exercise the file-size guard.
rejects("[" + "0,".repeat(JSON_INPUT_LIMITS.maxValues - 1) + "0]", "max_values_exceeded");
for (const bytes of [0, 1, JSON_INPUT_LIMITS.maxBytes - 1, JSON_INPUT_LIMITS.maxBytes]) {
  assert.doesNotThrow(() => assertRecordFileSize(bytes));
}
for (const bytes of [JSON_INPUT_LIMITS.maxBytes + 1, JSON_INPUT_LIMITS.maxBytes * 2, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => assertRecordFileSize(bytes), (error) => {
    assert.equal(error.code, "max_bytes_exceeded");
    assert.equal(error.diagnostics[0].code, "max_bytes_exceeded");
    return true;
  });
}
console.log("OK malformed, deeply nested, excessive-value and oversized input is rejected with bounded diagnostics");
