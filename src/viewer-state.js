// Package-private graph controls. Public viewer instances retain their original
// shape; the saved-result reader can synchronize navigation without DOM probes.
const controllers = new WeakMap();
const cytoscapeAccessor = Symbol.for("eino-workflow-dag.cytoscape");
const routingStyles = ["curve-style", "source-endpoint", "target-endpoint", "edge-distances", "segment-weights", "segment-distances"];

function nativeGraph(instance) {
  const accessor = instance?.[cytoscapeAccessor];
  const graph = typeof accessor === "function" ? accessor.call(instance) : undefined;
  return graph && !graph.destroyed?.() ? graph : undefined;
}

function nativeController(instance) {
  if (typeof instance?.setActiveNodePath !== "function") return undefined;
  return {
    select(path) { instance.setActiveNodePath(path); return true; },
    capture() {
      const graph = nativeGraph(instance);
      if (!graph) return undefined;
      const zoom = graph.zoom(), pan = graph.pan();
      return { zoom, pan: { x: pan.x, y: pan.y } };
    },
    restore(viewport) {
      const graph = nativeGraph(instance);
      if (!graph || !Number.isFinite(viewport?.zoom) || viewport.zoom <= 0
        || !Number.isFinite(viewport?.pan?.x) || !Number.isFinite(viewport?.pan?.y)) return false;
      graph.viewport({ zoom: viewport.zoom, pan: { x: viewport.pan.x, y: viewport.pan.y } });
      return true;
    },
    reveal() {
      const graph = nativeGraph(instance);
      if (!graph) return false;
      // Core resize updates dimensions without fitting. The renderer's public
      // resize is intentionally never used because it always resets zoom.
      graph.resize();
      const active = graph.nodes(".active-node");
      if (active.length !== 1) return false;
      const bounds = active.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
      const width = graph.width(), height = graph.height(), margin = 16;
      if (!(width > 0 && height > 0)) return false;
      const shift = (start, end, size) => end - start > size - margin * 2
        ? size / 2 - (start + end) / 2 : start < margin ? margin - start : end > size - margin ? size - margin - end : 0;
      const x = shift(bounds.x1, bounds.x2, width), y = shift(bounds.y1, bounds.y2, height);
      if (x || y) graph.panBy({ x, y });
      return true;
    },
  };
}

function controller(instance) { return controllers.get(instance) || nativeController(instance); }

export function registerViewerState(instance, value) {
  controllers.set(instance, value);
  return () => controllers.delete(instance);
}

export function selectViewerGraphPath(instance, path) {
  if (path !== null && (!Array.isArray(path) || path.some((part) => typeof part !== "string"))) return false;
  return controller(instance)?.select(path === null ? null : [...path]) || false;
}

export function captureViewerViewport(instance) { return controller(instance)?.capture(); }
export function restoreViewerViewport(instance, viewport) { return controller(instance)?.restore(viewport) || false; }
export function revealViewerSelection(instance) { return controller(instance)?.reveal?.() || false; }

// Locale changes alter label geometry, not the recorded path. Save the same
// native routing facts as its layout cache so viewport clamping sees the old
// reading layout; moving only nodes would leave edge routes in the new layout.
export function captureViewerLayout(instance) {
  const graph = nativeGraph(instance);
  if (!graph) return undefined;
  return {
    nodes: graph.nodes().map((node) => {
      const routing = node.scratch("einoWorkflowDAG") || {};
      const position = node.isParent() ? undefined : { ...node.position() };
      return { id: node.id(), parent: node.parent().id() || null, position,
        ports: (routing.ports || []).map((port) => ({ ...port })) };
    }),
    edges: graph.edges().map((edge) => {
      const routing = edge.scratch("einoWorkflowDAG") || {};
      return { id: edge.id(), source: edge.source().id(), target: edge.target().id(),
        points: (routing._flowAbsRoute || []).map((point) => ({ x: point.x, y: point.y })),
        sourcePort: routing.sourcePort || null, targetPort: routing.targetPort || null,
        style: Object.fromEntries(routingStyles.map((key) => [key, edge.style(key)])) };
    }),
  };
}

export function restoreViewerLayout(instance, layout) {
  const graph = nativeGraph(instance);
  if (!graph || !layout) return false;
  const nodes = graph.nodes(), edges = graph.edges();
  const savedNodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const savedEdges = new Map(layout.edges.map((edge) => [edge.id, edge]));
  // A new scope/topology must use its own layout, even if some IDs overlap.
  if (nodes.length !== savedNodes.size || edges.length !== savedEdges.size
    || !nodes.every((node) => {
      const saved = savedNodes.get(node.id());
      return saved && saved.parent === (node.parent().id() || null)
        && (node.isParent() || Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y));
    }) || !edges.every((edge) => {
      const saved = savedEdges.get(edge.id());
      return saved && saved.source === edge.source().id() && saved.target === edge.target().id();
    })) return false;
  graph.batch(() => {
    nodes.forEach((node) => {
      const saved = savedNodes.get(node.id());
      if (!node.isParent()) node.position({ ...saved.position });
      const routing = node.scratch("einoWorkflowDAG") || {};
      node.scratch("einoWorkflowDAG", { ...routing, ports: saved.ports.map((port) => ({ ...port })) });
    });
    edges.forEach((edge) => {
      const saved = savedEdges.get(edge.id());
      const routing = edge.scratch("einoWorkflowDAG") || {};
      edge.scratch("einoWorkflowDAG", { ...routing,
        _flowAbsRoute: saved.points.map((point) => ({ ...point })),
        sourcePort: saved.sourcePort, targetPort: saved.targetPort });
      edge.style({ ...saved.style });
    });
  });
  return true;
}
