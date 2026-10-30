import assert from 'node:assert/strict';
import test from 'node:test';
import { vaultData } from '../src/vault-data.ts';

test('notes link to their tags and to included notes they link to', () => {
  const { nodes } = vaultData([{ path: 'A.md', tags: ['ml'], links: ['B.md', 'Missing.md', 'img.png'] }, { path: 'B.md', tags: [], links: [] }]);
  assert.deepEqual(nodes['A.md'], { type: '', links: { '#ml': true, 'B.md': true } });
  assert.deepEqual(nodes['B.md'], { type: '', links: {} });
  assert.deepEqual(nodes['#ml'], { type: 'tag', links: {} });
  assert.deepEqual(Object.keys(nodes).sort(), ['#ml', 'A.md', 'B.md']);
});

test('tag case variants become one node, named by the first spelling met', () => {
  const { nodes } = vaultData([{ path: 'A.md', tags: ['ML'], links: [] }, { path: 'B.md', tags: ['ml'], links: [] }]);
  assert.deepEqual(Object.keys(nodes).filter(id => nodes[id].type === 'tag'), ['#ML']);
  assert.deepEqual(nodes['A.md'].links, { '#ML': true });
  assert.deepEqual(nodes['B.md'].links, { '#ML': true });
});

test('a note without tags or links is still a node', () => {
  assert.deepEqual(vaultData([{ path: 'Lone.md', tags: [], links: [] }]).nodes['Lone.md'], { type: '', links: {} });
});

test('a note linking to itself has no self link', () => {
  assert.deepEqual(vaultData([{ path: 'A.md', tags: [], links: ['A.md'] }]).nodes['A.md'].links, {});
});
