import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, posix, relative, resolve, sep } from "node:path";
import { findBrokenLocalDocumentationLinks } from "./document-links.js";
import { assertPublicAssetInventory } from "./public-assets.js";
import { assertNoSensitiveContent } from "./sensitive-content.js";
import { validatePublishedSourceMaps } from "./source-map-contract.js";
import { assertTypeSurface, readTypeSurfaceInputs } from "./type-surface.js";

export const maximumPackedSize = 350 * 1024;

const alwaysRequired = [
  "package.json",
  "API_SURFACE.json",
  "CHANGELOG.md",
  "LICENSE",
  "PROVENANCE.md",
  "PUBLIC_ASSETS.json",
  "README.md",
  "README.zh-CN.md",
  "THIRD_PARTY_NOTICES.md",
  "TYPE_SURFACE.json",
];

function collectExportTargets(target, required) {
  if (typeof target === "string") {
    if (target.startsWith("./")) required.add(target.slice(2));
    return;
  }
  for (const nested of Object.values(target || {})) {
    collectExportTargets(nested, required);
  }
}

function collectBinTargets(target, required) {
  if (typeof target === "string") {
    required.add(target.startsWith("./") ? target.slice(2) : target);
    return;
  }
  for (const nested of Object.values(target || {})) {
    collectBinTargets(nested, required);
  }
}

function publishedPaths(report) {
  return (report?.files || []).map((file) => file.path);
}

function isSafePackagePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !/[\0-\x1f\x7f]/.test(path) &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    posix.normalize(path) === path &&
    !path.split("/").includes("..")
  );
}

function hash(buffer, algorithm, encoding) {
  return createHash(algorithm).update(buffer).digest(encoding);
}

export function validatePackageReport(report, manifest, tarball) {
  const failures = [];
  if (!report || report.name !== manifest?.name || report.version !== manifest?.version) {
    failures.push("tarball identity does not match package.json");
  }
  if (!report?.filename || !report?.integrity || !report?.shasum) {
    failures.push("tarball metadata is incomplete");
  }
  if (!Number.isSafeInteger(report?.size) || report.size < 0) {
    failures.push("tarball size is invalid");
  } else if (report.size > maximumPackedSize) {
    failures.push(`tarball exceeds 350 KiB: ${report.size} bytes`);
  }
  if (!Array.isArray(report?.files)) {
    failures.push("tarball file report is missing");
    return failures;
  }

  const paths = publishedPaths(report);
  const invalidPaths = paths.filter((path) => !isSafePackagePath(path));
  if (invalidPaths.length) {
    failures.push(`unsafe reported paths are present: ${invalidPaths.join(", ")}`);
  }
  const duplicatePaths = paths.filter((path, index) => paths.indexOf(path) !== index);
  if (duplicatePaths.length) {
    failures.push(`duplicate reported paths are present: ${[...new Set(duplicatePaths)].join(", ")}`);
  }
  if (!Number.isSafeInteger(report.entryCount) || report.entryCount < 0) {
    failures.push("tarball entry count is invalid");
  } else if (report.entryCount !== report.files.length) {
    failures.push(
      `tarball entry count differs from its file report: ${report.entryCount} != ${report.files.length}`,
    );
  }
  const invalidSizes = report.files
    .filter((file) => !Number.isSafeInteger(file?.size) || file.size < 0)
    .map((file) => file?.path || "<missing>");
  if (invalidSizes.length) {
    failures.push(`reported file sizes are invalid: ${invalidSizes.join(", ")}`);
  }

  const pathSet = new Set(paths);
  const required = new Set(alwaysRequired);
  for (const target of Object.values(manifest?.exports || {})) {
    collectExportTargets(target, required);
  }
  for (const field of ["unpkg", "jsdelivr"]) {
    const target = manifest?.[field];
    if (typeof target === "string") {
      required.add(target.startsWith("./") ? target.slice(2) : target);
    }
  }
  collectBinTargets(manifest?.bin, required);
  for (const path of required) {
    if (!pathSet.has(path)) failures.push(`required file is absent: ${path}`);
  }

  const forbidden = paths.filter(
    (path) =>
      path.startsWith("tests/") ||
      path.startsWith("examples/") ||
      path.startsWith("node_modules/") ||
      (/^src\//.test(path) && !/(?:\.js|\.d\.[cm]?ts)$/.test(path)) ||
      path.endsWith(".map"),
  );
  if (forbidden.length) {
    failures.push(`forbidden files are present: ${forbidden.join(", ")}`);
  }

  if (tarball && existsSync(tarball)) {
    if (basename(report.filename || "") !== basename(tarball)) {
      failures.push("tarball filename does not match its report");
    }
    const bytes = readFileSync(tarball);
    if (report.size !== bytes.length) {
      failures.push(`tarball size does not match its bytes: ${report.size} != ${bytes.length}`);
    }
    const shasum = hash(bytes, "sha1", "hex");
    if (report.shasum !== shasum) {
      failures.push("tarball SHA-1 does not match its bytes");
    }
    const integrity = `sha512-${hash(bytes, "sha512", "base64")}`;
    if (report.integrity !== integrity) {
      failures.push("tarball SHA-512 integrity does not match its bytes");
    }
  }

  return failures;
}

function collectDirectoryEntries(root) {
  const entries = [];
  function visit(current) {
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      const relativePath = relative(root, path).split(sep).join("/");
      const stats = lstatSync(path);
      if (stats.isDirectory()) visit(path);
      else entries.push({ path: relativePath, size: stats.size });
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function captureFailure(failures, check) {
  try {
    check();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

export function validateUnpackedPackage(packageRoot, report, manifest) {
  const failures = [];
  const reported = new Map(
    (report?.files || []).map((file) => [file.path, file]),
  );
  const actual = collectDirectoryEntries(packageRoot);
  const actualPaths = new Set(actual.map((entry) => entry.path));

  for (const entry of actual) {
    const expected = reported.get(entry.path);
    if (!expected) {
      failures.push(`unreported file is present in tarball: ${entry.path}`);
    } else if (Number.isSafeInteger(expected.size) && expected.size !== entry.size) {
      failures.push(
        `reported file size differs from unpacked bytes: ${entry.path} (${expected.size} != ${entry.size})`,
      );
    }
  }
  for (const path of reported.keys()) {
    if (!actualPaths.has(path)) failures.push(`reported file is absent from tarball: ${path}`);
  }

  captureFailure(failures, () => {
    const packedManifest = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    );
    if (
      packedManifest.name !== manifest.name ||
      packedManifest.version !== manifest.version
    ) {
      throw new Error("unpacked package identity does not match package.json");
    }
  });

  const paths = new Set(publishedPaths(report));
  const sourceMapFailures = validatePublishedSourceMaps(packageRoot, paths);
  if (sourceMapFailures.length) {
    failures.push(
      `published source-map policy failed:\n${sourceMapFailures.join("\n")}`,
    );
  }
  const markdownFiles = [...paths].filter((path) => path.endsWith(".md"));
  captureFailure(failures, () => {
    const brokenLinks = findBrokenLocalDocumentationLinks(packageRoot, markdownFiles);
    if (brokenLinks.length) {
      throw new Error(
        `published documentation has broken local links:\n${brokenLinks.join("\n")}`,
      );
    }
  });

  captureFailure(failures, () => assertNoSensitiveContent(packageRoot));
  captureFailure(failures, () => {
    const inventory = JSON.parse(
      readFileSync(resolve(packageRoot, "PUBLIC_ASSETS.json"), "utf8"),
    );
    assertPublicAssetInventory(packageRoot, inventory);
  });
  captureFailure(failures, () => {
    const { packageManifest, expected } = readTypeSurfaceInputs(packageRoot);
    assertTypeSurface(packageRoot, packageManifest, expected);
  });

  return failures;
}

function validateArchivePaths(tarball) {
  const result = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  if (result.status !== 0) {
    return [
      `unable to list packed tarball: ${(result.stderr || result.stdout).trim()}`,
    ];
  }
  const failures = [];
  for (const raw of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const path = raw.replace(/\/$/, "");
    if (path === "package") continue;
    if (!path.startsWith("package/") || !isSafePackagePath(path)) {
      failures.push(`unsafe archive path is present: ${raw}`);
    }
  }
  return failures;
}

export function assertPackedPackageContract(tarball, report, manifest) {
  const resolvedTarball = resolve(tarball);
  if (!existsSync(resolvedTarball)) {
    throw new Error(`Package contract failed: tarball does not exist: ${resolvedTarball}`);
  }

  const failures = [
    ...validatePackageReport(report, manifest, resolvedTarball),
    ...validateArchivePaths(resolvedTarball),
  ];
  const work = mkdtempSync(resolve(tmpdir(), "eino-workflow-dag-contract-"));
  try {
    const extraction = spawnSync("tar", ["-xzf", resolvedTarball, "-C", work], {
      encoding: "utf8",
    });
    if (extraction.status !== 0) {
      failures.push(
        `unable to extract packed tarball: ${(extraction.stderr || extraction.stdout).trim()}`,
      );
    } else {
      const packageRoot = resolve(work, "package");
      if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
        failures.push("tarball does not contain a package directory");
      } else {
        failures.push(...validateUnpackedPackage(packageRoot, report, manifest));
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (failures.length) {
    throw new Error(`Package contract failed:\n${failures.join("\n")}`);
  }
}
