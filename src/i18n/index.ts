import { SUPPORTED_LOCALES, type LanguageSetting, type SupportedLocale } from './types.ts';
import en, { type Messages, type PluralMessageKey, type StringMessageKey } from './locales/en.ts';
import ko from './locales/ko.ts';
import ja from './locales/ja.ts';
import zh from './locales/zh.ts';
import zhTW from './locales/zh-TW.ts';
import es from './locales/es.ts';
import fr from './locales/fr.ts';
import de from './locales/de.ts';
import ptBR from './locales/pt-BR.ts';
import ru from './locales/ru.ts';
import it from './locales/it.ts';

export const CATALOGS: Record<SupportedLocale, Messages> = {
  en,
  ko,
  ja,
  zh,
  'zh-TW': zhTW,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  ru,
  it,
};

let currentLocale: SupportedLocale = 'en';
const pluralRules = new Map<SupportedLocale, Intl.PluralRules>();
const relativeFormats = new Map<SupportedLocale, Intl.RelativeTimeFormat>();

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(setting: LanguageSetting, appLanguage?: string): SupportedLocale {
  if (setting !== 'auto') return setting;
  const raw = (appLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
  if (!raw) return 'en';
  if (raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-mo' || raw.startsWith('zh-hant')) return 'zh-TW';
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-sg' || raw.startsWith('zh-hans') || raw.startsWith('zh-')) return 'zh';
  if (raw === 'pt' || raw.startsWith('pt-')) return 'pt-BR';
  const base = raw.split('-')[0];
  if (isSupportedLocale(base)) return base;
  return 'en';
}

export function setLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(vars, key) ? String(vars[key]) : match));
}

export function t(key: StringMessageKey, vars?: Record<string, string | number>): string {
  const value = CATALOGS[currentLocale][key];
  return interpolate(value, vars);
}

export function tPlural(key: PluralMessageKey, count: number, vars?: Record<string, string | number>): string {
  const forms = CATALOGS[currentLocale][key];
  let rules = pluralRules.get(currentLocale);
  if (!rules) pluralRules.set(currentLocale, rules = new Intl.PluralRules(currentLocale));
  const category = rules.select(count);
  const template = (category !== 'zero' && category !== 'two' ? forms[category] : undefined) ?? forms.other;
  return interpolate(template, { count, ...vars });
}

export function formatRelativeTime(mtime: number, now: number, locale: SupportedLocale = currentLocale): string {
  const days = Math.floor((now - mtime) / 864e5);
  if (days < 1) return CATALOGS[locale]['common.today'];
  let formatter = relativeFormats.get(locale);
  if (!formatter) relativeFormats.set(locale, formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' }));
  if (days < 30) return formatter.format(-days, 'day');
  if (days < 365) return formatter.format(-Math.floor(days / 30), 'month');
  return formatter.format(-Math.floor(days / 365), 'year');
}

const TAG_ERRORS: Record<string, StringMessageKey> = {
  'Enter a tag name.': 'sidebar.errEmptyName',
  'Tag names cannot contain spaces.': 'sidebar.errSpaces',
  'Use letters, numbers, _, - and / only.': 'sidebar.errInvalidChars',
  'A tag needs at least one character that is not a number.': 'sidebar.errDigitsOnly',
};

export function translateTagNameError(message: string): string {
  const key = Object.hasOwn(TAG_ERRORS, message) ? TAG_ERRORS[message] : undefined;
  if (key) return t(key);
  const duplicate = /^#(.+) is already in the dictionary\.$/.exec(message);
  return duplicate ? t('sidebar.errDuplicateTag', { tag: duplicate[1] }) : message;
}

const PRESET_NAMES: Record<string, StringMessageKey> = {
  Default: 'palettes.preset.default',
  Pastel: 'palettes.preset.pastel',
  'Blue gradient': 'palettes.preset.blueGradient',
  'Purple gradient': 'palettes.preset.purpleGradient',
  Warm: 'palettes.preset.warm',
  Rainbow: 'palettes.preset.rainbow',
  'Previous colors': 'palettes.previousColors',
  Palette: 'palettes.defaultName',
};

export function translatePaletteSource(source: string): string {
  if (!source) return '';
  const key = Object.hasOwn(PRESET_NAMES, source) ? PRESET_NAMES[source] : undefined;
  return key ? t(key) : source;
}
