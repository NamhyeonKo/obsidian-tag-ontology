import assert from 'node:assert/strict';
import test from 'node:test';
import { usage } from '../src/core/usage.ts';

const dict = {
  ai: { description: 'AI', broader: [] },
  'machine-learning': { description: 'ML', aliases: ['ML'], broader: ['ai'] },
  'deep-learning': { description: 'DL', broader: ['machine-learning'] },
  cnn: { description: 'CNN', aliases: ['Convolutional Neural Network'], broader: ['deep-learning'] },
  python: { description: 'Python', broader: [], facet: 'language' },
  pandas: { description: 'pandas', broader: ['python'] },
  'llm-agents': { description: 'Agents', broader: ['ai'] },
};

test('tags that match no dictionary tag or alias are unregistered, with the notes using them', () => {
  const result = usage(dict, [
    { path: 'b.md', tags: ['quantum', 'cnn'] },
    { path: 'a.md', tags: ['quantum', 'quantum', 'ML', 'Python'] },
  ]);
  assert.deepEqual(result.unregistered.map(({ tag, notes }) => ({ tag, notes })), [{ tag: 'quantum', notes: ['a.md', 'b.md'] }]);
});

test('an alias or a tag in different case is non-canonical, once per note and spelling', () => {
  assert.deepEqual(usage(dict, [
    { path: 'b.md', tags: ['Python', 'ml'] },
    { path: 'a.md', tags: ['ML', 'ML', 'convolutional neural network', 'cnn'] },
  ]).nonCanonical, [
    { path: 'a.md', tag: 'ML', canonical: 'machine-learning' },
    { path: 'a.md', tag: 'convolutional neural network', canonical: 'cnn' },
    { path: 'b.md', tag: 'Python', canonical: 'python' },
    { path: 'b.md', tag: 'ml', canonical: 'machine-learning' },
  ]);
});

test('unused tags have no matching note and no narrower tags', () => {
  // ai, machine-learning, deep-learning and python group narrower tags; cnn is used through a case variant; llm-agents only through a typo.
  assert.deepEqual(usage(dict, [{ path: 'a.md', tags: ['CNN', 'llm-agent', 'pandas'] }]).unused, ['llm-agents']);
  // An alias doesn't count: Obsidian doesn't know it, so the note isn't found under the tag.
  assert.deepEqual(usage({ x: { description: 'X', aliases: ['ex'], broader: [] } }, [{ path: 'a.md', tags: ['ex'] }]).unused, ['x']);
});

test('the scope narrows the findings and the count, but unused is judged over every note', () => {
  const notes = [
    { path: 'in/a.md', tags: ['quantum', 'ML'] },
    { path: 'out/b.md', tags: ['other', 'Python', 'llm-agents', 'cnn', 'pandas'] },
    { path: 'in/.hidden/c.md', tags: ['hidden'] },
  ];
  const result = usage(dict, notes, path => path.startsWith('in/'));
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.unregistered.map(item => item.tag), ['quantum']);
  assert.deepEqual(result.nonCanonical.map(item => item.path), ['in/a.md']);
  assert.deepEqual(result.unused, []);
});

test('a note with a tag and its descendant is redundant, except for facets and the note\'s own concept', () => {
  assert.deepEqual(usage(dict, [
    { path: 'notes/Training.md', tags: ['ai', 'machine-learning', 'cnn'] },
    { path: 'notes/Pandas.md', tags: ['python', 'pandas'] },
    { path: 'notes/Deep Learning (intro).md', tags: ['deep-learning', 'cnn'] },
    { path: 'notes/ML - Overview.md', tags: ['ML', 'machine-learning', 'deep-learning'] },
    { path: 'notes/Mixed case.md', tags: ['Deep-Learning', 'CNN'] },
  ]).redundant, [
    { path: 'notes/Mixed case.md', tag: 'deep-learning', narrower: ['cnn'] },
    { path: 'notes/Training.md', tag: 'ai', narrower: ['cnn', 'machine-learning'] },
    { path: 'notes/Training.md', tag: 'machine-learning', narrower: ['cnn'] },
  ]);
});

test('similar tags look like a typo: equal without hyphens, or close by the share of characters in common', () => {
  const similar = (tags: string[]) => Object.fromEntries(usage(dict, [{ path: 'a.md', tags }]).unregistered.map(item => [item.tag, item.similar]));
  assert.deepEqual(similar(['llm-agent', 'llmagents', 'cnns', 'transformer', 'transformers', 'rag']), {
    'llm-agent': ['llm-agents', 'llmagents'],
    llmagents: ['llm-agent', 'llm-agents'],
    cnns: ['cnn'],
    transformer: ['transformers'],
    transformers: ['transformer'],
    rag: [],
  });
});

test('a dictionary with errors is refused, as by the model', () => {
  assert.throws(() => usage({ a: { description: 'A', broader: ['gone'] } }, []), /unknown tag gone/);
});
