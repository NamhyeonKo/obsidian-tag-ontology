import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, isValidDictionaryPath, sanitizeSettings } from '../src/settings.ts';

test('sanitizes saved settings to the two supported fields', () => {
  assert.deepEqual(sanitizeSettings({ dictionaryPath: '03_Resources/tags.json', layout: 'tree', notes: ['private'] }), {
    dictionaryPath: '03_Resources/tags.json', layout: 'tree',
  });
  for (const raw of [null, [], 'text', { dictionaryPath: '../tags.json', layout: 'invalid' }]) {
    assert.deepEqual(sanitizeSettings(raw), { dictionaryPath: 'Tag-Dictionary.json', layout: 'force' });
  }
  assert.deepEqual(sanitizeSettings({ layout: 'radial' }), { ...DEFAULT_SETTINGS, layout: 'radial' });
});

test('rejects dictionary paths outside the allowed vault scope', () => {
  for (const path of ['Tag-Dictionary.json', '03_Resources/tags.json', '00_Inbox/tags.json']) {
    assert.equal(isValidDictionaryPath(path), true, path);
  }
  for (const path of [
    '', '/tmp/tags.json', '../tags.json', '03_Resources/../tags.json', './tags.json',
    '.obsidian/tags.json', 'Tag-Dictionary.md',
    '03_Resources//tags.json', 'C:\\tags.json', 'tags.json\n',
  ]) assert.equal(isValidDictionaryPath(path), false, path);
});
