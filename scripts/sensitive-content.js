import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, relative, resolve } from "node:path";

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".yaml",
  ".yml",
]);

const signatures = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["credentialed URL", /https?:\/\/[^\s/:]+:[^\s/@]+@/],
  ["bearer credential", /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  [
    "local absolute path",
    /(?:^|[\s"'(=])(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/m,
  ],
];

export function findSensitiveContent(source) {
  const matches = [];
  for (const [label, pattern] of signatures) {
    const match = pattern.exec(source);
    if (match) matches.push({ label, index: match.index });
  }
  return matches;
}

function isTextFile(path) {
  return textExtensions.has(extname(path)) || path.endsWith("LICENSE");
}

export function scanDirectoryForSensitiveContent(
  directory,
  { excludedDirectories = new Set() } = {},
) {
  const root = resolve(directory);
  const failures = [];

  function visit(current) {
    for (const entry of readdirSync(current)) {
      const path = resolve(current, entry);
      const name = relative(root, path);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        if (!excludedDirectories.has(name) && !excludedDirectories.has(entry)) {
          visit(path);
        }
        continue;
      }
      if (!stats.isFile() || !isTextFile(path)) continue;
      const source = readFileSync(path, "utf8");
      for (const match of findSensitiveContent(source)) {
        const line = source.slice(0, match.index).split("\n").length;
        failures.push(`${name}:${line} (${match.label})`);
      }
    }
  }

  visit(root);
  return failures;
}

export function assertNoSensitiveContent(directory, options) {
  const failures = scanDirectoryForSensitiveContent(directory, options);
  if (failures.length) {
    throw new Error(
      `Potential sensitive content requires review:\n${failures.join("\n")}`,
    );
  }
}

export function assertPackedTarballHasNoSensitiveContent(tarball) {
  const work = mkdtempSync(resolve(tmpdir(), "eino-workflow-dag-sensitive-"));
  try {
    const extraction = spawnSync("tar", ["-xzf", resolve(tarball), "-C", work], {
      encoding: "utf8",
    });
    if (extraction.status !== 0) {
      throw new Error(
        `Unable to inspect packed tarball: ${(extraction.stderr || extraction.stdout).trim()}`,
      );
    }
    assertNoSensitiveContent(resolve(work, "package"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
