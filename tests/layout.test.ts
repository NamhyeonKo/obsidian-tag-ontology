import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hierarchyPositions, treePositions } from '../src/layout.ts';

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

test('a tag sits one level below its deepest parent, under that parent only', () => {
  // b has two parents: root (level 0) and a (level 1).
  const tree = treePositions(['root', 'a', 'b'], [['root', 'a'], ['a', 'b'], ['root', 'b']]);
  assert.ok(tree.get('root')!.y < tree.get('a')!.y && tree.get('a')!.y < tree.get('b')!.y);
  assert.equal(tree.get('b')!.x, tree.get('a')!.x, 'b is the only child placed under a');
});

test('leaves sit side by side and each parent is centered over its children', () => {
  const tree = treePositions(['root', 'x', 'y', 'z'], [['root', 'x'], ['root', 'y'], ['root', 'z']]);
  const [x, y, z] = ['x', 'y', 'z'].map(tag => tree.get(tag)!);
  assert.ok(x.x < y.x && y.x < z.x); assert.equal(y.x - x.x, z.x - y.x);
  assert.equal(tree.get('root')!.x, y.x);
});

test('root trees wrap into rows, in order, once one row would be too wide for a screen', () => {
  const roots = Array.from({ length: 12 }, (_, i) => `r${i}`);
  const tree = treePositions(roots, []);
  const rows = [...new Set(roots.map(root => tree.get(root)!.y))];
  assert.ok(rows.length > 1, 'twelve roots do not fit on one row');
  for (let i = 1; i < roots.length; i++) {
    const [a, b] = [tree.get(roots[i - 1])!, tree.get(roots[i])!];
    assert.ok(a.y < b.y || (a.y === b.y && a.x < b.x), 'roots keep their order, row by row');
  }
  // Two roots with a few children already fit on one row.
  const small = treePositions(['a', 'b', 'a1', 'a2', 'b1'], [['a', 'a1'], ['a', 'a2'], ['b', 'b1']]);
  assert.equal(small.get('a')!.y, small.get('b')!.y);
});
