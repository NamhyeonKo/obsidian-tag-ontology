import type { Ontology } from './ontology.ts';

// The core graph engine's data shape. The renderer calls hasOwnProperty directly, so these stay plain objects.
export interface NativeData {
  nodes: Record<string, { type: string; color?: unknown; links: Record<string, boolean> }>;
  numLinks: number;
}
export const edgeKey = (source: string, target: string) => JSON.stringify([source, target]);

export interface Resolved {
  tagOf: Map<string, string>;
  idOf: Map<string, string>;
  range: Set<string>;
  visible: Set<string>;
}

export function resolveTags(model: Ontology, data: NativeData, expanded: ReadonlySet<string>): Resolved {
  // Unplaced entries have no position in the hierarchy, so they stay ordinary tags.
  const { placed } = model;
  // The core graph merges tag case variants into one node, so match dictionary keys the same way.
  const byLower = new Map([...placed].map(tag => [tag.toLowerCase(), tag]));
  const tagOf = new Map<string, string>(), idOf = new Map<string, string>(), range = new Set<string>();
  for (const [id, node] of Object.entries(data.nodes)) {
    const tag = node.type === 'tag' ? byLower.get(id.slice(1).toLowerCase()) : undefined;
    if (tag) { tagOf.set(id, tag); idOf.set(tag, id); }
  }
  const pending = [...tagOf.values()];
  while (pending.length) {
    const tag = pending.pop()!;
    if (range.has(tag)) continue;
    range.add(tag);
    pending.push(...(model.entries.get(tag)!.broader ?? []).filter(parent => placed.has(parent)));
  }
  for (const tag of range) if (!idOf.has(tag)) { idOf.set(tag, '#' + tag); tagOf.set('#' + tag, tag); }
  const visible = new Set(model.roots.filter(tag => range.has(tag)));
  const queue = [...visible];
  for (let index = 0; index < queue.length; index++) {
    if (!expanded.has(queue[index])) continue;
    for (const child of model.children.get(queue[index]) ?? []) {
      if (range.has(child) && !visible.has(child)) { visible.add(child); queue.push(child); }
    }
  }
  return { tagOf, idOf, range, visible };
}

export function applyCollapse(data: NativeData, resolved: Resolved, model: Ontology): NativeData {
  const { tagOf, idOf, range, visible } = resolved;
  const memo = new Map<string, string[]>();
  const nearest = (tag: string): string[] => {
    if (visible.has(tag)) return [tag];
    let found = memo.get(tag);
    if (!found) {
      found = [...new Set((model.entries.get(tag)!.broader ?? []).filter(parent => range.has(parent)).flatMap(nearest))];
      memo.set(tag, found);
    }
    return found;
  };
  const nodes: NativeData['nodes'] = {};
  for (const [id, node] of Object.entries(data.nodes)) {
    const own = tagOf.get(id);
    if (own && !visible.has(own)) continue;
    const links: Record<string, boolean> = {};
    for (const [target, value] of Object.entries(node.links)) {
      const hidden = tagOf.get(target);
      if (hidden && !visible.has(hidden)) for (const tag of nearest(hidden)) links[idOf.get(tag)!] = true;
      else links[target] = value;
    }
    nodes[id] = { ...node, links };
  }
  for (const tag of visible) nodes[idOf.get(tag)!] ??= { type: 'tag', links: {} };
  return { ...data, nodes };
}

export type EdgeKind = 'broader' | 'related';
export interface NodeColor { a: number; rgb: number }
export interface LayerState { expanded: ReadonlySet<string>; showNotes: boolean; showRelated: boolean; tagColor?: NodeColor }

// Adds links to the given nodes in place: buildLayer passes the fresh copy from applyCollapse.
export function addEdges(data: NativeData, resolved: Resolved, model: Ontology, related: boolean) {
  const { idOf, visible } = resolved, { nodes } = data, edges = new Map<string, EdgeKind>();
  const link = (source: string, target: string, kind: EdgeKind) => {
    const from = idOf.get(source)!, to = idOf.get(target)!, key = edgeKey(from, to);
    if (edges.get(key) === 'broader') return;
    nodes[from].links[to] = true;
    edges.set(key, kind);
  };
  for (const tag of visible) {
    const entry = model.entries.get(tag)!;
    for (const parent of entry.broader ?? []) if (visible.has(parent)) link(parent, tag, 'broader');
    if (related) {
      for (const other of entry.related ?? []) {
        if (!visible.has(other)) continue;
        const [source, target] = [tag, other].sort();
        link(source, target, 'related');
      }
    }
  }
  return { data, kinds: edges };
}

export function hideNotes(data: NativeData): NativeData {
  const nodes = Object.fromEntries(Object.entries(data.nodes).filter(([, node]) => node.type === 'tag'));
  for (const [id, node] of Object.entries(nodes)) {
    nodes[id] = { ...node, links: Object.fromEntries(Object.entries(node.links).filter(([target]) => Object.hasOwn(nodes, target))) };
  }
  return { ...data, nodes };
}

export function buildLayer(data: NativeData, model: Ontology, state: LayerState) {
  const resolved = resolveTags(model, data, state.expanded);
  const collapsed = applyCollapse(data, resolved, model);
  const edges = addEdges(collapsed, resolved, model, state.showRelated);
  const layered = state.showNotes ? edges.data : hideNotes(edges.data);
  // Every node here is already a copy, so coloring tags leaves the core data alone.
  if (state.tagColor) for (const node of Object.values(layered.nodes)) if (node.type === 'tag') node.color = state.tagColor;
  return { data: layered, kinds: edges.kinds, resolved };
}
