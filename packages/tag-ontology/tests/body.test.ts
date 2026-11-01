import assert from 'node:assert/strict';
import test from 'node:test';
import { readBody } from '../src/vault/body.ts';

// The expectations follow Obsidian 1.14.5's metadata cache: its tag pattern, and the headings of the note's top level.
const tags = (body: string) => readBody(body).tags;
const headings = (body: string) => readBody(body).headings;

test('a tag starts with # at the start of a line or after whitespace', () => {
  assert.deepEqual(tags('#a and #b/c, then #d.\n- #e\n> #f'), ['a', 'b/c', 'd', 'e', 'f']);
});

test('# in a word, after punctuation, escaped, or before digits only is not a tag', () => {
  assert.deepEqual(tags('a#b (#c) \\#d #123 # heading ##e'), []);
  assert.deepEqual(tags('#1a #_x #-y'), ['1a', '_x', '-y']);
});

test('a tag runs until whitespace or punctuation, and may hold any letter or emoji', () => {
  assert.deepEqual(tags('#café #日本語 #tag🙂x #a—b #c\'d #e"f'), ['café', '日本語', 'tag🙂x', 'a', 'c', 'e']);
});

test('a # right after inline code, a wikilink, an HTML tag, emphasis or a table bar starts a tag', () => {
  assert.deepEqual(tags('`x`#a **#b** ==#c== [[Note]]#d <b>#e</b>\n|#f|'), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('code, math, HTML comments and the inside of wikilinks hold no tags', () => {
  assert.deepEqual(tags([
    '```js', '#fenced', '```', '~~~~', '#tilde', '~~~', 'still #code', '~~~~',
    '`#inline` ``a #double b``', '$$', '#math', '$$', 'cost $#x$ here',
    '<!-- #comment', '#still -->', '[[Note#heading|#alias]] ![[Image#x]]', '#after',
  ].join('\n')), ['after']);
});

test('tags inside %% comments count, as Obsidian tokenizes the comment', () => {
  assert.deepEqual(tags('%% #inline %%\n%%\n#block\n%%'), ['inline', 'block']);
});

test('each tag is listed once, in the order it first appears; case is kept', () => {
  assert.deepEqual(tags('#a #b #a #A'), ['a', 'b', 'A']);
});

test('ATX headings are #1 to #6 followed by a space, with closing #s dropped', () => {
  assert.deepEqual(headings('# One\n## Two ##\n###NoSpace\n####### Seven\n  ### Indented #tag\n#\n'), [
    { level: 1, text: 'One' }, { level: 2, text: 'Two' }, { level: 3, text: 'Indented #tag' }, { level: 1, text: '' },
  ]);
  assert.deepEqual(readBody('## Heading #tag').tags, ['tag']);
});

test('setext headings underline a paragraph; a lone --- is a rule', () => {
  assert.deepEqual(headings('Title **bold**\n===\n\nSub\nline\n---\n\n---\n'), [
    { level: 1, text: 'Title **bold**' }, { level: 2, text: 'Sub\nline' },
  ]);
});

test('only the note\'s top level has headings: not in code, quotes or lists', () => {
  assert.deepEqual(headings('```\n# code\n```\n> # quoted\n- # listed\n# real'), [{ level: 1, text: 'real' }]);
});
