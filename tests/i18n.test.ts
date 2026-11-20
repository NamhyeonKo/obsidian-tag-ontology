import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_LOCALES } from '../src/i18n/types.ts';
import {
  CATALOGS,
  formatRelativeTime,
  getLocale,
  isSupportedLocale,
  resolveLocale,
  setLocale,
  t,
  tPlural,
  translatePaletteSource,
  translateTagNameError,
} from '../src/i18n/index.ts';

test('resolves explicit and automatic Obsidian language codes with en fallback', () => {
  assert.equal(resolveLocale('ko', 'en'), 'ko');
  assert.equal(resolveLocale('auto', 'ko'), 'ko');
  assert.equal(resolveLocale('auto', 'zh-TW'), 'zh-TW');
  assert.equal(resolveLocale('auto', 'zh-tw'), 'zh-TW');
  assert.equal(resolveLocale('auto', 'zh-HK'), 'zh-TW');
  assert.equal(resolveLocale('auto', 'zh-MO'), 'zh-TW');
  assert.equal(resolveLocale('auto', 'zh-Hant'), 'zh-TW');
  assert.equal(resolveLocale('auto', 'zh'), 'zh');
  assert.equal(resolveLocale('auto', 'zh-CN'), 'zh');
  assert.equal(resolveLocale('auto', 'zh-SG'), 'zh');
  assert.equal(resolveLocale('auto', 'zh-Hans'), 'zh');
  assert.equal(resolveLocale('auto', 'pt'), 'pt-BR');
  assert.equal(resolveLocale('auto', 'pt-PT'), 'pt-BR');
  assert.equal(resolveLocale('auto', 'pt-BR'), 'pt-BR');
  assert.equal(resolveLocale('auto', 'en-GB'), 'en');
  assert.equal(resolveLocale('auto', 'es-MX'), 'es');
  assert.equal(resolveLocale('auto', 'fr-CA'), 'fr');
  assert.equal(resolveLocale('auto', 'de-AT'), 'de');
  assert.equal(resolveLocale('auto', 'ru-RU'), 'ru');
  assert.equal(resolveLocale('auto', 'it-CH'), 'it');
  assert.equal(resolveLocale('auto', 'ar'), 'en');
  assert.equal(resolveLocale('auto', 'sv'), 'en');
  assert.equal(resolveLocale('auto', ''), 'en');
  assert.equal(resolveLocale('auto', undefined), 'en');
  assert.equal(SUPPORTED_LOCALES.length, 11);
  assert.equal(isSupportedLocale('pt-BR'), true);
  assert.equal(isSupportedLocale('auto'), false);
});

test('formats English strings, plurals, relative time, and tag name validation errors', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('settings.general.language.name'), 'Language');
  assert.equal(
    t('notice.dictionaryNotFound', { path: 'tow/tag-dictionary.json' }),
    'Tag dictionary not found: tow/tag-dictionary.json',
  );
  assert.equal(tPlural('sidebar.unsavedChanges', 1), '1 change not saved');
  assert.equal(tPlural('sidebar.unsavedChanges', 3), '3 changes not saved');
  const now = Date.UTC(2026, 10, 19);
  assert.equal(formatRelativeTime(now - 1000, now, 'en'), 'today');
  assert.equal(formatRelativeTime(now - 864e5, now, 'en'), '1 day ago');
  assert.equal(formatRelativeTime(now - 3 * 864e5, now, 'en'), '3 days ago');
  assert.equal(translateTagNameError('Enter a tag name.'), 'Enter a tag name.');
  assert.equal(translateTagNameError('Tag names cannot contain spaces.'), 'Tag names cannot contain spaces.');
  assert.equal(translateTagNameError('Use letters, numbers, _, - and / only.'), 'Use letters, numbers, _, - and / only.');
  assert.equal(translateTagNameError('A tag needs at least one character that is not a number.'), 'A tag needs at least one character that is not a number.');
  assert.equal(translateTagNameError('#ML is already in the dictionary.'), '#ML is already in the dictionary.');
  assert.equal(translateTagNameError('Custom unexpected message'), 'Custom unexpected message');
});

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))].sort();
}

test('every locale matches English keys, has non-empty strings, and preserves all placeholders', () => {
  const base = CATALOGS.en;
  const baseKeys = Object.keys(base).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const dict = CATALOGS[locale];
    assert.deepEqual(Object.keys(dict).sort(), baseKeys, `${locale} key mismatch`);
    for (const key of baseKeys) {
      const expected = base[key as keyof typeof base];
      const actual = dict[key as keyof typeof dict];
      if (typeof expected === 'string') {
        assert.equal(typeof actual, 'string', `${locale}.${key} must be string`);
        assert.ok((actual as string).trim().length > 0, `${locale}.${key} must not be empty`);
        assert.deepEqual(placeholders(actual as string), placeholders(expected), `${locale}.${key} placeholders`);
      } else {
        assert.equal(typeof actual, 'object', `${locale}.${key} must be plural object`);
        const expectedVars = placeholders(expected.other);
        const pluralActual = actual as { one?: string; few?: string; many?: string; other: string };
        for (const form of ['one', 'few', 'many', 'other'] as const) {
          const text = pluralActual[form];
          if (text === undefined) continue;
          assert.ok(text.trim().length > 0, `${locale}.${key}.${form} must not be empty`);
          assert.deepEqual(placeholders(text), expectedVars, `${locale}.${key}.${form} placeholders`);
        }
        assert.ok(pluralActual.other, `${locale}.${key}.other required`);
      }
    }
  }
});

test('non-English locales provide distinct localized text, pluralization, and relative time', () => {
  try {
    setLocale('ru');
    const r1 = tPlural('sidebar.unregisteredSummary', 1, { tag: 'ai' });
    const r2 = tPlural('sidebar.unregisteredSummary', 2, { tag: 'ai' });
    const r5 = tPlural('sidebar.unregisteredSummary', 5, { tag: 'ai' });
    assert.notEqual(r1, r2);
    assert.notEqual(r2, r5);
    assert.notEqual(t('settings.general.language.name'), 'Language');

    const now = Date.UTC(2026, 10, 19);
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue;
      setLocale(locale);
      assert.notEqual(t('settings.dictionary.heading'), CATALOGS.en['settings.dictionary.heading'], `${locale} must translate heading`);
      assert.notEqual(formatRelativeTime(now, now, locale), 'today', `${locale} today should be localized`);
    }
    setLocale('ko');
    assert.equal(formatRelativeTime(now, now, 'ko'), '오늘');
    assert.equal(translatePaletteSource('Previous colors'), '이전 색상');
    assert.equal(translatePaletteSource('Palette'), '팔레트');
    assert.equal(translatePaletteSource('Default'), '기본값');
    assert.equal(translatePaletteSource('Study'), 'Study');

    setLocale('ru');
    assert.equal(tPlural('sidebar.unregisteredSummary', 11, { tag: 'ai' }), '#ai · 11 заметок');
    assert.equal(tPlural('sidebar.unregisteredSummary', 21, { tag: 'ai' }), '#ai · 21 заметка');
    assert.equal(tPlural('graph.countRoots', 1), '1 корень');
    assert.equal(tPlural('graph.countRoots', 2), '2 корня');
    assert.equal(tPlural('graph.countRoots', 5), '5 корней');
  } finally {
    setLocale('en');
  }
});
