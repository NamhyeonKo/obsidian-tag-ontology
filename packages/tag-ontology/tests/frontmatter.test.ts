import assert from 'node:assert/strict';
import test from 'node:test';
import { frontmatterTags, readFrontmatter } from '../src/vault/frontmatter.ts';

// The expectations follow Obsidian 1.14.5's metadata cache: its frontmatter tokenizer and parseFrontMatterTags.

test('frontmatter opens with --- on the first line and closes at the next line that starts with ---', () => {
  assert.deepEqual(readFrontmatter('---\ntags: [a]\n---\n# Body\n'), { frontmatter: { tags: ['a'] }, body: '# Body\n' });
  // Line endings are normalized first, as Obsidian's parser does.
  assert.deepEqual(readFrontmatter('---\r\ntags:\r\n  - a\r\n---\r\nBody\r\n'), { frontmatter: { tags: ['a'] }, body: 'Body\n' });
  // The closing line only has to start with ---, so ---- closes it and leaves a dash behind.
  assert.deepEqual(readFrontmatter('---\na: 1\n----\nrest'), { frontmatter: { a: 1 }, body: '-\nrest' });
});

test('without that opening or a closing line, the whole note is body', () => {
  for (const text of ['\n---\na: 1\n---\n', '--- \na: 1\n---\n', '---\na: 1\n', 'Text\n---\na: 1\n---\n']) {
    assert.deepEqual(readFrontmatter(text), { frontmatter: null, body: text });
  }
});

test('frontmatter that is not a YAML mapping is null, with the reason', () => {
  for (const yaml of ['tags: [a, b', 'a: 1\na: 2', '- a\n- b', 'just text']) {
    const { frontmatter, error } = readFrontmatter(`---\n${yaml}\n---\nBody`);
    assert.equal(frontmatter, null);
    assert.ok(error && error.length > 0, yaml);
  }
  // An empty block is no properties, not an error.
  assert.deepEqual(readFrontmatter('---\n---\nBody'), { frontmatter: null, body: 'Body' });
});

test('YAML 1.2 keeps dates and yes/no as strings', () => {
  assert.deepEqual(readFrontmatter('---\ncreated: 2026-11-01\nok: no\n---\n').frontmatter, { created: '2026-11-01', ok: 'no' });
});

test('tags come from the first key named tags in any case, never from tag', () => {
  assert.deepEqual(frontmatterTags({ Tags: ['first'], tags: ['second'] }), ['first']);
  assert.deepEqual(frontmatterTags({ tag: 'single' }), []);
  assert.deepEqual(frontmatterTags(null), []);
});

test('a string is one tag and a list gives its strings; each is trimmed and loses one leading #', () => {
  assert.deepEqual(frontmatterTags({ tags: ' solo ' }), ['solo']);
  // Obsidian doesn't split strings, so a comma list with spaces is dropped and one without is a single tag.
  assert.deepEqual(frontmatterTags({ tags: 'a, b' }), []);
  assert.deepEqual(frontmatterTags({ tags: 'a,b' }), ['a,b']);
  assert.deepEqual(frontmatterTags({ tags: ['#a', ' b ', 1984, null, 'two words', '', '##c', 'a'] }), ['a', 'b', '#c', 'a']);
  assert.deepEqual(frontmatterTags({ tags: 42 }), []);
});
