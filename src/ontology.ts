export interface Entry {
  aliases: string[];
  description: string;
  broader?: string[];
  related?: string[];
  facet?: string;
}

export interface Note { path: string; tags: string[] }
export interface GraphNode {
  id: string; label: string; kind: 'tag' | 'note'; tag?: string; path?: string; size: number;
}
export interface GraphEdge {
  id: string; source: string; target: string; kind: 'broader' | 'related' | 'note';
}
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

export function isIncludedNote(path: string): boolean {
  return path.endsWith('.md')
    && !path.split('/').some((part) => part === '' || part.startsWith('.'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field}: expected an array of strings.`);
  }
  return [...new Set(value)];
}

export class Ontology {
  entries = new Map<string, Entry>();
  children = new Map<string, string[]>();
  roots: string[] = [];
  direct = new Map<string, string[]>();
  unregistered = new Map<string, string[]>();
  unused: string[] = [];

  constructor(raw: unknown, notes: Note[]) {
    if (!isRecord(raw)) throw new Error('The tag dictionary must be a JSON object.');
    for (const tag of Object.keys(raw).sort()) {
      const value = raw[tag];
      if (!isRecord(value) || typeof value.description !== 'string') {
        throw new Error(`Tag ${tag}: expected an object with a string description.`);
      }
      const entry: Entry = {
        description: value.description,
        aliases: stringList(Object.hasOwn(value, 'aliases') ? value.aliases : [], `${tag}.aliases`),
      };
      for (const key of ['broader', 'related'] as const) {
        if (Object.hasOwn(value, key)) entry[key] = stringList(value[key], `${tag}.${key}`);
      }
      if (Object.hasOwn(value, 'facet')) {
        if (typeof value.facet !== 'string') throw new Error(`${tag}.facet: expected a string.`);
        entry.facet = value.facet;
      }
      this.entries.set(tag, entry);
      this.children.set(tag, []);
    }
    for (const [tag, entry] of this.entries) {
      for (const key of ['broader', 'related'] as const) {
        for (const target of entry[key] ?? []) {
          if (!this.entries.has(target)) throw new Error(`${tag}.${key}: unknown tag ${target}`);
          if (target === tag) throw new Error(`${tag}.${key}: a tag cannot reference itself.`);
          if (key === 'broader') this.children.get(target)!.push(tag);
        }
      }
      if (entry.broader?.length === 0) this.roots.push(tag);
    }
    const pending = new Map([...this.entries].map(([tag, entry]) => [tag, entry.broader?.length ?? 0]));
    const queue = [...pending].filter(([, degree]) => degree === 0).map(([tag]) => tag);
    for (let index = 0; index < queue.length; index++) {
      for (const child of this.children.get(queue[index]!)!) {
        const degree = pending.get(child)! - 1;
        pending.set(child, degree);
        if (degree === 0) queue.push(child);
      }
    }
    if (queue.length !== this.entries.size) {
      throw new Error(`Cycle in broader relations: ${[...pending].filter(([, degree]) => degree > 0).map(([tag]) => tag).join(', ')}`);
    }
    const paths = new Map<string, Set<string>>();
    for (const note of notes) {
      if (!isIncludedNote(note.path)) continue;
      for (const tag of note.tags) {
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
    for (let index = 0; index < queue.length; index++) {
      for (const child of this.children.get(queue[index]!) ?? []) {
        if (!found.has(child)) { found.add(child); queue.push(child); }
      }
    }
    return found;
  }

  notesFor(tag: string, rollup: boolean): string[] {
    const tags = rollup ? [tag, ...this.descendants(tag)] : [tag];
    return [...new Set(tags.flatMap((item) => this.direct.get(item) ?? []))].sort();
  }

  counts(tag: string): { direct: number; rollup: number } {
    return { direct: this.direct.get(tag)?.length ?? 0, rollup: this.notesFor(tag, true).length };
  }

  visible(expanded: Set<string>, showRelated = true): Graph {
    const tags = new Set(this.roots);
    const queue = [...tags];
    for (let index = 0; index < queue.length; index++) {
      const tag = queue[index]!;
      if (!expanded.has(tag)) continue;
      for (const child of this.children.get(tag) ?? []) {
        if (!tags.has(child)) { tags.add(child); queue.push(child); }
      }
    }
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const addEdge = (kind: GraphEdge['kind'], source: string, target: string) => {
      const id = 'edge:' + JSON.stringify([kind, source, target]);
      edges.set(id, { id, source, target, kind });
    };
    for (const tag of tags) {
      const id = 'tag:' + tag;
      nodes.set(id, { id, label: tag, kind: 'tag', tag, size: this.counts(tag).rollup });
    }
    for (const tag of tags) {
      const entry = this.entries.get(tag)!;
      for (const parent of entry.broader ?? []) {
        if (tags.has(parent)) addEdge('broader', 'tag:' + parent, 'tag:' + tag);
      }
      if (showRelated) {
        for (const related of entry.related ?? []) {
          if (!tags.has(related)) continue;
          const [source, target] = [tag, related].sort();
          addEdge('related', 'tag:' + source, 'tag:' + target);
        }
      }
      if (!expanded.has(tag)) continue;
      for (const path of this.direct.get(tag) ?? []) {
        const id = 'note:' + path;
        nodes.set(id, { id, label: path.split('/').at(-1)!.slice(0, -3), kind: 'note', path, size: 1 });
        addEdge('note', 'tag:' + tag, id);
      }
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }
}
