export interface Settings { dictionaryPath: string; layout: 'force' | 'tree' | 'radial' }
export const DEFAULT_SETTINGS: Settings = { dictionaryPath: 'Tag-Dictionary.json', layout: 'force' };
export function isValidDictionaryPath(path: string, configDir: string): boolean {
  const parts = path.split('/');
  return path.endsWith('.json') && ![...path].some((c) => c === '\\' || c === ':' || c.charCodeAt(0) < 0x20)
    && !parts.some((part) => part === '' || part === '.' || part === '..')
    && !path.startsWith(`${configDir}/`) && parts[0] !== '.git';
}

export function sanitizeSettings(raw: unknown, configDir: string): Settings {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  return {
    dictionaryPath: typeof value.dictionaryPath === 'string' && isValidDictionaryPath(value.dictionaryPath, configDir)
      ? value.dictionaryPath : DEFAULT_SETTINGS.dictionaryPath,
    layout: value.layout === 'tree' || value.layout === 'radial' ? value.layout : 'force',
  };
}
