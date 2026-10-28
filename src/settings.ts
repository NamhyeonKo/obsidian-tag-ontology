export interface Settings {
  dictionaryPath: string; layout: 'force' | 'tree' | 'tree-horizontal';
  expanded: string[]; showNotes: boolean; showRelated: boolean;
  // With customColors on, every tag node in the graph takes tagColor and the highlighted ones (the selected tag,
  // its descendants, its directly connected tags, as switched on) take highlightColor; with it off the plugin leaves colors alone.
  customColors: boolean; tagColor: string; highlightColor: string;
  highlightSelected: boolean; highlightDescendants: boolean; highlightConnected: boolean;
  // With customColors on, the sidebar title of the selected tag takes highlightColor.
  titleAccent: boolean;
  // With focus on, the selected tag and its related tags stay bright and the rest fades; the focus flags add its descendants,
  // its ancestors and the notes on all of those.
  focus: boolean; focusDescendants: boolean; focusAncestors: boolean; focusNotes: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  dictionaryPath: 'Tag-Dictionary.json', layout: 'force', expanded: [], showNotes: true, showRelated: true,
  // Obsidian's default accent color, and a slightly darker one for highlights.
  customColors: false, tagColor: '#8b6cef', highlightColor: '#6d47eb',
  highlightSelected: true, highlightDescendants: false, highlightConnected: false, titleAccent: true, focus: false,
  focusDescendants: true, focusAncestors: false, focusNotes: true,
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
  const flag = (key: 'showNotes' | 'showRelated' | 'customColors' | 'highlightSelected' | 'highlightDescendants' | 'highlightConnected' | 'titleAccent' | 'focus' | 'focusDescendants' | 'focusAncestors' | 'focusNotes') => typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  const hex = (key: 'tagColor' | 'highlightColor') => typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key]) ? value[key] : DEFAULT_SETTINGS[key];
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath, configDir)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    // Radial was removed in 0.6.0; it opens as the vertical tree.
    layout: value.layout === 'tree' || value.layout === 'tree-horizontal' ? value.layout : value.layout === 'radial' ? 'tree' : 'force',
    expanded: Array.isArray(value.expanded) ? [...new Set(value.expanded.filter((tag): tag is string => typeof tag === 'string'))] : [],
    showNotes: flag('showNotes'), showRelated: flag('showRelated'),
    customColors: flag('customColors'), tagColor: hex('tagColor'), highlightColor: hex('highlightColor'),
    highlightSelected: flag('highlightSelected'), highlightDescendants: flag('highlightDescendants'), highlightConnected: flag('highlightConnected'),
    titleAccent: flag('titleAccent'), focus: flag('focus'),
    focusDescendants: flag('focusDescendants'), focusAncestors: flag('focusAncestors'), focusNotes: flag('focusNotes'),
  };
}
