// Package-private bridge for the offline shell. This is deliberately absent
// from the package entry points and public viewer interface.
const controllers = new WeakMap();

export function registerRunViewerState(viewer, controller) {
  controllers.set(viewer, controller);
  return () => controllers.delete(viewer);
}

export function setRunViewerLocale(viewer, locale) {
  const controller = controllers.get(viewer);
  if (!controller) throw new Error("The saved-result viewer is not active.");
  controller.setLocale(locale);
}

export function captureRunViewerReading(viewer) {
  return controllers.get(viewer)?.capture();
}

// Internal workbench diagnostics; never reconstruct reading state from DOM.
export function inspectRunViewer(viewer) {
  return controllers.get(viewer)?.inspect?.();
}
