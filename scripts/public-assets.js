import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const reviewedAssetExtensions = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".bmp",
  ".db",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".sqlite",
  ".svg",
  ".tar",
  ".tgz",
  ".tif",
  ".tiff",
  ".ttf",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip",
]);

function normalizePath(path) {
  return path.split(sep).join("/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function looksBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function findReviewableAssets(
  directory,
  { excludedDirectories = new Set() } = {},
) {
  const root = resolve(directory);
  const assets = [];

  function visit(current) {
    for (const entry of readdirSync(current)) {
      const path = resolve(current, entry);
      const name = normalizePath(relative(root, path));
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        assets.push({ path: name, kind: "symlink", sha256: null });
        continue;
      }
      if (stats.isDirectory()) {
        if (!excludedDirectories.has(entry)) visit(path);
        continue;
      }
      if (!stats.isFile()) continue;
      const extension = extname(entry).toLowerCase();
      const contents = readFileSync(path);
      if (!reviewedAssetExtensions.has(extension) && !looksBinary(contents)) {
        continue;
      }
      assets.push({
        path: name,
        kind: extension ? extension.slice(1) : "binary",
        sha256: sha256(contents),
      });
    }
  }

  visit(root);
  return assets.sort((left, right) => left.path.localeCompare(right.path));
}

export function validatePublicAssetInventory(directory, inventory, options) {
  const failures = [];
  if (inventory?.version !== 1) {
    failures.push("PUBLIC_ASSETS.json version must be 1");
  }
  if (!Array.isArray(inventory?.assets)) {
    failures.push("PUBLIC_ASSETS.json assets must be an array");
    return failures;
  }

  const declared = new Map();
  for (const asset of inventory.assets) {
    const path = typeof asset?.path === "string" ? asset.path : "";
    if (!path || path.startsWith("/") || path.split("/").includes("..")) {
      failures.push(`invalid asset path: ${path || "<missing>"}`);
      continue;
    }
    if (declared.has(path)) {
      failures.push(`duplicate asset declaration: ${path}`);
      continue;
    }
    declared.set(path, asset);
    for (const field of ["kind", "sha256", "source", "license", "reviewedBy", "reviewedOn"]) {
      if (typeof asset[field] !== "string" || !asset[field].trim()) {
        failures.push(`${path} is missing ${field}`);
      }
    }
    if (asset.reviewedOn && !isCalendarDate(asset.reviewedOn)) {
      failures.push(`${path} reviewedOn must be a valid YYYY-MM-DD date`);
    }
  }

  const found = findReviewableAssets(directory, options);
  const foundPaths = new Set(found.map((asset) => asset.path));
  for (const asset of found) {
    const record = declared.get(asset.path);
    if (!record) {
      failures.push(`unreviewed public asset: ${asset.path}`);
      continue;
    }
    if (record.kind !== asset.kind) {
      failures.push(`${asset.path} kind changed: expected ${record.kind}, received ${asset.kind}`);
    }
    if (record.sha256 !== asset.sha256) {
      failures.push(`${asset.path} SHA-256 does not match reviewed content`);
    }
  }
  for (const path of declared.keys()) {
    if (!foundPaths.has(path)) failures.push(`declared asset is absent: ${path}`);
  }
  return failures;
}

export function assertPublicAssetInventory(directory, inventory, options) {
  const failures = validatePublicAssetInventory(directory, inventory, options);
  if (failures.length) {
    throw new Error(`Public asset review failed:\n${failures.join("\n")}`);
  }
}

export function assertPackedTarballAssetsAreReviewed(tarball) {
  const work = mkdtempSync(resolve(tmpdir(), "eino-workflow-dag-assets-"));
  try {
    const extraction = spawnSync("tar", ["-xzf", resolve(tarball), "-C", work], {
      encoding: "utf8",
    });
    if (extraction.status !== 0) {
      throw new Error(
        `Unable to inspect packed tarball assets: ${(extraction.stderr || extraction.stdout).trim()}`,
      );
    }
    const packageRoot = resolve(work, "package");
    const inventory = JSON.parse(
      readFileSync(resolve(packageRoot, "PUBLIC_ASSETS.json"), "utf8"),
    );
    assertPublicAssetInventory(packageRoot, inventory);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
