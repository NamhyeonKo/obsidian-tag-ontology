import type { Settings } from './settings.ts';

export function renderDepthLegend(el: HTMLElement, settings: Pick<Settings, 'customColors' | 'hierarchyColors' | 'hierarchyPalette'>, changeColor: (depth: number, color: string) => void): void {
  el.empty();
  el.hidden = !settings.customColors || !settings.hierarchyColors;
  if (el.hidden) return;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Hierarchy depth colors');
  el.setAttribute('aria-description', `Root is level 0. Level ${settings.hierarchyPalette.length - 1} and deeper use the last color.`);
  el.createDiv({ cls: 'tag-ontology-legend-title', text: 'Depth' });
  const list = el.createEl('ul', { cls: 'tag-ontology-legend-levels' });
  settings.hierarchyPalette.forEach((color, depth) => {
    const last = depth === settings.hierarchyPalette.length - 1;
    const label = depth === 0 ? 'Root · 0' : `Level ${depth}`;
    const row = list.createEl('li', { attr: { 'aria-label': label + (last ? ' and deeper' : '') } });
    const swatch = row.createEl('input', { cls: 'tag-ontology-legend-swatch', attr: { type: 'color', 'aria-label': `Change ${label.toLowerCase()} color`, title: `Change ${label.toLowerCase()} color` } });
    swatch.value = color;
    swatch.addEventListener('change', () => changeColor(depth, swatch.value));
    swatch.setCssProps({ '--legend-color': color });
    row.createSpan({ text: String(depth) + (last ? '+' : '') });
  });
}
