import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { findJSONValueIssues, JSON_INPUT_LIMITS } from "../src/json-value.js";
import { validateEinoRunRecord } from "../src/run-record.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { syntheticGraphRecord } from "./helpers/synthetic-record.js";

const codes = (value) => findJSONValueIssues(value).map((entry) => entry.code);
const nested = (depth) => JSON.parse('{"next":'.repeat(depth) + "0" + "}".repeat(depth));
const recordWith = (value) => ({ ...syntheticGraphRecord(12), metadata: { value } });
const assertRejected = (value, suffix) => {
  const record = recordWith(value);
  const validated = validateEinoRunRecord(record);
  assert.equal(validated.valid, false);
  assert.ok(validated.diagnostics.some(({ code }) => code.endsWith(suffix)), suffix);
  const projected = projectEinoViewerDocument(record);
  assert.equal(projected.ok, false);
  const projectedSuffix = suffix === "unsafe_json" ? "invalid_json_value" : suffix;
  assert.ok(projected.diagnostics.some(({ code }) => code.endsWith(projectedSuffix)), projectedSuffix);
  assert.ok(Object.isFrozen(projected.diagnostics));
};

assert.deepEqual(JSON_INPUT_LIMITS, { maxDepth: 128, maxValues: 1000000, maxBytes: 64 * 1024 * 1024, maxDiagnostics: 20 });
assert.ok(Object.isFrozen(JSON_INPUT_LIMITS));
assert.deepEqual(codes(nested(JSON_INPUT_LIMITS.maxDepth)), []);
assert.deepEqual(codes(nested(JSON_INPUT_LIMITS.maxDepth + 1)), ["max_depth_exceeded"]);
assertRejected(nested(8000), "max_depth_exceeded");

for (const value of [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0, -0, 0.1, -123.5, 1e-300]) {
  assert.deepEqual(codes(value), [], String(value));
  assert.equal(validateEinoRunRecord(recordWith(value)).valid, true);
  assert.equal(projectEinoViewerDocument(recordWith(value)).ok, true);
}
for (const value of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, JSON.parse("9223372036854775807"), JSON.parse("18446744073709551615")]) {
  assert.deepEqual(codes(value), ["unsafe_integer"]);
  assertRejected(value, "unsafe_integer");
}

let calls = 0;
const getter = { get secret() { calls += 1; throw new Error("must not execute"); } };
const hidden = Object.defineProperty({}, "hidden", { enumerable: false, value: "hidden" });
const symbol = { [Symbol("hidden")]: "hidden" };
const sparse = [1, , 3];
const accessorArray = Object.defineProperty([1], "0", { get() { calls += 1; return 1; }, enumerable: true });
for (const value of [getter, hidden, symbol, sparse, accessorArray, new Date(0), () => {}]) {
  assertRejected(value, "unsafe_json");
}
assert.equal(calls, 0, "neither record validation nor projection invokes input getters");
for (const field of ["runId", "source", "evidence", "schemaVersion"]) {
  const record = syntheticGraphRecord(12);
  Object.defineProperty(record, field, { enumerable: true, get() { calls += 1; throw new Error("must not execute"); } });
  assert.equal(validateEinoRunRecord(record).valid, false);
  assert.equal(projectEinoViewerDocument(record).ok, false);
}
assert.equal(calls, 0, "entry-point classification cannot execute a getter before preflight");

const cyclic = {};
cyclic.self = cyclic;
assertRejected(cyclic, "recursive_reference");
const shared = { exact: "shared plain value" };
assert.deepEqual(codes([shared, shared]), [], "shared acyclic values are ordinary serializable JSON");
let exponentiallyRepeated = 0;
for (let depth = 0; depth < 20; depth += 1) exponentiallyRepeated = [exponentiallyRepeated, exponentiallyRepeated];
assert.ok(codes(exponentiallyRepeated).includes("max_values_exceeded"), "expanded JSON work is bounded even for shared references");
assert.deepEqual(codes(new Array(JSON_INPUT_LIMITS.maxValues)), ["max_values_exceeded"], "oversized sparse arrays are rejected without walking every slot");
assert.equal(findJSONValueIssues(new Array(1000)).length, JSON_INPUT_LIMITS.maxDiagnostics, "diagnostics stay bounded");

const foreign = runInNewContext("({ value: [null, 0.1, { ok: true }] })");
assert.deepEqual(codes(foreign), [], "plain JSON objects from another realm remain supported");
const foreignRecord = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(syntheticGraphRecord(12)))})`);
assert.equal(validateEinoRunRecord(foreignRecord).valid, true);
assert.deepEqual(codes(Object.assign(Object.create(null), { exact: "null prototype" })), []);
assert.deepEqual(codes(new (class Object {})()), ["non_json_object"], "a class named Object is not a cross-realm plain object");
const revoked = Proxy.revocable({}, {});
revoked.revoke();
assert.deepEqual(codes(revoked.proxy), ["non_json_object"], "inspection failures produce a diagnostic, not an exception");

// Byte budgets use JSON's actual UTF-8 representation, including string escapes.
const exactBytes = "x".repeat(JSON_INPUT_LIMITS.maxBytes - 2);
assert.deepEqual(codes(exactBytes), []);
assert.deepEqual(codes(`${exactBytes}x`), ["max_bytes_exceeded"]);
const repeatedText = "界".repeat(1024 * 1024);
assert.deepEqual(codes(Array(22).fill(repeatedText)), ["max_bytes_exceeded"], "multibyte text and shared strings count every serialized occurrence");

const canonical = structuredClone(projectEinoViewerDocument(syntheticGraphRecord(12)).document);
canonical.evidence[0].metadata = { value: nested(8000) };
assert.equal(projectEinoViewerDocument(canonical).diagnostics[0].code, "viewer.max_depth_exceeded");
const canonicalGetter = structuredClone(projectEinoViewerDocument(syntheticGraphRecord(12)).document);
Object.defineProperty(canonicalGetter, "execution", { enumerable: true, get() { calls += 1; throw new Error("must not execute"); } });
assert.equal(projectEinoViewerDocument(canonicalGetter).ok, false);
assert.equal(calls, 0);

const large = syntheticGraphRecord(10000);
assert.equal(validateEinoRunRecord(large).valid, true, "the supported 10k-evidence scale fixture remains accepted");
const largeProjection = projectEinoViewerDocument(large);
assert.equal(largeProjection.ok, true);
assert.equal(projectEinoViewerDocument(largeProjection.document).ok, true, "reopening the canonical 10k-evidence result still fits the same budget");

console.log("OK: bounded JSON preflight preserves safe values and rejects lossy, executable, sparse and deeply nested input");
