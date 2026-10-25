// Changes to the raw dictionary JSON, kept free of Obsidian so they can be tested on their own.

export type RawEntry = { description: string; aliases?: string[]; broader?: string[]; related?: string[]; [key: string]: unknown };
export type RawDictionary = Record<string, RawEntry>;

// What the edit form works on; children and two-way related are derived, the file stores broader and related only.
export interface Draft { name: string; description: string; aliases: string[]; parents: string[]; children: string[]; related: string[] }
export type Change = { kind: 'add'; draft: Draft } | { kind: 'edit'; tag: string; draft: Draft } | { kind: 'delete'; tag: string };

const without = (list: string[], items: string[]) => list.filter(item => !items.includes(item));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item));
// Empty aliases and related are left out of the entries a change writes; an empty broader still marks a root.
function setList(entry: RawEntry, key: 'aliases' | 'related', list: string[]) {
  if (list.length) entry[key] = [...list]; else delete entry[key];
}

export function draftOf(dict: RawDictionary, tag: string): Draft {
  const entry = dict[tag], keys = Object.keys(dict);
  return {
    name: tag, description: entry.description, aliases: [...entry.aliases ?? []], parents: [...entry.broader ?? []],
    children: keys.filter(key => dict[key].broader?.includes(tag)).sort(),
    related: [...new Set([...entry.related ?? [], ...keys.filter(key => dict[key].related?.includes(tag))])],
  };
}

export const emptyDraft = (parents: string[] = []): Draft => ({ name: '', description: '', aliases: [], parents, children: [], related: [] });

export function apply(dict: RawDictionary, change: Change): RawDictionary {
  const next = structuredClone(dict);
  if (change.kind === 'add') {
    const { name, description, aliases, parents } = change.draft;
    next[name] = { ...aliases.length ? { aliases: [...aliases] } : {}, description, broader: [...parents] };
    return next;
  }
  if (change.kind === 'delete') {
    // Children move up to the deleted tag's parents, like a thesaurus hands a dropped concept's scope to its broader term.
    const { tag } = change, parents = next[tag].broader ?? [];
    delete next[tag];
    for (const entry of Object.values(next)) {
      if (entry.broader?.includes(tag)) entry.broader = [...new Set(entry.broader.flatMap(parent => parent === tag ? parents : [parent]))];
      if (entry.related?.includes(tag)) setList(entry, 'related', without(entry.related, [tag]));
    }
    return next;
  }
  const { tag, draft } = change, { name } = draft, before = draftOf(dict, tag);
  if (name !== tag) {
    next[name] = next[tag]!; delete next[tag];
    for (const entry of Object.values(next)) {
      for (const key of ['broader', 'related'] as const) if (entry[key]?.includes(tag)) entry[key] = entry[key].map(item => item === tag ? name : item);
    }
  }
  const entry = next[name];
  setList(entry, 'aliases', draft.aliases);
  entry.description = draft.description;
  if (entry.broader || draft.parents.length) entry.broader = [...draft.parents];
  for (const child of without(before.children, draft.children)) next[child].broader = without(next[child].broader ?? [], [name]);
  for (const child of without(draft.children, before.children)) next[child].broader = [...next[child].broader ?? [], name];
  // Related is two-way; it is rewritten only when the user changed it, so other edits leave the file's related lines alone.
  if (!sameSet(before.related, draft.related)) {
    for (const other of without(before.related, draft.related)) setList(next[other], 'related', without(next[other].related ?? [], [name]));
    setList(entry, 'related', draft.related);
    for (const other of draft.related) if (!next[other].related?.includes(name)) next[other].related = [...next[other].related ?? [], name];
  }
  return next;
}

const inline =(value: unknown): string => Array.isArray(value) ? `[${value.map(inline).join(', ')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(', ')}}`
  : JSON.stringify(value);

// One entry per line in key order, like the dictionaries users keep in git: a save only changes the lines it touches.
export function serialize(dict: RawDictionary): string {
  const lines = Object.keys(dict).sort().map(key => `${JSON.stringify(key)}: ${inline(dict[key])}`);
  return lines.length ? `{\n${lines.join(',\n')}\n}\n` : '{\n}\n';
}
