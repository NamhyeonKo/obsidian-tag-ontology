import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology, isIncludedNote } from '../src/ontology.ts';
import * as settings from '../src/settings.ts';

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
  native: NativeGraphs; model?: Ontology; settings: settings.Settings;
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
    async cachedRead() { reads++; return dictionary; },
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
