import { ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, getAllTags, type App, type SettingDefinitionItem, type WorkspaceLeaf } from 'obsidian';
import { Ontology, isIncludedNote, type Note } from './ontology.ts';
import { DEFAULT_SETTINGS, sanitizeSettings, isValidDictionaryPath, type Settings } from './settings.ts';
import { NativeGraphs, PANEL_VIEW } from './native.ts';

export type { Settings } from './settings.ts';

const ICON = 'book-open';

export default class TagOntologyPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  model?: Ontology;
  native = new NativeGraphs(this);
  loadMetrics = { dictionaryMs: 0, indexMs: 0, noteCount: 0, taggedNotes: 0 };
  // True until data.json exists: a fresh install, used once to turn on the core graph's Tags filter.
  firstRun = false;
  private refreshTimer?: number;
  private redraw = false;
  private disposed = false;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    if (this.disposed) return;
    this.firstRun = saved === null || saved === undefined;
    this.settings = sanitizeSettings(saved, this.app.vault.configDir);
    this.registerView(PANEL_VIEW, leaf => new DictionaryView(leaf, this));
    this.addRibbonIcon(ICON, 'Open tag ontology', () => { void this.openView(); });
    this.addCommand({ id: 'open-graph', name: 'Open graph', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'reload-dictionary', name: 'Reload dictionary', callback: () => {
      void this.refreshViews();
    } });
    this.addSettingTab(new OntologySettingsTab(this.app, this));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.native.attach()));
    this.app.workspace.onLayoutReady(() => { void this.refreshViews(); });
    const relevant = (path: string) => path === this.settings.dictionaryPath || isIncludedNote(path);
    const changed = (file: { path: string }) => { if (relevant(file.path)) this.scheduleRefresh(file.path); };
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (relevant(file.path) || relevant(oldPath)) this.scheduleRefresh(file.path, oldPath);
    }));
    this.registerEvent(this.app.metadataCache.on('changed', changed));
  }

  async loadModel(): Promise<Ontology> {
    if (!isValidDictionaryPath(this.settings.dictionaryPath, this.app.vault.configDir)) throw new Error('The dictionary path is not allowed.');
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

  // Persists graph state (expansion, toggles) without reloading the dictionary or redrawing views.
  async saveState(): Promise<void> {
    await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    this.settings = sanitizeSettings(this.settings, this.app.vault.configDir);
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  async openView(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.loadModel();
      if (this.disposed) return;
      const existing = this.app.workspace.getLeavesOfType('graph')[0];
      const leaf = existing ?? this.app.workspace.getLeaf('tab');
      if (!existing) await leaf.setViewState({ type: 'graph', active: true });
      if (this.disposed) return;
      this.native.attach();
      this.native.showPanel(false);
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { if (!this.disposed) new Notice(`Could not open the graph: ${String(error)}`); }
  }

  // Only a dictionary change redraws graphs; note edits reach them through the core graph's own update.
  private scheduleRefresh(...paths: string[]): void {
    this.redraw ||= paths.includes(this.settings.dictionaryPath);
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      const redraw = this.redraw; this.redraw = false;
      void this.refreshViews(redraw);
    }, 300);
  }

  private async refreshViews(redraw = true): Promise<void> {
    if (this.disposed) return;
    try { await this.loadModel(); if (!this.disposed) this.native.refresh(redraw); }
    catch (error) { if (!this.disposed) console.error('Tag Ontology:', error); }
  }

  onunload(): void {
    this.disposed = true;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.native.destroy();
  }
}

// The search box and tag details, in a sidebar tab the user can drag to either side.
class DictionaryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private owner: TagOntologyPlugin) { super(leaf); }
  getViewType(): string { return PANEL_VIEW; }
  getDisplayText(): string { return 'Tag dictionary'; }
  getIcon(): string { return ICON; }
  onOpen(): Promise<void> { this.owner.native.mount(this.contentEl); return Promise.resolve(); }
}

const PATH_HINT = 'Enter a .json path inside the vault, outside the config folder.';
const LAYOUTS = { force: 'Force', tree: 'Vertical tree', 'tree-horizontal': 'Horizontal tree' };
const FOCUS = { name: 'Keep the selected tag focused', desc: 'Keep the selected tag and its links bright and fade the rest, as when you hover it.' };
const CUSTOM = { name: 'Custom colors', desc: 'Color the tags in the graph with your own colors. Turn off to keep the graph\'s own colors.' };
const TAG_COLOR = { name: 'Tag color', desc: 'Every tag in the graph takes this color.' };
const HIGHLIGHT_COLOR = { name: 'Highlight color', desc: 'Highlighted tags take this color.' };
const HIGHLIGHTS = [
  { key: 'highlightSelected', name: 'Highlight the selected tag', desc: 'The tag you clicked or searched.' },
  { key: 'highlightDescendants', name: 'Highlight its descendants', desc: 'Every tag under the selected tag.' },
  { key: 'highlightConnected', name: 'Highlight its connected tags', desc: 'The parents, children and related tags of the selected tag.' },
] as const;
const TITLE = { name: 'Tag title in the highlight color', desc: 'Show the selected tag\'s title in the sidebar in the highlight color.' };

class OntologySettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: TagOntologyPlugin) { super(app, owner); }

  // Obsidian 1.13+ renders these declaratively and indexes them for settings search.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: 'Dictionary path', desc: 'Vault-relative path to the tag dictionary JSON file.', control: {
        type: 'text', key: 'dictionaryPath', defaultValue: DEFAULT_SETTINGS.dictionaryPath,
        validate: (path: string) => isValidDictionaryPath(path, this.app.vault.configDir) ? undefined : PATH_HINT,
      } },
      { name: 'Layout', control: { type: 'dropdown', key: 'layout', options: LAYOUTS, defaultValue: DEFAULT_SETTINGS.layout } },
      { ...FOCUS, control: { type: 'toggle', key: 'focus', defaultValue: DEFAULT_SETTINGS.focus } },
      { ...CUSTOM, control: { type: 'toggle', key: 'customColors', defaultValue: DEFAULT_SETTINGS.customColors } },
      // The color options only show while custom colors are on.
      { type: 'group', visible: () => this.owner.settings.customColors, items: [
        { ...TAG_COLOR, control: { type: 'color', key: 'tagColor', defaultValue: DEFAULT_SETTINGS.tagColor } },
        { ...HIGHLIGHT_COLOR, control: { type: 'color', key: 'highlightColor', defaultValue: DEFAULT_SETTINGS.highlightColor } },
        ...HIGHLIGHTS.map(({ key, name, desc }) => ({ name, desc, control: { type: 'toggle' as const, key, defaultValue: DEFAULT_SETTINGS[key] } })),
        { ...TITLE, control: { type: 'toggle', key: 'titleAccent', defaultValue: DEFAULT_SETTINGS.titleAccent } },
      ] },
    ];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    this.owner.settings = sanitizeSettings({ ...this.owner.settings, [key]: value }, this.app.vault.configDir);
    await this.owner.saveSettings();
  }

  // Fallback for Obsidian older than 1.13, which never calls getSettingDefinitions().
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Dictionary path').setDesc('Vault-relative path to the tag dictionary JSON file.').addText((text) => {
      text.setValue(this.owner.settings.dictionaryPath).onChange(async (path) => {
        if (!isValidDictionaryPath(path, this.app.vault.configDir)) { new Notice(PATH_HINT); return; }
        this.owner.settings.dictionaryPath = path;
        await this.owner.saveSettings();
      });
    });
    new Setting(containerEl).setName('Layout').addDropdown((dropdown) => {
      dropdown.addOptions(LAYOUTS)
        .setValue(this.owner.settings.layout).onChange(async (layout) => {
          this.owner.settings = sanitizeSettings({ ...this.owner.settings, layout }, this.app.vault.configDir);
          await this.owner.saveSettings();
        });
    });
    new Setting(containerEl).setName(FOCUS.name).setDesc(FOCUS.desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.focus).onChange(value => this.setControlValue('focus', value));
    });
    const custom: Setting[] = [];
    new Setting(containerEl).setName(CUSTOM.name).setDesc(CUSTOM.desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.customColors).onChange((value) => {
        for (const setting of custom) setting.settingEl.toggle(value);
        return this.setControlValue('customColors', value);
      });
    });
    custom.push(new Setting(containerEl).setName(TAG_COLOR.name).setDesc(TAG_COLOR.desc).addColorPicker((picker) => {
      picker.setValue(this.owner.settings.tagColor).onChange(value => this.setControlValue('tagColor', value));
    }));
    custom.push(new Setting(containerEl).setName(HIGHLIGHT_COLOR.name).setDesc(HIGHLIGHT_COLOR.desc).addColorPicker((picker) => {
      picker.setValue(this.owner.settings.highlightColor).onChange(value => this.setControlValue('highlightColor', value));
    }));
    for (const { key, name, desc } of HIGHLIGHTS) custom.push(new Setting(containerEl).setName(name).setDesc(desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings[key]).onChange(value => this.setControlValue(key, value));
    }));
    custom.push(new Setting(containerEl).setName(TITLE.name).setDesc(TITLE.desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.titleAccent).onChange(value => this.setControlValue('titleAccent', value));
    }));
    for (const setting of custom) setting.settingEl.toggle(this.owner.settings.customColors);
  }
}
