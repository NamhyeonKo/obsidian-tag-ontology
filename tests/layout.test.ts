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
    // Levels spread over a 1200x900 box, spaced out by 1.6.
    for (const p of positions.values()) assert.ok(Math.abs(p.x) <= 960 && Math.abs(p.y) <= 720, JSON.stringify(p));
  }
  assert.ok(tree.get('root')!.y < tree.get('leaf')!.y);
  assert.notDeepEqual(tree, radial);
});

test('each level follows the order of the nodes above it, then the tag name', () => {
  // y sorts before z by name, but z hangs under the first root, so it comes first.
  const tree = hierarchyPositions(['a', 'b', 'y', 'z', 'deep'], [['a', 'z'], ['b', 'y'], ['z', 'deep'], ['b', 'deep']], ['b', 'a'], false);
  assert.ok(tree.get('a')!.x < tree.get('b')!.x);
  assert.ok(tree.get('z')!.x < tree.get('y')!.x);
  // A tag under two parents sits one level below the nearest root.
  assert.equal(tree.get('deep')!.y, tree.get('y')!.y);
});
