import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildExecutionTrajectory,
  createExecutionTrajectoryBuilder,
} from "../src/trajectory.js";

async function fixture(name) {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), "utf8"));
}

const success = await fixture("eino-agent-recorder-trip-planner-v1.json");
const failure = await fixture("eino-agent-recorder-trip-planner-failure-v1.json");
const incomplete = await fixture("eino-agent-recorder-incomplete-v1.json");

{
  const source = await fixture("recorder-matrix/agent-nested-parallel-scopes.json");
  const evidence = source.evidence.filter(({ payload }) => !payload.address?.some(({ type, subId }) => type === "tool" && subId === "call-child-fast"));
  const trajectory = buildExecutionTrajectory(evidence).trajectory;
  const inner = trajectory.records.filter(({ toolCallId }) => toolCallId === "shared-inner-call");
  assert.equal(inner.length, 1);
  assert.equal(inner[0].output, "lookup:slow");
  assert.equal(inner[0].evidence.some(({ envelopeIndex }) => evidence[envelopeIndex].kind === "agent.event"), false, "missing outer and inner callback addresses must not turn name-only events into identity");
  assert.equal(trajectory.records.filter(({ metadata }) => metadata.agentScopeUnresolved).length, 6);
}

{
  const source = await fixture("recorder-matrix/agent-nested-failure-propagated.json");
  const evidence = JSON.parse(JSON.stringify(source.evidence).replaceAll("call-child-one", "shared-inner-call"));
  const trajectory = buildExecutionTrajectory(evidence).trajectory;
  const outer = trajectory.records.find(({ kind, metadata }) => kind === "tool" && !metadata.parentAgentScopeId);
  const inner = trajectory.records.find(({ kind, metadata }) => kind === "tool" && metadata.parentAgentScopeId);
  assert.equal(outer.toolCallId, inner.toolCallId);
  assert.equal(outer.status, "incomplete");
  assert.equal(inner.status, "failed");
  assert.equal(trajectory.records.filter(({ kind }) => kind === "error").length, 1);
}

{
  for (const name of ["distinct-results", "parallel-scopes", "failure-recovered", "failure-propagated"]) {
    const source = await fixture(`recorder-matrix/agent-nested-${name}.json`);
    const result = buildExecutionTrajectory(source.evidence);
    assert.equal(result.ok, true);
    assert.equal(result.trajectory.status, name === "failure-propagated" ? "failed" : "success");
    const records = result.trajectory.records;
    const tools = records.filter(({ kind }) => kind === "tool");
    assert.equal(tools.length, name === "parallel-scopes" ? 4 : 2);
    assert.equal(new Set(records.map(({ id }) => id)).size, records.length);
    for (const record of tools) {
      const ios = record.evidence.map(({ envelopeIndex }) => source.evidence[envelopeIndex]).filter(({ kind, payload }) => kind === "component.io" && payload.component === "Tool");
      assert.equal(new Set(ios.map(({ payload }) => JSON.stringify(payload.address))).size, 1);
      const output = ios.find(({ payload }) => payload.direction === "output");
      if (output) assert.equal(record.output, output.payload.body.response);
      if (record.metadata.parentAgentScopeId) {
        const parent = records.find(({ id }) => id === record.parentId);
        assert.equal(parent?.metadata.agentScopeId, record.metadata.agentScopeId, "inner tools belong to their own model turn");
      }
    }
    const publicOutputs = records.filter(({ metadata }) => metadata.publicOutput);
    assert.equal(publicOutputs.length, name === "failure-propagated" ? 0 : 1);
    for (const record of publicOutputs) assert.equal(record.metadata.parentAgentScopeId, undefined);
    for (const record of records.filter(({ metadata }) => metadata.agentScopeUnresolved)) {
      assert.equal(record.timing, undefined);
      assert.equal(record.parentId, undefined);
      assert.equal(record.evidence.length, 1);
    }
    if (name === "parallel-scopes") {
      const inner = tools.filter(({ toolCallId }) => toolCallId === "shared-inner-call");
      assert.equal(inner.length, 2);
      assert.deepEqual(inner.map(({ output }) => output).sort(), ["lookup:fast", "lookup:slow"]);
      assert.ok(result.diagnostics.some(({ code }) => code === "trajectory.ambiguous_agent_scope"));
      assert.equal(records.filter(({ metadata }) => metadata.source === "component.io").length, 4, "exact component scopes retain all child model turns despite ambiguous AgentEvents");
    }
  }
}

{
  const input = structuredClone(success.evidence);
  const assistantValue = input.find((envelope) =>
    envelope.kind === "agent.event" && envelope.payload?.output?.message?.value?.role === "assistant",
  ).payload.output.message.value;
  const result = buildExecutionTrajectory(input);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.runId, success.runId);
  assert.equal(result.trajectory.status, "success");
  assert.deepEqual(result.trajectory.records.map(({ kind }) => kind), [
    "user", "assistant", "tool", "tool", "assistant", "tool", "assistant",
  ]);
  assert.deepEqual(result.trajectory.records.map(({ turn }) => turn), [1, 1, 1, 1, 2, 2, 3]);
  assert.deepEqual(result.trajectory.records.map(({ step }) => step), [
    undefined, 1, 1, 1, 1, 1, 1,
  ]);
  assert.deepEqual(
    result.trajectory.records.filter(({ kind }) => kind === "tool").map(({ toolCallId }) => toolCallId),
    ["call-weather-singapore", "call-weather-tokyo", "call-air-quality-tokyo"],
  );
  assert.deepEqual(result.trajectory.records[2].input, { city: "Singapore" });
  assert.equal(result.trajectory.records[2].output.condition, "thunderstorms");
  assert.equal(result.trajectory.records.at(-1).output.content.startsWith("建议东京"), true);
  assert.deepEqual(
    result.trajectory.records.at(-1).evidence.map(({ envelopeIndex }) => envelopeIndex),
    [16, 17, 18, 19],
  );
  assert.equal(result.trajectory.metadata.envelopeCount, 20);
  assert.equal(result.trajectory.metadata.representedEvidenceCount, 20);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ["lifecycle.completion_unknown"]);
  assert.equal(Object.isFrozen(result.trajectory.records[0]), true);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(assistantValue), false);
  assistantValue.content = "caller still owns this message";

  for (const record of result.trajectory.records) {
    assert.deepEqual(
      record.evidence.map(({ envelopeIndex }) => envelopeIndex),
      [...record.evidence.map(({ envelopeIndex }) => envelopeIndex)].sort((a, b) => a - b),
    );
    assert.notEqual(record.timing?.semantics, "component-boundary");
  }
}

{
  const withSystem = structuredClone(success.evidence);
  const system = structuredClone(withSystem[0]);
  system.payload = { role: "system", content: "Use tools before answering." };
  withSystem.splice(1, 0, system);
  const result = buildExecutionTrajectory(withSystem);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.records[1].evidence.some(({ envelopeIndex, role }) =>
    envelopeIndex === 1 && role === "system-message"), true);
  assert.equal(result.trajectory.metadata.representedEvidenceCount, withSystem.length);
}

{
  const result = buildExecutionTrajectory(failure.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.status, "failed");
  assert.deepEqual(result.trajectory.records.map(({ kind, status }) => [kind, status]), [
    ["user", "success"],
    ["assistant", "success"],
    ["tool", "success"],
    ["tool", "success"],
    ["assistant", "success"],
    ["tool", "failed"],
  ]);
  const failedTool = result.trajectory.records.at(-1);
  assert.equal(failedTool.toolCallId, "call-air-quality-tokyo");
  assert.match(failedTool.error.message, /air quality provider timed out/);
  assert.deepEqual(failedTool.evidence.map(({ envelopeIndex, role }) => [envelopeIndex, role]), [
    [12, "tool-call"], [13, "tool-input"], [14, "error"],
  ]);
  assert.equal(result.trajectory.records.some(({ kind }) => kind === "error"), false);
  assert.equal(result.trajectory.metadata.representedEvidenceCount, failure.evidence.length);
}

{
  const result = buildExecutionTrajectory(incomplete.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.status, "running");
  assert.equal(result.trajectory.records.length, 1);
  assert.equal(result.trajectory.records[0].turn, undefined);
  assert.equal(result.trajectory.records[0].timing.semantics, "observed-at");
  assert.equal("durationMs" in result.trajectory.records[0].timing, false);
  assert.deepEqual(result.trajectory.records[0].metadata, { messageRole: "user" });
}

{
  const prefixes = [];
  for (let length = 1; length <= success.evidence.length; length += 1) {
    const result = buildExecutionTrajectory(success.evidence.slice(0, length));
    assert.equal(result.ok, true);
    const ids = result.trajectory.records.map(({ id }) => id);
    assert.equal(prefixes.every((id) => ids.includes(id)), true);
    prefixes.splice(0, prefixes.length, ...ids);
  }
}

{
  const builder = createExecutionTrajectoryBuilder({ runId: success.runId });
  let previousIds = [];
  for (const [index, sourceEnvelope] of success.evidence.entries()) {
    const envelope = structuredClone(sourceEnvelope);
    const result = builder.append(envelope);
    assert.equal(result.ok, true);
    assert.equal(builder.size, index + 1);
    assert.equal(builder.snapshot(), result);
    const ids = result.trajectory.records.map(({ id }) => id);
    assert.equal(previousIds.every((id) => ids.includes(id)), true);
    previousIds = ids;

    envelope.kind = "mutated.by.caller";
    assert.notEqual(builder.snapshot().trajectory.metadata.sourceKinds.at(-1), "mutated.by.caller");
  }
  assert.deepEqual(builder.snapshot(), buildExecutionTrajectory(success.evidence, { runId: success.runId }));

  const beforeRejectedAppend = builder.snapshot();
  const beforeRejectedSize = builder.size;
  const invalid = structuredClone(success.evidence[0]);
  invalid.payload.role = 7;
  const rejected = builder.append(invalid);
  assert.equal(rejected.ok, false);
  assert.equal(builder.size, beforeRejectedSize);
  assert.equal(builder.snapshot(), beforeRejectedAppend);
  assert.equal(builder.appendAll([]), beforeRejectedAppend);
}

{
  const builder = createExecutionTrajectoryBuilder();
  const result = builder.appendAll(success.evidence);
  assert.equal(result.ok, true);
  assert.equal(builder.size, success.evidence.length);
  assert.deepEqual(result, buildExecutionTrajectory(success.evidence));
  assert.throws(() => builder.appendAll(null), /array/);
  assert.throws(() => createExecutionTrajectoryBuilder({ runId: "" }), /non-empty string/);
}

{
  const weak = structuredClone(failure.evidence);
  weak[14].payload.error.message = "air quality provider timed out";
  const result = buildExecutionTrajectory(weak);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.records.at(-1).kind, "error");
  assert.equal(result.trajectory.records.at(-1).status, "failed");
  const tool = result.trajectory.records.find(({ toolCallId }) => toolCallId === "call-air-quality-tokyo");
  assert.equal(tool.status, "running", "a sole unfinished legacy tool is not sufficient error attribution");
  assert.equal(tool.error, undefined);
  assert.equal(tool.evidence.some(({ envelopeIndex }) => envelopeIndex === 14), false);
  assert.equal(result.diagnostics.some(({ code }) => code === "trajectory.weak_error_correlation"), false);
}

{
  const ambiguousError = structuredClone(failure.evidence[14]);
  ambiguousError.payload.error.message = "provider unavailable";
  ambiguousError.observedAtMs = failure.evidence[3].observedAtMs + 1;
  const result = buildExecutionTrajectory([
    ...failure.evidence.slice(0, 3),
    failure.evidence[4],
    ambiguousError,
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.status, "failed");
  assert.equal(result.trajectory.records.at(-1).kind, "error");
  assert.equal(result.trajectory.records.at(-1).error.message, "provider unavailable");
  assert.equal(result.trajectory.records.filter(({ kind }) => kind === "tool").every(({ status }) => status === "running"), true);
}

{
  const modelPrefix = buildExecutionTrajectory(success.evidence.slice(0, 2));
  assert.equal(modelPrefix.ok, true);
  assert.equal(modelPrefix.trajectory.status, "running");
  assert.equal(modelPrefix.diagnostics.some(({ code }) => code === "trajectory.unmatched_model_turn"), true);
}

{
  const runningToolPrefix = buildExecutionTrajectory(success.evidence.slice(0, 5));
  assert.equal(runningToolPrefix.ok, true);
  const running = runningToolPrefix.trajectory.records.filter(({ status }) => status === "running");
  assert.equal(running.length, 2);
  assert.equal(running.every((record) => record.timing && !("durationMs" in record.timing)), true);
}

{
  const invalid = structuredClone(success.evidence.slice(0, 1));
  invalid[0].payload.role = 7;
  const result = buildExecutionTrajectory(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some(({ code, envelopeIndex }) =>
    code === "schema_message.invalid_role" && envelopeIndex === 0), true);
}

{
  const mixed = [structuredClone(success.evidence[0]), structuredClone(success.evidence[19])];
  mixed[1].correlation.runId = "another-run";
  const result = buildExecutionTrajectory(mixed);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "trajectory.mixed_run");
}

{
  const systemOnly = structuredClone(success.evidence.slice(0, 1));
  systemOnly[0].payload.role = "system";
  const result = buildExecutionTrajectory(systemOnly);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "trajectory.missing_agent_anchor");
}

{
  assert.equal(buildExecutionTrajectory([]).diagnostics[0].code, "trajectory.empty");
  assert.equal(buildExecutionTrajectory(success.evidence, { runId: "" }).diagnostics[0].code, "trajectory.invalid_run_id");
}

const cancelledMatrix = await fixture("recorder-matrix/agent-cancelled.json");
const interruptedMatrix = await fixture("recorder-matrix/agent-tool-interrupted.json");

{
  const result = buildExecutionTrajectory(cancelledMatrix.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.status, "cancelled");
  const tool = result.trajectory.records.find(({ kind }) => kind === "tool");
  const runError = result.trajectory.records.find(({ kind }) => kind === "error");
  assert.equal(tool.status, "incomplete");
  assert.equal(tool.metadata.executionState, "planned");
  assert.equal(tool.error, undefined);
  assert.deepEqual(tool.input, { customer: "Ada" });
  assert.equal(tool.evidence.every(({ role }) => role === "tool-call"), true);
  assert.equal(runError.status, "cancelled");
  assert.match(runError.error.message, /agent canceled/);
  assert.equal(runError.evidence.every(({ envelopeIndex }) => Boolean(cancelledMatrix.evidence[envelopeIndex].payload.error)), true);
  assert.equal(result.trajectory.records.some(({ status }) => status === "running"), false);

  const legacy = buildExecutionTrajectory(cancelledMatrix.evidence.filter(({ kind }) => kind !== "run.lifecycle"));
  assert.equal(legacy.ok, true);
  const legacyTool = legacy.trajectory.records.find(({ kind }) => kind === "tool");
  assert.equal(legacyTool.status, "running", "without a run-end marker, preserve the old open-tool state");
  assert.equal(legacyTool.error, undefined, "legacy global errors must not be guessed onto the only tool either");
}

{
  const result = buildExecutionTrajectory(interruptedMatrix.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.trajectory.status, "incomplete");
  const tool = result.trajectory.records.find(({ kind }) => kind === "tool");
  assert.equal(tool.status, "incomplete");
  assert.equal(tool.metadata.executionState, "interrupted");
  assert.equal(tool.metadata.interruptionReason, "approval required for booking");
  assert.equal(tool.error, undefined);
  const interruptIndex = interruptedMatrix.evidence.findIndex(({ payload }) => payload.action?.interrupted);
  assert.equal(tool.evidence.some(({ envelopeIndex, role }) => envelopeIndex === interruptIndex && role === "interruption"), true);
  assert.equal(tool.evidence.some(({ role }) => role === "tool-input"), true);
  assert.equal(result.trajectory.records.some(({ kind }) => kind === "error"), false);
  assert.equal(result.trajectory.records.some(({ status }) => status === "running"), false);
  assert.equal(Object.isFrozen(tool.metadata), true);

  const withoutInterrupt = interruptedMatrix.evidence.filter((_, index) => index !== interruptIndex);
  const unrecorded = buildExecutionTrajectory(withoutInterrupt);
  assert.equal(unrecorded.ok, true);
  const unresolvedTool = unrecorded.trajectory.records.find(({ kind }) => kind === "tool");
  assert.equal(unresolvedTool.status, "incomplete");
  assert.equal(unresolvedTool.metadata.executionState, "unrecorded");
  assert.equal(unresolvedTool.metadata.interruptionReason, undefined);
  assert.equal(unresolvedTool.output, undefined);
}

{
  const unknownCall = structuredClone(interruptedMatrix.evidence);
  const event = unknownCall.find(({ payload }) => payload.action?.interrupted);
  const context = event.payload.action.interrupted.contexts[0];
  context.address.find(({ type }) => type === "tool").subId = "another-call";
  const result = buildExecutionTrajectory(unknownCall);
  assert.equal(result.ok, true);
  const tool = result.trajectory.records.find(({ kind }) => kind === "tool");
  const runInterruption = result.trajectory.records.find(({ kind }) => kind === "error");
  assert.equal(tool.metadata.executionState, "unrecorded");
  assert.equal(tool.metadata.interruptionReason, undefined);
  assert.equal(tool.evidence.some(({ role }) => role === "interruption"), false);
  assert.equal(runInterruption.status, "incomplete");
  assert.equal(runInterruption.metadata.executionState, "interrupted");
  assert.equal(runInterruption.metadata.interruptionReason, "approval required for booking");
  assert.equal(result.diagnostics.some(({ code }) => code === "trajectory.unmatched_interruption"), true);

  delete context.address.find(({ type }) => type === "tool").subId;
  const noCall = buildExecutionTrajectory(unknownCall);
  assert.equal(noCall.ok, true);
  assert.equal(noCall.trajectory.records.find(({ kind }) => kind === "tool").metadata.interruptionReason, undefined,
    "a matching tool name alone is not enough to attach an interruption");
  assert.equal(noCall.trajectory.records.find(({ kind }) => kind === "error").metadata.interruptionReason, "approval required for booking");

  event.payload.action.interrupted.contexts = [];
  event.payload.action.interrupted.data = { reason: "manual approval required", request: "booking" };
  const runLevel = buildExecutionTrajectory(unknownCall);
  assert.equal(runLevel.ok, true);
  assert.deepEqual(JSON.parse(runLevel.trajectory.records.find(({ kind }) => kind === "error").metadata.interruptionReason),
    { reason: "manual approval required", request: "booking" });
}

{
  const explicit = structuredClone(failure.evidence);
  explicit[14].payload.error.message = "provider unavailable";
  explicit[14].correlation.toolCallId = "call-air-quality-tokyo";
  const result = buildExecutionTrajectory(explicit);
  assert.equal(result.ok, true);
  const tool = result.trajectory.records.find(({ toolCallId }) => toolCallId === "call-air-quality-tokyo");
  assert.equal(tool.status, "failed");
  assert.equal(tool.error.message, "provider unavailable");
  assert.equal(result.trajectory.records.some(({ kind }) => kind === "error"), false);

  explicit[14].correlation.toolCallId = "missing-call";
  explicit[14].payload.error.message = "failure mentions call-air-quality-tokyo but explicit correlation refers elsewhere";
  const unmatched = buildExecutionTrajectory(explicit);
  assert.equal(unmatched.ok, true);
  assert.equal(unmatched.trajectory.records.find(({ toolCallId }) => toolCallId === "call-air-quality-tokyo").error, undefined);
  assert.equal(unmatched.trajectory.records.at(-1).kind, "error");

  delete explicit[14].correlation.toolCallId;
  explicit[14].payload.error.message = "failed id:call-air-quality-tokyo-extra";
  const substring = buildExecutionTrajectory(explicit);
  assert.equal(substring.ok, true);
  assert.equal(substring.trajectory.records.find(({ toolCallId }) => toolCallId === "call-air-quality-tokyo").error, undefined,
    "a prefix of another call ID does not establish tool error ownership");
  assert.equal(substring.trajectory.records.at(-1).kind, "error");

  explicit[14].payload.error.message = "call-weather-singapore and call-air-quality-tokyo are mentioned; ownership is unknown";
  const ambiguous = buildExecutionTrajectory(explicit);
  assert.equal(ambiguous.ok, true);
  assert.equal(ambiguous.trajectory.records.filter(({ kind }) => kind === "tool").some(({ error }) => error), false);
  assert.equal(ambiguous.trajectory.records.at(-1).kind, "error");
}

for (const name of ["agent-direct-answer.json", "agent-tool-recovered.json", "agent-redacted-tool.json"]) {
  const record = await fixture(`recorder-matrix/${name}`);
  const result = buildExecutionTrajectory(record.evidence);
  assert.equal(result.ok, true, name);
  assert.equal(result.trajectory.status, "success", name);
  assert.equal(result.trajectory.records.every(({ status }) => status === "success"), true, name);
  assert.equal(result.trajectory.records.some(({ metadata }) => metadata.executionState), false, name);
}

console.log("trajectory projector tests passed");
