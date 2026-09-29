import assert from "node:assert/strict";
import {
  composeGraphView,
  createEinoDAGEnvelope,
  createEinoDAGViewRegistry,
  projectEinoDAGEnvelopes,
} from "../src/index.js";

const workflow = {
  name: "answer",
  nodes: [{ id: "model", component: "ChatModel" }],
  edges: [],
};
const snapshot = { schemaVersion: 1, workflow };
const workflowEnvelope = createEinoDAGEnvelope({
  kind: "workflow.snapshot",
  kindVersion: 1,
  payload: snapshot,
});
const composeEnvelope = createEinoDAGEnvelope({
  kind: "compose.graph",
  kindVersion: 1,
  payload: workflow,
});

const registry = createEinoDAGViewRegistry();
assert.deepEqual(registry.listViews(), [
  { id: "workflow.snapshot-v1", kinds: ["workflow.snapshot@1"], automatic: true },
  { id: "compose.graph-v1", kinds: ["compose.graph@1"], automatic: true },
  { id: "callback.trace-v1", kinds: ["callback.event@1"], automatic: true },
  { id: "agent.execution-v1", kinds: ["agent.event@1"], automatic: true },
  { id: "schema.message-conversation-v1", kinds: ["schema.message@1"], automatic: true },
  { id: "schema.agentic-message-conversation-v1", kinds: ["schema.agentic_message@1"], automatic: true },
  { id: "schema.tool-inspector-v1", kinds: ["schema.tool@1"], automatic: true },
  { id: "schema.document-data-flow-v1", kinds: ["schema.document@1"], automatic: true },
  { id: "component.io-trace-v1", kinds: ["component.io@1"], automatic: true },
  { id: "generic.inspector-v1", kinds: ["*@*"], automatic: false },
]);
const workflowResult = registry.project(workflowEnvelope);
assert.equal(workflowResult.ok, true);
assert.equal(workflowResult.output, snapshot, "legacy snapshot projection must be lossless");
const composeResult = registry.project(composeEnvelope);
assert.equal(composeResult.ok, true);
assert.equal(composeResult.output.workflow, workflow);

const unregister = registry.register({
  ...composeGraphView,
  id: "compose.graph-copy",
});
const ambiguous = registry.project(composeEnvelope);
assert.equal(ambiguous.ok, false);
assert.equal(ambiguous.diagnostics[0].code, "view.ambiguous");
assert.equal(
  registry.project(composeEnvelope, { viewId: "compose.graph-v1" }).ok,
  true,
);
assert.equal(unregister(), true);
assert.equal(unregister(), false);

const customEnvelope = createEinoDAGEnvelope({
  kind: "custom.value",
  kindVersion: 1,
  payload: { value: 1 },
});
assert.equal(registry.project(customEnvelope).diagnostics[0].code, "view.unsupported_kind");
assert.equal(
  registry.project(customEnvelope, { viewId: "generic.inspector-v1" }).output.envelope,
  customEnvelope,
);
const collection = projectEinoDAGEnvelopes([
  workflowEnvelope,
  customEnvelope,
  { ...composeEnvelope, correlation: { runId: "run-1" } },
]);
assert.equal(collection.ok, true);
assert.equal(collection.projections.length, 3);
assert.deepEqual(collection.byRun, { "run-1": [2] });
assert.equal(collection.projections[1].viewId, "generic.inspector-v1");
const emptyRegistryCollection = projectEinoDAGEnvelopes([customEnvelope], {
  registry: createEinoDAGViewRegistry([]),
});
assert.equal(emptyRegistryCollection.ok, true);
assert.equal(emptyRegistryCollection.projections[0].viewId, "generic.inspector-v1");
assert.throws(() => registry.register(composeGraphView), /already registered/);

const invalidRegistry = createEinoDAGViewRegistry([]);
invalidRegistry.register({
  id: "invalid-result",
  kinds: ["custom.value@1"],
  canProject: () => true,
  project: () => ({ ok: true, diagnostics: [] }),
});
assert.equal(
  invalidRegistry.project(customEnvelope).diagnostics[0].code,
  "view.invalid_result",
);

console.log("OK: eino-dag view registry tests passed");
