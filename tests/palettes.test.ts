import assert from 'node:assert/strict';
import test from 'node:test';
import { PaletteValidationError, choosePalette, deletePalette, editPalette, paletteGroups, paletteSelection, savePalette } from '../src/palettes.ts';
import { setLocale } from '../src/i18n/index.ts';
import { sanitizeSettings } from '../src/settings.ts';
import { PALETTE, PALETTE_PRESETS, paletteFor } from '../src/colors.ts';

test('a working copy survives example selection, named save and a settings restart', () => {
  let settings = sanitizeSettings({}, '.obsidian');
  settings = { ...settings, ...editPalette(settings, ['#123456', '#abcdef']) };
  assert.equal(paletteSelection(settings), 'custom');
  settings = { ...settings, ...choosePalette(settings, 'pastel') };
  settings = sanitizeSettings(JSON.parse(JSON.stringify(settings)), '.obsidian');
  assert.deepEqual(settings.customHierarchyPalette, ['#123456', '#abcdef']);
  settings = { ...settings, ...choosePalette(settings, 'custom') };
  settings = { ...settings, ...savePalette(settings, ' Study ') };
  assert.equal(paletteSelection(settings), 'saved:Study');
  assert.deepEqual(settings.savedHierarchyPalettes, [{ name: 'Study', colors: ['#123456', '#abcdef'] }]);
  assert.deepEqual(settings.customHierarchyPalette, []);
  settings = { ...settings, ...editPalette(settings, ['#654321']) };
  assert.deepEqual(settings.savedHierarchyPalettes[0].colors, ['#123456', '#abcdef']);
  settings = { ...settings, ...choosePalette(settings, 'saved:Study') };
  assert.deepEqual(settings.hierarchyPalette, ['#123456', '#abcdef']);
  assert.deepEqual(settings.customHierarchyPalette, ['#654321']);
  assert.equal(settings.workingPaletteSource, 'Study');
});

test('saving a different example does not discard another working copy', () => {
  let settings = sanitizeSettings({}, '.obsidian');
  settings = { ...settings, ...editPalette(settings, ['#123456']) };
  settings = { ...settings, ...choosePalette(settings, 'rainbow') };
  settings = { ...settings, ...savePalette(settings, 'Rainbow snapshot') };
  assert.deepEqual(settings.customHierarchyPalette, ['#123456']);
  assert.equal(choosePalette(settings, 'missing'), undefined);
  assert.equal(choosePalette(settings, 'constructor'), undefined);
  assert.equal(choosePalette(settings, 'saved:missing'), undefined);
});

test('saved names are validated and never overwrite an existing palette', () => {
  const initial = sanitizeSettings({}, '.obsidian');
  const settings = { ...initial, ...savePalette(initial, '研究: "Blue"') };
  for (const name of ['', '  ', 'x'.repeat(81), 'bad\nname', '研究: "blue"']) {
    assert.throws(() => savePalette(settings, name));
  }
  assert.deepEqual(initial.savedHierarchyPalettes, []);
  assert.notEqual(settings.savedHierarchyPalettes[0].colors, initial.hierarchyPalette);
  assert.ok(paletteGroups(settings).some(group => group.options.some(option => option.value === 'saved:研究: "Blue"')));
});

test('deleting named palettes preserves the working copy and safely replaces the active palette', () => {
  let settings = sanitizeSettings({}, '.obsidian');
  settings = { ...settings, ...savePalette(settings, 'Study') };
  settings = { ...settings, ...editPalette(settings, ['#123456']) };
  const working = [...settings.customHierarchyPalette];
  settings = { ...settings, ...choosePalette(settings, 'saved:Study') };
  const count = settings.hierarchyPalette.length;
  const deleted = { ...settings, ...deletePalette(settings, 'Study') };
  assert.deepEqual(deleted.savedHierarchyPalettes, []);
  assert.equal(paletteSelection(deleted), 'default'); assert.equal(deleted.hierarchyPalette.length, count);
  assert.deepEqual(deleted.customHierarchyPalette, working);
  assert.equal(settings.savedHierarchyPalettes.length, 1, 'pure deletion does not mutate its input');
  assert.equal(deletePalette(settings, 'missing'), undefined);
  const inactive = { ...settings, ...choosePalette(settings, 'pastel') };
  assert.equal(paletteSelection({ ...inactive, ...deletePalette(inactive, 'Study') }), 'pastel');
});

test('migration retains previous active colors and the previous Custom slot independently', () => {
  const previous = ['#4ea1ff', '#f0a33c', '#e5484d', '#30a46c', '#a67cf0', '#14b8a6', '#e879a6', '#a3a33a'];
  const settings = sanitizeSettings({ hierarchyPalette: previous, hierarchyPalettePreset: 'default', customHierarchyPalette: ['#123456'] }, '.obsidian');
  assert.deepEqual(settings.hierarchyPalette, previous);
  assert.equal(paletteSelection(settings), 'custom');
  assert.deepEqual(settings.customHierarchyPalette, previous);
  assert.deepEqual(settings.savedHierarchyPalettes, [{ name: 'My colors', colors: ['#123456'] }]);
  assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(settings)), '.obsidian'), settings);
});

test('palette library validation rejects malformed snapshots without sharing mutable arrays', () => {
  const raw = [{ name: 'Ocean', colors: ['#123456'] }, { name: 'ocean', colors: ['#abcdef'] },
    { name: 'bad', colors: ['red'] }, { name: '', colors: ['#123456'] }, { name: '__proto__', colors: ['#abcdef'] }];
  const settings = sanitizeSettings({ savedHierarchyPalettes: raw }, '.obsidian');
  assert.deepEqual(settings.savedHierarchyPalettes.map(palette => palette.name), ['Ocean', '__proto__']);
  assert.notEqual(settings.savedHierarchyPalettes[0].colors, raw[0].colors);
  assert.deepEqual(choosePalette(settings, 'saved:__proto__')?.hierarchyPalette, ['#abcdef']);
});

test('Default and Pastel follow the approved official hue order and resample without cycling', () => {
  assert.deepEqual(PALETTE, ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']);
  assert.deepEqual(PALETTE_PRESETS.pastel.colors, ['#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#fbcfe8']);
  for (const key of ['default', 'pastel']) {
    const preset = PALETTE_PRESETS[key], expanded = paletteFor(preset, 12);
    assert.equal(expanded[0], preset.colors[0]);
    assert.equal(expanded.at(-1), preset.colors.at(-1));
    assert.notEqual(expanded[8], expanded[0]);
  }
});

test('palette validation exposes machine-readable error codes and paletteGroups localizes labels while keeping keys', () => {
  const initial = sanitizeSettings({}, '.obsidian');
  assert.throws(() => savePalette(initial, '   '), (error: unknown) => error instanceof PaletteValidationError && error.code === 'invalid-name');
  const saved = { ...initial, ...savePalette(initial, 'My Custom') };
  assert.throws(() => savePalette(saved, 'my custom'), (error: unknown) => error instanceof PaletteValidationError && error.code === 'duplicate-name');

  const edited = { ...saved, ...editPalette(saved, ['#123456']) };
  try {
    setLocale('ko');
    const groups = paletteGroups(edited);
    assert.equal(groups[0]?.label, '예시 팔레트');
    assert.equal(groups[0]?.options[0]?.value, 'default');
    assert.equal(groups[0]?.options[0]?.label, '기본값');
    assert.equal(groups[1]?.options[0]?.value, 'custom');
    assert.match(groups[1]!.options[0]!.label, /^작업 사본/);
    assert.equal(groups[2]?.options[0]?.value, 'saved:My Custom');
    assert.equal(groups[2]?.options[0]?.label, 'My Custom');
  } finally {
    setLocale('en');
  }
});
