// Tidy tree for the tag hierarchy. A tag's level is one below its deepest parent, so within its root tree it sits below
// every parent; it hangs under that parent (the first one given on a tie) and links to its other parents are only drawn.
// Leaves sit side by side, each parent is centered over its children, and root trees wrap into rows to roughly fit a screen,
// so a link to a parent in another root tree can point up from a lower row.
// ponytail: leaves never share a column (no Reingold–Tilford contour packing); add it if shallow subtrees beside deep ones waste width.
// Upright, siblings sit a label apart (Obsidian labels are about 90–130 wide) and levels leave room for the label under
// each dot; on its side, siblings only need a label's height and levels a label's width.
const SPACING = { upright: { sibling: 120, level: 160 }, sideways: { sibling: 40, level: 260 } }, SCREEN = 1.6;
export function treePositions(tags: string[], edges: [parent: string, child: string][], horizontal = false) {
  const { sibling: SIBLING, level: LEVEL } = horizontal ? SPACING.sideways : SPACING.upright, GAP = 2 * SIBLING;
  const parents = new Map(tags.map(tag => [tag, [] as string[]]));
  for (const [parent, child] of edges) parents.get(child)?.push(parent);
  // The dictionary rejects broader cycles, so this ends.
  const level = new Map<string, number>();
  const levelOf = (tag: string): number => level.get(tag) ?? level.set(tag, Math.max(-1, ...parents.get(tag)!.map(levelOf)) + 1).get(tag)!;
  const children = new Map(tags.map(tag => [tag, [] as string[]])), roots: string[] = [];
  for (const tag of tags) {
    const above = parents.get(tag)!;
    if (above.length) children.get(above.reduce((a, b) => levelOf(b) > levelOf(a) ? b : a))!.push(tag);
    else roots.push(tag);
  }
  // Each root tree is laid out on its own, in sibling and level steps.
  const local = new Map<string, { x: number; y: number }>();
  const trees = roots.map(root => {
    const members: string[] = [];
    let leaves = 0, depth = 0;
    const place = (tag: string, y: number): number => {
      const xs = children.get(tag)!.map(child => place(child, y + 1));
      const x = xs.length ? (xs[0] + xs.at(-1)!) / 2 : leaves++;
      local.set(tag, { x, y }); members.push(tag); depth = Math.max(depth, y);
      return x;
    };
    place(root, 0);
    return { members, width: (leaves - 1) * SIBLING, height: depth * LEVEL };
  });
  // Try every row count and keep the arrangement whose shape is closest to a screen (turned, for a tree on its side).
  const total = trees.reduce((sum, tree) => sum + tree.width + GAP, 0);
  const arrange = (limit: number) => {
    const at: { x: number; y: number }[] = [];
    let x = 0, y = 0, rowHeight = 0, width = 0;
    for (const tree of trees) {
      if (x > 0 && x + tree.width > limit) { y += rowHeight + LEVEL; x = 0; rowHeight = 0; }
      at.push({ x, y });
      width = Math.max(width, x + tree.width); x += tree.width + GAP; rowHeight = Math.max(rowHeight, tree.height);
    }
    return { at, misfit: Math.abs(Math.log((width + GAP) / (y + rowHeight + LEVEL) / (horizontal ? 1 / SCREEN : SCREEN))) };
  };
  let best = arrange(total);
  for (let rows = 2; rows <= trees.length; rows++) {
    const next = arrange(total / rows);
    if (next.misfit < best.misfit) best = next;
  }
  const positions = new Map<string, { x: number; y: number }>();
  trees.forEach((tree, i) => {
    for (const tag of tree.members) {
      const p = local.get(tag)!, across = best.at[i].x + p.x * SIBLING, down = best.at[i].y + p.y * LEVEL;
      positions.set(tag, horizontal ? { x: down, y: across } : { x: across, y: down });
    }
  });
  return positions;
}

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
