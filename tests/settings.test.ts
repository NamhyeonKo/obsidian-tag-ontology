import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATIC_DICTIONARIES, DEFAULT_SETTINGS, LEGACY_DICTIONARY, TOW_DICTIONARY, TOW_FOLDER_DICTIONARY, cssColorToHex, isHiddenPath, isValidDictionaryPath, sanitizeSettings } from '../src/settings.ts';

test('defaults to tow/ and treats only the legacy root default as unchosen', () => {
  assert.equal(DEFAULT_SETTINGS.dictionaryPath, 'tow/tag-dictionary.json');
  assert.equal(LEGACY_DICTIONARY, 'Tag-Dictionary.json');
  assert.deepEqual(AUTOMATIC_DICTIONARIES, ['tow/tag-dictionary.json', '.tow/tag-dictionary.json', 'Tag-Dictionary.json']);
  assert.equal(TOW_FOLDER_DICTIONARY, 'tow/tag-dictionary.json');
  assert.equal(TOW_DICTIONARY, '.tow/tag-dictionary.json');
  assert.equal(sanitizeSettings({}, '.obsidian').dictionaryPathExplicit, false);
  // Settings from before 0.10.0 have no flag: only the old default counts as unchosen.
  assert.equal(sanitizeSettings({ dictionaryPath: 'Tag-Dictionary.json' }, '.obsidian').dictionaryPathExplicit, false);
  assert.equal(sanitizeSettings({ dictionaryPath: 'tow/tag-dictionary.json' }, '.obsidian').dictionaryPathExplicit, true);
  assert.equal(sanitizeSettings({ dictionaryPath: 'custom.json', dictionaryPathExplicit: true }, '.obsidian').dictionaryPathExplicit, true);
  assert.equal(sanitizeSettings({ locationNoticeShown: true }, '.obsidian').locationNoticeShown, true);
  assert.equal(sanitizeSettings({ locationNoticeShown: 'yes' }, '.obsidian').locationNoticeShown, false);
});

test('sanitizes saved settings to the supported fields', () => {
  assert.deepEqual(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'a', 3, 'b'],
    showNotes: false, showRelated: 'x', notes: ['private'] }, '.obsidian'), {
    dictionaryPath: '03_Resources/tags.json', dictionaryPathExplicit: true, layout: 'tree', expanded: ['a', 'b'], showNotes: false, showRelated: true,
    customColors: false, tagColor: '', titleAccent: true, focus: false, focusDescendants: true, focusNotes: true, enable3d: true,
    perspectiveLabels: true, labelSize: 0.8, locationNoticeShown: false, kebabNames: false,
  });
  // 0.7.6 highlight settings are gone; a file that still has them loads without them.
  assert.deepEqual(sanitizeSettings({ highlightColor: '#000000', highlightSelected: false, highlightDescendants: true, highlightConnected: 'yes' }, '.obsidian'), DEFAULT_SETTINGS);
  assert.equal(sanitizeSettings({}, '.obsidian').dictionaryPathExplicit, false);
  assert.equal(sanitizeSettings({ dictionaryPathExplicit: true }, '.obsidian').dictionaryPathExplicit, true);
  assert.equal(sanitizeSettings({ dictionaryPathExplicit: 'yes' }, '.obsidian').dictionaryPathExplicit, false);
  assert.equal(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json' }, '.obsidian').dictionaryPathExplicit, true);
  assert.equal(sanitizeSettings({ dictionaryPath: 'Tag-Dictionary.json' }, '.obsidian').dictionaryPathExplicit, false);
  assert.equal(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json', dictionaryPathExplicit: false }, '.obsidian').dictionaryPathExplicit, false);
  assert.equal(sanitizeSettings({ titleAccent: false }, '.obsidian').titleAccent, false);
  assert.equal(sanitizeSettings({ focus: true }, '.obsidian').focus, true);
  assert.deepEqual(sanitizeSettings({ focusDescendants: false, focusNotes: 'x', focusAncestors: true }, '.obsidian'), { ...DEFAULT_SETTINGS, focusDescendants: false });
  assert.deepEqual(sanitizeSettings({ customColors: true, tagColor: '#12AB3c' }, '.obsidian'), { ...DEFAULT_SETTINGS, customColors: true, tagColor: '#12AB3c' });
  // An empty tag color follows the accent color. In a file from 0.7.6 or earlier (the ones with highlightColor), the old default is
  // what everyone who never picked a color has saved, so it follows too; picked now, the same color stays.
  assert.equal(DEFAULT_SETTINGS.tagColor, '');
  assert.equal(sanitizeSettings({ tagColor: '#8b6cef', highlightColor: '#6d47eb' }, '.obsidian').tagColor, '');
  assert.equal(sanitizeSettings({ tagColor: '#8b6cef' }, '.obsidian').tagColor, '#8b6cef');
  assert.equal(sanitizeSettings({ tagColor: 'red' }, '.obsidian').tagColor, '');
  for (const raw of [null, [], 'text', { dictionaryPath: '../tags.json', layout: 'invalid', expanded: 'cs' }]) {
    assert.deepEqual(sanitizeSettings(raw, '.obsidian'), DEFAULT_SETTINGS);
  }
  assert.equal(sanitizeSettings({ layout: 'radial' }, '.obsidian').layout, 'tree', 'Radial is gone; it opens as the vertical tree');
  assert.equal(sanitizeSettings({ layout: 'tree-horizontal' }, '.obsidian').layout, 'tree-horizontal');
});

test('detects a hidden path segment', () => {
  for (const path of ['.tow/tags.json', 'folder/.private/tags.json']) assert.equal(isHiddenPath(path), true, path);
  for (const path of ['tags.json', 'folder/tags.json']) assert.equal(isHiddenPath(path), false, path);
});

test('rejects dictionary paths outside the allowed vault scope', () => {
  for (const path of ['Tag-Dictionary.json', '03_Resources/tags.json', '00_Inbox/tags.json']) {
    assert.equal(isValidDictionaryPath(path, '.obsidian'), true, path);
  }
  for (const path of [
    '', '/tmp/tags.json', '../tags.json', '03_Resources/../tags.json', './tags.json',
    '.obsidian/tags.json', 'Tag-Dictionary.md',
    '03_Resources//tags.json', 'C:\\tags.json', 'tags.json\n',
  ]) assert.equal(isValidDictionaryPath(path, '.obsidian'), false, path);
});

test('rejects paths inside a custom config folder', () => {
  assert.equal(isValidDictionaryPath('.config/tags.json', '.config'), false);
  assert.equal(isValidDictionaryPath('.obsidian/tags.json', '.config'), true);
  assert.equal(isValidDictionaryPath('.configs/tags.json', '.config'), true);
});

test('reads the CSS colors a theme gives back as hex', () => {
  assert.equal(cssColorToHex('rgb(138, 92, 245)'), '#8a5cf5');
  assert.equal(cssColorToHex('rgba(1, 2, 3, 0.5)'), '#010203');
  assert.equal(cssColorToHex('#ABCDEF'), '#abcdef');
  // Obsidian's --color-accent holds an hsl() expression: its default accent, as the browser shows it.
  assert.equal(cssColorToHex('hsl(258, 88%, 66%)'), '#8a5cf5');
  assert.equal(cssColorToHex(' hsl(0, 100%, 50%) '), '#ff0000');
  for (const css of ['', 'red', 'color-mix(in srgb, red, blue)']) assert.equal(cssColorToHex(css), undefined, css);
});

test('the 3D view is on by default and only a saved false turns it off', () => {
  assert.equal(DEFAULT_SETTINGS.enable3d, true);
  assert.equal(sanitizeSettings({ enable3d: false }, '.obsidian').enable3d, false);
  for (const enable3d of ['no', 0, undefined]) assert.equal(sanitizeSettings({ enable3d }, '.obsidian').enable3d, true);
  // Up to 0.8.2 a Layout setting picked which graph the ribbon opened; it opens the 2D graph now, so the key is dropped.
  assert.equal(Object.hasOwn(sanitizeSettings({ view: '3d' }, '.obsidian'), 'view'), false);
});

test('kebab-case names are off by default and only a saved true turns them on', () => {
  assert.equal(DEFAULT_SETTINGS.kebabNames, false);
  assert.equal(sanitizeSettings({ kebabNames: true }, '.obsidian').kebabNames, true);
  for (const kebabNames of ['yes', 1, undefined]) assert.equal(sanitizeSettings({ kebabNames }, '.obsidian').kebabNames, false);
});

test('label settings default to perspective on and size 0.8, and keep only valid values', () => {
  assert.equal(DEFAULT_SETTINGS.perspectiveLabels, true); assert.equal(DEFAULT_SETTINGS.labelSize, 0.8);
  const kept = sanitizeSettings({ labelSize: 1.5, perspectiveLabels: false }, '.obsidian');
  assert.equal(kept.labelSize, 1.5); assert.equal(kept.perspectiveLabels, false);
  for (const labelSize of [3, 0.2, 'big', Number.NaN]) assert.equal(sanitizeSettings({ labelSize }, '.obsidian').labelSize, 0.8);
  assert.equal(sanitizeSettings({ perspectiveLabels: 'no' }, '.obsidian').perspectiveLabels, true);
});
