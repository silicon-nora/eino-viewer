import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRunRecordV2 } from "../src/run-record-v2.js";
import { projectRunRecordV2Document } from "../src/viewer-v2.js";

// Validate newly executed Eino callbacks, not only committed golden JSON. The
// application model/tool implementations are deterministic local test doubles.
const work = mkdtempSync(join(tmpdir(), "eino-native-v2-"));
try {
  execFileSync("go", ["test", "-run", "TestNativeV2", "-count=1", "."], {
    cwd: fileURLToPath(new URL("../integrations/go/", import.meta.url)),
    env: { ...process.env, WRITE_NATIVE_V2_FIXTURES: work }, stdio: "inherit",
  });
  const files = readdirSync(work).filter((name) => name.endsWith(".json")).sort();
  for (const name of ["agent-model-tool-usage.json", "agent-transfer-failed.json", "graph-repeated-calls.json", "workflow-success-empty.json", "workflow-failed.json", "application-workflow-fallback.json"]) {
    assert.ok(files.includes(name), `Missing required fresh recording: ${name}`);
  }
  for (const name of files) {
    const record = parseRunRecordV2(readFileSync(join(work, name), "utf8"));
    const projected = projectRunRecordV2Document(record);
    assert.equal(projected.ok, true, `${name}: ${JSON.stringify(projected.diagnostics)}`);
    assert.deepEqual(projected.document.record, record, `${name}: Viewer changed producer facts`);
    const withoutAttachments = structuredClone(record);
    delete withoutAttachments.sourceRecords;
    const independent = projectRunRecordV2Document(withoutAttachments);
    assert.equal(independent.ok, true);
    assert.deepEqual(independent.document.nodes, projected.document.nodes, `${name}: Core reading depends on optional sources`);
    console.log(`${name}: fresh Eino execution → v2 validation → Viewer projection passed`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
