import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(projectRoot, "site");
const distribution = resolve(projectRoot, "node_modules/eino-workflow-dag/dist");
const einoViewerDistribution = resolve(projectRoot, "dist");
const cytoscapeModule = resolve(
  projectRoot,
  "node_modules/cytoscape/dist/cytoscape.esm.min.mjs",
);
const fixtures = resolve(projectRoot, "fixtures");
const output = resolve(projectRoot, ".artifacts/pages");

function directoryRevision(root) {
  const hash = createHash("sha256");
  function visit(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) {
        visit(path, relativePath);
      } else {
        hash.update(relativePath);
        hash.update(readFileSync(path));
      }
    }
  }
  visit(root);
  return hash.digest("hex").slice(0, 12);
}

const revisionHash = createHash("sha256");
revisionHash.update(directoryRevision(einoViewerDistribution));
revisionHash.update(readFileSync(resolve(source, "app.js")));
revisionHash.update(readFileSync(resolve(source, "index.html")));
revisionHash.update(readFileSync(resolve(source, "styles.css")));
revisionHash.update(readFileSync(resolve(source, "agent-reader.js")));
revisionHash.update(readFileSync(resolve(source, "graph-reading.js")));
const internalModules = ["renderer-presentation.js", "reading-presentation.js", "scope-reading.js", "execution-scopes.js", "content-presentation.js", "record-input.js", "json-value.js", "viewer-state.js", "rendered-value-fold.js", "trajectory-reading.js"];
for (const name of internalModules) revisionHash.update(readFileSync(resolve(projectRoot, "src", name)));
const einoViewerRevision = revisionHash.digest("hex").slice(0, 12);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });
// The workbench consumes the same Agent reader as embedded and offline users.
// Its private language/state bridge is bundled together, not publicly exported.
const readerBuild = await build({
  configFile: false, logLevel: "warn",
  build: {
    write: false, target: "es2022", minify: true,
    lib: { entry: resolve(source, "agent-reader.js"), formats: ["es"] },
    rollupOptions: { external: ["eino-workflow-dag"], output: { inlineDynamicImports: true } },
  },
});
const readerChunks = (Array.isArray(readerBuild) ? readerBuild : [readerBuild]).flatMap((result) => result.output);
if (readerChunks.length !== 1 || readerChunks[0].type !== "chunk") throw new Error("Expected one private reader bundle.");
writeFileSync(resolve(output, "agent-reader.js"), readerChunks[0].code);
mkdirSync(resolve(output, "internal", einoViewerRevision), { recursive: true });
for (const name of internalModules) cpSync(resolve(projectRoot, "src", name), resolve(output, "internal", einoViewerRevision, name));
cpSync(distribution, resolve(output, "dist"), { recursive: true });
cpSync(einoViewerDistribution, resolve(output, "eino-viewer", einoViewerRevision), { recursive: true });
mkdirSync(resolve(output, "vendor"), { recursive: true });
cpSync(cytoscapeModule, resolve(output, "vendor/cytoscape.esm.min.mjs"));
cpSync(fixtures, resolve(output, "fixtures"), { recursive: true });

const indexPath = resolve(output, "index.html");
const index = readFileSync(indexPath, "utf8")
  .replace(
    'name="eino-workflow-dag-asset-base" content="../node_modules/eino-workflow-dag/dist/"',
    'name="eino-workflow-dag-asset-base" content="./dist/"',
  )
  .replace(
    'name="eino-viewer-asset-base" content="../dist/"',
    `name="eino-viewer-asset-base" content="./eino-viewer/${einoViewerRevision}/"`,
  )
  .replace(
    'name="eino-viewer-fixture-base" content="../fixtures/"',
    'name="eino-viewer-fixture-base" content="./fixtures/"',
  )
  .replace(
    '"eino-workflow-dag":"../node_modules/eino-workflow-dag/dist/eino-workflow-dag.js"',
    '"eino-workflow-dag":"./dist/eino-workflow-dag.js"',
  )
  .replace(
    '"cytoscape":"../node_modules/cytoscape/dist/cytoscape.esm.min.mjs"',
    '"cytoscape":"./vendor/cytoscape.esm.min.mjs"',
  )
  .replaceAll("__EINO_VIEWER_ASSET_REVISION__", einoViewerRevision);
writeFileSync(indexPath, index);
const appPath = resolve(output, "app.js");
writeFileSync(
  appPath,
  readFileSync(appPath, "utf8").replaceAll("__EINO_VIEWER_ASSET_REVISION__", einoViewerRevision)
    .replace('"../src/renderer-presentation.js"', `"./internal/${einoViewerRevision}/renderer-presentation.js"`)
    .replace('"../src/reading-presentation.js"', `"./internal/${einoViewerRevision}/reading-presentation.js"`)
    .replace('"../src/content-presentation.js"', `"./internal/${einoViewerRevision}/content-presentation.js"`)
    .replace('"../src/record-input.js"', `"./internal/${einoViewerRevision}/record-input.js"`)
    .replace('"../src/viewer-state.js"', `"./internal/${einoViewerRevision}/viewer-state.js"`)
    .replace('"../src/rendered-value-fold.js"', `"./internal/${einoViewerRevision}/rendered-value-fold.js"`)
    .replace('"../src/trajectory-reading.js"', `"./internal/${einoViewerRevision}/trajectory-reading.js"`)
    .replace('"../src/scope-reading.js"', `"./internal/${einoViewerRevision}/scope-reading.js"`),
);
writeFileSync(resolve(output, ".nojekyll"), "");
const graphReadingPath = resolve(output, "graph-reading.js");
writeFileSync(graphReadingPath, readFileSync(graphReadingPath, "utf8")
  .replace('"../src/renderer-presentation.js"', `"./internal/${einoViewerRevision}/renderer-presentation.js"`));

console.log(`OK: public playground built at ${output}`);
