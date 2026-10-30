import type { NativeData } from './layer.ts';

export interface VaultNote { path: string; tags: string[]; links: string[] }

// The core graph's data, built from the vault for a view that has no core graph engine: notes link to their tags and to the
// notes they link to. Like the core graph, tags that differ only in case are one node, named by the first spelling met.
export function vaultData(notes: VaultNote[]): NativeData {
  const nodes: NativeData['nodes'] = {}, tagIds = new Map<string, string>(), paths = new Set(notes.map(note => note.path));
  for (const note of notes) {
    const links: Record<string, boolean> = {};
    for (const tag of note.tags) {
      const key = tag.toLowerCase(), id = tagIds.get(key) ?? tagIds.set(key, '#' + tag).get(key)!;
      links[id] = true;
      nodes[id] ??= { type: 'tag', links: {} };
    }
    for (const target of note.links) if (target !== note.path && paths.has(target)) links[target] = true;
    nodes[note.path] = { type: '', links };
  }
  return { nodes, numLinks: 0 };
}
