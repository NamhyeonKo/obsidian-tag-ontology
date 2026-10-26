import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology } from '../src/ontology.ts';
import * as layer from '../src/layer.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings.ts';
import type { NativeData } from '../src/layer.ts';
import * as dictionaryModule from '../src/dictionary.ts';
import { apply, type Change, type RawDictionary } from '../src/dictionary.ts';

class Element {
  tag = ''; children: Element[] = []; text = ''; hidden = false; value = ''; removed = false; attrs: Record<string, string> = {}; classes = new Set<string>();
  events = new Map<string, (event?: unknown) => void>();
  css: Record<string, string> = {}; disabled = false;
  setText(text: string) { this.text = text; } focused = false; focus() { this.focused = true; }
  setCssProps(props: Record<string, string>) { Object.assign(this.css, props); }
  createDiv(options?: string | { text?: string; cls?: string }) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
  createSpan(options?: { text?: string; cls?: string }) { return this.createEl('span', options); }
  createEl(tag: string, options?: { text?: string; cls?: string; attr?: Record<string, string> }) {
    const child = new Element(); child.tag = tag; child.text = options?.text ?? ''; this.children.push(child);
    for (const cls of options?.cls?.split(' ') ?? []) if (cls) child.classes.add(cls);
    Object.assign(child.attrs, options?.attr ?? {});
    return child;
  }
  addEventListener(event: string, fn: (event?: unknown) => void) { this.events.set(event, fn); }
  removeEventListener(event: string) { this.events.delete(event); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addClass(cls: string) { this.classes.add(cls); } removeClass(cls: string) { this.classes.delete(cls); }
  toggleClass(cls: string, on: boolean) { if (on) this.classes.add(cls); else this.classes.delete(cls); }
  empty() { this.children = []; } remove() { this.removed = true; }
  all(): Element[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class File {}
type Controller = { attach(): void; refresh(redraw?: boolean): void; renderPanel(): void; destroy(): void; mount(el: Element): void };

const raw: RawDictionary = {
  cs: { description: '', broader: [] }, sec: { description: '', broader: [] },
  ml: { description: '', broader: ['cs'] }, dl: { description: '', broader: ['ml'] },
  crypto: { description: '', broader: ['cs', 'sec'] },
  overfitting: { description: '', broader: ['ml'], related: ['dl'] },
  loose: { description: '' },
};
const model = new Ontology(raw, []);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const core = (): NativeData => ({ numLinks: 5, nodes: {
  'A.md': { type: '', links: { '#DL': true, 'B.md': true } },
  'B.md': { type: '', links: { '#crypto': true, '#loose': true, '#to-read': true } },
  'C.md': { type: '', links: {} },
  '#DL': { type: 'tag', links: {} }, '#crypto': { type: 'tag', links: {} },
  '#loose': { type: 'tag', links: {} }, '#to-read': { type: 'tag', links: {} },
} });

interface Link { source: { id: string }; target: { id: string }; line: { texture: unknown }; arrows?: boolean; render(): void }

// The tree layout is stubbed with every node in one row, 400 apart; it records the nodes it was told the tree can't place.
const inRow = (tags: string[]) => new Map(tags.map((tag, i) => [tag, { x: i * 400, y: 0 }]));
const layoutOutside: string[][] = [];

async function setup(settings: Partial<Settings> = {}, sendOnUpdate = true, firstRun = false, showTags = false) {
  const notices: string[] = [], sideCalls: object[] = [];
  // Stands in for Obsidian's Modal: open() draws it right away, and tests press its buttons.
  const modals: { titleEl: Element; contentEl: Element; closed: boolean }[] = [];
  class Modal {
    titleEl = new Element(); contentEl = new Element(); closed = false;
    onOpen() {} onClose() {}
    open() { modals.push(this); this.onOpen(); }
    close() { this.closed = true; this.onClose(); }
  }
  // Animation frames wait until a test advances the fake clock with tick().
  const frames = new Map<number, () => void>();
  let frameId = 0, clock = 0;
  const tick = (ms: number) => { clock += ms; const due = [...frames.values()]; frames.clear(); for (const frame of due) frame(); };
  const suggests: { input: Element; source: (query: string) => { tag: string }[]; onChoose: (tag: string) => void }[] = [];
  const context = createContext({
    performance: { now: () => clock }, devicePixelRatio: 1, structuredClone,
    window: { requestAnimationFrame: (frame: () => void) => { frames.set(++frameId, frame); return frameId; }, cancelAnimationFrame: (id: number) => { frames.delete(id); } },
    document: { visibilityState: 'visible' }, createEl: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  const code = await transform(readFileSync(new URL('../src/native.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian' ? { Notice: class { constructor(message: string) { notices.push(message); } }, TFile: File, Modal,
        setIcon: (el: Element, id: string) => { el.attrs.icon = id; }, setTooltip: (el: Element, text: string) => { el.attrs.tooltip = el.attrs['aria-label'] = text; } }
      : specifier === './layout.ts' ? { treePositions: (tags: string[], _edges: unknown, _horizontal: boolean, outside: string[] = []) => { layoutOutside.push(outside); return inRow([...tags, ...outside]); } }
      : specifier === './search.ts' ? { TagSuggest: class { constructor(_app: unknown, input: Element, source: (query: string) => { tag: string }[], onChoose: (tag: string) => void) { suggests.push({ input, source, onChoose }); } } }
      : specifier === './dictionary.ts' ? { ...dictionaryModule }
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
    nodes: [] as { id: string; x: number; y: number; fx: number | null; fy: number | null; color: unknown }[], links: [] as Link[],
    fShowArrow: true, worker: { messages: [] as unknown[], postMessage(message: unknown) { this.messages.push(message); } }, workerResults: null, width: 800, height: 600, targetScale: 1, scale: 1,
    pans: [] as [number, number][],
    highlightNode: null as unknown, dragNode: null as unknown,
    getHighlightNode(): unknown { return this.dragNode || this.highlightNode; },
    changed() {}, resetPan() {}, setPan(x: number, y: number) { this.pans.push([x, y]); }, setScale(scale: number) { this.scale = scale; },
    onNodeClick(...args: unknown[]) { engineClicks.push(args); },
    setData(data: NativeData) {
      forwarded.push(data);
      this.nodes = Object.keys(data.nodes).map(id => ({ id, x: 0, y: 0, fx: null, fy: null, color: data.nodes[id]!.color ?? null }));
      this.links = Object.entries(data.nodes).flatMap(([source, node]) => Object.keys(node.links).map(target => {
        const link: Link = { source: { id: source }, target: { id: target }, line: { texture: solidTexture },
          render() { link.arrows = renderer.fShowArrow; } };
        return link;
      }));
    },
  };
  const original = { setData: renderer.setData, onNodeClick: renderer.onNodeClick, getHighlightNode: renderer.getHighlightNode };
  const contentEl = new Element();
  const graphOptions = { showTags, showOrphans: true }, optionWrites: object[] = [];
  const dataEngine = {
    getOptions: () => ({ ...graphOptions }),
    setOptions(options: typeof graphOptions) { Object.assign(graphOptions, options); optionWrites.push(options); },
    onOptionsChange() {},
  };
  const view = { renderer, contentEl, dataEngine, update() { if (sendOnUpdate) renderer.setData(core()); } }, leaf = { view }, leaves: object[] = [leaf];
  const owner = {
    model: model as Ontology | undefined, settings: { ...DEFAULT_SETTINGS, ...settings }, saves: 0, firstRun,
    async saveState() { owner.saves++; }, async saveSettings() {},
    // Saving applies the change to the raw dictionary; reloading rebuilds the model from it, as the plugin does from the file.
    raw, changes: [] as Change[], reloads: 0, missing: false, created: 0, error: undefined as string | undefined,
    async createDictionary() { owner.created++; return true; },
    async saveChange(change: Change): Promise<boolean> { owner.changes.push(change); owner.raw = apply(owner.raw, change); return true; },
    async reload() { owner.reloads++; owner.model = new Ontology(owner.raw, []); controller.refresh(false); },
    app: { workspace: {
      getLeavesOfType: () => leaves,
      ensureSideLeaf: (type: string, side: string, options: object) => { sideCalls.push({ type, side, ...options }); return Promise.resolve(); },
    }, vault: { getAbstractFileByPath: (path: string) => path === owner.settings.dictionaryPath && !owner.missing ? new File() : null } },
  };
  const controller = new NativeGraphs(owner);
  // Obsidian restores the sidebar view on startup, so tests start with it mounted.
  const sidebar = new Element();
  controller.mount(sidebar);
  const all = () => [...contentEl.all(), ...sidebar.all()];
  const ids = () => Object.keys(forwarded.at(-1)!.nodes).sort();
  const click = (label: string) => all().find(el => el.text === label || el.attrs['aria-label'] === label)!.events.get('click')!({ preventDefault() {} });
  const search = (query: string) => {
    const input = sidebar.all().find(el => el.events.has('keydown'))!;
    input.value = query; input.events.get('keydown')!({ key: 'Enter' });
  };
  const addTab = () => {
    const tab = { ...renderer, nodes: [] as typeof renderer.nodes, links: [] as Link[], setData(data: NativeData) { this.nodes = Object.keys(data.nodes).map(id => ({ id, x: 0, y: 0, fx: null, fy: null, color: null })); } };
    const tabEl = new Element();
    leaves.push({ view: { renderer: tab, contentEl: tabEl, update() { tab.setData(core()); } } });
    return tabEl;
  };
  return { controller, renderer, original, contentEl, sidebar, all, owner, forwarded, engineClicks, notices, ids, click, search, dashTexture, addTab, graphOptions, optionWrites, suggests, sideCalls, leaves, tick, modals };
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
  const fitted = t.renderer.scale;
  t.renderer.targetScale = t.renderer.scale = 5;
  t.renderer.setData(core());
  assert.equal(t.renderer.scale, 5, 'a native graph update must not reset the zoom');
  t.controller.refresh();
  assert.equal(t.renderer.scale, 5, 'a metadata refresh must not reset the zoom');
  t.owner.settings.layout = 'tree-horizontal'; t.controller.refresh();
  assert.equal(t.renderer.scale, fitted, 'switching layout refits the new positions');
  const horizontal = t.contentEl.all().find(el => el.attrs['aria-label'] === 'Layout: Horizontal tree')!;
  assert.equal(horizontal.attrs['aria-pressed'], 'true', 'the toolbar shows a layout changed in settings');
});

test('notes and related toggles start from settings and persist', async () => {
  const t = await setup({ showNotes: false });
  t.controller.attach();
  assert.ok(Object.values(t.forwarded.at(-1)!.nodes).every(n => n.type === 'tag'));
  t.click('Notes: hidden');
  assert.ok(t.ids().includes('A.md')); assert.equal(t.owner.settings.showNotes, true);
  t.click('Related: shown');
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
  t.suggests[0]!.onChoose('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.ok(t.ids().includes('#DL'));
});

test('searching a tag outside the current graph opens the panel with a notice', async () => {
  const t = await setup();
  t.controller.attach();
  const before = t.ids();
  t.suggests[0]!.onChoose('overfitting');
  assert.deepEqual(t.notices, ['Not in the current graph.']);
  assert.deepEqual(t.ids(), before); assert.equal(t.owner.saves, 0);
  assert.ok(t.sidebar.all().some(el => el.tag === 'h3' && el.text === 'overfitting'));
});

test('rendering before any core data does nothing', async () => {
  const t = await setup({}, false);
  t.controller.attach();
  assert.equal(t.forwarded.length, 0);
  t.renderer.setData(core());
  assert.ok(t.ids().includes('#cs'));
});
test('a graph tab restored in the background attaches once Obsidian loads it', async () => {
  const t = await setup();
  const leaf = t.leaves[0] as { view: object; isDeferred?: boolean }, loaded = leaf.view;
  // Obsidian restores a background tab as a placeholder: it reports the graph type but has no renderer yet.
  leaf.view = { contentEl: new Element() }; leaf.isDeferred = true;
  t.controller.attach();
  assert.deepEqual(t.notices, []);
  leaf.view = loaded; leaf.isDeferred = false;
  t.controller.attach();
  assert.ok(t.ids().includes('#cs'));
});

test('without tag nodes from the core graph the status explains how to show the hierarchy', async () => {
  const t = await setup();
  t.controller.attach();
  t.renderer.setData({ numLinks: 0, nodes: { 'A.md': { type: '', links: {} } } });
  const status = t.contentEl.all().find(el => el.attrs.role === 'status')! as unknown as { textContent: string };
  assert.equal(status.textContent, 'Turn on Tags in the graph filters to show the dictionary hierarchy.');
});

test('search reveals a tag whose expanded ancestor sits under a collapsed one', async () => {
  const t = await setup({ expanded: ['ml'] });
  t.controller.attach();
  t.suggests[0]!.onChoose('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.ok(t.ids().includes('#DL'));
});

test('the panel button reads the live expansion after Expand all', async () => {
  const t = await setup();
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  t.click('Collapse in graph');
  t.click('Expand all');
  assert.ok(t.all().some(el => el.attrs['aria-label'] === 'Collapse in graph'), 'the label follows Expand all');
  t.click('Collapse in graph');
  assert.equal(t.owner.settings.expanded.length, model.entries.size - 1, 'only cs collapses');
});

test('notes toggles stay in sync across graph tabs', async () => {
  const t = await setup();
  const second = t.addTab();
  t.controller.attach();
  t.click('Notes: shown');
  const other = second.all().find(el => el.attrs.icon === 'file-text')!;
  assert.equal(other.attrs['aria-pressed'], 'false'); assert.equal(other.attrs['aria-label'], 'Notes: hidden');
  other.events.get('click')!();
  assert.equal(t.owner.settings.showNotes, true, 'one click in the other tab turns notes back on');
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

test('choosing a suggestion reveals the tag', async () => {
  const t = await setup();
  t.controller.attach();
  t.suggests[0]!.onChoose('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.ok(t.ids().includes('#DL'));
});

test('the suggestion source is the model', async () => {
  const t = await setup();
  t.controller.attach();
  assert.deepEqual(t.suggests[0]!.source('d'), model.suggest('d'));
});

test('Enter with no matches shows a notice', async () => {
  const t = await setup();
  t.controller.attach();
  t.search('zzz');
  assert.deepEqual(t.notices, ['No matching dictionary tag.']);
});

test('toolbar uses the agreed icons and tooltips', async () => {
  const t = await setup();
  t.controller.attach();
  const icons = t.contentEl.all().filter(el => el.attrs.icon);
  assert.deepEqual(icons.map(el => el.attrs.icon), ['chevrons-down-up', 'chevrons-up-down', 'scan', 'file-text', 'link', 'book-open-check', 'share-2', 'network', 'list-tree']);
  assert.deepEqual(icons.map(el => el.attrs.tooltip), ['Collapse all', 'Expand all', 'Fit', 'Notes: shown', 'Related: shown', 'Dictionary check', 'Layout: Force', 'Layout: Vertical tree', 'Layout: Horizontal tree']);
});

test('layout buttons switch the layout without rereading the dictionary and mark the current one', async () => {
  const t = await setup();
  t.controller.attach();
  let reloads = 0; t.owner.saveSettings = async () => { reloads++; };
  const sent = t.forwarded.length;
  t.click('Layout: Force');
  assert.equal(t.forwarded.length, sent, 'the current layout is not drawn again');
  t.click('Layout: Vertical tree');
  assert.equal(t.owner.settings.layout, 'tree'); assert.equal(t.forwarded.length, sent + 1);
  assert.equal(reloads, 0); assert.equal(t.owner.saves, 1);
  const pressed = (label: string) => t.contentEl.all().find(el => el.attrs['aria-label'] === label)!.attrs['aria-pressed'];
  assert.equal(pressed('Layout: Vertical tree'), 'true'); assert.equal(pressed('Layout: Force'), 'false');
  t.click('Layout: Horizontal tree');
  assert.equal(t.owner.settings.layout, 'tree-horizontal'); assert.equal(pressed('Layout: Horizontal tree'), 'true');
});

test('tree hides notes without changing the saved setting', async () => {
  const t = await setup({ layout: 'tree', showNotes: true });
  t.controller.attach();
  assert.ok(Object.values(t.forwarded.at(-1)!.nodes).every(n => n.type === 'tag'));
  assert.equal(t.owner.settings.showNotes, true);
  t.owner.settings.layout = 'force'; t.controller.refresh();
  assert.ok(t.ids().includes('A.md'), 'Force shows notes again');
});

test('tree pins every node and hands the tags outside the hierarchy to the layout for its corner', async () => {
  const t = await setup({ layout: 'tree' });
  t.controller.attach();
  assert.ok(t.renderer.nodes.every(n => n.fx === n.x && n.fy === n.y));
  assert.deepEqual([...layoutOutside.at(-1)!].sort(), ['#loose', '#to-read']);
});

test('in a tree, a node released after a drag springs back to its place', async () => {
  const t = await setup({ layout: 'tree' });
  t.controller.attach();
  const node = t.renderer.nodes.find(n => n.id === '#cs')!, home = [node.x, node.y];
  // The core graph unpins the node under the pointer on release, after its simulation ran for the drag.
  node.x += 300; node.y += 100; node.fx = null; node.fy = null;
  t.contentEl.events.get('pointerup')!();
  assert.deepEqual({ ...t.renderer.worker.messages.at(-1) as object }, { run: false }, 'the simulation stops');
  t.tick(100);
  assert.ok(node.fx === node.x && Math.abs(node.x - home[0]) < 300, 'pinned on its way back');
  t.tick(1000);
  assert.deepEqual([node.x, node.y, node.fx, node.fy], [home[0], home[1], home[0], home[1]]);
  // Force leaves the core behavior alone.
  t.click('Layout: Force');
  node.fx = null; t.contentEl.events.get('pointerup')!();
  assert.equal(node.fx, null);
});

test('the notes button is disabled in tree', async () => {
  const t = await setup({ layout: 'tree', showNotes: true });
  t.controller.attach();
  const notes = t.contentEl.all().find(el => el.attrs.icon === 'file-text')!;
  assert.equal(notes.attrs['aria-disabled'], 'true');
  assert.equal(notes.attrs.tooltip, 'Notes are hidden in tree layouts');
  notes.events.get('click')!();
  assert.equal(t.owner.settings.showNotes, true); assert.equal(t.owner.saves, 0);
});

test('Enter on a matching query reveals the first suggestion when the popover is closed', async () => {
  const t = await setup();
  t.controller.attach();
  t.search('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.deepEqual(t.notices, []);
});

test('Enter while an IME composition is active does not select a tag', async () => {
  const t = await setup();
  t.controller.attach();
  const input = t.sidebar.all().find(el => el.events.has('keydown'))!;
  input.value = 'dl'; input.events.get('keydown')!({ key: 'Enter', isComposing: true });
  assert.deepEqual([...t.owner.settings.expanded], []);
  assert.equal(input.value, 'dl');
});

test('revealing a tag that left the dictionary shows a notice instead of throwing', async () => {
  const t = await setup();
  t.controller.attach();
  t.click('Dictionary check');
  t.owner.model = new Ontology({ cs: { description: '', broader: [] } }, []);
  t.controller.refresh();
  assert.doesNotThrow(() => t.suggests[0]!.onChoose('dl'));
  assert.deepEqual(t.notices, ['That tag is no longer in the dictionary.']);
  assert.ok(!t.sidebar.all().some(el => el.text === '#overfitting'), 'the dictionary check is redrawn from the reloaded dictionary');
});

const tagLinks = (el: Element) => el.all().filter(child => child.classes.has('tag')).map(child => child.text);

test('the sidebar lists the root tags until a tag is chosen', async () => {
  const t = await setup();
  assert.deepEqual(tagLinks(t.sidebar), model.roots.map(tag => '#' + tag));
});

test('attaching to a graph never creates the sidebar tab on its own', async () => {
  // After a plugin reload Obsidian restores the tab late; creating one here would duplicate it.
  const t = await setup();
  t.controller.attach();
  assert.deepEqual(t.sideCalls, []);
});

test('clicking a tag shows it in the sidebar and brings the sidebar forward', async () => {
  const t = await setup();
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.ok(t.sidebar.all().some(el => el.tag === 'h3' && el.text === 'cs'));
  assert.deepEqual(t.sideCalls.at(-1), { type: 'tag-ontology-panel', side: 'left', reveal: true });
});

test('related tags in the panel are tag links with #', async () => {
  const t = await setup({ expanded: ['cs'] });
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#ml', 'tag');
  assert.deepEqual(tagLinks(t.sidebar), ['#cs', '#dl', '#overfitting']);
});

test('the panel has no Close button and a rule between relations and notes', async () => {
  const t = await setup();
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.ok(!t.all().some(el => el.text === 'Close'));
  const kinds = t.sidebar.all().map(el => el.tag);
  assert.ok(kinds.lastIndexOf('details') > kinds.indexOf('hr') && kinds.indexOf('hr') > kinds.indexOf('summary'));
});

test('the sidebar search expands a tag without an open graph', async () => {
  const t = await setup();
  t.leaves.length = 0;
  t.controller.attach();
  t.search('dl');
  assert.deepEqual([...t.owner.settings.expanded].sort(), ['cs', 'dl', 'ml']);
  assert.deepEqual(t.notices, []);
  assert.ok(t.sidebar.all().some(el => el.tag === 'h3' && el.text === 'dl'));
});

test('parent, child and related lists start open', async () => {
  const t = await setup();
  const relations = () => t.sidebar.all().filter(el => el.tag === 'details' && /^(Parents|Children|Related) /.test(el.children[0]!.text));
  const seen: string[] = [];
  for (const tag of ['ml', 'overfitting']) {
    t.suggests[0]!.onChoose(tag);
    for (const list of relations()) {
      assert.equal((list as unknown as { open?: boolean }).open, true, `${tag}: ${list.children[0]!.text}`);
      seen.push(list.children[0]!.text.split(' ')[0]!);
    }
  }
  assert.deepEqual([...new Set(seen)].sort(), ['Children', 'Parents', 'Related']);
});

test('choosing a tag in the sidebar centers it in the open graph', async () => {
  const t = await setup({ layout: 'tree' });
  t.controller.attach();
  t.suggests[0]!.onChoose('dl');
  const node = t.renderer.nodes.find(n => n.id === '#DL')!;
  assert.deepEqual(t.renderer.pans.at(-1), [400 - node.x * t.renderer.scale, 300 - node.y * t.renderer.scale]);
});

test('clicking a node in the graph keeps the camera where it is', async () => {
  const t = await setup({ layout: 'tree' });
  t.controller.attach();
  const pans = t.renderer.pans.length;
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.equal(t.renderer.pans.length, pans);
});

test('custom colors give every tag node the tag color and turning them off gives the core colors back', async () => {
  const t = await setup({ customColors: true, tagColor: '#12ab3c' });
  t.controller.attach();
  const colors = () => Object.values(t.forwarded.at(-1)!.nodes).filter(n => n.type === 'tag').map(n => n.color as { a: number; rgb: number });
  assert.ok(colors().every(c => c.rgb === 0x12ab3c && c.a === 1));
  t.owner.settings.customColors = false; t.controller.refresh();
  assert.ok(Object.values(t.forwarded.at(-1)!.nodes).every(n => n.color === undefined));
});

const TAG = 0x8b6cef, HIGHLIGHT = 0x6d47eb;
const rgbOf = (t: { renderer: { nodes: { id: string; color: unknown }[] } }, id: string) => (t.renderer.nodes.find(n => n.id === id)!.color as { rgb: number } | null)?.rgb;

test('the selected tag takes the highlight color and the one before goes back to the tag color', async () => {
  const t = await setup({ customColors: true, expanded: ['cs'] });
  t.controller.attach();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.equal(rgbOf(t, '#cs'), HIGHLIGHT); assert.equal(rgbOf(t, '#sec'), TAG);
  t.suggests[0]!.onChoose('ml');
  assert.equal(rgbOf(t, '#ml'), HIGHLIGHT); assert.equal(rgbOf(t, '#cs'), TAG);
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.equal(rgbOf(t, '#cs'), HIGHLIGHT, 'an already expanded tag is highlighted without a re-render');
  assert.equal(rgbOf(t, '#ml'), TAG);
});

test('the highlight toggles add up: the tag itself, its descendants and its directly connected tags', async () => {
  const t = await setup({ customColors: true, expanded: ['cs', 'ml'], highlightSelected: false, highlightDescendants: true });
  t.controller.attach();
  const highlighted = () => t.renderer.nodes.filter(n => (n.color as { rgb?: number } | null)?.rgb === HIGHLIGHT).map(n => n.id).sort();
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.deepEqual(highlighted(), ['#DL', '#crypto', '#ml']);
  Object.assign(t.owner.settings, { highlightSelected: true, highlightDescendants: false, highlightConnected: true }); t.controller.refresh();
  t.suggests[0]!.onChoose('ml');
  assert.deepEqual(highlighted(), ['#DL', '#cs', '#ml']);
  t.owner.settings.customColors = false; t.controller.refresh();
  assert.deepEqual(highlighted(), []);
});

test('with custom colors the sidebar title takes the highlight color unless that is switched off', async () => {
  const t = await setup({ customColors: true });
  const title = () => t.sidebar.all().find(el => el.tag === 'h3')!;
  const panel = t.sidebar.all().find(el => el.classes.has('tag-ontology-panel'))!;
  t.suggests[0]!.onChoose('cs');
  assert.ok(title().classes.has('tag-ontology-accent')); assert.equal(panel.css['--tag-ontology-color'], '#6d47eb');
  t.owner.settings.titleAccent = false; t.controller.refresh();
  assert.ok(!title().classes.has('tag-ontology-accent'));
  Object.assign(t.owner.settings, { titleAccent: true, customColors: false }); t.controller.refresh();
  assert.ok(!title().classes.has('tag-ontology-accent'));
});

test('focus keeps the selected tag looking hovered until something else is hovered or it is turned off', async () => {
  const t = await setup({ focus: true });
  t.controller.attach();
  const node = (id: string) => t.renderer.nodes.find(n => n.id === id);
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.equal(t.renderer.getHighlightNode(), node('#cs'));
  t.renderer.highlightNode = node('#sec');
  assert.equal(t.renderer.getHighlightNode(), node('#sec'), 'hovering another node still wins');
  t.renderer.highlightNode = null;
  t.owner.settings.focus = false; t.controller.refresh();
  assert.equal(t.renderer.getHighlightNode(), null);
  t.controller.destroy();
  assert.equal(t.renderer.getHighlightNode, t.original.getHighlightNode);
});

test('a note-only refresh updates the panel without redrawing the graph', async () => {
  const t = await setup();
  t.controller.attach();
  t.suggests[0]!.onChoose('cs');
  const sent = t.forwarded.length;
  t.owner.model = new Ontology({ cs: { description: 'reloaded', broader: [] } }, []);
  t.controller.refresh(false);
  assert.equal(t.forwarded.length, sent, 'the core graph re-sends its own data for note edits');
  assert.ok(t.sidebar.all().some(el => el.text === 'reloaded'));
});

const heading = (t: { sidebar: Element }) => t.sidebar.all().find(el => el.tag === 'h3' || el.tag === 'h4')!.text;
const navButton = (t: { sidebar: Element }, label: string) => t.sidebar.all().find(el => el.attrs['aria-label'] === label)!;
const expandButton = (t: { sidebar: Element }) => t.sidebar.all().find(el => el.classes.has('tag-ontology-expand'))!;

test('back, forward and home move through the tags shown and disable at the ends', async () => {
  const t = await setup();
  assert.equal(navButton(t, 'Back').attrs['aria-disabled'], 'true'); assert.equal(navButton(t, 'Forward').attrs['aria-disabled'], 'true');
  t.click('#cs'); t.click('#ml');
  assert.equal(heading(t), 'ml');
  t.click('Back');
  assert.equal(heading(t), 'cs'); assert.equal(navButton(t, 'Forward').attrs['aria-disabled'], 'false');
  t.click('Forward');
  assert.equal(heading(t), 'ml'); assert.equal(navButton(t, 'Forward').attrs['aria-disabled'], 'true');
  t.click('Home');
  assert.equal(heading(t), 'Root tags (2)');
  t.click('Back');
  assert.equal(heading(t), 'ml');
});

test('the expand button in the bar shows the state with waypoints or circle-small and stays highlighted', async () => {
  const t = await setup();
  t.click('#cs');
  assert.equal(expandButton(t).attrs.icon, 'waypoints'); assert.equal(expandButton(t).attrs['aria-label'], 'Collapse in graph');
  assert.ok(expandButton(t).classes.has('is-active'));
  t.click('Collapse in graph');
  assert.equal(expandButton(t).attrs.icon, 'circle-small'); assert.equal(expandButton(t).attrs['aria-label'], 'Expand in graph');
  assert.ok(expandButton(t).classes.has('is-active'));
  assert.deepEqual([...t.owner.settings.expanded], []);
});

test('the expand button is disabled on the root list and the title has no button', async () => {
  const t = await setup();
  assert.equal(expandButton(t).attrs['aria-disabled'], 'true'); assert.ok(!expandButton(t).classes.has('is-active'));
  t.click('#cs');
  const header = t.sidebar.all().find(el => el.classes.has('tag-ontology-header'))!;
  assert.deepEqual(header.all().filter(el => el.tag === 'button'), []);
});

test('related lists both directions', async () => {
  const t = await setup();
  t.search('dl');
  const texts = t.sidebar.all().map(el => el.text);
  assert.ok(texts.includes('Related 1')); assert.ok(texts.includes('#overfitting'));
});

const field = (t: { sidebar: Element }, label: string) => t.sidebar.all().find(el => el.attrs['aria-label'] === label && el.tag !== 'button')!;
const button = (t: { sidebar: Element }, text: string) => t.sidebar.all().find(el => el.tag === 'button' && el.text === text)!;
const type = (el: Element, value: string) => { el.value = value; el.events.get('input')!(); };
const byClass = (t: { sidebar: Element }, cls: string) => t.sidebar.all().find(el => el.classes.has(cls));

test('Edit opens a labeled form with the tag\'s values and no note lists', async () => {
  const t = await setup();
  t.click('#cs'); t.click('Edit tag');
  assert.deepEqual(t.sidebar.all().filter(el => el.tag === 'label').map(el => el.text), ['Name', 'Description', 'Aliases', 'Parents', 'Children', 'Related']);
  assert.equal(field(t, 'Name').value, 'cs');
  assert.deepEqual(tagLinks(t.sidebar), ['#crypto', '#ml']);
  assert.ok(!t.sidebar.all().some(el => el.tag === 'summary'));
  assert.ok(navButton(t, 'Edit tag').classes.has('is-active'));
  assert.equal(button(t, 'Save').disabled, true);
});

test('Save sends the draft as an edit change and returns to the tag view', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'Learning');
  assert.equal(byClass(t, 'tag-ontology-count')!.text, '1 change not saved');
  t.click('Save'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(t.owner.changes)), [{ kind: 'edit', tag: 'ml', draft: { name: 'ml', description: 'Learning', aliases: [], parents: ['cs'], children: ['dl', 'overfitting'], related: [] } }]);
  assert.equal(heading(t), 'ml'); assert.equal(t.owner.reloads, 1);
  assert.ok(t.sidebar.all().some(el => el.tag === 'p' && el.text === 'Learning'));
});

test('a refresh while editing keeps the form and the typed text', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  const description = field(t, 'Description');
  type(description, 'typed');
  t.controller.refresh(false);
  assert.equal(field(t, 'Description'), description); assert.equal(description.value, 'typed');
});

test('a second Save click while saving writes once', async () => {
  const t = await setup();
  let finish = (_ok: boolean) => {};
  t.owner.saveChange = (change: Change) => { t.owner.changes.push(change); return new Promise<boolean>(resolve => { finish = resolve; }); };
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'x');
  t.click('Save'); t.click('Save');
  finish(false); await settle();
  assert.equal(t.owner.changes.length, 1);
});

test('a failed save keeps the form and the draft', async () => {
  const t = await setup();
  t.owner.saveChange = async () => false;
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'kept');
  t.click('Save'); await settle();
  assert.equal(field(t, 'Description').value, 'kept'); assert.equal(button(t, 'Save').disabled, false);
});

test('renaming updates the expanded list and the history', async () => {
  const t = await setup({ expanded: ['cs', 'ml'] });
  t.click('#cs'); t.click('#ml'); t.click('Edit tag');
  type(field(t, 'Name'), 'machine-learning');
  t.click('Save'); await settle();
  assert.deepEqual([...t.owner.settings.expanded], ['cs', 'machine-learning']);
  assert.equal(heading(t), 'machine-learning');
  t.click('Back'); assert.equal(heading(t), 'cs');
  t.click('Forward'); assert.equal(heading(t), 'machine-learning');
});

test('the parent picker leaves out the tag, its parents and its descendants', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  t.click('Add a parent');
  const picker = t.suggests.filter(s => s.input.attrs.placeholder === 'Add a parent').at(-1)!;
  const tags = (query: string) => picker.source(query).map(s => s.tag);
  assert.deepEqual([tags('ml'), tags('cs'), tags('dl'), tags('crypto')], [[], [], [], ['crypto']]);
  picker.onChoose('crypto');
  assert.deepEqual(tagLinks(t.sidebar).slice(0, 2), ['#cs', '#crypto']);
});

test('a name error disables Save and shows the message', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Name'), 'CS');
  assert.equal(byClass(t, 'tag-ontology-error')!.text, '#cs is already in the dictionary.');
  assert.equal(button(t, 'Save').disabled, true);
});

test('a rename warns when notes use the old name', async () => {
  const t = await setup();
  t.owner.model = new Ontology(raw, [{ path: 'A.md', tags: ['ml'] }]);
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Name'), 'machine-learning');
  assert.equal(byClass(t, 'tag-ontology-hint')!.text, '1 note uses #ml. It keeps it and it will show as not in the dictionary.');
});

test('a rename that only changes case does not warn, since notes match tags ignoring case', async () => {
  const t = await setup();
  t.owner.model = new Ontology(raw, [{ path: 'A.md', tags: ['ml'] }]);
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Name'), 'ML');
  assert.equal(byClass(t, 'tag-ontology-hint')!.text, '');
  assert.equal(button(t, 'Save').disabled, false);
});

test('the name suggestions are unregistered tags by note count', async () => {
  const t = await setup();
  t.owner.model = new Ontology(raw, [{ path: 'A.md', tags: ['to-read', 'book'] }, { path: 'B.md', tags: ['book'] }]);
  t.click('New tag');
  const name = t.suggests.filter(s => s.input.attrs['aria-label'] === 'Name').at(-1)!;
  assert.deepEqual(JSON.parse(JSON.stringify(name.source(''))), [{ tag: 'book', notes: 2 }, { tag: 'to-read', notes: 1 }]);
  assert.deepEqual([...name.source('READ').map(s => s.tag)], ['to-read']);
  name.onChoose('book');
  assert.equal(field(t, 'Name').value, 'book'); assert.equal(button(t, 'Add').disabled, false);
});

test('Add sends an add change with no parent and shows the new tag', async () => {
  const t = await setup();
  t.click('New tag');
  assert.ok(navButton(t, 'New tag').classes.has('is-active'));
  assert.deepEqual(t.sidebar.all().filter(el => el.tag === 'label').map(el => el.text), ['Name', 'Parents', 'Description', 'Aliases']);
  type(field(t, 'Name'), '#book');
  t.click('Add'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(t.owner.changes)), [{ kind: 'add', draft: { name: 'book', description: '', aliases: [], parents: [], children: [], related: [] } }]);
  assert.equal(heading(t), 'book'); assert.equal(t.owner.reloads, 1);
});

test('Add is disabled until the name is new, ignoring case', async () => {
  const t = await setup();
  t.click('New tag');
  assert.equal(button(t, 'Add').disabled, true);
  assert.equal(byClass(t, 'tag-ontology-hint')!.text, 'Pick one, or type a new name.');
  type(field(t, 'Name'), 'ML');
  assert.equal(byClass(t, 'tag-ontology-error')!.text, '#ml is already in the dictionary.');
  assert.equal(button(t, 'Add').disabled, true);
});

test('Cancel on the new tag form goes back to the tag that was shown', async () => {
  const t = await setup();
  t.search('ml'); t.click('New tag'); t.click('Cancel');
  assert.equal(heading(t), 'ml');
});

const press = (modal: { contentEl: Element }, text: string) => modal.contentEl.all().find(el => el.tag === 'button' && el.text === text)!.events.get('click')!();

test('Delete shows where children go and deletes on confirm', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag'); t.click('Delete');
  const modal = t.modals.at(-1)!;
  assert.equal(modal.titleEl.text, 'Delete #ml?');
  assert.deepEqual(modal.contentEl.all().filter(el => el.tag === 'li').map(el => el.text), ['2 children move under #cs']);
  press(modal, 'Delete'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(t.owner.changes)), [{ kind: 'delete', tag: 'ml' }]);
  assert.equal(heading(t), 'cs');
});

test('the delete dialog lists related tags, notes and children that become roots', async () => {
  const t = await setup();
  t.owner.model = new Ontology(raw, [{ path: 'A.md', tags: ['dl'] }]);
  t.search('dl'); t.click('Edit tag'); t.click('Delete');
  assert.deepEqual(t.modals.at(-1)!.contentEl.all().filter(el => el.tag === 'li').map(el => el.text),
    ['Removed from related of #overfitting', '1 note keeps #dl; it will show as not in the dictionary.']);
  press(t.modals.at(-1)!, 'Cancel');
  t.search('sec'); t.click('Edit tag'); t.click('Delete');
  assert.deepEqual(t.modals.at(-1)!.contentEl.all().filter(el => el.tag === 'li').map(el => el.text), []);
});

test('Cancel in the delete dialog writes nothing', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag'); t.click('Delete');
  press(t.modals.at(-1)!, 'Cancel');
  assert.deepEqual(t.owner.changes, []);
  assert.equal(field(t, 'Name').value, 'ml');
});

test('clicking a graph tag with unsaved changes asks first and Keep editing stays', async () => {
  const t = await setup();
  t.controller.attach();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'typed');
  const expanded = [...t.owner.settings.expanded];
  (t.renderer.onNodeClick as (...args: unknown[]) => void)({}, '#cs', 'tag');
  assert.equal(t.modals.at(-1)!.titleEl.text, '1 change to #ml is not saved');
  press(t.modals.at(-1)!, 'Keep editing');
  assert.equal(field(t, 'Description').value, 'typed');
  assert.deepEqual([...t.owner.settings.expanded], expanded);
});

test('Discard drops the draft and follows the navigation', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'typed');
  t.click('Home');
  press(t.modals.at(-1)!, 'Discard');
  assert.equal(heading(t), 'Root tags (2)'); assert.deepEqual(t.owner.changes, []);
});

test('Save in the dialog follows the navigation only after a successful save', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'typed');
  t.owner.saveChange = async () => false;
  t.click('Home'); press(t.modals.at(-1)!, 'Save'); await settle();
  assert.equal(field(t, 'Description').value, 'typed');
  t.owner.saveChange = async (change: Change) => { t.owner.changes.push(change); t.owner.raw = apply(t.owner.raw, change); return true; };
  t.click('Home'); press(t.modals.at(-1)!, 'Save'); await settle();
  assert.equal(t.owner.changes.length, 1); assert.equal(heading(t), 'Root tags (2)');
});

test('Cancel with changes asks too, and without changes navigation leaves the form without asking', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'typed');
  t.click('Cancel');
  assert.equal(t.modals.length, 1);
  press(t.modals.at(-1)!, 'Discard');
  assert.equal(heading(t), 'ml');
  t.click('Edit tag'); t.click('Home');
  assert.equal(t.modals.length, 1); assert.equal(heading(t), 'Root tags (2)');
});

test('a tag whose key breaks the name rules can still be edited when the name stays', async () => {
  const t = await setup();
  t.owner.raw = { ...raw, 'v1.0': { description: '', broader: [] } }; t.owner.model = new Ontology(t.owner.raw, []);
  t.search('v1.0'); t.click('Edit tag');
  type(field(t, 'Description'), 'version');
  assert.equal(byClass(t, 'tag-ontology-error'), undefined); assert.equal(button(t, 'Save').disabled, false);
  t.click('Save'); await settle();
  assert.equal(t.owner.changes.length, 1);
});

test('reopening the sidebar tab while editing shows the form again', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  type(field(t, 'Description'), 'typed');
  const reopened = new Element();
  t.controller.mount(reopened);
  assert.equal(reopened.all().find(el => el.attrs['aria-label'] === 'Description')!.value, 'typed');
});

test('the pickers only offer tags that were in the dictionary when the form opened', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  t.owner.model = new Ontology({ ...raw, later: { description: '', broader: [] } }, []);
  t.click('Add a child');
  const picker = t.suggests.filter(s => s.input.attrs.placeholder === 'Add a child').at(-1)!;
  assert.deepEqual([...picker.source('later')], []);
});

test('an alias typed without Enter counts as a change and is saved', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  t.click('Add an alias');
  type(t.sidebar.all().find(el => el.attrs.placeholder === 'Add an alias')!, 'Machine learning ');
  assert.equal(byClass(t, 'tag-ontology-count')!.text, '1 change not saved');
  t.click('Save'); await settle();
  assert.deepEqual([...t.owner.changes[0]!.kind === 'edit' ? (t.owner.changes[0] as { draft: { aliases: string[] } }).draft.aliases : []], ['Machine learning']);
});

test('a missing dictionary file shows how to create one and turns off New tag and Edit', async () => {
  const t = await setup();
  t.owner.missing = true; t.controller.refresh(false);
  assert.equal(heading(t), 'Tag dictionary not found');
  assert.equal(navButton(t, 'New tag').disabled, true); assert.equal(navButton(t, 'Edit tag').disabled, true);
  t.click('Create empty dictionary'); await settle();
  assert.equal(t.owner.created, 1);
});

test('the panel comes back when the dictionary file returns', async () => {
  const t = await setup();
  t.owner.missing = true; t.controller.refresh(false);
  t.owner.missing = false; t.controller.refresh(false);
  assert.equal(heading(t), 'Root tags (2)'); assert.equal(navButton(t, 'New tag').disabled, false);
});

test('a dictionary that stops loading shows why above the last version and turns off New tag and Edit until it loads again', async () => {
  const t = await setup();
  t.click('#cs'); t.owner.error = 'ml.broader: unknown tag ai'; t.controller.renderPanel();
  assert.equal(heading(t), 'Could not load the tag dictionary');
  assert.ok(t.sidebar.all().some(el => el.text === 'ml.broader: unknown tag ai'));
  assert.ok(t.sidebar.all().some(el => el.tag === 'h3' && el.text === 'cs'));
  assert.equal(navButton(t, 'New tag').disabled, true); assert.equal(navButton(t, 'Edit tag').disabled, true);
  t.owner.error = undefined; t.controller.refresh(false);
  assert.equal(heading(t), 'cs');
  assert.equal(navButton(t, 'New tag').disabled, false); assert.equal(navButton(t, 'Edit tag').disabled, false);
});

test('a dictionary that never loaded shows why instead of an empty panel', async () => {
  const t = await setup();
  t.owner.model = undefined; t.owner.error = 'Invalid JSON: Unexpected end of JSON input'; t.controller.renderPanel();
  assert.equal(heading(t), 'Could not load the tag dictionary');
  assert.ok(!t.sidebar.all().some(el => el.text.startsWith('The graph and this panel')));
  assert.equal(navButton(t, 'New tag').disabled, true);
});

test('the pickers do not take Object properties such as constructor for dictionary tags', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  t.owner.model = new Ontology({ ...raw, constructor: { description: '', broader: [] } }, []);
  t.click('Add a child');
  const picker = t.suggests.filter(s => s.input.attrs.placeholder === 'Add a child').at(-1)!;
  assert.deepEqual([...picker.source('constructor')], []);
});

test('a tag has no Add a child button, and a tag without children shows no Children list', async () => {
  const t = await setup();
  t.search('dl');
  assert.equal(t.sidebar.all().some(el => el.attrs['aria-label'] === 'Add a child'), false);
  assert.equal(t.sidebar.all().some(el => el.tag === 'summary' && el.text.startsWith('Children')), false);
});

test('the search box hides while a form is open', async () => {
  const t = await setup();
  const search = () => t.sidebar.all().find(el => el.attrs['aria-label'] === 'Search tags or aliases')!;
  assert.equal(search().hidden, false);
  t.search('ml'); t.click('Edit tag');
  assert.equal(search().hidden, true);
  t.click('Cancel');
  assert.equal(search().hidden, false);
  t.click('New tag');
  assert.equal(search().hidden, true);
});

test('the + next to a field opens its input, which stays open while adding and closes on a second press', async () => {
  const t = await setup();
  t.search('ml'); t.click('Edit tag');
  const input = (placeholder: string) => t.sidebar.all().find(el => el.tag === 'input' && el.attrs.placeholder === placeholder);
  for (const placeholder of ['Add an alias', 'Add a parent', 'Add a child', 'Add a related tag']) assert.equal(input(placeholder), undefined, placeholder);
  // The + follows the last item of its field, not the field's name.
  assert.ok(t.sidebar.all().filter(el => el.tag === 'label').every(label => !label.children.length));
  const row = t.sidebar.all().find(el => el.classes.has('tag-ontology-tags') && el.children.some(child => child.attrs['aria-label'] === 'Add a child'))!;
  assert.deepEqual(row.children.slice(-2).map(child => child.text || child.attrs['aria-label']), ['#overfitting', 'Add a child']);
  t.click('Add an alias');
  assert.ok(input('Add an alias')!.focused); assert.ok(navButton(t, 'Add an alias').classes.has('is-active'));
  input('Add an alias')!.value = 'ML'; input('Add an alias')!.events.get('keydown')!({ key: 'Enter' });
  assert.deepEqual(t.sidebar.all().filter(el => el.classes.has('tag-ontology-chip')).map(el => el.text).slice(0, 1), ['ML']);
  assert.ok(input('Add an alias')!.focused);
  t.click('Add a related tag');
  assert.equal(input('Add an alias'), undefined); assert.ok(input('Add a related tag'));
  t.click('Add a related tag');
  assert.equal(input('Add a related tag'), undefined);
});

test('the new tag form opens its parent and alias inputs with + too', async () => {
  const t = await setup();
  t.click('New tag');
  assert.equal(t.sidebar.all().some(el => el.tag === 'input' && el.attrs.placeholder === 'Add a parent'), false);
  t.click('Add a parent');
  assert.ok(t.sidebar.all().some(el => el.tag === 'input' && el.attrs.placeholder === 'Add a parent'));
});
