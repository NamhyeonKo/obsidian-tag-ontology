import assert from 'node:assert/strict';
import test from 'node:test';
import { choosePalette, editPalette, paletteGroups, paletteSelection, savePalette } from '../src/palettes.ts';
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
