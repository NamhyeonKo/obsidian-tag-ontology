import { Notice, Plugin, PluginSettingTab, Setting, TFile, getAllTags, type App } from 'obsidian';
import { Ontology, isIncludedNote, type Note } from './ontology.ts';
import { sanitizeSettings, isValidDictionaryPath, type Settings } from './settings.ts';
import { OntologyView, VIEW_TYPE } from './view.ts';
import { NativeGraphs } from './native.ts';

export type { Settings } from './settings.ts';

export default class TagOntologyPlugin extends Plugin {
  settings: Settings = sanitizeSettings(null);
  model?: Ontology;
  native = new NativeGraphs(this);
  loadMetrics = { dictionaryMs: 0, indexMs: 0, noteCount: 0, taggedNotes: 0 };
  private refreshTimer?: number;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new OntologyView(leaf, this));
    this.addRibbonIcon('graph', 'Open tag ontology', () => { void this.openView(); });
    this.addCommand({ id: 'open-graph', name: 'Open graph', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'open-compatibility-viewer', name: 'Open compatibility viewer', callback: () => { void this.openDetailView(); } });
    this.addCommand({ id: 'reload-dictionary', name: 'Reload dictionary', callback: () => {
      void this.refreshViews();
    } });
    this.addSettingTab(new OntologySettingsTab(this.app, this));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.native.attach()));
    this.app.workspace.onLayoutReady(() => { void this.refreshViews(); });
    const relevant = (path: string) => path === this.settings.dictionaryPath || isIncludedNote(path);
    const changed = (file: { path: string }) => { if (relevant(file.path)) this.scheduleRefresh(); };
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (relevant(file.path) || relevant(oldPath)) this.scheduleRefresh();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', changed));
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.scheduleRefresh();
    }));
  }

  async loadModel(): Promise<Ontology> {
    if (!isValidDictionaryPath(this.settings.dictionaryPath)) throw new Error('The dictionary path is not allowed.');
    const start = performance.now();
    const file = this.app.vault.getAbstractFileByPath(this.settings.dictionaryPath);
    if (!(file instanceof TFile)) throw new Error(`Tag dictionary not found: ${this.settings.dictionaryPath}`);
    let raw: unknown;
    try { raw = JSON.parse(await this.app.vault.cachedRead(file)); }
    catch (error) { throw new Error(`Could not read the tag dictionary: ${String(error)}`); }
    const dictionaryMs = performance.now() - start;
    const indexStart = performance.now();
    const files = this.app.vault.getMarkdownFiles().filter((note) => isIncludedNote(note.path));
    const notes: Note[] = files.map((note) => {
      const cache = this.app.metadataCache.getFileCache(note);
      if (!cache) throw new Error(`The metadata cache is not ready yet: ${note.path}`);
      const tags = [...new Set((getAllTags(cache) ?? []).map(tag => tag.replace(/^#/, '')))];
      return { path: note.path, tags };
    });
    const model = new Ontology(raw, notes);
    this.loadMetrics = {
      dictionaryMs, indexMs: performance.now() - indexStart,
      noteCount: files.length, taggedNotes: notes.filter((note) => note.tags.length > 0).length,
    };
    this.model = model;
    return model;
  }

  async saveSettings(): Promise<void> {
    this.settings = sanitizeSettings(this.settings);
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  async openView(): Promise<void> {
    try {
      await this.loadModel();
      const existing = this.app.workspace.getLeavesOfType('graph')[0];
      const leaf = existing ?? this.app.workspace.getLeaf('tab');
      if (!existing) await leaf.setViewState({ type: 'graph', active: true });
      this.native.attach();
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { new Notice(`Could not open the graph: ${String(error)}`); }
  }

  async openDetailView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = undefined; void this.refreshViews(); }, 300);
  }

  private async refreshViews(): Promise<void> {
    try { await this.loadModel(); this.native.refresh(); }
    catch (error) { console.error('Tag Ontology:', error); }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof OntologyView) await leaf.view.refresh();
    }
  }

  onunload(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.native.destroy();
  }
}

class OntologySettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: TagOntologyPlugin) { super(app, owner); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Dictionary path').setDesc('Vault-relative path to the tag dictionary JSON file.').addText((text) => {
      text.setValue(this.owner.settings.dictionaryPath).onChange(async (path) => {
        if (!isValidDictionaryPath(path)) { new Notice('Enter a .json path inside the vault, outside the config folder.'); return; }
        this.owner.settings.dictionaryPath = path;
        await this.owner.saveSettings();
      });
    });
    new Setting(containerEl).setName('Layout').addDropdown((dropdown) => {
      dropdown.addOptions({ force: 'Force', tree: 'Tree', radial: 'Radial' })
        .setValue(this.owner.settings.layout).onChange(async (layout) => {
          this.owner.settings = sanitizeSettings({ ...this.owner.settings, layout });
          await this.owner.saveSettings();
        });
    });
  }
}
