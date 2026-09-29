import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

function isExternalOrAnchor(raw) {
  return !raw || raw.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(raw);
}

export function findBrokenLocalDocumentationLinks(rootDirectory, files) {
  const root = resolve(rootDirectory);
  const rootPrefix = `${root}${sep}`;
  const failures = [];

  for (const name of files) {
    const file = resolve(root, name);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const raw = match[1].trim().replace(/^<|>$/g, "");
      if (isExternalOrAnchor(raw)) continue;
      let local;
      try {
        local = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
      } catch {
        failures.push(`${name} -> ${raw} (invalid URL encoding)`);
        continue;
      }
      const target = resolve(dirname(file), local);
      if (
        (target !== root && !target.startsWith(rootPrefix)) ||
        !existsSync(target)
      ) {
        failures.push(`${name} -> ${raw}`);
      }
    }
  }

  return failures;
}
