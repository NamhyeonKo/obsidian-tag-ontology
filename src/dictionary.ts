// Changes to the raw dictionary JSON, kept free of Obsidian so they can be tested on their own.

export type RawEntry = { description: string; aliases?: string[]; broader?: string[]; related?: string[]; [key: string]: unknown };
export type RawDictionary = Record<string, RawEntry>;

// What the edit form works on; children and two-way related are derived, the file stores broader and related only.
export interface Draft { name: string; description: string; aliases: string[]; parents: string[]; children: string[]; related: string[] }
export type Change = { kind: 'add'; draft: Draft } | { kind: 'edit'; tag: string; draft: Draft } | { kind: 'delete'; tag: string };

// Tag names come from users, and `next[name] = …` with "__proto__" would set the prototype instead of adding an entry.
const put = (dict: RawDictionary, key: string, entry: RawEntry) => Object.defineProperty(dict, key, { value: entry, enumerable: true, writable: true, configurable: true });
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
    const { name, description, aliases, parents, children, related } = change.draft;
    put(next, name, { ...aliases.length ? { aliases: [...aliases] } : {}, description, broader: [...parents] });
    // A new tag has no links yet, so every child and related tag is one to add, as in an edit.
    for (const child of children) next[child].broader = [...next[child].broader ?? [], name];
    setList(next[name], 'related', related);
    for (const other of related) next[other].related = [...next[other].related ?? [], name];
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
    put(next, name, next[tag]); delete next[tag];
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

export const normalizeName = (input: string) => input.trim().replace(/^#/, '');

export function nameError(name: string, dict: RawDictionary, current?: string): string | undefined {
  if (!name) return 'Enter a tag name.';
  if (/\s/.test(name)) return 'Tag names cannot contain spaces.';
  // \p{M}: combining marks, as in Hindi or Thai, which Obsidian accepts in tags.
  if (!/^[\p{L}\p{M}\p{N}_\-/]+$/u.test(name)) return 'Use letters, numbers, _, - and / only.';
  if (/^\d+$/.test(name)) return 'A tag needs at least one character that is not a number.';
  // The core graph merges tags that differ only in case, so the dictionary can't hold both.
  const existing = Object.keys(dict).find(key => key !== current && key.toLowerCase() === name.toLowerCase());
  return existing === undefined ? undefined : `#${existing} is already in the dictionary.`;
}

export function changedFields(dict: RawDictionary, tag: string, draft: Draft): number {
  const before = draftOf(dict, tag);
  return [before.name === draft.name, before.description === draft.description,
    ...(['aliases', 'parents', 'children', 'related'] as const).map(key => sameSet(before[key], draft[key]))].filter(same => !same).length;
}

// A new tag has no entry yet; this stands in for it, and a space can't be in a tag name.
const NEW = ' new';

// Tags the picker leaves out: choosing a descendant as a parent, or an ancestor as a child, would make a cycle.
// A tag of undefined is a new tag, whose cycles can only come through the parents and children the draft already names.
export function excluded(dict: RawDictionary, tag: string | undefined, draft: Draft, kind: 'parents' | 'children' | 'related'): Set<string> {
  const found = new Set([...tag === undefined ? [] : [tag], ...draft[kind]]);
  if (kind === 'related') return found;
  const self = tag ?? NEW, children = new Map<string, string[]>();
  const next = tag === undefined ? apply(dict, { kind: 'add', draft: { ...draft, name: self } }) : apply(dict, { kind: 'edit', tag, draft: { ...draft, name: tag } });
  for (const [key, entry] of Object.entries(next)) for (const parent of entry.broader ?? []) children.set(parent, [...children.get(parent) ?? [], key]);
  const step = (item: string) => kind === 'parents' ? children.get(item) ?? [] : next[item]?.broader ?? [];
  const queue = step(self), seen = new Set<string>();
  while (queue.length) {
    const item = queue.pop()!;
    if (!seen.has(item)) { seen.add(item); found.add(item); queue.push(...step(item)); }
  }
  return found;
}

export function deletionPreview(dict: RawDictionary, tag: string): { parents: string[]; children: string[]; roots: string[]; related: string[] } {
  const { parents, children, related } = draftOf(dict, tag), next = apply(dict, { kind: 'delete', tag });
  return { parents, children, roots: children.filter(child => next[child].broader?.length === 0), related };
}

// What changed elsewhere since the form opened that the change would overwrite or be wrong about: the tag's own entry,
// which tags link to it (the change is computed against those links), the tags the draft names, and a new name taken meanwhile.
// Other fields of linked tags are kept by apply, so they are no conflict.
export function conflicts(base: RawDictionary, latest: RawDictionary, change: Change): string[] {
  const taken = (name: string, own?: string) => Object.keys(latest).some(key => key !== own && key.toLowerCase() === name.toLowerCase());
  if (change.kind === 'add') {
    const { name, parents, children, related } = change.draft;
    return [...new Set([...taken(name) ? [name] : [], ...[...parents, ...children, ...related].filter(item => !Object.hasOwn(latest, item))])];
  }
  const { tag } = change;
  if (!Object.hasOwn(latest, tag) || JSON.stringify(base[tag]) !== JSON.stringify(latest[tag])) return [tag];
  const was = draftOf(base, tag), now = draftOf(latest, tag);
  const hit = (['children', 'related'] as const).flatMap(key => [...without(was[key], now[key]), ...without(now[key], was[key])]);
  if (change.kind === 'edit') {
    const { draft } = change;
    hit.push(...[...draft.parents, ...draft.children, ...draft.related].filter(item => !Object.hasOwn(latest, item)));
    if (draft.name !== tag && taken(draft.name, tag)) hit.push(draft.name);
  }
  return [...new Set(hit)];
}

const inline = (value: unknown): string => Array.isArray(value) ? `[${value.map(inline).join(', ')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(', ')}}`
  : JSON.stringify(value);

// One entry per line in key order, like the dictionaries users keep in git: a save only changes the lines it touches.
export function serialize(dict: RawDictionary): string {
  const lines = Object.keys(dict).sort().map(key => `${JSON.stringify(key)}: ${inline(dict[key])}`);
  return lines.length ? `{\n${lines.join(',\n')}\n}\n` : '{\n}\n';
}
