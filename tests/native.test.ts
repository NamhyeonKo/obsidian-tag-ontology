import assert from 'node:assert/strict';
import test from 'node:test';
import { Ontology } from '../src/ontology.ts';
import { nativeData, edgeKey } from '../src/native-data.ts';

test('native graph preserves real note paths, virtual tags, directions and related kind', () => {
  const model = new Ontology({
    root: { description: '', broader: [], related: ['other'] },
    child: { description: '', broader: ['root'] },
    other: { description: '', broader: [] },
    constructor: { description: '', broader: [] },
  }, [{ path: '00_Inbox/A.md', tags: ['child'] }]);
  const roots = nativeData(model.visible(new Set()));
  assert.equal(Object.keys(roots.data.nodes).length, 3);
  assert.equal(roots.data.nodes['#constructor']?.type, 'tag');
  const { data, kinds } = nativeData(model.visible(new Set(['root', 'child'])));
  assert.equal(Object.keys(data.nodes).length, 5);
  assert.equal(data.nodes['00_Inbox/A.md']?.type, '');
  assert.equal(data.nodes['#root']?.links['#child'], true);
  assert.equal(data.nodes['#child']?.links['00_Inbox/A.md'], true);
  assert.equal(kinds.get(edgeKey('#other', '#root')), 'related');
  assert.equal(kinds.get(edgeKey('#root', '#child')), 'broader');
  assert.equal(data.numLinks, 3);
  assert.equal(typeof data.nodes.hasOwnProperty, 'function', 'native renderer requires plain objects');
});

test('native graph rejects collisions rather than opening a tag as a file', () => {
  assert.throws(() => nativeData({ nodes: [
    { id: 'tag:a.md', label: 'a.md', kind: 'tag', tag: 'a.md', size: 0 },
    { id: 'note:#a.md', label: 'a', kind: 'note', path: '#a.md', size: 1 },
  ], edges: [] }), /collision/);
});
