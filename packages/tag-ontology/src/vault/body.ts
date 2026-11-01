// Tags and headings in a note's body, as Obsidian 1.14.5's metadata cache finds them. Obsidian runs a full Markdown parser
// (an old remark); this reads the part of the structure its results depend on, in the same two steps: the blocks first
// (lists, quotes, code, math, HTML, headings, tables), then the inline text of each block.

export interface Heading { level: number; text: string }

// A run of inline text: a paragraph, a heading's text, or a table row, where | separates cells.
interface Inline { text: string; table: boolean }

const FENCE = /^(`{3,}|~{3,})(.*)$/;
const ATX = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^(=+|-+)[ \t]*$/;
const RULE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^([-+*]|\d{1,9}[.)])([ \t]+|$)/;
const TABLE_DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
// An HTML block, whose content Obsidian doesn't parse: a comment runs until -->, a block-level tag until a blank line.
const HTML_BLOCK = /^<\/?(?:address|article|aside|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|script|style)(?=[\s/>]|$)/i;

// Obsidian's tag pattern: # and then anything but whitespace, the ASCII punctuation other than - _ /, and the Unicode
// punctuation blocks.
const TAG = /#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+)/gu;

// The width of a line's indentation, with tabs to the next multiple of 4.
function columns(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - width % 4;
    else break;
  }
  return width;
}

// A %% comment that runs over lines: %% and no other % on the line. Obsidian tokenizes its text as inline text,
// so its tags count, but nothing in it is a block: no heading, no code.
const COMMENT_BLOCK = /^%%[^%]*$/;

// What a line can start that ends a list item or a quote even without a blank line before it, even inside its code.
const interrupts = (text: string) => ATX.test(text) || FENCE.test(text) || LIST_ITEM.test(text) || text.startsWith('>')
  || RULE.test(text) || COMMENT_BLOCK.test(text);

function readBlocks(lines: string[]): { headings: Heading[]; inline: Inline[] } {
  const headings: Heading[] = [], inline: Inline[] = [];
  // The content column of each open list item, outermost first; a quote is one container whose lines start with >.
  const items: number[] = [];
  let quote = false;
  // Code and math belong to the container they opened in, and end with it.
  let fence: { char: string; length: number; depth: number; quote: boolean } | undefined;
  let math: { depth: number; quote: boolean } | undefined;
  let html: 'comment' | 'tag' | undefined;
  let comment: Inline | undefined;
  let paragraph: Inline | undefined, paragraphLines = 0, paragraphRoot = false, table = false, wasBlank = true;
  const endParagraph = () => { paragraph = undefined; paragraphLines = 0; };

  for (const [index, raw] of lines.entries()) {
    if (comment) {
      // The comment ends at the next %%, anywhere; the text after it is read as inline text again.
      const end = raw.indexOf('%%');
      comment.text += '\n' + (end === -1 ? raw : raw.slice(0, end));
      if (end !== -1) { comment = undefined; inline.push({ text: raw.slice(end + 2), table: false }); }
      continue;
    }
    const quoted = /^ {0,3}>/.test(raw);
    const line = quoted ? raw.replace(/^(?: {0,3}> ?)+/, '') : raw;
    const blank = !line.trim(), afterBlank = wasBlank;
    wasBlank = blank;

    // Obsidian ends a list item or a quote at a line outside it that follows a blank line or starts another block,
    // and the code inside the container ends with it. Any other line continues the container, even inside its code.
    if (!blank && (afterBlank || interrupts(line.trimStart()))) {
      const outer = columns(raw);
      if (quote && !quoted) quote = false;
      while (items.length && outer < (items.at(-1) ?? 0)) items.pop();
      if (fence && (fence.depth > items.length || (fence.quote && !quote))) fence = undefined;
      if (math && (math.depth > items.length || (math.quote && !quote))) math = undefined;
      if (paragraph && !paragraphRoot) endParagraph();
    }
    quote ||= quoted;

    const content = line.trimStart();
    if (fence) {
      const close = FENCE.exec(content);
      if (close?.[1]?.[0] === fence.char && close[1].length >= fence.length && !close[2]?.trim()) fence = undefined;
      continue;
    }
    if (math) { if (content.includes('$$')) math = undefined; continue; }
    if (html) { if (html === 'comment' ? line.includes('-->') : !raw.trim()) html = undefined; continue; }
    if (blank) { endParagraph(); table = false; continue; }

    let text = content, relative = columns(line) - (quoted ? 0 : items.at(-1) ?? 0);
    const marker = quoted || relative > 3 || RULE.test(text) ? null : LIST_ITEM.exec(text);
    if (marker) {
      // The item's content, and the lines that continue it, start after the marker and up to four spaces.
      const spaces = marker[2]?.length ?? 0;
      items.push(columns(line) + (marker[1]?.length ?? 1) + (spaces >= 1 && spaces <= 4 ? spaces : 1));
      endParagraph();
      text = text.slice(marker[0].length);
      relative = 0;
      if (!text.trim()) continue;
    }
    const root = !quote && items.length === 0;

    if (relative > 3) {
      // An indented code block, unless the line continues a paragraph.
      if (!paragraph) continue;
    } else {
      if (COMMENT_BLOCK.test(text)) {
        comment = { text: text.slice(2), table: false };
        inline.push(comment);
        endParagraph();
        continue;
      }
      const open = FENCE.exec(text);
      if (open?.[1] && !(open[1].startsWith('`') && open[2]?.includes('`'))) {
        fence = { char: open[1][0] ?? '`', length: open[1].length, depth: items.length, quote };
        endParagraph();
        continue;
      }
      if (text.startsWith('$$') && !/^\$\$.*\$\$/.test(text)) { math = { depth: items.length, quote }; endParagraph(); continue; }
      // Obsidian's parser tries a setext heading before an HTML block, so a line underlined next is a heading.
      const underlined = SETEXT.test(lines[index + 1]?.trimStart() ?? '') && !paragraph && root;
      if (text.startsWith('<!--') && !underlined) { if (!text.includes('-->', 4)) html = 'comment'; endParagraph(); continue; }
      if (HTML_BLOCK.test(text) && !underlined) { html = 'tag'; endParagraph(); continue; }
      const atx = ATX.exec(text);
      if (atx) {
        const heading = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+$/, '').trim();
        if (root) headings.push({ level: atx[1]?.length ?? 1, text: heading });
        inline.push({ text: heading, table: false });
        endParagraph();
        continue;
      }
      const underline = SETEXT.exec(text);
      // Obsidian's parser makes a setext heading of a one-line paragraph only.
      if (underline && paragraph && paragraphLines === 1 && paragraphRoot) {
        headings.push({ level: underline[1]?.startsWith('=') ? 1 : 2, text: paragraph.text.trim() });
        endParagraph();
        continue;
      }
      if (RULE.test(text)) { endParagraph(); continue; }
      if (TABLE_DELIMITER.test(text) && paragraph && paragraphLines === 1 && paragraph.text.includes('|')) {
        paragraph.table = true; table = true;
        endParagraph();
        continue;
      }
    }
    if (table && text.includes('|')) { inline.push({ text, table: true }); continue; }
    table = false;
    if (paragraph) { paragraph.text += '\n' + text; paragraphLines++; }
    else { paragraph = { text, table: false }; inline.push(paragraph); paragraphLines = 1; paragraphRoot = root; }
  }
  return { headings, inline };
}

// What holds no tags inside a run of text, in the order it is masked; each becomes a space, so a # right after one
// still starts a tag. A link keeps its text, which can hold tags.
const MASKS: [RegExp, string][] = [
  [/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, ' '],
  [/<!--[\s\S]*?-->/g, ' '],
  // $…$ opens before a non-space and closes after one, and not before a digit, so "$5 and $10" is no math.
  [/\$\$[\s\S]*?\$\$|(?<!\\)\$(?=[^\s$])[\s\S]*?(?<=[^\s\\])\$(?!\d)/g, ' '],
  [/!?\[\[[\s\S]*?\]\]|!\[[^\]]*\]\([^)]*\)/g, ' '],
  [/\[([^\]]*)\]\([^)]*\)/g, ' $1 '],
  [/<\/?[A-Za-z][^<>]*>/g, ' '],
];

function addTags({ text, table }: Inline, tags: Set<string>) {
  const visible = MASKS.reduce((rest, [pattern, by]) => rest.replace(pattern, by), text);
  for (const match of visible.matchAll(TAG)) {
    const at = match.index, before = visible[at - 1];
    let name = match[1] ?? '';
    // A tag starts a piece of inline text: after whitespace, a table cell's |, or the opening marker of emphasis,
    // a strikethrough or a highlight that the same run of markers closes.
    if (before !== undefined && !/\s/.test(before)) {
      if (before === '|') { if (!table) continue; }
      else if ('*_~='.includes(before)) {
        let start = at;
        while (visible[start - 1] === before) start--;
        const run = visible.slice(start, at);
        // _ can be part of a tag, so a closing _ run is the end of the name.
        const trailing = before === '_' ? (/_*$/.exec(name)?.[0].length ?? 0) : 0;
        if (trailing) name = name.slice(0, name.length - Math.min(trailing, run.length));
        else if (!visible.includes(run, at + 1 + name.length)) continue;
      } else continue;
    }
    if (name && !/^\d+$/.test(name)) tags.add(name);
  }
}

export function readBody(body: string): { tags: string[]; headings: Heading[] } {
  const { headings, inline } = readBlocks(body.split('\n'));
  const tags = new Set<string>();
  for (const run of inline) addTags(run, tags);
  return { tags: [...tags], headings };
}
