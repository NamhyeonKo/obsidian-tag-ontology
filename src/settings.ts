import { DICTIONARY_LOCATIONS } from 'tag-ontology';
import { PALETTE, PALETTE_PRESETS, paletteFor, samePalette } from './colors.ts';
import { isSupportedLocale } from './i18n/index.ts';
import type { LanguageSetting } from './i18n/types.ts';

export interface SavedPalette { name: string; colors: string[] }

export interface Settings {
  dictionaryPath: string; dictionaryPathExplicit: boolean; layout: 'force' | 'tree' | 'tree-horizontal' | 'mindmap';
  expanded: string[]; showNotes: boolean; showRelated: boolean;
  // Custom colors use the hierarchy palette when enabled, otherwise tagColor (or the theme accent).
  customColors: boolean; hierarchyColors: boolean; hierarchyPalette: string[]; customHierarchyPalette: string[]; hierarchyPalettePreset: string; tagColor: string;
  savedHierarchyPalettes: SavedPalette[]; workingPaletteSource: string;
  // With customColors on, the selected tag's title in the sidebar takes the tag color too.
  titleAccent: boolean;
  // How the sidebar shows lists of tags: wrapped chips or one tag per line.
  tagListStyle: 'chips' | 'list';
  // With focus on, the selected tag and the tags next to it stay bright and the rest fades; the focus flags add every tag below
  // it and the notes on the selected tag (and on its descendants, with those on).
  focus: boolean; focusDescendants: boolean; focusNotes: boolean;
  // Enables the 3D mode button and command; modes share a graph tab by default.
  enable3d: boolean;
  // Enables the ontology explorer mode button and command.
  enableExplorer: boolean;
  // Enable the vertical and horizontal tree mode buttons; a graph in a turned-off tree goes back to force.
  enableTree: boolean; enableTreeHorizontal: boolean;
  // With kebabNames on, the edit form accepts a new or renamed tag only as lowercase letters and digits joined by hyphens,
  // the rule TOW checks with --names kebab. Existing names are kept.
  kebabNames: boolean;
  // 3D labels: with perspective they grow as the camera comes closer, between 12 and 24 px times labelSize; without, they
  // stay 12 px times labelSize.
  perspectiveLabels: boolean; labelSize: number; locationNoticeShown: boolean;
  // 3D forces, in the units and ranges of the 2D graph's Forces sliders; the 3D view scales them to its own space.
  forces3d: Forces;
  // When on, dragging a 3D node keeps the simulation active so linked nodes follow; when off, only the grabbed node moves.
  dragTension3d: boolean;
  // Active UI language ('auto' follows Obsidian's configured language).
  language: LanguageSetting;
  // 3D gear panel Filters & Display settings (stored separately from Obsidian's 2D graph.json).
  filters3d: Filters3D;
  display3d: Display3D;
}
export interface Filters3D { search: string; attachments: boolean; existingOnly: boolean; orphans: boolean }
export interface Display3D { arrows: boolean; textFadeThreshold: number; nodeSize: number; linkThickness: number }
export interface Forces { center: number; repel: number; link: number; distance: number }
export const LABEL_SIZE = { min: 0.5, max: 2, step: 0.1 };
export const TEXT_FADE = { min: -3, max: 3, step: 0.1, value: 0 } as const;
export const NODE_SIZE = { min: 0.1, max: 5, step: 0.1, value: 0.8 } as const;
export const LINK_THICKNESS = { min: 0.1, max: 5, step: 0.1, value: 0.8 } as const;
export const FORCES: Record<keyof Forces, { name: string; min: number; max: number; step: number; value: number }> = {
  center: { name: 'Center force', min: 0, max: 1, step: 0.01, value: 0.52 },
  repel: { name: 'Repel force', min: 0, max: 20, step: 0.1, value: 10 },
  link: { name: 'Link force', min: 0, max: 1, step: 0.01, value: 1 },
  distance: { name: 'Link distance', min: 30, max: 500, step: 1, value: 250 },
};
export const TOW_FOLDER_DICTIONARY = DICTIONARY_LOCATIONS[0];
export const TOW_DICTIONARY = DICTIONARY_LOCATIONS[1];
export const LEGACY_DICTIONARY = DICTIONARY_LOCATIONS[2];
export const AUTOMATIC_DICTIONARIES: readonly string[] = DICTIONARY_LOCATIONS;
export function isHiddenPath(path: string): boolean {
  return path.split('/').some(segment => segment.startsWith('.'));
}
export const DEFAULT_SETTINGS: Settings = {
  dictionaryPath: TOW_FOLDER_DICTIONARY, dictionaryPathExplicit: false, layout: 'force', expanded: [], showNotes: true, showRelated: true,
  customColors: false, hierarchyColors: false, hierarchyPalette: [...PALETTE], customHierarchyPalette: [], hierarchyPalettePreset: '', tagColor: '', titleAccent: true, tagListStyle: 'chips', focus: false, focusDescendants: true, focusNotes: true, enable3d: true,
  savedHierarchyPalettes: [], workingPaletteSource: '',
  perspectiveLabels: true, labelSize: 0.8, locationNoticeShown: false, kebabNames: false, enableExplorer: true, enableTree: true, enableTreeHorizontal: true,
  forces3d: { center: FORCES.center.value, repel: FORCES.repel.value, link: FORCES.link.value, distance: FORCES.distance.value },
  dragTension3d: true,
  language: 'auto',
  filters3d: { search: '', attachments: false, existingOnly: true, orphans: true },
  display3d: { arrows: false, textFadeThreshold: TEXT_FADE.value, nodeSize: NODE_SIZE.value, linkThickness: LINK_THICKNESS.value },
};

export function isValidDictionaryPath(path: string, configDir: string): boolean {
  const parts = path.split('/');
  return path.endsWith('.json') && ![...path].some((c) => c === '\\' || c === ':' || c.charCodeAt(0) < 0x20)
    && !parts.some((part) => part === '' || part === '.' || part === '..')
    && !path.startsWith(`${configDir}/`) && parts[0] !== '.git';
}

function paletteOr(value: unknown, fallback: readonly string[]): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [];
  const colors = [...values];
  return colors.length > 0 && colors.every((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) ? colors : [...fallback];
}

export function isPaletteName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80 && [...value].every(char => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f);
}

const recordOf = (raw: unknown): Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};

const numberIn = (n: unknown, { min, max }: { min: number; max: number }, fallback: number): number =>
  typeof n === 'number' && n >= min && n <= max ? n : fallback;

function forces(raw: unknown): Forces {
  const value = recordOf(raw);
  const out = { ...DEFAULT_SETTINGS.forces3d };
  for (const key of Object.keys(FORCES) as (keyof Forces)[]) {
    out[key] = numberIn(value[key], FORCES[key], out[key]);
  }
  return out;
}

function sanitizeFilters3d(raw: unknown): Filters3D {
  const value = recordOf(raw), defaults = DEFAULT_SETTINGS.filters3d;
  return {
    search: typeof value.search === 'string' ? value.search.slice(0, 500) : defaults.search,
    attachments: typeof value.attachments === 'boolean' ? value.attachments : defaults.attachments,
    existingOnly: typeof value.existingOnly === 'boolean' ? value.existingOnly : defaults.existingOnly,
    orphans: typeof value.orphans === 'boolean' ? value.orphans : defaults.orphans,
  };
}

function sanitizeDisplay3d(raw: unknown): Display3D {
  const value = recordOf(raw), defaults = DEFAULT_SETTINGS.display3d;
  return {
    arrows: typeof value.arrows === 'boolean' ? value.arrows : defaults.arrows,
    textFadeThreshold: numberIn(value.textFadeThreshold, TEXT_FADE, defaults.textFadeThreshold),
    nodeSize: numberIn(value.nodeSize, NODE_SIZE, defaults.nodeSize),
    linkThickness: numberIn(value.linkThickness, LINK_THICKNESS, defaults.linkThickness),
  };
}

export function sanitizeSettings(raw: unknown, configDir: string): Settings {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const flag = (key: 'showNotes' | 'showRelated' | 'customColors' | 'hierarchyColors' | 'titleAccent' | 'focus' | 'focusDescendants' | 'focusNotes' | 'enable3d' | 'enableExplorer' | 'enableTree' | 'enableTreeHorizontal' | 'perspectiveLabels' | 'kebabNames' | 'dragTension3d') => typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  // Up to 0.7.6 the tag color started as Obsidian's default accent, #8b6cef, so in a file from then (every one has highlightColor,
  // which came in the same release) that value follows the accent now. Picked later, the same color stays.
  const legacy = Object.hasOwn(value, 'highlightColor') && value.tagColor === '#8b6cef';
  const tagColor = typeof value.tagColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.tagColor) && !legacy ? value.tagColor : '';
  const savedHierarchyPalettes: SavedPalette[] = [];
  const names = new Set<string>();
  if (Array.isArray(value.savedHierarchyPalettes)) for (const entry of value.savedHierarchyPalettes as unknown[]) {
    if (!entry || typeof entry !== 'object' || !('name' in entry) || !('colors' in entry) || !isPaletteName(entry.name)) continue;
    const name = entry.name.trim(), colors = paletteOr(entry.colors, []), key = name.toLowerCase();
    if (!colors.length || names.has(key)) continue;
    names.add(key); savedHierarchyPalettes.push({ name, colors });
  }
  let customHierarchyPalette = paletteOr(value.customHierarchyPalette, []);
  // Keep the old Custom slot before an old Default/Pastel becomes a working copy.
  if (!Object.hasOwn(value, 'savedHierarchyPalettes') && customHierarchyPalette.length) savedHierarchyPalettes.push({ name: 'My colors', colors: [...customHierarchyPalette] });
  let hierarchyPalettePreset = typeof value.hierarchyPalettePreset === 'string' && (value.hierarchyPalettePreset === 'custom'
    || Object.hasOwn(PALETTE_PRESETS, value.hierarchyPalettePreset) || savedHierarchyPalettes.some(palette => 'saved:' + palette.name === value.hierarchyPalettePreset)) ? value.hierarchyPalettePreset : '';
  const supplied = paletteOr(value.hierarchyPalette, []);
  const preset = PALETTE_PRESETS[hierarchyPalettePreset];
  const hierarchyPalette = supplied.length ? supplied : preset ? paletteFor(preset, PALETTE.length) : [...PALETTE];
  let workingPaletteSource = isPaletteName(value.workingPaletteSource) ? value.workingPaletteSource.trim() : '';
  const snapshot = savedHierarchyPalettes.find(palette => 'saved:' + palette.name === hierarchyPalettePreset);
  const expected = preset ? paletteFor(preset, hierarchyPalette.length) : snapshot?.colors;
  if ((expected && !samePalette(hierarchyPalette, expected)) || (!hierarchyPalettePreset && supplied.length
    && !Object.values(PALETTE_PRESETS).some(example => samePalette(hierarchyPalette, paletteFor(example, hierarchyPalette.length))))) {
    workingPaletteSource = preset?.name ?? snapshot?.name ?? 'Previous colors';
    hierarchyPalettePreset = 'custom'; customHierarchyPalette = [...hierarchyPalette];
  }
  if (hierarchyPalettePreset === 'custom') customHierarchyPalette = [...hierarchyPalette];
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath, configDir)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    dictionaryPathExplicit: typeof value.dictionaryPathExplicit === 'boolean' ? value.dictionaryPathExplicit
      : !Object.hasOwn(value, 'dictionaryPathExplicit') && typeof value.dictionaryPath === 'string' && value.dictionaryPath !== LEGACY_DICTIONARY
        && isValidDictionaryPath(value.dictionaryPath, configDir),
    // Radial was removed in 0.6.0; it opens as the vertical tree. A turned-off tree opens as force.
    layout: value.layout === 'tree' && flag('enableTree') || value.layout === 'tree-horizontal' && flag('enableTreeHorizontal') || value.layout === 'mindmap' ? value.layout
      : value.layout === 'radial' && flag('enableTree') ? 'tree' : 'force',
    expanded: Array.isArray(value.expanded) ? [...new Set(value.expanded.filter((tag): tag is string => typeof tag === 'string'))] : [],
    showNotes: flag('showNotes'), showRelated: flag('showRelated'),
    customColors: flag('customColors'), hierarchyColors: flag('hierarchyColors'),
    hierarchyPalette, customHierarchyPalette, hierarchyPalettePreset, savedHierarchyPalettes, workingPaletteSource,
    tagColor, titleAccent: flag('titleAccent'), focus: flag('focus'),
    tagListStyle: value.tagListStyle === 'list' ? 'list' : 'chips',
    focusDescendants: flag('focusDescendants'), focusNotes: flag('focusNotes'),
    enable3d: flag('enable3d'),
    enableExplorer: flag('enableExplorer'), enableTree: flag('enableTree'), enableTreeHorizontal: flag('enableTreeHorizontal'),
    kebabNames: flag('kebabNames'),
    perspectiveLabels: flag('perspectiveLabels'),
    labelSize: numberIn(value.labelSize, LABEL_SIZE, DEFAULT_SETTINGS.labelSize),
    locationNoticeShown: typeof value.locationNoticeShown === 'boolean' ? value.locationNoticeShown : DEFAULT_SETTINGS.locationNoticeShown,
    forces3d: forces(value.forces3d),
    dragTension3d: flag('dragTension3d'),
    language: value.language === 'auto' || isSupportedLocale(value.language) ? value.language : DEFAULT_SETTINGS.language,
    filters3d: sanitizeFilters3d(value.filters3d),
    display3d: sanitizeDisplay3d(value.display3d),
  };
}

// A theme color variable as hex: Obsidian's --color-accent holds hsl(), and themes may set hex or rgb() instead.
export function cssColorToHex(css: string): string | undefined {
  const text = css.trim(), byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) return '#' + hex[1].toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(text);
  if (rgb) return '#' + rgb.slice(1, 4).map(n => byte(Number(n))).join('');
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/.exec(text);
  if (!hsl) return undefined;
  // CSS Color 4's hsl-to-rgb: f(0), f(8) and f(4) are red, green and blue.
  const h = Number(hsl[1]) % 360, s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100, a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return '#' + [0, 8, 4].map(n => byte(f(n) * 255)).join('');
}
