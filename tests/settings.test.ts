import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, isValidDictionaryPath, sanitizeSettings } from '../src/settings.ts';

test('sanitizes saved settings to the supported fields', () => {
  assert.deepEqual(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'a', 3, 'b'],
    showNotes: false, showRelated: 'x', notes: ['private'] }, '.obsidian'), {
    dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'b'], showNotes: false, showRelated: true,
    customColors: false, tagColor: '#8b6cef', highlightColor: '#6d47eb',
    highlightSelected: true, highlightDescendants: false, highlightConnected: false, titleAccent: true, focus: false,
    focusDescendants: true, focusAncestors: false, focusNotes: true,
  });
  assert.deepEqual(sanitizeSettings({ highlightColor: '#000000', highlightSelected: false, highlightConnected: 'yes' }, '.obsidian'),
    { ...DEFAULT_SETTINGS, highlightColor: '#000000', highlightSelected: false });
  assert.equal(sanitizeSettings({ titleAccent: false }, '.obsidian').titleAccent, false);
  assert.equal(sanitizeSettings({ focus: true }, '.obsidian').focus, true);
  assert.deepEqual(sanitizeSettings({ focusDescendants: false, focusAncestors: 'x' }, '.obsidian'), { ...DEFAULT_SETTINGS, focusDescendants: false });
  assert.deepEqual(sanitizeSettings({ customColors: true, tagColor: '#12AB3c' }, '.obsidian'), { ...DEFAULT_SETTINGS, customColors: true, tagColor: '#12AB3c' });
  assert.equal(sanitizeSettings({ tagColor: 'red' }, '.obsidian').tagColor, '#8b6cef');
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
