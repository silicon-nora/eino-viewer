// Synthetic scale data, NOT a real Recorder business scenario.
export function syntheticAgentRecord(baseRecord, recordCount = 105) {
  if (!Number.isSafeInteger(recordCount) || recordCount < 3) throw new RangeError("At least 3 trajectory records required");
  const record = structuredClone(baseRecord);
  const userIndex = record.evidence.findIndex(({ kind, payload }) => kind === "schema.message" && payload.role === "user");
  if (userIndex < 0) throw new TypeError("The direct-answer fixture must include its original user message");
  const user = record.evidence[userIndex];
  // Retain the real completed direct-answer boundaries, adding only explicit
  // UI stress messages. This is not another real Recorder acceptance scenario.
  const repeated = Array.from({ length: recordCount - 2 }, (_, index) => ({
    ...structuredClone(user), payload: { ...user.payload, content: `Synthetic trajectory input ${index + 1}` },
  }));
  record.evidence.splice(userIndex + 1, 0, ...repeated);
  record.metadata = { ...record.metadata, synthetic: true, purpose: "trajectory-pagination" };
  return record;
}

export function syntheticGraphRecord(evidenceCount = 100) {
  if (!Number.isSafeInteger(evidenceCount) || evidenceCount < 12) throw new RangeError("At least 12 evidence records required");
  const runId = `synthetic-scale-${evidenceCount}`;
  const base = 1790000000000;
  const rootAddress = [{ type: "runnable", id: "scale" }];
  let sequence = 0;
  const envelope = (kind, payload, correlation = {}, time = base) => ({
    protocol: "eino-dag", protocolVersion: 1, kind, kindVersion: 1, payload,
    correlation: { runId, ...correlation }, observedAtMs: time,
  });
  const callback = (phase, invocationId, time, node = false) => envelope("callback.event", {
    sequence: ++sequence, phase, streaming: false, timestampMs: time,
    address: node ? [...rootAddress, { type: "node", id: "visit" }] : rootAddress,
    ...(node ? { nodePath: ["visit"] } : {}), run: { component: node ? "Lambda" : "Graph" },
  }, { invocationId, entityId: node ? "runnable:scale/node:visit" : "runnable:scale",
    eventId: `event-${sequence}`, ...(node ? { parentEntityId: "runnable:scale" } : {}) }, time);
  const io = (direction, invocationId, value, time, node = false) => envelope("component.io", {
    direction, streaming: false, component: node ? "Lambda" : "Graph", format: `${node ? "Lambda" : "Graph"}.Callback${direction === "input" ? "Input" : "Output"}`,
    address: node ? [...rootAddress, { type: "node", id: "visit" }] : rootAddress,
    ...(node ? { nodePath: ["visit"] } : {}), body: value,
  }, { invocationId, entityId: node ? "runnable:scale/node:visit" : "runnable:scale", ...(node ? { parentEntityId: "runnable:scale" } : {}) }, time);
  const evidence = [
    envelope("compose.graph", { name: "Synthetic repeated visits", nodes: [{ id: "visit", component: "Lambda" }],
      edges: [{ from: "start", to: "visit", channels: ["control"] }, { from: "visit", to: "visit", channels: ["control"] }, { from: "visit", to: "end", channels: ["control"] }] }),
    callback("start", "root-call", base), envelope("run.lifecycle", { state: "started" }), io("input", "root-call", "Synthetic input", base),
  ];
  const visits = Math.floor((evidenceCount - 7) / 4);
  for (let index = 0; index < visits; index += 1) {
    const id = `visit-${index}`;
    const start = base + index * 2;
    evidence.push(callback("start", id, start, true), io("input", id, { iteration: index }, start, true),
      callback("end", id, start + 1, true), io("output", id, { result: index }, start + 1, true));
  }
  while (evidence.length < evidenceCount - 3) evidence.push(envelope("schema.document", { id: `note-${evidence.length}`, content: "Synthetic scale evidence; not a business example" }));
  const end = base + visits * 2;
  evidence.push(callback("end", "root-call", end), io("output", "root-call", { visits }, end),
    envelope("run.lifecycle", { state: "ended", outcome: "success", capture: "complete" }, {}, end));
  return { schemaVersion: 1, source: "graph", runId, evidence, metadata: { synthetic: true, purpose: "scale-benchmark" } };
}
