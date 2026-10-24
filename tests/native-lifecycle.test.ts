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
  tag = ''; children: Element[] = []; text = ''; hidden = false; value = ''; removed = false; attrs: Record<string, string> = {}; classes = new Set<string>();
  events = new Map<string, (event?: unknown) => void>();
  css: Record<string, string> = {};
  setCssProps(props: Record<string, string>) { Object.assign(this.css, props); }
  createDiv(cls?: string) { return this.createEl('div', { cls }); }
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
type Controller = { attach(): void; refresh(redraw?: boolean): void; destroy(): void; mount(el: Element): void };

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

// Both layouts are stubbed with tags in one row, 400 apart.
const inRow = (tags: string[]) => new Map(tags.map((tag, i) => [tag, { x: i * 400, y: 0 }]));

async function setup(settings: Partial<Settings> = {}, sendOnUpdate = true, firstRun = false, showTags = false) {
  const notices: string[] = [], sideCalls: object[] = [];
  const suggests: { source: (query: string) => unknown[]; onChoose: (tag: string) => void }[] = [];
  const context = createContext({
    performance, devicePixelRatio: 1, window: { requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
    document: { visibilityState: 'visible' }, createEl: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  const code = await transform(readFileSync(new URL('../src/native.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian' ? { Notice: class { constructor(message: string) { notices.push(message); } }, TFile: File,
        setIcon: (el: Element, id: string) => { el.attrs.icon = id; }, setTooltip: (el: Element, text: string) => { el.attrs.tooltip = el.attrs['aria-label'] = text; } }
      : specifier === './layout.ts' ? { hierarchyPositions: inRow, treePositions: inRow }
      : specifier === './search.ts' ? { TagSuggest: class { constructor(_app: unknown, _input: unknown, source: (query: string) => unknown[], onChoose: (tag: string) => void) { suggests.push({ source, onChoose }); } } }
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
    fShowArrow: true, worker: { postMessage() {} }, workerResults: null, width: 800, height: 600, targetScale: 1, scale: 1,
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
    model, settings: { ...DEFAULT_SETTINGS, ...settings }, saves: 0, firstRun,
    async saveState() { owner.saves++; }, async saveSettings() {},
    app: { workspace: {
      getLeavesOfType: () => leaves,
      ensureSideLeaf: (type: string, side: string, options: object) => { sideCalls.push({ type, side, ...options }); return Promise.resolve(); },
    }, vault: { getAbstractFileByPath: () => null } },
  };
  const controller = new NativeGraphs(owner);
  // Obsidian restores the sidebar view on startup, so tests start with it mounted.
  const sidebar = new Element();
  controller.mount(sidebar);
  const all = () => [...contentEl.all(), ...sidebar.all()];
  const ids = () => Object.keys(forwarded.at(-1)!.nodes).sort();
  const click = (label: string) => all().find(el => el.text === label || el.attrs['aria-label'] === label)!.events.get('click')!();
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
  return { controller, renderer, original, contentEl, sidebar, all, owner, forwarded, engineClicks, notices, ids, click, search, dashTexture, addTab, graphOptions, optionWrites, suggests, sideCalls, leaves };
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
  t.owner.settings.layout = 'radial'; t.controller.refresh();
  assert.equal(t.renderer.scale, fitted, 'switching layout refits the new positions');
  const radial = t.contentEl.all().find(el => el.attrs['aria-label'] === 'Layout: Radial')!;
  assert.equal(radial.attrs['aria-pressed'], 'true', 'the toolbar shows a layout changed in settings');
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
  t.click('Collapse children and notes');
  t.click('Expand all');
  assert.ok(t.all().some(el => el.attrs['aria-label'] === 'Collapse children and notes'), 'the label follows Expand all');
  t.click('Collapse children and notes');
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
  assert.deepEqual(icons.map(el => el.attrs.icon), ['chevrons-down-up', 'chevrons-up-down', 'scan', 'file-text', 'link', 'book-open-check', 'share-2', 'network', 'list-tree', 'orbit']);
  assert.deepEqual(icons.map(el => el.attrs.tooltip), ['Collapse all', 'Expand all', 'Fit', 'Notes: shown', 'Related: shown', 'Dictionary check', 'Layout: Force', 'Layout: Vertical tree', 'Layout: Horizontal tree', 'Layout: Radial']);
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

test('tree pins every node and rings the tags outside the hierarchy around it', async () => {
  const t = await setup({ layout: 'tree' });
  t.controller.attach();
  assert.ok(t.renderer.nodes.every(n => n.fx === n.x && n.fy === n.y));
  // The fake layout puts the roots cs and sec at x 0 and 400, so the ring is 150 beyond half that width.
  const outside = t.renderer.nodes.filter(n => n.id === '#loose' || n.id === '#to-read');
  assert.deepEqual(outside.map(n => Math.round(Math.hypot(n.x - 200, n.y))), [350, 350]);
});

test('the notes button is disabled in tree', async () => {
  const t = await setup({ layout: 'tree', showNotes: true });
  t.controller.attach();
  const notes = t.contentEl.all().find(el => el.attrs.icon === 'file-text')!;
  assert.equal(notes.attrs['aria-disabled'], 'true');
  assert.equal(notes.attrs.tooltip, 'Notes are hidden in Tree and Radial');
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
