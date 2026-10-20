import assert from 'node:assert/strict';
import test from 'node:test';
import { Ontology, isIncludedNote } from '../src/ontology.ts';

const raw = {
  root: { description: '최상위', aliases: ['루트'], broader: [] },
  left: { description: '왼쪽', broader: ['root'], related: ['right'] },
  right: { description: '오른쪽', broader: ['root'] },
  leaf: { description: '공유 자식', broader: ['left', 'right'] },
  tip: { description: '말단', broader: ['leaf'] },
  unplaced: { description: '미배치' },
};
const notes = [
  { path: '01_Projects/Root.md', tags: ['root'] },
  { path: '02_Areas/Right.md', tags: ['right'] },
  { path: '03_Resources/Shared.md', tags: ['left', 'leaf', 'leaf'] },
  { path: '03_Resources/Shared.md', tags: ['leaf'] },
  { path: '03_Resources/Leaf.md', tags: ['leaf'] },
  { path: '04_Archives/Tip.md', tags: ['tip'] },
  { path: '00_Inbox/Hidden.md', tags: ['leaf'] },
  { path: '01_Projects/p/archive/Old.md', tags: ['leaf'] },
  { path: '99_Etc/Other.md', tags: ['leaf'] },
  { path: '03_Resources/Alias.md', tags: ['루트', 'missing', '#root'] },
];
const make = () => new Ontology(raw, notes);
const nodeIds = (model: Ontology, expanded: string[]) =>
  model.visible(new Set(expanded)).nodes.map((node) => node.id).sort();

test('counts unique note paths through a multi-parent hierarchy', () => {
  const model = make();
  assert.deepEqual(model.counts('root'), { direct: 1, rollup: 8 });
  assert.deepEqual(model.counts('left'), { direct: 1, rollup: 6 });
  assert.deepEqual(model.counts('right'), { direct: 1, rollup: 7 });
  assert.deepEqual(model.counts('leaf'), { direct: 5, rollup: 6 });
  assert.deepEqual(model.notesFor('leaf', false), [
    '00_Inbox/Hidden.md', '01_Projects/p/archive/Old.md',
    '03_Resources/Leaf.md', '03_Resources/Shared.md', '99_Etc/Other.md',
  ]);
  assert.deepEqual(model.notesFor('leaf', true), [
    '00_Inbox/Hidden.md', '01_Projects/p/archive/Old.md',
    '03_Resources/Leaf.md', '03_Resources/Shared.md', '04_Archives/Tip.md', '99_Etc/Other.md',
  ]);
  assert.deepEqual([...model.descendants('root')].sort(), ['leaf', 'left', 'right', 'tip']);
  assert.deepEqual(model.counts('missing'), { direct: 0, rollup: 0 });
});

test('includes markdown paths throughout the vault, including Inbox and archives', () => {
  for (const path of [
    '01_Projects/A.md', '02_Areas/A.md', '03_Resources/A.md', '04_Archives/A.md',
    '00_Inbox/A.md', '99_Etc/A.md', 'Tag-Dictionary.md',
    '01_Projects/x/archive/A.md', '03_Resources/archive/A.md',
  ]) {
    assert.equal(isIncludedNote(path), true, path);
  }
  for (const path of [
    '03_Resources/A.txt', '', '.md', '.obsidian/A.md', '.git/A.md',
    '03_Resources/.private/A.md', '03_Resources/.hidden.md',
    '/03_Resources/A.md', '03_Resources/../../00_Inbox/A.md',
    '03_Resources/./A.md', '03_Resources//A.md', '03_Resources/A.md/',
  ]) assert.equal(isIncludedNote(path), false, path);
});

test('reports unregistered tags exactly as used without resolving aliases or adding graph tags', () => {
  const model = new Ontology(raw, [
    { path: '99_Etc/Z.md', tags: ['missing', 'missing', '루트', '#root'] },
    { path: '00_Inbox/A.md', tags: ['missing'] },
    { path: '99_Etc/Z.md', tags: ['missing'] },
    { path: '.obsidian/Hidden.md', tags: ['hidden'] },
  ]);
  assert.deepEqual(model.unregistered, new Map([
    ['#root', ['99_Etc/Z.md']],
    ['missing', ['00_Inbox/A.md', '99_Etc/Z.md']],
    ['루트', ['99_Etc/Z.md']],
  ]));
  assert.deepEqual([...model.direct.keys()], ['leaf', 'left', 'right', 'root', 'tip', 'unplaced']);
  assert.deepEqual(model.notesFor('root', true), []);
  assert.deepEqual(nodeIds(model, ['root', 'left', 'right', 'leaf', 'tip']), [
    'tag:leaf', 'tag:left', 'tag:right', 'tag:root', 'tag:tip',
  ]);
});

test('reports tags without direct notes as unused, including roots with rollup usage', () => {
  const model = new Ontology({
    root: { description: '', broader: [] },
    used: { description: '', broader: ['root'] },
    idle: { description: '' },
  }, [{ path: 'Note.md', tags: ['used'] }]);
  assert.deepEqual(model.unused, ['idle', 'root']);
  assert.deepEqual(model.counts('root'), { direct: 0, rollup: 1 });
  assert.deepEqual(model.roots, ['root']);
});

test('shows explicit roots and keeps unplaced entries separate', () => {
  const model = make();
  assert.deepEqual(model.roots, ['root']);
  assert.equal(model.entries.has('unplaced'), true);
  assert.deepEqual(model.entries.get('left')?.aliases, []);
  assert.deepEqual(nodeIds(model, []), ['tag:root']);
  assert.deepEqual(nodeIds(model, ['root']), [
    'note:01_Projects/Root.md', 'tag:left', 'tag:right', 'tag:root',
  ]);
});

test('expanding a leaf adds its directly tagged notes', () => {
  const graph = new Ontology({ leaf: { description: '', broader: [] } }, [
    { path: '03_Resources/Leaf.md', tags: ['leaf'] },
  ]).visible(new Set(['leaf']));
  assert.deepEqual(graph.nodes.map((node) => node.id), ['tag:leaf', 'note:03_Resources/Leaf.md']);
  assert.equal(graph.nodes[1]?.label, 'Leaf');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.kind, 'note');
});

test('expansion reveals one level and preserves children reachable from another parent', () => {
  const model = make();
  assert.deepEqual(nodeIds(model, ['root', 'left']), [
    'note:01_Projects/Root.md', 'note:03_Resources/Shared.md',
    'tag:leaf', 'tag:left', 'tag:right', 'tag:root',
  ]);
  const collapsedLeft = nodeIds(model, ['root', 'right']);
  assert.ok(collapsedLeft.includes('tag:leaf'));
  assert.ok(!collapsedLeft.includes('tag:tip'));
  assert.ok(!collapsedLeft.includes('note:03_Resources/Shared.md'));
  assert.deepEqual(nodeIds(model, ['left', 'leaf']), ['tag:root']);
});

test('includes all broader edges among visible tags and deduplicates note nodes', () => {
  const graph = make().visible(new Set(['root', 'left', 'right', 'leaf']));
  const broader = graph.edges.filter((edge) => edge.kind === 'broader')
    .map((edge) => [edge.source, edge.target]).sort();
  assert.deepEqual(broader, [
    ['tag:leaf', 'tag:tip'], ['tag:left', 'tag:leaf'], ['tag:right', 'tag:leaf'],
    ['tag:root', 'tag:left'], ['tag:root', 'tag:right'],
  ]);
  assert.equal(graph.nodes.filter((node) => node.id === 'note:03_Resources/Shared.md').length, 1);
  assert.equal(graph.nodes.find((node) => node.id === 'tag:root')?.size, 8);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length);
});

test('one-sided and symmetric related declarations produce one optional edge', () => {
  const model = make();
  assert.equal(model.visible(new Set()).edges.length, 0);
  const expanded = new Set(['root']);
  assert.equal(model.visible(expanded).edges.filter((edge) => edge.kind === 'related').length, 1);
  assert.equal(model.visible(expanded, false).edges.filter((edge) => edge.kind === 'related').length, 0);
  const symmetric = new Ontology({
    a: { description: '', broader: [], related: ['b'] },
    b: { description: '', broader: [], related: ['a'] },
  }, []);
  assert.equal(symmetric.visible(new Set()).edges.filter((edge) => edge.kind === 'related').length, 1);
});

test('edge IDs do not collide for tags or note paths containing separators', () => {
  const model = new Ontology({
    a: { description: '', broader: [], related: ['b:c'] },
    'a:b': { description: '', broader: [], related: ['c'] },
    'b:c': { description: '', broader: [] },
    c: { description: '', broader: [] },
  }, []);
  const edges = model.visible(new Set()).edges;
  assert.equal(edges.length, 2);
  assert.equal(new Set(edges.map((edge) => edge.id)).size, 2);
});

test('rejects malformed dictionary records with an explanatory error', () => {
  for (const malformed of [
    null, [], 'text', { a: null }, { a: [] }, { a: {} },
    { a: { description: 42 } }, { a: { description: '', aliases: 'alias' } },
    { a: { description: '', aliases: null } },
    { a: { description: '', broader: [42] } },
    { a: { description: '', related: null } }, { a: { description: '', facet: true } },
  ]) assert.throws(() => new Ontology(malformed, []), /사전|태그|문자열|배열/);
});

test('rejects unknown broader and related references', () => {
  for (const field of ['broader', 'related']) {
    assert.throws(() => new Ontology({ a: { description: '', [field]: ['missing'] } }, []), /missing/);
  }
});

test('rejects self references and broader cycles', () => {
  for (const field of ['broader', 'related']) {
    assert.throws(() => new Ontology({ a: { description: '', [field]: ['a'] } }, []), /자기|순환/);
  }
  assert.throws(() => new Ontology({
    a: { description: '', broader: ['b'] },
    b: { description: '', broader: ['c'] },
    c: { description: '', broader: ['a'] },
  }, []), /순환/);
});
