import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology } from '../src/ontology.ts';
import * as layer from '../src/layer.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings.ts';
import type { NativeData } from '../src/layer.ts';

class Element {
  children: Element[] = []; text = ''; hidden = false; value = ''; removed = false; attrs: Record<string, string> = {};
  events = new Map<string, (event?: unknown) => void>();
  createDiv() { return this.createEl('div'); }
  createEl(_tag: string, options?: { text?: string }) {
    const child = new Element(); child.text = options?.text ?? ''; this.children.push(child); return child;
  }
  addEventListener(event: string, fn: (event?: unknown) => void) { this.events.set(event, fn); }
  removeEventListener(event: string) { this.events.delete(event); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; } addClass() {} removeClass() {} toggleClass() {}
  empty() { this.children = []; } remove() { this.removed = true; }
  all(): Element[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class File {}
type Controller = { attach(): void; refresh(): void; destroy(): void };

const model = new Ontology({
  cs: { description: '', broader: [] }, sec: { description: '', broader: [] },
  ml: { description: '', broader: ['cs'] }, dl: { description: '', broader: ['ml'] },
  crypto: { description: '', broader: ['cs', 'sec'] },
  overfitting: { description: '', broader: ['ml'], related: ['dl'] },
  loose: { description: '' },
}, []);
const core = (): NativeData => ({ numLinks: 5, nodes: {
  'A.md': { type: '', links: { '#DL': true, 'B.md': true } },
  'B.md': { type: '', links: { '#crypto': true, '#loose': true, '#to-read': true } },
  'C.md': { type: '', links: {} },
  '#DL': { type: 'tag', links: {} }, '#crypto': { type: 'tag', links: {} },
  '#loose': { type: 'tag', links: {} }, '#to-read': { type: 'tag', links: {} },
} });

interface Link { source: { id: string }; target: { id: string }; line: { texture: unknown }; arrows?: boolean; render(): void }

async function setup(settings: Partial<Settings> = {}, sendOnUpdate = true, firstRun = false, showTags = false) {
  const notices: string[] = [];
  const context = createContext({
    performance, devicePixelRatio: 1, window: { requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
    document: { visibilityState: 'visible' }, createEl: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  const code = await transform(readFileSync(new URL('../src/native.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian' ? { Notice: class { constructor(message: string) { notices.push(message); } }, TFile: File }
      : specifier === './layout.ts' ? { hierarchyPositions: (tags: string[]) => new Map(tags.map((tag, i) => [tag, { x: i * 400, y: 0 }])) }
      : { ...layer };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const NativeGraphs = (module.namespace as { NativeGraphs: new(owner: object) => Controller }).NativeGraphs;
  const forwarded: NativeData[] = [], engineClicks: unknown[][] = [];
  const dashTexture = {}, solidTexture = { constructor: { from: () => dashTexture } };
  const renderer = {
    nodes: [] as { id: string; x: number; y: number; fx: number | null; fy: number | null }[], links: [] as Link[],
    fShowArrow: true, worker: { postMessage() {} }, workerResults: null, width: 800, height: 600, targetScale: 1, scale: 1,
    changed() {}, resetPan() {}, setPan() {}, setScale(scale: number) { this.scale = scale; },
    onNodeClick(...args: unknown[]) { engineClicks.push(args); },
    setData(data: NativeData) {
      forwarded.push(data);
      this.nodes = Object.keys(data.nodes).map(id => ({ id, x: 0, y: 0, fx: null, fy: null }));
      this.links = Object.entries(data.nodes).flatMap(([source, node]) => Object.keys(node.links).map(target => {
        const link: Link = { source: { id: source }, target: { id: target }, line: { texture: solidTexture },
          render() { link.arrows = renderer.fShowArrow; } };
        return link;
      }));
    },
  };
  const original = { setData: renderer.setData, onNodeClick: renderer.onNodeClick };
  const contentEl = new Element();
  const graphOptions = { showTags, showOrphans: true }, optionWrites: object[] = [];
  const dataEngine = {
    getOptions: () => ({ ...graphOptions }),
    setOptions(options: typeof graphOptions) { Object.assign(graphOptions, options); optionWrites.push(options); },
    onOptionsChange() {},
  };
  const view = { renderer, contentEl, dataEngine, update() { if (sendOnUpdate) renderer.setData(core()); } }, leaf = { view }, leaves: object[] = [leaf];
  const owner = {
    model, settings: { ...DEFAULT_SETTINGS, ...settings }, saves: 0, firstRun,
    async saveState() { owner.saves++; }, async saveSettings() {},
    app: { workspace: { getLeavesOfType: () => leaves }, vault: { getAbstractFileByPath: () => null } },
  };
  const controller = new NativeGraphs(owner);
  const ids = () => Object.keys(forwarded.at(-1)!.nodes).sort();
  const click = (text: string) => contentEl.all().find(el => el.text === text)!.events.get('click')!();
  const search = (query: string) => {
    const input = contentEl.all().find(el => el !== contentEl && el.events.has('keydown'))!;
    input.value = query; input.events.get('keydown')!({ key: 'Enter' });
  };
  const addTab = () => {
    const tab = { ...renderer, nodes: [] as typeof renderer.nodes, links: [] as Link[], setData(data: NativeData) { this.nodes = Object.keys(data.nodes).map(id => ({ id, x: 0, y: 0, fx: null, fy: null })); } };
    const tabEl = new Element();
    leaves.push({ view: { renderer: tab, contentEl: tabEl, update() { tab.setData(core()); } } });
    return tabEl;
  };
  return { controller, renderer, original, contentEl, owner, forwarded, engineClicks, notices, ids, click, search, dashTexture, addTab, graphOptions, optionWrites };
}

test('layers the core data and restores the renderer on destroy', async () => {
  const t = await setup();
  t.controller.attach();
  assert.ok(t.ids().includes('#cs')); assert.ok(!t.ids().includes('#DL'));
  t.controller.destroy();
  assert.equal(t.renderer.setData, t.original.setData);
  assert.equal(t.renderer.onNodeClick, t.original.onNodeClick);
  assert.ok(t.contentEl.children.every(c => c.removed));
});

test('hierarchy links always show arrows, related links are dashed, other links keep the user setting', async () => {
  const t = await setup({ expanded: ['cs', 'ml'] });
  t.renderer.fShowArrow = false;
  t.controller.attach();
  t.renderer.setData({ ...core(), nodes: { ...core().nodes, 'D.md': { type: '', links: { '#overfitting': true } }, '#overfitting': { type: 'tag', links: {} } } });
  const find = (source: string, target: string) => t.renderer.links.find(l => l.source.id === source && l.target.id === target)!;
  for (const link of t.renderer.links) link.render();
  assert.equal(find('#ml', '#DL').arrows, true);
  assert.equal(find('#DL', '#overfitting').arrows, false);
  assert.equal(find('#DL', '#overfitting').line.texture, t.dashTexture);
  assert.equal(find('A.md', 'B.md').arrows, false);
  t.renderer.fShowArrow = true; find('A.md', 'B.md').render();
  assert.equal(find('A.md', 'B.md').arrows, true);
});

test('clicking a dictionary tag expands it, saves the state and re-renders', async () => {
  const t = await setup();
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.ok(t.ids().includes('#ml'));
  assert.deepEqual([...t.owner.settings.expanded], ['cs']); assert.equal(t.owner.saves, 1);
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.ok(t.ids().includes('#ml')); assert.equal(t.owner.saves, 1);
});

test('other nodes keep the core click behavior', async () => {
  const t = await setup();
  t.controller.attach();
  const event = {};
  (t.renderer.onNodeClick as (...args: unknown[]) => void)(event, '#to-read', 'tag');
  (t.renderer.onNodeClick as (...args: unknown[]) => void)(event, 'A.md', '');
  assert.deepEqual(t.engineClicks, [[event, '#to-read', 'tag'], [event, 'A.md', '']]);
});

test('tree layout keeps the user zoom across native updates and refits only when the layout changes', async () => {
  const t = await setup({ layout: 'tree', expanded: ['cs'] });
  t.controller.attach();
  const layoutSelect = t.contentEl.all().find(el => el.value === 'tree')!;
  const fitted = t.renderer.scale;
  t.renderer.targetScale = t.renderer.scale = 5;
  t.renderer.setData(core());
  assert.equal(t.renderer.scale, 5, 'a native graph update must not reset the zoom');
  t.controller.refresh();
  assert.equal(t.renderer.scale, 5, 'a metadata refresh must not reset the zoom');
  t.owner.settings.layout = 'radial'; t.controller.refresh();
  assert.equal(t.renderer.scale, fitted, 'switching layout refits the new positions');
  assert.equal(layoutSelect.value, 'radial', 'the toolbar shows a layout changed in settings');
});

test('notes and related toggles start from settings and persist', async () => {
  const t = await setup({ showNotes: false });
  t.controller.attach();
  assert.ok(Object.values(t.forwarded.at(-1)!.nodes).every(n => n.type === 'tag'));
  t.click('Notes');
  assert.ok(t.ids().includes('A.md')); assert.equal(t.owner.settings.showNotes, true);
  t.click('Related');
  assert.equal(t.owner.settings.showRelated, false); assert.equal(t.owner.saves, 2);
});

test('refresh prunes expanded tags that left the dictionary', async () => {
  const t = await setup({ expanded: ['gone', 'cs'] });
  t.controller.attach();
  t.controller.refresh();
  assert.deepEqual([...t.owner.settings.expanded], ['cs']); assert.ok(t.owner.saves >= 1);
});

test('searching a tag expands it and its ancestors', async () => {
  const t = await setup();
  t.controller.attach();
  t.search('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.ok(t.ids().includes('#DL'));
});

test('searching a tag outside the current graph opens the panel with a notice', async () => {
  const t = await setup();
  t.controller.attach();
  const before = t.ids();
  t.search('overfitting');
  assert.deepEqual(t.notices, ['Not in the current graph.']);
  assert.deepEqual(t.ids(), before); assert.equal(t.owner.saves, 0);
  assert.ok(t.contentEl.all().some(el => el.text === 'overfitting'));
});

test('rendering before any core data does nothing', async () => {
  const t = await setup({}, false);
  t.controller.attach();
  assert.equal(t.forwarded.length, 0);
  t.renderer.setData(core());
  assert.ok(t.ids().includes('#cs'));
});

test('without tag nodes from the core graph the status explains how to show the hierarchy', async () => {
  const t = await setup();
  t.controller.attach();
  t.renderer.setData({ numLinks: 0, nodes: { 'A.md': { type: '', links: {} } } });
  const status = t.contentEl.children[2]! as unknown as { textContent: string };
  assert.equal(status.textContent, 'Turn on Tags in the graph filters to show the dictionary hierarchy.');
});

test('search reveals a tag whose expanded ancestor sits under a collapsed one', async () => {
  const t = await setup({ expanded: ['ml'] });
  t.controller.attach();
  t.search('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.ok(t.ids().includes('#DL'));
});

test('the panel button reads the live expansion after Expand all', async () => {
  const t = await setup();
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  t.click('Collapse children and notes');
  t.click('Expand all');
  assert.ok(t.contentEl.all().some(el => el.text === 'Collapse children and notes'), 'the label follows Expand all');
  t.click('Collapse children and notes');
  assert.equal(t.owner.settings.expanded.length, model.entries.size - 1, 'only cs collapses');
});

test('notes toggles stay in sync across graph tabs', async () => {
  const t = await setup();
  const second = t.addTab();
  t.controller.attach();
  t.click('Notes');
  const other = second.all().find(el => el.text === 'Notes')!;
  assert.equal(other.attrs['aria-pressed'], 'false');
  other.events.get('click')!();
  assert.equal(t.owner.settings.showNotes, true, 'one click in the other tab turns notes back on');
});

test('a closed panel stays closed when the vault refreshes', async () => {
  const t = await setup();
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  t.click('Close');
  t.controller.refresh();
  assert.equal(t.contentEl.children[1]!.hidden, true);
});

test('a fresh install turns on the core Tags filter once', async () => {
  const t = await setup({}, true, true, false);
  t.controller.attach();
  assert.equal(t.graphOptions.showTags, true);
  assert.equal(t.owner.firstRun, false); assert.equal(t.owner.saves, 1);
  t.graphOptions.showTags = false; t.controller.refresh();
  assert.equal(t.graphOptions.showTags, false, 'later choices are left alone');
});

test('an existing install never touches the core Tags filter', async () => {
  const t = await setup({}, true, false, false);
  t.controller.attach();
  assert.equal(t.graphOptions.showTags, false); assert.equal(t.optionWrites.length, 0);
});
