import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReleaseRegistry } from "./release-validation.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = projectRoot;
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const workflowVersion = "1.3.1";
const version = process.argv[2];
const registry = validateReleaseRegistry(
  process.env.PUBLISHED_CONSUMER_REGISTRY || "https://registry.npmjs.org/",
);
const packageSpec =
  process.env.PUBLISHED_EINO_VIEWER_PACKAGE_SPEC || `${manifest.name}@${version}`;
const workflowPackageSpec =
  process.env.PUBLISHED_WORKFLOW_PACKAGE_SPEC ||
  `eino-workflow-dag@${workflowVersion}`;

function fail(message) {
  throw new Error(`Published eino-viewer check failed: ${message}`);
}

function executable(name) {
  return resolve(
    projectRoot,
    "node_modules/.bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
}

function spawn(command, args, cwd, environment) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    shell: process.platform === "win32",
    timeout: Number(
      process.env.PUBLISHED_CONSUMER_COMMAND_TIMEOUT_MS || 180_000,
    ),
  });
}

function run(command, args, cwd, environment) {
  const result = spawn(command, args, cwd, environment);
  if (result.status !== 0) {
    fail(
      `${basename(command)} ${args.join(" ")} exited with ${result.status}\n${
        result.stderr || result.stdout || "no output"
      }${result.signal ? `\nterminated by ${result.signal}` : ""}`,
    );
  }
  return result;
}

function installWithRetry(args, cwd, environment) {
  let result;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    result = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      args,
      cwd,
      environment,
    );
    if (result.status === 0) return;
    if (attempt < 6) {
      const waitMilliseconds = Math.min(2 ** attempt * 1000, 30_000);
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        waitMilliseconds,
      );
    }
  }
  fail(
    `npm install failed after 6 attempts\n${
      result?.stderr || result?.stdout || "no output"
    }`,
  );
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
  fail("an exact package version is required");
}
if (version !== manifest.version) {
  fail(`expected package.json version ${manifest.version}, received ${version}`);
}
if (manifest.dependencies?.["eino-workflow-dag"] !== `^${workflowVersion}`) {
  fail(`expected eino-workflow-dag compatibility base ^${workflowVersion}`);
}

const work = realpathSync(mkdtempSync(resolve(tmpdir(), "eino-viewer-published-")));
try {
  writeFileSync(resolve(work, ".npmrc"), `registry=${registry}\n`);
  writeFileSync(
    resolve(work, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(work, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["main.ts"],
      },
      null,
      2,
    )}\n`,
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
validateSchemaDocumentEnvelope({});
void createWorkflowDAG;
void snapshot;
`,
  );
  writeFileSync(
    resolve(work, "index.html"),
    '<!doctype html><html><body><script type="module" src="/main.ts"></script></body></html>\n',
  );

  const environment = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_cache: resolve(work, "npm-cache"),
    npm_config_fetch_retries: "2",
    npm_config_fetch_retry_maxtimeout: "5000",
    npm_config_fetch_retry_mintimeout: "1000",
    npm_config_fetch_timeout: "30000",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_registry: registry,
    npm_config_update_notifier: "false",
    npm_config_userconfig: resolve(work, ".npmrc"),
  };
  installWithRetry(
    [
      "install",
      "--ignore-scripts",
      "--no-package-lock",
      "--save-exact",
      packageSpec,
      workflowPackageSpec,
    ],
    work,
    environment,
  );

  for (const [name, expectedVersion] of [
    [manifest.name, version],
    ["eino-workflow-dag", workflowVersion],
  ]) {
    const installed = JSON.parse(
      readFileSync(resolve(work, "node_modules", name, "package.json"), "utf8"),
    );
    if (installed.name !== name || installed.version !== expectedVersion) {
      fail(
        `registry installed ${installed.name}@${installed.version}, expected ${name}@${expectedVersion}`,
      );
    }
  }

  run(executable("tsc"), ["-p", resolve(work, "tsconfig.json")], work, environment);
  run(
    executable("vite"),
    [
      "build",
      work,
      "--outDir",
      resolve(work, "build"),
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    work,
    environment,
  );
  run(
    process.execPath,
    [
      "-e",
      `const root = require("eino-viewer");
const protocol = require("eino-viewer/protocol");
const views = require("eino-viewer/views");
const viewer = require("eino-viewer/viewer");
const workflow = require("eino-viewer/workflow");
if (typeof root.createEinoDAGViewRegistry !== "function" ||
    typeof protocol.createEinoDAGEnvelope !== "function" ||
    typeof views.projectEinoDAGEnvelopes !== "function" ||
    typeof viewer.projectEinoViewerDocument !== "function" ||
    typeof workflow.createWorkflowDAG !== "function") {
  throw new Error("published CommonJS entries are incomplete");
}`,
    ],
    work,
    environment,
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const root = await import("eino-viewer");
const protocol = await import("eino-viewer/protocol");
const views = await import("eino-viewer/views");
const viewer = await import("eino-viewer/viewer");
const workflow = await import("eino-viewer/workflow");
if (typeof root.createEinoDAGViewRegistry !== "function" ||
    typeof protocol.createEinoDAGEnvelope !== "function" ||
    typeof views.projectEinoDAGEnvelopes !== "function" ||
    typeof viewer.projectEinoViewerDocument !== "function" ||
    typeof workflow.createWorkflowDAG !== "function") {
  throw new Error("published ESM entries are incomplete");
}`,
    ],
    work,
    environment,
  );

  const assets = readdirSync(resolve(work, "build/assets"));
  if (!assets.some((name) => name.endsWith(".js"))) {
    fail("Vite consumer build did not emit JavaScript");
  }
  if (!assets.some((name) => name.endsWith(".css"))) {
    fail("Vite consumer build did not emit package CSS");
  }

  console.log(
    `OK: ${manifest.name}@${version} and eino-workflow-dag@${workflowVersion} install, type-check, bundle, and load through ESM and CommonJS`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
