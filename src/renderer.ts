import cytoscape from 'cytoscape';
import d3Force from 'cytoscape-d3-force';
import type { Core } from 'cytoscape';

cytoscape.use(d3Force);

export interface GraphHandle { cy: Core; destroy(): void }

export function createGraph(host: HTMLElement): GraphHandle {
  const cy = cytoscape({
    container: host, elements: [],
    layout: { name: 'preset' },
    boxSelectionEnabled: false,
    wheelSensitivity: 0.2, minZoom: 0.02, maxZoom: 4,
  });
  let destroyed = false;
  return { cy, destroy() { if (!destroyed) { destroyed = true; cy.destroy(); } } };
}
