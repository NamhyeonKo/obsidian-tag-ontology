// Tags and headings in a note's body, as Obsidian 1.14.5's metadata cache finds them. Obsidian parses the full Markdown;
// this reads it line by line and covers what notes use: fenced code, math, HTML comments, inline code, wikilinks, setext.

export interface Heading { level: number; text: string }

// Obsidian's tag pattern: # and then anything but whitespace, the ASCII punctuation other than - _ /, and the Unicode
// punctuation blocks. In Obsidian a tag starts where an inline piece of text starts: at the start of a line, after
// whitespace, or after other markup. Here that markup is emphasis (* _ ~ =), the > of a quote or an HTML tag, and |.
const TAG = /(?<![^\s*_~=>|])#([^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/gu;

// What holds no tags inside a line; each is replaced by a space, so a # right after one still starts a tag.
// Code spans go first (a run of backticks closed by a run of the same length), then wikilinks and embeds, then math.
const INLINE_CODE = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g;
const WIKILINK = /!?\[\[.*?\]\]/g;
// $…$ opens before a non-space and closes after one, and not before a digit, so "$5 and $10" is no math.
const INLINE_MATH = /\$\$.*?\$\$|(?<!\\)\$(?=[^\s$]).*?(?<=[^\s\\])\$(?!\d)/g;

const FENCE = /^\s*(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^\s*(?:[-+*]|\d+[.)])(?:\s|$)/;
const QUOTE = /^\s*>/;

export function readBody(body: string): { tags: string[]; headings: Heading[] } {
  const tags = new Set<string>(), headings: Heading[] = [];
  let fence: { char: string; length: number } | undefined, inMath = false, inComment = false;
  // The paragraph being read at the top level, which a setext underline turns into a heading.
  // `nested` is a list item or a quote whose lines a paragraph line continues.
  let paragraph: string[] | undefined, nested = false;

  for (const line of body.split('\n')) {
    if (fence) {
      const close = FENCE.exec(line)?.[1];
      if (close?.[0] === fence.char && close.length >= fence.length && line.trim() === close) fence = undefined;
      continue;
    }
    if (inMath) { if (line.includes('$$')) inMath = false; continue; }
    let text = line;
    if (inComment) {
      const end = text.indexOf('-->');
      if (end === -1) continue;
      inComment = false;
      text = ' ' + text.slice(end + 3);
    }
    const open = FENCE.exec(text)?.[1];
    if (open && !(open[0] === '`' && text.slice(text.indexOf(open) + open.length).includes('`'))) {
      fence = { char: open[0] ?? '`', length: open.length };
      paragraph = undefined; nested = false;
      continue;
    }
    if (/^\s*\$\$/.test(text) && !/^\s*\$\$.*\$\$/.test(text)) {
      inMath = true; paragraph = undefined; nested = false;
      continue;
    }
    text = text.replace(INLINE_CODE, ' ').replace(/<!--.*?-->/g, ' ');
    const comment = text.indexOf('<!--');
    if (comment !== -1) { inComment = true; text = text.slice(0, comment); }
    text = text.replace(WIKILINK, ' ').replace(INLINE_MATH, ' ');
    for (const match of text.matchAll(TAG)) if (match[1] && !/^\d+$/.test(match[1])) tags.add(match[1]);

    // Headings, from the line as written: Obsidian keeps a heading's markup in its text.
    const atx = ATX.exec(line), setext = SETEXT.exec(line);
    if (!line.trim()) { paragraph = undefined; nested = false; }
    else if (atx) {
      headings.push({ level: atx[1]?.length ?? 1, text: (atx[2] ?? '').replace(/(?:^|[ \t]+)#+$/, '').trim() });
      paragraph = undefined; nested = false;
    } else if (setext && paragraph) {
      headings.push({ level: setext[1]?.startsWith('=') ? 1 : 2, text: paragraph.join('\n').trim() });
      paragraph = undefined;
    } else if (RULE.test(line)) { paragraph = undefined; nested = false; }
    else if (LIST_ITEM.test(line) || QUOTE.test(line)) { paragraph = undefined; nested = true; }
    else if (paragraph) paragraph.push(line);
    else if (!nested) paragraph = [line];
  }
  return { tags: [...tags], headings };
}
