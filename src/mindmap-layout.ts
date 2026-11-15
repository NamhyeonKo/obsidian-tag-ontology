// Mind maps keep full dictionary depths; the regular trees use their original visible-tree layout.
export function mindmapPositions(tags: string[], edges: [string, string][], depths: ReadonlyMap<string, number>, outside: string[]) {
  const parents = new Map(tags.map(tag => [tag, [] as string[]]));
  for (const [parent, child] of edges) parents.get(child)?.push(parent);
  const children = new Map(tags.map(tag => [tag, [] as string[]])), roots: string[] = [];
  for (const tag of tags) {
    const above = parents.get(tag)!;
    if (above.length) children.get(above.reduce((a, b) => depths.get(b)! > depths.get(a)! ? b : a))!.push(tag);
    else roots.push(tag);
  }
  const positions = new Map<string, { x: number; y: number }>();
  let offset = 0;
  for (const root of roots) {
    const members: string[] = [], pending = [root];
    let leaves = 0;
    while (pending.length) {
      const tag = pending.pop()!, kids = children.get(tag)!;
      members.push(tag);
      if (!kids.length) positions.set(tag, { x: depths.get(tag)! * 260, y: offset + leaves++ * 40 });
      for (let i = kids.length - 1; i >= 0; i--) pending.push(kids[i]);
    }
    for (let i = members.length - 1; i >= 0; i--) {
      const kids = children.get(members[i])!;
      if (kids.length) positions.set(members[i], { x: depths.get(members[i])! * 260,
        y: (positions.get(kids[0])!.y + positions.get(kids[kids.length - 1])!.y) / 2 });
    }
    offset += (leaves + 1) * 40;
  }
  let right = 0, bottom = 0;
  for (const p of positions.values()) { right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  const columns = Math.ceil(Math.sqrt(outside.length));
  outside.forEach((id, i) => positions.set(id, { x: right + 260 + i % columns * 240, y: bottom + Math.floor(i / columns) * 48 }));
  return positions;
}
