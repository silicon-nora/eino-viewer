import { expect, test } from "@playwright/test";

test("Graph topology safely renders cycles and isolates hidden, resized and destroyed instances", { tag: "@P0" }, async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/__graph-topology-lifecycle__", (route) => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta charset="utf-8"><title>Graph topology lifecycle</title><link rel="stylesheet" href="/site/graph-topology.css"><style>:root{--body:Arial,sans-serif}body{margin:0}.workbench{display:flex;align-items:flex-start;gap:16px}.host{width:600px;height:560px;flex:none}#first{display:none}</style></head><body><main class="workbench" data-reading-kind="graph"><div class="host" id="first"></div><div class="host" id="second"></div></main></body></html>' }));
  await page.goto("/__graph-topology-lifecycle__");
  await page.waitForLoadState("networkidle");
  const label = '<img src="x" onerror="window.__topologyInjected=true"> & a very long literal Graph label '.repeat(3);
  const initial = await page.evaluate(async (label) => {
    const { createGraphTopologyView } = await import("/site/graph-topology-view.js");
    const controls = await import("/src/viewer-state.js");
    const NativeObserver = window.ResizeObserver, observations = [];
    // Wrap the real observer, retaining callbacks solely to deliver a late
    // notification after destroy. Normal hide/show/resize uses native sizing.
    window.ResizeObserver = class {
      constructor(callback) {
        this.record = { callback, observer: this, disconnected: false };
        this.native = new NativeObserver((entries) => callback(entries, this));
        observations.push(this.record);
      }
      observe(target) { this.record.target = target; this.native.observe(target); }
      unobserve(target) { this.native.unobserve(target); }
      disconnect() { this.record.disconnected = true; this.native.disconnect(); }
    };
    const node = (id, kind = "node") => ({ id, kind, name: id === "a" ? label : id,
      status: kind === "node" ? "definition-only" : "structural", statusCounts: {}, memberIds: [] });
    const edge = (id, from, to, kind = "edge") => ({ id, from, to, kind, basis: "declared" });
    // Put a cycle beside disconnected peers: an incoming start edge would
    // move the cycle below those peers and hide return/self-edge collisions.
    const model = { name: "Lifecycle graph", nodes: [node("a"), node("b"), node("c"), node("d"), node("start", "start"), node("end", "end")],
      edges: [edge("branch", "a", "b", "branch"), edge("return", "b", "a"),
        edge("self", "a", "a", "branch"), edge("parallel-self", "a", "a"), edge("exit", "b", "end")] };
    const before = JSON.stringify(model), clicks = [[], []], edgeClicks = [[], []];
    const first = createGraphTopologyView(document.querySelector("#first"), model, { locale: "en",
      onNodeClick: ({ id }) => { clicks[0].push(id); first.setActiveNodePath([id]); },
      onEdgeClick: ({ id }) => { edgeClicks[0].push(id); first.setActiveEdge(id); } });
    const second = createGraphTopologyView(document.querySelector("#second"), model, { locale: "en",
      onNodeClick: ({ id }) => { clicks[1].push(id); second.setActiveNodePath([id]); },
      onEdgeClick: ({ id }) => { edgeClicks[1].push(id); second.setActiveEdge(id); } });
    window.topologyLifecycle = { first, second, controls, observations, NativeObserver, model, before, clicks, edgeClicks };
    return { hiddenHasViewport: Boolean(controls.captureViewerViewport(first)), visibleHasViewport: Boolean(controls.captureViewerViewport(second)) };
  }, label);
  expect(initial).toEqual({ hiddenHasViewport: false, visibleHasViewport: true });
  await page.evaluate(() => { document.querySelector("#first").style.display = "block"; });
  await expect.poll(() => page.evaluate(() => Boolean(window.topologyLifecycle.controls.captureViewerViewport(window.topologyLifecycle.first)))).toBe(true);
  const first = page.locator("#first"), second = page.locator("#second");
  await expect(first.locator("svg[data-graph-topology]")).toBeVisible();
  await expect(first.locator("[data-graph-node]")).toHaveCount(6);
  await expect(first.locator("[data-graph-edge]")).toHaveCount(5);
  await expect(first.locator('[data-graph-edge-control][role="button"][tabindex="0"]')).toHaveCount(5);
  await expect(first.locator('[data-graph-node="a"]')).toHaveAttribute("aria-label", `${label} · Definition only`);
  await expect(first.locator('[data-graph-node="a"] title')).toHaveText(`${label} · Definition only`);
  await expect(first.locator("img,script,foreignObject")).toHaveCount(0);
  await expect(first.locator('[data-graph-node="start"]')).toHaveAttribute("role", "img");
  await expect(first.locator('[data-graph-node="start"]')).not.toHaveAttribute("tabindex", "0");
  await expect(first.locator('[data-graph-node="c"]')).toHaveAttribute("role", "button");
  await expect(first.locator('[data-graph-node="d"]')).toHaveAttribute("role", "button");
  await expect(first.locator('[data-graph-node="end"]')).toHaveAttribute("role", "img");
  await expect(first.locator('[data-graph-edge="self"]')).toHaveAttribute("data-edge-direction", "self");
  await expect(first.locator('[data-graph-edge="parallel-self"]')).toHaveAttribute("data-edge-direction", "self");
  await expect(first.locator('[data-graph-edge="return"]')).toHaveAttribute("data-edge-direction", "return");
  await expect(first.locator('[data-graph-edge="branch"]')).toHaveAttribute("data-edge-direction", "forward");
  await expect(first.locator(".graph-topology-legend")).toContainText("Conditional branch");
  expect(await page.evaluate(() => window.__topologyInjected)).toBeUndefined();

  const geometry = await first.evaluate((host) => {
    const boxes = [...host.querySelectorAll("[data-graph-node]")].map((group) => {
      const box = group.querySelector("rect").getBBox(), matrix = group.transform.baseVal.consolidate().matrix;
      return { id: group.dataset.graphNode, x: box.x + matrix.e, y: box.y + matrix.f, width: box.width, height: box.height };
    });
    const crossings = [], finite = [];
    for (const path of host.querySelectorAll("[data-graph-edge]")) {
      const length = path.getTotalLength();
      finite.push(Number.isFinite(length) && length > 0);
      for (let index = 1; index < 80; index += 1) {
        const point = path.getPointAtLength(length * index / 80);
        for (const box of boxes) if (point.x > box.x + 1 && point.x < box.x + box.width - 1
          && point.y > box.y + 1 && point.y < box.y + box.height - 1) crossings.push([path.dataset.graphEdge, box.id]);
      }
    }
    return { boxes, crossings, finite,
      selfPaths: [...host.querySelectorAll('[data-edge-direction="self"]')].map((path) => path.getAttribute("d")),
      selfEnds: [...host.querySelectorAll('[data-edge-direction="self"]')].map((path) => {
        const point = path.getPointAtLength(path.getTotalLength());
        return { x: point.x, y: point.y };
      }),
      branchDash: getComputedStyle(host.querySelector('[data-graph-edge="branch"]')).strokeDasharray };
  });
  const boxes = new Map(geometry.boxes.map((box) => [box.id, box]));
  expect(boxes.get("a").y).toBe(boxes.get("c").y);
  expect(boxes.get("a").y).toBe(boxes.get("d").y);
  expect(boxes.get("a").x + boxes.get("a").width).toBeLessThan(boxes.get("c").x);
  expect(boxes.get("c").x + boxes.get("c").width).toBeLessThan(boxes.get("d").x);
  expect(boxes.get("b").y).toBeGreaterThan(boxes.get("a").y);
  expect(geometry.finite).toEqual([true, true, true, true, true]);
  expect(geometry.crossings).toEqual([]);
  expect(new Set(geometry.selfPaths).size).toBe(2);
  expect(Math.abs(geometry.selfEnds[0].y - geometry.selfEnds[1].y)).toBeGreaterThanOrEqual(8);
  for (const point of geometry.selfEnds) expect(point.x - boxes.get("a").x - boxes.get("a").width).toBeCloseTo(2);
  expect(geometry.branchDash).not.toBe("none");
  const markers = await page.evaluate(() => [...document.querySelectorAll(".host")].map((host) => {
    const id = host.querySelector("marker").id;
    return { id, local: [...host.querySelectorAll("[data-graph-edge]")].every((edge) => edge.getAttribute("marker-end") === `url(#${id})`) };
  }));
  expect(markers.every(({ local }) => local)).toBe(true);
  expect(markers[0].id).not.toBe(markers[1].id);

  const selection = await page.evaluate(() => {
    const state = window.topologyLifecycle;
    state.secondViewport = state.controls.captureViewerViewport(state.second);
    return { selected: state.controls.selectViewerGraphPath(state.first, ["a"]),
      structural: state.controls.selectViewerGraphPath(state.first, ["start"]), clicks: state.clicks };
  });
  expect(selection).toEqual({ selected: true, structural: false, clicks: [[], []] });
  await expect(first.locator('[data-graph-node="a"]')).toHaveAttribute("aria-pressed", "true");
  await expect(second.locator('[aria-pressed="true"]')).toHaveCount(0);

  const edgeSelection = await page.evaluate(() => {
    const state = window.topologyLifecycle;
    const selected = state.first.setActiveEdge("return");
    const saved = state.controls.captureViewerViewport(state.first);
    state.first.zoomIn();
    const restored = state.controls.restoreViewerViewport(state.first, saved);
    state.first.setActiveEdge("return");
    state.first.setLocale("zh");
    state.first.setLocale("en");
    return { selected, restored, clicks: state.clicks, edgeClicks: state.edgeClicks,
      viewport: state.controls.captureViewerViewport(state.first), saved };
  });
  expect(edgeSelection).toMatchObject({ selected: true, restored: true, clicks: [[], []], edgeClicks: [[], []] });
  expect(edgeSelection.viewport).toEqual(edgeSelection.saved);
  await expect(first.locator('[data-graph-edge-control="return"]')).toHaveAttribute("aria-pressed", "true");
  await expect(first.locator('[data-graph-node][aria-pressed="true"]')).toHaveCount(0);
  await page.evaluate(() => { window.topologyLifecycle.controls.selectViewerGraphPath(window.topologyLifecycle.first, ["a"]); });
  await expect(first.locator('[data-graph-edge-control][aria-pressed="true"]')).toHaveCount(0);
  await expect(first.locator('[data-graph-node="a"]')).toHaveAttribute("aria-pressed", "true");

  await first.locator('[data-graph-edge-control="self"]').press("Enter");
  await expect(first.locator('[data-graph-edge-control="self"]')).toHaveAttribute("aria-pressed", "true");
  await first.locator('[data-graph-edge-control="parallel-self"]').press("Space");
  await expect(first.locator('[data-graph-edge-control="self"]')).toHaveAttribute("aria-pressed", "false");
  await expect(first.locator('[data-graph-edge-control="parallel-self"]')).toHaveAttribute("aria-pressed", "true");
  await expect(first.locator('[data-graph-node][aria-pressed="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.topologyLifecycle.edgeClicks)).toEqual([["self", "parallel-self"], []]);
  await expect(second.locator('[aria-pressed="true"]')).toHaveCount(0);

  await page.evaluate(() => window.topologyLifecycle.first.resetView());
  const hitPoint = await first.evaluate((host) => {
    const path = host.querySelector('[data-graph-edge="exit"]'), hit = host.querySelector('[data-graph-edge-hit="exit"]');
    const length = path.getTotalLength(), matrix = path.getScreenCTM(), style = getComputedStyle(hit);
    // Click four screen pixels away from the thin visible stroke. A DOM hit
    // check chooses a real unobstructed point, not a synthesized click event.
    for (const fraction of [0.5, 0.35, 0.65]) {
      const point = path.getPointAtLength(length * fraction).matrixTransform(matrix);
      const before = path.getPointAtLength(length * fraction - 1).matrixTransform(matrix);
      const after = path.getPointAtLength(length * fraction + 1).matrixTransform(matrix);
      const dx = after.x - before.x, dy = after.y - before.y, tangent = Math.hypot(dx, dy);
      for (const sign of [-1, 1]) {
        const x = point.x - sign * dy / tangent * 4, y = point.y + sign * dx / tangent * 4;
        const target = document.elementFromPoint(x, y);
        if (target?.closest('[data-graph-edge-control]')?.getAttribute("data-graph-edge-control") === "exit") {
          return { x, y, hitWidth: parseFloat(style.strokeWidth), vectorEffect: style.vectorEffect };
        }
      }
    }
    return null;
  });
  expect(hitPoint).not.toBeNull();
  expect(hitPoint.hitWidth).toBeGreaterThanOrEqual(12);
  expect(hitPoint.vectorEffect).toBe("non-scaling-stroke");
  await page.mouse.click(hitPoint.x, hitPoint.y);
  await expect(first.locator('[data-graph-edge-control="exit"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.topologyLifecycle.edgeClicks)).toEqual([["self", "parallel-self", "exit"], []]);
  const beforeDrag = await page.evaluate(() => window.topologyLifecycle.controls.captureViewerViewport(window.topologyLifecycle.first));
  await page.mouse.move(hitPoint.x, hitPoint.y);
  await page.mouse.down();
  await page.mouse.move(hitPoint.x + 28, hitPoint.y + 22, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.topologyLifecycle.controls.captureViewerViewport(window.topologyLifecycle.first))).not.toEqual(beforeDrag);
  expect(await page.evaluate(() => window.topologyLifecycle.edgeClicks)).toEqual([["self", "parallel-self", "exit"], []]);
  await expect(first.locator('[data-graph-edge-control="exit"]')).toHaveAttribute("aria-pressed", "true");
  await expect(second.locator('[aria-pressed="true"]')).toHaveCount(0);
  await first.locator('[data-graph-node="b"]').press("Enter");
  await expect(first.locator('[data-graph-edge-control][aria-pressed="true"]')).toHaveCount(0);
  await expect(first.locator('[data-graph-node="b"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.topologyLifecycle.clicks)).toEqual([["b"], []]);

  const saved = await page.evaluate(() => {
    const state = window.topologyLifecycle;
    state.first.zoomIn();
    state.saved = state.controls.captureViewerViewport(state.first);
    state.first.zoomIn();
    return { saved: state.saved, changed: state.controls.captureViewerViewport(state.first),
      restored: state.controls.restoreViewerViewport(state.first, state.saved), after: state.controls.captureViewerViewport(state.first) };
  });
  expect(saved.changed.viewBox.width).toBeLessThan(saved.saved.viewBox.width);
  expect(saved.restored).toBe(true);
  expect(saved.after).toEqual(saved.saved);
  await page.evaluate(() => { document.querySelector("#first").style.width = "420px"; });
  await expect.poll(() => page.evaluate(() => window.topologyLifecycle.controls.captureViewerViewport(window.topologyLifecycle.first).viewBox.width))
    .toBeLessThan(saved.saved.viewBox.width);
  const resized = await page.evaluate(() => {
    const state = window.topologyLifecycle;
    return { first: state.controls.captureViewerViewport(state.first), second: state.controls.captureViewerViewport(state.second), baseline: state.secondViewport, clicks: state.clicks, edgeClicks: state.edgeClicks };
  });
  expect(resized.first.viewBox.width / resized.first.viewBox.height).toBeCloseTo(420 / 560, 5);
  expect(resized.second).toEqual(resized.baseline);
  expect(resized.clicks).toEqual([["b"], []]);
  expect(resized.edgeClicks).toEqual([["self", "parallel-self", "exit"], []]);

  const disposed = await page.evaluate(async () => {
    const state = window.topologyLifecycle, host = document.querySelector("#first"), svg = host.querySelector("svg");
    const observer = state.observations.find(({ target }) => target === host);
    observer.callback([], observer.observer); // Queue a renderer resize frame before destruction.
    state.first.destroy();
    state.first.destroy();
    let changes = 0;
    const mutations = new MutationObserver((records) => { changes += records.length; });
    mutations.observe(svg, { attributes: true, childList: true, subtree: true });
    const oldMarkup = svg.outerHTML;
    host.style.width = "480px";
    observer.callback([], observer.observer); // Deliver a stale native callback after disconnect.
    state.first.zoomIn();
    state.first.resetView();
    state.first.setLocale("zh");
    state.controls.selectViewerGraphPath(state.first, ["b"]);
    const edgeRejected = state.first.setActiveEdge("self") === false;
    state.first.setActiveEdge(null);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    mutations.disconnect();
    return { disconnected: observer.disconnected, childCount: host.childElementCount, oldUnchanged: svg.outerHTML === oldMarkup, changes,
      viewportGone: state.controls.captureViewerViewport(state.first) === undefined,
      otherViewport: state.controls.captureViewerViewport(state.second), baseline: state.secondViewport,
      sourceUnchanged: JSON.stringify(state.model) === state.before, clicks: state.clicks, edgeClicks: state.edgeClicks, edgeRejected };
  });
  expect(disposed).toMatchObject({ disconnected: true, childCount: 0, oldUnchanged: true, changes: 0, viewportGone: true, sourceUnchanged: true,
    clicks: [["b"], []], edgeClicks: [["self", "parallel-self", "exit"], []], edgeRejected: true });
  expect(disposed.otherViewport).toEqual(disposed.baseline);
  await expect(second.locator("svg[data-graph-topology]")).toBeVisible();
  await expect(second.locator("[data-graph-node]")).toHaveCount(6);
  await page.evaluate(() => {
    const state = window.topologyLifecycle;
    state.second.destroy();
    window.ResizeObserver = state.NativeObserver;
  });
  const routeLayouts = await page.evaluate(async () => {
    const { createGraphTopologyView } = await import("/site/graph-topology-view.js");
    const node = (id, observed = true) => ({ id, name: id,
      kind: ["start", "end"].includes(id) ? id : "node",
      status: ["start", "end"].includes(id) ? "structural" : observed ? "success" : "not-observed",
      statusCounts: observed ? { success: 1 } : {},
      memberIds: observed && !["start", "end"].includes(id) ? [`visit:${id}`] : [] });
    const edge = (id, from, to, kind = "edge") => ({ id, from, to, kind, basis: "declared" });
    // Deliberately put the loop before the real entry and repeat its return.
    // Moving a side node twice must not remove an unrelated node from its row.
    const model = { name: "Declared route layout",
      nodes: [node("loop"), node("finish"), node("start"), node("end"), node("check"), node("prepare"), node("bypass", false)],
      edges: [edge("return", "loop", "check"), edge("parallel-return", "loop", "check"),
        edge("exit", "finish", "end"), edge("entry", "start", "prepare"), edge("prepare-check", "prepare", "check"),
        edge("finish-branch", "check", "finish", "branch"), edge("loop-branch", "check", "loop", "branch"),
        edge("bypass-branch", "check", "bypass", "branch"), edge("bypass-exit", "bypass", "end")] };
    const collect = (current) => {
      const host = document.createElement("div");
      host.className = "host";
      document.body.append(host);
      const before = JSON.stringify(current), viewer = createGraphTopologyView(host, current, { locale: "en" });
      try {
        return { expectedNodes: current.nodes.map(({ id }) => id), expectedEdges: current.edges.map(({ id }) => id),
          sourceUnchanged: JSON.stringify(current) === before,
          nodes: [...host.querySelectorAll("[data-graph-node]")].map((group) => {
            const box = group.querySelector("rect").getBBox(), matrix = group.transform.baseVal.consolidate().matrix;
            return { id: group.dataset.graphNode, x: box.x + matrix.e, y: box.y + matrix.f, width: box.width, height: box.height };
          }),
          labels: [...host.querySelectorAll('[data-node-kind="node"]')].map((group) => ({
            id: group.dataset.graphNode, status: group.dataset.status,
            label: group.getAttribute("aria-label"), title: group.querySelector("title").textContent,
          })),
          edges: [...host.querySelectorAll("[data-graph-edge]")].map((path) => {
            const end = path.getPointAtLength(path.getTotalLength());
            return { id: path.dataset.graphEdge, end: { x: end.x, y: end.y },
              path: path.getAttribute("d"), direction: path.dataset.edgeDirection };
          }) };
      } finally { viewer.destroy(); host.remove(); }
    };
    const before = JSON.stringify(model);
    const withNodes = (change) => ({ ...structuredClone(model), nodes: model.nodes.map((entry) =>
      entry.kind === "node" ? change(structuredClone(entry)) : structuredClone(entry)) });
    // Only execution facts vary: every declared node and edge keeps its source
    // order. Neither observing a branch nor removing visits can move the graph.
    const variants = {
      unique: model,
      ambiguous: withNodes((entry) => node(entry.id)),
      ...Object.fromEntries(["failed", "skipped", "cancelled"].map((status) => [status,
        withNodes((entry) => ({ ...entry, status, statusCounts: { [status]: 1 }, memberIds: [`${status}:${entry.id}`] }))])),
      unobserved: withNodes((entry) => node(entry.id, false)),
      definitionOnly: { ...withNodes((entry) => ({ ...node(entry.id, false), status: "definition-only" })), definitionOnly: true },
      repeated: withNodes((entry) => ({ ...entry, status: "success", statusCounts: { success: 5 },
        memberIds: Array.from({ length: 5 }, (_, index) => `visit:${entry.id}:${index}`) })),
    };
    const layouts = Object.fromEntries(Object.entries(variants).map(([name, current]) => [name, collect(current)]));
    // These cycles lack one unambiguous leaf detour. Their ordinary dependency
    // layers must survive even though each includes at least one return edge.
    const boundaries = [
      { name: "two-node cycle without another successor", nodes: ["anchor", "leaf"],
        edges: [["anchor", "leaf"], ["leaf", "anchor"]], below: [["anchor", "leaf"]] },
      { name: "two returning leaves and an exit", nodes: ["start", "anchor", "left", "right", "end"],
        edges: [["start", "anchor"], ["anchor", "left"], ["left", "anchor"], ["anchor", "right"], ["right", "anchor"], ["anchor", "end"]],
        below: [["anchor", "left"], ["anchor", "right"]] },
      { name: "three-node cycle", nodes: ["start", "anchor", "middle", "leaf", "end"],
        edges: [["start", "anchor"], ["anchor", "middle"], ["middle", "leaf"], ["leaf", "anchor"], ["anchor", "end"]],
        below: [["anchor", "middle"], ["middle", "leaf"]] },
      { name: "leaf returns to another ancestor", nodes: ["start", "ancestor", "anchor", "leaf", "end"],
        edges: [["start", "ancestor"], ["ancestor", "anchor"], ["anchor", "leaf"], ["leaf", "anchor"], ["leaf", "ancestor"], ["anchor", "end"]],
        below: [["ancestor", "anchor"], ["anchor", "leaf"]] },
      { name: "leaf has a second parent", nodes: ["start", "anchor", "parent", "leaf", "end"],
        edges: [["start", "anchor"], ["start", "parent"], ["anchor", "leaf"], ["parent", "leaf"], ["leaf", "anchor"], ["anchor", "end"]],
        below: [["anchor", "leaf"], ["parent", "leaf"]] },
    ].map(({ name, nodes, edges, below }) => ({ name, below, layout: collect({ name,
      nodes: nodes.map((id) => node(id, false)), edges: edges.map(([from, to], index) => edge(`edge:${index}`, from, to)) }) }));
    return { originalUnchanged: JSON.stringify(model) === before, variants: layouts, boundaries };
  });
  expect(routeLayouts.originalUnchanged).toBe(true);
  const baseline = routeLayouts.variants.unique;
  for (const [variant, layout] of Object.entries(routeLayouts.variants)) {
    expect(layout.sourceUnchanged).toBe(true);
    expect(layout.nodes.map(({ id }) => id)).toEqual(layout.expectedNodes);
    expect(layout.edges.map(({ id }) => id)).toEqual(layout.expectedEdges);
    expect(new Set(layout.nodes.map(({ id }) => id)).size).toBe(layout.expectedNodes.length);
    expect(layout.nodes, `${variant} must preserve every declared node position and size`).toEqual(baseline.nodes);
    expect(layout.edges, `${variant} must preserve every declared edge path and arrow endpoint`).toEqual(baseline.edges);
    for (const label of layout.labels) expect(label.title).toBe(label.label);
    const returns = layout.edges.filter(({ id }) => ["return", "parallel-return"].includes(id));
    expect(returns.map(({ direction }) => direction)).toEqual(["return", "return"]);
    expect(new Set(returns.map(({ path }) => path)).size).toBe(2);
  }
  const labelFor = (variant, id) => routeLayouts.variants[variant].labels.find((node) => node.id === id);
  expect(labelFor("unique", "bypass")).toMatchObject({ status: "not-observed", label: "bypass · No execution observed" });
  expect(labelFor("ambiguous", "bypass")).toMatchObject({ status: "success", label: "bypass · 1 call" });
  for (const status of ["failed", "skipped", "cancelled"]) {
    expect(labelFor(status, "finish")).toMatchObject({ status, label: `finish · 1 call · 1 ${status}` });
  }
  expect(labelFor("unobserved", "finish")).toMatchObject({ status: "not-observed", label: "finish · No execution observed" });
  expect(labelFor("definitionOnly", "finish")).toMatchObject({ status: "definition-only", label: "finish · Definition only" });
  expect(labelFor("repeated", "finish")).toMatchObject({ status: "success", label: "finish · 5 calls" });
  const sideReturns = baseline.edges.filter(({ id }) => ["return", "parallel-return"].includes(id));
  expect(Math.abs(sideReturns[0].end.y - sideReturns[1].end.y)).toBeGreaterThanOrEqual(8);
  const uniqueNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const mainNodes = ["start", "prepare", "check", "end"].map((id) => uniqueNodes.get(id));
  expect(new Set(mainNodes.map(({ x }) => x)).size).toBe(1);
  for (let index = 1; index < mainNodes.length; index += 1) expect(mainNodes[index].y).toBeGreaterThan(mainNodes[index - 1].y);
  expect(uniqueNodes.get("loop").y).toBe(uniqueNodes.get("check").y);
  expect(uniqueNodes.get("loop").x).toBeGreaterThan(uniqueNodes.get("check").x + uniqueNodes.get("check").width);
  const finish = uniqueNodes.get("finish"), bypass = uniqueNodes.get("bypass"), check = uniqueNodes.get("check");
  const finishCenter = finish.x + finish.width / 2, bypassCenter = bypass.x + bypass.width / 2;
  const axis = check.x + check.width / 2;
  expect(finish.y).toBe(bypass.y);
  expect(finish.x + finish.width).toBeLessThan(bypass.x);
  expect(finishCenter).toBeLessThan(axis);
  expect(bypassCenter).toBeGreaterThan(axis);
  expect((finishCenter + bypassCenter) / 2).toBe(axis);
  expect(finish.y).toBeGreaterThan(check.y);
  expect(uniqueNodes.get("end").y).toBeGreaterThan(finish.y);
  for (const { name, below, layout } of routeLayouts.boundaries) {
    expect(layout.sourceUnchanged, name).toBe(true);
    expect(layout.nodes.map(({ id }) => id), name).toEqual(layout.expectedNodes);
    expect(layout.edges.map(({ id }) => id), name).toEqual(layout.expectedEdges);
    const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
    for (const [parent, child] of below) {
      expect(nodes.get(child).y, `${name}: ${child} must remain below ${parent}`).toBeGreaterThan(nodes.get(parent).y);
    }
    for (const { path, end } of layout.edges) {
      expect(path, name).toBeTruthy();
      expect(Number.isFinite(end.x) && Number.isFinite(end.y), name).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
