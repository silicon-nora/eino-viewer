import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseComponentIOEnvelope,
  validateComponentIOEnvelope,
} from "../src/protocol.js";

const fixture = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../fixtures/eino-component-io-v1.json"),
    "utf8",
  ),
);
assert.equal(fixture.length, 21);
for (const envelope of fixture) {
  assert.equal(parseComponentIOEnvelope(envelope), envelope);
}
assert.deepEqual(
  [...new Set(fixture.map((envelope) => envelope.payload.component))].sort(),
  [
    "AgenticChatTemplate",
    "AgenticModel",
    "ChatModel",
    "ChatTemplate",
    "DocumentTransformer",
    "Embedding",
    "Indexer",
    "Loader",
    "Retriever",
    "Tool",
  ],
);
assert.equal(fixture.filter((envelope) => envelope.payload.direction === "input").length, 10);
assert.equal(fixture.filter((envelope) => envelope.payload.direction === "output").length, 11);
assert.equal(fixture[0].payload.body.messages[0].content, "hello");
assert.equal(fixture[19].payload.body.response, "sunny");
assert.equal(fixture[20].payload.streaming, true);
assert.equal("body" in fixture[20].payload, false);

const unsafeStream = structuredClone(fixture[20]);
unsafeStream.payload.body = { consumed: true };
assert(
  validateComponentIOEnvelope(unsafeStream).diagnostics.some(
    (entry) => entry.code === "component_io.live_stream_body",
  ),
);

const missingBody = structuredClone(fixture[0]);
delete missingBody.payload.body;
assert.equal(validateComponentIOEnvelope(missingBody).valid, false);

for (const reason of ["size_limit", "unsupported_value"]) {
  const omitted = structuredClone(missingBody);
  omitted.metadata = { capture: { status: "omitted", reason } };
  assert.equal(validateComponentIOEnvelope(omitted).valid, true, reason);
  const contradictory = structuredClone(omitted);
  contradictory.payload.body = null;
  assert.equal(validateComponentIOEnvelope(contradictory).valid, false, "omitted is not null");
}
for (const reason of [undefined, "", "complete", "stream_not_consumed"]) {
  const invalid = structuredClone(missingBody);
  invalid.metadata = { capture: { status: "omitted", ...(reason === undefined ? {} : { reason }) } };
  assert.equal(validateComponentIOEnvelope(invalid).valid, false, `invalid omission: ${reason}`);
}
for (const value of [null, "", false, 0]) {
  const present = structuredClone(fixture[0]);
  present.payload.body = value;
  assert.equal(validateComponentIOEnvelope(present).valid, true, "explicit empty/null/scalar body remains valid");
}
const omittedStream = structuredClone(fixture[20]);
omittedStream.metadata = { capture: { status: "omitted", reason: "stream_not_consumed" } };
assert.equal(validateComponentIOEnvelope(omittedStream).valid, true);

console.log("OK: Go-produced component.io envelopes match eino-dag");
