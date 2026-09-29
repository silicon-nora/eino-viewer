// Private entry for the workbench. The public package API remains unchanged.
// Build this bridge with the reader so its instance-state registry is shared.
export { createEinoRunViewer } from "../src/run-viewer.js";
export { setRunViewerLocale, captureRunViewerReading, inspectRunViewer } from "../src/run-viewer-state.js";
