import assert from 'node:assert/strict';
import test from 'node:test';
import { readBody } from '../src/vault/body.ts';

// The expectations are what Obsidian 1.14.5's metadata-cache worker returns for the same text.
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

test('a # right after inline code, a wikilink, an HTML tag or a link\'s [ starts a tag', () => {
  assert.deepEqual(tags('`x`#a [[Note]]#b <b>#c</b> #d<br>#e [#f](https://example.com) ![#alt](image.png)'), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('after an emphasis marker, # starts a tag only when the emphasis is closed', () => {
  assert.deepEqual(tags('*#a* **#b** ~~#c~~ ==#d== _#e_ __#f__ x_#g_ _#h i_'), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(tags('x*#a snake_#b 2~#c a>#d'), []);
});

test('a table bar starts a tag in a table only', () => {
  assert.deepEqual(tags('| a | b |\n| - | - |\n|#cell| x |'), ['cell']);
  assert.deepEqual(tags('|#not-a-table|'), []);
});

test('code, math, HTML comments and the inside of wikilinks hold no tags', () => {
  assert.deepEqual(tags([
    '```js', '#fenced', '```', '~~~~', '#tilde', '~~~', 'still #code', '~~~~',
    '`#inline` ``a #double b``', '$$', '#math', '$$', 'cost $#x$ here',
    '<!-- #comment', '#still -->', '[[Note#heading|#alias]] ![[Image#x]]', '<span title="a #title">text</span> #after',
    '<div>', '#in-html-block', '</div>', '', '    #indented-code',
  ].join('\n')), ['after']);
  // Inline code and math may run over several lines of a paragraph.
  assert.deepEqual(tags('`code\n#hidden\ncode` $a\n#math\nb$\n#visible'), ['visible']);
});

test('code inside a list item or a quote ends with it', () => {
  assert.deepEqual(tags('- ```\n  #hidden\n  ```\n\n#visible'), ['visible']);
  // Without a blank line first, a line continues the item even inside its code, as in Obsidian.
  assert.deepEqual(tags('1. ```\n   #hidden\n#lazy\n\n#after-item'), ['after-item']);
  assert.deepEqual(tags('> ```\n> #hidden\n> ```\n#out\n- item\n\n      #indented-in-item'), ['out']);
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

test('setext headings underline a one-line paragraph; a lone --- is a rule', () => {
  assert.deepEqual(headings('Title **bold**\n===\n\nSub\n---\n\nTwo\nlines\n---\n\n---\n'), [
    { level: 1, text: 'Title **bold**' }, { level: 2, text: 'Sub' },
  ]);
});

test('only the note\'s top level has headings: not in code, quotes, lists or HTML comments', () => {
  assert.deepEqual(headings('```\n# code\n```\n> # quoted\n- # listed\n# real'), [{ level: 1, text: 'real' }]);
  assert.deepEqual(headings('- Item\n  ## Nested\n\n## Visible\n<!--\n# Hidden -->\n    # indented code'), [{ level: 2, text: 'Visible' }]);
  // A fence inside a numbered item ends with the item, so the heading after it is the note's.
  assert.deepEqual(headings('1. Step\n   ```markdown\n   ## Inside\n\n## After'), [{ level: 2, text: 'After' }]);
});

test('a %% comment over several lines keeps its tags but has no blocks, until the next %% or the end', () => {
  assert.deepEqual(readBody('%%\n# Commented out\n#kept\n```\n%%\n# After'), { tags: ['kept'], headings: [{ level: 1, text: 'After' }] });
  assert.deepEqual(readBody('%%\nopen to the end #end\n# no heading'), { tags: ['end'], headings: [] });
});

test('a heading, a fence or a list item ends a list item or a quote even inside its code', () => {
  assert.deepEqual(readBody('- ```\n## Heading #c\n- ```\n```\n## In code #d'), { tags: ['c'], headings: [{ level: 2, text: 'Heading #c' }] });
  assert.deepEqual(tags('> ```\n> #q\n- item #e'), ['e']);
});

test('a line underlined next is a setext heading even when it looks like HTML', () => {
  assert.deepEqual(headings('<!--\n===\n<div>\n---'), [{ level: 1, text: '<!--' }, { level: 2, text: '<div>' }]);
});

test('an HTML block ends at an empty line only, not at a bare >', () => {
  assert.deepEqual(tags('<div>\n>\n#in-html\n\n#out'), ['out']);
});
