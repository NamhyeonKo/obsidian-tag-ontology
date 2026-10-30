import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, cssColorToHex, isValidDictionaryPath, sanitizeSettings } from '../src/settings.ts';

test('sanitizes saved settings to the supported fields', () => {
  assert.deepEqual(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'a', 3, 'b'],
    showNotes: false, showRelated: 'x', notes: ['private'] }, '.obsidian'), {
    dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'b'], showNotes: false, showRelated: true,
    customColors: false, tagColor: '', titleAccent: true, focus: false, focusDescendants: true, focusNotes: true, view: '2d',
    perspectiveLabels: true, labelSize: 0.8,
  });
  // 0.7.6 highlight settings are gone; a file that still has them loads without them.
  assert.deepEqual(sanitizeSettings({ highlightColor: '#000000', highlightSelected: false, highlightDescendants: true, highlightConnected: 'yes' }, '.obsidian'), DEFAULT_SETTINGS);
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

test('view defaults to 2d and keeps only 2d or 3d', () => {
  assert.equal(DEFAULT_SETTINGS.view, '2d');
  assert.equal(sanitizeSettings({ view: '3d' }, '.obsidian').view, '3d');
  for (const view of ['4d', 3, undefined]) assert.equal(sanitizeSettings({ view }, '.obsidian').view, '2d');
});

test('label settings default to perspective on and size 0.8, and keep only valid values', () => {
  assert.equal(DEFAULT_SETTINGS.perspectiveLabels, true); assert.equal(DEFAULT_SETTINGS.labelSize, 0.8);
  const kept = sanitizeSettings({ labelSize: 1.5, perspectiveLabels: false }, '.obsidian');
  assert.equal(kept.labelSize, 1.5); assert.equal(kept.perspectiveLabels, false);
  for (const labelSize of [3, 0.2, 'big', Number.NaN]) assert.equal(sanitizeSettings({ labelSize }, '.obsidian').labelSize, 0.8);
  assert.equal(sanitizeSettings({ perspectiveLabels: 'no' }, '.obsidian').perspectiveLabels, true);
});
