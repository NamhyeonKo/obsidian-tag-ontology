import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology } from 'tag-ontology';
import * as legend from '../src/legend.ts';
import * as settings from '../src/settings.ts';
import * as card from '../src/explorer-card.ts';
import * as layout from '../src/explorer-layout.ts';
import { hierarchyColor, PALETTE } from '../src/colors.ts';

test('explorer uses the chosen color mode, with facet colors only in Obsidian default mode', async () => {
  const code = await transform(readFileSync(new URL('../src/explorer.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const context = createContext({});
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian' ? { ItemView: class {}, Menu: class {}, TFile: class {}, setIcon() {}, setTooltip() {} }
      : specifier === './legend.ts' ? { ...legend } : specifier === './settings.ts' ? { ...settings }
      : specifier === './explorer-card.ts' ? { ...card } : specifier === './explorer-layout.ts' ? { ...layout } : { TagSuggest: class {} };
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const model = new Ontology({ root: { description: '', broader: [], facet: 'language' } }, []);
  const owner = { model, settings: { ...settings.DEFAULT_SETTINGS }, tagColor(tag: string) {
    return this.settings.hierarchyColors ? hierarchyColor(model, tag, this.settings.hierarchyPalette)! : '#123456';
  } };
  const View = (module.namespace as unknown as { ExplorerView: new(leaf: object, owner: object) => { tagCard(tag: string): { color: string }; chip(parent: object, text: string, tag: string): void } }).ExplorerView;
  const view = new View({}, owner);
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
