import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, isValidDictionaryPath, sanitizeSettings } from '../src/settings.ts';

test('sanitizes saved settings to the supported fields', () => {
  assert.deepEqual(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'a', 3, 'b'],
    showNotes: false, showRelated: 'x', notes: ['private'] }, '.obsidian'), {
    dictionaryPath: '03_Resources/tags.json', layout: 'tree', expanded: ['a', 'b'], showNotes: false, showRelated: true,
  });
  for (const raw of [null, [], 'text', { dictionaryPath: '../tags.json', layout: 'invalid', expanded: 'cs' }]) {
    assert.deepEqual(sanitizeSettings(raw, '.obsidian'), DEFAULT_SETTINGS);
  }
  assert.deepEqual(sanitizeSettings({ layout: 'radial' }, '.obsidian'), { ...DEFAULT_SETTINGS, layout: 'radial' });
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
