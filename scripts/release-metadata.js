import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(`Release metadata check failed: ${message}`);
}

export function repositorySlug(repository) {
  const value =
    typeof repository === "string" ? repository : repository?.url;
  if (!value) return null;

  const match = value.match(
    /^(?:git\+)?https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  );
  if (match) return match[1];

  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  return sshMatch?.[1] ?? null;
}

export function resolveReleaseMetadata(manifest, context, options = {}) {
  if (!manifest?.name || !manifest?.version) {
    fail("package name and version are required");
  }

  const expectedTag = `${options.tagPrefix || "v"}${manifest.version}`;
  if (context.tag !== expectedTag) {
    fail(`release tag must be ${expectedTag}, received ${context.tag || "<empty>"}`);
  }

  const slug = repositorySlug(manifest.repository);
  if (!slug) {
    fail("package.json must contain a supported public GitHub repository URL");
  }
  if (slug !== context.githubRepository) {
    fail(
      `package repository must match ${context.githubRepository}, received ${slug}`,
    );
  }

  const isPrerelease = manifest.version.includes("-");
  if (context.releaseIsPrerelease !== undefined) {
    const releaseIsPrerelease =
      context.releaseIsPrerelease === true ||
      context.releaseIsPrerelease === "true";
    if (releaseIsPrerelease !== isPrerelease) {
      fail(
        `${manifest.version} requires GitHub prerelease=${isPrerelease}, received ${releaseIsPrerelease}`,
      );
    }
  }

  if (context.changelog !== undefined) {
    const escapedVersion = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const heading = context.changelog.match(
      new RegExp(`^## \\[${escapedVersion}\\] - (Unreleased|\\d{4}-\\d{2}-\\d{2})$`, "m"),
    );
    if (!heading) {
      fail(`CHANGELOG.md is missing a release heading for ${manifest.version}`);
    }
    if (heading[1] === "Unreleased") {
      fail(`CHANGELOG.md still marks ${manifest.version} as Unreleased`);
    }
    const [year, month, day] = heading[1].split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      fail(`CHANGELOG.md has an invalid release date: ${heading[1]}`);
    }
  }

  return {
    packageName: manifest.name,
    version: manifest.version,
    distTag: isPrerelease ? "next" : "latest",
  };
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  const manifest = JSON.parse(
    readFileSync(resolve(dirname(currentFile), "..", "package.json"), "utf8"),
  );
  const changelog = readFileSync(
    resolve(dirname(currentFile), "..", "CHANGELOG.md"),
    "utf8",
  );
  const metadata = resolveReleaseMetadata(manifest, {
    tag: process.argv[2] || process.env.GITHUB_REF_NAME,
    githubRepository: process.argv[3] || process.env.GITHUB_REPOSITORY,
    releaseIsPrerelease: process.argv[4],
    changelog,
  });

  console.log(`package_name=${metadata.packageName}`);
  console.log(`version=${metadata.version}`);
  console.log(`dist_tag=${metadata.distTag}`);
}
