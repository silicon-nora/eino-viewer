import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function importTypesTarget(target) {
  if (!target || typeof target !== "object") return undefined;
  if (typeof target.types === "string") return target.types;
  return importTypesTarget(target.import);
}

function sha256(source) {
  const normalized = Buffer.isBuffer(source)
    ? source.toString("utf8").replace(/\r\n/g, "\n")
    : String(source).replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

export function collectTypeSurface(projectRoot, packageManifest) {
  const surface = {};
  for (const [subpath, target] of Object.entries(packageManifest.exports || {})) {
    const path = importTypesTarget(target);
    if (!path) continue;
    const relativePath = path.replace(/^\.\//, "");
    surface[subpath] = {
      path: relativePath,
      sha256: sha256(readFileSync(resolve(projectRoot, relativePath))),
    };
  }
  return surface;
}

export function validateTypeSurface(actual, expected) {
  const failures = [];
  for (const [subpath, entry] of Object.entries(actual)) {
    const frozen = expected?.[subpath];
    if (!frozen) {
      failures.push(`TYPE_SURFACE.json is missing ${subpath}`);
      continue;
    }
    if (frozen.path !== entry.path) {
      failures.push(
        `${subpath} declaration path changed: expected ${frozen.path}, received ${entry.path}`,
      );
    }
    if (frozen.sha256 !== entry.sha256) {
      failures.push(`${subpath} declaration content changed: ${entry.path}`);
    }
  }
  for (const subpath of Object.keys(expected || {})) {
    if (!actual[subpath]) {
      failures.push(`TYPE_SURFACE.json references unknown typed subpath: ${subpath}`);
    }
  }
  return failures;
}

export function assertTypeSurface(directory, packageManifest, expected) {
  const actual = collectTypeSurface(directory, packageManifest);
  const failures = validateTypeSurface(actual, expected);
  if (failures.length) {
    throw new Error(`Public TypeScript surface mismatch:\n${failures.join("\n")}`);
  }
}

export function readTypeSurfaceInputs(projectRoot) {
  return {
    packageManifest: JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8"),
    ),
    expected: JSON.parse(
      readFileSync(resolve(projectRoot, "TYPE_SURFACE.json"), "utf8"),
    ),
  };
}

export function assertPackedTarballTypeSurface(tarball) {
  const work = mkdtempSync(resolve(tmpdir(), "eino-workflow-dag-types-"));
  try {
    const extraction = spawnSync("tar", ["-xzf", resolve(tarball), "-C", work], {
      encoding: "utf8",
    });
    if (extraction.status !== 0) {
      throw new Error(
        `Unable to inspect packed TypeScript surface: ${(extraction.stderr || extraction.stdout).trim()}`,
      );
    }
    const packageRoot = resolve(work, "package");
    const { packageManifest, expected } = readTypeSurfaceInputs(packageRoot);
    assertTypeSurface(packageRoot, packageManifest, expected);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
