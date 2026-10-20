import assert from 'node:assert/strict';
import { test } from 'node:test';
import cytoscape from 'cytoscape';
import '../src/renderer.ts';
import { forceLayoutOptions, hierarchyPositions } from '../src/layout.ts';
import { Ontology } from '../src/ontology.ts';

test('headless Tree and Radial use bounded pixel coordinates, excluding related edges and notes', () => {
  const model = new Ontology({
    root: { description: '', broader: [] },
    mid: { description: '', broader: ['root'] },
    leaf: { description: '', broader: ['mid'], related: ['root'] },
  }, [{ path: 'Note.md', tags: ['leaf'] }]);
  const graph = model.visible(new Set(model.entries.keys()));
  const tree = hierarchyPositions(graph, model.roots, false);
  const radial = hierarchyPositions(graph, model.roots, true);
  for (const positions of [tree, radial]) {
    assert.equal(positions.size, 3);
    for (const p of positions.values()) assert.ok(Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6, 'usable pixel coordinates');
  }
  assert.ok(tree.get('tag:root')!.y < tree.get('tag:leaf')!.y);
  assert.notDeepEqual(tree, radial);
});

test('force layout supports graph string IDs, yields, settles, and preserves the viewport', async () => {
  const cy = cytoscape({ headless: true, elements: [
    { data: { id: 'tag:parent', radius: 12 }, position: { x: 10, y: 10 } },
    { data: { id: 'tag:child', radius: 8 }, position: { x: 20, y: 20 } },
    { data: { id: 'parent-child', source: 'tag:parent', target: 'tag:child' } },
  ], layout: { name: 'preset' } });
  cy.zoom(0.7); cy.pan({ x: 35, y: 70 });
  const viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
  const before = { ...cy.getElementById('tag:child').position() };
  const options = { ...forceLayoutOptions(), maxSimulationTime: 60 };
  const layout = cy.layout(options);
  let stopped = false;
  const done = new Promise<void>(resolve => layout.one('layoutstop', () => { stopped = true; resolve(); }));
  try {
    layout.run();
    assert.equal(stopped, false, 'layout must return before the simulation completes');
    await done;
    assert.notDeepEqual(cy.getElementById('tag:child').position(), before);
    assert.deepEqual({ zoom: cy.zoom(), pan: { ...cy.pan() } }, viewport);
    cy.nodes().forEach(node => assert.ok(Number.isFinite(node.position('x')) && Number.isFinite(node.position('y'))));
  } finally { layout.stop(); cy.destroy(); }
});
