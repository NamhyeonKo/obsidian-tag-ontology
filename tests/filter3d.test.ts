import assert from 'node:assert/strict';
import test from 'node:test';
import { applySearchFilter, parseFilterQuery, removeOrphans } from '../src/filter3d.ts';
import type { NativeData } from '../src/layer.ts';

test('parses search terms with prefixes, negation, and quoted phrases', () => {
  assert.deepEqual(parseFilterQuery('   '), []);
  assert.deepEqual(parseFilterQuery('path:notes/ml file:"my note" tag:#ai -draft -tag:archive -path:"old work" PATH:Upper'), [
    { negate: false, field: 'path', value: 'notes/ml' },
    { negate: false, field: 'file', value: 'my note' },
    { negate: false, field: 'tag', value: 'ai' },
    { negate: true, field: 'any', value: 'draft' },
    { negate: true, field: 'tag', value: 'archive' },
    { negate: true, field: 'path', value: 'old work' },
    { negate: false, field: 'path', value: 'upper' },
  ]);
  assert.deepEqual(parseFilterQuery('- tag: -tag:# ""'), []);
});

test('filters notes and tags cleanly by path, file, tag, text, and negation', () => {
  const data: NativeData = {
    nodes: {
      'notes/alpha.md': { type: '', links: { '#ml': true, 'notes/beta.md': true } },
      'notes/beta.md': { type: '', links: { '#draft': true } },
      'archive/old.md': { type: '', links: { '#ml': true } },
      'assets/diagram.png': { type: 'attachment', links: {} },
      '#ml': { type: 'tag', links: {} },
      '#ml/dl': { type: 'tag', links: {} },
      '#html': { type: 'tag', links: {} },
      '#draft': { type: 'tag', links: {} },
    },
    numLinks: 0,
  };
  const byPath = applySearchFilter(data, 'path:notes -tag:draft');
  assert.deepEqual(Object.keys(byPath.nodes).sort(), ['#ml', 'notes/alpha.md']);
  assert.deepEqual(byPath.nodes['notes/alpha.md'].links, { '#ml': true });

  const byTag = applySearchFilter(data, 'tag:#ml');
  assert.deepEqual(Object.keys(byTag.nodes).sort(), ['#ml', '#ml/dl', 'archive/old.md', 'notes/alpha.md']);

  const byFile = applySearchFilter(data, 'file:beta');
  assert.deepEqual(Object.keys(byFile.nodes).sort(), ['#draft', 'notes/beta.md']);

  const byAttachmentFile = applySearchFilter(data, 'file:diagram');
  assert.deepEqual(Object.keys(byAttachmentFile.nodes), ['assets/diagram.png']);

  const byPlainTag = applySearchFilter(data, 'html');
  assert.deepEqual(Object.keys(byPlainTag.nodes), ['#html']);

  assert.equal(applySearchFilter(data, ''), data);
});

test('removeOrphans drops degree-0 non-tag nodes while preserving tag nodes', () => {
  const data: NativeData = {
    nodes: {
      'linked.md': { type: '', links: { '#root': true } },
      'orphan.md': { type: '', links: {} },
      'img.png': { type: 'attachment', links: {} },
      'ghost': { type: 'unresolved', links: {} },
      '#root': { type: 'tag', links: {} },
      '#empty-tag': { type: 'tag', links: {} },
    },
    numLinks: 0,
  };
  const filtered = removeOrphans(data);
  assert.deepEqual(Object.keys(filtered.nodes).sort(), ['#empty-tag', '#root', 'linked.md']);
});
