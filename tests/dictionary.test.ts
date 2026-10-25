import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, draftOf, emptyDraft, serialize, type RawDictionary } from '../src/dictionary.ts';

// The user's dictionary is written one entry per line, keys in code point order, empty aliases left out.
const userStyle = '{\n'
  + '"absinthe": {"description": "Blind SQL Injection 데이터 추출 자동화 도구", "broader": ["vulnerability-scanning"]},\n'
  + '"agile": {"aliases": ["애자일"], "description": "짧은 주기로 개발하는 접근", "broader": ["sdlc"], "related": ["project-management"]},\n'
  + '"ai": {"aliases": ["인공지능", "Artificial Intelligence"], "description": "AI", "broader": [], "facet": "field", "extra": {"a": [1, 2]}}\n'
  + '}\n';

test('serialize reproduces a file written one entry per line byte for byte', () => {
  assert.equal(serialize(JSON.parse(userStyle)), userStyle);
});

test('serialize sorts keys by code point and writes an empty dictionary as two lines', () => {
  assert.equal(serialize({ b: { description: '' }, B: { description: '' }, a: { description: '' } }).split('\n').slice(1, 4).map(l => l.slice(0, 4)).join(), '"B":,"a":,"b":');
  assert.equal(serialize({}), '{\n}\n');
});

const raw: RawDictionary = {
  cs: { description: '', broader: [] }, sec: { description: '', broader: [] },
  ml: { description: '', broader: ['cs'], facet: 'x' }, dl: { description: '', broader: ['ml'] },
  'ai-sec': { description: '', broader: ['sec', 'ml'] }, py: { description: '', broader: ['cs'], related: ['ml'] },
  loose: { description: '' },
};

test('draftOf lists children and related from both sides', () => {
  assert.deepEqual(draftOf(raw, 'ml'), { name: 'ml', description: '', aliases: [], parents: ['cs'], children: ['ai-sec', 'dl'], related: ['py'] });
});

test('rename moves the key and every reference and keeps unknown fields', () => {
  const next = apply(raw, { kind: 'edit', tag: 'ml', draft: { ...draftOf(raw, 'ml'), name: 'machine-learning' } });
  assert.equal(next.ml, undefined); assert.equal(next['machine-learning']!.facet, 'x');
  assert.deepEqual(next['ai-sec']!.broader, ['sec', 'machine-learning']); assert.deepEqual(next.py!.related, ['machine-learning']);
});

test('children are stored as the child\'s broader', () => {
  const next = apply(raw, { kind: 'edit', tag: 'ml', draft: { ...draftOf(raw, 'ml'), children: ['ai-sec', 'loose'] } });
  assert.deepEqual(next.dl!.broader, []); assert.deepEqual(next.loose!.broader, ['ml']);
});

test('related ends two-way, including a relation that was on one side', () => {
  const kept = apply(raw, { kind: 'edit', tag: 'ml', draft: { ...draftOf(raw, 'ml'), related: ['py', 'sec'] } });
  assert.deepEqual(kept.ml!.related, ['py', 'sec']); assert.deepEqual(kept.sec!.related, ['ml']); assert.deepEqual(kept.py!.related, ['ml']);
  const removed = apply(raw, { kind: 'edit', tag: 'ml', draft: { ...draftOf(raw, 'ml'), related: [] } });
  assert.equal('related' in removed.ml!, false); assert.equal('related' in removed.py!, false);
});

test('an unplaced entry stays unplaced unless parents are set', () => {
  assert.equal('broader' in apply(raw, { kind: 'edit', tag: 'loose', draft: { ...draftOf(raw, 'loose'), description: 'd' } }).loose!, false);
});

test('edited fields keep their order, new ones follow and empty aliases are left out', () => {
  const next = apply(raw, { kind: 'edit', tag: 'ml', draft: { ...draftOf(raw, 'ml'), description: 'd', aliases: ['ML'] } });
  assert.deepEqual(Object.keys(next.ml!), ['description', 'broader', 'facet', 'aliases']);
  const cleared = apply({ x: { aliases: ['a'], description: '' } }, { kind: 'edit', tag: 'x', draft: { ...draftOf({ x: { aliases: ['a'], description: '' } }, 'x'), aliases: [] } });
  assert.deepEqual(cleared.x, { description: '' });
});

test('add writes a root when no parent is chosen and leaves empty aliases out', () => {
  assert.deepEqual(apply(raw, { kind: 'add', draft: { ...emptyDraft(), name: 'book' } }).book, { description: '', broader: [] });
  assert.deepEqual(Object.keys(apply(raw, { kind: 'add', draft: { ...emptyDraft(['cs']), name: 'b', aliases: ['B'] } }).b!), ['aliases', 'description', 'broader']);
});

test('delete hands children to the deleted tag\'s parents and cleans related', () => {
  const next = apply(raw, { kind: 'delete', tag: 'ml' });
  assert.deepEqual(next.dl!.broader, ['cs']); assert.deepEqual(next['ai-sec']!.broader, ['sec', 'cs']);
  assert.equal(next.ml, undefined); assert.equal('related' in next.py!, false);
  assert.deepEqual(apply(raw, { kind: 'delete', tag: 'cs' }).py!.broader, []);
});

test('apply never mutates its input', () => {
  const copy = structuredClone(raw);
  apply(raw, { kind: 'delete', tag: 'ml' });
  apply(raw, { kind: 'edit', tag: 'ml', draft: { ...draftOf(raw, 'ml'), name: 'm', related: ['sec'], children: ['loose'] } });
  assert.deepEqual(raw, copy);
});
