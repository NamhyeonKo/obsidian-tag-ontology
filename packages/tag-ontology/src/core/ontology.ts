import { assertDictionary } from './validate.ts';

export interface Entry {
  aliases: string[];
  description: string;
  broader?: string[];
  related?: string[];
  facet?: string;
}

export interface Note { path: string; tags: string[] }
// alias: the alias that matched; notes: how many notes use a tag that is not in the dictionary yet.
export interface Suggestion { tag: string; alias?: string; notes?: number }

export function isIncludedNote(path: string): boolean {
  return path.endsWith('.md')
    && !path.split('/').some((part) => part === '' || part.startsWith('.'));
}

export class Ontology {
  entries = new Map<string, Entry>();
  children = new Map<string, string[]>();
  roots: string[] = [];
  // Tags reachable from a root. Unplaced entries (no broader key) have no position in the hierarchy.
  placed = new Set<string>();
  direct = new Map<string, string[]>();
  unregistered = new Map<string, string[]>();
  unused: string[] = [];
  // Every dictionary tag, parents before children.
  order: string[] = [];

  constructor(raw: unknown, notes: Note[]) {
    assertDictionary(raw);
    for (const [tag, value] of Object.entries(raw).sort(([a], [b]) => a < b ? -1 : 1)) {
      const entry: Entry = { description: value.description, aliases: [...new Set(value.aliases ?? [])] };
      for (const key of ['broader', 'related'] as const) {
        const list = value[key];
        if (list) entry[key] = [...new Set(list)];
      }
      if (typeof value.facet === 'string') entry.facet = value.facet;
      this.entries.set(tag, entry);
      this.children.set(tag, []);
    }
    for (const [tag, entry] of this.entries) {
      for (const parent of entry.broader ?? []) this.children.get(parent)?.push(tag);
      if (entry.broader?.length === 0) this.roots.push(tag);
    }
    // validate() has ruled out cycles, so every tag gets its turn here.
    const pending = new Map([...this.entries].map(([tag, entry]) => [tag, entry.broader?.length ?? 0]));
    const queue = [...pending].filter(([, degree]) => degree === 0).map(([tag]) => tag);
    for (const tag of queue) {
      for (const child of this.children.get(tag) ?? []) {
        const degree = (pending.get(child) ?? 0) - 1;
        pending.set(child, degree);
        if (degree === 0) queue.push(child);
      }
    }
    this.order = queue;
    this.placed = new Set(this.roots.flatMap(root => [root, ...this.descendants(root)]));
    const paths = new Map<string, Set<string>>();
    // The core graph merges tag case variants, so index note tags against dictionary keys the same way.
    const byLower = new Map([...this.entries.keys()].map(key => [key.toLowerCase(), key]));
    for (const note of notes) {
      if (!isIncludedNote(note.path)) continue;
      for (const raw of note.tags) {
        const tag = byLower.get(raw.toLowerCase()) ?? raw;
        if (!paths.has(tag)) paths.set(tag, new Set());
        paths.get(tag)!.add(note.path);
      }
    }
    for (const tag of this.entries.keys()) this.direct.set(tag, [...paths.get(tag) ?? []].sort());
    for (const tag of [...paths.keys()].sort()) {
      if (!this.entries.has(tag)) this.unregistered.set(tag, [...paths.get(tag)!].sort());
    }
    this.unused = [...this.direct].filter(([, taggedNotes]) => taggedNotes.length === 0).map(([tag]) => tag);
  }

  descendants(tag: string): Set<string> {
    const found = new Set<string>();
    const queue = [tag];
    for (const item of queue) {
      for (const child of this.children.get(item) ?? []) {
        if (!found.has(child)) { found.add(child); queue.push(child); }
      }
    }
    return found;
  }

  // Type-ahead ranking: key prefix, key substring, alias prefix, alias substring; one row per tag.
  suggest(query: string, limit = 10): Suggestion[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const ranked: { rank: number; suggestion: Suggestion }[] = [];
    for (const [tag, entry] of this.entries) {
      const key = tag.toLowerCase();
      if (key.startsWith(q)) { ranked.push({ rank: 0, suggestion: { tag } }); continue; }
      if (key.includes(q)) { ranked.push({ rank: 1, suggestion: { tag } }); continue; }
      const prefix = entry.aliases.find(a => a.toLowerCase().startsWith(q));
      const alias = prefix ?? entry.aliases.find(a => a.toLowerCase().includes(q));
      if (alias) ranked.push({ rank: prefix ? 2 : 3, suggestion: { tag, alias } });
    }
    return ranked.sort((a, b) => a.rank - b.rank || a.suggestion.tag.localeCompare(b.suggestion.tag))
      .slice(0, limit).map(r => r.suggestion);
  }

  // Related is two-way: the tags this one lists and the tags that list it.
  related(tag: string): string[] {
    const listing = [...this.entries].filter(([, entry]) => entry.related?.includes(tag)).map(([key]) => key);
    return [...new Set([...this.entries.get(tag)?.related ?? [], ...listing])];
  }

  notesFor(tag: string, rollup: boolean): string[] {
    const tags = rollup ? [tag, ...this.descendants(tag)] : [tag];
    return [...new Set(tags.flatMap((item) => this.direct.get(item) ?? []))].sort();
  }

  counts(tag: string): { direct: number; rollup: number } {
    return { direct: this.direct.get(tag)?.length ?? 0, rollup: this.notesFor(tag, true).length };
  }
}
