import { performance } from "node:perf_hooks";
import { arch, cpus, platform, totalmem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { syntheticGraphRecord } from "../tests/helpers/synthetic-record.js";
import { projectEinoViewerDocument } from "../src/viewer.js";
import { explainExecutionDAG } from "../src/explanation.js";
import { createRunInspectionIndex } from "../src/inspection.js";

const results = [];
for (const evidenceCount of [100, 1000, 10000]) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const record = syntheticGraphRecord(evidenceCount);
  const json = JSON.stringify(record);
  const start = performance.now();
  const parsed = JSON.parse(json);
  const parseEnd = performance.now();
  const projection = projectEinoViewerDocument(parsed);
  if (!projection.ok) throw new Error(JSON.stringify(projection.diagnostics));
  const projectEnd = performance.now();
  const explained = explainExecutionDAG(projection.document.execution, projection.document.evidence);
  if (!explained.ok) throw new Error(JSON.stringify(explained.diagnostics));
  const explainEnd = performance.now();
  const index = createRunInspectionIndex(explained.explanation, projection.document.evidence);
  const indexEnd = performance.now();
  let selected;
  for (let iteration = 0; iteration < 100; iteration++) {
    const page = index.searchSteps("visit", { offset: iteration * 20 });
    selected = page.items[0] && index.getNode(page.items[0].id);
    index.searchEvidence("component.io", { offset: iteration * 20 });
  }
  if (!selected) throw new Error("Selection benchmark found no step");
  const queryEnd = performance.now();
  const round = (number) => Math.round(number * 100) / 100;
  results.push({ evidenceCount, nodeCount: index.nodeCount, jsonBytes: Buffer.byteLength(json),
    parseMs: round(parseEnd - start), projectionMs: round(projectEnd - parseEnd), explanationMs: round(explainEnd - projectEnd),
    indexMs: round(indexEnd - explainEnd), meanSearchAndSelectionMs: round((queryEnd - indexEnd) / 100),
    heapDeltaMiB: round((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024) });
}
const report = { synthetic: true, measuredAt: new Date().toISOString(), runtime: process.version,
  platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model, totalMemoryGiB: totalmem() / 1024 ** 3,
  note: "One local observation, not an SLA. Heap delta includes temporary allocations; not retained memory or browser memory. Search indexes metadata, not full payload text.", results };
mkdirSync(new URL("../.artifacts/iteration-3/", import.meta.url), { recursive: true });
writeFileSync(new URL("../.artifacts/iteration-3/performance-node.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
