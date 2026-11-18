import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology } from 'tag-ontology';
import * as settings from '../src/settings.ts';
import * as card from '../src/explorer-card.ts';
import * as layout from '../src/explorer-layout.ts';
import { hierarchyColor, PALETTE } from '../src/colors.ts';

async function loadExplorer(over: { card?: Partial<typeof card>; layout?: Partial<typeof layout> } = {}) {
  const code = await transform(readFileSync(new URL('../src/explorer.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const context = createContext({});
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian' ? { Component: class {}, ItemView: class {}, Menu: class {}, TFile: class {}, setIcon() {}, setTooltip() {} }
      : specifier === './graph-modes.ts' ? { graphModeBar() { return () => {}; } }
      : specifier === './legend.ts' ? { renderDepthLegend() {} } : specifier === './settings.ts' ? { ...settings }
      : specifier === './explorer-card.ts' ? { ...card, ...over.card }
      : specifier === './explorer-layout.ts' ? { ...layout, ...over.layout } : { TagSuggest: class {} };
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  return (module.namespace as unknown as {
    ExplorerCanvas: new(root: object, owner: object, leaf: object) => {
      cy?: object;
      tagCard(tag: string): card.Card;
      chip(parent: object, text: string, tag: string): void;
      size(c: card.Card): layout.Size;
      addNode(id: string, c: card.Card, data: Record<string, unknown>, position: layout.Point): unknown;
    };
  }).ExplorerCanvas;
}

test('explorer uses the chosen color mode, with facet colors only in Obsidian default mode', async () => {
  const View = await loadExplorer();
  const model = new Ontology({ root: { description: '', broader: [], facet: 'language' } }, []);
  const owner = { model, settings: { ...settings.DEFAULT_SETTINGS }, tagColor(tag: string) {
    return this.settings.hierarchyColors ? hierarchyColor(model, tag, this.settings.hierarchyPalette)! : '#123456';
  } };
  const view = new View({}, owner, {});
  const chipColor = () => {
    const css: Record<string, string> = {};
    view.chip({ createEl: () => ({ setCssProps: (props: Record<string, string>) => Object.assign(css, props), addEventListener() {} }) }, '#root', 'root');
    return css['--tag-ontology-tags'];
  };
  assert.equal(chipColor(), undefined, 'default mode inherits the graph tag color');
  assert.equal(view.tagCard('root').color, '#4ea1ff');
  owner.settings.customColors = true;
  assert.equal(chipColor(), '#123456');
  assert.equal(view.tagCard('root').color, '#123456');
  owner.settings.hierarchyColors = true;
  assert.equal(view.tagCard('root').color, PALETTE[0]);
  assert.equal(chipColor(), PALETTE[0]);
  owner.settings.customColors = false;
  assert.equal(chipColor(), undefined, 'switching back does not retain a custom color');
});

test('explorer caches facet colors per model and computes card height without building SVG', async () => {
  let facetCalls = 0, imageCalls = 0;
  const View = await loadExplorer({
    layout: { facetColors: facets => { facetCalls++; return layout.facetColors(facets); } },
    card: { cardImage: (c, theme, measure) => { imageCalls++; return card.cardImage(c, theme, measure); } },
  });
  const first = new Ontology({ root: { description: '', broader: [], facet: 'a' }, leaf: { description: '', broader: ['root'], facet: 'b' } }, []);
  const owner = { model: first, settings: { ...settings.DEFAULT_SETTINGS, customColors: true }, tagColor: () => '#123456' };
  const customView = new View({}, owner, {});
  customView.tagCard('root');
  assert.equal(facetCalls, 0, 'custom colors skip facet color indexing');

  owner.settings.customColors = false;
  const view = new View({}, owner, {});
  const rootCard = view.tagCard('root');
  view.tagCard('leaf');
  assert.equal(facetCalls, 1, 'facet colors are indexed once per ontology model');

  owner.model = new Ontology({ root: { description: '', broader: [], facet: 'c' } }, []);
  view.tagCard('root');
  assert.equal(facetCalls, 2, 'replacing the model invalidates cached facet colors');

  const size = view.size(rootCard);
  assert.equal(size.w, 230); assert.equal(size.h, 120);
  assert.equal(imageCalls, 0, 'size() reads cardHeight without generating SVG');

  let added = 0;
  view.cy = { add: () => { added++; return {}; } };
  view.addNode('tag:root', rootCard, { type: 'tag', tag: 'root' }, { x: 0, y: 0 });
  assert.equal(added, 1);
  assert.equal(imageCalls, 1, 'addNode() generates SVG once');
});
