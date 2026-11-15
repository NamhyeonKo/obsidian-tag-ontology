import type { Ontology } from 'tag-ontology';

export const PALETTE = ['#4ea1ff', '#f0a33c', '#e5484d', '#30a46c', '#a67cf0', '#14b8a6', '#e879a6', '#a3a33a'];
export const PALETTE_PRESETS: Record<string, { name: string; colors: string[]; gradient?: boolean }> = {
  default: { name: 'Default', colors: PALETTE },
  pastel: { name: 'Pastel', colors: ['#93c5fd', '#fdba74', '#fda4af', '#86efac', '#c4b5fd', '#5eead4', '#f9a8d4', '#d9f99d'] },
  'blue-gradient': { name: 'Blue gradient', colors: ['#b8d7fa', '#21589a'], gradient: true },
  'purple-gradient': { name: 'Purple gradient', colors: ['#d9c2f5', '#6635a3'], gradient: true },
  warm: { name: 'Warm', colors: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#a3a33a', '#b7791f', '#d97790', '#a8557a'] },
};
export function paletteFor(preset: { colors: readonly string[]; gradient?: boolean }, count: number): string[] {
  if (!preset.gradient) return Array.from({ length: count }, (_, i) => preset.colors[i % preset.colors.length]);
  const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const start = channels(preset.colors[0]), end = channels(preset.colors[1]);
  return Array.from({ length: count }, (_, i) => {
    const fraction = count === 1 ? 0 : i / (count - 1);
    return '#' + start.map((channel, c) => Math.round(channel + (end[c] - channel) * fraction).toString(16).padStart(2, '0')).join('');
  });
}

const depths = new WeakMap<Ontology, Map<string, number>>();

export function hierarchyColor(model: Ontology, tag: string, palette: readonly string[] = PALETTE): string | undefined {
  let levels = depths.get(model);
  if (!levels) {
    levels = new Map(model.roots.map(root => [root, 0]));
    // The full dictionary's parents-first order keeps colors independent of filters and collapsed branches.
    for (const name of model.order) {
      for (const parent of model.entries.get(name)!.broader ?? []) {
        const above = levels.get(parent);
        if (above !== undefined) levels.set(name, Math.max(levels.get(name) ?? 0, above + 1));
      }
    }
    depths.set(model, levels);
  }
  const depth = levels.get(tag);
  const colors = palette.length ? palette : PALETTE;
  return depth === undefined ? undefined : colors[Math.min(depth, colors.length - 1)];
}
