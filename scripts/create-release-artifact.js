import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { assertPackedPackageContract } from "./package-contract.js";

const projectRoot = resolve(import.meta.dirname, "..");
const destination = resolve(process.argv[2] || "release-artifacts");
const packageRoot = resolve(process.argv[3] || projectRoot);
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);

function fail(message) {
  throw new Error(`Release artifact creation failed: ${message}`);
}

mkdirSync(destination, { recursive: true });
const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
  {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_cache: resolve(destination, ".npm-cache"),
      npm_config_dry_run: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
  },
);
if (result.status !== 0) {
  fail((result.stderr || result.stdout || "npm pack failed").trim());
}

let report;
try {
  report = JSON.parse(result.stdout)[0];
} catch {
  fail(`npm pack returned invalid JSON: ${result.stdout.trim()}`);
}
if (!report?.filename) fail("tarball filename is missing");
const tarball = resolve(destination, basename(report.filename));
if (!existsSync(tarball)) fail(`tarball does not exist: ${tarball}`);
assertPackedPackageContract(tarball, report, manifest);

console.log(`tarball=${tarball}`);
console.log(`filename=${basename(tarball)}`);
console.log(`shasum=${report.shasum}`);
console.log(`integrity=${report.integrity}`);
console.log(`size=${report.size}`);
