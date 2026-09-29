import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateWorkflowSnapshot } from "eino-workflow-dag";
import {
  buildExecutionDAG,
  buildExecutionDAGs,
  createExecutionDAGBuilder,
  executionDAGToWorkflowSnapshot,
} from "../src/execution-dag.js";

const fixtureURL = new URL("../fixtures/eino-agent-weather-scenario-v1.json", import.meta.url);
const realisticAgentFixtureURL = new URL("../fixtures/eino-agent-recorder-trip-planner-v1.json", import.meta.url);
const realisticAgentFailureFixtureURL = new URL("../fixtures/eino-agent-recorder-trip-planner-failure-v1.json", import.meta.url);
const agentFixtureURL = new URL("../fixtures/eino-agent-events-v1.json", import.meta.url);
const callbackFixtureURL = new URL("../fixtures/eino-callback-events-v1.json", import.meta.url);
const workflowFixtureURL = new URL("../fixtures/eino-weather-workflow-v1.json", import.meta.url);
const workflowEvidenceURL = new URL("../fixtures/eino-weather-workflow-evidence-v1.json", import.meta.url);
const weather = JSON.parse(await readFile(fileURLToPath(fixtureURL), "utf8"));
const realisticAgent = JSON.parse(await readFile(fileURLToPath(realisticAgentFixtureURL), "utf8"));
const realisticAgentFailure = JSON.parse(await readFile(fileURLToPath(realisticAgentFailureFixtureURL), "utf8"));
const agents = JSON.parse(await readFile(fileURLToPath(agentFixtureURL), "utf8"));
const callbacks = JSON.parse(await readFile(fileURLToPath(callbackFixtureURL), "utf8"));
const workflowSnapshot = JSON.parse(await readFile(fileURLToPath(workflowFixtureURL), "utf8"));
const workflowEvidence = JSON.parse(await readFile(fileURLToPath(workflowEvidenceURL), "utf8"));
const matrixFixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
const matrixFailure = await matrixFixture("workflow-failed-successor");
const matrixCancelled = await matrixFixture("agent-cancelled");
const matrixInterrupted = await matrixFixture("agent-tool-interrupted");

{
  const source = (await matrixFixture("graph-step-limit")).evidence.filter(({ kind }) => kind !== "component.io");
  const calls = new Map();
  const ios = [];
  for (const event of source.filter(({ kind }) => kind === "callback.event")) {
    const { payload, correlation } = event;
    if (payload.phase === "start") calls.set(correlation.entityId, correlation.eventId);
    if (!["start", "end"].includes(payload.phase)) continue;
    ios.push({ protocol: "eino-dag", protocolVersion: 1, kind: "component.io", kindVersion: 1,
      payload: { direction: payload.phase === "start" ? "input" : "output", streaming: false, component: payload.run.component,
        format: `${payload.run.component}.CallbackInput`, address: payload.address, ...(payload.nodePath ? { nodePath: payload.nodePath } : {}), body: { sourceSequence: payload.sequence } },
      correlation: { ...correlation, invocationId: calls.get(correlation.entityId) } });
  }
  // Deliberately reverse global I/O order; explicit event and invocation IDs
  // still bind each body to its own loop visit, never to the latest entity.
  const sourceEnd = source.findLastIndex(({ kind }) => kind === "run.lifecycle");
  const evidence = [...source.slice(0, sourceEnd), ...ios.toReversed(), ...source.slice(sourceEnd)];
  const projected = buildExecutionDAG(evidence);
  assert.equal(projected.ok, true);
  assert.equal(projected.dag.nodes.length, 4);
  const retries = projected.dag.nodes.filter(({ component }) => component === "Lambda");
  assert.equal(retries.length, 3);
  for (const node of retries) {
    const ownEvents = node.evidence.filter(({ kind }) => kind === "callback.event").map(({ envelopeIndex }) => evidence[envelopeIndex]);
    const ownIO = node.evidence.filter(({ kind }) => kind === "component.io").map(({ envelopeIndex }) => evidence[envelopeIndex]);
    assert.equal(ownIO.length, 2);
    assert.deepEqual(ownIO.map(({ payload }) => payload.body.sourceSequence).sort((a, b) => a - b), ownEvents.map(({ payload }) => payload.sequence));
    assert.equal(ownIO.every(({ correlation }) => correlation.invocationId === ownEvents[0].correlation.eventId), true);
  }
  const mismatched = structuredClone(evidence);
  const wrong = mismatched.find(({ kind, payload }) => kind === "component.io" && payload.component === "Lambda");
  wrong.correlation.invocationId = "different-invocation";
  const unresolved = buildExecutionDAG(mismatched).dag.nodes.find(({ metadata }) => metadata.ioCorrelation === "unresolved");
  assert.equal(unresolved.status, "incomplete");
  assert.equal(unresolved.evidence.length, 1, "explicit mismatches remain unattached source evidence");
}

{
  for (const name of ["workflow-io-success", "workflow-io-failed"]) {
    const record = await matrixFixture(name);
    const dag = buildExecutionDAG(record.evidence).dag;
    assert.deepEqual(dag.nodes.map(({ metadata }) => metadata.sourceNodePath), [["process"]], "root I/O is a run boundary, not an invented Workflow step");
    assert.equal(dag.nodes[0].status, name === "workflow-io-success" ? "success" : "failed");
  }
}

{
  const original = (await matrixFixture("graph-io-structured")).evidence;
  const start = original.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "start" && payload.nodePath?.[0] === "process");
  for (const mutate of [
    (entries) => { entries.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "end" && payload.nodePath?.[0] === "process").correlation.invocationId = "foreign"; },
    (entries) => { const io = entries.find(({ kind, payload }) => kind === "component.io" && payload.direction === "output" && payload.nodePath?.[0] === "process"); io.payload.address.at(-1).id = "foreign"; io.payload.nodePath = ["foreign"]; },
    (entries) => { entries.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "end" && payload.nodePath?.[0] === "process").payload.streaming = true; },
  ]) {
    const entries = structuredClone(original);
    mutate(entries);
    const dag = buildExecutionDAG(entries).dag;
    const visit = dag.nodes.find(({ correlation, metadata }) => correlation.invocationId === start.correlation.invocationId && metadata.ioCorrelation !== "unresolved");
    const output = entries.findIndex(({ kind, payload }) => kind === "component.io" && payload.direction === "output" && payload.component === "Lambda");
    assert.equal(visit.evidence.some(({ envelopeIndex }) => envelopeIndex === output), false, "contradictory source identity cannot attach I/O to this visit");
    assert.ok(dag.nodes.some(({ metadata }) => metadata.ioCorrelation === "unresolved"));
    if (entries.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "end" && payload.nodePath?.[0] === "process").correlation.invocationId === "foreign") assert.equal(visit.status, "incomplete", "foreign terminal cannot close the original invocation");
  }
}

{
  const anchor = {
    protocol: "eino-dag",
    protocolVersion: 1,
    kind: "workflow.snapshot",
    kindVersion: 1,
    payload: workflowSnapshot,
    correlation: { runId: "run-weather-workflow-1" },
  };
  const result = buildExecutionDAG([anchor, ...workflowEvidence]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.dag.nodes.map(({ id }) => id), [
    "build-context", "generate-answer", "get-weather", "parse-city",
  ]);
  assert.deepEqual(result.dag.nodes.map(({ evidence }) => evidence.length), [3, 3, 3, 3]);
  assert.equal(result.dag.nodes.every(({ status }) => status === "success"), true);
  assert.equal(result.dag.nodes.some(({ id }) => id.startsWith("component:")), false);
  assert.deepEqual(result.dag.edges.map(({ from, to }) => [from, to]), [
    ["build-context", "generate-answer"],
    ["get-weather", "build-context"],
    ["parse-city", "get-weather"],
  ]);
}

{
  const result = buildExecutionDAG(weather);
  assert.equal(result.ok, true);
  assert.equal(result.dag.runId, "run-weather-agent-1");
  assert.equal(result.dag.status, "success");
  assert.deepEqual(result.dag.nodes.map(({ kind }) => kind), ["input", "tool", "output"]);
  assert.deepEqual(result.dag.nodes.map(({ label }) => label), [
    "schema.message · user",
    "tool · get_weather",
    "schema.message · assistant",
  ]);
  assert.equal(result.dag.nodes.some(({ label }) => /判断|汇总|最终|decision|summary|final/i.test(label)), false);
  assert.deepEqual(result.dag.edges.map(({ kind }) => kind), ["tool-call", "data"]);
  assert.deepEqual(result.dag.nodes.map(({ evidence }) => evidence.map(({ envelopeIndex }) => envelopeIndex)), [
    [0], [1, 2, 3, 4, 5, 6], [7, 8, 9],
  ]);
  assert.equal(result.dag.nodes.some(({ kind }) => kind === "agent"), false);
  assert.equal(result.dag.nodes.some(({ evidence }) => evidence.some(({ kind }) => kind === "agent.event")), true);
  assert.equal(new Set(result.dag.nodes.flatMap((node) => node.evidence.map((item) => item.envelopeIndex))).size, 10);

  const snapshot = executionDAGToWorkflowSnapshot(result.dag);
  assert.equal(snapshot.workflow.nodes.length, 3);
  assert.equal(snapshot.workflow.edges.length, 4);
  assert.deepEqual(snapshot.execution.nodes.map(({ status }) => status), Array(3).fill("success"));
  assert.deepEqual(snapshot.execution.nodes.map(({ durationMs }) => durationMs), Array(3).fill(null));
  assert.equal(snapshot.execution.nodes.some((node) => "startedAtMs" in node || "finishedAtMs" in node), false);
  assert.equal(snapshot.metadata.projection, "execution-dag-compatibility");
}

{
  const result = buildExecutionDAG(realisticAgent.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.runId, "run-realistic-trip-agent-1");
  assert.equal(result.dag.status, "success");
  assert.deepEqual(result.dag.nodes.map(({ kind }) => kind), [
    "input", "tool", "tool", "tool", "output",
  ]);
  assert.deepEqual(result.dag.nodes.map(({ metadata }) => metadata.toolCallId).filter(Boolean), [
    "call-weather-singapore",
    "call-weather-tokyo",
    "call-air-quality-tokyo",
  ]);
  assert.deepEqual(
    result.dag.nodes.filter(({ kind }) => kind === "tool").map(({ metadata }) => metadata.argumentsJson),
    ['{"city":"Singapore"}', '{"city":"Tokyo"}', '{"city":"Tokyo"}'],
  );
  assert.deepEqual(result.dag.edges.map(({ from, to, kind }) => [from, to, kind]), [
    ["input:user:1", "tool:get_weather:call-weather-singapore", "tool-call"],
    ["input:user:1", "tool:get_weather:call-weather-tokyo", "tool-call"],
    ["tool:get_weather:call-weather-singapore", "tool:get_air_quality:call-air-quality-tokyo", "tool-call"],
    ["tool:get_weather:call-weather-tokyo", "tool:get_air_quality:call-air-quality-tokyo", "tool-call"],
    ["tool:get_air_quality:call-air-quality-tokyo", "output:assistant:1", "data"],
  ]);
  assert.equal(
    new Set(result.dag.nodes.flatMap((node) => node.evidence.map(({ envelopeIndex }) => envelopeIndex))).size,
    realisticAgent.evidence.length,
  );
}

{
  const result = buildExecutionDAG(realisticAgentFailure.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.status, "failed");
  assert.deepEqual(result.dag.nodes.map(({ kind, status }) => [kind, status]), [
    ["input", "success"],
    ["tool", "success"],
    ["tool", "success"],
    ["tool", "failed"],
  ]);
  assert.equal(result.dag.nodes.some(({ kind }) => kind === "error" || kind === "agent"), false);
  const failedTool = result.dag.nodes.at(-1);
  assert.equal(failedTool.metadata.toolName, "get_air_quality");
  assert.match(failedTool.errorMessage, /air quality provider timed out/);
  assert.equal(failedTool.evidence.some(({ kind, role }) => kind === "agent.event" && role === "error"), true);
  assert.deepEqual(
    result.dag.edges.filter(({ to }) => to === failedTool.id).map(({ from }) => from).sort(),
    [
      "tool:get_weather:call-weather-singapore",
      "tool:get_weather:call-weather-tokyo",
    ],
  );
}

{
  const builder = createExecutionDAGBuilder({ runId: "run-weather-agent-1" });
  let stableNodeIds = [];
  for (const envelope of weather) {
    const prefix = builder.append(envelope);
    if (prefix.ok) {
      assert.equal(stableNodeIds.every((id) => prefix.dag.nodes.some((node) => node.id === id)), true);
      stableNodeIds = prefix.dag.nodes.map(({ id }) => id);
    }
  }
  assert.equal(builder.size, 10);
  assert.deepEqual(builder.snapshot(), buildExecutionDAG(weather));
  assert.throws(() => createExecutionDAGBuilder({ runId: "" }), /non-empty string/);
}

{
  const twoRuns = [structuredClone(weather[0]), structuredClone(weather[9])];
  twoRuns[1].correlation.runId = "run-weather-agent-2";
  const single = buildExecutionDAG(twoRuns);
  assert.equal(single.ok, false);
  assert.equal(single.diagnostics[0].code, "execution.mixed_run");
  const partitioned = buildExecutionDAGs(twoRuns);
  assert.equal(partitioned.ok, true);
  assert.deepEqual(partitioned.dags.map(({ runId }) => runId), ["run-weather-agent-1", "run-weather-agent-2"]);
}

{
  const invalid = structuredClone(weather);
  invalid[0].payload.role = 7;
  const result = buildExecutionDAG(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some(({ code, envelopeIndex }) => code === "schema_message.invalid_role" && envelopeIndex === 0), true);
  assert.throws(() => executionDAGToWorkflowSnapshot({}), /ExecutionDAG/);
}

{
  const result = buildExecutionDAG(agents);
  assert.equal(result.ok, true);
  assert.equal(result.dag.status, "failed");
  assert.equal(result.dag.nodes.at(-1).status, "failed");
  assert.equal(result.dag.nodes.at(-1).errorMessage, "weather backend unavailable");
  assert.equal(result.dag.edges.some(({ kind, metadata }) => kind === "transfer" && metadata.destinationAgent === "weather-agent"), true);
  assert.equal(result.dag.nodes.some(({ kind }) => kind === "output"), false);
}

{
  const componentInput = structuredClone(weather[2]);
  const failure = structuredClone(agents[2]);
  componentInput.correlation.runId = "run-visible-failure";
  failure.correlation.runId = "run-visible-failure";
  const input = structuredClone(weather[0]);
  input.correlation.runId = "run-visible-failure";
  const result = buildExecutionDAG([input, componentInput, failure]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.dag.nodes.map(({ kind }) => kind), ["input", "error"]);
  assert.equal(result.dag.nodes.some(({ kind }) => kind === "agent" || kind === "output"), false);
  assert.deepEqual(result.dag.nodes[1].evidence.map(({ envelopeIndex }) => envelopeIndex), [1, 2]);
}

{
  const unusedTool = [structuredClone(weather[0]), structuredClone(weather[1]), structuredClone(weather[9])];
  const result = buildExecutionDAG(unusedTool);
  assert.equal(result.ok, true);
  assert.deepEqual(result.dag.nodes.map(({ kind }) => kind), ["input", "output"]);
  assert.equal(result.dag.nodes.some(({ kind }) => kind === "tool"), false);
}

{
  const result = buildExecutionDAG(callbacks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.dag.nodes.map(({ label, status }) => [label, status]), [
    ["Prepare", "success"], ["Invoke", "failed"],
  ]);
  assert.equal(result.dag.nodes[1].metadata.streaming, true);
  assert.deepEqual(result.dag.nodes.map(({ evidence }) => evidence.length), [2, 2]);
}

{
  const streaming = structuredClone(agents[0]);
  streaming.correlation.runId = "run-stream";
  streaming.payload.output.message.streaming = true;
  delete streaming.payload.output.message.value;
  const customized = structuredClone(agents[0]);
  customized.correlation.runId = "run-custom-output";
  customized.payload.output = { customizedOutput: { route: "weather" } };
  const streamingResult = buildExecutionDAG([streaming]);
  const customizedResult = buildExecutionDAG([customized]);
  assert.equal(streamingResult.ok, true);
  assert.equal(streamingResult.dag.status, "running");
  assert.equal(streamingResult.dag.nodes[0].metadata.streaming, true);
  const streamingSnapshot = executionDAGToWorkflowSnapshot(streamingResult.dag);
  assert.equal(streamingSnapshot.execution.nodes[0].status, "skipped");
  assert.equal(streamingSnapshot.execution.nodes[0].durationMs, null);
  assert.equal("startedAtMs" in streamingSnapshot.execution.nodes[0], false);
  assert.equal(customizedResult.ok, true);
  assert.deepEqual(customizedResult.dag.nodes[0].metadata.customizedOutput, { route: "weather" });
}

{
  const sequence = [structuredClone(weather[0])];
  const decision1 = structuredClone(weather[3]);
  const result1 = structuredClone(weather[6]);
  const decision2 = structuredClone(weather[3]);
  const result2 = structuredClone(weather[6]);
  const answer = structuredClone(weather[8]);
  const output = structuredClone(weather[9]);
  decision1.payload.output.message.value.tool_calls[0].id = "call-1";
  result1.payload.output.message.value.tool_call_id = "call-1";
  decision2.payload.output.message.value.tool_calls[0].id = "call-2";
  result2.payload.output.message.value.tool_call_id = "call-2";
  sequence.push(decision1, result1, decision2, result2, answer, output);
  const result = buildExecutionDAG(sequence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.nodes.filter(({ kind }) => kind === "tool").length, 2);
  assert.equal(result.dag.edges.filter(({ kind }) => kind === "tool-call").length, 2);
  assert.equal(new Set(result.dag.nodes.map(({ id }) => id)).size, result.dag.nodes.length);
}

{
  const result = buildExecutionDAG(matrixFailure.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.status, "failed");
  assert.deepEqual(result.dag.nodes.map(({ id, status }) => [id, status]), [["fail", "failed"], ["prepare", "success"]]);
  assert.equal(result.dag.nodes.some(({ id }) => id === "after"), false);
  assert.equal(result.dag.edges.some(({ from, to }) => from === "after" || to === "after"), false);
  const failedNode = result.dag.nodes.find(({ id }) => id === "fail");
  assert.equal(failedNode.errorMessage, "matrix planned validation failure");
  assert.equal(failedNode.metadata.executionStatusSource, "workflow.snapshot");
  const sourceExecution = matrixFailure.evidence[0].payload.execution.nodes.find(({ path }) => path[0] === "fail");
  assert.equal(failedNode.startedAtMs, sourceExecution.startedAtMs);
  assert.equal(failedNode.finishedAtMs, sourceExecution.finishedAtMs);
  assert.ok(failedNode.evidence.some(({ kind }) => kind === "workflow.snapshot"));
  assert.ok(failedNode.evidence.some(({ kind, role }) => kind === "component.io" && role === "input"));

  // Snapshot outcomes remain authoritative even when the snapshot is observed
  // after component evidence, or callback observation time differs from execution.
  const reordered = structuredClone(matrixFailure.evidence);
  const [snapshot] = reordered.splice(0, 1);
  reordered.splice(reordered.length - 1, 0, snapshot);
  for (const envelope of reordered.filter(({ kind }) => kind === "component.io")) envelope.observedAtMs += 5_000;
  const reorderedFailure = buildExecutionDAG(reordered).dag.nodes.find(({ id }) => id === "fail");
  assert.equal(reorderedFailure.status, "failed");
  assert.equal(reorderedFailure.errorMessage, failedNode.errorMessage);
  assert.equal(reorderedFailure.startedAtMs, failedNode.startedAtMs);
  assert.equal(reorderedFailure.finishedAtMs, failedNode.finishedAtMs);
}

{
  const definition = await matrixFixture("workflow-definition-only");
  const result = buildExecutionDAG(definition.evidence);
  assert.equal(result.ok, true);
  assert.deepEqual(result.dag.nodes, []);
  assert.deepEqual(result.dag.edges, []);
  assert.equal(result.dag.status, "running");
  assert.deepEqual(result.dag.completion, { state: "unknown", basis: "legacy" });
  const nested = buildExecutionDAG((await matrixFixture("workflow-nested-names")).evidence);
  assert.equal(nested.ok, true);
  assert.deepEqual(nested.dag.nodes.filter(({ label }) => label === "Shared step").map(({ metadata }) => metadata.sourceNodePath), [
    ["left", "shared"], ["right", "shared"],
  ]);
  assert.ok(nested.dag.nodes.every(({ status }) => status === "success"));
}

{
  const result = buildExecutionDAG(matrixCancelled.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.status, "cancelled");
  assert.ok(result.dag.nodes.every(({ status }) => status !== "running"));
  const tool = result.dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(tool.status, "incomplete");
  assert.equal(tool.metadata.executionState, "planned");
  assert.equal(tool.errorMessage, undefined);
  assert.equal(tool.startedAtMs, undefined);
  assert.equal(tool.finishedAtMs, undefined);
  const cancellationIndex = matrixCancelled.evidence.findIndex(({ payload }) => payload.error);
  assert.equal(tool.evidence.some(({ envelopeIndex }) => envelopeIndex === cancellationIndex), false);
  const runError = result.dag.nodes.find(({ kind }) => kind === "error");
  assert.equal(runError.status, "cancelled");
  assert.match(runError.errorMessage, /agent canceled/);
  assert.ok(runError.evidence.some(({ envelopeIndex }) => envelopeIndex === cancellationIndex));
  const snapshot = executionDAGToWorkflowSnapshot(result.dag);
  assert.equal(snapshot.workflow.nodes.find(({ id }) => id === tool.id).metadata.executionStatus, "incomplete");
  assert.equal(snapshot.workflow.nodes.find(({ id }) => id === runError.id).metadata.executionStatus, "cancelled");
  assert.equal(snapshot.execution.nodes.some(({ path }) => path[0] === tool.id || path[0] === runError.id), false);

  const legacy = matrixCancelled.evidence.filter(({ kind }) => kind !== "run.lifecycle");
  assert.equal(buildExecutionDAG(legacy).dag.nodes.find(({ kind }) => kind === "tool").status, "running");
}

{
  const result = buildExecutionDAG(matrixInterrupted.evidence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.status, "incomplete");
  const tool = result.dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(tool.status, "incomplete");
  assert.equal(tool.metadata.executionState, "interrupted");
  assert.equal(tool.metadata.interruptionReason, "approval required for booking");
  assert.equal(tool.finishedAtMs, undefined);
  const interruptionIndex = matrixInterrupted.evidence.findIndex(({ payload }) => payload.action?.interrupted);
  assert.ok(tool.evidence.some(({ envelopeIndex, role }) => envelopeIndex === interruptionIndex && role === "interruption"));
  assert.equal(result.dag.nodes.some(({ kind }) => kind === "error"), false);

  // Correlation uses exact tool subId, never a name or prefix guess.
  const mismatched = structuredClone(matrixInterrupted.evidence);
  const interrupt = mismatched[interruptionIndex].payload.action.interrupted;
  interrupt.contexts[0].address.find(({ type }) => type === "tool").subId += "-extra";
  const mismatchResult = buildExecutionDAG(mismatched);
  assert.equal(mismatchResult.ok, true);
  const observed = mismatchResult.dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(observed.status, "incomplete");
  assert.equal(observed.metadata.executionState, "unrecorded");
  assert.equal(observed.metadata.interruptionReason, undefined);
  assert.equal(observed.finishedAtMs, undefined);
  const unassociated = mismatchResult.dag.nodes.find(({ kind }) => kind === "error");
  assert.equal(unassociated.status, "incomplete");
  assert.equal(unassociated.metadata.scope, "run");
  assert.equal(unassociated.metadata.interruptionReason, "approval required for booking");
  assert.ok(unassociated.evidence.some(({ envelopeIndex }) => envelopeIndex === interruptionIndex));

  const dataOnly = structuredClone(matrixInterrupted.evidence);
  dataOnly[interruptionIndex].payload.action.interrupted = { contexts: [], data: { reason: "manual approval required" } };
  const dataOnlyInterruption = buildExecutionDAG(dataOnly).dag.nodes.find(({ kind }) => kind === "error");
  assert.equal(dataOnlyInterruption.metadata.interruptionReason, JSON.stringify({ reason: "manual approval required" }));

  const contextFallback = structuredClone(matrixInterrupted.evidence);
  delete contextFallback[interruptionIndex].payload.action.interrupted.contexts[0].info;
  contextFallback[interruptionIndex].payload.action.interrupted.data = "approval is required before booking";
  const fallbackTool = buildExecutionDAG(contextFallback).dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(fallbackTool.metadata.executionState, "interrupted");
  assert.equal(fallbackTool.metadata.interruptionReason, "approval is required before booking");

  // A tool middleware can interrupt after a component produced its value.
  // Only later terminal evidence for this same invocation can settle it again.
  const toolInput = matrixInterrupted.evidence.find(({ kind, payload }) => kind === "component.io" && payload.component === "Tool");
  const toolOutput = structuredClone(toolInput);
  toolOutput.payload.direction = "output";
  const outputBeforeInterruption = structuredClone(matrixInterrupted.evidence);
  outputBeforeInterruption.splice(interruptionIndex, 0, structuredClone(toolOutput));
  const interruptedAfterOutput = buildExecutionDAG(outputBeforeInterruption).dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(interruptedAfterOutput.status, "incomplete");
  assert.equal(interruptedAfterOutput.metadata.executionState, "interrupted");
  const outputAfterInterruption = structuredClone(matrixInterrupted.evidence);
  outputAfterInterruption.splice(interruptionIndex + 1, 0, structuredClone(toolOutput));
  const settledAfterInterruption = buildExecutionDAG(outputAfterInterruption).dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(settledAfterInterruption.status, "success");
  assert.equal(settledAfterInterruption.metadata.executionState, undefined);
  assert.ok(settledAfterInterruption.evidence.some(({ role }) => role === "interruption"));

  // A context can arrive before the related callbacks or assistant declaration.
  const early = structuredClone(matrixInterrupted.evidence);
  const [earlyInterruption] = early.splice(interruptionIndex, 1);
  early.splice(2, 0, earlyInterruption);
  const earlyTool = buildExecutionDAG(early).dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(earlyTool.metadata.executionState, "interrupted");
  assert.equal(earlyTool.metadata.interruptionReason, tool.metadata.interruptionReason);
}

{
  const evidence = structuredClone(realisticAgentFailure.evidence);
  const error = evidence.find(({ payload }) => payload.error);
  error.payload.error.message = "failure in call-air-quality-tokyo-extra";
  const result = buildExecutionDAG(evidence);
  assert.equal(result.ok, true);
  assert.equal(result.dag.nodes.find(({ metadata }) => metadata.toolCallId === "call-air-quality-tokyo").status, "running");
  assert.ok(result.dag.nodes.some(({ kind, errorMessage }) => kind === "error" && errorMessage === error.payload.error.message));
  error.payload.error.message = "failure in call-air-quality-tokyo.extra";
  const dottedSuffix = buildExecutionDAG(evidence);
  assert.equal(dottedSuffix.dag.nodes.find(({ metadata }) => metadata.toolCallId === "call-air-quality-tokyo").status, "running");
  assert.ok(dottedSuffix.dag.nodes.some(({ kind }) => kind === "error"));
  error.correlation.toolCallId = "unknown-explicit-call";
  error.payload.error.message = "failure in call-air-quality-tokyo";
  const explicitMismatch = buildExecutionDAG(evidence);
  assert.equal(explicitMismatch.dag.nodes.find(({ metadata }) => metadata.toolCallId === "call-air-quality-tokyo").status, "running");
  assert.ok(explicitMismatch.dag.nodes.some(({ kind }) => kind === "error"));
  error.correlation.toolCallId = "call-air-quality-tokyo";
  error.payload.error.message = "explicitly correlated tool failure";
  const explicitMatch = buildExecutionDAG(evidence);
  assert.equal(explicitMatch.dag.nodes.find(({ metadata }) => metadata.toolCallId === "call-air-quality-tokyo").status, "failed");
}

{
  for (const name of ["distinct-results", "parallel-scopes", "failure-recovered", "failure-propagated"]) {
    const { evidence } = await matrixFixture(`agent-nested-${name}`);
    const projected = buildExecutionDAG(evidence);
    assert.equal(projected.ok, true, name);
    const dag = projected.dag;
    assert.equal(dag.status, name === "failure-propagated" ? "failed" : "success");
    assert.equal(new Set(dag.nodes.map(({ id }) => id)).size, dag.nodes.length);
    const tools = dag.nodes.filter(({ kind }) => kind === "tool");
    assert.equal(tools.length, name === "parallel-scopes" ? 4 : 2, "unassigned tool-request events must not manufacture duplicate executions");
    for (const node of tools) {
      const io = node.evidence.map(({ envelopeIndex }) => evidence[envelopeIndex]).filter(({ kind, payload }) => kind === "component.io" && payload.component === "Tool");
      const addresses = new Set(io.map(({ payload }) => JSON.stringify(payload.address)));
      assert.equal(addresses.size, 1, `${name}: a tool step owns exactly one full source address`);
      assert.equal(io.every(({ payload }) => payload.address.findLast(({ type }) => type === "tool").subId === node.correlation.toolCallId), true);
    }
    const children = dag.nodes.filter(({ metadata }) => metadata.parentAgentScopeId);
    assert.ok(children.length > 0);
    const links = dag.edges.filter(({ kind }) => kind === "parent-child");
    assert.equal(links.length, name === "parallel-scopes" ? 2 : 1);
    for (const link of links) {
      const parent = dag.nodes.find(({ id }) => id === link.from);
      const child = dag.nodes.find(({ id }) => id === link.to);
      assert.equal(parent.kind, "tool");
      assert.equal(parent.metadata.agentScopeId, child.metadata.parentAgentScopeId);
    }
    if (name === "parallel-scopes") {
      const ambiguousIndexes = evidence.flatMap((entry, index) => entry.kind === "agent.event" && entry.payload.runPath?.length === 2 ? [index] : []);
      for (const index of ambiguousIndexes) {
        const owners = dag.nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
        assert.equal(owners.length, 1);
        assert.equal(owners[0].metadata.agentScopeUnresolved, true);
        assert.equal(owners[0].kind, "event");
      }
    }
    if (name.startsWith("failure")) {
      const errorIndex = evidence.findIndex(({ kind, payload }) => kind === "callback.event" && payload.phase === "error");
      const failed = dag.nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === errorIndex));
      assert.equal(failed.length, 1);
      assert.equal(failed[0].kind, "tool");
      assert.equal(failed[0].status, "failed");
      assert.ok(failed[0].metadata.parentAgentScopeId);
      assert.equal(failed[0].errorMessage, evidence[errorIndex].payload.error.message);
    }
  }
}

{
  const parallel = await matrixFixture("agent-nested-parallel-scopes");
  for (const mode of ["missing-one-child-scope", "missing-whole-fast-address", "missing-all-child-components"]) {
    const evidence = parallel.evidence.filter(({ kind, payload }) => {
      if (mode === "missing-whole-fast-address") return !payload.address?.some(({ type, subId }) => type === "tool" && subId === "call-child-fast");
      if (kind !== "component.io" || payload.address.filter(({ type }) => type === "agent").length < 2) return true;
      return mode === "missing-one-child-scope" && !payload.address.some(({ subId }) => subId === "call-child-fast");
    });
    const dag = buildExecutionDAG(evidence).dag;
    const nestedEvents = evidence.flatMap((entry, index) => entry.kind === "agent.event" && entry.payload.runPath?.length === 2 ? [index] : []);
    for (const index of nestedEvents) {
      const owners = dag.nodes.filter((node) => node.evidence.some(({ envelopeIndex }) => envelopeIndex === index));
      assert.equal(owners.length, 1);
      assert.equal(owners[0].metadata.agentScopeUnresolved, true, `${mode}: missing addresses must not turn ambiguous names into proof`);
    }
    const inner = dag.nodes.filter(({ correlation }) => correlation.toolCallId === "shared-inner-call");
    assert.equal(inner.length, mode === "missing-all-child-components" ? 0 : 1);
  }
}

{
  const source = await matrixFixture("agent-nested-failure-propagated");
  // Reusing the ID in the outer scope does not make a nested error's text an
  // explicit error boundary for that outer invocation.
  const evidence = JSON.parse(JSON.stringify(source.evidence).replaceAll("call-child-one", "shared-inner-call"));
  const dag = buildExecutionDAG(evidence).dag;
  const outer = dag.nodes.find(({ kind, metadata }) => kind === "tool" && !metadata.parentAgentScopeId);
  const inner = dag.nodes.find(({ kind, metadata }) => kind === "tool" && metadata.parentAgentScopeId);
  assert.equal(outer.correlation.toolCallId, inner.correlation.toolCallId);
  assert.equal(outer.status, "incomplete");
  assert.equal(inner.status, "failed");
  const rootErrorIndex = evidence.findIndex(({ kind, payload }) => kind === "agent.event" && payload.runPath?.length === 1 && payload.error);
  assert.equal(outer.evidence.some(({ envelopeIndex }) => envelopeIndex === rootErrorIndex), false);
}

{
  const directory = new URL("../fixtures/recorder-matrix/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== "manifest.json")) {
    const record = JSON.parse(await readFile(new URL(name, directory), "utf8"));
    const projected = buildExecutionDAG(record.evidence);
    assert.equal(projected.ok, true, name);
    const snapshot = executionDAGToWorkflowSnapshot(projected.dag);
    const validation = validateWorkflowSnapshot(snapshot);
    assert.equal(validation.valid, true, `${name}: ${JSON.stringify(validation.errors)}`);
    assert.equal(snapshot.workflow.nodes.some(({ kind, workflow }) => kind === "graph" && !workflow), false, name);
  }
}

{
  const dag = buildExecutionDAG(weather).dag;
  assert.equal(dag.startedAtMs, undefined, "first input observation is not a recorded whole-run start");
  assert.equal(dag.finishedAtMs, undefined, "last message observation is not a recorded whole-run end");
  const tool = dag.nodes.find(({ kind }) => kind === "tool");
  assert.equal(tool.startedAtMs, weather[4].observedAtMs);
  assert.equal(tool.finishedAtMs, weather[5].observedAtMs, "later Agent tool-result observation cannot extend the tool boundary");
  assert.ok(dag.nodes.filter(({ kind }) => kind === "input" || kind === "output").every((node) => node.startedAtMs === undefined && node.finishedAtMs === undefined));
  const evidence = structuredClone((await matrixFixture("graph-io-structured")).evidence);
  const start = evidence.find(({ kind, payload }) => kind === "run.lifecycle" && payload.state === "started");
  const end = evidence.find(({ kind, payload }) => kind === "run.lifecycle" && payload.state === "ended");
  start.observedAtMs = 0;
  end.observedAtMs = 200;
  const recorded = buildExecutionDAG(evidence).dag;
  assert.equal(recorded.startedAtMs, 0);
  assert.equal(recorded.finishedAtMs, 200);
  const open = buildExecutionDAG(evidence.filter((entry) => entry !== end)).dag;
  assert.equal(open.startedAtMs, 0);
  assert.equal(open.finishedAtMs, undefined, "completed children cannot invent a missing run end");
  end.observedAtMs = 0;
  start.observedAtMs = 200;
  const reversed = buildExecutionDAG(evidence).dag;
  assert.equal(reversed.startedAtMs, undefined, "invalid source clock stays in evidence, not compatibility timestamps");
  assert.equal(reversed.finishedAtMs, undefined);
  assert.equal(validateWorkflowSnapshot(executionDAGToWorkflowSnapshot(reversed)).valid, true);
}

console.log("OK: execution DAG correlates real, incremental, repeated, transferred, callback, failed, cancelled, and interrupted runs");
