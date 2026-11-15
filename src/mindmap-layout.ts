import { treePositions } from './layout.ts';

export function mindmapPositions(tags: string[], edges: [string, string][], depths: ReadonlyMap<string, number>, outside: string[]) {
  const positions = treePositions(tags, edges, depths, true);
  let right = 0, bottom = 0;
  for (const p of positions.values()) { right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const columns = Math.ceil(Math.sqrt(outside.length));
  outside.forEach((id, i) => positions.set(id, { x: right + 260 + i % columns * 240, y: bottom + Math.floor(i / columns) * 48 }));
  return positions;
}
