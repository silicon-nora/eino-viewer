import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function validatePublishedSourceMaps(packageRoot, publishedPaths) {
  const paths = new Set(publishedPaths);
  const failures = [];

  for (const mapPath of [...paths].filter((path) => path.endsWith(".map"))) {
    failures.push(`generated source map must not be published: ${mapPath}`);
  }

  for (const scriptPath of [...paths].filter((path) => /\.(?:c|m)?js$/.test(path))) {
    const source = readFileSync(resolve(packageRoot, scriptPath), "utf8");
    if (/[/#@]\s*sourceMappingURL\s*=/.test(source)) {
      failures.push(`published script contains sourceMappingURL: ${scriptPath}`);
    }
  }

  return failures;
}
