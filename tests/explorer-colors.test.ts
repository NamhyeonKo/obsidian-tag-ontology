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

async function loadExplorer(over: { card?: Partial<typeof card>; layout?: Partial<typeof layout>; cytoscape?: (opts: object) => object } = {}) {
  const code = await transform(readFileSync(new URL('../src/explorer.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const context = createContext({
    createEl: () => ({ getContext: () => ({ fillRect() {}, measureText: () => ({ width: 20 }) }) }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
  });
  const cyFactory = over.cytoscape ?? (() => ({}));
  const module = new SourceTextModule(code.code, {
    context,
    importModuleDynamically: async () => {
      const m = new SyntheticModule(['default'], function () { this.setExport('default', cyFactory); }, { context });
      await m.link(() => { throw new Error('unexpected'); }); await m.evaluate(); return m;
    },
  });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian' ? {
      Component: class { register() {} registerEvent() {} registerDomEvent(el: { addEventListener?: (t: string, f: () => void) => void }, t: string, f: () => void) { el.addEventListener?.(t, f); } },
      ItemView: class {}, Menu: class {}, TFile: class {},
      setIcon(el: { attrs?: Record<string, string> }, id: string) { if (el.attrs) el.attrs.icon = id; },
      setTooltip(el: { attrs?: Record<string, string> }, label: string) { if (el.attrs) el.attrs['aria-label'] = label; },
    }
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
      open(): Promise<void>; focusOn(tag: string): void; fit(): void; paint(): void; onunload(): void;
      tagCard(tag: string): card.Card;
      chip(parent: object, text: string, tag: string): void;
      size(c: card.Card): layout.Size;
      addNode(id: string, c: card.Card, data: Record<string, unknown>, position: layout.Point): unknown;
      draw(operation: string): void;
      readTheme(): void; style(): unknown; changed(): void;
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

  let restyled = 0;
  view.cy = {
    nodes: (sel?: string) => sel ? [] : { forEach() {} },
    edges: () => ({ filter: () => ({ remove() {} }) }),
    style: () => { restyled++; },
  };
  view.readTheme = () => {};
  view.draw('settings');
  assert.equal(restyled, 1, 'explorer redraws colors when settings change');
});

test('explorer recenter tracks selection, pan/zoom, fit, tap, and clear canvas', async () => {
  class El {
    children: El[] = []; classes = new Set<string>(); attrs: Record<string, string> = {}; hidden = false; text = '';
    events = new Map<string, ((e?: unknown) => void)[]>(); doc = { body: {} };
    createDiv(options: string | { cls?: string; text?: string } = '') {
      const child = new El(), cls = typeof options === 'string' ? options : options.cls ?? '';
      for (const c of cls.split(' ')) if (c) child.classes.add(c);
      this.children.push(child); return child;
    }
    createEl(_tag: string, opts?: { cls?: string; text?: string }) { return this.createDiv(opts?.cls); }
    setText(t: string) { this.text = t; }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    setCssProps() {}
    querySelectorAll() { return []; } querySelector() { return null; }
    addClass(cls: string) { this.classes.add(cls); } removeClass(cls: string) { this.classes.delete(cls); }
    toggleClass(cls: string, on: boolean) { if (on) this.classes.add(cls); else this.classes.delete(cls); }
    empty() { this.children = []; } isShown() { return true; }
    addEventListener(type: string, fn: (e?: unknown) => void) { const list = this.events.get(type) ?? []; list.push(fn); this.events.set(type, list); }
    all(): El[] { return [this, ...this.children.flatMap(c => c.all())]; }
  }
  const nodes = new Map<string, { data: Record<string, unknown>; pos: { x: number; y: number }; selected: boolean }>();
  const handlers: { event: string; selector?: string; fn: (e?: unknown) => void }[] = [];
  interface NodeStub {
    empty(): boolean; nonempty(): boolean; id(): string;
    data(k?: string): unknown; position(): { x: number; y: number };
    selected(): boolean; select(): NodeStub; unselect(): NodeStub;
    forEach(fn: (item: NodeStub) => void): void; remove(): void;
  }
  const wrap = (id?: string): NodeStub => {
    const entry = id ? nodes.get(id) : undefined;
    return {
      empty: () => !entry, nonempty: () => !!entry, id: () => id ?? '',
      data: (k?: string) => k ? entry?.data[k] : entry?.data,
      position: () => entry?.pos ?? { x: 0, y: 0 },
      selected: () => !!entry?.selected,
      select() { if (entry) entry.selected = true; return this; },
      unselect() { if (entry) entry.selected = false; return this; },
      forEach(fn: (item: NodeStub) => void) { for (const key of nodes.keys()) fn(wrap(key)); },
      remove() { if (id) nodes.delete(id); },
    };
  };
  let animates = 0;
  const fakeCy = {
    width: () => 800,
    on(event: string, arg2: string | ((e?: unknown) => void), arg3?: (e?: unknown) => void) {
      for (const e of event.split(' ')) handlers.push({ event: e, selector: typeof arg2 === 'string' ? arg2 : undefined, fn: typeof arg2 === 'string' ? arg3! : arg2 });
    },
    getElementById: (id: string) => wrap(id),
    nodes: (sel?: string) => {
      const list = [...nodes.keys()].filter(id => !sel || (sel === '[type="group"]' ? id.startsWith('group:') : true)).map(wrap);
      return Object.assign(list, {
        empty: () => list.length === 0, nonempty: () => list.length > 0,
      });
    },
    edges: () => ({ filter: () => ({ remove() {} }), remove() {} }),
    elements: () => ({
      unselect() { for (const n of nodes.values()) n.selected = false; },
      remove() { nodes.clear(); },
    }),
    add(spec: { group: string; data: Record<string, unknown>; position: { x: number; y: number } }) {
      const id = String(spec.data.id);
      nodes.set(id, { data: spec.data, pos: spec.position, selected: false });
      return wrap(id);
    },
    zoom() { handlers.filter(h => h.event === 'zoom').forEach(h => h.fn()); },
    center() { handlers.filter(h => h.event === 'pan').forEach(h => h.fn()); },
    animate(_spec: unknown, opts?: { complete?: () => void }) {
      animates++;
      handlers.filter(h => h.event === 'pan').forEach(h => h.fn());
      opts?.complete?.();
    },
    style() {}, resize() {}, destroy() {},
  };
  const model = new Ontology({ a: { description: '', broader: [] }, b: { description: '', broader: [] } }, []);
  const owner = {
    model, settings: { ...settings.DEFAULT_SETTINGS },
    native: {
      selectedTag: undefined as string | undefined,
      explorer: undefined as unknown,
      renderPanel() {}, link() {}, unlink() {},
      clickTag(tag: string) { this.selectedTag = tag; },
    },
    tagColor: () => '#123456',
    app: { workspace: { on: () => () => {} }, vault: { on: () => () => {}, getAbstractFileByPath: () => null }, metadataCache: { on: () => () => {} } },
  };
  const View = await loadExplorer({ cytoscape: () => fakeCy });
  const root = new El(), view = new View(root, owner, {});
  await view.open();
  const recenter = root.all().find(el => el.classes.has('tag-ontology-recenter'))!;
  const recenterBtn = root.all().find(el => el.attrs['aria-label'] === 'Center on selected tag')!;
  const fitBtn = root.all().find(el => el.attrs['aria-label'] === 'Fit')!;
  const clearBtn = root.all().find(el => el.attrs['aria-label'] === 'Clear canvas')!;
  const emitPan = () => handlers.filter(h => h.event === 'pan' && !h.selector).forEach(h => h.fn());
  const emitTap = (tag: string) => handlers.find(h => h.event === 'tap' && h.selector === 'node[type="tag"]')!.fn({ target: wrap('tag:' + tag) });

  assert.equal(recenter.hidden, true, 'hidden before any tag card is on canvas');

  owner.native.selectedTag = 'a';
  view.paint();
  assert.equal(recenter.hidden, true, 'stays hidden while selected tag has no card on canvas');

  view.focusOn('a');
  assert.equal(recenter.hidden, true, 'adding and centering hides recenter');

  emitPan();
  assert.equal(recenter.hidden, false, 'panning away shows recenter');

  recenterBtn.events.get('click')![0]();
  assert.equal(recenter.hidden, true, 'clicking recenter animates back without re-showing button');

  fitBtn.events.get('click')![0]();
  assert.equal(recenter.hidden, false, 'Fit marks viewport moved and shows recenter');

  view.focusOn('b');
  emitTap('b');
  assert.equal(recenter.hidden, true, 'tapping an already-centered tag keeps recenter hidden');

  emitTap('a');
  assert.equal(recenter.hidden, false, 'tapping another off-center tag does not hide recenter');

  recenterBtn.events.get('click')![0]();
  assert.equal(recenter.hidden, true, 'centering on tapped tag hides recenter');

  handlers.filter(h => h.event === 'zoom' && !h.selector).forEach(h => h.fn());
  assert.equal(recenter.hidden, false, 'zooming shows recenter');

  const before = animates;
  view.fit();
  assert.equal(animates, before + 1, 'public fit() frames populated Explorer canvas');

  clearBtn.events.get('click')![0]();
  assert.equal(recenter.hidden, true, 'Clear canvas removes cards and hides recenter');
  view.fit();
  assert.equal(animates, before + 1, 'fit() skips empty Explorer canvas');
  view.onunload();
});
