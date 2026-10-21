import assert from 'node:assert/strict';
import { test } from 'node:test';
import cytoscape from 'cytoscape';
import '../src/renderer.ts';
import { forceLayoutOptions, hierarchyPositions } from '../src/layout.ts';

test('headless Tree and Radial place plain tag lists inside the layout box', () => {
  const tags = ['root', 'a', 'b', 'leaf'];
  const edges: [string, string][] = [['root', 'a'], ['root', 'b'], ['a', 'leaf']];
  const tree = hierarchyPositions(tags, edges, ['root'], false);
  const radial = hierarchyPositions(tags, edges, ['root'], true);
  for (const positions of [tree, radial]) {
    assert.deepEqual([...positions.keys()].sort(), ['a', 'b', 'leaf', 'root']);
    // breadthfirst spreads the 1200x900 box by spacingFactor 1.6.
    for (const p of positions.values()) assert.ok(Math.abs(p.x) <= 960 && Math.abs(p.y) <= 720, JSON.stringify(p));
  }
  assert.ok(tree.get('root')!.y < tree.get('leaf')!.y);
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
