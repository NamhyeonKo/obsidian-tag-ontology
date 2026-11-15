import { PALETTE_PRESETS, paletteFor, samePalette } from './colors.ts';
import { isPaletteName, type Settings } from './settings.ts';

export function paletteSelection(settings: Settings): string {
  return settings.hierarchyPalettePreset || Object.keys(PALETTE_PRESETS).find(key =>
    samePalette(settings.hierarchyPalette, paletteFor(PALETTE_PRESETS[key], settings.hierarchyPalette.length))) || 'custom';
}

export function paletteGroups(settings: Settings): { label: string; options: { value: string; label: string }[] }[] {
  return [
    { label: 'Examples', options: Object.entries(PALETTE_PRESETS).map(([value, preset]) => ({ value, label: preset.name })) },
    { label: 'Working copy', options: settings.customHierarchyPalette.length || paletteSelection(settings) === 'custom'
      ? [{ value: 'custom', label: 'Working copy' + (settings.workingPaletteSource ? ' · ' + settings.workingPaletteSource : '') }] : [] },
    { label: 'My palettes', options: settings.savedHierarchyPalettes.map(palette => ({ value: 'saved:' + palette.name, label: palette.name })) },
  ];
}

export function fillPaletteSelect(select: HTMLSelectElement, settings: Settings): void {
  select.empty();
  for (const group of paletteGroups(settings)) {
    if (!group.options.length) continue;
    const el = select.createEl('optgroup', { attr: { label: group.label } });
    for (const option of group.options) el.createEl('option', { text: option.label, value: option.value });
  }
  select.value = paletteSelection(settings);
}

export function choosePalette(settings: Settings, key: string): Pick<Settings, 'hierarchyPalette' | 'hierarchyPalettePreset'> | undefined {
  const preset = Object.hasOwn(PALETTE_PRESETS, key) ? PALETTE_PRESETS[key] : undefined;
  const saved = settings.savedHierarchyPalettes.find(palette => 'saved:' + palette.name === key);
  const colors = preset ? paletteFor(preset, settings.hierarchyPalette.length) : saved?.colors
    ?? (key === 'custom' ? settings.customHierarchyPalette.length ? settings.customHierarchyPalette : settings.hierarchyPalette : undefined);
  return colors ? { hierarchyPalette: [...colors], hierarchyPalettePreset: key } : undefined;
}

export function resizePalette(settings: Settings, delta: 1 | -1): ReturnType<typeof editPalette> | ReturnType<typeof choosePalette> {
  const count = settings.hierarchyPalette.length + delta;
  if (count < 1) return;
  const key = paletteSelection(settings);
  if (Object.hasOwn(PALETTE_PRESETS, key)) return { hierarchyPalette: paletteFor(PALETTE_PRESETS[key], count), hierarchyPalettePreset: key };
  return editPalette(settings, delta > 0 ? [...settings.hierarchyPalette, settings.hierarchyPalette.at(-1)!] : settings.hierarchyPalette.slice(0, -1));
}

export function editPalette(settings: Settings, colors: readonly string[]): Pick<Settings, 'hierarchyPalette' | 'hierarchyPalettePreset' | 'customHierarchyPalette' | 'workingPaletteSource'> {
  const key = paletteSelection(settings);
  return { hierarchyPalette: [...colors], hierarchyPalettePreset: 'custom', customHierarchyPalette: [...colors],
    workingPaletteSource: key === 'custom' ? settings.workingPaletteSource : PALETTE_PRESETS[key]?.name
      ?? settings.savedHierarchyPalettes.find(palette => 'saved:' + palette.name === key)?.name ?? 'Palette' };
}

export function savePalette(settings: Settings, input: string): Pick<Settings, 'savedHierarchyPalettes' | 'hierarchyPalettePreset' | 'customHierarchyPalette' | 'workingPaletteSource'> {
  if (!isPaletteName(input)) throw new Error('Enter a palette name of 1–80 characters, without line breaks.');
  const name = input.trim();
  if (settings.savedHierarchyPalettes.some(palette => palette.name.toLowerCase() === name.toLowerCase())) throw new Error('A palette with this name already exists. Choose another name.');
  const working = paletteSelection(settings) === 'custom';
  return { savedHierarchyPalettes: [...settings.savedHierarchyPalettes, { name, colors: [...settings.hierarchyPalette] }],
    hierarchyPalettePreset: 'saved:' + name, customHierarchyPalette: working ? [] : [...settings.customHierarchyPalette],
    workingPaletteSource: working ? '' : settings.workingPaletteSource };
}
