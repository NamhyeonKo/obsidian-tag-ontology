import type { Settings } from './settings.ts';
import { fillPaletteSelect } from './palettes.ts';

interface LegendActions { color(depth: number, color: string): void; choose(key: string): void; save(): void }
const rendered = new WeakMap<HTMLElement, string>();

export function renderDepthLegend(el: HTMLElement, settings: Settings, actions: LegendActions): void {
  const state = JSON.stringify([settings.customColors, settings.hierarchyColors, settings.hierarchyPalette,
    settings.hierarchyPalettePreset, settings.customHierarchyPalette, settings.workingPaletteSource, settings.savedHierarchyPalettes]);
  if (rendered.get(el) === state) return;
  // Metadata refreshes must not replace a focused palette control.
  rendered.delete(el);
  el.empty();
  el.hidden = !settings.customColors || !settings.hierarchyColors;
  if (el.hidden) { rendered.set(el, state); return; }
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Hierarchy depth colors');
  el.setAttribute('aria-description', `Root is level 0. Level ${settings.hierarchyPalette.length - 1} and deeper use the last color.`);
  const select = el.createEl('select', { cls: 'dropdown tag-ontology-legend-palette', attr: { 'aria-label': 'Graph palette' } });
  fillPaletteSelect(select, settings);
  select.addEventListener('change', () => actions.choose(select.value));
  el.createDiv({ cls: 'tag-ontology-legend-title', text: 'Depth' });
  const list = el.createEl('ul', { cls: 'tag-ontology-legend-levels' });
  settings.hierarchyPalette.forEach((color, depth) => {
    const last = depth === settings.hierarchyPalette.length - 1;
    const label = depth === 0 ? 'Root · 0' : `Level ${depth}`;
    const row = list.createEl('li', { attr: { 'aria-label': label + (last ? ' and deeper' : '') } });
    const swatch = row.createEl('label', { cls: 'tag-ontology-legend-swatch' });
    swatch.setCssProps({ '--legend-color': color });
    const picker = swatch.createEl('input', { cls: 'tag-ontology-legend-picker', attr: { type: 'color', 'aria-label': `Change ${label.toLowerCase()} color`, title: `Change ${label.toLowerCase()} color` } });
    picker.value = color;
    picker.addEventListener('change', () => actions.color(depth, picker.value));
    row.createSpan({ text: String(depth) + (last ? '+' : '') });
  });
  const save = el.createEl('button', { cls: 'tag-ontology-legend-save', text: 'Save as…', attr: { type: 'button', 'aria-label': 'Save palette as…' } });
  save.addEventListener('click', () => actions.save());
  rendered.set(el, state);
}
