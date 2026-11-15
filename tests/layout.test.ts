import assert from 'node:assert/strict';
import { test } from 'node:test';
import { treePositions } from '../src/layout.ts';

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

test('the horizontal tree is the same tree on its side', () => {
  const edges: [string, string][] = [['root', 'x'], ['root', 'y'], ['x', 'leaf']];
  const side = treePositions(['root', 'x', 'y', 'leaf'], edges, true);
  const [root, x, y, leaf] = ['root', 'x', 'y', 'leaf'].map(tag => side.get(tag)!);
  assert.ok(root.x < x.x && x.x < leaf.x, 'levels run left to right');
  assert.equal(x.x, y.x); assert.ok(x.y < y.y, 'siblings stack top to bottom');
  assert.equal(root.y, (x.y + y.y) / 2);
});

test('tags the hierarchy cannot place sit in a small grid in its bottom-right corner', () => {
  const edges: [string, string][] = [['root', 'x'], ['root', 'y'], ['x', 'leaf']];
  const outside = ['#a', '#b', '#c', '#d', '#e'];
  for (const horizontal of [false, true]) {
    const all = treePositions(['root', 'x', 'y', 'leaf'], edges, horizontal, outside);
    const tree = ['root', 'x', 'y', 'leaf'].map(tag => all.get(tag)!), corner = outside.map(id => all.get(id)!);
    const right = Math.max(...tree.map(p => p.x)), bottom = Math.max(...tree.map(p => p.y));
    assert.ok(corner.every(p => p.x > right), 'right of the tree');
    assert.equal(Math.max(...corner.map(p => p.y)), bottom, 'level with its bottom');
    assert.equal(new Set(corner.map(p => p.x)).size, 3, 'five tags make three columns');
  }
  assert.ok(treePositions([], [], false, ['#a']).has('#a'), 'works with no tree at all');
});

test('a 10,000-level chain lays out one level per tag', () => {
  const tags = Array.from({ length: 10000 }, (_, i) => `t${i}`);
  const tree = treePositions(tags, tags.slice(1).map((tag, i) => [tags[i], tag] as [string, string]));
  assert.equal(tree.get('t9999')!.y - tree.get('t0')!.y, 9999 * (tree.get('t1')!.y - tree.get('t0')!.y));
});
