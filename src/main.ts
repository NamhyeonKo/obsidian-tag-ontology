import { ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, getAllTags, type App, type ColorComponent, type SettingDefinitionItem, type WorkspaceLeaf } from 'obsidian';
import { Ontology, isIncludedNote, type Note } from './ontology.ts';
import { DEFAULT_SETTINGS, cssColorToHex, sanitizeSettings, isValidDictionaryPath, type Settings } from './settings.ts';
import { NativeGraphs, PANEL_VIEW } from './native.ts';
import { apply, conflicts, serialize, type Change, type RawDictionary } from './dictionary.ts';

export type { Settings } from './settings.ts';

const ICON = 'book-open';
// Obsidian's default accent color, for a theme whose accent can't be read.
const ACCENT = '#8b6cef';
export const CONFLICT = 'The dictionary changed outside the editor. Cancel and edit again to see the latest version.';
// Notices and the sidebar show the message alone; String(error) would add an "Error: " prefix.
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

export default class TagOntologyPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  model?: Ontology;
  // The parsed dictionary the model was built from; editors start from a copy of it.
  raw?: RawDictionary;
  // Why the last reload failed; the sidebar shows it until one works again.
  error?: string;
  native = new NativeGraphs(this);
  loadMetrics = { dictionaryMs: 0, indexMs: 0, noteCount: 0, taggedNotes: 0 };
  // True until data.json exists: a fresh install, used once to turn on the core graph's Tags filter.
  firstRun = false;
  private refreshTimer?: number;
  private redraw = false;
  private disposed = false;
  // The accent last handed out for drawing, so other style changes on <body> don't redraw the graphs.
  private accent?: string;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    if (this.disposed) return;
    this.firstRun = saved === null || saved === undefined;
    this.settings = sanitizeSettings(saved, this.app.vault.configDir);
    this.registerView(PANEL_VIEW, leaf => new DictionaryView(leaf, this));
    this.addRibbonIcon(ICON, 'Open tag ontology', () => { void this.openView(); });
    this.addCommand({ id: 'open-graph', name: 'Open graph', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'reload-dictionary', name: 'Reload dictionary', callback: () => {
      void this.refreshViews({ notify: true });
    } });
    this.addSettingTab(new OntologySettingsTab(this.app, this));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.native.attach()));
    // A tag color left to the accent follows it. A theme change fires css-change; the accent color setting only rewrites the
    // accent variables on <body>, so <body>'s style is watched too.
    this.registerEvent(this.app.workspace.on('css-change', () => this.followAccent()));
    const accentWatch = new MutationObserver(() => this.followAccent());
    accentWatch.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    this.register(() => accentWatch.disconnect());
    // A broken dictionary is reported at startup; a missing one isn't, as a sync still catching up looks the same and the sidebar explains it.
    this.app.workspace.onLayoutReady(() => { void this.ensureDictionary().then(() => this.refreshViews({ notify: this.app.vault.getAbstractFileByPath(this.settings.dictionaryPath) instanceof TFile })); });
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

  // Every load records how it went, whichever path started it, so the sidebar shows a failure until any later load works.
  async loadModel(): Promise<Ontology> {
    try { const model = await this.readModel(); this.error = undefined; return model; }
    catch (error) { this.error = reason(error); throw error; }
  }

  private async readModel(): Promise<Ontology> {
    if (!isValidDictionaryPath(this.settings.dictionaryPath, this.app.vault.configDir)) throw new Error('The dictionary path is not allowed.');
    const start = performance.now();
    const file = this.app.vault.getAbstractFileByPath(this.settings.dictionaryPath);
    if (!(file instanceof TFile)) throw new Error(`Tag dictionary not found: ${this.settings.dictionaryPath}`);
    // A read error keeps its own message; only a parse error is about the JSON.
    const text = await this.app.vault.cachedRead(file);
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch (error) { throw new Error(`Invalid JSON: ${reason(error)}`); }
    const dictionaryMs = performance.now() - start;
    const indexStart = performance.now();
    const notes = this.notes();
    const model = new Ontology(raw, notes);
    this.loadMetrics = {
      dictionaryMs, indexMs: performance.now() - indexStart,
      noteCount: notes.length, taggedNotes: notes.filter((note) => note.tags.length > 0).length,
    };
    this.raw = raw as RawDictionary;
    this.model = model;
    return model;
  }

  // Only a fresh install gets an empty dictionary on its own. Later a missing file is never recreated by itself: a sync that
  // hasn't caught up or an iCloud file moved off the disk looks missing too, so the sidebar offers a button instead.
  // Not on settings changes either: the path field saves on every keystroke.
  private async ensureDictionary(): Promise<void> {
    const { vault } = this.app, path = this.settings.dictionaryPath;
    try {
      if (!this.firstRun || !isValidDictionaryPath(path, vault.configDir) || await vault.adapter.exists(path) || this.disposed) return;
      await this.writeEmpty(path);
    } catch (error) { console.error('Tag Ontology:', error); }
  }

  async createDictionary(): Promise<boolean> {
    try { await this.writeEmpty(this.settings.dictionaryPath); }
    catch (error) { new Notice(`Could not create the dictionary: ${String(error)}`); return false; }
    await this.reload();
    return true;
  }

  // vault.create refuses an existing path, so this never replaces a dictionary.
  private async writeEmpty(path: string): Promise<void> {
    const { vault } = this.app, parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!await vault.adapter.exists(folder)) await vault.createFolder(folder);
    }
    await vault.create(path, '{\n}\n');
  }

  // A note the metadata cache hasn't indexed yet (one that arrived while Obsidian was closed) is left out until its
  // 'changed' event reloads, instead of failing the whole dictionary.
  private notes(): Note[] {
    return this.app.vault.getMarkdownFiles().filter((note) => isIncludedNote(note.path)).flatMap((note) => {
      const cache = this.app.metadataCache.getFileCache(note);
      return cache ? [{ path: note.path, tags: [...new Set((getAllTags(cache) ?? []).map(tag => tag.replace(/^#/, '')))] }] : [];
    });
  }

  // One read-check-write: the change goes onto the latest file only if the entries it rewrites are as the editor saw them,
  // and only if the result is still a valid dictionary. Nothing is written otherwise.
  async saveChange(change: Change, base: RawDictionary): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(this.settings.dictionaryPath);
    if (!(file instanceof TFile)) { new Notice(`Tag dictionary not found: ${this.settings.dictionaryPath}`); return false; }
    try {
      await this.app.vault.process(file, (text) => {
        const latest = JSON.parse(text) as RawDictionary;
        if (conflicts(base, latest, change).length) throw new Error(CONFLICT);
        const next = apply(latest, change);
        // Checks the dictionary itself (references, cycles); notes don't affect that, and a note still being indexed mustn't block a save.
        new Ontology(next, []);
        // A file kept with CRLF line endings stays that way, so a save still changes only the lines it touches.
        // serialize's only raw newlines are line breaks: JSON.stringify escapes them inside strings.
        const out = serialize(next);
        return text.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out;
      });
      return true;
    } catch (error) {
      new Notice(error instanceof Error && error.message === CONFLICT ? CONFLICT : `Could not save the dictionary: ${String(error)}`);
      return false;
    }
  }

  reload(): Promise<void> { return this.refreshViews({ notify: true }); }

  // The picked tag color, or Obsidian's accent color while none is picked. The accent is read from the theme's variable, which
  // the app's own styles set before any plugin loads.
  tagColor(): string {
    return this.settings.tagColor || (this.accent = this.readAccent());
  }

  private readAccent(): string {
    return cssColorToHex(getComputedStyle(document.body).getPropertyValue('--color-accent')) ?? ACCENT;
  }

  // Every redraw takes the tag color from tagColor(), so whatever redrew last, the accent it drew with is the one compared.
  private followAccent() {
    if (!this.model || !this.settings.customColors || this.settings.tagColor || this.readAccent() === this.accent) return;
    this.native.refresh();
  }

  // Persists graph state (expansion, toggles) without reloading the dictionary or redrawing views.
  async saveState(): Promise<void> {
    await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    this.settings = sanitizeSettings(this.settings, this.app.vault.configDir);
    await this.saveData(this.settings);
    await this.refreshViews({ notify: true });
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
      // Attaches like attach() and also redraws the sidebar, which may still show a failure this load cleared.
      this.native.refresh(false);
      // The sidebar tab opens and comes forward with the graph, even when the sidebar is closed or shows another tab.
      this.native.showPanel(true);
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      if (this.disposed) return;
      new Notice(`Could not open the graph: ${reason(error)}`);
      this.native.renderPanel();
    }
  }

  // Only a dictionary change redraws graphs; note edits reach them through the core graph's own update.
  private scheduleRefresh(...paths: string[]): void {
    this.redraw ||= paths.includes(this.settings.dictionaryPath);
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      const redraw = this.redraw; this.redraw = false;
      void this.refreshViews({ redraw });
    }, 300);
  }

  private async refreshViews({ redraw = true, notify = false } = {}): Promise<void> {
    if (this.disposed) return;
    try { await this.loadModel(); if (!this.disposed) this.native.refresh(redraw); }
    catch (error) {
      if (this.disposed) return;
      console.error('Tag Ontology:', error);
      this.native.renderPanel();
      if (notify) new Notice(`Could not load the tag dictionary: ${reason(error)}`);
    }
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
const LAYOUT = { name: 'Layout', desc: 'Force and the tree layouts are on the graph toolbar. 3D is coming in a later release.' };
const FOCUS = { name: 'Keep the selected tag focused', desc: 'Keep the selected tag and the tags next to it (its parents, children and related tags) bright and fade the rest.' };
const FOCUS_SCOPE = [
  { key: 'focusDescendants', name: 'Its descendants', desc: 'Also keep every tag under it bright, as far as they are expanded.' },
  { key: 'focusNotes', name: 'Include notes', desc: 'Also keep the notes on the selected tag bright, and on its descendants when those are on.' },
] as const;
const CUSTOM = { name: 'Custom colors', desc: 'Color the tags in the graph with your own colors. Turn off to keep the graph\'s own colors.' };
const TAG_COLOR = { name: 'Tag color', desc: 'Every tag in the graph and in the sidebar takes this color. It follows the accent color until you pick one.' };
const TITLE = { name: 'Tag title in the tag color', desc: 'Show the selected tag\'s title in the sidebar in the tag color.' };

class OntologySettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: TagOntologyPlugin) { super(app, owner); }

  // Obsidian 1.13+ renders these declaratively and indexes them for settings search.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: 'Dictionary path', desc: 'Vault-relative path to the tag dictionary JSON file.', control: {
        type: 'text', key: 'dictionaryPath', defaultValue: DEFAULT_SETTINGS.dictionaryPath,
        validate: (path: string) => isValidDictionaryPath(path, this.app.vault.configDir) ? undefined : PATH_HINT,
      } },
      // A plain dropdown can't turn off one option, so this row is drawn by hand.
      { ...LAYOUT, render: (setting) => { this.layout(setting); } },
      { ...FOCUS, control: { type: 'toggle', key: 'focus', defaultValue: DEFAULT_SETTINGS.focus } },
      // What else stays bright only shows while focus is on.
      { type: 'group', visible: () => this.owner.settings.focus, items:
        FOCUS_SCOPE.map(({ key, name, desc }) => ({ name, desc, control: { type: 'toggle' as const, key, defaultValue: DEFAULT_SETTINGS[key] } })) },
      { ...CUSTOM, control: { type: 'toggle', key: 'customColors', defaultValue: DEFAULT_SETTINGS.customColors } },
      // The color options only show while custom colors are on.
      { type: 'group', visible: () => this.owner.settings.customColors, items: [
        // A plain color control has no way back to following the accent, so this row is drawn by hand.
        { ...TAG_COLOR, render: (setting) => { this.tagColor(setting); } },
        { ...TITLE, control: { type: 'toggle', key: 'titleAccent', defaultValue: DEFAULT_SETTINGS.titleAccent } },
      ] },
    ];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    this.owner.settings = sanitizeSettings({ ...this.owner.settings, [key]: value }, this.app.vault.configDir);
    await this.owner.saveSettings();
  }

  // Only the 2D graph exists yet: 3D (beta) is listed so it can be seen coming, but can't be chosen.
  private layout(setting: Setting): Setting {
    return setting.setName(LAYOUT.name).setDesc(LAYOUT.desc).addDropdown((dropdown) => {
      dropdown.addOptions({ '2d': '2D', '3d': '3D (beta)' }).setValue('2d');
      dropdown.selectEl.querySelector<HTMLOptionElement>('option[value="3d"]')!.disabled = true;
    });
  }

  // The picker shows the color in use, the accent until one is picked; the reset button goes back to following the accent.
  // Showing the accent again calls onChange too, and that must not pin the accent as a picked color.
  private tagColor(setting: Setting): Setting {
    let shown: ColorComponent | undefined;
    return setting.setName(TAG_COLOR.name).setDesc(TAG_COLOR.desc)
      .addColorPicker((picker) => {
        shown = picker;
        picker.setValue(this.owner.tagColor()).onChange(async (value) => {
          if (!this.owner.settings.tagColor && value === this.owner.tagColor()) return;
          await this.setControlValue('tagColor', value);
        });
      })
      .addExtraButton(button => button.setIcon('rotate-ccw').setTooltip('Use the accent color').onClick(async () => {
        await this.setControlValue('tagColor', '');
        shown?.setValue(this.owner.tagColor());
      }));
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
    this.layout(new Setting(containerEl));
    const scope: Setting[] = [];
    new Setting(containerEl).setName(FOCUS.name).setDesc(FOCUS.desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.focus).onChange((value) => {
        for (const setting of scope) setting.settingEl.toggle(value);
        return this.setControlValue('focus', value);
      });
    });
    for (const { key, name, desc } of FOCUS_SCOPE) scope.push(new Setting(containerEl).setName(name).setDesc(desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings[key]).onChange(value => this.setControlValue(key, value));
    }));
    for (const setting of scope) setting.settingEl.toggle(this.owner.settings.focus);
    const custom: Setting[] = [];
    new Setting(containerEl).setName(CUSTOM.name).setDesc(CUSTOM.desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.customColors).onChange((value) => {
        for (const setting of custom) setting.settingEl.toggle(value);
        return this.setControlValue('customColors', value);
      });
    });
    custom.push(this.tagColor(new Setting(containerEl)));
    custom.push(new Setting(containerEl).setName(TITLE.name).setDesc(TITLE.desc).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.titleAccent).onChange(value => this.setControlValue('titleAccent', value));
    }));
    for (const setting of custom) setting.settingEl.toggle(this.owner.settings.customColors);
  }
}
