// Parents are centered over their children; all root trees share the full dictionary's depth axis.
// A tag with several visible parents hangs under the deepest one (first on a tie), with links to its other parents drawn.
// ponytail: leaves never share a column; add contour packing if shallow subtrees beside deep ones waste width.
// Upright, siblings sit a label apart (Obsidian labels are about 90–130 wide) and levels leave room for the label under
// each dot; on its side, siblings only need a label's height and levels a label's width.
const SPACING = { upright: { sibling: 120, level: 160 }, sideways: { sibling: 40, level: 260 } };
// Tags the hierarchy can't place (`outside`, such as ones missing from the dictionary) sit in a small grid of label-sized
// cells in the tree's bottom-right corner.
const CELL = { x: 120, y: 60 }, CORNER_GAP = 240;
export function treePositions(tags: string[], edges: [parent: string, child: string][], depths: ReadonlyMap<string, number>, horizontal = false, outside: string[] = []) {
  const { sibling: SIBLING, level: LEVEL } = horizontal ? SPACING.sideways : SPACING.upright, GAP = 2 * SIBLING;
  const parents = new Map(tags.map(tag => [tag, [] as string[]]));
  for (const [parent, child] of edges) parents.get(child)?.push(parent);
  const children = new Map(tags.map(tag => [tag, [] as string[]])), roots: string[] = [];
  for (const tag of tags) {
    const above = parents.get(tag)!;
    if (above.length) children.get(above.reduce((a, b) => depths.get(b)! > depths.get(a)! ? b : a))!.push(tag);
    else roots.push(tag);
  }
  // Leaves get separate columns; depth comes from the full dictionary even when an intermediate parent is hidden.
  const local = new Map<string, { x: number; y: number }>();
  const trees = roots.map(root => {
    const members: string[] = [], next = [root];
    let leaves = 0;
    while (next.length) {
      const tag = next.pop()!, y = depths.get(tag)!, kids = children.get(tag)!;
      members.push(tag);
      if (!kids.length) local.set(tag, { x: leaves++, y });
      for (let k = kids.length - 1; k >= 0; k--) { next.push(kids[k]); }
    }
    for (let i = members.length - 1; i >= 0; i--) {
      const kids = children.get(members[i])!, first = kids.length ? local.get(kids[0])! : undefined;
      if (first) local.set(members[i], { x: (first.x + local.get(kids[kids.length - 1])!.x) / 2, y: depths.get(members[i])! });
    }
    return { members, width: (leaves - 1) * SIBLING };
  });
  const positions = new Map<string, { x: number; y: number }>();
  let offset = 0;
  for (const tree of trees) {
    for (const tag of tree.members) {
      const p = local.get(tag)!, across = offset + p.x * SIBLING, down = p.y * LEVEL;
      positions.set(tag, horizontal ? { x: down, y: across } : { x: across, y: down });
    }
    offset += tree.width + GAP;
  }
  const xs = [...positions.values()].map(p => p.x), ys = [...positions.values()].map(p => p.y);
  const left = xs.length ? Math.max(...xs) + CORNER_GAP : 0, bottom = ys.length ? Math.max(...ys) : 0;
  const columns = Math.ceil(Math.sqrt(outside.length)), rows = Math.ceil(outside.length / columns);
  outside.forEach((id, i) => positions.set(id, { x: left + (i % columns) * CELL.x, y: bottom - (rows - 1 - Math.floor(i / columns)) * CELL.y }));
  return positions;
}
