import type { LayoutOptions } from 'cytoscape';
import cytoscape from 'cytoscape';
import type { Graph } from './ontology.ts';

export function hierarchyPositions(graph: Graph, roots: string[], circle: boolean) {
  const cy = cytoscape({ headless: true, styleEnabled: true,
    style: [{ selector: 'node', style: { width: 14, height: 14 } }],
    elements: [
      ...graph.nodes.filter(n => n.kind === 'tag').map(n => ({ data: { id: n.id } })),
      ...graph.edges.filter(e => e.kind === 'broader').map(e => ({ data: { id: e.id, source: e.source, target: e.target } })),
    ], layout: { name: 'preset' } });
  try {
    // A headless graph has no viewport; supply pixel bounds instead of using cy.extent().
    cy.layout({ name: 'breadthfirst', directed: true, circle, roots: roots.map(t => 'tag:' + t),
      boundingBox: { x1: -600, y1: -450, w: 1200, h: 900 }, fit: false, spacingFactor: 1.6 }).run();
    return new Map(cy.nodes().map(n => [n.id(), { ...n.position() }]));
  } finally { cy.destroy(); }
}

export function forceLayoutOptions() {
  const options = {
    name: 'd3-force', animate: true, randomize: false, fit: false,
    maxSimulationTime: 3000, maxIterations: 180,
    linkId: (node: { id: string }) => node.id,
    linkDistance: 90,
    manyBodyStrength: -220, manyBodyTheta: 0.9,
    collideRadius: (node: { radius: number }) => node.radius / 2 + 4,
    xStrength: 0.015, yStrength: 0.015,
  };
  return options satisfies LayoutOptions;
}
