// Breadth-first hierarchy layout with the same rules as the cytoscape breadthfirst settings it replaces:
// depth is the distance from the nearest root, each level is ordered by where its neighbors above sit,
// levels spread over a 1200x900 box (rows for Tree, rings for Radial), then everything is spaced out by 1.6.
export function hierarchyPositions(tags: string[], edges: [parent: string, child: string][], roots: string[], circle: boolean) {
  const children = new Map<string, string[]>(), neighbors = new Map(tags.map(tag => [tag, new Set<string>()]));
  for (const [parent, child] of edges) {
    children.set(parent, [...children.get(parent) ?? [], child]);
    neighbors.get(parent)?.add(child); neighbors.get(child)?.add(parent);
  }
  const depth = new Map(roots.map(root => [root, 0])), queue = [...roots];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (!depth.has(child)) { depth.set(child, depth.get(queue[i])! + 1); queue.push(child); }
    }
  }
  const levels: string[][] = [], index = new Map<string, number>();
  for (const [tag, d] of depth) (levels[d] ??= []).push(tag);
  for (const [d, level] of levels.entries()) {
    const weight = new Map(level.map(tag => {
      const above = [...neighbors.get(tag) ?? []].filter(other => (depth.get(other) ?? d) < d);
      return [tag, above.reduce((sum, other) => sum + index.get(other)! / levels[depth.get(other)!].length, 0) / Math.max(1, above.length)];
    }));
    level.sort((a, b) => weight.get(a)! - weight.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
    level.forEach((tag, i) => index.set(tag, i));
  }
  // Nodes are 14 wide (16 with their border), at least 14 apart; the box has 30 of padding.
  const positions = new Map<string, { x: number; y: number }>(), rows = levels.length;
  for (const [d, level] of levels.entries()) {
    const n = level.length, step = Math.max(450 / rows, 14);
    const dx = n === 1 ? 0 : Math.max((1200 - 60 - 16) / (n - 1), 14), dy = rows === 1 ? 0 : Math.max((900 - 60 - 16) / (rows - 1), 14);
    const radius = d === 0 && n === 1 ? 1 : step * (d + 1) - (levels[0].length <= 3 ? step / 2 : 0);
    level.forEach((tag, i) => positions.set(tag, circle
      ? { x: radius * Math.cos(2 * Math.PI / n * i), y: radius * Math.sin(2 * Math.PI / n * i) }
      : { x: (i + 1 - (n + 1) / 2) * dx, y: (d + 1 - (rows + 1) / 2) * dy }));
  }
  const xs = [...positions.values()].map(p => p.x), ys = [...positions.values()].map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const p of positions.values()) { p.x = cx + (p.x - cx) * 1.6; p.y = cy + (p.y - cy) * 1.6; }
  return positions;
}
