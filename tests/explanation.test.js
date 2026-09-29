import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  explainEino,
  explainEinoEnvelope,
  explainExecutionDAG,
  explainWorkflowSnapshot,
} from "../src/explanation.js";
import { buildExecutionDAG } from "../src/execution-dag.js";

async function fixture(name) {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), "utf8"));
}

const weather = await fixture("eino-agent-weather-scenario-v1.json");
const callbacks = await fixture("eino-callback-events-v1.json");
const agents = await fixture("eino-agent-events-v1.json");
const compose = await fixture("eino-compose-graph-envelope-v1.json");
const schemas = await fixture("eino-schema-domains-v1.json");
const components = await fixture("eino-component-io-v1.json");
const workflow = await fixture("eino-workflow-v1.json");

{
  const graph = (await fixture("recorder-matrix/graph-step-limit.json")).evidence.find(({ kind }) => kind === "compose.graph");
  const dag = buildExecutionDAG([graph]).dag;
  for (const result of [explainEino(graph), explainEino([graph]), explainExecutionDAG(dag, [graph])]) {
    assert.equal(result.ok, true);
    const explanation = result.explanation;
    assert.equal(explanation.subject, "graph");
    assert.equal(explanation.status, "declared");
    assert.equal(explanation.basis, "declared");
    assert.equal(explanation.run.result.state, "definition-only");
    assert.match(explanation.summary, /no execution was recorded/);
    for (const node of explanation.nodes) {
      assert.equal(node.status, "declared");
      assert.equal(node.basis, "declared");
      assert.equal(node.timing.semantics, "not-observed");
      assert.equal(node.timing.availability, "not-observed");
      assert.equal(node.timing.durationMs, undefined);
      assert.deepEqual(node.timing.evidenceEnvelopeIndexes, []);
      assert.equal(node.input.availability, "not-observed");
      assert.equal(node.output.availability, "not-observed");
      assert.ok([...node.causes, ...node.effects].every(({ basis, summary }) => basis === "declared" && !/completed/.test(summary)));
    }
  }
  const declaredWorkflow = await fixture("recorder-matrix/workflow-definition-only.json");
  for (const result of [explainEino(declaredWorkflow.evidence), explainExecutionDAG(buildExecutionDAG(declaredWorkflow.evidence).dag, declaredWorkflow.evidence)]) {
    assert.equal(result.explanation.subject, "workflow");
    assert.equal(result.explanation.status, "declared");
    assert.ok(result.explanation.nodes.length > 0);
    assert.ok(result.explanation.nodes.every(({ status, basis }) => status === "declared" && basis === "declared"));
  }
}

function summaryEnvelope(kind, payload, extra = {}) {
  return { protocol: "eino-dag", protocolVersion: 1, kind, kindVersion: 1, payload,
    correlation: { runId: "summary-test" }, ...extra };
}

function summaryRoot(direction, value, metadata) {
  return summaryEnvelope("component.io", {
    direction, streaming: value === undefined && !metadata, component: "Graph", format: `Graph.Callback${direction === "input" ? "Input" : "Output"}`,
    address: [{ type: "runnable", id: "summary-root" }], ...(value !== undefined ? { body: value } : {}),
  }, metadata ? { metadata } : {});
}

function summaryRun(input, output, capture = "complete") {
  return [summaryEnvelope("run.lifecycle", { state: "started" }), input, ...(output ? [output] : []),
    summaryEnvelope("run.lifecycle", { state: "ended", outcome: "success", capture })];
}

{
  for (const [value, availability] of [["", "empty"], [null, "null"], [0, "available"], [false, "available"], ['{"answer":42}', "available"]]) {
    const envelopes = summaryRun(summaryRoot("input", value), summaryRoot("output", value));
    const before = JSON.stringify(envelopes);
    const result = explainEino(envelopes).explanation.run;
    assert.equal(result.result.state, "success");
    assert.equal(result.capture.status, "complete");
    for (const direction of ["input", "output"]) {
      assert.equal(result[direction].availability, "available");
      assert.equal(result[direction].items[0].availability, availability);
      assert.deepEqual(result[direction].items[0].value, value, "values are not parsed or coerced");
    }
    assert.deepEqual(result.input.items[0].evidenceEnvelopeIndexes, [1]);
    assert.deepEqual(result.output.items[0].evidenceEnvelopeIndexes, [2]);
    assert.equal(JSON.stringify(envelopes), before);
    assert.equal(Object.isFrozen(envelopes[1]), false, "summary never freezes caller-owned input");
  }
  const noOutput = explainEino(summaryRun(summaryRoot("input", undefined))).explanation.run;
  assert.equal(noOutput.input.availability, "not-observed");
  assert.equal(noOutput.input.items[0].availability, "not-observed");
  assert.equal(Object.hasOwn(noOutput.input.items[0], "value"), false);
  assert.equal(noOutput.output.availability, "not-observed");
  assert.equal(noOutput.capture.status, "complete", "record completeness is not body coverage");
  assert.match(noOutput.capture.limitations.join(" "), /Root input.*No verified final/);

  const omitted = summaryRoot("output", undefined, { io: { scope: "root" }, capture: { status: "omitted", reason: "size_limit" } });
  const missing = explainEino(summaryRun(summaryRoot("input", "request"), omitted, "partial")).explanation.run;
  assert.equal(missing.result.state, "success");
  assert.equal(missing.output.items[0].availability, "not-observed");
  assert.equal(missing.output.items[0].reason, "size_limit");
  assert.match(missing.output.summary, /size_limit/);
  const redacted = summaryRoot("output", "replacement", { capture: { status: "captured", redacted: true } });
  assert.equal(explainEino(summaryRun(summaryRoot("input", "request"), redacted, "partial")).explanation.run.output.availability, "redacted");
  const flagged = summaryRun(summaryRoot("input", "request"), summaryRoot("output", "shortened"), "partial");
  const diagnostic = { severity: "warning", code: "projection.truncated", path: "/payload/body", message: "Body shortened.", envelopeIndex: 2 };
  assert.equal(explainEino(flagged, { diagnostics: [diagnostic] }).explanation.run.output.items[0].availability, "truncated");
  assert.equal(explainEino(flagged, { diagnostics: [{ ...diagnostic, envelopeIndex: undefined }] }).explanation.run.output.items[0].availability, "available", "unscoped diagnostics cannot label a particular value");
  assert.equal(explainEino(flagged, { diagnostics: [{ ...diagnostic, path: "/payload/name" }] }).explanation.run.output.items[0].availability, "available", "an unrelated redacted field is not the body");
}

{
  const direct = await fixture("recorder-matrix/agent-direct-answer.json");
  const result = explainEino(direct.evidence).explanation.run;
  assert.equal(result.input.items[0].value, "请直接打个招呼。");
  assert.equal(result.output.items[0].value, "你好，运行已完成。");
  assert.equal(result.output.items[0].evidenceEnvelopeIndexes.length, 2);
  const legacy = direct.evidence.filter(({ kind }) => kind !== "run.lifecycle");
  assert.equal(explainEino(legacy).explanation.run.result.state, "unknown");
  assert.equal(explainEino(legacy).explanation.run.output.availability, "not-observed");
  assert.equal(explainEino(direct.evidence.slice(0, -1)).explanation.run.output.availability, "not-observed", "an intermediate assistant does not prove a final answer");
  const nested = structuredClone(direct.evidence);
  nested.find(({ kind }) => kind === "agent.event").payload.runPath.push("nested-child");
  assert.equal(explainEino(nested).explanation.run.output.availability, "not-observed", "child Agent output is not root output");
  const noDerivedFinal = direct.evidence.filter(({ kind, payload }) => !(kind === "schema.message" && payload.role === "assistant"));
  assert.equal(explainEino(noDerivedFinal).explanation.run.output.availability, "not-observed");
  const reordered = structuredClone(direct.evidence);
  const final = reordered.find(({ kind, payload }) => kind === "schema.message" && payload.role === "assistant");
  final.payload = Object.fromEntries(Object.entries(final.payload).reverse());
  assert.equal(explainEino(reordered).explanation.run.output.availability, "available", "JSON member ordering is not message identity");
  const foreign = structuredClone(direct.evidence);
  for (const envelope of foreign) envelope.correlation.runId = "another-run";
  const mixed = [...foreign, ...direct.evidence];
  const scoped = explainEino(mixed, { runId: direct.runId }).explanation;
  assert.deepEqual(scoped.run.input.items[0].evidenceEnvelopeIndexes, [foreign.length + 1]);
  assert.ok(scoped.nodes.flatMap(({ evidence }) => evidence).every(({ envelopeIndex }) => envelopeIndex >= foreign.length), "all source indexes retain the caller's collection coordinates");
  for (const [name, state] of [["agent-tool-recovered", "success"], ["agent-cancelled", "cancelled"], ["agent-tool-interrupted", "interrupted"], ["graph-step-limit", "failed"], ["workflow-failed-successor", "failed"], ["workflow-definition-only", "definition-only"]]) {
    const record = await fixture(`recorder-matrix/${name}.json`);
    const summary = explainEino(record.evidence, { locale: "zh" }).explanation.run;
    assert.equal(summary.result.state, state, name);
    if (name === "agent-tool-recovered") assert.equal(summary.issues.length, 0, "arbitrary tool-body error/recovered text is not a protocol execution error");
    if (["failed", "cancelled", "interrupted"].includes(state)) {
      assert.equal(summary.output.availability, "not-observed", name);
      assert.ok(summary.issues.length, `${name} keeps its issue evidence`);
      assert.ok(summary.issues.every((issue) => issue.evidenceEnvelopeIndexes.length));
    }
    if (state === "definition-only") assert.match(summary.result.label, /没有执行记录/);
  }
  const record = await fixture("recorder-matrix/agent-redacted-tool.json");
  const redacted = explainEino(record.evidence, { diagnostics: record.diagnostics }).explanation.run;
  assert.equal(redacted.result.state, "success");
  assert.equal(redacted.capture.status, "partial");
  assert.match(redacted.capture.limitations.join(" "), /redaction/);
  const definition = await fixture("recorder-matrix/workflow-definition-only.json");
  const snapshotExplanation = explainWorkflowSnapshot(definition.evidence[0].payload, { envelopes: definition.evidence, locale: "zh" }).explanation.run;
  assert.deepEqual(snapshotExplanation.result.evidenceEnvelopeIndexes, [0]);
  assert.match(snapshotExplanation.result.label, /没有执行记录/);

  const recovery = structuredClone((await fixture("recorder-matrix/agent-tool-recovered.json")).evidence);
  const toolResultIndex = recovery.findIndex(({ kind, payload }) => kind === "agent.event" && payload.output?.message?.role === "tool");
  recovery.splice(toolResultIndex, 0, summaryEnvelope("agent.event", {
    agentName: "static-matrix-tool-recovered", runPath: ["static-matrix-tool-recovered"], error: { message: "provider unavailable" },
  }, { correlation: { runId: recovery[0].correlation.runId, toolCallId: "call-tool-recovered" } }));
  const recovered = explainEino(recovery).explanation.run;
  assert.equal(recovered.result.state, "success");
  assert.equal(recovered.issues.length, 1);
  assert.equal(recovered.issues[0].recovered, true, "same-call result after source error establishes recovery");
  const unresolved = recovery.filter((entry, index) => index !== toolResultIndex + 1);
  assert.equal(explainEino(unresolved).explanation.run.issues[0].recovered, false, "run success alone does not erase or recover a local error");
}

{
  const nestedOutput = summaryRoot("output", "not a root result");
  nestedOutput.payload.address.push({ type: "node", id: "last-child" });
  assert.equal(explainEino(summaryRun(summaryRoot("input", "request"), nestedOutput)).explanation.run.output.availability, "not-observed");
  const envelopes = summaryRun(summaryRoot("input", "request"));
  const dag = buildExecutionDAG(envelopes).dag;
  const late = [...envelopes, summaryRoot("output", "after the run ended")];
  assert.equal(explainExecutionDAG(dag, late).explanation.run.output.availability, "not-observed", "even caller-supplied DAG evidence cannot introduce a post-end result");
  const wrongCallback = summaryRoot("output", "wrong visit");
  wrongCallback.correlation.eventId = "unobserved-callback";
  assert.equal(explainEino(summaryRun(summaryRoot("input", "request"), wrongCallback)).explanation.run.output.availability, "not-observed");
}

{
  for (const name of ["graph-io-structured", "graph-io-empty", "graph-io-null", "graph-io-long", "graph-io-oversized", "graph-io-redacted", "graph-io-failed", "graph-io-cancelled", "workflow-io-success", "workflow-io-failed"]) {
    const record = await fixture(`recorder-matrix/${name}.json`);
    const result = explainEino(record.evidence, { diagnostics: record.diagnostics });
    assert.equal(result.ok, true, name);
    const summary = result.explanation.run;
    const ended = record.evidence.find(({ kind, payload }) => kind === "run.lifecycle" && payload.state === "ended");
    assert.equal(summary.result.state, ended.payload.outcome, name);
    assert.equal(summary.capture.status, ended.payload.capture, name);
    for (const direction of ["input", "output"]) {
      const index = record.evidence.findIndex(({ kind, payload, metadata }) => kind === "component.io" && payload.direction === direction && metadata?.io?.scope === "root");
      if (index < 0) {
        assert.equal(summary[direction].availability, "not-observed", `${name} ${direction}`);
        assert.equal(summary[direction].items.length, 0);
      } else {
        const source = record.evidence[index];
        assert.equal(summary[direction].items.length, 1);
        assert.deepEqual(summary[direction].items[0].evidenceEnvelopeIndexes, [index], `${name} exact root evidence`);
        assert.deepEqual(summary[direction].items[0].value, source.payload.body, `${name} preserve complete root value`);
        if (source.metadata.capture?.status === "omitted") {
          assert.equal(summary[direction].items[0].availability, "not-observed");
          assert.equal(summary[direction].items[0].reason, source.metadata.capture.reason);
        }
      }
    }
    if (name === "graph-io-long") assert.ok(summary.output.items[0].value.length > 5000, "the data model never truncates for UI display");
    if (name === "graph-io-redacted") assert.equal(summary.output.items[0].availability, "redacted");
    if (name === "graph-io-structured") {
      const wrong = structuredClone(record.evidence);
      wrong.find(({ kind, payload, metadata }) => kind === "component.io" && payload.direction === "output" && metadata?.io?.scope === "root").correlation.invocationId = "foreign-invocation";
      assert.equal(explainEino(wrong).explanation.run.output.availability, "not-observed", "matching callback event without matching invocation cannot establish a root output");
      for (const damage of ["both-invocations", "address", "component", "streaming", "end-before-start"]) {
        const conflicting = structuredClone(record.evidence);
        const io = conflicting.find(({ kind, payload, metadata }) => kind === "component.io" && payload.direction === "output" && metadata?.io?.scope === "root");
        const terminal = conflicting.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "end" && payload.address.length === 1);
        const start = conflicting.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "start" && payload.address.length === 1);
        if (damage === "both-invocations") io.correlation.invocationId = terminal.correlation.invocationId = "foreign";
        if (damage === "address") io.payload.address[0].id = "foreign-root";
        if (damage === "component") terminal.payload.run.component = "Workflow";
        if (damage === "streaming") terminal.payload.streaming = true;
        if (damage === "end-before-start") {
          const first = conflicting.indexOf(start), last = conflicting.indexOf(terminal);
          [conflicting[first], conflicting[last]] = [conflicting[last], conflicting[first]];
        }
        assert.equal(explainEino(conflicting).explanation.run.output.availability, "not-observed", `${damage}: conflicting root identity/boundary cannot supply the final output`);
      }
    }
  }
}

{
  const cancelled = await fixture("recorder-matrix/agent-cancelled.json");
  const dag = buildExecutionDAG(cancelled.evidence).dag;
  const explained = explainExecutionDAG(dag, cancelled.evidence, { locale: "zh" }).explanation;
  assert.equal(explained.statistics.toolCallCount, 0, "a plan is not a tool execution");
  assert.match(explained.summary, /已取消/);
  const planned = explained.nodes.find(({ kind }) => kind === "tool");
  assert.match(planned.summary, /未观察到执行/);
  assert.equal(planned.output.availability, "not-observed", "model output must not become tool output");
  assert.equal(planned.timing.semantics, "not-observed");
  const interrupted = await fixture("recorder-matrix/agent-tool-interrupted.json");
  const incomplete = explainExecutionDAG(buildExecutionDAG(interrupted.evidence).dag, interrupted.evidence, { locale: "zh" }).explanation;
  assert.match(incomplete.summary, /最终结果未知/);
  assert.equal(incomplete.nodes.find(({ kind }) => kind === "tool").output.availability, "not-observed");
  const failed = await fixture("recorder-matrix/workflow-failed-successor.json");
  const failedExplanation = explainExecutionDAG(buildExecutionDAG(failed.evidence).dag, failed.evidence).explanation;
  assert.equal(failedExplanation.nodes.length, 2);
  assert.ok(failedExplanation.nodes.find(({ status }) => status === "failed").output.items.some(({ value }) => value === "matrix planned validation failure"));
}

{
  const result = explainEino(weather, { locale: "zh" });
  assert.equal(result.ok, true);
  assert.equal(result.explanation.subject, "execution");
  assert.equal(result.explanation.runId, "run-weather-agent-1");
  assert.match(result.explanation.summary, /3 个可观察节点/);
  assert.deepEqual(result.explanation.statistics, {
    nodeCount: 3,
    edgeCount: 2,
    toolCallCount: 1,
    agentToolCallNodeCount: 0,
    failedNodeCount: 0,
    evidenceCount: 10,
  });

  const tool = result.explanation.nodes.find((node) => node.id === "tool:get_weather:call-weather-1");
  assert.equal(tool.headline, "tool · get_weather");
  assert.match(tool.rationale, /tool_call/);
  assert.deepEqual(tool.causes.map((item) => item.relation), ["tool-call"]);
  assert.deepEqual(tool.effects.map((item) => item.relation), ["data"]);
  assert.equal(tool.input.availability, "available");
  assert.equal(tool.output.availability, "available");
  assert.deepEqual(tool.input.items[0].value, { city: "Singapore" });
  assert.deepEqual(tool.output.items.at(-1).value, {
    city: "Singapore",
    condition: "晴",
    temperatureC: 31,
    humidityPercent: 68,
  });
  assert.deepEqual(tool.timing, {
    semantics: "recorded-boundaries",
    availability: "available",
    basis: "component",
    evidenceEnvelopeIndexes: [4, 5],
    summary: "记录的执行耗时：100 毫秒。",
    // The model plan and later Agent tool-result message are not tool boundaries.
    startedAtMs: weather[4].observedAtMs,
    finishedAtMs: weather[5].observedAtMs,
    durationMs: 100,
  });
  assert.deepEqual(tool.evidence.map((item) => item.envelopeIndex), [1, 2, 3, 4, 5, 6]);
  assert.equal(tool.evidence.every((item) => item.claim.length > 8), true);
  assert.equal(Object.isFrozen(result.explanation), true);
}

{
  const execution = buildExecutionDAG(weather);
  assert.equal(execution.ok, true);
  const result = explainExecutionDAG(execution.dag, [], { locale: "en" });
  assert.equal(result.ok, true);
  assert.match(result.explanation.limitations[0], /Source envelopes were not supplied/);
  assert.equal(result.explanation.nodes.every((node) => node.input.availability === "not-observed"), true);
  assert.match(result.explanation.nodes[2].evidence[0].claim, /not supplied/);
}

{
  const result = explainEino(agents, { locale: "en" });
  assert.equal(result.ok, true);
  assert.equal(result.explanation.status, "failed");
  const failedNode = result.explanation.nodes.find((node) => node.status === "failed");
  assert.match(failedNode.headline, /weather backend unavailable/);
  assert.match(failedNode.summary, /source record/);
  assert.equal(failedNode.evidence.some((item) => /agent\.event error/.test(item.claim)), true);
  assert.equal(result.explanation.nodes.some((node) => node.causes.some((cause) => cause.relation === "transfer")), true);
}

{
  const result = explainEino(callbacks, { locale: "en" });
  assert.equal(result.ok, true);
  assert.equal(result.explanation.nodes.some((node) => node.status === "failed"), true);
  assert.equal(result.explanation.nodes.flatMap((node) => node.evidence).some((item) => /execution error/.test(item.claim)), true);
}

{
  const workflowEnvelope = {
    protocol: "eino-dag",
    protocolVersion: 1,
    kind: "workflow.snapshot",
    kindVersion: 1,
    payload: workflow,
    source: { module: "test", format: "WorkflowSnapshot" },
    correlation: { runId: "run-workflow-explanation" },
  };
  const customEnvelope = {
    protocol: "eino-dag",
    protocolVersion: 1,
    kind: "custom.telemetry",
    kindVersion: 2,
    payload: { signal: "cache-hit", count: 3 },
    source: { module: "test", format: "Telemetry" },
    correlation: { runId: "run-custom-explanation" },
  };
  const allDomains = [workflowEnvelope, compose, ...callbacks, ...agents, ...schemas, ...components, customEnvelope];
  const kinds = new Set(allDomains.map((envelope) => envelope.kind));
  assert.deepEqual([...kinds].sort(), [
    "agent.event",
    "callback.event",
    "component.io",
    "compose.graph",
    "schema.agentic_message",
    "schema.document",
    "schema.message",
    "schema.tool",
    "workflow.snapshot",
    "custom.telemetry",
  ].sort());
  for (const [index, envelope] of allDomains.entries()) {
    const result = explainEinoEnvelope(envelope, { locale: index % 2 ? "zh" : "en", envelopeIndex: index });
    assert.equal(result.ok, true, `${envelope.kind} should be explainable`);
    assert.equal(result.explanation.envelopeIndex, index);
    assert.equal(result.explanation.kind, envelope.kind);
    assert.equal(result.explanation.claim.length > 8, true);
    assert.notEqual(result.explanation.payload, undefined);
  }
}

{
  const toolDefinition = schemas.find((envelope) => envelope.kind === "schema.tool");
  const result = explainEino(toolDefinition, { locale: "en" });
  assert.equal(result.ok, true);
  assert.equal(result.explanation.subject, "envelope");
  assert.equal(result.explanation.nodes.length, 1);
  assert.match(result.explanation.nodes[0].headline, /Declares the/);
  assert.equal(result.explanation.nodes[0].evidence[0].direction, "definition");
}

{
  const streamBoundary = components.find((envelope) => envelope.payload.streaming && envelope.payload.body === undefined);
  const result = explainEino(streamBoundary, { locale: "en" });
  assert.equal(result.ok, true);
  const node = result.explanation.nodes[0];
  assert.equal(node.status, "observed");
  assert.equal(node.output.availability, "not-observed");
  assert.match(node.output.summary, /boundary was observed/);
  assert.match(node.evidence[0].claim, /streaming body is not present/);
  assert.equal(node.limitations.some((item) => /value was not captured/.test(item)), true);
}

{
  const result = explainWorkflowSnapshot(workflow, { locale: "zh" });
  assert.equal(result.ok, true);
  assert.equal(result.explanation.subject, "workflow");
  assert.equal(result.explanation.nodes.length > 0, true);
  assert.equal(result.explanation.nodes.some((node) => node.path.length > 1), true);
  assert.equal(result.explanation.nodes.every((node) => node.limitations.some((item) => /运行证据/.test(item))), true);
  assert.equal(result.explanation.statistics.evidenceCount, 0);
}

{
  const invalidEnvelope = structuredClone(weather[0]);
  invalidEnvelope.payload.role = 7;
  const invalid = explainEinoEnvelope(invalidEnvelope);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics.some((item) => item.code === "schema_message.invalid_role"), true);
  assert.equal(explainEino([]).ok, false);
  assert.equal(explainEino({ nope: true }).ok, false);
  assert.equal(explainExecutionDAG({}, []).ok, false);
  assert.equal(explainExecutionDAG(buildExecutionDAG(weather).dag, {}).ok, false);
}

{
  const start = (time) => summaryEnvelope("run.lifecycle", { state: "started" }, time === undefined ? {} : { observedAtMs: time });
  const end = (time) => summaryEnvelope("run.lifecycle", { state: "ended", outcome: "success", capture: "complete" }, time === undefined ? {} : { observedAtMs: time });
  for (const [events, availability, reason, duration] of [
    [[start(0), end(0)], "available", undefined, 0],
    [[start(0), end(40)], "available", undefined, 40],
    [[start(10)], "partial", "end-not-recorded", undefined],
    [[end(10)], "partial", "start-not-recorded", undefined],
    [[start(), end(10)], "partial", "timestamp-not-recorded", undefined],
    [[start(20), end(10)], "invalid", "clock-reversed", undefined],
  ]) {
    const result = explainEino(events);
    assert.equal(result.ok, true);
    const timing = result.explanation.run.timing;
    assert.equal(timing.availability, availability);
    assert.equal(timing.reason, reason);
    assert.equal(timing.durationMs, duration);
    assert.equal(timing.basis, "lifecycle");
    assert.deepEqual(timing.evidenceEnvelopeIndexes, events.map((_, index) => index));
    assert.ok(timing.summary.length > 0);
  }
  const valid = [start(0), end(20)];
  const dag = buildExecutionDAG(valid).dag;
  for (const badTime of [-1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const raw = structuredClone(valid);
    raw[0].observedAtMs = badTime;
    const timing = explainExecutionDAG(dag, raw).explanation.run.timing;
    assert.equal(timing.availability, "invalid");
    assert.equal(timing.reason, "invalid-timestamp");
    assert.equal(timing.durationMs, undefined);
    assert.equal(timing.startedAtMs, undefined);
  }
  const declared = explainEino(compose).explanation.run.timing;
  assert.equal(declared.availability, "not-observed");
  assert.equal(declared.durationMs, undefined);
  const legacy = explainEino(weather).explanation;
  assert.equal(legacy.run.timing.availability, "not-observed", "message span cannot establish total run duration");
  assert.ok(legacy.nodes.filter(({ kind }) => ["input", "output"].includes(kind)).every(({ timing }) => timing.durationMs === undefined));
}

{
  let sequence = 0;
  const callback = (phase, nodeName, invocationId, timestampMs) => {
    const event = structuredClone(callbacks[0]);
    event.payload.phase = phase;
    event.payload.timestampMs = timestampMs;
    event.payload.sequence = ++sequence;
    event.payload.nodePath = [nodeName];
    event.payload.address[1].id = nodeName;
    event.payload.run.name = nodeName;
    event.correlation = { runId: "summary-test", entityId: `runnable:support-assistant/node:${nodeName}`, eventId: `timing:${sequence}`, invocationId };
    event.observedAtMs = timestampMs;
    return event;
  };
  const started = summaryEnvelope("run.lifecycle", { state: "started" }, { observedAtMs: 0 });
  const ended = summaryEnvelope("run.lifecycle", { state: "ended", outcome: "success", capture: "complete" }, { observedAtMs: 100 });
  const parallel = [started, callback("start", "left", "left:1", 5), callback("start", "right", "right:1", 10),
    callback("end", "right", "right:1", 90), callback("end", "left", "left:1", 95), ended];
  const original = JSON.stringify(parallel);
  const explained = explainEino(parallel);
  assert.equal(explained.ok, true, JSON.stringify(explained.diagnostics));
  const result = explained.explanation;
  assert.equal(result.run.timing.durationMs, 100, "whole-run elapsed time is not parallel durations summed");
  assert.deepEqual(result.nodes.map(({ timing }) => timing.durationMs), [90, 80]);
  assert.deepEqual(result.nodes.map(({ timing }) => timing.evidenceEnvelopeIndexes), [[1, 4], [2, 3]]);
  assert.ok(result.nodes.every(({ timing }) => timing.basis === "callback"));
  assert.equal(JSON.stringify(parallel), original);
  assert.equal(Object.isFrozen(parallel[0]), false);
  const repeated = [started, callback("start", "retry", "retry:1", 10), callback("end", "retry", "retry:1", 20),
    callback("start", "retry", "retry:2", 40), callback("end", "retry", "retry:2", 70), ended];
  const visits = explainEino(repeated).explanation.nodes;
  assert.equal(visits.length, 2);
  assert.deepEqual(visits.map(({ label, timing }) => [label, timing.durationMs]), [["retry", 10], ["retry", 30]]);
  assert.deepEqual(visits.map(({ timing }) => timing.evidenceEnvelopeIndexes), [[1, 2], [3, 4]]);
  const zero = explainEino([callback("start", "zero", "zero:1", 0), callback("end", "zero", "zero:1", 0)]).explanation;
  assert.equal(zero.nodes[0].timing.durationMs, 0);
  assert.equal(zero.run.timing.durationMs, undefined, "a child boundary pair is not a whole-run boundary");
  const backwards = explainEino([callback("start", "bad-clock", "bad:1", 20), callback("end", "bad-clock", "bad:1", 10)]).explanation.nodes[0].timing;
  assert.equal(backwards.reason, "clock-reversed");
  assert.equal(backwards.durationMs, undefined);
  const incomplete = explainEino([started, callback("start", "unfinished", "unfinished:1", 10), ended]).explanation.nodes[0].timing;
  assert.equal(incomplete.reason, "end-not-recorded");
  assert.equal(incomplete.finishedAtMs, undefined);
  const missing = [callback("start", "missing", "missing:1", 10), callback("end", "missing", "missing:1", 20)];
  const missingDag = buildExecutionDAG(missing).dag;
  delete missing[1].payload.timestampMs;
  assert.equal(explainExecutionDAG(missingDag, missing).explanation.nodes[0].timing.reason, "timestamp-not-recorded", "observedAtMs does not replace a missing callback timestamp");
}

{
  const graph = (await fixture("recorder-matrix/graph-io-structured.json")).evidence;
  const result = explainEino(graph).explanation;
  assert.equal(result.run.timing.durationMs, 0, "fixed clock zero duration is not missing");
  const legacy = graph.filter(({ kind }) => kind !== "run.lifecycle");
  const rootTiming = explainEino(legacy).explanation.run.timing;
  assert.equal(rootTiming.basis, "callback");
  assert.equal(rootTiming.durationMs, 0);
  const conflict = structuredClone(legacy);
  conflict.find(({ kind, payload }) => kind === "callback.event" && payload.phase === "end" && payload.address.length === 1).correlation.invocationId = "foreign-root";
  assert.equal(explainEino(conflict).explanation.run.timing.reason, "ambiguous-boundary");
  const snapshot = structuredClone(workflow);
  snapshot.execution.startedAtMs = 0;
  snapshot.execution.finishedAtMs = 100;
  snapshot.execution.durationMs = 99999;
  const executed = snapshot.execution.nodes.find(({ status }) => status !== "skipped");
  executed.startedAtMs = 10;
  executed.finishedAtMs = 20;
  executed.durationMs = 88888;
  const detailed = explainWorkflowSnapshot(snapshot).explanation;
  assert.equal(detailed.run.timing.durationMs, 100);
  assert.equal(detailed.run.timing.basis, "workflow");
  assert.equal(detailed.nodes.find(({ path }) => JSON.stringify(path) === JSON.stringify(executed.path)).timing.durationMs, 10);
  delete executed.startedAtMs;
  delete executed.finishedAtMs;
  assert.equal(explainWorkflowSnapshot(snapshot).explanation.nodes.find(({ path }) => JSON.stringify(path) === JSON.stringify(executed.path)).timing.durationMs, undefined, "duration-only snapshot is not a verified boundary pair");
}

{
  for (const [name, expectedCalls] of [["agent-parallel-same-tool", ["call-slow", "call-fast"]], ["agent-repeated-tool", ["call-repeat-1", "call-repeat-2"]]]) {
    const record = await fixture(`recorder-matrix/${name}.json`);
    const result = explainEino(record.evidence).explanation;
    const tools = result.nodes.filter(({ kind }) => kind === "tool");
    assert.equal(result.run.result.state, "success", name);
    assert.equal(result.run.timing.durationMs, 0, `${name}: actual fixed-clock root boundaries`);
    assert.equal(result.run.timing.basis, "lifecycle");
    assert.deepEqual(tools.map(({ technical }) => technical.correlation.toolCallId), expectedCalls);
    const withoutUserMessage = record.evidence.filter(({ kind, payload }) => kind !== "schema.message" || payload.role !== "user");
    const modelSteps = explainEino(withoutUserMessage).explanation.nodes.filter(({ kind }) => kind === "agent");
    assert.ok(modelSteps.length >= 2);
    assert.ok(modelSteps.every(({ timing }) => timing.basis === "component" && timing.durationMs === 0), `${name}: explicit model boundaries survive AgentEvent projection`);
    for (const node of tools) {
      const callId = node.technical.correlation.toolCallId;
      const source = record.evidence.flatMap((envelope, index) => envelope.kind === "component.io" && envelope.payload.component === "Tool"
        && envelope.payload.address.some((segment) => segment.type === "tool" && segment.subId === callId) ? [{ envelope, index }] : []);
      assert.equal(source.length, 2, `${name}/${callId}: precisely one real input/output pair`);
      assert.deepEqual(node.timing.evidenceEnvelopeIndexes, source.map(({ index }) => index));
      assert.equal(node.timing.basis, "component");
      assert.equal(node.timing.durationMs, 0);
      const output = source.find(({ envelope }) => envelope.payload.direction === "output");
      assert.ok(node.output.items.some(({ value }) => JSON.stringify(value) === JSON.stringify(output.envelope.payload.body)));
    }
    if (name === "agent-parallel-same-tool") {
      assert.ok(tools[1].timing.evidenceEnvelopeIndexes[1] < tools[0].timing.evidenceEnvelopeIndexes[1], "faster second-planned same-name tool finishes first without swapping identity");
    } else {
      assert.ok(tools[0].timing.evidenceEnvelopeIndexes[1] < tools[1].timing.evidenceEnvelopeIndexes[0], "same-name tools in two turns retain separate execution windows");
    }
  }
}

{
  for (const [name, expected] of [["graph-io-oversized", "not-observed"], ["graph-io-redacted", "redacted"], ["graph-io-empty", "empty"], ["graph-io-null", "null"]]) {
    const record = await fixture(`recorder-matrix/${name}.json`);
    const original = JSON.stringify(record);
    const result = explainEino(record.evidence).explanation;
    for (const node of result.nodes) {
      const output = node.output.items.find(({ label }) => label === "Component output");
      assert.ok(output, name);
      assert.equal(output.availability, expected, name);
      assert.equal(node.output.availability, expected === "not-observed" ? "not-observed" : "available", name);
      const source = record.evidence[output.evidenceEnvelopeIndexes[0]];
      assert.equal(source.kind, "component.io");
      if (expected === "not-observed") {
        assert.equal(Object.hasOwn(output, "value"), false);
        assert.equal(output.reason, "size_limit");
        assert.match(node.output.summary, /not captured.*size_limit/);
      } else {
        assert.deepEqual(output.value, source.payload.body, "capture annotations never alter the recorded value");
        if (expected === "redacted") assert.match(node.output.summary, /redacted/);
      }
    }
    assert.equal(JSON.stringify(record), original);
    assert.equal(Object.isFrozen(record.evidence[0]), false);
  }
  const raw = structuredClone(weather);
  delete raw[5].payload.body;
  raw[5].metadata = { capture: { status: "omitted", reason: "unsupported_value" } };
  const mixed = explainEino(raw).explanation.nodes.find(({ kind }) => kind === "tool").output;
  assert.equal(mixed.availability, "available", "a later recorded tool result remains available even if one body was omitted");
  assert.equal(mixed.items[0].availability, "not-observed");
  assert.equal(mixed.items[0].reason, "unsupported_value");
  assert.equal(mixed.items.at(-1).availability, "available");
  assert.match(mixed.summary, /not captured.*unsupported_value/);
  for (const [value, availability] of [[0, "available"], [false, "available"], ["", "empty"], [null, "null"]]) {
    const scalar = structuredClone(weather);
    scalar[5].payload.body = value;
    const item = explainEino(scalar).explanation.nodes.find(({ kind }) => kind === "tool").output.items[0];
    assert.equal(item.availability, availability);
    assert.equal(item.value, value);
  }
  const diagnostic = { severity: "warning", code: "projection.truncated", path: "/payload/body", message: "Shortened.", envelopeIndex: 5 };
  const truncated = explainEino(weather, { diagnostics: [diagnostic] }).explanation.nodes.find(({ kind }) => kind === "tool").output;
  assert.equal(truncated.items[0].availability, "truncated");
  assert.match(truncated.summary, /truncated/);
  const unrelated = explainEino(weather, { diagnostics: [{ ...diagnostic, path: "/payload/name" }] }).explanation.nodes.find(({ kind }) => kind === "tool").output;
  assert.equal(unrelated.items[0].availability, "available");
  const streamBoundary = components.find((envelope) => envelope.payload.streaming && envelope.payload.body === undefined);
  const missing = explainEino([streamBoundary]).explanation.nodes[0].output;
  assert.equal(missing.availability, "not-observed");
  assert.equal(missing.items[0].availability, "not-observed");
  assert.equal(Object.hasOwn(missing.items[0], "value"), false);
}

{
  const nested = async (name) => JSON.parse(await readFile(new URL(`../fixtures/recorder-matrix/agent-nested-${name}.json`, import.meta.url), "utf8"));
  for (const name of ["distinct-results", "parallel-scopes", "failure-recovered", "failure-propagated"]) {
    const source = await nested(name);
    const result = explainEino(source.evidence);
    assert.equal(result.ok, true);
    const explanation = result.explanation;
    const groups = explanation.groups;
    assert.equal(groups.length, name === "parallel-scopes" ? 3 : 2);
    assert.equal(groups.every(({ kind, basis }) => kind === "agent" && basis === "observed"), true);
    const root = groups.find(({ parentId }) => !parentId);
    assert.equal(root.label, "coordinator");
    for (const group of groups.filter(({ parentId }) => parentId)) {
      assert.equal(group.parentId, root.id);
      assert.match(group.label, /worker.*call-child-/);
      assert.equal(group.nodeIds.some((id) => root.nodeIds.includes(id)), false, "groups contain direct members, not duplicated descendant steps");
      for (const index of group.evidenceEnvelopeIndexes) {
        const sourceEnvelope = source.evidence[index];
        assert.ok(sourceEnvelope.payload.address?.filter(({ type }) => type === "agent").length === 2 || sourceEnvelope.payload.runPath?.length === 2);
      }
    }
    assert.equal(new Set(groups.flatMap(({ nodeIds }) => nodeIds)).size, groups.reduce((total, group) => total + group.nodeIds.length, 0));
    const ambiguous = explanation.nodes.filter(({ technical }) => technical.metadata.agentScopeUnresolved);
    for (const node of ambiguous) {
      assert.equal(groups.some(({ nodeIds }) => nodeIds.includes(node.id)), false);
      assert.ok(node.limitations.some((message) => message.includes("does not identify one invocation")));
    }
    assert.equal(explanation.run.result.state, name === "failure-propagated" ? "failed" : "success");
    if (name === "failure-propagated") assert.equal(explanation.run.output.availability, "not-observed");
    else assert.match(explanation.run.output.items[0].value, /^parent final:/);
    for (const issue of explanation.run.issues.filter(({ scope }) => scope === "step")) assert.equal(explanation.nodes.find(({ id }) => id === issue.nodeId).status, "failed");
    assert.equal(Object.isFrozen(groups), true);
    assert.equal(Object.isFrozen(source.evidence), false);
  }
  const source = await nested("parallel-scopes");
  const partial = source.evidence.filter(({ payload }) => !payload.address?.some(({ type, subId }) => type === "tool" && subId === "call-child-fast"));
  const partialExplanation = explainEino(partial).explanation;
  const survivingChild = partialExplanation.groups.find(({ parentId }) => parentId);
  assert.equal(survivingChild.evidenceEnvelopeIndexes.some((index) => partial[index].kind === "agent.event"), false);
  const survivingTool = partialExplanation.nodes.find(({ technical }) => technical.correlation.toolCallId === "shared-inner-call");
  assert.equal(survivingTool.output.items.some(({ value }) => JSON.stringify(value).includes("lookup:fast")), false);
  assert.equal(partialExplanation.nodes.filter(({ technical }) => technical.metadata.agentScopeUnresolved).length, 6);
  const starts = new Map();
  for (const envelope of source.evidence) {
    if (envelope.kind !== "component.io" || envelope.payload.component !== "Tool") continue;
    const address = envelope.payload.address;
    if (address.filter(({ type }) => type === "agent").length !== 2) continue;
    const key = JSON.stringify(address);
    if (envelope.payload.direction === "input") { starts.set(key, 1000 + starts.size * 100); envelope.observedAtMs = starts.get(key); }
    else envelope.observedAtMs = starts.get(key) + (address.some(({ subId }) => subId === "call-child-fast") ? 17 : 41);
  }
  const explanation = explainEino(source.evidence).explanation;
  const tools = explanation.nodes.filter(({ technical }) => technical.correlation.toolCallId === "shared-inner-call");
  assert.deepEqual(tools.map(({ timing }) => timing.durationMs).sort((a, b) => a - b), [17, 41]);
  for (const node of tools) {
    const addresses = node.timing.evidenceEnvelopeIndexes.map((index) => JSON.stringify(source.evidence[index].payload.address));
    assert.equal(new Set(addresses).size, 1, "timing never borrows another invocation's boundaries");
  }
  // A later child result cannot replace a previously verified root answer.
  const childFinal = source.evidence.find((envelope) => envelope.kind === "agent.event" && envelope.payload.runPath?.length === 2 && envelope.payload.output?.message?.value?.content?.startsWith("child result:"));
  const moved = source.evidence.filter((entry) => entry !== childFinal);
  moved.splice(moved.length - 1, 0, childFinal);
  assert.equal(explainEino(moved).explanation.run.output.items[0].value, "parent final: combined slow and fast");
}

{
  const matrix = async (name) => JSON.parse(await readFile(new URL(`../fixtures/recorder-matrix/${name}.json`, import.meta.url), "utf8"));
  const workflow = explainEino((await matrix("workflow-nested-names")).evidence).explanation;
  const root = workflow.groups.find(({ parentId }) => !parentId);
  const children = workflow.groups.filter(({ parentId }) => parentId === root.id);
  assert.equal(root.kind, "workflow");
  assert.equal(children.length, 2);
  assert.deepEqual(children.map(({ nodeIds }) => nodeIds), [["left-shared"], ["right-shared"]]);
  assert.deepEqual(root.nodeIds, ["left", "right"]);
  const declared = explainEino((await matrix("workflow-definition-only")).evidence).explanation;
  assert.equal(declared.groups[0].basis, "declared");
  assert.deepEqual(declared.groups[0].evidenceEnvelopeIndexes, [0]);
  const loop = explainEino((await matrix("graph-step-limit")).evidence).explanation;
  assert.equal(loop.groups.length, 1);
  assert.equal(loop.groups[0].kind, "graph");
  assert.equal(loop.groups[0].basis, "observed");
  assert.equal(loop.groups[0].nodeIds.length, 4, "three visits of one graph node remain separate from the root invocation");
  const first = await matrix("agent-nested-distinct-results");
  const other = structuredClone(first);
  for (const envelope of other.evidence) envelope.correlation.runId = "another-run";
  const selected = explainEino([...first.evidence, ...other.evidence], { runId: first.runId }).explanation;
  assert.equal(selected.groups.length, 2);
  assert.equal(selected.groups.every(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.every((index) => index < first.evidence.length)), true);
}

{
  const graph = (await fixture("recorder-matrix/graph-io-failed.json")).evidence;
  const nested = (await fixture("recorder-matrix/agent-nested-failure-recovered.json")).evidence;
  for (const source of [graph, nested, agents]) {
    const index = source.findIndex(({ kind, payload }) => ["callback.event", "agent.event"].includes(kind) && payload.error);
    assert.ok(index >= 0);
    for (const [capture, availability] of [
      [{ redacted: true }, "redacted"], [{ truncated: true }, "truncated"],
      [{ redacted: true, truncated: true }, "redacted"], [{ redacted: "true", truncated: 1 }, "available"],
      [{ status: "omitted", reason: "size_limit", redacted: true }, "not-observed"], [{ status: "omitted" }, "not-observed"],
    ]) {
      const evidence = structuredClone(source);
      evidence[index].metadata = { ...evidence[index].metadata, capture };
      const original = JSON.stringify(evidence);
      for (const locale of ["en", "zh"]) {
        const result = explainEino(evidence, { locale });
        assert.equal(result.ok, true);
        const node = result.explanation.nodes.find((node) => node.evidence.some((reference) => reference.envelopeIndex === index && reference.role === "error"));
        assert.ok(node);
        const item = node.output.items.find((item) => item.evidenceEnvelopeIndexes.includes(index));
        assert.equal(item.availability, availability);
        assert.deepEqual(item.evidenceEnvelopeIndexes, [index]);
        if (availability === "not-observed") {
          assert.equal(Object.hasOwn(item, "value"), false, "an omitted error never restores the source placeholder as output");
          assert.equal(item.reason, capture.reason || "not_captured");
          assert.equal(node.output.availability, "not-observed");
        } else assert.deepEqual(item.value, evidence[index].payload.error, "error text and structure stay exact when capture is partial");
        assert.ok(result.explanation.run.issues.some((issue) => issue.evidenceEnvelopeIndexes.includes(index) && issue.message === evidence[index].payload.error.message), "canonical issues keep their source message for provenance; readers decide capture display");
      }
      assert.equal(JSON.stringify(evidence), original, "all source error placeholders remain available in Raw unchanged");
      assert.equal(Object.isFrozen(evidence[index]), false, "explanation never freezes caller-owned source envelopes");
    }
    const diagnostic = { envelopeIndex: index, code: "projection.truncated", path: "/payload/error/message", severity: "warning", message: "Recorded error shortened." };
    const errorItem = (diagnostics) => explainEino(source, { diagnostics }).explanation.nodes
      .flatMap((node) => node.output.items).find((item) => item.evidenceEnvelopeIndexes.includes(index));
    assert.equal(errorItem([diagnostic]).availability, "truncated");
    assert.equal(errorItem([{ ...diagnostic, code: "projection.redacted", path: "/payload/error" }]).availability, "redacted");
    for (const change of [
      { envelopeIndex: index + 1 }, { envelopeIndex: undefined }, { envelopeIndex: String(index) },
      { path: "/payload/body" }, { path: "/payload/errorMessage" }, { path: "/payload/errors/message" },
      { path: "/payload/name" }, { path: "/metadata/capture" },
    ]) assert.equal(errorItem([{ ...diagnostic, ...change }]).availability, "available", "an unrelated envelope or field cannot annotate this error");
  }
}
{
  const evidence = (await fixture("recorder-matrix/workflow-io-failed.json")).evidence;
  const index = evidence.findIndex(({ kind }) => kind === "workflow.snapshot");
  evidence[index].metadata = { capture: { status: "omitted", reason: "size_limit", redacted: true, truncated: true } };
  const original = JSON.stringify(evidence);
  const result = explainEino(evidence, { diagnostics: [{ envelopeIndex: index, code: "projection.redacted", path: "/payload/error", message: "Not this node error." }] });
  assert.equal(result.ok, true);
  const failed = result.explanation.nodes.find(({ status }) => status === "failed");
  const item = failed.output.items.find(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(index));
  assert.equal(item.availability, "available", "snapshot-wide capture is not capture metadata for a node's execution error");
  assert.equal(item.value, evidence[index].payload.execution.nodes.find(({ status }) => status === "failed").errorMessage);
  assert.equal(item.reason, undefined);
  assert.equal(JSON.stringify(evidence), original);
}
{
  const evidence = structuredClone(weather);
  const index = evidence.findIndex(({ kind, payload }) => kind === "agent.event" && payload.output?.message?.value?.role === "tool");
  assert.ok(index >= 0);
  evidence[index].payload.error = { message: "independent callback error" };
  evidence[index].metadata = { capture: { status: "omitted", reason: "size_limit" } };
  const original = JSON.stringify(evidence);
  const output = explainEino(evidence).explanation.nodes.find(({ kind }) => kind === "tool").output;
  const business = output.items.find(({ evidenceEnvelopeIndexes }) => evidenceEnvelopeIndexes.includes(index));
  assert.equal(business.availability, "available", "an independent Tool fallback message is not the envelope's omitted error");
  assert.ok(Object.hasOwn(business, "value"));
  assert.equal(JSON.stringify(evidence), original);
}

console.log("OK: deterministic explanations cover Agent, Workflow, every Eino domain, evidence, boundary timing, failures and exact error capture");
