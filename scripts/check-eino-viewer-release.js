import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { assertPackedPackageContract } from "./package-contract.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = projectRoot;
const workflowRoot = resolve(projectRoot, "node_modules/eino-workflow-dag");
const work = mkdtempSync(resolve(projectRoot, ".eino-viewer-release-"));
const nodeModules = resolve(work, "node_modules");
// Iteration 6 adds a source-backed local-call read model and embedded local
// diagrams (~169 KiB packed, up from 158.6 KiB in iteration 5). Keep a bounded
// 175 KiB budget; portable HTML, fixtures and the site remain outside the SDK.
// This check only verifies a local artifact; it does not publish anything.
const maximumEinoViewerPackedSize = 175 * 1024;

function fail(message) {
  throw new Error(`eino-viewer release check failed: ${message}`);
}

function run(command, args, cwd = work) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_cache: resolve(work, "npm-cache"),
      npm_config_dry_run: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} exited with ${result.status}\n${
        result.stderr || result.stdout || "no output"
      }`,
    );
  }
  return result;
}

function pack(root) {
  const result = run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", work],
    root,
  );
  let report;
  try {
    report = JSON.parse(result.stdout)[0];
  } catch {
    fail(`npm pack returned invalid JSON: ${result.stdout}`);
  }
  return { report, tarball: resolve(work, report.filename) };
}

function installPacked(packResult, name) {
  const extraction = resolve(work, `extract-${name}`);
  mkdirSync(extraction, { recursive: true });
  run("tar", ["-xzf", packResult.tarball, "-C", extraction]);
  mkdirSync(nodeModules, { recursive: true });
  renameSync(resolve(extraction, "package"), resolve(nodeModules, name));
}

function executable(name) {
  return resolve(
    projectRoot,
    "node_modules/.bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
}

try {
  const legacyManifest = JSON.parse(
    readFileSync(resolve(workflowRoot, "package.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  );
  const expectedAPI = JSON.parse(
    readFileSync(resolve(packageRoot, "API_SURFACE.json"), "utf8"),
  );
  const legacy = pack(workflowRoot);
  const candidate = pack(packageRoot);
  assertPackedPackageContract(candidate.tarball, candidate.report, manifest);
  if (candidate.report.size > maximumEinoViewerPackedSize) {
    fail(
      `tarball exceeds ${maximumEinoViewerPackedSize / 1024} KiB: ${candidate.report.size} bytes`,
    );
  }
  const expectedLegacyRange = manifest.dependencies?.[legacyManifest.name];
  if (expectedLegacyRange !== "^1.3.1" || legacyManifest.version !== "1.3.1") {
    fail("the compatibility dependency and local legacy release are not aligned");
  }

  installPacked(legacy, legacyManifest.name);
  installPacked(candidate, manifest.name);

  const require = createRequire(resolve(work, "consumer.cjs"));
  const cjsEntries = new Map([
    [".", require("eino-viewer")],
    ["./protocol", require("eino-viewer/protocol")],
    ["./views", require("eino-viewer/views")],
    ["./viewer", require("eino-viewer/viewer")],
    ["./run-viewer", require("eino-viewer/run-viewer")],
    ["./execution-dag", require("eino-viewer/execution-dag")],
    ["./trajectory", require("eino-viewer/trajectory")],
    ["./explanation", require("eino-viewer/explanation")],
    ["./workflow", require("eino-viewer/workflow")],
  ]);
  const esmEntries = new Map([
    [".", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/eino-viewer.js")))],
    ["./protocol", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/protocol.js")))],
    ["./views", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/views.js")))],
    ["./viewer", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/viewer.js")))],
    ["./run-viewer", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/run-viewer.js")))],
    ["./execution-dag", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/execution-dag.js")))],
    ["./trajectory", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/trajectory.js")))],
    ["./explanation", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/explanation.js")))],
    ["./workflow", await import(pathToFileURL(resolve(nodeModules, "eino-viewer/dist/workflow.js")))],
  ]);
  for (const [subpath, expectedNames] of Object.entries(expectedAPI)) {
    const expected = [...expectedNames].sort();
    const cjs = Object.keys(cjsEntries.get(subpath) || {}).sort();
    const esm = Object.keys(esmEntries.get(subpath) || {}).sort();
    if (JSON.stringify(cjs) !== JSON.stringify(expected)) {
      fail(`${subpath} CommonJS API differs from API_SURFACE.json`);
    }
    if (JSON.stringify(esm) !== JSON.stringify(expected)) {
      fail(`${subpath} ESM API differs from API_SURFACE.json`);
    }
  }

  // Verify the installed ESM/CJS result contract, not just source exports.
  const summaryRecord = JSON.parse(readFileSync(resolve(projectRoot, "fixtures/recorder-matrix/agent-direct-answer.json"), "utf8"));
  for (const entries of [esmEntries, cjsEntries]) {
    const explained = entries.get("./explanation").explainEino(summaryRecord.evidence);
    const summary = explained.ok && explained.explanation.run;
    if (!summary || summary.result.state !== "success" || summary.capture.status !== "complete"
      || summary.input.items[0]?.value !== "请直接打个招呼。"
      || summary.output.items[0]?.value !== "你好，运行已完成。") {
      fail("installed explanation entry lost its source-backed run summary");
    }
  }

  writeFileSync(
    resolve(work, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  writeFileSync(
    resolve(work, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM"],
        },
        include: ["main.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    resolve(work, "main.ts"),
    `import {
  createEinoDAGEnvelope,
  createEinoDAGViewRegistry,
  projectEinoViewerDocument,
  type AgentEventEnvelope,
} from "eino-viewer";
import { validateSchemaDocumentEnvelope } from "eino-viewer/protocol";
import { projectEinoDAGEnvelopes } from "eino-viewer/views";
import { buildExecutionDAG, executionDAGToWorkflowSnapshot } from "eino-viewer/execution-dag";
import { buildExecutionTrajectory, createExecutionTrajectoryBuilder } from "eino-viewer/trajectory";
import { explainEino, explainEinoEnvelope, type EinoRunSummary } from "eino-viewer/explanation";
import { createWorkflowDAG, type EinoWorkflowSnapshot } from "eino-viewer/workflow";
import "eino-workflow-dag/styles.css";

const event: AgentEventEnvelope = createEinoDAGEnvelope({
  kind: "agent.event",
  kindVersion: 1,
  payload: { agentName: "assistant" },
});
const snapshot: EinoWorkflowSnapshot = {
  schemaVersion: 1,
  workflow: { nodes: [], edges: [] },
};
createEinoDAGViewRegistry().project(event);
projectEinoViewerDocument([event]);
projectEinoDAGEnvelopes([event]);
const execution = buildExecutionDAG([event]);
if (execution.ok) executionDAGToWorkflowSnapshot(execution.dag);
buildExecutionTrajectory([event]);
createExecutionTrajectoryBuilder().append(event);
const explanation = explainEino([event]);
if (explanation.ok) {
  const summary: EinoRunSummary = explanation.explanation.run;
  summary.output.items[0]?.availability;
  summary.capture.status;
}
explainEinoEnvelope(event);
validateSchemaDocumentEnvelope({});
void createWorkflowDAG;
void snapshot;
`,
  );
  writeFileSync(
    resolve(work, "index.html"),
    '<!doctype html><html><body><script type="module" src="/main.ts"></script></body></html>\n',
  );
  run(executable("tsc"), ["-p", resolve(work, "tsconfig.json")]);
  run(executable("vite"), [
    "build",
    work,
    "--outDir",
    resolve(work, "build"),
    "--emptyOutDir",
    "--logLevel",
    "error",
  ]);
  run(executable("publint"), [packageRoot], projectRoot);
  run(
    executable("attw"),
    ["--pack", packageRoot, "--profile", "node16"],
    projectRoot,
  );

  console.log(
    `OK: eino-viewer exact package and installed consumers passed (${candidate.report.entryCount} files, ${(candidate.report.size / 1024).toFixed(1)} KiB, ${candidate.report.shasum})`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
