import type { Ontology } from 'tag-ontology';
import { hierarchyDepths } from './hierarchy.ts';

export const PALETTE = ['#4ea1ff', '#f0a33c', '#e5484d', '#30a46c', '#a67cf0', '#14b8a6', '#e879a6', '#a3a33a'];
export const PALETTE_PRESETS: Record<string, { name: string; colors: string[]; gradient?: boolean }> = {
  default: { name: 'Default', colors: PALETTE },
  pastel: { name: 'Pastel', colors: ['#93c5fd', '#fdba74', '#fda4af', '#86efac', '#c4b5fd', '#5eead4', '#f9a8d4', '#d9f99d'] },
  'blue-gradient': { name: 'Blue gradient', colors: ['#b8d7fa', '#21589a'], gradient: true },
  'purple-gradient': { name: 'Purple gradient', colors: ['#d9c2f5', '#6635a3'], gradient: true },
  warm: { name: 'Warm', colors: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#a3a33a', '#b7791f', '#d97790', '#a8557a'] },
  rainbow: { name: 'Rainbow', colors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#6366f1', '#a855f7'], gradient: true },
};
export function paletteFor(preset: { colors: readonly string[]; gradient?: boolean }, count: number): string[] {
  if (!preset.gradient) return Array.from({ length: count }, (_, i) => preset.colors[i % preset.colors.length]);
  const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const stops = preset.colors.map(channels);
  return Array.from({ length: count }, (_, i) => {
    const position = count === 1 ? 0 : i / (count - 1) * (stops.length - 1);
    const index = Math.min(Math.floor(position), stops.length - 2), fraction = position - index;
    const start = stops[index], end = stops[index + 1];
    return '#' + start.map((channel, c) => Math.round(channel + (end[c] - channel) * fraction).toString(16).padStart(2, '0')).join('');
  });
}

export function hierarchyColor(model: Ontology, tag: string, palette: readonly string[] = PALETTE): string | undefined {
  const depth = hierarchyDepths(model).get(tag);
  const colors = palette.length ? palette : PALETTE;
  return depth === undefined ? undefined : colors[Math.min(depth, colors.length - 1)];
}
