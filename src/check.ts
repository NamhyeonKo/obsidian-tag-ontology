import type { NonCanonical, Redundant } from 'tag-ontology';

export interface NonCanonicalGroup { tag: string; canonical: string; notes: string[] }
export interface RedundantGroup { tag: string; notes: string[] }

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function groupNonCanonical(rows: readonly NonCanonical[]): NonCanonicalGroup[] {
  const groups = new Map<string, Map<string, Set<string>>>();
  for (const { path, tag, canonical } of rows) {
    let canonicals = groups.get(tag);
    if (!canonicals) groups.set(tag, canonicals = new Map<string, Set<string>>());
    let notes = canonicals.get(canonical);
    if (!notes) canonicals.set(canonical, notes = new Set<string>());
    notes.add(path);
  }
  return [...groups].flatMap(([tag, canonicals]) => [...canonicals].map(([canonical, notes]) => ({
    tag, canonical, notes: [...notes].sort(compare),
  }))).sort((a, b) => compare(a.tag, b.tag) || compare(a.canonical, b.canonical));
}

export function groupRedundant(rows: readonly Redundant[]): RedundantGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const { path, tag } of rows) {
    let notes = groups.get(tag);
    if (!notes) groups.set(tag, notes = new Set());
    notes.add(path);
  }
  return [...groups].map(([tag, notes]) => ({ tag, notes: [...notes].sort(compare) }))
    .sort((a, b) => compare(a.tag, b.tag));
}
