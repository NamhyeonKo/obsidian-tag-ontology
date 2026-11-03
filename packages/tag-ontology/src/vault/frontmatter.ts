// A note's frontmatter and its tags, read as Obsidian 1.14.5's metadata cache reads them.
import { parse } from 'yaml';
import { isRecord } from '../core/guards.ts';

export interface Frontmatter {
  // The YAML mapping, or null when there is none, it is empty, or it can't be used; `error` then says why.
  frontmatter: Record<string, unknown> | null;
  // The rest of the note, with line endings normalized to \n.
  body: string;
  error?: string;
}

export function readFrontmatter(text: string): Frontmatter {
  // Obsidian decodes the file with a TextDecoder, which drops a byte order mark, and its parser turns \r\n and \r into \n.
  const note = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // The block opens with exactly "---\n" at the start, and closes at the next "---" that starts a line, whatever follows it.
  let end = note.startsWith('---\n') ? note.indexOf('---', 3) : -1;
  while (end !== -1 && note[end - 1] !== '\n') end = note.indexOf('---', end + 3);
  if (end === -1) return { frontmatter: null, body: note };
  const rest = note.slice(end + 3), body = rest.startsWith('\n') ? rest.slice(1) : rest;
  let value: unknown;
  try {
    // Obsidian parses it with the same yaml package and its default options: YAML 1.2, so dates stay strings.
    value = parse(note.slice(4, end - 1));
  } catch (error) {
    return { frontmatter: null, body, error: error instanceof Error ? error.message : String(error) };
  }
  if (value === null || value === undefined) return { frontmatter: null, body };
  return isRecord(value) ? { frontmatter: value, body } : { frontmatter: null, body, error: 'The frontmatter is not a YAML mapping.' };
}

// Obsidian's parseFrontMatterTags: the first key named tags in any case; a string is one tag and a list gives its strings.
// Each is trimmed, and empty ones or ones with a space are dropped. Obsidian then adds a # where there is none; this removes one.
export function frontmatterTags(frontmatter: Record<string, unknown> | null): string[] {
  if (!frontmatter) return [];
  const key = Object.keys(frontmatter).find(name => /^tags$/i.test(name));
  const value = key === undefined ? undefined : frontmatter[key];
  const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return items.map(item => item.trim()).filter(item => item !== '' && !item.includes(' ')).map(item => item.replace(/^#/, ''));
}
