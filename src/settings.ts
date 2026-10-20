export interface Settings { dictionaryPath: string; layout: 'force' | 'tree' | 'radial' }
export const DEFAULT_SETTINGS: Settings = { dictionaryPath: 'Tag-Dictionary.json', layout: 'force' };
export function isValidDictionaryPath(path: string): boolean {
  const parts = path.split('/');
  return path.endsWith('.json') && !/[\\\x00-\x1f:]/.test(path)
    && !parts.some((part) => part === '' || part === '.' || part === '..')
    && parts[0] !== '.obsidian' && parts[0] !== '.git';
}

export function sanitizeSettings(raw: unknown): Settings {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    layout: value.layout === 'tree' || value.layout === 'radial' ? value.layout : 'force',
  };
}
