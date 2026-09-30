import { registerViewerState } from "../src/viewer-state.js";

// A workbench-only drawing of declared Graph connections. Execution remains
// in the reader's canonical model; this renderer never infers traversed edges.
const SVG = "http://www.w3.org/2000/svg";
const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const ROW_GAP = 32;
const COLUMN_GAP = 40;
const PADDING = 48;
const EDGE_CLEARANCE = 2;
let instanceSequence = 0;

const text = {
  zh: { definition: "连线：流程定义", basis: "流程定义", connection: "流程连接", branch: "条件分支", diagram: "Graph 结构", start: "开始", end: "结束",
    boundary: "结构边界", declared: "仅定义", unobserved: "未观测到执行", calls: (count) => `执行 ${count} 次`,
    states: { failed: "失败", cancelled: "已取消", incomplete: "结果未记录", running: "结束未记录", skipped: "已跳过", interrupted: "已中断" } },
  en: { definition: "Connections: flow definition", basis: "Flow definition", connection: "Flow connection", branch: "Conditional branch", diagram: "Graph structure", start: "Start", end: "End",
    boundary: "Structure boundary", declared: "Definition only", unobserved: "No execution observed", calls: (count) => `${count} ${count === 1 ? "call" : "calls"}`,
    states: { failed: "failed", cancelled: "cancelled", incomplete: "result not recorded", running: "end not recorded", skipped: "skipped", interrupted: "interrupted" } },
};

function language(value) { return value === "zh" || value?.statuses?.success === "成功" ? "zh" : "en"; }
function svgElement(dom, name, attributes = {}) {
  const element = dom.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function sourceGraph(model) {
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) throw new TypeError("Expected a Graph topology model");
  const byId = new Map();
  for (const node of model.nodes) {
    if (typeof node.id !== "string" || byId.has(node.id)) throw new TypeError("Expected unique Graph topology node IDs");
    byId.set(node.id, node);
  }
  const edgeIds = new Set();
  for (const edge of model.edges) {
    if (typeof edge.id !== "string" || edgeIds.has(edge.id) || !byId.has(edge.from) || !byId.has(edge.to)) {
      throw new TypeError("Expected unique Graph topology edges with existing endpoints");
    }
    edgeIds.add(edge.id);
  }
  return byId;
}

// Ignore feedback only while assigning display layers, never while drawing.
// Treating a whole cycle as one tall block would place a node's other direct
// branches below the entire cycle, incorrectly suggesting another dependency.
function displayLayers(nodes, edges) {
  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  const incoming = new Map(nodes.map(({ id }) => [id, 0]));
  for (const edge of edges) {
    outgoing.get(edge.from).push(edge);
    if (edge.from !== edge.to) incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const states = new Map(), feedback = new Set();
  // Start at real entry points before considering a disconnected cycle. The
  // original definition order breaks ties, not names or observed visit order.
  const roots = [...nodes.filter(({ kind }) => kind === "start"),
    ...nodes.filter(({ id }) => incoming.get(id) === 0), ...nodes];
  for (const { id } of roots) {
    if (states.has(id)) continue;
    states.set(id, "active");
    const stack = [{ id, offset: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), children = outgoing.get(frame.id);
      if (frame.offset === children.length) { states.set(frame.id, "done"); stack.pop(); continue; }
      const edge = children[frame.offset++];
      if (states.get(edge.to) === "active") feedback.add(edge.id);
      else if (!states.has(edge.to)) { states.set(edge.to, "active"); stack.push({ id: edge.to, offset: 0 }); }
    }
  }
  const ranked = new Map(nodes.map(({ id }) => [id, { rank: 0, next: new Set(), incoming: 0 }]));
  for (const { id, from, to } of edges) {
    if (feedback.has(id)) continue;
    const source = ranked.get(from), target = ranked.get(to);
    if (!source.next.has(to)) { source.next.add(to); target.incoming += 1; }
  }
  const ready = nodes.filter(({ id }) => ranked.get(id).incoming === 0).map(({ id }) => id);
  for (let offset = 0; offset < ready.length; offset += 1) {
    const node = ranked.get(ready[offset]);
    for (const id of node.next) {
      const child = ranked.get(id);
      child.rank = Math.max(child.rank, node.rank + 1);
      child.incoming -= 1;
      if (child.incoming === 0) ready.push(id);
    }
  }
  const rows = new Map();
  for (const { id } of nodes) {
    const rank = ranked.get(id).rank;
    if (!rows.has(rank)) rows.set(rank, []);
    rows.get(rank).push(id);
  }
  return { rows, ranked, feedback, hasReturn: feedback.size > 0 };
}

function directDetours(nodes, edges, layers) {
  const parents = new Map(nodes.map(({ id }) => [id, new Set()]));
  const outgoing = new Map(nodes.map(({ id }) => [id, new Set()]));
  const ordinary = new Set(nodes.filter(({ kind }) => kind === "node").map(({ id }) => id));
  for (const [id, node] of layers.ranked) for (const next of node.next) parents.get(next).add(id);
  for (const { from, to } of edges) if (from !== to) outgoing.get(from).add(to);
  const candidates = new Map();
  for (const edge of edges) {
    // Only a direct out-and-back leaf can share its anchor's row. Check the
    // full definition too: another feedback target is not a simple detour.
    if (!layers.feedback.has(edge.id) || !ordinary.has(edge.from) || !ordinary.has(edge.to)
      || layers.ranked.get(edge.from).next.size || parents.get(edge.from).size !== 1
      || !parents.get(edge.from).has(edge.to) || outgoing.get(edge.from).size !== 1) continue;
    if (!candidates.has(edge.to)) candidates.set(edge.to, new Set());
    candidates.get(edge.to).add(edge.from);
  }
  const sideAnchors = new Map();
  for (const [anchor, detours] of candidates) {
    // Without another structural successor there is no reason to call
    // either half of a cycle the side path. Multiple detours keep their
    // layers as well, rather than arbitrarily privileging one of them.
    if (detours.size !== 1 || ![...layers.ranked.get(anchor).next].some((id) => !detours.has(id))) continue;
    sideAnchors.set([...detours][0], anchor);
  }
  return sideAnchors;
}

function topologyLayout(model) {
  const layers = displayLayers(model.nodes, model.edges), { rows, hasReturn } = layers;
  // Geometry uses definition fields only. Execution membership, outcomes,
  // counts and capture completeness belong exclusively to node presentation.
  const sideAnchors = directDetours(model.nodes, model.edges, layers);
  const detourByAnchor = new Map([...sideAnchors].map(([detour, anchor]) => [anchor, detour]));
  const displayRows = [];
  for (const rank of [...rows.keys()].sort((a, b) => a - b)) {
    let peers = [];
    for (const id of rows.get(rank)) {
      if (sideAnchors.has(id)) continue;
      if (detourByAnchor.has(id)) {
        if (peers.length) { displayRows.push(peers); peers = []; }
        displayRows.push([undefined, id, detourByAnchor.get(id)]);
      } else {
        peers.push(id);
        if (peers.length === 3) { displayRows.push(peers); peers = []; }
      }
    }
    // Center peer rows as a group, keeping the definition order. Bounded
    // width and extra rows imply neither execution order nor concurrency.
    if (peers.length) displayRows.push(peers);
  }
  const columns = Math.max(1, ...displayRows.map((row) => row.length));
  const contentWidth = columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP;
  const returnSpace = hasReturn ? 80 : 24;
  const width = PADDING * 2 + contentWidth + returnSpace;
  const positions = new Map();
  displayRows.forEach((row, rowIndex) => {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
    row.forEach((id, column) => { if (id !== undefined) positions.set(id, {
      x: PADDING + (contentWidth - rowWidth) / 2 + column * (NODE_WIDTH + COLUMN_GAP),
      y: PADDING + rowIndex * (NODE_HEIGHT + ROW_GAP),
    }); });
  });
  const height = PADDING * 2 + Math.max(1, displayRows.length) * NODE_HEIGHT + Math.max(0, displayRows.length - 1) * ROW_GAP;
  return { positions, width, height, sideAnchors, returnX: PADDING + contentWidth + 48 };
}

function parallelOffset(index, count, step, available) {
  return count > 1 ? Math.min(step * (count - 1), Math.max(0, available)) * index / (count - 1) : 0;
}

function forwardPorts(edges, layout) {
  const ports = new Map(), outgoing = new Map(), incoming = new Map();
  for (const edge of edges) {
    const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to);
    if (to.y <= from.y) continue;
    ports.set(edge.id, {});
    for (const [groups, id] of [[outgoing, edge.from], [incoming, edge.to]]) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(edge);
    }
  }
  for (const [groups, field, opposite] of [[outgoing, "sourceX", "to"], [incoming, "targetX", "from"]]) {
    for (const [id, connections] of groups) {
      // Keep forks and joins distinct, ordered spatially rather than by
      // execution. Stable ties preserve the definition order of parallel edges.
      connections.sort((a, b) => layout.positions.get(a[opposite]).x - layout.positions.get(b[opposite]).x);
      const center = layout.positions.get(id).x + NODE_WIDTH / 2;
      // Stay on the flat part of even the rounded start/end boundary.
      const span = Math.min(96, (connections.length - 1) * 48);
      connections.forEach((edge, index) => {
        ports.get(edge.id)[field] = center - span / 2 + parallelOffset(index, connections.length, 48, span);
      });
    }
  }
  return ports;
}

function edgeGeometry(edge, layout, ports, parallelIndex = 0, parallelCount = 1) {
  const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to);
  const { sourceX = from.x + NODE_WIDTH / 2, targetX = to.x + NODE_WIDTH / 2 } = ports.get(edge.id) || {};
  if (edge.from === edge.to) {
    const x = from.x + NODE_WIDTH + EDGE_CLEARANCE, y = from.y + NODE_HEIGHT / 2;
    const rightBoundary = Math.min(layout.width, ...[...layout.positions.values()]
      .filter((point) => point.y === from.y && point.x > from.x).map((point) => point.x));
    // Both cubic controls share an x coordinate, so the arc's maximum
    // horizontal reach is 3/4 of their spread. Keep all parallel loops inside
    // the available column gap, with distinct curves rather than a shared cap.
    const desiredSpread = 56 + (parallelCount - 1) * 12;
    const maximumSpread = Math.min(desiredSpread, (rightBoundary - x - 8) / 0.75);
    const minimumSpread = desiredSpread <= maximumSpread ? 56 : Math.min(56, maximumSpread * 0.65);
    const spread = parallelCount === 1 ? maximumSpread
      : minimumSpread + (maximumSpread - minimumSpread) * parallelIndex / (parallelCount - 1);
    const offset = 12 + parallelOffset(parallelIndex, parallelCount, 8, 10);
    return { direction: "self", d: `M ${x} ${y + offset} C ${x + spread} ${y + offset}, ${x + spread} ${y - offset}, ${x} ${y - offset}` };
  }
  if (to.y === from.y && (layout.sideAnchors.get(edge.from) === edge.to || layout.sideAnchors.get(edge.to) === edge.from)) {
    const returning = layout.sideAnchors.get(edge.from) === edge.to;
    const direction = to.x > from.x ? 1 : -1;
    const startX = (direction > 0 ? from.x + NODE_WIDTH : from.x) + direction * EDGE_CLEARANCE;
    const endX = (direction > 0 ? to.x : to.x + NODE_WIDTH) - direction * EDGE_CLEARANCE;
    const offset = (returning ? 1 : -1) * (12 + parallelOffset(parallelIndex, parallelCount, 10, 12));
    const y = from.y + NODE_HEIGHT / 2 + offset;
    return { direction: returning ? "return" : "forward",
      d: `M ${startX} ${y} H ${endX}` };
  }
  if (to.y <= from.y) {
    const lane = layout.returnX + parallelOffset(parallelIndex, parallelCount, 12, layout.width - 16 - layout.returnX);
    const startX = from.x + NODE_WIDTH + EDGE_CLEARANCE, startY = from.y + NODE_HEIGHT / 2;
    const endX = to.x + NODE_WIDTH + EDGE_CLEARANCE, endY = to.y + NODE_HEIGHT / 2;
    // A Bezier stays inside the bounding box of its controls. Preserve the
    // compact return arc when that box is clear; otherwise route through row
    // and column gaps so even disconnected right-hand nodes remain untouched.
    const bounds = { left: Math.min(startX, endX, lane), right: Math.max(startX, endX, lane),
      top: Math.min(startY, endY - 24), bottom: Math.max(startY + 24, endY) };
    const obstructed = [...layout.positions].some(([id, point]) => id !== edge.from && id !== edge.to
      && point.x < bounds.right && point.x + NODE_WIDTH > bounds.left
      && point.y < bounds.bottom && point.y + NODE_HEIGHT > bounds.top);
    if (obstructed) {
      const sourceGapX = startX + COLUMN_GAP / 2, sourceGapY = from.y + NODE_HEIGHT + ROW_GAP / 2;
      const targetGapX = endX + COLUMN_GAP / 2, targetGapY = to.y - ROW_GAP / 2;
      const radius = 8;
      return { direction: "return", d: `M ${startX} ${startY} H ${sourceGapX - radius} Q ${sourceGapX} ${startY} ${sourceGapX} ${startY + radius} V ${sourceGapY - radius} Q ${sourceGapX} ${sourceGapY} ${sourceGapX + radius} ${sourceGapY} H ${lane - radius} Q ${lane} ${sourceGapY} ${lane} ${sourceGapY - radius} V ${targetGapY + radius} Q ${lane} ${targetGapY} ${lane - radius} ${targetGapY} H ${targetGapX + radius} Q ${targetGapX} ${targetGapY} ${targetGapX} ${targetGapY + radius} V ${endY - radius} Q ${targetGapX} ${endY} ${endX + radius} ${endY} H ${endX}` };
    }
    return { direction: "return", d: `M ${startX} ${startY} C ${lane} ${startY}, ${lane} ${endY}, ${endX} ${endY}` };
  }
  const startY = from.y + NODE_HEIGHT + EDGE_CLEARANCE, endY = to.y - EDGE_CLEARANCE;
  if (to.y > from.y + NODE_HEIGHT + ROW_GAP + 1) {
    // A branching edge which skips a row must not disappear underneath that
    // row's node and look as though it originated there. Route around every
    // intervening box, turning only in the empty space between rows.
    const between = [...layout.positions.values()].filter((point) => point.y > from.y && point.y < to.y);
    // Port spacing must not flip the outside lane of same-column nodes.
    const direction = to.x < from.x ? -1 : 1;
    const baseLane = direction < 0
      ? Math.min(from.x, to.x, ...between.map((point) => point.x)) - 24
      : Math.max(from.x + NODE_WIDTH, to.x + NODE_WIDTH, ...between.map((point) => point.x + NODE_WIDTH)) + 24;
    const available = direction < 0 ? baseLane - 16 : layout.width - 16 - baseLane;
    const lane = baseLane + direction * parallelOffset(parallelIndex, parallelCount, 8, available);
    return { direction: "forward", d: `M ${sourceX} ${startY} L ${sourceX} ${startY + 12} Q ${sourceX} ${startY + 20} ${sourceX + direction * 8} ${startY + 20} L ${lane - direction * 8} ${startY + 20} Q ${lane} ${startY + 20} ${lane} ${startY + 28} L ${lane} ${endY - 28} Q ${lane} ${endY - 20} ${lane - direction * 8} ${endY - 20} L ${targetX + direction * 8} ${endY - 20} Q ${targetX} ${endY - 20} ${targetX} ${endY - 12} L ${targetX} ${endY}` };
  }
  const middleY = (startY + endY) / 2;
  const direction = Math.sign(targetX - sourceX), radius = Math.min(5, Math.abs(targetX - sourceX) / 2);
  // A straight lead-in gives every arrow a clear vertical direction, unlike
  // a shallow Bezier whose final few pixels still look nearly horizontal.
  return { direction: "forward", d: direction === 0 ? `M ${sourceX} ${startY} V ${endY}`
    : `M ${sourceX} ${startY} V ${middleY - radius} Q ${sourceX} ${middleY} ${sourceX + direction * radius} ${middleY} H ${targetX - direction * radius} Q ${targetX} ${middleY} ${targetX} ${middleY + radius} V ${endY}` };
}

function nameLines(value, maxUnits = 21) {
  const units = (char) => /[\u0000-\u024f]/u.test(char) ? 1 : 1.8;
  const lines = [], characters = [...String(value)];
  let line = "", width = 0;
  for (const character of characters) {
    if (width + units(character) > maxUnits || character === "\n") {
      lines.push(line); line = ""; width = 0;
      if (lines.length === 2) { lines[1] = `${lines[1].slice(0, -1)}…`; return lines; }
    }
    if (character !== "\n") { line += character; width += units(character); }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Create an internal SVG reader for one already validated topology model. */
export function createGraphTopologyView(host, model, options = {}) {
  if (!host || host.nodeType !== 1 || typeof host.replaceChildren !== "function") throw new TypeError("Expected a Graph drawing container");
  const nodeById = sourceGraph(model);
  // Keep runtime facts out of the layout input, not merely out of its rules.
  const layout = topologyLayout({
    nodes: model.nodes.map(({ id, kind }) => ({ id, kind })),
    edges: model.edges.map(({ id, from, to }) => ({ id, from, to })),
  });
  const dom = host.ownerDocument, view = dom.defaultView;
  let locale = language(options.locale), disposed = false, selectedId, selectedEdgeId, frame, unregister;
  let viewport, dimensions, drag, edgeReadingPoints, ignoreNextClick = false, pendingFit = true;
  const signature = JSON.stringify([model.nodes.map(({ id }) => id), model.edges.map(({ id, from, to, kind }) => [id, from, to, kind])]);
  const wrapper = dom.createElement("div");
  wrapper.className = "graph-topology";
  const legend = dom.createElement("div");
  legend.className = "graph-topology-legend";
  const definitionLabel = dom.createElement("span"), branchLabel = dom.createElement("span");
  definitionLabel.className = "graph-topology-definition-label";
  branchLabel.className = "graph-topology-branch-label";
  legend.append(definitionLabel, branchLabel);
  branchLabel.hidden = !model.edges.some(({ kind }) => kind === "branch");
  const svg = svgElement(dom, "svg", { "data-graph-topology": "", role: "group", preserveAspectRatio: "xMidYMid meet" });
  const defs = svgElement(dom, "defs"), markerId = `eino-graph-topology-arrow-${++instanceSequence}`;
  for (const [state, color] of [["neutral", "#8292a4"], ["active", "#2758c7"]]) {
    const id = state === "neutral" ? markerId : `${markerId}-active`;
    const marker = svgElement(dom, "marker", { id, "data-graph-arrow": state, viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerUnits: "userSpaceOnUse", markerWidth: 10, markerHeight: 10, orient: "auto" });
    marker.append(svgElement(dom, "path", { d: "M 1 1 L 9 5 L 1 9 z", fill: color }));
    defs.append(marker);
  }
  wrapper.style.setProperty("--graph-topology-active-arrow", `url(#${markerId}-active)`);
  svg.append(defs);
  const edgeElements = new Map();
  const pairs = new Map(), pairCounts = new Map(), ports = forwardPorts(model.edges, layout);
  for (const edge of model.edges) {
    const key = JSON.stringify([edge.from, edge.to]);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  for (const edge of model.edges) {
    const key = JSON.stringify([edge.from, edge.to]), index = pairs.get(key) || 0;
    pairs.set(key, index + 1);
    const geometry = edgeGeometry(edge, layout, ports, index, pairCounts.get(key));
    const group = svgElement(dom, "g", { class: "graph-topology-edge-control", "data-graph-edge-control": edge.id,
      role: "button", tabindex: 0, "aria-pressed": "false" });
    const title = svgElement(dom, "title");
    const focus = svgElement(dom, "path", { d: geometry.d, class: "graph-topology-edge-focus", fill: "none", "aria-hidden": "true" });
    const path = svgElement(dom, "path", { d: geometry.d, class: "graph-topology-edge", "data-graph-edge": edge.id,
      "data-from": edge.from, "data-to": edge.to, "data-edge-kind": edge.kind, "data-edge-direction": geometry.direction,
      "marker-end": `url(#${markerId})`, fill: "none", "aria-hidden": "true" });
    const hit = svgElement(dom, "path", { d: geometry.d, class: "graph-topology-edge-hit", "data-graph-edge-hit": edge.id,
      fill: "none", "aria-hidden": "true" });
    group.append(title, focus, path, hit); svg.append(group);
    edgeElements.set(edge.id, { group, title, path, edge });
  }
  const elements = new Map();
  for (const node of model.nodes) {
    const point = layout.positions.get(node.id), structural = node.kind === "start" || node.kind === "end";
    const group = svgElement(dom, "g", { class: "graph-topology-node", transform: `translate(${point.x} ${point.y})`,
      "data-graph-node": node.id, "data-node-kind": node.kind, "data-status": node.status,
      "data-member-ids": JSON.stringify(node.memberIds || []), "data-status-counts": JSON.stringify(node.statusCounts || {}),
      role: structural ? "img" : "button", ...(structural ? {} : { tabindex: 0, "aria-pressed": "false" }) });
    const title = svgElement(dom, "title");
    const box = svgElement(dom, "rect", { class: "graph-topology-node-box", x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT, rx: 8 });
    const name = svgElement(dom, "text", { class: "graph-topology-node-name", x: NODE_WIDTH / 2, "text-anchor": "middle" });
    const facts = svgElement(dom, "text", { class: "graph-topology-node-facts", x: NODE_WIDTH / 2, y: 53, "text-anchor": "middle" });
    group.append(title, box, name, facts); svg.append(group);
    elements.set(node.id, { group, title, name, facts, structural });
  }
  wrapper.append(svg, legend);
  host.replaceChildren(wrapper);

  function nodeText(node) {
    const t = text[locale], structural = node.kind === "start" || node.kind === "end";
    if (structural) return { name: t[node.kind], facts: "" };
    const count = node.memberIds?.length || 0;
    const definitionOnly = model.definitionOnly === true || node.status === "definition-only" || node.status === "declared";
    if (!count) return { name: node.name || node.id, facts: definitionOnly ? t.declared : t.unobserved };
    const exceptions = Object.entries(node.statusCounts || {}).filter(([status, amount]) => status !== "success" && amount > 0)
      .map(([status, amount]) => locale === "zh" ? `${amount} 次${t.states[status] || status}` : `${amount} ${t.states[status] || status}`);
    return { name: node.name || node.id, facts: [t.calls(count), ...exceptions].join(" · ") };
  }

  function renderLabels() {
    const t = text[locale];
    svg.setAttribute("aria-label", model.name ? `${model.name} · ${t.diagram}` : t.diagram);
    definitionLabel.textContent = t.definition;
    branchLabel.textContent = t.branch;
    for (const { group, title, edge } of edgeElements.values()) {
      const from = nodeText(nodeById.get(edge.from)).name, to = nodeText(nodeById.get(edge.to)).name;
      const label = `${from} → ${to} · ${edge.kind === "branch" ? t.branch : t.connection} · ${t.basis}`;
      title.textContent = label; group.setAttribute("aria-label", label);
    }
    for (const node of model.nodes) {
      const entry = elements.get(node.id), value = nodeText(node);
      const full = [value.name, entry.structural ? t.boundary : value.facts].filter(Boolean).join(" · ");
      entry.title.textContent = full;
      entry.group.setAttribute("aria-label", full);
      entry.name.replaceChildren();
      const lines = nameLines(value.name), firstY = entry.structural ? 37 : lines.length === 1 ? 25 : 17;
      lines.forEach((line, index) => {
        const span = svgElement(dom, "tspan", { x: NODE_WIDTH / 2, y: firstY + index * 17 });
        span.textContent = line; entry.name.append(span);
      });
      const facts = nameLines(value.facts, 25);
      entry.facts.textContent = facts.length > 1 ? `${facts[0].slice(0, -1)}…` : value.facts;
    }
  }

  function measure() {
    const bounds = host.getBoundingClientRect();
    return host.isConnected && bounds.width > 0 && bounds.height > 0 ? { width: bounds.width, height: bounds.height } : undefined;
  }
  function constrainViewport() {
    if (!viewport || !dimensions || !layout.positions.size) return;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const zoom = Math.min(dimensions.width / viewport.width, dimensions.height / viewport.height);
    const constrainAxis = (offset, extent, content) => {
      // Small drawings stay inside the canvas, with room to move through the
      // spare space. Large drawings can reach both ends, with a small gutter.
      const gutter = Math.min(24 / zoom, extent / 4);
      return extent >= content ? clamp(offset, content - extent, 0)
        : clamp(offset, -gutter, content - extent + gutter);
    };
    viewport.x = constrainAxis(viewport.x, viewport.width, layout.width);
    viewport.y = constrainAxis(viewport.y, viewport.height, layout.height);
    // A sparse graph's rectangular bounds can contain an empty corner. Keep
    // actual content visible, not merely an overlap with that box. A focused
    // edge's midpoint also counts, so keyboard reveal of a long outer return
    // is not pulled away from the very connection the reader asked to see.
    const visibleWidth = Math.min(NODE_WIDTH, 48 / zoom, viewport.width / 8);
    const visibleHeight = Math.min(NODE_HEIGHT, 24 / zoom, viewport.height / 8);
    let nearest, distance = Infinity;
    for (const point of layout.positions.values()) {
      const x = clamp(viewport.x, point.x + visibleWidth - viewport.width, point.x + NODE_WIDTH - visibleWidth);
      const y = clamp(viewport.y, point.y + visibleHeight - viewport.height, point.y + NODE_HEIGHT - visibleHeight);
      const shift = (x - viewport.x) ** 2 + (y - viewport.y) ** 2;
      if (shift === 0) return;
      if (shift < distance) { distance = shift; nearest = { x, y }; }
    }
    edgeReadingPoints ??= [...edgeElements.values()].map(({ path }) => path.getPointAtLength(path.getTotalLength() / 2));
    if (edgeReadingPoints.some((point) => point.x >= viewport.x + visibleWidth / 2
      && point.x <= viewport.x + viewport.width - visibleWidth / 2
      && point.y >= viewport.y + visibleHeight / 2
      && point.y <= viewport.y + viewport.height - visibleHeight / 2)) return;
    Object.assign(viewport, nearest);
  }
  function paintViewport() {
    if (disposed || !viewport) return;
    constrainViewport();
    svg.setAttribute("viewBox", [viewport.x, viewport.y, viewport.width, viewport.height].join(" "));
  }
  function fit(readable = false) {
    if (disposed) return;
    const size = measure();
    if (!size) { pendingFit = true; return; }
    const fitted = Math.min(size.width / layout.width, size.height / layout.height, 1);
    // A narrow screen starts at readable text size and can pan. The explicit
    // fit control still offers the complete overview, even for a large graph.
    const zoom = readable ? Math.max(0.8, fitted) : fitted;
    const width = size.width / zoom, height = size.height / zoom;
    viewport = { x: (layout.width - width) / 2, y: readable ? 0 : (layout.height - height) / 2, width, height };
    dimensions = size; pendingFit = false; paintViewport();
  }
  function resize() {
    if (disposed) return;
    const size = measure();
    if (!size) return;
    if (pendingFit || !viewport || !dimensions) { fit(true); return; }
    if (size.width === dimensions.width && size.height === dimensions.height) return;
    const zoom = dimensions.width / viewport.width;
    const width = size.width / zoom, height = size.height / zoom;
    viewport = { x: viewport.x + (viewport.width - width) / 2, y: viewport.y + (viewport.height - height) / 2, width, height };
    dimensions = size; paintViewport();
  }
  function scheduleResize() {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(() => { frame = undefined; resize(); });
  }
  function zoomBy(multiplier) {
    if (disposed) return;
    resize();
    if (!viewport || !dimensions) return;
    const before = dimensions.width / viewport.width;
    // An explicit overview of a large graph may be below a normal interactive
    // minimum. Zooming out must never jump inwards from that fitted scale.
    const minimum = Math.min(0.000001, before), maximum = Math.max(3, before);
    const zoom = Math.min(maximum, Math.max(minimum, before * multiplier));
    const width = dimensions.width / zoom, height = dimensions.height / zoom;
    viewport = { x: viewport.x + (viewport.width - width) / 2, y: viewport.y + (viewport.height - height) / 2, width, height };
    paintViewport();
  }
  function paintSelection() {
    for (const [nodeId, { group, structural }] of elements) {
      const selected = nodeId === selectedId;
      group.classList.toggle("is-selected", selected);
      if (!structural) group.setAttribute("aria-pressed", String(selected));
    }
    for (const [edgeId, { group }] of edgeElements) {
      const selected = edgeId === selectedEdgeId;
      group.classList.toggle("is-selected", selected);
      group.setAttribute("aria-pressed", String(selected));
    }
  }
  function select(path) {
    if (disposed) return false;
    const id = path?.length === 1 ? path[0] : undefined;
    if (path !== null && (!elements.has(id) || elements.get(id).structural)) return false;
    selectedId = id; selectedEdgeId = undefined;
    paintSelection();
    return true;
  }
  function selectEdge(id) {
    if (disposed || (id !== null && !edgeElements.has(id))) return false;
    selectedId = undefined; selectedEdgeId = id === null ? undefined : id;
    paintSelection();
    return true;
  }
  function revealBounds(point, width, height) {
    if (disposed || !point) return false;
    resize();
    if (!viewport) return false;
    const margin = 20;
    const shift = (start, end, offset, extent) => end - start + margin * 2 > extent
      ? (start + end - extent) / 2 : start < offset + margin ? start - margin : end > offset + extent - margin ? end - extent + margin : offset;
    viewport = { ...viewport,
      x: shift(point.x, point.x + width, viewport.x, viewport.width),
      y: shift(point.y, point.y + height, viewport.y, viewport.height) };
    paintViewport(); return true;
  }
  function revealNode(id) { return revealBounds(layout.positions.get(id), NODE_WIDTH, NODE_HEIGHT); }
  function revealEdge(id) {
    if (disposed || !edgeElements.has(id)) return false;
    const path = edgeElements.get(id).path, point = path.getPointAtLength(path.getTotalLength() / 2);
    return revealBounds({ x: point.x - 12, y: point.y - 12 }, 24, 24);
  }
  function reveal() { return selectedEdgeId !== undefined ? revealEdge(selectedEdgeId) : revealNode(selectedId); }
  function onFocus(event) {
    const group = event.target.closest?.('[data-graph-node][role="button"], [data-graph-edge-control]');
    // A pointer can intentionally select the visible end of a long edge. Do
    // not pan its midpoint under the pointer before that click completes.
    if (group?.hasAttribute("data-graph-edge-control")) {
      if (group.matches(":focus-visible")) revealEdge(group.getAttribute("data-graph-edge-control"));
    }
    else if (group) revealNode(group.getAttribute("data-graph-node"));
  }
  function invoke(group) {
    if (disposed || !group || group.getAttribute("role") !== "button") return;
    if (group.hasAttribute("data-graph-edge-control")) {
      const id = group.getAttribute("data-graph-edge-control"), entry = edgeElements.get(id);
      if (!entry) return;
      group.focus({ preventScroll: true });
      options.onEdgeClick?.({ id, edge: entry.edge });
      return;
    }
    const id = group.getAttribute("data-graph-node"), node = nodeById.get(id);
    if (!node) return;
    group.focus({ preventScroll: true });
    options.onNodeClick?.({ id, node });
  }
  function onClick(event) {
    if (ignoreNextClick) { ignoreNextClick = false; return; }
    invoke(event.target.closest?.("[data-graph-node], [data-graph-edge-control]"));
  }
  function onKey(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const group = event.target.closest?.('[data-graph-node][role="button"], [data-graph-edge-control]');
    if (!group || event.repeat) return;
    event.preventDefault(); invoke(group);
  }
  function onPointerDown(event) {
    if (disposed || event.button !== 0 || !viewport) return;
    // Panning must not also start the browser's SVG text selection. Normal
    // node/edge clicks still focus their own control through invoke().
    event.preventDefault();
    ignoreNextClick = false;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }
  function onPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId || !dimensions) return;
    const x = event.clientX - drag.x, y = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(x, y) < 5) return;
    if (!drag.moved) { drag.moved = true; svg.setPointerCapture(event.pointerId); wrapper.classList.add("is-panning"); }
    ignoreNextClick = true;
    viewport = { ...viewport, x: viewport.x - x * viewport.width / dimensions.width, y: viewport.y - y * viewport.height / dimensions.height };
    paintViewport();
    // Discard overshoot at the boundary. Reversing the gesture responds on
    // the next pixel, and a resize/zoom during dragging is not rolled back.
    drag.x = event.clientX; drag.y = event.clientY;
  }
  function endPointer(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    drag = undefined; wrapper.classList.remove("is-panning");
  }
  svg.addEventListener("click", onClick);
  svg.addEventListener("keydown", onKey);
  svg.addEventListener("focusin", onFocus);
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("lostpointercapture", endPointer);
  const observer = new view.ResizeObserver(scheduleResize);
  observer.observe(host);
  renderLabels(); fit(true);

  const instance = {
    setActiveNodePath: select,
    setActiveEdge: selectEdge,
    resetView: fit,
    zoomIn() { zoomBy(1.2); },
    zoomOut() { zoomBy(1 / 1.2); },
    getDiagnostics() { return { layoutRuns: 1, dataPatches: 0, layoutCacheHits: 0 }; },
    setLocale(value) { if (!disposed) { locale = language(value); renderLabels(); } },
    destroy() {
      if (disposed) return;
      disposed = true; observer.disconnect(); view.cancelAnimationFrame(frame); unregister?.();
      svg.removeEventListener("click", onClick); svg.removeEventListener("keydown", onKey);
      svg.removeEventListener("focusin", onFocus);
      svg.removeEventListener("pointerdown", onPointerDown); svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", endPointer); svg.removeEventListener("pointercancel", endPointer);
      svg.removeEventListener("lostpointercapture", endPointer);
      drag = undefined; wrapper.remove();
    },
  };
  unregister = registerViewerState(instance, {
    select, reveal,
    capture() { return !disposed && viewport ? { renderer: "graph-topology", signature, viewBox: { ...viewport } } : undefined; },
    restore(saved) {
      const value = saved?.viewBox;
      if (disposed || saved?.renderer !== "graph-topology" || saved.signature !== signature
        || !value || ![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) return false;
      viewport = { ...value }; dimensions = measure() || dimensions; pendingFit = false; paintViewport(); return true;
    },
  });
  return instance;
}
