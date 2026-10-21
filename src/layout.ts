import cytoscape from 'cytoscape';
export function hierarchyPositions(tags: string[], edges: [parent: string, child: string][], roots: string[], circle: boolean) {
  const cy = cytoscape({ headless: true, styleEnabled: true,
    style: [{ selector: 'node', style: { width: 14, height: 14 } }],
    elements: [
      ...tags.map(tag => ({ data: { id: tag } })),
      ...edges.map(([parent, child]) => ({ data: { id: JSON.stringify([parent, child]), source: parent, target: child } })),
    ], layout: { name: 'preset' } });
  try {
    // A headless graph has no viewport; supply pixel bounds instead of using cy.extent().
    cy.layout({ name: 'breadthfirst', directed: true, circle, roots,
      boundingBox: { x1: -600, y1: -450, w: 1200, h: 900 }, fit: false, spacingFactor: 1.6 }).run();
    return new Map(cy.nodes().map(n => [n.id(), { ...n.position() }]));
  } finally { cy.destroy(); }
}
