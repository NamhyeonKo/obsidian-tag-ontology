import type { Graph, GraphEdge } from './ontology.ts';

export interface NativeData {
  nodes: Record<string, { type: string; links: Record<string, boolean> }>;
  numLinks: number;
}
export const edgeKey = (source: string, target: string) => JSON.stringify([source, target]);

export function nativeData(graph: Graph) {
  // The core renderer calls hasOwnProperty directly, so these must be ordinary objects.
  const data: NativeData = { nodes: {}, numLinks: 0 };
  const ids = new Map<string, string>();
  const kinds = new Map<string, GraphEdge['kind']>();
  for (const node of graph.nodes) {
    const id = node.kind === 'tag' ? '#' + node.tag : node.path!;
    if (Object.hasOwn(data.nodes, id)) throw new Error(`Graph ID collision: ${id}`);
    ids.set(node.id, id);
    data.nodes[id] = { type: node.kind === 'tag' ? 'tag' : '', links: {} };
  }
  for (const edge of graph.edges) {
    const source = ids.get(edge.source)!, target = ids.get(edge.target)!;
    const key = edgeKey(source, target);
    if (!data.nodes[source]!.links[target]) data.numLinks++;
    data.nodes[source]!.links[target] = true;
    if (!kinds.has(key) || edge.kind === 'broader') kinds.set(key, edge.kind);
  }
  return { data, kinds };
}
