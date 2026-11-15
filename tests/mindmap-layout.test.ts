import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mindmapPositions } from '../src/mindmap-layout.ts';

test('mind map keeps full dictionary depth from left to right and leaves room for labels', () => {
  const levels = new Map([['root', 0], ['leaf', 3], ['peer', 1]]);
  const p = mindmapPositions(['root', 'leaf', 'peer'], [['root', 'leaf'], ['root', 'peer']], levels, []);
  assert.ok(p.get('leaf')!.x > p.get('peer')!.x);
  assert.equal(p.get('leaf')!.x - p.get('root')!.x, 3 * (p.get('peer')!.x - p.get('root')!.x));
  assert.ok(Math.abs(p.get('leaf')!.y - p.get('peer')!.y) >= 40);
});

test('unplaced tags have separate label-sized slots outside the hierarchy', () => {
  const outside = ['a', 'b', 'c', 'd'];
  const p = mindmapPositions(['root'], [], new Map([['root', 0]]), outside);
  for (const id of outside) assert.ok(p.get(id)!.x > p.get('root')!.x + 200);
  for (let i = 0; i < outside.length; i++) for (let j = i + 1; j < outside.length; j++) {
    const a = p.get(outside[i])!, b = p.get(outside[j])!;
    assert.ok(Math.abs(a.x - b.x) >= 220 || Math.abs(a.y - b.y) >= 40);
  }
  assert.equal(mindmapPositions([], [], new Map(), outside).size, outside.length);
});
