import { registerRunViewerState, captureRunViewerReading, inspectRunViewer, setRunViewerLocale } from "./run-viewer-state.js";
import { registerViewerState, selectViewerGraphPath, captureViewerViewport, restoreViewerViewport, revealViewerSelection } from "./viewer-state.js";

const version = (input) => {
  const value = input && typeof input === "object" ? input : {};
  return Object.getOwnPropertyDescriptor(value, "schemaVersion")?.value === 2 && Object.getOwnPropertyDescriptor(value, "run")?.value !== undefined ? 2 : 1;
};

/** Switch source versions transactionally; a rejected replacement keeps its view. */
export function createVersionedViewer(container, input, options, createV1, createV2, errorFactory, runViewer = false) {
  let sourceVersion = version(input), current, destroyed = false, locale = options.locale;
  const create = (host, value) => (version(value) === 2 ? createV2 : createV1)(host, value, { ...options, ...(locale ? { locale } : {}) });
  const convert = (error) => {
    if (error?.diagnostics && !(error instanceof errorFactory)) return new errorFactory(error.code || "viewer.invalid_input", error.message, error.diagnostics);
    return error;
  };
  try { current = create(container, input); } catch (error) { throw convert(error); }
  function assertActive() { if (destroyed) throw new errorFactory("viewer.destroyed", "The viewer was destroyed."); }
  function update(value) {
    assertActive();
    try {
      if (sourceVersion === version(value)) { current.update(value); return; }
      // The Run reader only uses the host's ownerDocument and replaceChildren.
      // A forwarding host lets a fully constructed replacement commit atomically.
      const staging = container.ownerDocument.createElement("div");
      let destination = staging;
      const host = { nodeType: 1, ownerDocument: container.ownerDocument,
        replaceChildren(...children) { destination.replaceChildren(...children); } };
      const next = version(value) === 2 || runViewer ? create(host, value) : create(staging, value);
      const previous = current;
      const children = Array.from(staging.children);
      previous.destroy();
      destination = container;
      if (!runViewer && version(value) === 1) {
        // Canvas renderers require a real host Element; retain that element so
        // their update and resize continue targeting the displayed canvas.
        staging.style.width = "100%"; staging.style.height = "100%";
        container.replaceChildren(staging);
      } else container.replaceChildren(...children);
      current = next; sourceVersion = version(value);
    } catch (error) { throw convert(error); }
  }
  const publicInterface = {
    get kind() { return current.kind; }, get document() { return current.document; },
    get explanation() { return current.explanation; },
    get selectedStepId() { return current.selectedStepId ?? null; },
    get selectedGroupId() { return current.selectedGroupId ?? null; },
    get selectedEnvelopeIndex() { return current.selectedEnvelopeIndex ?? null; },
    get selectedEntity() { return current.selectedEntity ?? null; },
    selectStep(id) { assertActive(); return current.selectStep?.(id) || false; },
    selectGroup(id) { assertActive(); return current.selectGroup?.(id) || false; },
    selectEvidence(index) { assertActive(); return current.selectEvidence?.(index) || false; },
    selectEntity(reference) { assertActive(); return current.selectEntity?.(reference) || false; },
    update,
    destroy() { if (destroyed) return; destroyed = true; unregisterRun?.(); unregisterGraph?.(); current.destroy(); },
  };
  const viewer = Object.freeze(runViewer ? publicInterface : Object.defineProperties({}, Object.fromEntries(
    ["kind", "document", "update", "destroy"].map((key) => [key, Object.getOwnPropertyDescriptor(publicInterface, key)]),
  )));
  const unregisterRun = runViewer ? registerRunViewerState(viewer, {
    capture: () => captureRunViewerReading(current), inspect: () => inspectRunViewer(current),
    setLocale(value) { assertActive(); setRunViewerLocale(current, value); locale = value; },
  }) : undefined;
  const unregisterGraph = registerViewerState(viewer, {
    select: (path) => !destroyed && selectViewerGraphPath(current, path),
    capture: () => !destroyed ? captureViewerViewport(current) : undefined,
    restore: (value) => !destroyed && restoreViewerViewport(current, value),
    reveal: () => !destroyed && revealViewerSelection(current),
  });
  return viewer;
}
