// What the CLI prints without --json. It is for people, not a contract (docs/cli.md), so it may change in any release.
import type { EntryDiff } from '../core/plan.ts';
import type { Usage } from '../core/usage.ts';
import type { Issue } from '../core/validate.ts';
import type { ScannedNote } from '../vault/scan.ts';
import type { Suggestion } from '../core/ontology.ts';
import type { Shown } from './show.ts';

// Note content reaches the terminal here, and a control character there would act instead of show: an escape sequence can
// set the clipboard or rewrite what is on screen. All of them but tab are written as \u escapes, as JSON does.
export const visible = (line: string) => Array.from(line, char => {
  const code = char.charCodeAt(0);
  return (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f) ? `\\u${code.toString(16).padStart(4, '0')}` : char;
}).join('');

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const list = (items: readonly string[]) => items.length ? items.join(', ') : '-';
// A long list of notes is cut so one tag doesn't fill the screen; --json has them all.
const some = (items: readonly string[], shown = 3) => items.length > shown ? `${items.slice(0, shown).join(', ')} and ${items.length - shown} more` : items.join(', ');

// One line per issue (a YAML error's caret drawing is left out), then how many of each.
export function issueLines(issues: readonly Issue[]): string[] {
  if (!issues.length) return [];
  const errors = issues.filter(item => item.severity === 'error').length;
  return [...issues.map(item => `${item.severity}: ${item.message.split('\n')[0] ?? ''}`), `${count(errors, 'error')}, ${count(issues.length - errors, 'warning')}`];
}

export const checkText = (issues: readonly Issue[]) => issues.length ? issueLines(issues) : ['No problems found.'];

export function scanText(notes: readonly ScannedNote[], issues: readonly Issue[]): string[] {
  const lines = notes.flatMap(note => {
    const description = typeof note.frontmatter?.description === 'string' ? note.frontmatter.description.trim() : '';
    const aliases = Array.isArray(note.frontmatter?.aliases)
      ? note.frontmatter.aliases.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    return [
      note.path,
      ...description ? [`  description: ${description}`] : [],
      ...aliases.length ? [`  aliases: ${aliases.join(', ')}`] : [],
      ...note.tags.length ? [`  tags: ${note.tags.join(', ')}`] : [],
      ...note.bodyTags.length ? [`  body tags: ${note.bodyTags.join(', ')}`] : [],
      ...note.headings.length ? [`  headings: ${note.headings.map(heading => `${'#'.repeat(heading.level)} ${heading.text}`).join(', ')}`] : [],
    ];
  });
  return [...lines, ...issueLines(issues), count(notes.length, 'note')];
}

export function usageText(found: Usage, issues: readonly Issue[]): string[] {
  const { unregistered, nonCanonical, unused, redundant } = found;
  const lines = [`${count(found.scanned, 'note')} scanned.`];
  if (unregistered.length) {
    lines.push(`Unregistered (${unregistered.length}):`, ...unregistered.map(item =>
      `  ${item.tag}  ${some(item.notes)}${item.similar.length ? `  (similar: ${item.similar.join(', ')})` : ''}`));
  }
  if (nonCanonical.length) {
    lines.push(`Written differently from the dictionary (${nonCanonical.length}):`, ...nonCanonical.map(item => `  ${item.path}: ${item.tag} -> ${item.canonical}`));
  }
  if (redundant.length) {
    const byNote = new Map<string, string[]>();
    for (const item of redundant) {
      byNote.set(item.path, [...byNote.get(item.path) ?? [], `${item.tag} (narrower: ${item.narrower.join(', ')})`]);
    }
    lines.push(`Redundant (${redundant.length}):`, ...[...byNote].map(([path, tags]) => `  ${path}: ${tags.join('; ')}`));
  }
  if (!unregistered.length && !nonCanonical.length && !redundant.length) lines.push('No unregistered, non-canonical or redundant tags.');
  if (unused.length) lines.push(`Unused (${unused.length}): ${unused.join(', ')}`);
  return [...lines, ...issueLines(issues)];
}

export function suggestText(suggestions: readonly Suggestion[]): string[] {
  return suggestions.length ? suggestions.map(item => `${item.tag}${item.alias === undefined ? '' : ` (${item.alias})`}`) : ['No matching tags.'];
}

export function showText(shown: Shown, issues: readonly Issue[]): string[] {
  const { draft, notes } = shown;
  return [
    `${shown.tag}${shown.matchedAlias === undefined ? '' : ` (matched alias ${shown.matchedAlias})`}`,
    draft.description || '(no description)',
    `Aliases: ${list(draft.aliases)}`,
    ...shown.paths.length > 1 ? ['Paths:', ...shown.paths.map(path => `  ${path.join(' > ')}`)] : [`Path: ${shown.paths[0]?.join(' > ') ?? shown.tag}`],
    ...shown.placed ? [] : ['Not placed: no chain of broader tags leads to a root.'],
    `Children: ${list(draft.children)}`,
    `Related: ${list(draft.related)}`,
    `Narrower tags in total: ${shown.descendants}`,
    `Notes: ${notes.direct} direct, ${notes.rollup} with narrower tags`,
    ...(shown.notePaths ?? []).map(path => `  ${path}`),
    ...issueLines(issues),
  ];
}

// What plan and apply print. The fields are the same ones --json prints.
export interface EditFields {
  base: string;
  written?: boolean;
  diff?: EntryDiff[];
  hash?: string;
  conflict?: { base: string | undefined; current: string };
}

const MARK: Record<EntryDiff['status'], string> = { added: '+', removed: '-', changed: '~' };

export function editText(command: 'plan' | 'apply', fields: EditFields, issues: readonly Issue[]): string[] {
  const { diff, conflict } = fields;
  const lines = diff ? (diff.length ? diff.map(item => `${MARK[item.status]} ${item.tag}`) : ['No changes.']) : [];
  lines.push(...issueLines(issues));
  const errors = issues.some(item => item.severity === 'error');
  if (conflict) lines.push(`Not written: the dictionary changed since plan (base ${conflict.base ?? '-'}, now ${conflict.current}). Run plan again.`);
  else if (command === 'plan') lines.push(!diff ? 'Nothing applied.' : errors ? 'The result has errors; change the changes file first.' : `To write it, run apply with --base ${fields.base}`);
  else if (fields.written) lines.push(`Written. New hash: ${fields.hash ?? '-'}`);
  else lines.push(diff && !diff.length ? 'Nothing to write.' : 'Not written.');
  return lines;
}
