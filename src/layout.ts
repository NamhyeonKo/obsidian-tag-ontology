// Tidy tree for the tag hierarchy. A tag's level is one below its deepest parent, so within its root tree it sits below
// every parent; it hangs under that parent (the first one given on a tie) and links to its other parents are only drawn.
// Leaves sit side by side, each parent is centered over its children, and root trees wrap into rows to roughly fit a screen,
// so a link to a parent in another root tree can point up from a lower row.
// ponytail: leaves never share a column (no Reingold–Tilford contour packing); add it if shallow subtrees beside deep ones waste width.
// ponytail: recursive, so a chain of a couple of thousand levels overflows the stack; tag dictionaries are a few levels deep.
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
  return positions;
}
