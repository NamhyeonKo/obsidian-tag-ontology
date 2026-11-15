import type { Ontology } from 'tag-ontology';

const depths = new WeakMap<Ontology, Map<string, number>>();

export function hierarchyDepths(model: Ontology): ReadonlyMap<string, number> {
  let levels = depths.get(model);
  if (!levels) {
    levels = new Map(model.roots.map(root => [root, 0]));
    // The full dictionary's parents-first order keeps depth independent of filters and collapsed branches.
    for (const name of model.order) {
      for (const parent of model.entries.get(name)!.broader ?? []) {
        const above = levels.get(parent);
        if (above !== undefined) levels.set(name, Math.max(levels.get(name) ?? 0, above + 1));
      }
    }
    depths.set(model, levels);
  }
  return levels;
}
