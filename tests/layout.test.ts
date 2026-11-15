import assert from 'node:assert/strict';
import { test } from 'node:test';
import { treePositions } from '../src/layout.ts';
import { Ontology } from 'tag-ontology';
import { hierarchyDepths } from '../src/hierarchy.ts';

function layout(tags: string[], edges: [string, string][], horizontal = false, outside: string[] = []) {
  const parents = new Map(tags.map(tag => [tag, [] as string[]]));
  for (const [parent, child] of edges) parents.get(child)!.push(parent);
  const model = new Ontology(Object.fromEntries(tags.map(tag => [tag, { description: '', broader: parents.get(tag)! }])), []);
  return treePositions(tags, edges, hierarchyDepths(model), horizontal, outside);
}

test('a tag sits one level below its deepest parent, under that parent only', () => {
  // b has two parents: root (level 0) and a (level 1).
  const tree = layout(['root', 'a', 'b'], [['root', 'a'], ['a', 'b'], ['root', 'b']]);
  assert.ok(tree.get('root')!.y < tree.get('a')!.y && tree.get('a')!.y < tree.get('b')!.y);
  assert.equal(tree.get('b')!.x, tree.get('a')!.x, 'b is the only child placed under a');
});

test('leaves sit side by side and each parent is centered over its children', () => {
  const tree = layout(['root', 'x', 'y', 'z'], [['root', 'x'], ['root', 'y'], ['root', 'z']]);
  const [x, y, z] = ['x', 'y', 'z'].map(tag => tree.get(tag)!);
  assert.ok(x.x < y.x && y.x < z.x); assert.equal(y.x - x.x, z.x - y.x);
  assert.equal(tree.get('root')!.x, y.x);
});

test('all roots share depth zero instead of wrapping onto lower levels', () => {
  const roots = Array.from({ length: 12 }, (_, i) => `r${i}`);
  const tree = layout(roots, []);
  assert.equal(new Set(roots.map(root => tree.get(root)!.y)).size, 1);
  for (let i = 1; i < roots.length; i++) assert.ok(tree.get(roots[i - 1])!.x < tree.get(roots[i])!.x);
});

test('the horizontal tree is the same tree on its side', () => {
  const edges: [string, string][] = [['root', 'x'], ['root', 'y'], ['x', 'leaf']];
  const side = layout(['root', 'x', 'y', 'leaf'], edges, true);
  const [root, x, y, leaf] = ['root', 'x', 'y', 'leaf'].map(tag => side.get(tag)!);
  assert.ok(root.x < x.x && x.x < leaf.x, 'levels run left to right');
  assert.equal(x.x, y.x); assert.ok(x.y < y.y, 'siblings stack top to bottom');
  assert.equal(root.y, (x.y + y.y) / 2);
});

test('tags the hierarchy cannot place sit in a small grid in its bottom-right corner', () => {
  const edges: [string, string][] = [['root', 'x'], ['root', 'y'], ['x', 'leaf']];
  const outside = ['#a', '#b', '#c', '#d', '#e'];
  for (const horizontal of [false, true]) {
    const all = layout(['root', 'x', 'y', 'leaf'], edges, horizontal, outside);
    const tree = ['root', 'x', 'y', 'leaf'].map(tag => all.get(tag)!), corner = outside.map(id => all.get(id)!);
    const right = Math.max(...tree.map(p => p.x)), bottom = Math.max(...tree.map(p => p.y));
    assert.ok(corner.every(p => p.x > right), 'right of the tree');
    assert.equal(Math.max(...corner.map(p => p.y)), bottom, 'level with its bottom');
    assert.equal(new Set(corner.map(p => p.x)).size, 3, 'five tags make three columns');
  }
  assert.ok(layout([], [], false, ['#a']).has('#a'), 'works with no tree at all');
});

test('a 10,000-level chain lays out one level per tag', () => {
  const tags = Array.from({ length: 10000 }, (_, i) => `t${i}`);
  const tree = layout(tags, tags.slice(1).map((tag, i) => [tags[i], tag] as [string, string]));
  assert.equal(tree.get('t9999')!.y - tree.get('t0')!.y, 9999 * (tree.get('t1')!.y - tree.get('t0')!.y));
});


test('full dictionary depths preserve gaps and align levels across roots when a longer branch is hidden', () => {
  const model = new Ontology({
    root: { description: '', broader: [] }, a: { description: '', broader: ['root'] },
    b: { description: '', broader: ['a'] }, leaf: { description: '', broader: ['root', 'b'] },
    other: { description: '', broader: [] }, peer: { description: '', broader: ['other'] },
  }, []);
  const levels = hierarchyDepths(model);
  const all = ['root', 'a', 'b', 'leaf', 'other', 'peer'];
  const edges: [string, string][] = [['root', 'a'], ['a', 'b'], ['b', 'leaf'], ['root', 'leaf'], ['other', 'peer']];
  for (const horizontal of [false, true]) {
    const axis = horizontal ? 'x' : 'y';
    const full = treePositions(all, edges, levels, horizontal);
    const filtered = treePositions(['root', 'leaf', 'other', 'peer'], [['root', 'leaf'], ['other', 'peer']], levels, horizontal);
    const step = full.get('a')![axis] - full.get('root')![axis];
    for (const tag of ['root', 'leaf', 'other', 'peer']) assert.equal(filtered.get(tag)![axis], full.get(tag)![axis]);
    assert.equal(filtered.get('leaf')![axis] - filtered.get('root')![axis], 3 * step);
    assert.equal(full.get('a')![axis], full.get('peer')![axis]);
  }
});

test('the primary visible parent is chosen by full depth rather than the shortened visible path', () => {
  const tags = ['root', 'deep', 'shallow', 'leaf'];
  const edges: [string, string][] = [['root', 'deep'], ['root', 'shallow'], ['deep', 'leaf'], ['shallow', 'leaf']];
  const levels = new Map([['root', 0], ['deep', 3], ['shallow', 1], ['leaf', 4]]);
  for (const horizontal of [false, true]) {
    const axis = horizontal ? 'x' : 'y', across = horizontal ? 'y' : 'x';
    const tree = treePositions(tags, edges, levels, horizontal);
    assert.equal(tree.get('leaf')![across], tree.get('deep')![across]);
    assert.notEqual(tree.get('leaf')![across], tree.get('shallow')![across]);
    const step = tree.get('shallow')![axis] - tree.get('root')![axis];
    assert.equal(tree.get('deep')![axis], 3 * step);
  }
});
