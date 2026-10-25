import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology, isIncludedNote } from '../src/ontology.ts';
import * as settings from '../src/settings.ts';
import * as dictionaryModule from '../src/dictionary.ts';
import { apply, draftOf, serialize, type Change, type RawDictionary } from '../src/dictionary.ts';

const dictionary = JSON.stringify({ root: { description: 'Root', broader: [] } });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class NativeGraphs {
  calls: string[] = [];
  attach() { this.calls.push('attach'); }
  refresh(redraw = true) { this.calls.push(`refresh:${redraw}`); }
  showPanel() { this.calls.push('panel'); }
  destroy() { this.calls.push('destroy'); }
}

interface Main {
  native: NativeGraphs; model?: Ontology; settings: settings.Settings; raw?: RawDictionary;
  saveChange(change: Change, base: RawDictionary): Promise<boolean>; createDictionary(): Promise<boolean>;
  onload(): Promise<void>; onunload(): void; openView(): Promise<void>; saveSettings(): Promise<void>;
}

async function setup(saved?: Promise<unknown>) {
  const notices: string[] = [], errors: unknown[][] = [], ui: string[] = [];
  const commands = new Map<string, () => void>();
  const events = new Map<string, (file: { path: string }) => void>();
  const timers = new Map<number, () => void>();
  let ready = () => {}, timer = 0, reads = 0;
  class File {}
  const leaf = { async setViewState() { ui.push('create'); } };
  const vault = {
    configDir: '.obsidian', getAbstractFileByPath: () => new File(), getMarkdownFiles: () => [],
    text: dictionary, writes: [] as string[],
    existing: new Set(['Tag-Dictionary.json']), created: [] as string[],
    adapter: { exists: async (path: string) => vault.existing.has(path) },
    async createFolder(path: string) { vault.created.push(`folder:${path}`); vault.existing.add(path); },
    // Like Obsidian, create refuses a path that already exists.
    async create(path: string, data: string) { if (vault.existing.has(path)) throw new Error('File already exists.'); vault.created.push(`file:${path}:${data}`); vault.existing.add(path); },
    async cachedRead() { reads++; return vault.text; },
    // Like Obsidian, a throwing callback rejects without writing.
    async process(_file: unknown, fn: (text: string) => string) { const out = fn(vault.text); vault.text = out; vault.writes.push(out); return out; },
    on(name: string, callback: (file: { path: string }) => void) { events.set(name, callback); },
  };
  const workspace = {
    getLeavesOfType: (): typeof leaf[] => [], getLeaf: () => leaf,
    async revealLeaf() { ui.push('reveal'); },
    on() {}, onLayoutReady(callback: () => void) { ready = callback; },
  };
  class Plugin {
    app = { vault, workspace, metadataCache: { on() {} } };
    loadData() { return saved ?? Promise.resolve({}); }
    async saveData() {}
    registerView() { ui.push('register-view'); }
    addRibbonIcon() {} addSettingTab() {} registerEvent() {}
    addCommand(command: { id: string; callback: () => void }) { commands.set(command.id, command.callback); }
  }
  const context = createContext({ performance, console: { error: (...args: unknown[]) => errors.push(args) }, window: {
    setTimeout(callback: () => void) { timers.set(++timer, callback); return timer; },
    clearTimeout(id: number) { timers.delete(id); },
  } });
  const code = await transform(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian'
      ? { Plugin, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: File, getAllTags: () => [],
        Notice: class { constructor(message: string) { notices.push(message); } } }
      : specifier === './ontology.ts' ? { Ontology, isIncludedNote }
      : specifier === './settings.ts' ? { ...settings }
      : specifier === './dictionary.ts' ? { ...dictionaryModule }
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
  return { plugin, loaded, vault, workspace, leaf, notices, errors, ui, commands, events, ready: () => ready(), runTimers, reads: () => reads };
}

test('opening a graph still loads the dictionary, attaches and reveals it', async () => {
  const t = await setup();
  await t.plugin.openView();
  assert.deepEqual(t.plugin.model!.roots, ['root']);
  assert.deepEqual(t.plugin.native.calls, ['attach', 'panel']);
  assert.deepEqual(t.ui, ['create', 'reveal']);
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
  assert.deepEqual(t.plugin.native.calls, ['refresh:true']);
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
  assert.deepEqual(t.plugin.native.calls, ['refresh:true']);
});

test('a pending manual reload does not report its failure after unload', async () => {
  const t = await setup(), read = deferred<string>();
  t.vault.cachedRead = () => read.promise;
  t.commands.get('reload-dictionary')!();
  t.plugin.onunload(); read.resolve('{invalid'); await settle();
  assert.deepEqual(t.notices, []);
  assert.deepEqual(t.errors, []);
});

test('note edits still skip graph redraws and a coalesced dictionary edit still redraws', async () => {
  const t = await setup();
  t.ready(); await settle();
  t.events.get('modify')!({ path: 'Notes/A.md' }); t.runTimers(); await settle();
  t.events.get('modify')!({ path: 'Tag-Dictionary.json' });
  t.events.get('modify')!({ path: 'Notes/A.md' }); t.runTimers(); await settle();
  assert.deepEqual(t.plugin.native.calls, ['refresh:true', 'refresh:false', 'refresh:true']);
  assert.equal(t.reads(), 3);
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

const base: RawDictionary = { root: { description: 'Root', broader: [] }, child: { description: 'Child', broader: ['root'] } };
const describe = (description: string): Change => ({ kind: 'edit', tag: 'child', draft: { ...draftOf(base, 'child'), description } });
async function withBase() {
  const t = await setup();
  t.vault.text = serialize(base); t.ready(); await settle();
  return t;
}

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

test('saveChange refuses when a touched entry changed outside, and writes nothing', async () => {
  const t = await withBase();
  t.vault.text = serialize({ ...base, child: { description: 'Outside', broader: ['root'] } });
  assert.equal(await t.plugin.saveChange(describe('New'), base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.equal(t.notices.at(-1), 'The dictionary changed outside the editor. Cancel and edit again to see the latest version.');
});

test('saveChange refuses a change that would break the dictionary', async () => {
  const t = await withBase();
  const change: Change = { kind: 'edit', tag: 'child', draft: { ...draftOf(base, 'child'), parents: ['missing'] } };
  assert.equal(await t.plugin.saveChange(change, base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.match(t.notices.at(-1)!, /^Could not save the dictionary: .*unknown tag missing/);
});

test('saveChange writes nothing over a broken file', async () => {
  const t = await withBase();
  t.vault.text = '{ broken';
  assert.equal(await t.plugin.saveChange(describe('New'), base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.match(t.notices.at(-1)!, /^Could not save the dictionary:/);
});

test('a fresh install creates an empty dictionary once the layout is ready', async () => {
  const t = await setup(Promise.resolve(null));
  await t.loaded; t.vault.existing.clear();
  t.ready(); await settle();
  assert.deepEqual(t.vault.created, ['file:Tag-Dictionary.json:{\n}\n']);
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

test('createDictionary makes the folder and an empty file, then reloads', async () => {
  const t = await setup(Promise.resolve({ dictionaryPath: 'Dicts/Tags.json' }));
  await t.loaded; t.vault.existing.clear();
  assert.equal(await t.plugin.createDictionary(), true);
  assert.deepEqual(t.vault.created, ['folder:Dicts', 'file:Dicts/Tags.json:{\n}\n']);
  assert.ok(t.plugin.model);
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
  (t.vault as { getAbstractFileByPath: () => unknown }).getAbstractFileByPath = () => null;
  assert.equal(await t.plugin.saveChange(describe('New'), base), false);
  assert.deepEqual(t.vault.writes, []);
  assert.equal(t.notices.at(-1), 'Tag dictionary not found: Tag-Dictionary.json');
});
