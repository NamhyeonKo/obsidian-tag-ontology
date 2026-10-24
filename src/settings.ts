export interface Settings {
  dictionaryPath: string; layout: 'force' | 'tree' | 'radial';
  expanded: string[]; showNotes: boolean; showRelated: boolean;
  // With customColors on, every tag node in the graph takes tagColor; with it off the plugin leaves colors alone.
  customColors: boolean; tagColor: string;
}
export const DEFAULT_SETTINGS: Settings = {
  dictionaryPath: 'Tag-Dictionary.json', layout: 'force', expanded: [], showNotes: true, showRelated: true,
  // Obsidian's default accent color.
  customColors: false, tagColor: '#8b6cef',
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
  const flag = (key: 'showNotes' | 'showRelated' | 'customColors') => typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key];
  const hex = (key: 'tagColor') => typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key]) ? value[key] : DEFAULT_SETTINGS[key];
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath, configDir)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    layout: value.layout === 'tree' || value.layout === 'radial' ? value.layout : 'force',
    expanded: Array.isArray(value.expanded) ? [...new Set(value.expanded.filter((tag): tag is string => typeof tag === 'string'))] : [],
    showNotes: flag('showNotes'), showRelated: flag('showRelated'),
    customColors: flag('customColors'), tagColor: hex('tagColor'),
  };
}
