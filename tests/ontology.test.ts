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
  assert.deepEqual([...model.placed].sort(), ['root', ...model.descendants('root')].sort());
  assert.equal(model.placed.has('unplaced'), false);
  assert.deepEqual(model.entries.get('left')?.aliases, []);
});

test('rejects malformed dictionary records with an explanatory error', () => {
  for (const malformed of [
    null, [], 'text', { a: null }, { a: [] }, { a: {} },
    { a: { description: 42 } }, { a: { description: '', aliases: 'alias' } },
    { a: { description: '', aliases: null } },
    { a: { description: '', broader: [42] } },
    { a: { description: '', related: null } }, { a: { description: '', facet: true } },
  ]) assert.throws(() => new Ontology(malformed, []), /dictionary|Tag|string|array/);
});

test('rejects unknown broader and related references', () => {
  for (const field of ['broader', 'related']) {
    assert.throws(() => new Ontology({ a: { description: '', [field]: ['missing'] } }, []), /missing/);
  }
});

test('rejects self references and broader cycles', () => {
  for (const field of ['broader', 'related']) {
    assert.throws(() => new Ontology({ a: { description: '', [field]: ['a'] } }, []), /itself|Cycle/);
  }
  assert.throws(() => new Ontology({
    a: { description: '', broader: ['b'] },
    b: { description: '', broader: ['c'] },
    c: { description: '', broader: ['a'] },
  }, []), /Cycle/);
});

test('note tags match dictionary keys case-insensitively, like the core graph', () => {
  const model = new Ontology({ ml: { description: '', broader: [] } }, [{ path: 'A.md', tags: ['ML'] }]);
  assert.deepEqual(model.counts('ml'), { direct: 1, rollup: 1 });
  assert.equal(model.unregistered.size, 0);
  assert.deepEqual(model.unused, []);
});

test('suggest ranks key matches before alias matches and caps the list', () => {
  const model = new Ontology({
    cnn: { description: '', broader: [], aliases: ['Convolutional Neural Network', '합성곱 신경망'] },
    convolution: { description: '', broader: [], aliases: ['Convolution 연산', '합성곱'] },
    filter: { description: '', broader: [], aliases: ['Convolution Filter'] },
    'conv-net': { description: '', broader: [] },
  }, []);
  assert.deepEqual(model.suggest('conv'), [
    { tag: 'conv-net' }, { tag: 'convolution' },
    { tag: 'cnn', alias: 'Convolutional Neural Network' }, { tag: 'filter', alias: 'Convolution Filter' },
  ]);
  assert.deepEqual(model.suggest('합성곱').map(s => s.tag), ['cnn', 'convolution']);
  assert.deepEqual(model.suggest('  '), []);
  assert.equal(model.suggest('o', 2).length, 2);
});
