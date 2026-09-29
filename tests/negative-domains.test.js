import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EinoDAGProtocolError,
  parseAgentEventEnvelope,
  parseCallbackEventEnvelope,
  parseComponentIOEnvelope,
  parseComposeGraphEnvelope,
  parseEinoDAGEnvelope,
  parseSchemaAgenticMessageEnvelope,
  parseSchemaDocumentEnvelope,
  parseSchemaMessageEnvelope,
  parseSchemaToolEnvelope,
  projectEinoDAGEnvelopes,
  validateAgentEventEnvelope,
  validateCallbackEventEnvelope,
  validateComponentIOEnvelope,
  validateComposeGraphEnvelope,
  validateEinoDAGEnvelope,
  validateSchemaAgenticMessageEnvelope,
  validateSchemaDocumentEnvelope,
  validateSchemaMessageEnvelope,
  validateSchemaToolEnvelope,
} from "../src/index.js";

function fixture(name) {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, `../fixtures/${name}`), "utf8"));
}

function mutated(source, mutate) {
  const value = structuredClone(source);
  mutate(value);
  return value;
}

function assertRejected({ name, source, mutate, validate, parse, code }) {
  const candidate = mutated(source, mutate);
  const result = validate(candidate);
  assert.equal(result.valid, false, `${name} should be invalid`);
  assert(
    result.diagnostics.some((entry) => entry.code === code),
    `${name} should report ${code}: ${result.diagnostics.map((entry) => entry.code).join(", ")}`,
  );
  assert.throws(() => parse(candidate), EinoDAGProtocolError, `${name} parser should reject`);
  return candidate;
}

const compose = fixture("eino-compose-graph-envelope-v1.json");
const callbacks = fixture("eino-callback-events-v1.json");
const agents = fixture("eino-agent-events-v1.json");
const schema = fixture("eino-schema-domains-v1.json");
const components = fixture("eino-component-io-v1.json");

const positiveCases = [
  [compose, validateComposeGraphEnvelope, parseComposeGraphEnvelope],
  [callbacks[0], validateCallbackEventEnvelope, parseCallbackEventEnvelope],
  [agents[0], validateAgentEventEnvelope, parseAgentEventEnvelope],
  [schema[0], validateSchemaMessageEnvelope, parseSchemaMessageEnvelope],
  [schema[1], validateSchemaAgenticMessageEnvelope, parseSchemaAgenticMessageEnvelope],
  [schema[2], validateSchemaToolEnvelope, parseSchemaToolEnvelope],
  [schema[3], validateSchemaDocumentEnvelope, parseSchemaDocumentEnvelope],
  [components[0], validateComponentIOEnvelope, parseComponentIOEnvelope],
  [components.at(-1), validateComponentIOEnvelope, parseComponentIOEnvelope],
];
for (const [document, validate, parse] of positiveCases) {
  assert.equal(validate(document).valid, true);
  assert.equal(parse(document), document);
}

const domainFailures = [
  {
    name: "compose unknown edge target",
    source: compose,
    mutate: (value) => { value.payload.edges[0].to = "missing"; },
    validate: validateComposeGraphEnvelope,
    parse: parseComposeGraphEnvelope,
    code: "compose.unknown_edge_target",
  },
  {
    name: "callback phase",
    source: callbacks[0],
    mutate: (value) => { value.payload.phase = "paused"; },
    validate: validateCallbackEventEnvelope,
    parse: parseCallbackEventEnvelope,
    code: "callback.invalid_phase",
  },
  {
    name: "callback timestamp mismatch",
    source: callbacks[0],
    mutate: (value) => { value.observedAtMs += 1; },
    validate: validateCallbackEventEnvelope,
    parse: parseCallbackEventEnvelope,
    code: "callback.timestamp_mismatch",
  },
  {
    name: "agent empty name",
    source: agents[0],
    mutate: (value) => { value.payload.agentName = ""; },
    validate: validateAgentEventEnvelope,
    parse: parseAgentEventEnvelope,
    code: "agent.invalid_agent_name",
  },
  {
    name: "agent stream body",
    source: agents[0],
    mutate: (value) => {
      value.payload.output.message.streaming = true;
      value.payload.output.message.value = { content: "must remain unread" };
    },
    validate: validateAgentEventEnvelope,
    parse: parseAgentEventEnvelope,
    code: "agent.live_stream_value",
  },
  {
    name: "message role",
    source: schema[0],
    mutate: (value) => { value.payload.role = 7; },
    validate: validateSchemaMessageEnvelope,
    parse: parseSchemaMessageEnvelope,
    code: "schema_message.invalid_role",
  },
  {
    name: "agentic content blocks",
    source: schema[1],
    mutate: (value) => { value.payload.content_blocks = {}; },
    validate: validateSchemaAgenticMessageEnvelope,
    parse: parseSchemaAgenticMessageEnvelope,
    code: "schema_agentic_message.invalid_content_blocks",
  },
  {
    name: "tool name",
    source: schema[2],
    mutate: (value) => { delete value.payload.name; },
    validate: validateSchemaToolEnvelope,
    parse: parseSchemaToolEnvelope,
    code: "schema_tool.invalid_name",
  },
  {
    name: "document metadata",
    source: schema[3],
    mutate: (value) => { value.payload.meta_data = []; },
    validate: validateSchemaDocumentEnvelope,
    parse: parseSchemaDocumentEnvelope,
    code: "schema_document.invalid_metadata",
  },
  {
    name: "component missing body",
    source: components[0],
    mutate: (value) => { delete value.payload.body; },
    validate: validateComponentIOEnvelope,
    parse: parseComponentIOEnvelope,
    code: "component_io.missing_body",
  },
  {
    name: "component stream body",
    source: components.at(-1),
    mutate: (value) => { value.payload.body = { consumed: true }; },
    validate: validateComponentIOEnvelope,
    parse: parseComponentIOEnvelope,
    code: "component_io.live_stream_body",
  },
  {
    name: "component direction",
    source: components[0],
    mutate: (value) => { value.payload.direction = "sideways"; },
    validate: validateComponentIOEnvelope,
    parse: parseComponentIOEnvelope,
    code: "component_io.invalid_direction",
  },
];
const rejectedDomains = domainFailures.map(assertRejected);

const envelopeFailures = [
  ["wrong protocol", (value) => { value.protocol = "other"; }, "envelope.invalid_protocol"],
  ["unsupported protocol version", (value) => { value.protocolVersion = 2; }, "envelope.unsupported_protocol_version"],
  ["missing payload", (value) => { delete value.payload; }, "envelope.missing_payload"],
  ["unknown top-level field", (value) => { value.extra = true; }, "envelope.unknown_field"],
  ["unsafe source value", (value) => { value.source.module = 3; }, "envelope.invalid_string"],
];
for (const [name, mutate, code] of envelopeFailures) {
  assertRejected({
    name,
    source: schema[0],
    mutate,
    validate: validateEinoDAGEnvelope,
    parse: parseEinoDAGEnvelope,
    code,
  });
}

const heterogeneous = projectEinoDAGEnvelopes([callbacks[0], schema[0], components[0]]);
assert.equal(heterogeneous.ok, true);
assert.deepEqual(
  heterogeneous.projections.map((entry) => entry.viewId),
  ["callback.trace-v1", "schema.message-conversation-v1", "component.io-trace-v1"],
);

const partial = projectEinoDAGEnvelopes([callbacks[0], rejectedDomains[5], schema[3]]);
assert.equal(partial.ok, false);
assert.equal(partial.projections.length, 2);
assert(partial.diagnostics.every((entry) => entry.envelopeIndex === 1));
assert.deepEqual(partial.byRun["run-1"], [0]);
assert.deepEqual(partial.byRun["run-schema-1"], [1]);

console.log("OK: positive, negative, stream, envelope, and mixed-domain cases passed");
