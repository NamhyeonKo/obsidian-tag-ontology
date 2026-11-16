import type { Settings } from './settings.ts';
import { Menu, setIcon, setTooltip } from 'obsidian';
import { paletteGroups, paletteSelection } from './palettes.ts';

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
  const groups = paletteGroups(settings), selected = paletteSelection(settings);
  const name = groups.flatMap(group => group.options).find(option => option.value === selected)?.label ?? 'Palette';
  const palette = el.createEl('button', { cls: 'clickable-icon tag-ontology-legend-action tag-ontology-legend-palette',
    attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
  setIcon(palette, 'palette');
  setTooltip(palette, `Palette: ${name}${selected === 'custom' ? ' · unsaved' : ''}`, { placement: 'top' });
  palette.addEventListener('click', () => {
    const menu = new Menu();
    for (const group of groups) {
      if (!group.options.length) continue;
      menu.addItem(item => item.setTitle(group.label).setIsLabel(true));
      for (const option of group.options) menu.addItem(item => item.setTitle(option.label).setChecked(option.value === selected).onClick(() => actions.choose(option.value)));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Save a copy…').setIcon('copy').onClick(() => actions.save()));
    menu.onHide(() => palette.setAttribute('aria-expanded', 'false'));
    palette.setAttribute('aria-expanded', 'true');
    const rect = palette.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom, width: rect.width, overlap: true }, palette.doc);
  });
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
  if (selected === 'custom') {
    const save = el.createEl('button', { cls: 'clickable-icon tag-ontology-legend-action tag-ontology-legend-save', attr: { type: 'button' } });
    setIcon(save, 'bookmark-plus');
    setTooltip(save, 'Save palette as…', { placement: 'top' });
    save.addEventListener('click', () => actions.save());
  }
  rendered.set(el, state);
}
