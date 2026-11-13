import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ontology } from 'tag-ontology';
import { canvasEdges, facetColors, grouped, pruneCanvas, freeSpot, placeAside, placeColumn, relativeTime, searchAround, tagsOfNote, type Box, type OnCanvas, type Point, type Size } from '../src/explorer-layout.ts';

const raw = {
  cs: { description: '', broader: [] },
  ml: { description: '', broader: ['cs'] },
  dl: { description: '', broader: ['ml'] },
  ov: { description: '', broader: ['ml'], related: ['dl'] },
  py: { description: '', broader: ['cs'], related: ['ml'] },
};
const model = new Ontology(raw, [{ path: 'A.md', tags: ['ml'] }, { path: 'B.md', tags: ['ml'] }, { path: 'C.md', tags: ['dl', 'ov'] }]);
const on = (tags: string[], notes: string[] = [], groups: string[] = []): OnCanvas => ({ tags: new Set(tags), notes: new Set(notes), groups: new Set(groups) });
const box = (p: Point, s: Size): Box => ({ x1: p.x - s.w / 2, y1: p.y - s.h / 2, x2: p.x + s.w / 2, y2: p.y + s.h / 2 });
const overlap = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

test('freeSpot keeps the wanted spot when it is clear', () => {
  assert.deepEqual(freeSpot({ x: 0, y: 0 }, { w: 100, h: 50 }, [{ x1: 500, y1: 500, x2: 600, y2: 600 }]), { x: 0, y: 0 });
});

test('freeSpot steps down, then up, by the card height plus the gap until clear', () => {
  const size = { w: 100, h: 50 }, here = box({ x: 0, y: 0 }, size), below = box({ x: 0, y: 70 }, size);
  assert.deepEqual(freeSpot({ x: 0, y: 0 }, size, [here]), { x: 0, y: 70 });
  assert.deepEqual(freeSpot({ x: 0, y: 0 }, size, [here, below]), { x: 0, y: -70 });
});

test('placeColumn stacks cards right of the anchor, centered on it', () => {
  const sizes = Array.from({ length: 3 }, () => ({ w: 230, h: 120 }));
  assert.deepEqual(placeColumn({ x: 0, y: 0 }, 1, sizes, []), [{ x: 320, y: -140 }, { x: 320, y: 0 }, { x: 320, y: 140 }]);
  assert.deepEqual(placeColumn({ x: 0, y: 0 }, -1, sizes, []).map(p => p.x), [-320, -320, -320]);
});

test('a large expansion wraps into columns of 12', () => {
  const size = { w: 230, h: 120 }, sizes = Array.from({ length: 30 }, () => size);
  const taken = [box({ x: 0, y: 0 }, size), box({ x: 320, y: 0 }, size)];
  const placed = placeColumn({ x: 0, y: 0 }, 1, sizes, taken);
  assert.equal(placed.length, 30);
  assert.deepEqual([...new Set(placed.map(p => p.x))], [320, 640, 960]);
  assert.deepEqual([12, 12, 6], [320, 640, 960].map(x => placed.filter(p => p.x === x).length));
  const boxes = placed.map(p => box(p, size));
  boxes.forEach((a, i) => {
    for (const b of taken) assert.ok(!overlap(a, b), `card ${i} overlaps a card already on the canvas`);
    boxes.slice(i + 1).forEach((b, j) => assert.ok(!overlap(a, b), `cards ${i} and ${i + j + 1} overlap`));
  });
});

test('placeAside puts the first card at the origin and later ones right of and level with the bottom of the canvas', () => {
  const size = { w: 230, h: 120 };
  assert.deepEqual(placeAside([], size), { x: 0, y: 0 });
  const taken = [box({ x: 0, y: 0 }, size), box({ x: 0, y: -400 }, size)];
  const spot = placeAside(taken, size);
  assert.equal(spot.x, 115 + 160);
  assert.equal(spot.y + size.h / 2, 60);
});

test('searchAround lists only what is not on the canvas, related both ways, and hides notes once the tag has a group', () => {
  assert.deepEqual(searchAround(model, 'ml', on(['ml'], ['A.md'])), { children: ['dl', 'ov'], parents: ['cs'], related: ['py'], notes: ['B.md'] });
  assert.deepEqual(searchAround(model, 'ml', on(['ml', 'dl', 'cs', 'py'])).children, ['ov']);
  assert.deepEqual(searchAround(model, 'ml', on(['ml', 'dl', 'cs', 'py'])).parents, []);
  assert.deepEqual(searchAround(model, 'dl', on(['dl'])).related, ['ov']);
  assert.deepEqual(searchAround(model, 'ml', on(['ml'], [], ['ml'])).notes, []);
});

test('canvasEdges links tags on the canvas by hierarchy and related, notes to every tag on the canvas they carry, and a group to its tag', () => {
  const edges = canvasEdges(model, on(['cs', 'ml', 'dl', 'ov'], ['C.md'], ['ml']));
  const byId = new Map(edges.map(edge => [edge.id, edge]));
  assert.deepEqual([...byId.keys()].sort(), ['g:ml', 'h:cs->ml', 'h:ml->dl', 'h:ml->ov', 'n:dl->C.md', 'n:ov->C.md', 'r:["dl","ov"]']);
  assert.deepEqual(byId.get('h:cs->ml'), { id: 'h:cs->ml', kind: 'broader', source: 'tag:cs', target: 'tag:ml' });
  assert.deepEqual(byId.get('r:["dl","ov"]'), { id: 'r:["dl","ov"]', kind: 'related', source: 'tag:dl', target: 'tag:ov' });
  assert.deepEqual(byId.get('n:dl->C.md'), { id: 'n:dl->C.md', kind: 'note', source: 'tag:dl', target: 'note:C.md' });
  assert.deepEqual(byId.get('g:ml'), { id: 'g:ml', kind: 'note', source: 'tag:ml', target: 'group:ml' });
  const without = canvasEdges(model, on(['cs', 'dl', 'ov'], ['C.md'], ['ml'])).map(edge => edge.id).sort();
  assert.deepEqual(without, ['n:dl->C.md', 'n:ov->C.md', 'r:["dl","ov"]']);
});

test('tagsOfNote lists the dictionary tags a note carries directly', () => {
  assert.deepEqual(tagsOfNote(model, 'C.md'), ['dl', 'ov']);
  assert.deepEqual(tagsOfNote(model, 'missing.md'), []);
});

test('facetColors gives sorted facets the palette in order and wraps after eight', () => {
  const colors = facetColors(['technique', 'language', 'technique']);
  assert.deepEqual([...colors], [['language', '#4ea1ff'], ['technique', '#f0a33c']]);
  const nine = facetColors(Array.from({ length: 9 }, (_, i) => `f${i}`));
  assert.equal(nine.get('f8'), '#4ea1ff');
  assert.equal(nine.get('f7'), '#a3a33a');
});

test('relativeTime counts days, then months, then years', () => {
  const now = Date.UTC(2026, 10, 13), day = 864e5;
  assert.equal(relativeTime(now - day / 2, now), 'today');
  assert.equal(relativeTime(now - day, now), '1 day ago');
  assert.equal(relativeTime(now - 3 * day, now), '3 days ago');
  assert.equal(relativeTime(now - 29 * day, now), '29 days ago');
  assert.equal(relativeTime(now - 30 * day, now), '1 month ago');
  assert.equal(relativeTime(now - 364 * day, now), '12 months ago');
  assert.equal(relativeTime(now - 365 * day, now), '1 year ago');
  assert.equal(relativeTime(now - 730 * day, now), '2 years ago');
});

test('pruneCanvas removes tags gone from the dictionary and their groups, notes whose file is gone, and drops untagged or deleted paths from groups', () => {
  const { ov: _gone, ...rest } = raw;
  const after = new Ontology(rest, [{ path: 'A.md', tags: ['ml'] }, { path: 'B.md', tags: [] }, { path: 'C.md', tags: ['dl'] }]);
  const groups = new Map([['ml', ['A.md', 'B.md', 'C.md']], ['ov', ['C.md']], ['dl', ['C.md']]]);
  const pruned = pruneCanvas(after, path => path !== 'C.md', on(['ml', 'ov', 'dl'], ['A.md', 'B.md', 'C.md'], ['ml', 'ov', 'dl']), groups);
  assert.deepEqual(pruned.tags, ['ov']);
  assert.deepEqual(pruned.notes, ['C.md']);
  assert.deepEqual(pruned.groups.sort(), ['dl', 'ov']);
  assert.deepEqual([...pruned.groupPaths], [['ml', ['A.md']]]);
});

test('pruneCanvas keeps a note card whose tag was removed from it, and only the line goes', () => {
  const after = new Ontology(raw, [{ path: 'A.md', tags: [] }]), canvas = on(['ml'], ['A.md']);
  assert.deepEqual(pruneCanvas(after, () => true, canvas, new Map()).notes, []);
  assert.deepEqual(canvasEdges(after, canvas), []);
});

test('more than 15 notes make a group, 15 stay note cards', () => {
  assert.equal(grouped(15), false);
  assert.equal(grouped(16), true);
});

test('related lines between tags with "--" in their names keep apart', () => {
  const dashed = new Ontology({
    a: { description: '', broader: [], related: ['b--c'] }, 'b--c': { description: '', broader: [] },
    'a--b': { description: '', broader: [], related: ['c'] }, c: { description: '', broader: [] },
  }, []);
  const related = canvasEdges(dashed, on(['a', 'b--c', 'a--b', 'c'])).filter(edge => edge.kind === 'related');
  assert.equal(new Set(related.map(edge => edge.id)).size, 2);
});
