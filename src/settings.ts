export interface Settings {
  dictionaryPath: string; layout: 'force' | 'tree' | 'tree-horizontal' | 'radial';
  expanded: string[]; showNotes: boolean; showRelated: boolean;
  // With customColors on, every tag node in the graph takes tagColor and the highlighted ones (the selected tag,
  // its descendants, its directly connected tags, as switched on) take highlightColor; with it off the plugin leaves colors alone.
  customColors: boolean; tagColor: string; highlightColor: string;
  highlightSelected: boolean; highlightDescendants: boolean; highlightConnected: boolean;
  // With customColors on, the sidebar title of the selected tag takes highlightColor.
  titleAccent: boolean;
  // The selected tag looks hovered whenever nothing else is: it and its links stay bright and the rest fades.
  focus: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  dictionaryPath: 'Tag-Dictionary.json', layout: 'force', expanded: [], showNotes: true, showRelated: true,
  // Obsidian's default accent color, and a slightly darker one for highlights.
  customColors: false, tagColor: '#8b6cef', highlightColor: '#6d47eb',
  highlightSelected: true, highlightDescendants: false, highlightConnected: false, titleAccent: true, focus: false,
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
  const flag = (key: 'showNotes' | 'showRelated' | 'customColors' | 'highlightSelected' | 'highlightDescendants' | 'highlightConnected' | 'titleAccent' | 'focus') => typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  const hex = (key: 'tagColor' | 'highlightColor') => typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key]) ? value[key] : DEFAULT_SETTINGS[key];
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath, configDir)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    layout: value.layout === 'tree' || value.layout === 'tree-horizontal' || value.layout === 'radial' ? value.layout : 'force',
    expanded: Array.isArray(value.expanded) ? [...new Set(value.expanded.filter((tag): tag is string => typeof tag === 'string'))] : [],
    showNotes: flag('showNotes'), showRelated: flag('showRelated'),
    customColors: flag('customColors'), tagColor: hex('tagColor'), highlightColor: hex('highlightColor'),
    highlightSelected: flag('highlightSelected'), highlightDescendants: flag('highlightDescendants'), highlightConnected: flag('highlightConnected'),
    titleAccent: flag('titleAccent'), focus: flag('focus'),
  };
}
