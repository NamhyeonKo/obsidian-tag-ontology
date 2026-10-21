import assert from 'node:assert/strict';
import test from 'node:test';
import { Ontology } from '../src/ontology.ts';
import { applyCollapse, resolveTags, type NativeData } from '../src/layer.ts';

const model = new Ontology({
  cs: { description: '', broader: [] }, sec: { description: '', broader: [] },
  ml: { description: '', broader: ['cs'] }, dl: { description: '', broader: ['ml'] },
  crypto: { description: '', broader: ['cs', 'sec'] },
  overfitting: { description: '', broader: ['ml'], related: ['dl'] },
  loose: { description: '' },
}, []);
const core = (): NativeData => ({ numLinks: 5, nodes: {
  'A.md': { type: '', links: { '#DL': true, 'B.md': true } },
  'B.md': { type: '', links: { '#crypto': true, '#loose': true, '#to-read': true } },
  'C.md': { type: '', links: {} },
  '#DL': { type: 'tag', links: {} }, '#crypto': { type: 'tag', links: {} },
  '#loose': { type: 'tag', links: {} }, '#to-read': { type: 'tag', links: {} },
} });

test('resolves placed dictionary tags case-insensitively and ranges them with their ancestors', () => {
  const r = resolveTags(model, core(), new Set());
  assert.deepEqual([...r.tagOf], [['#DL', 'dl'], ['#crypto', 'crypto']]);
  assert.deepEqual([...r.range].sort(), ['crypto', 'cs', 'dl', 'ml', 'sec']);
  assert.deepEqual([...r.visible].sort(), ['cs', 'sec']);
  assert.equal(r.idOf.get('dl'), '#DL'); assert.equal(r.idOf.get('ml'), '#ml');
});

test('collapsed tags absorb note links into their nearest visible ancestors', () => {
  const out = applyCollapse(core(), resolveTags(model, core(), new Set()), model);
  assert.deepEqual(out.nodes['A.md']!.links, { '#cs': true, 'B.md': true });
  assert.deepEqual(out.nodes['B.md']!.links, { '#cs': true, '#sec': true, '#loose': true, '#to-read': true });
  assert.equal(out.nodes['#DL'], undefined); assert.equal(out.nodes['#crypto'], undefined);
  assert.equal(out.nodes['#cs']!.type, 'tag'); assert.ok(out.nodes['#loose'] && out.nodes['#to-read'] && out.nodes['C.md']);
});

test('expanding moves links one level down and keeps the core casing', () => {
  const once = applyCollapse(core(), resolveTags(model, core(), new Set(['cs'])), model);
  assert.deepEqual(once.nodes['A.md']!.links, { '#ml': true, 'B.md': true });
  assert.ok(once.nodes['B.md']!.links['#crypto']);
  const twice = applyCollapse(core(), resolveTags(model, core(), new Set(['cs', 'ml'])), model);
  assert.ok(twice.nodes['A.md']!.links['#DL']); assert.equal(twice.nodes['#overfitting'], undefined);
});

test('no tag nodes in the input means no dictionary nodes are added', () => {
  const input: NativeData = { numLinks: 0, nodes: { 'A.md': { type: '', links: {} } } };
  const r = resolveTags(model, input, new Set(['cs']));
  assert.equal(r.range.size, 0);
  assert.deepEqual(Object.keys(applyCollapse(input, r, model).nodes), ['A.md']);
});

test('applyCollapse never mutates its input', () => {
  const input = core(); applyCollapse(input, resolveTags(model, input, new Set()), model);
  assert.deepEqual(input, core());
});
