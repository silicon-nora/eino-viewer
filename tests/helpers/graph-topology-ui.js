// Read the actual accessible diagram, without invoking a renderer or changing
// its selection. Canonical/source expectations belong in the calling tests.
export async function topologyFacts(page) {
  return page.locator('#dag svg[data-graph-topology]').evaluate((svg) => ({
    nodes: [...svg.querySelectorAll('[data-graph-node]')].map((node) => ({
      id: node.dataset.graphNode, members: JSON.parse(node.dataset.memberIds),
      counts: JSON.parse(node.dataset.statusCounts), status: node.dataset.status,
      label: node.getAttribute('aria-label'), active: node.getAttribute('aria-pressed') === 'true',
    })),
    edges: [...svg.querySelectorAll('[data-graph-edge]')].map((edge) => ({
      from: edge.dataset.from, to: edge.dataset.to, kind: edge.dataset.edgeKind, path: edge.getAttribute('d'),
    })),
  }));
}

export const topologyNode = (page, id) => page.locator(`#dag [data-graph-node=${JSON.stringify(id)}]`);
