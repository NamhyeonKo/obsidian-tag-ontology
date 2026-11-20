export const SUPPORTED_LOCALES = ['en', 'ko', 'ja', 'zh', 'zh-TW', 'es', 'fr', 'de', 'pt-BR', 'ru', 'it'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];
export type LanguageSetting = 'auto' | SupportedLocale;

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  it: 'Italiano',
};

export interface PluralForms {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}
