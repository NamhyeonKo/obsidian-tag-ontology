import assert from 'node:assert/strict';
import test from 'node:test';
import { Ontology } from '../src/ontology.ts';
import { addEdges, applyCollapse, buildLayer, edgeKey, focusIds, hideNotes, resolveTags, type FocusScope, type NativeData } from '../src/layer.ts';

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
  assert.equal(r.tagOf.get('#DL'), 'dl'); assert.equal(r.tagOf.get('#crypto'), 'crypto');
  // Node clicks map ids back to tags, including tags the layer adds without a core node.
  assert.deepEqual([...r.tagOf].sort(), [...r.idOf].map(([tag, id]) => [id, tag]).sort());
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

test('a tag color paints every tag node, dictionary or not, and no note', () => {
  const input = core(), before = structuredClone(input), green = { a: 1, rgb: 0x00ff00 };
  const { data } = buildLayer(input, model, { expanded: new Set(['cs']), showNotes: true, showRelated: true, tagColor: green });
  for (const [id, node] of Object.entries(data.nodes)) assert.equal(node.color, node.type === 'tag' ? green : undefined, id);
  assert.ok(data.nodes['#to-read'] && data.nodes['#ml'], 'covers tags outside the dictionary and tags the layer adds');
  assert.deepEqual(input, before, 'the core data keeps its own colors');
});

test('buildLayer never mutates the core data it layers', () => {
  // Every render layers the same core data again, so adding edges in place must only touch copies.
  const input = withOverfitting(), before = structuredClone(input);
  buildLayer(input, model, { expanded: new Set(['cs', 'ml']), showNotes: true, showRelated: true });
  assert.deepEqual(input, before);
});

test('applyCollapse never mutates its input', () => {
  const input = core(); applyCollapse(input, resolveTags(model, input, new Set()), model);
  assert.deepEqual(input, core());
});

const withOverfitting = (): NativeData => {
  const d = core(); d.nodes['D.md'] = { type: '', links: { '#overfitting': true } }; d.nodes['#overfitting'] = { type: 'tag', links: {} }; return d;
};

test('adds hierarchy edges between visible tags and one related edge per pair', () => {
  const input = withOverfitting(), r = resolveTags(model, input, new Set(['cs', 'ml']));
  const { data, kinds } = addEdges(applyCollapse(input, r, model), r, model, true);
  assert.ok(data.nodes['#cs']!.links['#ml'] && data.nodes['#ml']!.links['#DL'] && data.nodes['#sec']!.links['#crypto']);
  assert.equal(kinds.get(edgeKey('#ml', '#DL')), 'broader');
  assert.equal(kinds.get(edgeKey('#DL', '#overfitting')), 'related');
  assert.equal([...kinds.values()].filter(k => k === 'related').length, 1);
});

test('related edges are skipped when the kind is not requested', () => {
  const input = withOverfitting(), r = resolveTags(model, input, new Set(['cs', 'ml']));
  assert.ok(![...addEdges(applyCollapse(input, r, model), r, model, false).kinds.values()].includes('related'));
});

test('hideNotes keeps only tag nodes and their links among tags', () => {
  const { data } = buildLayer(core(), model, { expanded: new Set(['cs']), showNotes: false, showRelated: true });
  assert.ok(Object.values(data.nodes).every(n => n.type === 'tag'));
  assert.ok(data.nodes['#cs']!.links['#ml']);
});

test('hiding notes gives the layer with notes, less its notes', () => {
  // The core graph never links a tag to anything, but a tag that did must still come out the same.
  const input = withOverfitting(); input.nodes['#loose']!.links = { 'A.md': true, '#DL': true };
  for (const expanded of [[], ['cs'], ['cs', 'ml'], ['cs', 'ml', 'sec']]) {
    const state = { expanded: new Set(expanded), showRelated: true, tagColor: { a: 1, rgb: 0x00ff00 } };
    const hidden = buildLayer(input, model, { ...state, showNotes: false }), shown = buildLayer(input, model, { ...state, showNotes: true });
    assert.deepEqual(hidden.data, hideNotes(shown.data), expanded.join());
    assert.deepEqual(hidden.kinds, shown.kinds); assert.deepEqual(hidden.resolved, shown.resolved);
  }
});

test('buildLayer passes numLinks through and leaves the input untouched', () => {
  const input = core(), out = buildLayer(input, model, { expanded: new Set(), showNotes: true, showRelated: true });
  assert.equal(out.data.numLinks, 5); assert.deepEqual(input, core());
});

test('an unplaced parent of a placed tag stays outside the hierarchy', () => {
  const withHybrid = new Ontology({
    cs: { description: '', broader: [] }, loose: { description: '' },
    hybrid: { description: '', broader: ['cs', 'loose'] },
  }, []);
  const input: NativeData = { numLinks: 0, nodes: {
    'A.md': { type: '', links: { '#hybrid': true, '#loose': true } },
    '#hybrid': { type: 'tag', links: {} }, '#loose': { type: 'tag', links: {} },
  } };
  const r = resolveTags(withHybrid, input, new Set());
  assert.ok(!r.range.has('loose')); assert.ok(!r.idOf.has('loose'));
  assert.deepEqual(applyCollapse(input, r, withHybrid).nodes['A.md']!.links, { '#cs': true, '#loose': true });
});

test('a note on the deepest tag of a 10,000-level chain links to the collapsed root', () => {
  const dict = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`t${i}`, { description: '', broader: i ? [`t${i - 1}`] : [] }]));
  const model = new Ontology(dict, [{ path: 'a.md', tags: ['t9999'] }]);
  const data: NativeData = { numLinks: 1, nodes: { 'a.md': { type: '', links: { '#t9999': true } }, '#t9999': { type: 'tag', links: {} } } };
  const { data: layered } = buildLayer(data, model, { expanded: new Set(), showNotes: true, showRelated: true });
  assert.deepEqual(Object.keys(layered.nodes['a.md'].links), ['#t0']);
});

test('focus keeps the tag, its related tags and the chosen branch', () => {
  const input = (): NativeData => ({ ...core(), nodes: { ...core().nodes, 'D.md': { type: '', links: { '#overfitting': true } }, '#overfitting': { type: 'tag', links: {} } } });
  const scope: FocusScope = { descendants: true, notes: true };
  const focus = (expanded: string[], tag: string, over: Partial<FocusScope> = {}) => {
    const { data, resolved } = buildLayer(input(), model, { expanded: new Set(expanded), showNotes: true, showRelated: true });
    return [...focusIds(data, resolved, model, tag, { ...scope, ...over })].sort();
  };
  // overfitting lists dl as related, so related counts in both directions.
  assert.deepEqual(focus(['cs', 'ml'], 'dl'), ['#DL', '#overfitting', 'A.md', 'D.md']);
  assert.deepEqual(focus(['cs', 'ml'], 'cs'), ['#DL', '#crypto', '#cs', '#ml', '#overfitting', 'A.md', 'B.md', 'D.md']);
  assert.deepEqual(focus(['cs', 'ml'], 'ml', { descendants: false }), ['#ml'], 'the parent never comes along');
  assert.deepEqual(focus(['cs', 'ml'], 'dl', { notes: false }), ['#DL', '#overfitting']);
  // dl and overfitting are hidden: their notes now link to ml itself, and ml never stands in for them.
  assert.deepEqual(focus(['cs'], 'ml'), ['#ml', 'A.md', 'D.md']);
});
