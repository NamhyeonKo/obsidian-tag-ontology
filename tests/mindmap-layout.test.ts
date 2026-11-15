import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mindmapPositions } from '../src/mindmap-layout.ts';

test('mind map places direct children in the next column with room for labels', () => {
  const p = mindmapPositions(['root', 'leaf', 'peer'], [['root', 'leaf'], ['root', 'peer']], []);
  assert.equal(p.get('root')!.x, 0);
  assert.equal(p.get('leaf')!.x, 260);
  assert.equal(p.get('peer')!.x, 260);
  assert.ok(Math.abs(p.get('leaf')!.y - p.get('peer')!.y) >= 40);
});

test('mind map uses the longest open path regardless of incoming node order', () => {
  const tags = ['leaf', 'b', 'root', 'a'];
  const edges: [string, string][] = [['root', 'leaf'], ['root', 'a'], ['a', 'b'], ['b', 'leaf']];
  const open = mindmapPositions(tags, edges, []);
  assert.equal(open.get('leaf')!.x, 780);
  assert.equal(open.get('b')!.x, 520);
  const closed = mindmapPositions(tags, edges.filter(([parent]) => parent !== 'b'), []);
  assert.equal(closed.get('leaf')!.x, 260, 'a visible parent with a closed connection does not affect distance');
});

test('mind map handles a deep open branch without recursive traversal', () => {
  const tags = Array.from({ length: 10000 }, (_, i) => String(i));
  const edges: [string, string][] = tags.slice(1).map((tag, i) => [tags[i], tag]);
  const p = mindmapPositions([...tags].reverse(), edges, []);
  assert.equal(p.get('9999')!.x, 9999 * 260);
  assert.equal(p.size, tags.length);
});

test('unplaced tags have separate label-sized slots outside the hierarchy', () => {
  const outside = ['a', 'b', 'c', 'd'];
  const p = mindmapPositions(['root'], [], outside);
  for (const id of outside) assert.ok(p.get(id)!.x > p.get('root')!.x + 200);
  for (let i = 0; i < outside.length; i++) for (let j = i + 1; j < outside.length; j++) {
    const a = p.get(outside[i])!, b = p.get(outside[j])!;
    assert.ok(Math.abs(a.x - b.x) >= 220 || Math.abs(a.y - b.y) >= 40);
  }
  assert.equal(mindmapPositions([], [], outside).size, outside.length);
});
