import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology, isIncludedNote } from 'tag-ontology';
import * as settings from '../src/settings.ts';
import * as colors from '../src/colors.ts';
import * as palettes from '../src/palettes.ts';
import * as coreModule from 'tag-ontology';
import { vaultData } from '../src/vault-data.ts';
import { apply, draftOf, serialize, type Change, type RawDictionary } from 'tag-ontology';
import type { NativeData } from '../src/layer.ts';
import type { Setting, SettingDefinitionItem, SettingDefinitionGroup } from 'obsidian';

const dictionarySetting = (tab: { getSettingDefinitions(): SettingDefinitionItem[] }) =>
  (tab.getSettingDefinitions()[0] as SettingDefinitionGroup).items![0];

const dictionary = JSON.stringify({ root: { description: 'Root', broader: [] } });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class NativeGraphs {
  calls: string[] = [];
  linkedCalls: string[] = [];
  recolors = 0;
  // Like the real one, a redraw reads the tag color (the sidebar title and the graph's tags take it).
  owner?: { tagColor(): string; settings?: settings.Settings };
  savedExpandedOverride?: string[];
  get savedExpanded() { return this.savedExpandedOverride ?? this.owner?.settings?.expanded ?? []; }
  constructor(owner?: { tagColor(): string; settings?: settings.Settings }) { this.owner = owner; }
  attach() { this.calls.push('attach'); }
  refresh(redraw = true, linked = 'refresh') { this.owner?.tagColor(); this.calls.push(`refresh:${redraw}`); this.linkedCalls.push(linked); }
  recolor() { this.recolors++; }
  showPanel(reveal: boolean) { this.calls.push(`panel:${reveal}`); }
  renderPanel() { this.calls.push('render-panel'); }
  drawLinked() { this.calls.push('draw-linked'); }
  modes: string[] = [];
  async switchMode(_leaf: unknown, mode: string) { this.modes.push(mode); }
  destroy() { this.calls.push('destroy'); }
}

interface Main {
  deletePalette(name: string): Promise<void>; managePalettes(): void;
  native: NativeGraphs; tagColor(tag?: string): string; model?: Ontology; settings: settings.Settings; raw?: RawDictionary; error?: string;
  app: { fileManager: { renameFile(file: { path: string }, path: string): Promise<void> } };
  dictionaryPath: string; dictionaryFound: boolean; resolveDictionary(): Promise<string>; checkOutsideChange(): Promise<void>; setDictionaryPath(path: string): Promise<void>; resetDictionaryPath(): Promise<void>;
  saveChange(change: Change, base: RawDictionary): Promise<boolean>; createDictionary(): Promise<boolean>;
  saveData(data?: unknown): Promise<void>; onload(): Promise<void>; onunload(): void; loadModel(): Promise<Ontology>; openView(graph?: '2d' | '3d' | 'explorer', newTab?: boolean): Promise<void>; saveSettings(): Promise<void>; setPaletteColor(depth: number, color: string): Promise<void>; choosePalette(key: string): Promise<void>; savePaletteAs(name: string): Promise<void>; promptSavePalette(): void; saveState(): Promise<void>; graphData(): NativeData;
}

async function setup(saved?: Promise<unknown>) {
  let modernSettings = true;
  const notices: string[] = [], errors: unknown[][] = [], ui: string[] = [], settingRows: TestSetting[] = [], settingTabs: object[] = [], savedWrites: unknown[] = [];
  // Each command's action, and whether the command palette offers it.
  const commands = new Map<string, () => void>(), offered = new Map<string, () => boolean>();
  const events = new Map<string, (file: { path: string }) => void>();
  const timers = new Map<number, () => void>();
  // The theme's accent variable, and the observers watching <body>'s style for the accent color setting.
  const theme = { accent: 'hsl(258, 88%, 66%)' }, observers: (() => void)[] = [], cleanups: (() => void)[] = [];
  let watching = 0, focusListener: (() => void) | undefined;
  let ready = () => {}, timer = 0, reads = 0;
  class File { path: string; constructor(path = '') { this.path = path; } }
  class Folder { path: string; constructor(path = '') { this.path = path; } }
  class TestSetting {
    controlEl = { empty() {}, createDiv() { return { createDiv() { return { setAttribute() {} }; } }; } };
    settingEl = { hidden: false, addClass() {}, toggle(value: boolean) { this.hidden = !value; }, buttons: [] as { hidden: boolean }[], querySelectorAll() { return this.buttons; } };
    name = ''; desc?: string; textValue?: string; textPlaceholder?: string; textCommitted?: () => void; toggleChanged?: (value: boolean) => void;
    keyDown?: (event: { key: string; isComposing?: boolean; preventDefault(): void }) => void;
    colorValue = ''; colorChanged?: (value: string) => Promise<void>; dropdownValue = ''; dropdownChanged?: (value: string) => void;
    buttons: (() => void)[] = []; buttonNames: string[] = []; buttonEls: { hidden: boolean; removed: boolean }[] = [];
    constructor() { settingRows.push(this); }
    heading = false; setHeading() { this.heading = true; return this; }
    setName(name: string) { this.name = name; return this; }
    setDesc(desc: string) { this.desc = desc; return this; }
    addText(callback: (text: { inputEl: { addEventListener(type: string, cb: () => void): void }; getValue(): string; setValue(value: string): unknown; setPlaceholder(value: string): unknown; onChange(callback: (value: string) => void): unknown }) => void) {
      const text = {
        inputEl: { addEventListener: (type: string, cb: () => void) => { if (type === 'change') this.textCommitted = cb; if (type === 'keydown') this.keyDown = cb; } },
        getValue: () => this.textValue ?? '',
        setValue: (value: string) => { this.textValue = value; return text; },
        setPlaceholder: (value: string) => { this.textPlaceholder = value; return text; },
        onChange: (_cb: (value: string) => void) => text,
      };
      callback(text); return this;
    }
    addToggle(callback: (toggle: { setValue(value: boolean): { onChange(callback: (value: boolean) => void): void }; onChange(callback: (value: boolean) => void): void }) => void) {
      const onChange = (cb: (value: boolean) => void) => { this.toggleChanged = cb; };
      callback({ setValue: () => ({ onChange }), onChange }); return this;
    }
    addColorPicker(callback: (picker: { setValue(value: string): unknown; onChange(cb: (value: string) => Promise<void>): unknown }) => void) {
      const picker = { setValue: (value: string) => { this.colorValue = value; return picker; }, onChange: (cb: (value: string) => Promise<void>) => { this.colorChanged = cb; return picker; } };
      callback(picker); return this;
    }
    addDropdown(callback: (dropdown: { addOption(key: string, name: string): unknown; setValue(value: string): unknown; onChange(cb: (value: string) => void): unknown }) => void) {
      const dropdown = { selectEl: { value: '', empty() {}, createEl() { return { createEl() {} }; } }, addOption: (_key: string, _name: string) => dropdown,
        setValue: (value: string) => { this.dropdownValue = value; return dropdown; },
        onChange: (cb: (value: string) => void) => { this.dropdownChanged = cb; return dropdown; } };
      callback(dropdown); return this;
    }
    addExtraButton(callback: (button: { setIcon(icon: string): { setTooltip(text: string): { onClick(callback: () => void): void } }; setTooltip(text: string): { onClick(callback: () => void): void }; onClick(callback: () => void): void }) => void) {
      const click = (cb: () => void) => { this.buttons.push(cb); };
      const button = { setIcon: (_icon: string) => ({ setTooltip: (_text: string) => ({ onClick: click }) }),
        setTooltip: (_text: string) => ({ onClick: click }), onClick: click };
      callback(button); return this;
    }
    addButton(callback: (button: { buttonEl: { hidden: boolean; remove(): void }; setButtonText(text: string): { onClick(callback: () => void): void }; onClick(callback: () => void): void }) => void) {
      const index = this.buttonNames.length, buttonEl = { hidden: false, removed: false, remove() { buttonEl.removed = true; } }, click = (cb: () => void) => { this.buttons[index] = cb; };
      this.buttonEls[index] = buttonEl;
      this.settingEl.buttons.push(buttonEl);
      callback({ buttonEl, setButtonText: text => { this.buttonNames[index] = text; return { onClick: click }; }, onClick: click }); return this;
    }
  }
  const modals: TestModal[] = [];
  class TestModal {
    closed = false; errorText = ''; title = '';
    titleEl = { setText: (text: string) => { this.title = text; } };
    contentEl = { empty() {}, createDiv: () => ({ setAttribute() {}, setText: (text: string) => { this.errorText = text; } }) };
    onOpen() {} open() { modals.push(this); this.onOpen(); } close() { this.closed = true; }
  }
  class TestPluginSettingTab {
    app: unknown; containerEl = { empty() {} };
    constructor(app: unknown) { this.app = app; }
    definitions?: SettingDefinitionItem[];
    update() { this.definitions = (this as unknown as { getSettingDefinitions(): SettingDefinitionItem[] }).getSettingDefinitions(); }
    hide() {}
  }
  const types: string[] = [], open = new Map<string, unknown[]>();
  const leaf = { view: { getViewType: () => 'graph' }, async setViewState(state: { type: string }) { ui.push('create'); types.push(state.type); } };
  const vault: {
    configDir: string; getAbstractFileByPath(path: string): File | Folder | null; getMarkdownFiles(): unknown[];
    text: string; writes: string[]; adapterWrites: string[]; existing: Set<string>; created: string[]; targetAppearsOnFolderCreate: boolean;
    files: Map<string, string>; mtimes: Map<string, number>; sizes: Map<string, number>; appearOnMkdir: boolean; renames: [string, string][];
    adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void>; mkdir(path: string): Promise<void>; stat(path: string): Promise<{mtime: number; size: number} | null>; readdir(path: string): Promise<string[]> };
    createFolder(path: string): Promise<void>; create(path: string, data: string): Promise<void>; cachedRead(file: unknown): Promise<string>; process(file: unknown, fn: (text: string) => string): Promise<string>; on(name: string, callback: (file: {path: string}) => void): void;
  } = {
    configDir: '.obsidian', getAbstractFileByPath: (path: string) => vault.existing.has(path) ? (path.endsWith('.json') ? new File(path) : new Folder(path)) : null, getMarkdownFiles: () => [],
    text: dictionary, writes: [] as string[], adapterWrites: [] as string[],
    existing: new Set(['Tag-Dictionary.json']), created: [] as string[], targetAppearsOnFolderCreate: false,
    files: new Map<string, string>(), mtimes: new Map<string, number>(), sizes: new Map<string, number>(), renames: [],
    appearOnMkdir: false,
    adapter: {
      exists: async (path: string) => vault.existing.has(path),
      async read(path: string) { reads++; if (!vault.files.has(path)) throw new Error(`ENOENT: ${path}`); return vault.files.get(path)!; },
      async write(path: string, data: string) { vault.adapterWrites.push(data); vault.files.set(path, data); vault.sizes.set(path, data.length); vault.existing.add(path); vault.mtimes.set(path, (vault.mtimes.get(path) ?? 0) + 1); },
      async mkdir(path: string) {
        vault.existing.add(path);
        if (vault.appearOnMkdir) { vault.files.set('.tow/tag-dictionary.json', serialize(base)); vault.existing.add('.tow/tag-dictionary.json'); }
      },
      async stat(path: string) { return vault.mtimes.has(path) ? { mtime: vault.mtimes.get(path)!, size: vault.sizes.get(path) ?? 0 } : null; },
      async readdir(path: string) { return path === '.tow' && vault.existing.has('.tow') ? ['tag-dictionary.json'] : []; },
    },
    async createFolder(path: string) { vault.created.push(`folder:${path}`); vault.existing.add(path); if (vault.targetAppearsOnFolderCreate) vault.existing.add('tow/tag-dictionary.json'); },
    // Like Obsidian, create refuses a path that already exists.
    async create(path: string, data: string) {
      if (vault.existing.has(path)) throw new Error('File already exists.');
      const parent = path.split('/').slice(0, -1).join('/');
      if (parent && !vault.existing.has(parent)) throw new Error('Folder does not exist.');
      vault.created.push(`file:${path}:${data}`); vault.existing.add(path);
    },
    async cachedRead(file: unknown) { reads++; return vault.files.get((file as File).path) ?? vault.text; },
    // Like Obsidian, a throwing callback rejects without writing.
    async process(_file: unknown, fn: (text: string) => string) { const out = fn(vault.text); vault.text = out; vault.writes.push(out); return out; },
    on(name: string, callback: (file: { path: string }) => void) { events.set(name, callback); },
  };
  // Like Obsidian's, on() hands back a ref that offref() takes to stop listening.
  const metaEvents = new Map<string, () => void>();
  const metadataCache = { on(name: string, callback: () => void) { metaEvents.set(name, callback); return { name }; }, offref(ref: { name: string }) { metaEvents.delete(ref.name); },
    getFileCache: () => ({}), resolvedLinks: {} as Record<string, Record<string, number>> };
  const workspaceEvents = new Map<string, () => void>();
  const workspace = {
    getActiveViewOfType: () => undefined,
    getLeavesOfType: (type: string) => open.get(type) ?? [], getLeaf: () => leaf,
    async revealLeaf() { ui.push('reveal'); },
    setActiveLeaf(_leaf: unknown, { focus }: { focus: boolean }) { ui.push(focus ? 'focus' : 'active'); },
    on(name: string, callback: () => void) { workspaceEvents.set(name, callback); },
    trigger(name: string) { workspaceEvents.get(name)?.(); },
    onLayoutReady(callback: () => void) { ready = callback; },
  };
  const app = { vault, workspace, metadataCache, fileManager: { async renameFile(file: { path: string }, path: string) {
    vault.renames.push([file.path, path]);
    if (vault.existing.has(path)) throw new Error(`File already exists: ${path}`);
    const data = file.path === 'Tag-Dictionary.json' ? vault.text : vault.files.get(file.path)!;
    vault.existing.delete(file.path); vault.files.delete(file.path); vault.existing.add(path); vault.files.set(path, data); vault.text = data;
  } } };
  class Plugin {
    app = app;
    loadData() { return saved ?? Promise.resolve({ locationNoticeShown: true }); }
    async saveData(data?: unknown) { savedWrites.push(data); }
    registerView() { ui.push('register-view'); }
    addRibbonIcon() {} addSettingTab(tab: object) { settingTabs.push(tab); } registerEvent() {}
    registerDomEvent(target: { addEventListener(type: string, callback: () => void): void }, type: string, callback: () => void) { target.addEventListener(type, callback); }
    register(cleanup: () => void) { cleanups.push(cleanup); }
    addCommand({ id, callback, checkCallback }: { id: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean }) {
      commands.set(id, callback ?? (() => { checkCallback!(false); }));
      offered.set(id, () => checkCallback?.(true) ?? true);
    }
  }
  const context = createContext({ performance, console: { error: (...args: unknown[]) => errors.push(args) },
    document: { body: {} }, getComputedStyle: () => ({ getPropertyValue: (name: string) => name === '--color-accent' ? theme.accent : '' }),
    MutationObserver: class { constructor(callback: () => void) { observers.push(callback); } observe() { watching++; } disconnect() { watching--; } },
    window: {
    addEventListener(type: string, callback: () => void) { if (type === 'focus') focusListener = callback; },
    setTimeout(callback: () => void) { timers.set(++timer, callback); return timer; },
    clearTimeout(id: number) { timers.delete(id); },
  } });
  const code = await transform(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian'
      ? { requireApiVersion: () => modernSettings, Modal: TestModal, Plugin, ItemView: class {}, PluginSettingTab: TestPluginSettingTab, Setting: TestSetting, TFile: File, getAllTags: (cache?: { tags?: string[] }) => cache?.tags ?? [],
        Notice: class { constructor(message: string) { notices.push(message); } } }
      : specifier === './colors.ts' ? { ...colors }
      : specifier === './palettes.ts' ? { ...palettes }
      : specifier === './settings.ts' ? { ...settings }
      : specifier === 'tag-ontology' ? { ...coreModule }
      : specifier === './vault-data.ts' ? { vaultData }
      : specifier === './graph3d.ts' ? { VIEW_3D: 'tag-ontology-3d', Graph3DView: class {} }
      : specifier === './explorer.ts' ? { VIEW_EXPLORER: 'tag-ontology-explorer', ExplorerView: class {} }
      : { NativeGraphs, PANEL_VIEW: 'tag-ontology-panel' };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const Constructor = (module.namespace as { default: new() => Main }).default;
  const plugin = new Constructor(), loaded = plugin.onload();
  if (!saved) { await loaded; ui.length = 0; }
  const runTimers = () => { const due = [...timers.values()]; timers.clear(); due.forEach(callback => callback()); };
  // Obsidian's accent color setting rewrites the accent variables on <body> and fires no event.
  const restyle = (accent: string, viaCss = false) => { theme.accent = accent; if (viaCss) workspace.trigger('css-change'); else observers.forEach(observer => observer()); };
  return { modals, plugin, loaded, vault, workspace, metadataCache, metaEvents, leaf, types, open, notices, errors, ui, commands, offered, events, ready: () => ready(), focus: async () => { focusListener?.(); await settle(); }, runTimers, reads: () => reads,
    legacySettings: () => { modernSettings = false; }, restyle, settingRows, settingTabs, newSetting: () => new TestSetting(), file: (path = '') => new File(path), savedWrites, watching: () => watching, unload: () => { plugin.onunload(); cleanups.forEach(cleanup => cleanup()); } };
}

test('an existing install sees the new dictionary location notice only once', async () => {
  const t = await setup(Promise.resolve({}));
  await t.loaded;
  assert.equal(t.notices.length, 1);
  assert.match(t.notices[0]!, /tow\/tag-dictionary\.json/);
  assert.match(t.notices[0]!, /Tag-Dictionary\.json keeps working/);
  assert.equal((t.savedWrites.at(-1) as settings.Settings).locationNoticeShown, true);
});

test('a fresh install records the location notice flag without showing a notice', async () => {
  const t = await setup(Promise.resolve(null));
  await t.loaded;
  assert.deepEqual(t.notices, []);
  assert.equal((t.savedWrites.at(-1) as settings.Settings).locationNoticeShown, true);
});

test('an install already using tow/ records the location notice flag without a notice', async () => {
  const t = await setup(Promise.resolve({}));
  t.vault.existing.add('tow/tag-dictionary.json');
  await t.loaded;
  assert.deepEqual(t.notices, []);
  assert.equal((t.savedWrites.at(-1) as settings.Settings).locationNoticeShown, true);
});

test('opening a graph still loads the dictionary, attaches and reveals it, and brings the sidebar tab forward', async () => {
  const t = await setup();
  await t.plugin.openView();
  assert.deepEqual(t.plugin.model!.roots, ['root']);
  assert.deepEqual(t.plugin.native.calls, ['refresh:false', 'panel:true']);
  assert.deepEqual(t.ui, ['create', 'reveal']);
});

test('opening the 3D mode uses a graph tab and the sidebar', async () => {
  const t = await setup();
  await t.plugin.openView('3d');
  assert.deepEqual(t.types, ['graph']);
  assert.deepEqual(t.plugin.native.modes, ['3d']);
  assert.deepEqual(t.plugin.native.calls, ['refresh:false', 'panel:true']);
  assert.deepEqual(t.ui, ['create', 'reveal']);
});

test('opening the 3D mode reuses a graph tab and makes it active', async () => {
  const t = await setup();
  t.open.set('graph', [t.leaf]);
  await t.plugin.openView('3d');
  assert.deepEqual(t.types, []);
  // Revealing only brings the tab to the front; keys like Ctrl+W would still go to the tab that was active.
  assert.deepEqual(t.ui, ['reveal', 'focus']);
});

test('Open graph opens the 2D graph even with a 3D tab open', async () => {
  const t = await setup();
  t.open.set('tag-ontology-3d', [t.leaf]);
  t.commands.get('open-graph')!(); await settle();
  assert.deepEqual(t.types, ['graph']);
});

test('explicit new-tab opening creates a graph even when another graph already exists', async () => {
  const t = await setup(); t.open.set('graph', [t.leaf]);
  await t.plugin.openView('explorer', true);
  assert.deepEqual(t.types, ['graph']);
  assert.deepEqual(t.plugin.native.modes, ['explorer']);
  assert.deepEqual(t.ui, ['create', 'reveal']);
});

test('Open 3D graph is offered only while the 3D view is on, and turning it off closes the 3D tabs', async () => {
  const t = await setup();
  assert.equal(t.offered.get('open-3d-graph')!(), true);
  t.commands.get('open-3d-graph')!(); await settle();
  assert.deepEqual(t.types, ['graph']);
  assert.deepEqual(t.plugin.native.modes, ['3d']);
  const tab = { closed: false, detach() { tab.closed = true; } };
  t.open.set('tag-ontology-3d', [tab]);
  t.plugin.settings.enable3d = false;
  await t.plugin.saveSettings();
  assert.equal(t.offered.get('open-3d-graph')!(), false);
  assert.equal(tab.closed, true, 'so the tab does not load three.js again on the next start');
});

test('Open ontology explorer is offered only while the explorer is on, and turning it off closes the explorer tabs', async () => {
  const t = await setup();
  assert.equal(t.offered.get('open-explorer')!(), true);
  t.commands.get('open-explorer')!(); await settle();
  assert.deepEqual(t.types, ['graph']);
  assert.deepEqual(t.plugin.native.modes, ['explorer']);
  const tab = { closed: false, detach() { tab.closed = true; } };
  t.open.set('tag-ontology-explorer', [tab]);
  t.plugin.settings.enableExplorer = false;
  await t.plugin.saveSettings();
  assert.equal(t.offered.get('open-explorer')!(), false);
  assert.equal(tab.closed, true);
});

test('graphData links notes to included notes only', async () => {
  const t = await setup();
  (t.vault as { getMarkdownFiles: () => unknown[] }).getMarkdownFiles = () => [{ path: 'A.md' }, { path: 'B.md' }];
  t.metadataCache.resolvedLinks = { 'A.md': { 'B.md': 1, 'pic.png': 1 } };
  const { nodes } = t.plugin.graphData();
  assert.deepEqual(nodes['A.md'].links, { 'B.md': true });
  assert.deepEqual(nodes['B.md'].links, {});
});

for (const action of ['refresh', 'open'] as const) {
  test(`${action} does not reconnect or open a graph when unloaded during the dictionary read`, async () => {
    const t = await setup(), read = deferred<string>();
    t.vault.cachedRead = () => read.promise;
    const pending = action === 'open' ? t.plugin.openView() : t.ready();
    // A refresh reads the dictionary only after checking that the file exists.
    if (action === 'refresh') await settle();
    t.plugin.onunload();
    read.resolve(dictionary);
    await pending; await settle();
    assert.deepEqual(t.plugin.native.calls, ['destroy']);
    assert.deepEqual(t.ui, []);
  });
}

test('opening a graph does not attach or reveal it when unloaded during view creation', async () => {
  const t = await setup(), view = deferred<void>(), entered = deferred<void>();
  t.leaf.setViewState = async () => { t.ui.push('create'); entered.resolve(); await view.promise; };
  const pending = t.plugin.openView();
  await entered.promise;
  t.plugin.onunload();
  view.resolve(); await pending;
  assert.deepEqual(t.plugin.native.calls, ['destroy']);
  assert.deepEqual(t.ui, ['create']);
});

test('a delayed layout-ready callback does not start a refresh after unload', async () => {
  const t = await setup();
  t.plugin.onunload(); t.ready(); await settle();
  assert.equal(t.reads(), 0);
  assert.deepEqual(t.plugin.native.calls, ['destroy']);
});

test('unloading during settings loading does not register commands or views afterwards', async () => {
  const saved = deferred<unknown>(), t = await setup(saved.promise);
  t.plugin.onunload(); saved.resolve({}); await t.loaded;
  assert.equal(t.commands.size, 0);
  assert.deepEqual(t.ui, []);
});

test('a failed graph open does not show a notice after unload', async () => {
  const t = await setup(), read = deferred<string>();
  t.vault.cachedRead = () => read.promise;
  const pending = t.plugin.openView();
  t.plugin.onunload(); read.resolve('{invalid'); await pending;
  assert.deepEqual(t.notices, []);
});

test('a manual reload reports failure and keeps the last valid model and graph', async () => {
  const t = await setup();
  t.ready(); await settle();
  const previous = t.plugin.model;
  t.vault.cachedRead = async () => '{invalid';
  t.commands.get('reload-dictionary')!(); await settle();
  assert.equal(t.notices.length, 1);
  assert.match(t.notices[0], /dictionary/i);
  assert.equal(t.errors.length, 1);
  assert.equal(t.plugin.model, previous);
  assert.deepEqual(t.plugin.native.calls, ['refresh:true', 'render-panel', 'draw-linked']);
});

test('a settings change reports a dictionary reload failure', async () => {
  const t = await setup();
  t.vault.cachedRead = async () => '{invalid';
  await t.plugin.saveSettings();
  assert.equal(t.notices.length, 1);
  assert.equal(t.errors.length, 1);
});

test('a background reload failure only logs and keeps the last valid model', async () => {
  const t = await setup();
  t.ready(); await settle();
  const previous = t.plugin.model;
  t.vault.cachedRead = async () => '{invalid';
  t.events.get('modify')!({ path: 'Tag-Dictionary.json' }); t.runTimers(); await settle();
  assert.deepEqual(t.notices, []);
  assert.equal(t.errors.length, 1);
  assert.equal(t.plugin.model, previous);
  assert.deepEqual(t.plugin.native.calls, ['refresh:true', 'render-panel', 'draw-linked']);
});

test('dictionary presence is true as soon as the first read finds the file', async () => {
  const t = await setup(), read = deferred<string>();
  t.vault.cachedRead = () => read.promise;
  t.ready(); await settle();
  assert.equal(t.plugin.dictionaryFound, true);
  read.resolve(dictionary); await settle();
  assert.equal(t.plugin.dictionaryFound, true);
});

test('a broken dictionary at startup is reported, and the sidebar keeps the reason until it loads', async () => {
  const t = await setup();
  t.vault.text = '{ broken'; t.ready(); await settle();
  assert.match(t.plugin.error!, /^Invalid JSON: /);
  assert.deepEqual(t.notices, [`Could not load the tag dictionary: ${t.plugin.error}`]);
  // The 3D view hears about the failure too, so a tab restored at startup shows why it is empty.
  assert.deepEqual(t.plugin.native.calls, ['render-panel', 'draw-linked']);
  t.vault.text = dictionary;
  t.events.get('modify')!({ path: 'Tag-Dictionary.json' }); t.runTimers(); await settle();
  assert.equal(t.plugin.error, undefined);
  assert.deepEqual(t.plugin.native.calls, ['render-panel', 'draw-linked', 'refresh:true']);
});

test('opening the graph records how the load went, so a later success clears an earlier failure', async () => {
  const t = await setup();
  t.vault.text = '{ broken'; await t.plugin.openView();
  assert.match(t.plugin.error!, /^Invalid JSON: /);
  t.vault.text = dictionary; await t.plugin.openView();
  assert.equal(t.plugin.error, undefined);
  assert.deepEqual(t.plugin.native.calls, ['render-panel', 'refresh:false', 'panel:true']);
});

test('a file that cannot be read is not reported as invalid JSON', async () => {
  const t = await setup();
  t.vault.cachedRead = async () => { throw new Error('EIO: i/o error, read'); };
  t.ready(); await settle();
  // The error comes from outside the plugin's realm here, so it may carry an "Error: " prefix.
  assert.match(t.plugin.error!, /^(Error: )?EIO: i\/o error, read$/);
});

test('a missing dictionary at startup is left to the sidebar, without a notice', async () => {
  const t = await setup();
  (t.vault as { getAbstractFileByPath: (path: string) => unknown }).getAbstractFileByPath = () => null;
  t.ready(); await settle();
  assert.deepEqual(t.notices, []);
  assert.match(t.plugin.error!, /^Tag dictionary not found/);
});

test('a pending manual reload does not report its failure after unload', async () => {
  const t = await setup(), read = deferred<string>();
  t.vault.cachedRead = () => read.promise;
  t.commands.get('reload-dictionary')!();
  t.plugin.onunload(); read.resolve('{invalid'); await settle();
  assert.deepEqual(t.notices, []);
  assert.deepEqual(t.errors, []);
});

test('note edits still skip graph redraws and dictionary reads, while a coalesced dictionary edit still reloads and redraws', async () => {
  const t = await setup();
  t.ready(); await settle();
  let tags: string[] = [];
  (t.vault as { getMarkdownFiles: () => unknown[] }).getMarkdownFiles = () => [{ path: 'Notes/A.md' }];
  (t.metadataCache as { getFileCache: () => { tags?: string[] } }).getFileCache = () => ({ tags });
  tags = ['#root'];
  t.events.get('modify')!({ path: 'Notes/A.md' }); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.model!.notesFor('root', false), ['Notes/A.md']);
  assert.equal(t.reads(), 1);
  t.events.get('modify')!({ path: 'Tag-Dictionary.json' });
  t.events.get('modify')!({ path: 'Notes/A.md' }); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.native.calls, ['refresh:true', 'refresh:false', 'refresh:true']);
  assert.equal(t.reads(), 2);
});

test('each metadata resolution refreshes the views', async () => {
  const t = await setup();
  t.ready(); await settle(); t.plugin.native.calls.length = 0;
  t.metaEvents.get('resolved')!(); t.runTimers(); await settle();
  // Resolving can finish after the refresh that a note edit scheduled, so a later one counts too.
  t.metaEvents.get('resolved')!(); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.native.calls, ['refresh:false', 'refresh:false']);
});

test('unload cancels a scheduled refresh', async () => {
  const t = await setup();
  t.events.get('modify')!({ path: 'Notes/A.md' });
  t.plugin.onunload(); t.runTimers(); await settle();
  assert.equal(t.reads(), 0);
  assert.deepEqual(t.plugin.native.calls, ['destroy']);
});

test('a successful manual reload updates the model and graph without an error notice', async () => {
  const t = await setup();
  t.vault.cachedRead = async () => JSON.stringify({ updated: { description: '', broader: [] } });
  t.commands.get('reload-dictionary')!(); await settle();
  assert.deepEqual(t.plugin.model!.roots, ['updated']);
  assert.deepEqual(t.plugin.native.calls, ['refresh:true']);
  assert.deepEqual(t.notices, []);
  assert.deepEqual(t.errors, []);
});

test('without an explicit choice, tow/tag-dictionary.json wins over .tow/', async () => {
  const t = await setup();
  t.vault.existing.add('tow/tag-dictionary.json'); t.vault.text = JSON.stringify({ visible: { description: 'Visible', broader: [] } });
  t.vault.existing.add('.tow/tag-dictionary.json'); t.vault.files.set('.tow/tag-dictionary.json', dictionary);
  await t.plugin.loadModel();
  assert.equal(t.plugin.dictionaryPath, 'tow/tag-dictionary.json');
  assert.deepEqual(t.plugin.model?.roots, ['visible']);
});

test('automatic lookup finds tow/tag-dictionary.json on disk before the vault index has it', async () => {
  const t = await setup();
  t.vault.adapter.exists = async path => path === 'tow/tag-dictionary.json' || t.vault.existing.has(path);
  assert.equal(await t.plugin.resolveDictionary(), 'tow/tag-dictionary.json');
});

test('without a chosen path and no dictionary anywhere, the tow default is used, not the stored path', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'Tag-Dictionary.json', dictionaryPathExplicit: false, locationNoticeShown: true }));
  await t.loaded; t.vault.existing.clear();
  assert.equal(await t.plugin.resolveDictionary(), 'tow/tag-dictionary.json');
});

test('a legacy dictionary arriving while automatic is picked up', async () => {
  const t = await setup(); t.vault.existing.clear();
  await assert.rejects(t.plugin.loadModel(), /Tag dictionary not found: tow\/tag-dictionary\.json/);
  t.vault.existing.add('Tag-Dictionary.json');
  t.events.get('create')!({ path: 'Tag-Dictionary.json' }); t.runTimers(); await settle();
  assert.equal(t.plugin.dictionaryPath, 'Tag-Dictionary.json');
  assert.deepEqual(t.plugin.model?.roots, ['root']);
  assert.deepEqual(t.plugin.native.calls, ['refresh:true']);
});

test('with a chosen path, a file arriving at an automatic location is ignored', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'custom.json', dictionaryPathExplicit: true, locationNoticeShown: true }));
  await t.loaded;
  t.events.get('create')!({ path: 'tow/tag-dictionary.json' }); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.native.calls, []);
});

test('the dictionary path setting moves a chosen dictionary and updates its path', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'custom/tags.json', dictionaryPathExplicit: true, locationNoticeShown: true }));
  await t.loaded;
  const contents = JSON.stringify({ moved: { description: 'Moved', broader: [] } });
  t.vault.existing.add('custom/tags.json'); t.vault.files.set('custom/tags.json', contents);
  const tab = t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[] };
  const setting = t.newSetting();
  (dictionarySetting(tab) as unknown as { render(setting: Setting): void }).render(setting as unknown as Setting);
  assert.deepEqual(setting.buttonNames, ['Move to tow/']);
  await setting.buttons[setting.buttonNames.indexOf('Move to tow/')]!();
  assert.deepEqual(t.vault.renames, [['custom/tags.json', 'tow/tag-dictionary.json']]);
  assert.equal(t.plugin.settings.dictionaryPath, 'tow/tag-dictionary.json');
  assert.equal(t.plugin.dictionaryPath, 'tow/tag-dictionary.json');
  assert.match(setting.desc!, /In use: tow\/tag-dictionary\.json\.$/);
  assert.equal(setting.textValue, 'tow/tag-dictionary.json');
  assert.deepEqual(t.plugin.model?.roots, ['moved']);
  assert.equal(setting.buttonEls[0]!.removed, true, 'nothing is left to move');
});

test('the fallback settings path also offers the move action for an automatic dictionary', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true }));
  await t.loaded;
  t.vault.text = JSON.stringify({ automatic: { description: 'Automatic', broader: [] } });
  (t.settingTabs[0] as { display(): void }).display();
  const setting = t.settingRows.find(row => row.name === 'Dictionary path')!;
  assert.deepEqual(setting.buttonNames, ['Move to tow/']);
  await setting.buttons[setting.buttonNames.indexOf('Move to tow/')]!();
  assert.deepEqual(t.vault.renames, [['Tag-Dictionary.json', 'tow/tag-dictionary.json']]);
  assert.equal(t.plugin.settings.dictionaryPathExplicit, false);
  assert.equal(t.plugin.dictionaryPath, 'tow/tag-dictionary.json');
  assert.deepEqual(t.plugin.model?.roots, ['automatic']);
});

test('the move action refuses in a TOW vault whose config sits in hidden .tow/', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true }));
  await t.loaded;
  const tab = t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[] };
  const setting = t.newSetting();
  (dictionarySetting(tab) as unknown as { render(setting: Setting): void }).render(setting as unknown as Setting);
  const exists = t.vault.adapter.exists;
  t.vault.adapter.exists = async path => path === '.tow/config.json' || await exists(path);
  await setting.buttons[setting.buttonNames.indexOf('Move to tow/')]!();
  assert.deepEqual(t.vault.renames, []);
  assert.match(t.notices.at(-1)!, /TOW manages this file/);
});

test('the move action stops if the target appears while creating tow/', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true }));
  await t.loaded;
  const tab = t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[] };
  const setting = t.newSetting();
  (dictionarySetting(tab) as unknown as { render(setting: Setting): void }).render(setting as unknown as Setting);
  t.vault.targetAppearsOnFolderCreate = true;
  await setting.buttons[setting.buttonNames.indexOf('Move to tow/')]!();
  assert.deepEqual(t.vault.renames, []);
  assert.ok(t.vault.existing.has('Tag-Dictionary.json'));
  assert.match(t.notices.at(-1)!, /already exists; not moving/);
});

const render = (t: Awaited<ReturnType<typeof setup>>) => {
  const s = t.newSetting();
  const definition = dictionarySetting(t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[] }) as unknown as { render(setting: Setting): void };
  definition.render(s as unknown as Setting);
  return s;
};

test('in a TOW vault the note shows only while the dictionary is outside tow/', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true })); await t.loaded;
  t.vault.existing.add('tow/config.json');
  const outside = render(t);
  assert.deepEqual(outside.buttonNames, []);
  assert.match(outside.desc!, /In use: Tag-Dictionary\.json \(automatic\)\. TOW manages this file: run the tow-setup skill or tow migrate to move it\.$/);
  t.vault.existing.add('tow/tag-dictionary.json'); await t.plugin.resolveDictionary();
  assert.doesNotMatch(render(t).desc!, /TOW manages/);
});

test('a dictionary already at the automatic tow path is not offered for moving', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'tow/tag-dictionary.json', dictionaryPathExplicit: true, locationNoticeShown: true }));
  t.vault.existing.add('tow/tag-dictionary.json');
  await t.loaded;
  const tab = t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[] };
  const setting = t.newSetting();
  (dictionarySetting(tab) as unknown as { render(setting: Setting): void }).render(setting as unknown as Setting);
  assert.deepEqual(setting.buttonNames, []);
});

test('without a visible TOW dictionary, .tow/ wins over the stored legacy path', async () => {
  const t = await setup(); t.vault.existing.add('.tow/tag-dictionary.json'); t.vault.files.set('.tow/tag-dictionary.json', dictionary);
  await t.plugin.loadModel();
  assert.equal(t.plugin.dictionaryPath, '.tow/tag-dictionary.json');
});

test('a dictionary under .tow/ loads through the adapter', async () => {
  const t = await setup(); t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.text = JSON.stringify({ ignored: { description: 'Vault API', broader: [] } });
  t.vault.files.set('.tow/tag-dictionary.json', serialize(base));
  await t.plugin.loadModel();
  assert.deepEqual(JSON.parse(JSON.stringify(t.plugin.raw)), base);
});

test('a hidden dictionary that reappears but cannot be read is reported as present', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: '.tow/tag-dictionary.json', dictionaryPathExplicit: true }));
  await t.loaded;
  await assert.rejects(t.plugin.loadModel(), /Tag dictionary not found/);
  assert.equal(t.plugin.dictionaryFound, false);

  t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.adapter.read = async () => { throw new Error('EIO: i/o error, read'); };
  await assert.rejects(t.plugin.loadModel(), /EIO/);
  assert.equal(t.plugin.dictionaryFound, true);
});

test('a visible dictionary that reappears but cannot be read is reported as present', async () => {
  const t = await setup();
  (t.vault as { getAbstractFileByPath: (path: string) => unknown }).getAbstractFileByPath = () => null;
  await assert.rejects(t.plugin.loadModel(), /Tag dictionary not found/);
  assert.equal(t.plugin.dictionaryFound, false);

  (t.vault as { getAbstractFileByPath: (path: string) => unknown }).getAbstractFileByPath = () => t.file();
  t.vault.cachedRead = async () => { throw new Error('EIO: i/o error, read'); };
  await assert.rejects(t.plugin.loadModel(), /EIO/);
  assert.equal(t.plugin.dictionaryFound, true);
});

test('a hidden dictionary that disappears before it is read is marked missing', async () => {
  const t = await setup(); t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.files.set('.tow/tag-dictionary.json', serialize(base));
  t.vault.adapter.read = async (path: string) => {
    t.vault.existing.delete(path); t.vault.files.delete(path);
    throw new Error(`ENOENT: ${path}`);
  };
  await assert.rejects(t.plugin.loadModel(), /ENOENT/);
  assert.equal(t.plugin.dictionaryFound, false);
});

test('an explicit path wins even when both automatic locations exist', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'Tag-Dictionary.json', dictionaryPathExplicit: true }));
  await t.loaded; t.vault.existing.add('tow/tag-dictionary.json'); t.vault.existing.add('.tow/tag-dictionary.json');
  await t.plugin.loadModel();
  assert.equal(t.plugin.dictionaryPath, 'Tag-Dictionary.json');
});

test('setting the path marks it explicit', async () => {
  const t = await setup(); await t.plugin.setDictionaryPath('Tags.json');
  assert.equal(t.plugin.settings.dictionaryPathExplicit, true);
});

test('resetDictionaryPath restores the default and clears the explicit choice', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'custom.json', dictionaryPathExplicit: true }));
  await t.loaded;
  await t.plugin.resetDictionaryPath();
  assert.equal(t.plugin.settings.dictionaryPath, settings.DEFAULT_SETTINGS.dictionaryPath);
  assert.equal(t.plugin.settings.dictionaryPathExplicit, false);
  assert.equal(t.plugin.dictionaryPath, 'Tag-Dictionary.json');
  assert.deepEqual(structuredClone(t.savedWrites.at(-1)), { ...settings.DEFAULT_SETTINGS, locationNoticeShown: true });
});

test('the path field is empty while automatic and shows the path in use as its placeholder', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true })); await t.loaded;
  t.vault.existing.add('tow/tag-dictionary.json'); await t.plugin.resolveDictionary();
  const setting = render(t);
  assert.equal(setting.textValue, '');
  assert.equal(setting.textPlaceholder, 'tow/tag-dictionary.json');
  assert.equal(setting.desc, 'Vault-relative path to the tag dictionary (.json). Leave empty to find it automatically. In use: tow/tag-dictionary.json (automatic).');
});

test('a chosen path fills the field', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'custom.json', dictionaryPathExplicit: true, locationNoticeShown: true })); await t.loaded;
  const setting = render(t);
  assert.equal(setting.textValue, 'custom.json');
  assert.match(setting.desc!, /In use: custom\.json\.$/);
});

test('the path saves when committed, ignores an unchanged or invalid path, and an empty field goes back to automatic', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'custom.json', dictionaryPathExplicit: true }));
  await t.loaded; t.vault.existing.add('.tow/tag-dictionary.json'); t.vault.files.set('.tow/tag-dictionary.json', serialize(base));
  const setting = render(t);
  setting.textValue = 'Tags.json'; setting.textCommitted!(); await settle();
  assert.equal(t.plugin.settings.dictionaryPath, 'Tags.json');
  assert.equal(t.plugin.settings.dictionaryPathExplicit, true);
  assert.match(setting.desc!, /In use: Tags\.json\.$/);
  const writes = t.savedWrites.length;
  setting.textCommitted!(); await settle();
  assert.equal(t.savedWrites.length, writes, 'committing the same path again saves nothing');
  setting.textValue = '../x.json'; setting.textCommitted!(); await settle();
  assert.equal(setting.desc, 'Enter a .json path inside the vault, outside the config folder.');
  assert.equal(t.plugin.settings.dictionaryPath, 'Tags.json');
  setting.textValue = '  '; setting.textCommitted!(); await settle();
  assert.equal(t.plugin.settings.dictionaryPathExplicit, false);
  assert.equal(t.plugin.dictionaryPath, '.tow/tag-dictionary.json');
  assert.equal(setting.textValue, '');
  assert.equal(setting.textPlaceholder, '.tow/tag-dictionary.json');
  assert.match(setting.desc!, /In use: \.tow\/tag-dictionary\.json \(automatic\)\.$/);
});

test('a commit that finishes after newer typing keeps the newer text', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true })); await t.loaded;
  t.vault.existing.add('A.json');
  const read = deferred<string>();
  t.vault.cachedRead = () => read.promise;
  const tab = t.settingTabs[0] as { display(): void; hide(): void };
  tab.display();
  const setting = t.settingRows.find(row => row.name === 'Dictionary path')!;
  setting.textValue = 'A.json'; setting.textCommitted!(); await settle();
  setting.textValue = 'B.json';
  read.resolve(dictionary); await settle();
  assert.equal(setting.textValue, 'B.json');
  assert.equal(t.plugin.settings.dictionaryPath, 'A.json');
  tab.hide(); await settle();
  assert.equal(t.plugin.settings.dictionaryPath, 'B.json');
});

test('closing the settings commits a path still in the field', async () => {
  const t = await setup(Promise.resolve({ locationNoticeShown: true })); await t.loaded;
  const tab = t.settingTabs[0] as { display(): void; hide(): void };
  tab.display();
  const setting = t.settingRows.find(row => row.name === 'Dictionary path')!;
  setting.textValue = 'Tags.json'; tab.hide(); await settle();
  assert.equal(t.plugin.settings.dictionaryPath, 'Tags.json');
  assert.equal(t.plugin.settings.dictionaryPathExplicit, true);
});

test('the reset button goes back to automatic and empties the field', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'custom.json', dictionaryPathExplicit: true }));
  await t.loaded; t.vault.existing.add('.tow/tag-dictionary.json'); t.vault.files.set('.tow/tag-dictionary.json', serialize(base));
  (t.settingTabs[0] as { display(): void }).display();
  const setting = t.settingRows.find(row => row.name === 'Dictionary path')!;
  setting.buttons[0]!(); await settle();
  assert.equal(t.plugin.settings.dictionaryPathExplicit, false);
  assert.equal(t.plugin.dictionaryPath, '.tow/tag-dictionary.json');
  assert.equal(setting.textValue, '');
  assert.match(setting.desc!, /In use: \.tow\/tag-dictionary\.json \(automatic\)\.$/);
});

const base: RawDictionary = { root: { description: 'Root', broader: [] }, child: { description: 'Child', broader: ['root'] } };
const describe = (description: string): Change => ({ kind: 'edit', tag: 'child', draft: { ...draftOf(base, 'child'), description } });
async function withBase() {
  const t = await setup();
  t.vault.text = serialize(base); t.ready(); await settle();
  return t;
}
async function withTowBase() {
  const t = await setup(); t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.files.set('.tow/tag-dictionary.json', serialize(base)); t.ready(); await settle();
  return t;
}

test('focus notices a newly created .tow dictionary while the visible fallback is in use', async () => {
  const t = await withBase();
  t.vault.existing.add('.tow'); t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.files.set('.tow/tag-dictionary.json', serialize({ added: { description: 'Added', broader: [] } }));
  t.vault.mtimes.set('.tow/tag-dictionary.json', 1);
  t.vault.sizes.set('.tow/tag-dictionary.json', t.vault.files.get('.tow/tag-dictionary.json')!.length);
  await t.focus(); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.model?.roots, ['added']);
});

test('an outside edit to a .tow/ dictionary reloads on window focus', async () => {
  const t = await withTowBase();
  t.vault.files.set('.tow/tag-dictionary.json', serialize({ ...base, extra: { description: 'Extra', broader: ['root'] } }));
  t.vault.mtimes.set('.tow/tag-dictionary.json', 2);
  await t.focus(); t.runTimers(); await settle();
  assert.ok(t.plugin.model?.entries.has('extra'));
});

test('an outside edit with unchanged mtime reloads when the file size changes', async () => {
  const t = await setup();
  t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.files.set('.tow/tag-dictionary.json', serialize(base));
  t.vault.mtimes.set('.tow/tag-dictionary.json', 1);
  t.vault.sizes.set('.tow/tag-dictionary.json', t.vault.files.get('.tow/tag-dictionary.json')!.length);
  t.ready(); await settle();
  const mtime = t.vault.mtimes.get('.tow/tag-dictionary.json');
  t.vault.files.set('.tow/tag-dictionary.json', serialize({ ...base, extra: { description: 'Extra entry', broader: ['root'] } }));
  t.vault.sizes.set('.tow/tag-dictionary.json', t.vault.files.get('.tow/tag-dictionary.json')!.length);
  t.vault.mtimes.set('.tow/tag-dictionary.json', mtime!);
  await t.focus(); t.runTimers(); await settle();
  assert.ok(t.plugin.model?.entries.has('extra'));
});

test('focus does not repeatedly reload a missing hidden dictionary and reloads when it appears', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: '.tow/tag-dictionary.json', dictionaryPathExplicit: true }));
  await t.loaded;
  await assert.rejects(t.plugin.loadModel(), /Tag dictionary not found/);
  await t.plugin.checkOutsideChange(); await t.plugin.checkOutsideChange();
  t.runTimers(); await settle();
  assert.equal(t.errors.length, 0);

  t.vault.existing.add('.tow/tag-dictionary.json');
  t.vault.files.set('.tow/tag-dictionary.json', serialize(base));
  t.vault.mtimes.set('.tow/tag-dictionary.json', 1);
  t.vault.sizes.set('.tow/tag-dictionary.json', t.vault.files.get('.tow/tag-dictionary.json')!.length);
  await t.plugin.checkOutsideChange(); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.model?.roots, ['root']);
});

test('focus without a change does not reload', async () => {
  const t = await withTowBase(), before = t.reads();
  await t.focus(); t.runTimers(); await settle();
  assert.equal(t.reads(), before);
});

test('a hidden dictionary still loads when adapter stat fails', async () => {
  const t = await withTowBase();
  t.vault.adapter.stat = async () => { throw new Error('stat failed'); };
  await t.plugin.loadModel();
  assert.deepEqual(t.plugin.model?.roots, ['root']);
});

test('a failed outside-change stat is ignored', async () => {
  const t = await withTowBase(), before = t.reads();
  t.vault.adapter.stat = async () => { throw new Error('stat failed'); };
  await assert.doesNotReject(t.plugin.checkOutsideChange());
  t.runTimers(); await settle();
  assert.equal(t.reads(), before);
});

test('checkOutsideChange skips visible dictionaries', async () => {
  const t = await withBase(), before = t.reads();
  await t.plugin.checkOutsideChange(); t.runTimers(); await settle();
  assert.equal(t.reads(), before);
});

test('opening a graph schedules a refresh when the hidden dictionary changed', async () => {
  const t = await withTowBase(); t.plugin.native.calls.length = 0;
  t.vault.files.set('.tow/tag-dictionary.json', serialize({ ...base, extra: { description: 'Extra', broader: ['root'] } }));
  t.vault.mtimes.set('.tow/tag-dictionary.json', 2);
  await t.plugin.openView(); t.runTimers(); await settle();
  assert.ok(t.plugin.model?.entries.has('extra'));
  assert.deepEqual(t.plugin.native.calls, ['refresh:false', 'panel:true', 'refresh:true']);
});

test('focus does not read the dictionary when unloaded during the outside-change check', async () => {
  const t = await withTowBase(), stat = deferred<{ mtime: number; size: number }>(), before = t.reads();
  t.plugin.native.calls.length = 0;
  t.vault.adapter.stat = () => stat.promise;
  const pending = t.focus();
  await settle();
  t.plugin.onunload(); stat.resolve({ mtime: 2, size: 2 });
  await pending; await settle();
  assert.equal(t.reads(), before);
  assert.deepEqual(t.plugin.native.calls, ['destroy']);
});

test('loadModel keeps the parsed dictionary as raw', async () => {
  const t = await withBase();
  // Parsed inside the module's realm, so compare plain copies.
  assert.deepEqual(JSON.parse(JSON.stringify(t.plugin.raw)), base);
});

test('saveChange writes the applied change in the one-entry-per-line format', async () => {
  const t = await withBase();
  assert.equal(await t.plugin.saveChange(describe('New'), t.plugin.raw!), true);
  assert.equal(t.vault.text, serialize(apply(base, describe('New'))));
});

test('saveChange applies the edit draft facet to the saved entry', async () => {
  const t = await withBase();
  const change: Change = { kind: 'edit', tag: 'child', draft: { ...draftOf(base, 'child'), facet: 'language' } };
  assert.equal(await t.plugin.saveChange(change, t.plugin.raw!), true);
  assert.equal(t.vault.text, serialize(apply(base, change)));
});

test('a visible dictionary still goes through the Vault API', async () => {
  const t = await withBase();
  assert.equal(await t.plugin.saveChange(describe('New'), t.plugin.raw!), true);
  assert.equal(t.vault.writes.length, 1);
  assert.equal(t.vault.adapterWrites.length, 0);
});

test('saveChange on a .tow/ dictionary writes through the adapter and keeps the conflict check', async () => {
  const t = await withTowBase();
  assert.equal(await t.plugin.saveChange(describe('New'), base), true);
  assert.equal(t.vault.files.get('.tow/tag-dictionary.json'), serialize(apply(base, describe('New'))));
  assert.equal(t.vault.adapterWrites.length, 1);
  t.vault.files.set('.tow/tag-dictionary.json', serialize({ ...base, child: { description: 'Outside', broader: ['root'] } }));
  assert.equal(await t.plugin.saveChange(describe('Other'), base), false);
  assert.equal(t.vault.adapterWrites.length, 1);
});

test('saving a hidden dictionary does not trigger an outside reload on focus', async () => {
  const t = await withTowBase();
  assert.equal(await t.plugin.saveChange(describe('Updated'), base), true);
  const afterSave = t.reads();
  await t.focus(); t.runTimers(); await settle();
  assert.equal(t.reads(), afterSave);
});

test('changing the hidden dictionary path reloads on focus', async () => {
  const t = await withTowBase();
  t.vault.mtimes.set('.tow/tag-dictionary.json', 1); t.vault.mtimes.set('.tow/other.json', 1);
  await t.plugin.loadModel();
  t.vault.files.set('.tow/other.json', serialize({ updated: { description: 'Updated', broader: [] } }));
  t.vault.existing.add('.tow/other.json');
  t.plugin.settings.dictionaryPath = '.tow/other.json';
  t.plugin.settings.dictionaryPathExplicit = true;
  await t.plugin.resolveDictionary();
  await t.focus(); t.runTimers(); await settle();
  assert.ok(t.plugin.model?.entries.has('updated'));
});

test('saveChange keeps CRLF line endings in a .tow/ dictionary', async () => {
  const t = await withTowBase(), crlf = (text: string) => text.replace(/\n/g, '\r\n');
  t.vault.files.set('.tow/tag-dictionary.json', crlf(serialize(base)));
  assert.equal(await t.plugin.saveChange(describe('New'), base), true);
  assert.equal(t.vault.files.get('.tow/tag-dictionary.json'), crlf(serialize(apply(base, describe('New')))));
});

test('saveChange keeps the CRLF line endings of a dictionary written that way', async () => {
  const t = await withBase();
  const crlf = (text: string) => text.replace(/\n/g, '\r\n');
  t.vault.text = crlf(serialize(base));
  assert.equal(await t.plugin.saveChange(describe('New'), base), true);
  assert.equal(t.vault.text, crlf(serialize(apply(base, describe('New')))));
});

test('saveChange refuses when a touched entry changed outside, and writes nothing', async () => {
  const t = await withBase();
  t.vault.text = serialize({ ...base, child: { description: 'Outside', broader: ['root'] } });
  assert.equal(await t.plugin.saveChange(describe('New'), base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.equal(t.notices.at(-1), 'The dictionary changed outside the editor. Cancel and edit again to see the latest version.');
});

test('saveChange refuses a change that would break the dictionary', async () => {
  const t = await withBase();
  // The pickers leave cycles out; the check before writing still refuses one.
  const change: Change = { kind: 'edit', tag: 'root', draft: { ...draftOf(base, 'root'), parents: ['child'] } };
  assert.equal(await t.plugin.saveChange(change, base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.match(t.notices.at(-1)!, /^Could not save the dictionary: .*Cycle/);
});

test('saveChange writes nothing over a broken file', async () => {
  const t = await withBase();
  t.vault.text = '{ broken';
  assert.equal(await t.plugin.saveChange(describe('New'), base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.match(t.notices.at(-1)!, /^Could not save the dictionary:/);
});

test('a fresh install creates an empty tow dictionary once the layout is ready', async () => {
  const t = await setup(Promise.resolve(null));
  await t.loaded; t.vault.existing.clear();
  t.ready(); await settle();
  assert.deepEqual(t.vault.created, ['folder:tow', 'file:tow/tag-dictionary.json:{\n}\n']);
});

test('after the first install a missing dictionary is not created on its own', async () => {
  const t = await setup();
  t.vault.existing.clear(); t.ready(); await settle();
  assert.deepEqual(t.vault.created, []);
});

test('an existing dictionary is never overwritten, even when broken', async () => {
  const t = await setup(Promise.resolve(null));
  await t.loaded; t.vault.text = '{ broken'; t.ready(); await settle();
  assert.deepEqual(t.vault.created, []);
});

test('visible dictionary folders are checked through the Vault API', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'tow/new/tag-dictionary.json', dictionaryPathExplicit: true }));
  await t.loaded; t.vault.existing.clear();
  t.vault.adapter.exists = async path => {
    if (path === 'tow') throw new Error('Visible folders must use the Vault API.');
    return t.vault.existing.has(path);
  };
  assert.equal(await t.plugin.createDictionary(), true);
  assert.deepEqual(t.vault.created, ['folder:tow', 'folder:tow/new', 'file:tow/new/tag-dictionary.json:{\n}\n']);
});

test('createDictionary creates the tow default when automatic locations are empty', async () => {
  const t = await setup(); await t.loaded; t.vault.existing.clear();
  assert.equal(await t.plugin.createDictionary(), true);
  assert.deepEqual(t.vault.created, ['folder:tow', 'file:tow/tag-dictionary.json:{\n}\n']);
});

test('createDictionary makes the folder and an empty file, then reloads', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'Dicts/Tags.json' }));
  await t.loaded; t.vault.existing.clear();
  assert.equal(await t.plugin.createDictionary(), true);
  assert.deepEqual(t.vault.created, ['folder:Dicts', 'file:Dicts/Tags.json:{\n}\n']);
  assert.ok(t.plugin.model);
});

test('createDictionary makes .tow/ and an empty file through the adapter, never replacing one', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: '.tow/tag-dictionary.json', dictionaryPathExplicit: true }));
  await t.loaded; t.vault.existing.clear();
  assert.equal(await t.plugin.createDictionary(), true);
  assert.deepEqual([...t.vault.existing].sort(), ['.tow', '.tow/tag-dictionary.json']);
  assert.equal(t.vault.files.get('.tow/tag-dictionary.json'), '{\n}\n');
  assert.equal(await t.plugin.createDictionary(), false);
});

test('createDictionary refuses when the hidden file appears during folder creation', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: '.tow/tag-dictionary.json', dictionaryPathExplicit: true }));
  await t.loaded; t.vault.existing.clear(); t.vault.appearOnMkdir = true;
  const appeared = serialize(base);
  assert.equal(await t.plugin.createDictionary(), false);
  assert.equal(t.vault.files.get('.tow/tag-dictionary.json'), appeared);
  assert.equal(t.vault.adapterWrites.length, 0);
});

test('createDictionary never replaces a file that appeared meanwhile', async () => {
  const t = await setup();
  assert.equal(await t.plugin.createDictionary(), false);
  assert.deepEqual(t.vault.created, []);
  assert.match(t.notices.at(-1)!, /^Could not create the dictionary:/);
});

test('changing the dictionary path in settings does not create a file', async () => {
  const t = await setup();
  t.ready(); await settle();
  t.plugin.settings.dictionaryPath = 'New.json'; await t.plugin.saveSettings(); await settle();
  assert.deepEqual(t.vault.created, []);
});

test('saveChange writes nothing when the dictionary file is gone', async () => {
  const t = await withBase();
  (t.vault as { getAbstractFileByPath: (path: string) => unknown }).getAbstractFileByPath = () => null;
  assert.equal(await t.plugin.saveChange(describe('New'), base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.equal(t.notices.at(-1), 'Tag dictionary not found: Tag-Dictionary.json');
});

test('a note the metadata cache has not indexed yet does not stop the dictionary from loading', async () => {
  const t = await setup();
  (t.vault as { getMarkdownFiles: () => unknown[] }).getMarkdownFiles = () => [{ path: 'A.md' }];
  (t.plugin as unknown as { app: { metadataCache: { getFileCache: () => null } } }).app.metadataCache.getFileCache = () => null;
  t.ready(); await settle();
  assert.deepEqual(t.plugin.model!.roots, ['root']);
  assert.deepEqual(t.errors, []);
});

test('saveChange does not wait for the note index', async () => {
  const t = await withBase();
  // The stub has no metadata cache to read, so building the note index would throw.
  (t.vault as { getMarkdownFiles: () => unknown[] }).getMarkdownFiles = () => [{ path: 'A.md' }];
  assert.equal(await t.plugin.saveChange(describe('New'), base), true);
});

test('a tag color left to the accent redraws when the accent color changes, and only then', async () => {
  const t = await setup();
  t.ready(); await settle();
  Object.assign(t.plugin.settings, { customColors: true, tagColor: '' });
  assert.equal(t.plugin.tagColor(), '#8a5cf5');
  t.plugin.native.calls.length = 0;
  t.restyle('hsl(353, 81%, 55%)');
  assert.equal(t.plugin.tagColor(), '#e92f45');
  assert.deepEqual(t.plugin.native.calls, ['refresh:true']);
  t.restyle('hsl(353, 81%, 55%)');
  assert.deepEqual(t.plugin.native.calls, ['refresh:true'], 'another style change on <body> leaves the graph alone');
  t.plugin.settings.tagColor = '#12ab3c'; t.restyle('hsl(0, 100%, 50%)');
  assert.deepEqual(t.plugin.native.calls, ['refresh:true'], 'a picked color ignores the accent');
  assert.equal(t.plugin.native.recolors, 2, '2D focus/highlight CSS refreshes on body accent changes even with a picked tag color');
  assert.equal(t.watching(), 1);
  t.unload();
  assert.equal(t.watching(), 0);
});

test('the accent the graph was last drawn with is the one compared, even after a settings change redrew it', async () => {
  const t = await setup();
  t.ready(); await settle();
  Object.assign(t.plugin.settings, { customColors: true, tagColor: '' });
  t.restyle('hsl(258, 88%, 66%)');
  t.plugin.settings.tagColor = '#12ab3c'; await t.plugin.saveSettings();
  t.restyle('hsl(353, 81%, 55%)');
  // Back to following: the redraw takes the new accent.
  t.plugin.settings.tagColor = ''; await t.plugin.saveSettings();
  t.plugin.native.calls.length = 0;
  t.restyle('hsl(258, 88%, 66%)');
  assert.deepEqual(t.plugin.native.calls, ['refresh:true'], 'the accent going back is a change from what is drawn');
});

test('followAccent skips unchanged body style mutations from startup and under depth coloring, and passes settings to linked views', async () => {
  const t = await setup();
  t.ready(); await settle();
  Object.assign(t.plugin.settings, { customColors: true, hierarchyColors: true, tagColor: '' });
  t.plugin.native.calls.length = 0; t.plugin.native.linkedCalls.length = 0;

  // Startup initialized the tracked accent, so an unrelated body.style mutation never calls refresh().
  t.restyle('hsl(258, 88%, 66%)');
  assert.deepEqual(t.plugin.native.calls, []);
  assert.equal(t.plugin.native.recolors, 0);

  // Even when depth colors keep tagColor() from reading fallback accent, followAccent updates its baseline and skips repeats.
  t.restyle('hsl(353, 81%, 55%)');
  t.restyle('hsl(353, 81%, 55%)');
  assert.deepEqual(t.plugin.native.calls, ['refresh:true']);
  assert.deepEqual(t.plugin.native.linkedCalls, ['settings']);
  assert.equal(t.plugin.native.recolors, 1);

  // Obsidian css-change already refreshes GraphRenderer colors natively, so only the baseline updates without redundant recolor().
  t.restyle('hsl(258, 88%, 66%)', true);
  assert.equal(t.plugin.native.recolors, 1);
  t.restyle('hsl(258, 88%, 66%)');
  assert.equal(t.plugin.native.recolors, 1);

  // Even when customColors is off or CSS uses oklch(), body.style accent changes still recolor 2D highlights without full refresh.
  t.plugin.settings.customColors = false;
  t.plugin.native.calls.length = 0;
  t.restyle('oklch(0.6 0.2 25)');
  assert.equal(t.plugin.native.recolors, 2);
  assert.deepEqual(t.plugin.native.calls, []);

  t.plugin.native.linkedCalls.length = 0;
  await t.plugin.saveSettings();
  assert.deepEqual(t.plugin.native.linkedCalls, ['settings']);
});


test('depth coloring resolves each tag and falls back to the saved color when disabled or outside the hierarchy', async () => {
  const t = await setup(); t.ready(); await settle();
  t.plugin.model = new Ontology({
    root: { description: '', broader: [] }, child: { description: '', broader: ['root'] }, loose: { description: '' },
  }, []);
  Object.assign(t.plugin.settings, { customColors: true, hierarchyColors: true, tagColor: '#12ab3c' });
  assert.equal(t.plugin.tagColor('root'), colors.PALETTE[0]);
  assert.equal(t.plugin.tagColor('child'), colors.PALETTE[1]);
  assert.equal(t.plugin.tagColor('loose'), '#12ab3c');
  assert.equal(t.plugin.tagColor('unknown'), '#12ab3c');
  assert.equal(t.plugin.tagColor(), '#12ab3c');
  t.plugin.settings.hierarchyColors = false;
  assert.equal(t.plugin.tagColor('child'), '#12ab3c');
});

test('palette presets and individual depth pickers save colors and stay in sync', async () => {
  const t = await setup(); t.ready(); await settle();
  (t.settingTabs[0] as { display(): void }).display();
  const preset = t.settingRows.find(row => row.name === 'Palette')!;
  const root = () => [...t.settingRows].reverse().find(row => row.name === '0')!;
  const child = () => [...t.settingRows].reverse().find(row => row.name === '1')!;
  assert.equal(preset.dropdownValue, 'default');
  preset.dropdownChanged!('pastel'); await settle();
  assert.deepEqual(t.plugin.settings.hierarchyPalette, colors.PALETTE_PRESETS.pastel.colors);
  assert.equal(root().colorValue, colors.PALETTE_PRESETS.pastel.colors[0]);
  assert.equal(child().colorValue, colors.PALETTE_PRESETS.pastel.colors[1]);
  await root().colorChanged!('#123456');
  assert.equal(t.plugin.settings.hierarchyPalette[0], '#123456');
  assert.equal(t.plugin.settings.hierarchyPalette[1], colors.PALETTE_PRESETS.pastel.colors[1]);
  assert.equal(preset.dropdownValue, 'custom');
  preset.dropdownChanged!('default'); await settle();
  assert.deepEqual(t.plugin.settings.hierarchyPalette, colors.PALETTE);
  assert.equal(root().colorValue, colors.PALETTE[0]);
});

test('palette levels can grow and shrink, and presets preserve the chosen count', async () => {
  const t = await setup(); t.ready(); await settle();
  (t.settingTabs[0] as { display(): void }).display();
  const preset = t.settingRows.find(row => row.name === 'Palette')!;
  preset.buttons[0](); await settle();
  assert.equal(t.plugin.settings.hierarchyPalette.length, 9);
  assert.ok(t.settingRows.some(row => row.name === '8'));
  preset.dropdownChanged!('warm'); await settle();
  assert.equal(t.plugin.settings.hierarchyPalette.length, 9);
  assert.equal(t.plugin.settings.hierarchyPalette[8], colors.PALETTE_PRESETS.warm.colors[0]);
  for (let i = 0; i < 10; i++) { preset.buttons[1](); await settle(); }
  assert.equal(t.plugin.settings.hierarchyPalette.length, 1);
  assert.equal(preset.dropdownValue, 'warm');
  preset.buttons[0](); await settle();
  assert.equal(t.plugin.settings.hierarchyPalette.length, 2);
});

test('gradient presets resample on resize, survive settings reopen, and hand edits become custom', async () => {
  const t = await setup(); t.ready(); await settle();
  (t.settingTabs[0] as { display(): void }).display();
  let row = t.settingRows.find(row => row.name === 'Palette')!;
  row.dropdownChanged!('blue-gradient'); await settle();
  const preset = colors.PALETTE_PRESETS['blue-gradient'];
  assert.deepEqual(t.plugin.settings.hierarchyPalette, colors.paletteFor(preset, 8));
  row.buttons[0](); await settle();
  assert.deepEqual(t.plugin.settings.hierarchyPalette, colors.paletteFor(preset, 9));
  assert.equal(row.dropdownValue, 'blue-gradient');
  row.buttons[1](); await settle();
  assert.deepEqual(t.plugin.settings.hierarchyPalette, colors.paletteFor(preset, 8));
  (t.settingTabs[0] as { display(): void }).display();
  row = [...t.settingRows].reverse().find(row => row.name === 'Palette')!;
  assert.equal(row.dropdownValue, 'blue-gradient');
  const root = [...t.settingRows].reverse().find(row => row.name === '0')!;
  await root.colorChanged!('#123456');
  assert.equal(row.dropdownValue, 'custom');
  row.buttons[0](); await settle();
  assert.equal(t.plugin.settings.hierarchyPalette[0], '#123456');
  row.dropdownChanged!('purple-gradient'); await settle();
  assert.deepEqual(t.plugin.settings.hierarchyPalette, colors.paletteFor(colors.PALETTE_PRESETS['purple-gradient'], 9));
});


test('saving mindmap graph state or settings persists the other layouts expansion', async () => {
  const t = await setup(); t.ready(); await settle();
  t.plugin.settings.layout = 'mindmap'; t.plugin.settings.expanded = ['sec'];
  t.plugin.native.savedExpandedOverride = ['cs', 'ml'];
  await t.plugin.saveState();
  assert.deepEqual([...(t.savedWrites.at(-1) as settings.Settings).expanded], ['cs', 'ml']);
  await t.plugin.saveSettings();
  assert.deepEqual([...(t.savedWrites.at(-1) as settings.Settings).expanded], ['cs', 'ml']);
  assert.deepEqual(t.plugin.settings.expanded, ['sec'], 'live mindmap expansion remains independent of its saved snapshot');
});

test('custom palette is restored after presets, other settings and restart', async () => {
  const t = await setup(); t.ready(); await settle();
  (t.settingTabs[0] as { display(): void }).display();
  const row = t.settingRows.find(row => row.name === 'Palette')!;
  const root = [...t.settingRows].reverse().find(row => row.name === '0')!;
  await root.colorChanged!('#123456');
  const custom = [...t.plugin.settings.hierarchyPalette];
  row.dropdownChanged!('blue-gradient'); await settle();
  t.plugin.settings.focus = true; await t.plugin.saveSettings();
  row.dropdownChanged!('custom'); await settle();
  assert.deepEqual([...t.plugin.settings.hierarchyPalette], custom);
  assert.equal(row.dropdownValue, 'custom');
  row.dropdownChanged!('pastel'); await settle();
  const restored = await setup(Promise.resolve(structuredClone(t.savedWrites.at(-1))));
  await restored.loaded; restored.ready(); await settle();
  (restored.settingTabs[0] as { display(): void }).display();
  restored.settingRows.find(row => row.name === 'Palette')!.dropdownChanged!('custom'); await settle();
  assert.deepEqual([...restored.plugin.settings.hierarchyPalette], custom);
});

test('editing a graph legend color saves the whole active preset as custom and restores it after restart', async () => {
  const t = await setup(); t.ready(); await settle();
  Object.assign(t.plugin.settings, { hierarchyPalette: colors.paletteFor(colors.PALETTE_PRESETS.rainbow, 10), hierarchyPalettePreset: 'rainbow' });
  const expected = [...t.plugin.settings.hierarchyPalette]; expected[2] = '#123456';
  await t.plugin.setPaletteColor(2, '#123456');
  assert.deepEqual([...t.plugin.settings.hierarchyPalette], expected);
  assert.deepEqual([...t.plugin.settings.customHierarchyPalette], expected);
  assert.equal(t.plugin.settings.hierarchyPalettePreset, 'custom');
  assert.ok(t.plugin.native.calls.includes('refresh:true'), 'all graphs receive the edit');
  (t.settingTabs[0] as { display(): void }).display();
  t.settingRows.find(row => row.name === 'Palette')!.dropdownChanged!('pastel'); await settle();
  const restored = await setup(Promise.resolve(structuredClone(t.savedWrites.at(-1))));
  await restored.loaded; restored.ready(); await settle();
  (restored.settingTabs[0] as { display(): void }).display();
  restored.settingRows.find(row => row.name === 'Palette')!.dropdownChanged!('custom'); await settle();
  assert.deepEqual([...restored.plugin.settings.hierarchyPalette], expected);
  const writes = restored.savedWrites.length;
  for (const [depth, color] of [[-1, '#112233'], [10, '#112233'], [0.5, '#112233'], [0, 'invalid']] as const) await restored.plugin.setPaletteColor(depth, color);
  assert.equal(restored.savedWrites.length, writes, 'invalid edits are ignored');
});

test('modern and legacy settings keep the same sections, order and conditional visibility', async () => {
  const t = await setup(); await t.loaded;
  const tab = t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[]; display(): void };
  const expected = ['Dictionary', 'Dictionary path', 'Kebab-case tag names', 'Colors', 'Color mode',
    'Palette', 'Level colors', 'My palettes', 'Color for tags outside the hierarchy', 'Colored sidebar titles',
    'Sidebar', 'Tag lists',
    'Focus', 'Keep the selected tag focused', 'Its descendants', 'Include notes',
    'Additional views', 'Enable vertical tree', 'Enable horizontal tree', 'Enable 3D view (beta)', 'Enable ontology explorer (beta)'];
  for (const customColors of [true, false]) for (const hierarchyColors of [true, false]) for (const focus of [true, false]) {
    Object.assign(t.plugin.settings, { customColors, hierarchyColors, focus });
    const modern = Array.from(tab.getSettingDefinitions()).flatMap(def => {
      assert.ok('type' in def && def.type === 'group');
      const group = def as SettingDefinitionGroup;
      return [group.heading!, ...group.items!.filter(item => typeof item.visible === 'function' ? item.visible() : item.visible !== false).map(item => item.name)];
    });
    t.settingRows.length = 0; tab.display();
    const legacy = t.settingRows.filter(row => !row.settingEl.hidden && !/^\d+$/.test(row.name)).map(row => row.name);
    assert.deepEqual(legacy, modern, JSON.stringify({ customColors, hierarchyColors, focus }));
    if (customColors && hierarchyColors && focus) assert.deepEqual(modern, expected);
    assert.deepEqual(t.settingRows.filter(row => row.heading).map(row => row.name), ['Dictionary', 'Colors', 'Sidebar', 'Focus', 'Additional views']);
  }
});

test('color mode updates both settings APIs while keeping all saved colors', async () => {
  const t = await setup(); await t.loaded;
  Object.assign(t.plugin.settings, { customColors: true, tagColor: '#123456' });
  const before = [...t.plugin.settings.hierarchyPalette];
  const tab = t.settingTabs[0] as { getSettingDefinitions(): SettingDefinitionItem[]; display(): void; update(): void; definitions: SettingDefinitionItem[] };
  tab.display(); tab.update();
  const mode = () => [...t.settingRows].reverse().find(row => row.name === 'Color mode')!;
  const name = () => (tab.definitions[1] as SettingDefinitionGroup).items![4].name;
  assert.equal(mode().dropdownValue, 'single');
  mode().dropdownChanged!('depth'); await settle();
  assert.equal(name(), 'Color for tags outside the hierarchy');
  mode().dropdownChanged!('default'); await settle();
  assert.equal(t.plugin.settings.customColors, false);
  t.legacySettings(); Object.defineProperty(tab, 'update', { value: undefined });
  mode().dropdownChanged!('depth'); await settle();
  assert.equal(mode().dropdownValue, 'depth');
  assert.ok(t.settingRows.some(row => row.name === 'Color for tags outside the hierarchy'));
  assert.equal(t.plugin.settings.tagColor, '#123456');
  assert.deepEqual([...t.plugin.settings.hierarchyPalette], before);
});

test('named palette dialog validates names and saves an independent snapshot', async () => {
  const t = await setup(); await t.loaded;
  await t.plugin.setPaletteColor(0, '#123456');
  t.plugin.promptSavePalette();
  const modal = t.modals.at(-1)!;
  const input = t.settingRows.find(row => row.name === 'Palette name')!;
  const save = t.settingRows.find(row => row.buttonNames.includes('Save palette'))!;
  save.buttons[0](); await settle();
  assert.equal(modal.closed, false); assert.match(modal.errorText, /name/);
  input.textValue = 'Study'; save.buttons[0](); await settle();
  assert.equal(modal.closed, true);
  assert.equal(t.plugin.settings.hierarchyPalettePreset, 'saved:Study');
  await t.plugin.setPaletteColor(0, '#654321');
  assert.equal(t.plugin.settings.savedHierarchyPalettes[0].colors[0], '#123456');
  const restored = await setup(Promise.resolve(structuredClone(t.savedWrites.at(-1))));
  await restored.loaded;
  await restored.plugin.choosePalette('saved:Study');
  assert.equal(restored.plugin.settings.hierarchyPalette[0], '#123456');
  await restored.plugin.choosePalette('custom');
  assert.equal(restored.plugin.settings.hierarchyPalette[0], '#654321');
});

test('a failed named save restores the working copy and can retry the same name', async () => {
  const t = await setup(); await t.loaded;
  await t.plugin.setPaletteColor(0, '#123456');
  const before = [...t.plugin.settings.customHierarchyPalette];
  const save = t.plugin.saveData.bind(t.plugin); let fail = true;
  t.plugin.saveData = async data => { if (fail) { fail = false; throw new Error('disk unavailable'); } await save(data); };
  await assert.rejects(t.plugin.savePaletteAs('Study'), /disk unavailable/);
  assert.equal(t.plugin.settings.hierarchyPalettePreset, 'custom');
  assert.deepEqual([...t.plugin.settings.customHierarchyPalette], before);
  assert.equal(t.plugin.settings.savedHierarchyPalettes.length, 0);
  await t.plugin.savePaletteAs('Study');
  assert.equal(t.plugin.settings.savedHierarchyPalettes[0].name, 'Study');
});

test('palette deletion confirms the selected name, preserves working colors and survives restart', async () => {
  const t = await setup(); await t.loaded;
  await t.plugin.savePaletteAs('Study');
  await t.plugin.setPaletteColor(0, '#123456');
  const working = [...t.plugin.settings.customHierarchyPalette];
  await t.plugin.choosePalette('saved:Study');
  t.plugin.managePalettes();
  const row = t.settingRows.at(-1)!;
  assert.equal(row.name, 'Study'); row.buttons[0]();
  assert.equal(t.modals.at(-1)!.title, 'Delete Study?');
  assert.equal(t.plugin.settings.savedHierarchyPalettes.length, 1, 'opening confirmation does not delete');
  const confirm = t.settingRows.at(-1)!;
  confirm.buttons[confirm.buttonNames.indexOf('Delete palette')](); await settle();
  assert.equal(t.plugin.settings.savedHierarchyPalettes.length, 0);
  assert.equal(t.plugin.settings.hierarchyPalettePreset, 'default');
  assert.deepEqual([...t.plugin.settings.customHierarchyPalette], working);
  const restored = await setup(Promise.resolve(structuredClone(t.savedWrites.at(-1)))); await restored.loaded;
  assert.equal(restored.plugin.settings.savedHierarchyPalettes.length, 0);
  assert.deepEqual([...restored.plugin.settings.customHierarchyPalette], working);
});

test('a failed palette deletion restores the snapshot and active colors', async () => {
  const t = await setup(); await t.loaded;
  await t.plugin.setPaletteColor(0, '#123456'); await t.plugin.savePaletteAs('Study');
  const colors = [...t.plugin.settings.hierarchyPalette];
  const save = t.plugin.saveData.bind(t.plugin);
  t.plugin.saveData = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(t.plugin.deletePalette('Study'), /disk unavailable/);
  assert.equal(t.plugin.settings.savedHierarchyPalettes[0].name, 'Study');
  assert.equal(t.plugin.settings.hierarchyPalettePreset, 'saved:Study');
  assert.deepEqual([...t.plugin.settings.hierarchyPalette], colors);
  t.plugin.saveData = save; await t.plugin.deletePalette('Study');
  assert.equal(t.plugin.settings.savedHierarchyPalettes.length, 0);
});

test('IME confirmation Enter does not submit a palette name', async () => {
  const t = await setup(); await t.loaded;
  t.plugin.promptSavePalette();
  const modal = t.modals.at(-1)!;
  const input = t.settingRows.find(row => row.name === 'Palette name')!;
  input.textValue = '연구 팔레트';
  input.keyDown!({ key: 'Enter', isComposing: true, preventDefault() {} }); await settle();
  assert.equal(modal.closed, false); assert.equal(t.plugin.settings.savedHierarchyPalettes.length, 0);
  input.keyDown!({ key: 'Enter', isComposing: false, preventDefault() {} }); await settle();
  assert.equal(modal.closed, true); assert.equal(t.plugin.settings.savedHierarchyPalettes[0].name, '연구 팔레트');
});

test('review: failed deletion must preserve a concurrently saved case-variant snapshot', async () => {
  const t = await setup(); await t.loaded;
  await t.plugin.savePaletteAs('Study');
  const save = t.plugin.saveData.bind(t.plugin);
  let rejectDelete!: (error: Error) => void;
  let first = true;
  t.plugin.saveData = async data => {
    if (first) { first = false; await new Promise<void>((_resolve, reject) => { rejectDelete = reject; }); }
    else await save(data);
  };
  const pending = t.plugin.deletePalette('Study');
  const failed = assert.rejects(pending, /disk unavailable/);
  await t.plugin.setPaletteColor(0, '#123456');
  await t.plugin.savePaletteAs('study');
  rejectDelete(new Error('disk unavailable')); await failed;
  await t.plugin.saveSettings();
  assert.ok(t.plugin.settings.savedHierarchyPalettes.some(p => p.name === 'study' && p.colors[0] === '#123456'), 'new successful snapshot must survive rollback');
});
