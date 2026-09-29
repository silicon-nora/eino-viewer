import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveReleaseMetadata } from "./release-metadata.js";

const projectRoot = resolve(import.meta.dirname, "..");
const packageRoot = projectRoot;
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const changelog = readFileSync(resolve(packageRoot, "CHANGELOG.md"), "utf8");
const metadata = resolveReleaseMetadata(
  manifest,
  {
    tag: process.argv[2] || process.env.GITHUB_REF_NAME,
    githubRepository: process.argv[3] || process.env.GITHUB_REPOSITORY,
    releaseIsPrerelease: process.argv[4],
    changelog,
  },
  { tagPrefix: "v" },
);

console.log(`package_name=${metadata.packageName}`);
console.log(`version=${metadata.version}`);
console.log(`dist_tag=${metadata.distTag}`);
