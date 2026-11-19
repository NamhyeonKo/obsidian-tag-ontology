import type { NativeData } from './layer.ts';

export interface VaultNote { path: string; tags: string[]; links: string[]; unresolved?: string[] }
export interface VaultDataOptions { attachments?: string[]; includeAttachments?: boolean; includeUnresolved?: boolean }

// The core graph's data, built from the vault for a view that has no core graph engine: notes link to their tags and to the
// notes they link to. Like the core graph, tags that differ only in case are one node, named by the first spelling met.
export function vaultData(notes: VaultNote[], options?: VaultDataOptions): NativeData {
  const nodes: NativeData['nodes'] = {}, tagIds = new Map<string, string>(), paths = new Set(notes.map(note => note.path));
  const ensureNode = (key: string, type: string) => {
    if (key !== '__proto__' && !Object.hasOwn(nodes, key)) nodes[key] = { type, links: {} };
  };
  const attachments = new Set(options?.includeAttachments ? (options.attachments ?? []).filter(path => !paths.has(path)) : []);
  const includeUnresolved = Boolean(options?.includeUnresolved);
  for (const note of notes) {
    const links: Record<string, boolean> = {};
    for (const tag of note.tags) {
      const key = tag.toLowerCase(), id = tagIds.get(key) ?? tagIds.set(key, '#' + tag).get(key)!;
      links[id] = true;
      ensureNode(id, 'tag');
    }
    for (const target of note.links) {
      if (target !== note.path && (paths.has(target) || attachments.has(target))) links[target] = true;
    }
    if (includeUnresolved) {
      for (const target of note.unresolved ?? []) {
        if (!target || target === '__proto__' || paths.has(target) || attachments.has(target)) continue;
        links[target] = true;
        ensureNode(target, 'unresolved');
      }
    }
    nodes[note.path] = { type: '', links };
  }
  for (const path of attachments) ensureNode(path, 'attachment');
  return { nodes, numLinks: 0 };
}
