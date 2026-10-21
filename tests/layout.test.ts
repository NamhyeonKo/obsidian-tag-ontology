import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hierarchyPositions } from '../src/layout.ts';

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
