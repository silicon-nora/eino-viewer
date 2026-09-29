import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createEinoDAGEnvelope,
  projectEinoDAGEnvelopes,
} from "../src/index.js";

function fixture(name) {
  return JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../fixtures/${name}`),
      "utf8",
    ),
  );
}

const callbacks = fixture("eino-callback-events-v1.json");
const agents = fixture("eino-agent-events-v1.json");
const schema = fixture("eino-schema-domains-v1.json");
const components = fixture("eino-component-io-v1.json");
const envelopes = [
  callbacks[0],
  agents[0],
  schema[0],
  schema[1],
  schema[2],
  schema[3],
  components[0],
];
const collection = projectEinoDAGEnvelopes(envelopes);
assert.equal(collection.ok, true);
assert.deepEqual(
  collection.projections.map((entry) => entry.viewId),
  [
    "callback.trace-v1",
    "agent.execution-v1",
    "schema.message-conversation-v1",
    "schema.agentic-message-conversation-v1",
    "schema.tool-inspector-v1",
    "schema.document-data-flow-v1",
    "component.io-trace-v1",
  ],
);
assert.deepEqual(collection.byRun["run-1"], [0]);
assert.deepEqual(collection.byRun["run-agent-1"], [1]);
assert.deepEqual(collection.byRun["run-schema-1"], [2, 3, 4, 5]);
assert.deepEqual(collection.byRun["run-component-catalog"], [6]);
assert.equal(collection.projections[2].output.message, schema[0].payload);
assert.equal(collection.projections[5].output.document, schema[3].payload);

const unknown = createEinoDAGEnvelope({
  kind: "custom.domain",
  kindVersion: 1,
  payload: { value: true },
});
const withoutFallback = projectEinoDAGEnvelopes([unknown], {
  includeUnknown: false,
});
assert.equal(withoutFallback.ok, false);
assert.equal(withoutFallback.diagnostics[0].envelopeIndex, 0);

const invalid = projectEinoDAGEnvelopes([null, callbacks[0]]);
assert.equal(invalid.ok, false);
assert.equal(invalid.projections.length, 1);
assert(invalid.diagnostics.every((entry) => entry.envelopeIndex === 0));

console.log("OK: eino-dag domain views and ordered correlation passed");
