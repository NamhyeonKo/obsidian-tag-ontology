export interface Settings {
  dictionaryPath: string; layout: 'force' | 'tree' | 'tree-horizontal';
  expanded: string[]; showNotes: boolean; showRelated: boolean;
  // With customColors on, every tag node in the graph and every tag in the sidebar takes tagColor, or Obsidian's accent color
  // while it is empty; with it off the plugin leaves colors alone.
  customColors: boolean; tagColor: string;
  // With customColors on, the selected tag's title in the sidebar takes the tag color too.
  titleAccent: boolean;
  // With focus on, the selected tag and the tags next to it stay bright and the rest fades; the focus flags add every tag below
  // it and the notes on the selected tag (and on its descendants, with those on).
  focus: boolean; focusDescendants: boolean; focusNotes: boolean;
  // Which graph the ribbon icon and Open graph open: the core graph with the hierarchy layered on, or the 3D view.
  view: '2d' | '3d';
  // 3D labels: with perspective they grow as the camera comes closer, between 12 and 24 px times labelSize; without, they
  // stay 12 px times labelSize.
  perspectiveLabels: boolean; labelSize: number;
}
export const LABEL_SIZE = { min: 0.5, max: 2, step: 0.1 };
export const DEFAULT_SETTINGS: Settings = {
  dictionaryPath: 'Tag-Dictionary.json', layout: 'force', expanded: [], showNotes: true, showRelated: true,
  customColors: false, tagColor: '', titleAccent: true, focus: false, focusDescendants: true, focusNotes: true, view: '2d',
  perspectiveLabels: true, labelSize: 0.8,
};
export function isValidDictionaryPath(path: string, configDir: string): boolean {
  const parts = path.split('/');
  return path.endsWith('.json') && ![...path].some((c) => c === '\\' || c === ':' || c.charCodeAt(0) < 0x20)
    && !parts.some((part) => part === '' || part === '.' || part === '..')
    && !path.startsWith(`${configDir}/`) && parts[0] !== '.git';
}

export function sanitizeSettings(raw: unknown, configDir: string): Settings {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const flag = (key: 'showNotes' | 'showRelated' | 'customColors' | 'titleAccent' | 'focus' | 'focusDescendants' | 'focusNotes' | 'perspectiveLabels') => typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  // Up to 0.7.6 the tag color started as Obsidian's default accent, #8b6cef, so in a file from then (every one has highlightColor,
  // which came in the same release) that value follows the accent now. Picked later, the same color stays.
  const legacy = Object.hasOwn(value, 'highlightColor') && value.tagColor === '#8b6cef';
  const tagColor = typeof value.tagColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.tagColor) && !legacy ? value.tagColor : '';
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath, configDir)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    // Radial was removed in 0.6.0; it opens as the vertical tree.
    layout: value.layout === 'tree' || value.layout === 'tree-horizontal' ? value.layout : value.layout === 'radial' ? 'tree' : 'force',
    expanded: Array.isArray(value.expanded) ? [...new Set(value.expanded.filter((tag): tag is string => typeof tag === 'string'))] : [],
    showNotes: flag('showNotes'), showRelated: flag('showRelated'),
    customColors: flag('customColors'), tagColor, titleAccent: flag('titleAccent'), focus: flag('focus'),
    focusDescendants: flag('focusDescendants'), focusNotes: flag('focusNotes'),
    view: value.view === '3d' ? '3d' : '2d',
    perspectiveLabels: flag('perspectiveLabels'),
    labelSize: typeof value.labelSize === 'number' && value.labelSize >= LABEL_SIZE.min && value.labelSize <= LABEL_SIZE.max ? value.labelSize : DEFAULT_SETTINGS.labelSize,
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
