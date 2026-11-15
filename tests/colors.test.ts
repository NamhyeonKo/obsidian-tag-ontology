import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ontology } from 'tag-ontology';
import { hierarchyColor, PALETTE, PALETTE_PRESETS, paletteFor } from '../src/colors.ts';

test('hierarchy colors use the longest rooted path, independent of entry order and unrelated tags', () => {
  const model = new Ontology({
    leaf: { description: '', broader: ['short', 'middle'] },
    middle: { description: '', broader: ['long'] },
    short: { description: '', broader: [] },
    long: { description: '', broader: ['root'] },
    root: { description: '', broader: [] },
    loose: { description: '' },
  }, []);
  assert.equal(hierarchyColor(model, 'root'), PALETTE[0]);
  assert.equal(hierarchyColor(model, 'short'), PALETTE[0]);
  assert.equal(hierarchyColor(model, 'middle'), PALETTE[2]);
  assert.equal(hierarchyColor(model, 'leaf'), PALETTE[3]);
  assert.equal(hierarchyColor(model, 'loose'), undefined);
  assert.equal(hierarchyColor(model, 'unknown'), undefined);
});

test('deep hierarchies clamp to the final palette color without recursion and new dictionaries recalculate colors', () => {
  const raw = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`t${i}`, { description: '', broader: i ? [`t${i - 1}`] : [] }]));
  const model = new Ontology(raw, []);
  for (const depth of [7, 8, 9, 999]) assert.equal(hierarchyColor(model, `t${depth}`), PALETTE[7]);
  raw.t999.broader = [];
  assert.equal(hierarchyColor(new Ontology(raw, []), 't999'), PALETTE[0]);
});

test('custom palettes change colors without invalidating dictionary depth and keep the final color for deeper levels', () => {
  const model = new Ontology({ root: { description: '', broader: [] }, child: { description: '', broader: ['root'] }, grandchild: { description: '', broader: ['child'] } }, []);
  assert.equal(hierarchyColor(model, 'child'), PALETTE[1]);
  assert.equal(hierarchyColor(model, 'child', ['#111111', '#222222']), '#222222');
  assert.equal(hierarchyColor(model, 'grandchild', ['#111111', '#222222']), '#222222');
  assert.equal(hierarchyColor(model, 'child', ['#abcdef']), '#abcdef');
  assert.equal(hierarchyColor(model, 'child', []), PALETTE[1]);
});

test('sequential presets resample the same color family for any level count', () => {
  for (const key of ['blue-gradient', 'purple-gradient']) {
    const preset = PALETTE_PRESETS[key];
    for (const count of [1, 2, 8, 16]) {
      const colors = paletteFor(preset, count);
      assert.equal(colors.length, count);
      assert.equal(colors[0], preset.colors[0]);
      if (count > 1) assert.equal(colors[count - 1], preset.colors[1]);
      const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      for (let i = 1; i < count; i++) {
        assert.ok(channels(colors[i]).every((channel, c) => channel < channels(colors[i - 1])[c]), 'all channels darken smoothly');
      }
    }
  }
});
