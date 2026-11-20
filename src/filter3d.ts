import type { NativeData } from './layer.ts';

export interface QueryTerm {
  negate: boolean;
  field: 'any' | 'path' | 'file' | 'tag';
  value: string;
}

/** Parse a 3D search filter query into normalized terms supporting negation, quotes, and path/file/tag prefixes. */
export function parseFilterQuery(query: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  let i = 0;
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) i++;
    if (i >= query.length) break;
    let raw = '';
    let quoted = false;
    while (i < query.length) {
      const ch = query[i];
      if (ch === '"') { quoted = !quoted; i++; continue; }
      if (!quoted && /\s/.test(ch)) break;
      raw += ch;
      i++;
    }
    const negate = raw.startsWith('-');
    const body = negate ? raw.slice(1) : raw;
    const [, prefix, rest] = /^(?:(path|file|tag):)?([\s\S]*)$/i.exec(body) ?? [];
    const field = (prefix?.toLowerCase() as QueryTerm['field'] | undefined) ?? 'any';
    let value = rest ?? '';
    if (field === 'tag' && value.startsWith('#')) value = value.slice(1);
    value = value.toLowerCase();
    if (value) terms.push({ negate, field, value });
  }
  return terms;
}

const stemOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

const tagMatches = (tag: string, query: string): boolean => tag === query || tag.startsWith(`${query}/`);
const matchAnyTag = (tag: string, query: string): boolean =>
  query.startsWith('#') ? query.length > 1 && tagMatches(tag, query.slice(1)) : tag.includes(query);

function noteMatchesTerm(id: string, tags: readonly string[], term: QueryTerm): boolean {
  if (term.field === 'path') return id.toLowerCase().includes(term.value);
  if (term.field === 'file') return stemOf(id).includes(term.value);
  if (term.field === 'tag') return tags.some(tag => tagMatches(tag, term.value));
  return id.toLowerCase().includes(term.value) || tags.some(tag => matchAnyTag(tag, term.value));
}

function tagMatchesDirect(tagName: string, terms: readonly QueryTerm[]): boolean {
  for (const term of terms) {
    const matched = term.field === 'tag'
      ? tagMatches(tagName, term.value)
      : term.field === 'any' && matchAnyTag(tagName, term.value);
    if (term.negate ? matched : !matched) return false;
  }
  return true;
}

function pruneData(data: NativeData, keep: ReadonlySet<string>): NativeData {
  const nodes: NativeData['nodes'] = {};
  for (const [id, node] of Object.entries(data.nodes)) {
    if (!keep.has(id)) continue;
    const links: Record<string, boolean> = {};
    for (const target of Object.keys(node.links)) {
      if (keep.has(target)) links[target] = true;
    }
    nodes[id] = { ...node, links };
  }
  return { nodes, numLinks: 0 };
}

/** Filter base graph nodes and prune links using parsed search query terms before hierarchy layering. */
export function applySearchFilter(data: NativeData, query: string): NativeData {
  const terms = parseFilterQuery(query);
  if (!terms.length) return data;

  const canMatchTagDirectly = terms.some(term => !term.negate && (term.field === 'tag' || term.field === 'any'))
    && !terms.some(term => !term.negate && (term.field === 'path' || term.field === 'file'));
  const keep = new Set<string>();
  for (const [id, node] of Object.entries(data.nodes)) {
    if (node.type === 'tag') {
      if (canMatchTagDirectly && tagMatchesDirect(id.slice(1).toLowerCase(), terms)) keep.add(id);
      continue;
    }
    const linkedTags = Object.keys(node.links).filter(target => Object.hasOwn(data.nodes, target) && data.nodes[target].type === 'tag');
    const tags = linkedTags.map(target => target.slice(1).toLowerCase());
    if (!terms.every(term => noteMatchesTerm(id, tags, term) !== term.negate)) continue;
    keep.add(id);
    for (const target of linkedTags) keep.add(target);
  }
  return pruneData(data, keep);
}

/** Remove degree-0 non-tag nodes (orphaned notes, attachments, unresolved links) while keeping tag nodes. */
export function removeOrphans(data: NativeData): NativeData {
  const keep = new Set<string>();
  for (const [id, node] of Object.entries(data.nodes)) {
    if (node.type === 'tag') keep.add(id);
    for (const target of Object.keys(node.links)) {
      if (!Object.hasOwn(data.nodes, target)) continue;
      keep.add(id);
      keep.add(target);
    }
  }
  return pruneData(data, keep);
}
