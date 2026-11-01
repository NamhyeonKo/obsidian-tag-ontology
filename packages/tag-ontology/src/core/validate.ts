// Every rule a tag dictionary is checked against, in one place: the Ontology, the plugin and the CLI all go through here.
import { tagNameError, type RawDictionary } from './dictionary.ts';

export type Severity = 'error' | 'warning';

// An error is what stops the plugin from opening the dictionary; everything else is a warning (docs/decisions.md, 5).
const SEVERITY = {
  'invalid-dictionary': 'error',
  'invalid-entry': 'error',
  'invalid-field': 'error',
  'unknown-reference': 'error',
  'self-reference': 'error',
  'broader-cycle': 'error',
  'empty-description': 'warning',
  'invalid-name': 'warning',
  'name-format': 'warning',
  'name-collision': 'warning',
  'related-in-hierarchy': 'warning',
  'unplaced': 'warning',
  'redundant-broader': 'warning',
} as const satisfies Record<string, Severity>;

export type IssueCode = keyof typeof SEVERITY;
export type EntryField = 'description' | 'aliases' | 'broader' | 'related' | 'facet';

// What `--json` prints for each problem (docs/cli.md, Issues). The message is for people; the other fields are the contract.
export interface Issue {
  code: IssueCode;
  severity: Severity;
  tag?: string;
  field?: EntryField;
  target?: string;
  message: string;
}

export interface ValidateOptions {
  // 'kebab' also warns about names that aren't lowercase letters and digits joined by single hyphens.
  names?: 'obsidian' | 'kebab';
}

// An entry that passed the shape checks; a list field that failed them is kept as empty so it isn't reported twice.
interface Checked { description: string; aliases: string[]; broader?: string[]; related?: string[] }

const LISTS = ['aliases', 'broader', 'related'] as const;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RANK: Record<Severity, number> = { error: 0, warning: 1 };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
// Code-unit order, so the result doesn't depend on the locale it runs in.
const compare = (a = '', b = '') => a < b ? -1 : a > b ? 1 : 0;
const byPlace = (a: Issue, b: Issue) => RANK[a.severity] - RANK[b.severity]
  || compare(a.tag, b.tag) || compare(a.code, b.code) || compare(a.target, b.target);

export function validate(raw: unknown, options: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const report = (code: IssueCode, message: string, at: Pick<Issue, 'tag' | 'field' | 'target'> = {}) => {
    issues.push({ code, severity: SEVERITY[code], ...at, message });
  };
  if (!isRecord(raw)) {
    report('invalid-dictionary', 'The tag dictionary must be a JSON object.');
    return issues;
  }

  const tags = Object.keys(raw).sort();
  const entries = new Map<string, Checked>();
  for (const tag of tags) {
    const value = raw[tag];
    if (!isRecord(value) || typeof value.description !== 'string') {
      report('invalid-entry', `Tag ${tag}: expected an object with a string description.`, { tag });
      continue;
    }
    const entry: Checked = { description: value.description, aliases: [] };
    for (const key of LISTS) {
      if (!Object.hasOwn(value, key)) continue;
      const list = value[key];
      if (isStringList(list)) entry[key] = list;
      else { report('invalid-field', `${tag}.${key}: expected an array of strings.`, { tag, field: key }); entry[key] = []; }
    }
    if (Object.hasOwn(value, 'facet') && typeof value.facet !== 'string') {
      report('invalid-field', `${tag}.facet: expected a string.`, { tag, field: 'facet' });
    }
    entries.set(tag, entry);
  }

  // Own keys only, so "constructor" or "__proto__" in a list is an unknown tag, not something inherited.
  const known = new Set(tags);
  for (const [tag, entry] of entries) {
    for (const key of ['broader', 'related'] as const) {
      for (const target of entry[key] ?? []) {
        if (!known.has(target)) report('unknown-reference', `${tag}.${key}: unknown tag ${target}`, { tag, field: key, target });
        else if (target === tag) report('self-reference', `${tag}.${key}: a tag cannot reference itself.`, { tag, field: key });
      }
    }
  }

  // The hierarchy between checked entries. Ancestors are filled parents first, so a tag on or below a cycle never gets its turn.
  const up = new Map([...entries].map(([tag, entry]) => [tag, (entry.broader ?? []).filter(parent => parent !== tag && entries.has(parent))]));
  const down = new Map([...entries.keys()].map(tag => [tag, [] as string[]]));
  for (const [tag, parents] of up) for (const parent of parents) down.get(parent)?.push(tag);
  const waiting = new Map([...up].map(([tag, parents]) => [tag, parents.length]));
  const ancestors = new Map<string, Set<string>>();
  const queue = [...waiting].filter(([, count]) => count === 0).map(([tag]) => tag);
  for (const tag of queue) {
    ancestors.set(tag, new Set((up.get(tag) ?? []).flatMap(parent => [parent, ...ancestors.get(parent) ?? []])));
    for (const child of down.get(tag) ?? []) {
      const count = (waiting.get(child) ?? 0) - 1;
      waiting.set(child, count);
      if (count === 0) queue.push(child);
    }
  }
  const leadsTo = (from: string, to: string) => {
    const seen = new Set<string>(), stack = [...up.get(from) ?? []];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      if (item === to) return true;
      if (!seen.has(item)) { seen.add(item); stack.push(...up.get(item) ?? []); }
    }
    return false;
  };
  const cycle = [...entries.keys()].filter(tag => !ancestors.has(tag) && leadsTo(tag, tag));
  for (const tag of cycle) report('broader-cycle', `Cycle in broader relations: ${cycle.join(', ')}`, { tag });

  for (const tag of tags) {
    const error = tagNameError(tag);
    if (error) report('invalid-name', `Tag "${tag}" is not a valid Obsidian tag. ${error}`, { tag });
    else if (options.names === 'kebab' && !KEBAB.test(tag)) report('name-format', `Tag "${tag}" is not lowercase words joined by hyphens.`, { tag });
  }

  // Tag names are taken first, then aliases, each in tag order; a later name equal to an earlier one ignoring case collides with it.
  const holders = new Map<string, string>();
  const claim = (name: string, at: { tag: string; field?: 'aliases' }) => {
    const key = name.toLowerCase(), first = holders.get(key);
    if (first === undefined) holders.set(key, at.tag);
    else report('name-collision', `"${name}" on ${at.tag} is already a name of ${first}, ignoring case.`, { ...at, target: first });
  };
  for (const tag of tags) claim(tag, { tag });
  for (const [tag, entry] of entries) for (const alias of entry.aliases) claim(alias, { tag, field: 'aliases' });

  for (const [tag, entry] of entries) {
    if (!entry.description.trim()) report('empty-description', `${tag}.description: empty.`, { tag, field: 'description' });
    if (!entry.broader) report('unplaced', `${tag}: no broader, so it has no place in the hierarchy.`, { tag });
    const above = ancestors.get(tag);
    if (!above) continue;
    for (const target of entry.related ?? []) {
      if (target !== tag && (above.has(target) || ancestors.get(target)?.has(tag))) {
        report('related-in-hierarchy', `${tag}.related: ${target} is also its ancestor or descendant.`, { tag, field: 'related', target });
      }
    }
    const parents = up.get(tag) ?? [];
    for (const parent of new Set(parents)) {
      if (parents.some(other => other !== parent && ancestors.get(other)?.has(parent))) {
        report('redundant-broader', `${tag}.broader: ${parent} is already reached through another parent.`, { tag, field: 'broader', target: parent });
      }
    }
  }
  return issues.sort(byPlace);
}

// The plugin opens exactly the dictionaries without errors; this throws the first one and tells TypeScript the shape holds.
export function assertDictionary(raw: unknown): asserts raw is RawDictionary {
  const error = validate(raw).find(issue => issue.severity === 'error');
  if (error) throw new Error(error.message);
}
