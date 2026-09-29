import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isESM = mode === "es";
  return {
    build: {
      emptyOutDir: isESM,
      lib: {
        entry: {
          index: resolve(import.meta.dirname, "src/index.js"),
          protocol: resolve(import.meta.dirname, "src/protocol.js"),
          views: resolve(import.meta.dirname, "src/views.js"),
          viewer: resolve(import.meta.dirname, "src/viewer.js"),
          "run-viewer": resolve(import.meta.dirname, "src/run-viewer.js"),
          "execution-dag": resolve(import.meta.dirname, "src/execution-dag.js"),
          trajectory: resolve(import.meta.dirname, "src/trajectory.js"),
          explanation: resolve(import.meta.dirname, "src/explanation.js"),
          workflow: resolve(import.meta.dirname, "src/workflow.js"),
        },
        formats: [isESM ? "es" : "cjs"],
        fileName: (format, entryName) => {
          if (format === "cjs") {
            return entryName === "index" ? "eino-viewer.cjs" : `${entryName}.cjs`;
          }
          return entryName === "index" ? "eino-viewer.js" : `${entryName}.js`;
        },
      },
      rollupOptions: {
        external: ["eino-workflow-dag"],
        output: { exports: "named" },
      },
      sourcemap: false,
    },
  };
});
