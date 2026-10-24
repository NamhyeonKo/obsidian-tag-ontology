// Tidy tree for the tag hierarchy. A tag's level is one below its deepest parent, so within its root tree it sits below
// every parent; it hangs under that parent (the first one given on a tie) and links to its other parents are only drawn.
// Leaves sit side by side, each parent is centered over its children, and root trees wrap into rows to roughly fit a screen,
// so a link to a parent in another root tree can point up from a lower row.
// ponytail: leaves never share a column (no Reingold–Tilford contour packing); add it if shallow subtrees beside deep ones waste width.
// Upright, siblings sit a label apart (Obsidian labels are about 90–130 wide) and levels leave room for the label under
// each dot; on its side, siblings only need a label's height and levels a label's width.
const SPACING = { upright: { sibling: 120, level: 160 }, sideways: { sibling: 40, level: 260 } }, SCREEN = 1.6;
// Tags the hierarchy can't place (`outside`, such as ones missing from the dictionary) sit in a small grid of label-sized
// cells in the tree's bottom-right corner.
const CELL = { x: 120, y: 60 }, CORNER_GAP = 240;
export function treePositions(tags: string[], edges: [parent: string, child: string][], horizontal = false, outside: string[] = []) {
  const { sibling: SIBLING, level: LEVEL } = horizontal ? SPACING.sideways : SPACING.upright, GAP = 2 * SIBLING;
  const parents = new Map(tags.map(tag => [tag, [] as string[]]));
  for (const [parent, child] of edges) parents.get(child)?.push(parent);
  // A tag's level is one below its deepest parent. It is only needed to pick the parent of a tag with several, and is
  // worked out on demand from an explicit stack rather than by recursion, so any depth works; the dictionary rejects
  // broader cycles, so the stack empties.
  const level = new Map<string, number>(), stack: string[] = [];
  const levelOf = (tag: string) => {
    if (!level.has(tag)) stack.push(tag);
    while (stack.length) {
      const top = stack[stack.length - 1];
      let deepest = -1, waiting = false;
      for (const parent of parents.get(top)!) {
        const above = level.get(parent);
        if (above === undefined) { stack.push(parent); waiting = true; } else deepest = Math.max(deepest, above);
      }
      if (!waiting) { level.set(top, deepest + 1); stack.pop(); }
    }
    return level.get(tag)!;
  };
  const children = new Map(tags.map(tag => [tag, [] as string[]])), roots: string[] = [];
  for (const tag of tags) {
    const above = parents.get(tag)!;
    if (above.length) children.get(above.reduce((a, b) => levelOf(b) > levelOf(a) ? b : a))!.push(tag);
    else roots.push(tag);
  }
  // Each root tree is laid out on its own, in sibling and level steps: leaves are numbered left to right in depth-first
  // order, then every parent, deepest first, is centered over its children. Hanging under its deepest parent, a tag's
  // depth in its tree is its level.
  const local = new Map<string, { x: number; y: number }>();
  const trees = roots.map(root => {
    const members: string[] = [], levels: number[] = [], next = [root], nextLevels = [0];
    let leaves = 0, depth = 0;
    while (next.length) {
      const tag = next.pop()!, y = nextLevels.pop()!, kids = children.get(tag)!;
      members.push(tag); levels.push(y); depth = Math.max(depth, y);
      if (!kids.length) local.set(tag, { x: leaves++, y });
      for (let k = kids.length - 1; k >= 0; k--) { next.push(kids[k]); nextLevels.push(y + 1); }
    }
    for (let i = members.length - 1; i >= 0; i--) {
      const kids = children.get(members[i])!;
      if (kids.length) local.set(members[i], { x: (local.get(kids[0])!.x + local.get(kids[kids.length - 1])!.x) / 2, y: levels[i] });
    }
    return { members, width: (leaves - 1) * SIBLING, height: depth * LEVEL };
  });
  // Add rows until the shape stops getting closer to a screen (turned, for a tree on its side): more rows only ever make
  // the drawing narrower and taller, so the first step away is the best one.
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
    if (next.misfit > best.misfit) break;
    if (next.misfit < best.misfit) best = next;
  }
  const positions = new Map<string, { x: number; y: number }>();
  trees.forEach((tree, i) => {
    for (const tag of tree.members) {
      const p = local.get(tag)!, across = best.at[i].x + p.x * SIBLING, down = best.at[i].y + p.y * LEVEL;
      positions.set(tag, horizontal ? { x: down, y: across } : { x: across, y: down });
    }
  });
  const xs = [...positions.values()].map(p => p.x), ys = [...positions.values()].map(p => p.y);
  const left = xs.length ? Math.max(...xs) + CORNER_GAP : 0, bottom = ys.length ? Math.max(...ys) : 0;
  const columns = Math.ceil(Math.sqrt(outside.length)), rows = Math.ceil(outside.length / columns);
  outside.forEach((id, i) => positions.set(id, { x: left + (i % columns) * CELL.x, y: bottom - (rows - 1 - Math.floor(i / columns)) * CELL.y }));
  return positions;
}
