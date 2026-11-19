import { ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, getAllTags, getLanguage, moment, requireApiVersion, type App, type ColorComponent, type DropdownComponent, type SettingDefinitionItem, type TextComponent, type WorkspaceLeaf } from 'obsidian';
import { AUTOMATIC_DICTIONARIES, DEFAULT_SETTINGS, TOW_FOLDER_DICTIONARY, cssColorToHex, sanitizeSettings, isValidDictionaryPath, isHiddenPath, type Settings } from './settings.ts';
import { hierarchyColor, samePalette } from './colors.ts';
import { PaletteValidationError, choosePalette as paletteChoice, deletePalette as deletedPalette, editPalette, fillPaletteSelect, paletteSelection, resizePalette as resizedPalette, savePalette as namedPalette } from './palettes.ts';
import { NativeGraphs, PANEL_VIEW } from './native.ts';
import { Ontology, apply, conflicts, isIncludedNote, serialize, usage, type Change, type Note, type RawDictionary, type Usage } from 'tag-ontology';
import { vaultData } from './vault-data.ts';
import { Graph3DView, VIEW_3D } from './graph3d.ts';
import { ExplorerView, VIEW_EXPLORER } from './explorer.ts';
import type { GraphMode } from './graph-modes.ts';
import type { NativeData } from './layer.ts';
import { getLocale, resolveLocale, setLocale, t, tPlural } from './i18n/index.ts';
import { LOCALE_LABELS, SUPPORTED_LOCALES } from './i18n/types.ts';

export type { Settings } from './settings.ts';

const ICON = 'book-open';
// Obsidian's default accent color, for a theme whose accent can't be read.
const ACCENT = '#8b6cef';
export const CONFLICT = 'The dictionary changed outside the editor. Cancel and edit again to see the latest version.';
export class DictionaryConflictError extends Error {
  constructor() { super(CONFLICT); }
}
// Notices and the sidebar show the message alone; String(error) would add an "Error: " prefix.
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

export default class TagOntologyPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  dictionaryPath = DEFAULT_SETTINGS.dictionaryPath;
  dictionaryFound?: boolean;
  model?: Ontology;
  // The parsed dictionary the model was built from; editors start from a copy of it.
  raw?: RawDictionary;
  private checked?: { model: Ontology; usage: Usage };
  // Why the last reload failed; the sidebar shows it until one works again.
  error?: string;
  native = new NativeGraphs(this);
  loadMetrics = { dictionaryMs: 0, indexMs: 0, noteCount: 0, taggedNotes: 0 };
  // True until data.json exists: a fresh install, used once to turn on the core graph's Tags filter.
  firstRun = false;
  private refreshTimer?: number;
  private dictionaryMtime?: number;
  private dictionarySize?: number;
  private dictionaryMtimePath?: string;
  private redraw = false;
  private disposed = false;
  private settingsTab?: OntologySettingsTab;
  // The accent last handed out for drawing, and the accent last synced to Obsidian's 2D graph highlight CSS.
  private accent?: string;
  private themeAccent?: string;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    if (this.disposed) return;
    this.firstRun = saved === null || saved === undefined;
    this.settings = sanitizeSettings(saved, this.app.vault.configDir);
    this.applyLocale(false);
    if (!this.settings.locationNoticeShown) {
      const fresh = saved === null || saved === undefined;
      await this.resolveDictionary();
      if (!fresh && this.dictionaryPath !== TOW_FOLDER_DICTIONARY) new Notice(t('notice.locationMoved', { towPath: TOW_FOLDER_DICTIONARY, currentPath: this.dictionaryPath }));
      this.settings.locationNoticeShown = true;
      await this.saveData(this.settings);
    }
    await this.resolveDictionary();
    if (this.disposed) return;
    this.registerView(PANEL_VIEW, leaf => new DictionaryView(leaf, this));
    this.registerView(VIEW_3D, leaf => new Graph3DView(leaf, this));
    this.registerView(VIEW_EXPLORER, leaf => new ExplorerView(leaf, this));
    this.addRibbonIcon(ICON, t('commands.ribbonOpen'), () => { void this.openView(); });
    this.addCommand({ id: 'open-graph', name: t('commands.openGraph'), callback: () => { void this.openView(); } });
    this.addCommand({ id: 'open-3d-graph', name: t('commands.open3d'), checkCallback: (checking) => {
      if (!this.settings.enable3d) return false;
      if (!checking) void this.openView('3d');
      return true;
    } });
    this.addCommand({ id: 'open-explorer', name: t('commands.openExplorer'), checkCallback: (checking) => {
      if (!this.settings.enableExplorer) return false;
      if (!checking) void this.openView('explorer');
      return true;
    } });
    this.addCommand({ id: 'reload-dictionary', name: t('commands.reloadDictionary'), callback: () => {
      void this.refreshViews({ notify: true });
    } });
    this.settingsTab = new OntologySettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.registerEvent(this.app.workspace.on('layout-change', () => this.native.attach()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => this.native.activate(leaf)));
    // A tag color left to the accent follows it. A theme change fires css-change; the accent color setting only rewrites the
    // accent variables on <body>, so <body>'s style is watched too.
    this.registerEvent(this.app.workspace.on('css-change', () => this.followAccent(false)));
    this.accent = this.readAccent(); this.themeAccent = this.readThemeAccent();
    const accentWatch = new MutationObserver(() => this.followAccent(true));
    accentWatch.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    this.register(() => accentWatch.disconnect());
    // A broken dictionary is reported at startup; a missing one isn't, as a sync still catching up looks the same and the sidebar explains it.
    this.app.workspace.onLayoutReady(() => { void this.ensureDictionary().then(async () => {
      let notify = false;
      try { notify = isHiddenPath(this.dictionaryPath) ? await this.app.vault.adapter.exists(this.dictionaryPath)
        : this.app.vault.getAbstractFileByPath(this.dictionaryPath) instanceof TFile; } catch { notify = false; }
      await this.refreshViews({ notify });
    }); });
    const relevant = (path: string) => this.isDictionaryFile(path) || isIncludedNote(path);
    const changed = (file: { path: string }) => { if (relevant(file.path)) this.scheduleRefresh(file.path); };
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (relevant(file.path) || relevant(oldPath)) this.scheduleRefresh(file.path, oldPath);
    }));
    this.registerEvent(this.app.metadataCache.on('changed', changed));
    // The 3D view takes note links from resolvedLinks, which fill in after startup and can finish after the refresh a note edit
    // scheduled, so every time the links are resolved the views refresh too (coalesced with the edit's own refresh).
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleRefresh()));
    this.registerDomEvent(window, 'focus', () => { void this.checkOutsideChange(); });
  }

  // Every load records how it went, whichever path started it, so the sidebar shows a failure until any later load works.
  async loadModel(): Promise<Ontology> {
    try { const model = await this.readModel(); this.error = undefined; return model; }
    catch (error) { this.error = reason(error); throw error; }
  }

  async resolveDictionary(): Promise<string> {
    // Disk checks, not the vault index: this also runs in onload, before the index has every file.
    const { adapter } = this.app.vault;
    if (this.settings.dictionaryPathExplicit) this.dictionaryPath = this.settings.dictionaryPath;
    else {
      this.dictionaryPath = TOW_FOLDER_DICTIONARY;
      for (const path of AUTOMATIC_DICTIONARIES) if (await adapter.exists(path)) { this.dictionaryPath = path; break; }
    }
    return this.dictionaryPath;
  }

  private isDictionaryFile(path: string): boolean {
    // Without a chosen path, a file arriving at any automatic location can take over.
    return path === this.dictionaryPath || (!this.settings.dictionaryPathExplicit && AUTOMATIC_DICTIONARIES.includes(path));
  }

  private async dictionaryExists(path: string): Promise<boolean> {
    return isHiddenPath(path) ? await this.app.vault.adapter.exists(path) : this.app.vault.getAbstractFileByPath(path) !== null;
  }

  private async readModel(): Promise<Ontology> {
    const path = await this.resolveDictionary();
    this.dictionaryFound = undefined;
    this.dictionaryMtimePath = path;
    if (!isValidDictionaryPath(path, this.app.vault.configDir)) throw new Error('The dictionary path is not allowed.');
    let dictionaryMtime: number | undefined, dictionarySize: number | undefined;
    if (isHiddenPath(path)) {
      try { const stat = await this.app.vault.adapter.stat(path); dictionaryMtime = stat?.mtime; dictionarySize = stat?.size; } catch { /* proceed without optional stat fields */ }
    }
    this.dictionaryMtime = dictionaryMtime;
    this.dictionarySize = dictionarySize;
    const start = performance.now();
    let text: string;
    if (isHiddenPath(path)) {
      if (!await this.app.vault.adapter.exists(path)) { this.dictionaryFound = false; throw new Error(`Tag dictionary not found: ${path}`); }
      this.dictionaryFound = true;
      try { text = await this.app.vault.adapter.read(path); }
      catch (error) {
        try { if (!await this.app.vault.adapter.exists(path)) this.dictionaryFound = false; } catch { /* keep the read error */ }
        throw error;
      }
    } else {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) { this.dictionaryFound = false; throw new Error(`Tag dictionary not found: ${path}`); }
      this.dictionaryFound = true;
      // A read error keeps its own message; only a parse error is about the JSON.
      text = await this.app.vault.cachedRead(file);
    }
    this.dictionaryFound = true;
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch (error) { throw new Error(`Invalid JSON: ${reason(error)}`); }
    return this.buildModel(raw as RawDictionary, performance.now() - start);
  }

  private buildModel(raw = this.raw!, dictionaryMs = this.loadMetrics.dictionaryMs): Ontology {
    const indexStart = performance.now(), notes = this.notes(), model = new Ontology(raw, notes);
    this.loadMetrics = { dictionaryMs, indexMs: performance.now() - indexStart, noteCount: notes.length, taggedNotes: notes.filter(note => note.tags.length > 0).length };
    this.raw = raw; this.model = model;
    return model;
  }

  // Only a fresh install gets an empty dictionary on its own. Later a missing file is never recreated by itself: a sync that
  // hasn't caught up or an iCloud file moved off the disk looks missing too, so the sidebar offers a button instead.
  // Not on settings changes either: the path field saves only on commit.
  private async ensureDictionary(): Promise<void> {
    const { vault } = this.app;
    try {
      const path = await this.resolveDictionary();
      if (!this.firstRun || !isValidDictionaryPath(path, vault.configDir) || await this.dictionaryExists(path) || this.disposed) return;
      await this.writeEmpty(path);
    } catch (error) { console.error('Tag Ontology:', error); }
  }

  async createDictionary(): Promise<boolean> {
    try {
      const path = await this.resolveDictionary();
      await this.writeEmpty(path);
    } catch (error) { new Notice(t('notice.createFailed', { error: String(error) })); return false; }
    await this.reload();
    return true;
  }

  async setDictionaryPath(path: string): Promise<void> {
    this.settings.dictionaryPath = path;
    this.settings.dictionaryPathExplicit = true;
    await this.saveSettings();
  }

  async resetDictionaryPath(): Promise<void> {
    this.settings.dictionaryPath = DEFAULT_SETTINGS.dictionaryPath;
    this.settings.dictionaryPathExplicit = false;
    await this.saveSettings();
  }

  // vault.create refuses an existing path, so this never replaces a dictionary.
  private async writeEmpty(path: string): Promise<void> {
    const { vault } = this.app, parts = path.split('/').slice(0, -1);
    if (isHiddenPath(path)) {
      if (await vault.adapter.exists(path)) throw new Error('File already exists.');
      for (let i = 1; i <= parts.length; i++) {
        const folder = parts.slice(0, i).join('/');
        if (!await vault.adapter.exists(folder)) await vault.adapter.mkdir(folder);
      }
      // The adapter has no exclusive create; a file can still appear between this check and write.
      if (await vault.adapter.exists(path)) throw new Error('File already exists.');
      await vault.adapter.write(path, '{\n}\n');
      return;
    }
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
    }
    if (await this.dictionaryExists(path)) throw new Error('File already exists.');
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

  // The dictionary check's extra findings. Computed when the check panel asks, and kept until the model is rebuilt.
  checkUsage(): Usage | undefined {
    if (!this.model || !this.raw) return undefined;
    if (this.checked?.model !== this.model) {
      try { this.checked = { model: this.model, usage: usage(this.raw, this.notes()) }; }
      catch { return undefined; }
    }
    return this.checked.usage;
  }

  // The core graph's data, built from the vault for the 3D view: notes, their tags, links, and optional attachments/unresolved targets.
  graphData(options?: { attachments?: boolean; existingOnly?: boolean }): NativeData {
    const includeAttachments = Boolean(options?.attachments);
    const includeUnresolved = options?.existingOnly === false;
    const resolved = this.app.metadataCache.resolvedLinks;
    const unresolved = includeUnresolved ? this.app.metadataCache.unresolvedLinks : undefined;
    const attachments = includeAttachments
      ? (this.app.vault.getFiles?.() ?? []).filter(file => file.extension !== 'md' && !isHiddenPath(file.path)).map(file => file.path)
      : undefined;
    return vaultData(
      this.notes().map(note => ({
        ...note,
        links: Object.keys(resolved[note.path] ?? {}),
        unresolved: unresolved ? Object.keys(unresolved[note.path] ?? {}) : undefined,
      })),
      { includeAttachments, attachments, includeUnresolved },
    );
  }

  // One read-check-write: the change goes onto the latest file only if the entries it rewrites are as the editor saw them,
  // and only if the result is still a valid dictionary. Nothing is written otherwise.
  async saveChange(change: Change, base: RawDictionary): Promise<boolean> {
    const path = await this.resolveDictionary();
    const conflictOr = (error: unknown) => error instanceof DictionaryConflictError || (error instanceof Error && error.message === CONFLICT)
      ? t('notice.conflict') : t('notice.saveFailed', { error: String(error) });
    if (!isHiddenPath(path)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) { new Notice(t('notice.dictionaryNotFound', { path })); return false; }
      try {
        await this.app.vault.process(file, (text) => this.changedText(text, change, base));
        return true;
      } catch (error) {
        new Notice(conflictOr(error));
        return false;
      }
    }
    try {
      if (!await this.app.vault.adapter.exists(path)) { new Notice(t('notice.dictionaryNotFound', { path })); return false; }
      const adapter = this.app.vault.adapter;
      const text = await adapter.read(path), out = this.changedText(text, change, base);
      // The adapter has no atomic compare-and-swap; a file changed after this check but before write can still be overwritten.
      await adapter.write(path, out);
      try {
        const stat = await adapter.stat(path);
        this.dictionaryMtime = stat?.mtime; this.dictionarySize = stat?.size;
      } catch { this.dictionaryMtime = undefined; this.dictionarySize = undefined; }
      return true;
    } catch (error) {
      new Notice(conflictOr(error));
      return false;
    }
  }

  private changedText(text: string, change: Change, base: RawDictionary): string {
    const latest = JSON.parse(text) as RawDictionary;
    if (conflicts(base, latest, change).length) throw new DictionaryConflictError();
    const next = apply(latest, change);
    // Checks the dictionary itself (references, cycles); notes don't affect that, and a note still being indexed mustn't block a save.
    new Ontology(next, []);
    // A file kept with CRLF line endings stays that way, so a save still changes only the lines it touches.
    // serialize's only raw newlines are line breaks: JSON.stringify escapes them inside strings.
    const out = serialize(next);
    return text.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out;
  }

  reload(): Promise<void> { return this.refreshViews({ notify: true }); }

  // Hierarchy colors override the picked tag color; tags without a depth fall back to it or the theme accent.
  tagColor(tag?: string): string {
    if (this.settings.customColors && this.settings.hierarchyColors && this.model && tag) {
      const color = hierarchyColor(this.model, tag, this.settings.hierarchyPalette);
      if (color) return color;
    }
    return this.settings.tagColor || (this.accent = this.readAccent());
  }

  private readAccent(): string {
    return cssColorToHex(getComputedStyle(document.body).getPropertyValue('--color-accent')) ?? ACCENT;
  }

  private readThemeAccent(): string {
    const style = getComputedStyle(document.body);
    return (style.getPropertyValue('--interactive-accent') || style.getPropertyValue('--color-accent')).trim();
  }

  // Every redraw takes the tag color from tagColor(), so whatever redrew last, the accent it drew with is the one compared.
  // An inline style update on <body> skips Obsidian's css-change event, so open 2D renderers re-read CSS highlight colors.
  private followAccent(restyle: boolean) {
    const themeAccent = this.readThemeAccent();
    if (themeAccent !== this.themeAccent) { this.themeAccent = themeAccent; if (restyle) this.native.recolor(); }
    if (!this.model || !this.settings.customColors || this.settings.tagColor) return;
    const accent = this.readAccent();
    if (accent === this.accent) return;
    this.accent = accent;
    this.native.refresh(true, 'settings');
  }

  // Persists graph state (expansion, toggles) without reloading the dictionary or redrawing views.
  async saveState(): Promise<void> {
    await this.saveData({ ...this.settings, expanded: [...this.native.savedExpanded] });
  }

  async setPaletteColor(depth: number, color: string): Promise<void> {
    const palette = this.settings.hierarchyPalette;
    if (!Number.isInteger(depth) || depth < 0 || depth >= palette.length || !/^#[0-9a-f]{6}$/i.test(color) || palette[depth] === color) return;
    const next = [...palette]; next[depth] = color;
    Object.assign(this.settings, editPalette(this.settings, next));
    await this.saveSettings();
  }

  async choosePalette(key: string): Promise<void> {
    const change = paletteChoice(this.settings, key);
    if (!change) return;
    Object.assign(this.settings, change);
    await this.saveSettings();
  }

  async resizePalette(delta: 1 | -1): Promise<void> {
    if (delta !== 1 && delta !== -1) return;
    const change = resizedPalette(this.settings, delta);
    if (!change) return;
    Object.assign(this.settings, change);
    await this.saveSettings();
  }

  async savePaletteAs(name: string): Promise<void> {
    const previous = { key: this.settings.hierarchyPalettePreset, working: [...this.settings.customHierarchyPalette], source: this.settings.workingPaletteSource };
    const change = namedPalette(this.settings, name), savedName = change.savedHierarchyPalettes.at(-1)!.name;
    Object.assign(this.settings, change);
    try { await this.saveSettings(); }
    catch (error) {
      this.settings.savedHierarchyPalettes = this.settings.savedHierarchyPalettes.filter(palette => palette.name !== savedName);
      if (this.settings.hierarchyPalettePreset === change.hierarchyPalettePreset) this.settings.hierarchyPalettePreset = previous.key;
      if (!this.settings.customHierarchyPalette.length) {
        this.settings.customHierarchyPalette = previous.working; this.settings.workingPaletteSource = previous.source;
      }
      this.settingsTab?.syncPaletteControls();
      throw error;
    }
  }

  promptSavePalette(): void { new PaletteNameModal(this.app, this).open(); }

  async deletePalette(name: string): Promise<void> {
    const index = this.settings.savedHierarchyPalettes.findIndex(palette => palette.name === name), removed = this.settings.savedHierarchyPalettes[index];
    const change = deletedPalette(this.settings, name);
    if (!change) return;
    Object.assign(this.settings, change);
    try { await this.saveSettings(); }
    catch (error) {
      const replaced = this.settings.savedHierarchyPalettes.some(palette => palette.name.toLowerCase() === name.toLowerCase());
      if (!replaced) {
        this.settings.savedHierarchyPalettes = [...this.settings.savedHierarchyPalettes];
        this.settings.savedHierarchyPalettes.splice(index, 0, removed);
      }
      if (!replaced && change.hierarchyPalettePreset && this.settings.hierarchyPalettePreset === change.hierarchyPalettePreset
        && change.hierarchyPalette && samePalette(this.settings.hierarchyPalette, change.hierarchyPalette)) {
        this.settings.hierarchyPalettePreset = 'saved:' + name;
        this.settings.hierarchyPalette = [...removed.colors];
      }
      this.settingsTab?.syncPaletteControls();
      throw error;
    }
  }

  managePalettes(): void { new PaletteManagerModal(this.app, this).open(); }

  private obsidianLanguage(): string {
    if (requireApiVersion('1.8.7') && typeof getLanguage === 'function') return getLanguage();
    return typeof moment?.locale === 'function' ? moment.locale() : '';
  }

  applyLocale(notify = true): void {
    const prev = getLocale();
    const next = resolveLocale(this.settings.language, this.obsidianLanguage());
    setLocale(next);
    if (notify && prev !== next) this.native.refreshLocale();
  }

  async saveSettings(): Promise<void> {
    this.settings = sanitizeSettings(this.settings, this.app.vault.configDir);
    this.applyLocale();
    await this.saveState();
    await this.refreshViews({ notify: true, linked: 'settings' });
    this.settingsTab?.syncPaletteControls();
  }

  async openView(graph: GraphMode | '2d' = '2d', newTab = false, source?: WorkspaceLeaf): Promise<void> {
    if (this.disposed) return;
    try {
      await this.checkOutsideChange();
      if (this.disposed) return;
      await this.loadModel();
      if (this.disposed) return;
      const active = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
      const existing = newTab ? undefined : source ?? this.app.workspace.getLeavesOfType('graph').find(leaf => leaf === active) ?? this.app.workspace.getLeavesOfType('graph')[0];
      const leaf = existing ?? this.app.workspace.getLeaf('tab');
      if (!existing || leaf.view.getViewType() !== 'graph') await leaf.setViewState({ type: 'graph', active: true });
      if (this.disposed) return;
      // Attaches like attach() and also redraws the sidebar, which may still show a failure this load cleared.
      this.native.refresh(false);
      await this.native.switchMode(leaf, graph);
      if (this.disposed) return;
      // The sidebar tab opens and comes forward with the graph, even when the sidebar is closed or shows another tab.
      this.native.showPanel(true);
      await this.app.workspace.revealLeaf(leaf);
      // Revealing a tab that was already open only brings it to the front, and keys would still go to the active tab.
      if (existing && !this.disposed) this.app.workspace.setActiveLeaf(leaf, { focus: true });
    } catch (error) {
      if (this.disposed) return;
      new Notice(t('notice.openGraphFailed', { error: reason(error) }));
      this.native.renderPanel();
    }
  }

  async checkOutsideChange(): Promise<void> {
    if (this.disposed) return;
    let path: string;
    try { path = await this.resolveDictionary(); } catch { return; }
    if (this.disposed) return;
    if (path !== this.dictionaryMtimePath) { this.scheduleRefresh(path); return; }
    if (!isHiddenPath(path)) return;
    let stat: { mtime?: number; size?: number } | null | undefined;
    try { stat = await this.app.vault.adapter.stat(path); } catch { return; }
    if (!this.disposed && (stat?.mtime !== this.dictionaryMtime || stat?.size !== this.dictionarySize)) this.scheduleRefresh(path);
  }

  // Only a dictionary change redraws graphs; note edits reach them through the core graph's own update.
  private scheduleRefresh(...paths: string[]): void {
    this.redraw ||= paths.some(path => this.isDictionaryFile(path));
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      const redraw = this.redraw; this.redraw = false;
      void this.refreshViews({ redraw });
    }, 300);
  }

  private async refreshViews({ redraw = true, notify = false, linked = 'refresh' } = {}): Promise<void> {
    if (this.disposed) return;
    // With the 3D view off, its tabs close, so the workspace doesn't bring them back (and load three.js) on the next start.
    if (!this.settings.enable3d) for (const leaf of this.app.workspace.getLeavesOfType(VIEW_3D)) leaf.detach();
    if (!this.settings.enableExplorer) for (const leaf of this.app.workspace.getLeavesOfType(VIEW_EXPLORER)) leaf.detach();
    try {
      if (redraw || !this.model || !this.raw || this.error !== undefined) await this.loadModel();
      else this.buildModel();
      if (!this.disposed) {
        if (redraw && !this.settings.tagColor) this.accent = this.readAccent();
        this.native.refresh(redraw, linked);
      }
    }
    catch (error) {
      if (this.disposed) return;
      console.error('Tag Ontology:', error);
      this.native.renderPanel();
      // A 3D view with no dictionary loaded yet says why, as the sidebar does.
      this.native.drawLinked('refresh');
      if (notify) new Notice(t('notice.loadFailed', { error: reason(error) }));
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
  getDisplayText(): string { return t('views.dictionaryTitle'); }
  getIcon(): string { return ICON; }
  onOpen(): Promise<void> { this.owner.native.mount(this.contentEl); return Promise.resolve(); }
}

const pathDescription = (owner: TagOntologyPlugin) => t('settings.dictionary.path.desc', {
  path: owner.settings.dictionaryPathExplicit ? owner.dictionaryPath : t('settings.dictionary.path.autoSuffix', { path: owner.dictionaryPath }),
});
const TOW_MARKERS = ['tow.json', '.tow/config.json', 'tow/config.json'];

class PaletteNameModal extends Modal {
  constructor(app: App, private owner: TagOntologyPlugin) { super(app); }
  onOpen(): void {
    this.titleEl.setText(t('palettes.saveTitle'));
    let input: TextComponent;
    const error = this.contentEl.createDiv({ cls: 'tag-ontology-palette-error' });
    error.setAttribute('role', 'alert');
    let saving = false;
    const save = async () => {
      if (saving) return;
      saving = true;
      try { await this.owner.savePaletteAs(input.getValue()); this.close(); }
      catch (failure) {
        error.setText(failure instanceof PaletteValidationError
          ? t(failure.code === 'invalid-name' ? 'palettes.errInvalidName' : 'palettes.errDuplicateName')
          : reason(failure));
      }
      finally { saving = false; }
    };
    new Setting(this.contentEl).setName(t('palettes.nameLabel')).addText(text => {
      input = text; text.setPlaceholder(t('palettes.namePlaceholder')); text.inputEl.maxLength = 80;
      text.inputEl.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void save(); } });
    });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t('palettes.saveButton')).onClick(() => { void save(); }));
  }
}

class PaletteManagerModal extends Modal {
  constructor(app: App, private owner: TagOntologyPlugin) { super(app); }
  onOpen() { this.render(); }
  private render() {
    this.titleEl.setText(t('palettes.myPalettes')); this.contentEl.empty();
    if (!this.owner.settings.savedHierarchyPalettes.length) new Setting(this.contentEl).setName(t('palettes.empty'));
    for (const palette of this.owner.settings.savedHierarchyPalettes) {
      new Setting(this.contentEl).setName(palette.name).setDesc(tPlural('palettes.levelsCount', palette.colors.length))
        .addExtraButton(button => button.setIcon('trash-2').setTooltip(t('palettes.deleteTooltip', { name: palette.name })).onClick(() => this.confirm(palette.name)));
    }
  }
  private confirm(name: string) {
    this.contentEl.empty(); this.titleEl.setText(t('palettes.deleteTitle', { name }));
    const active = paletteSelection(this.owner.settings) === 'saved:' + name;
    new Setting(this.contentEl).setDesc(t(active ? 'palettes.deleteDescActive' : 'palettes.deleteDescInactive'));
    let deleting = false;
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(t('common.cancel')).onClick(() => this.render()))
      .addButton(button => button.setButtonText(t('palettes.deleteButton')).onClick(() => {
        if (deleting) return;
        deleting = true; button.buttonEl.disabled = true;
        void this.owner.deletePalette(name).then(() => this.render()).catch(error => {
          new Notice(t('notice.deletePaletteFailed', { error: reason(error) }));
          deleting = false; button.buttonEl.disabled = false;
        });
      }));
  }
}

class OntologySettingsTab extends PluginSettingTab {
  private paletteSetting?: Setting;
  private paletteDropdown?: DropdownComponent;
  private palettePickers: ColorComponent[] = [];
  private paletteSaveSetting?: Setting;
  private commitPath?: () => Promise<void>;
  constructor(app: App, private owner: TagOntologyPlugin) { super(app, owner); }

  private languageOptions(): Record<string, string> {
    const options: Record<string, string> = { auto: t('settings.general.language.auto') };
    for (const locale of SUPPORTED_LOCALES) options[locale] = LOCALE_LABELS[locale];
    return options;
  }

  // Obsidian 1.13+ renders these declaratively and indexes them for settings search.
  getSettingDefinitions(): SettingDefinitionItem[] {
    const custom = () => this.owner.settings.customColors;
    const palette = () => custom() && this.owner.settings.hierarchyColors;
    return [
      { type: 'group', heading: t('settings.general.heading'), items: [
        { name: t('settings.general.language.name'), desc: t('settings.general.language.desc'),
          control: { type: 'dropdown', key: 'language', defaultValue: DEFAULT_SETTINGS.language, options: this.languageOptions() } },
      ] },
      { type: 'group', heading: t('settings.dictionary.heading'), items: [
        { name: t('settings.dictionary.path.name'), desc: pathDescription(this.owner), render: setting => { this.dictionaryPathSetting(setting); } },
        { name: t('settings.dictionary.kebab.name'), desc: t('settings.dictionary.kebab.desc'), control: { type: 'toggle', key: 'kebabNames', defaultValue: DEFAULT_SETTINGS.kebabNames } },
      ] },
      { type: 'group', heading: t('settings.colors.heading'), items: [
        { name: t('settings.colors.mode.name'), desc: t('settings.colors.mode.desc'), render: setting => { this.colorMode(setting); } },
        { name: t('settings.colors.palette.name'), visible: palette, render: setting => { this.palettePreset(setting); } },
        { name: t('settings.colors.levelColors.name'), visible: palette, render: setting => { this.paletteColors(setting); } },
        { name: t('settings.colors.myPalettes.name'), visible: palette, render: setting => { this.paletteSave(setting); } },
        // A plain color control has no way back to following the accent, so this row is drawn by hand.
        { name: this.tagColorName(), desc: t('settings.colors.tagColor.desc'), visible: custom, render: setting => { this.tagColor(setting); } },
        { name: t('settings.colors.titleAccent.name'), desc: t('settings.colors.titleAccent.desc'), visible: custom, control: { type: 'toggle', key: 'titleAccent', defaultValue: DEFAULT_SETTINGS.titleAccent } },
      ] },
      { type: 'group', heading: t('settings.sidebar.heading'), items: [
        { name: t('settings.sidebar.tagList.name'), desc: t('settings.sidebar.tagList.desc'), control: { type: 'dropdown', key: 'tagListStyle', defaultValue: DEFAULT_SETTINGS.tagListStyle, options: { chips: t('settings.sidebar.tagList.chips'), list: t('settings.sidebar.tagList.list') } } },
      ] },
      { type: 'group', heading: t('settings.focus.heading'), items: [
        { name: t('settings.focus.main.name'), desc: t('settings.focus.main.desc'), control: { type: 'toggle', key: 'focus', defaultValue: DEFAULT_SETTINGS.focus } },
        { name: t('settings.focus.descendants.name'), desc: t('settings.focus.descendants.desc'), visible: () => this.owner.settings.focus,
          control: { type: 'toggle', key: 'focusDescendants', defaultValue: DEFAULT_SETTINGS.focusDescendants } },
        { name: t('settings.focus.notes.name'), desc: t('settings.focus.notes.desc'), visible: () => this.owner.settings.focus,
          control: { type: 'toggle', key: 'focusNotes', defaultValue: DEFAULT_SETTINGS.focusNotes } },
      ] },
      { type: 'group', heading: t('settings.views.heading'), items: [
        { name: t('settings.views.tree.name'), desc: t('settings.views.tree.desc'), control: { type: 'toggle', key: 'enableTree', defaultValue: DEFAULT_SETTINGS.enableTree } },
        { name: t('settings.views.treeHorizontal.name'), desc: t('settings.views.treeHorizontal.desc'), control: { type: 'toggle', key: 'enableTreeHorizontal', defaultValue: DEFAULT_SETTINGS.enableTreeHorizontal } },
        { name: t('settings.views.graph3d.name'), desc: t('settings.views.graph3d.desc'), control: { type: 'toggle', key: 'enable3d', defaultValue: DEFAULT_SETTINGS.enable3d } },
        { name: t('settings.views.explorer.name'), desc: t('settings.views.explorer.desc'), control: { type: 'toggle', key: 'enableExplorer', defaultValue: DEFAULT_SETTINGS.enableExplorer } },
      ] },
    ];
  }

  private dictionaryPathSetting(setting: Setting): Setting {
    let input!: TextComponent;
    const towVault = TOW_MARKERS.some(path => this.app.vault.getAbstractFileByPath(path));
    const fill = () => {
      input.setValue(this.owner.settings.dictionaryPathExplicit ? this.owner.settings.dictionaryPath : '');
      input.setPlaceholder(this.owner.settings.dictionaryPathExplicit ? TOW_FOLDER_DICTIONARY : this.owner.dictionaryPath);
    };
    const describe = () => setting.setDesc(`${pathDescription(this.owner)}${towVault && this.owner.dictionaryPath !== TOW_FOLDER_DICTIONARY ? ` ${t('notice.towManaged')}` : ''}`);
    setting.setName(t('settings.dictionary.path.name')).setDesc(pathDescription(this.owner))
      .addText(text => { input = text; })
      .addExtraButton(button => button.setIcon('rotate-ccw').setTooltip(t('settings.dictionary.path.resetTooltip')).onClick(async () => {
        await this.owner.resetDictionaryPath(); fill(); describe();
      }));
    fill(); describe();
    const commit = async () => {
      const path = input.getValue().trim();
      if (path === (this.owner.settings.dictionaryPathExplicit ? this.owner.settings.dictionaryPath : '')) return;
      if (!path) await this.owner.resetDictionaryPath();
      else if (!isValidDictionaryPath(path, this.app.vault.configDir)) { setting.setDesc(t('settings.dictionary.path.hint')); return; }
      else await this.owner.setDictionaryPath(path);
      // A slow reload must not overwrite text typed after this commit started.
      if (input.getValue().trim() === path) fill();
      describe();
    };
    // Save on commit, not per keystroke, since a half-typed path ending in .json would be saved and reloaded with a "not found" notice each time.
    input.inputEl.addEventListener('change', () => { void commit(); });
    this.commitPath = commit;
    if (!towVault) {
      const path = this.owner.dictionaryPath;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && !path.startsWith('tow/') && !isHiddenPath(path)
        && !this.app.vault.getAbstractFileByPath(TOW_FOLDER_DICTIONARY)) {
        setting.addButton(button => button.setButtonText(t('settings.dictionary.moveToTow')).onClick(async () => {
          try {
            // The vault index has no hidden files, so .tow/config.json is only visible on disk.
            for (const marker of TOW_MARKERS) if (await this.app.vault.adapter.exists(marker)) { new Notice(t('notice.towManaged')); return; }
            if (this.app.vault.getAbstractFileByPath(TOW_FOLDER_DICTIONARY)) { new Notice(t('notice.moveExists', { path: TOW_FOLDER_DICTIONARY })); return; }
            if (!this.app.vault.getAbstractFileByPath('tow')) await this.app.vault.createFolder('tow');
            if (this.app.vault.getAbstractFileByPath(TOW_FOLDER_DICTIONARY)) { new Notice(t('notice.moveExists', { path: TOW_FOLDER_DICTIONARY })); return; }
            await this.app.fileManager.renameFile(file, TOW_FOLDER_DICTIONARY);
            if (this.owner.settings.dictionaryPathExplicit) await this.owner.setDictionaryPath(TOW_FOLDER_DICTIONARY);
            await this.owner.reload();
            fill(); describe();
            // The dictionary is in tow/ now, so there is nothing left to move.
            button.buttonEl.remove();
          } catch (error) { new Notice(t('notice.moveFailed', { error: reason(error) })); }
        }));
      }
    }
    return setting;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === 'colorMode') {
      if (value !== 'default' && value !== 'single' && value !== 'depth') return;
      Object.assign(this.owner.settings, { customColors: value !== 'default', hierarchyColors: value === 'depth' });
      await this.owner.saveSettings();
      if (requireApiVersion('1.13.0')) this.update(); else this.renderLegacy();
      return;
    }
    if (key === 'dictionaryPath') {
      if (typeof value === 'string' && isValidDictionaryPath(value, this.app.vault.configDir)) await this.owner.setDictionaryPath(value);
      return;
    }
    this.owner.settings = sanitizeSettings({ ...this.owner.settings, [key]: value }, this.app.vault.configDir);
    await this.owner.saveSettings();
    if (key === 'language') {
      if (requireApiVersion('1.13.0')) this.update(); else this.renderLegacy();
      return;
    }
    if (requireApiVersion('1.13.0') && key === 'hierarchyColors') this.update();
  }

  private tagColorName(): string {
    return this.owner.settings.hierarchyColors ? t('settings.colors.tagColor.outsideName') : t('settings.colors.tagColor.name');
  }

  // The picker shows the color in use, the accent until one is picked; the reset button goes back to following the accent.
  // Showing the accent again calls onChange too, and that must not pin the accent as a picked color.
  private tagColor(setting: Setting): Setting {
    let shown: ColorComponent | undefined;
    return setting.setName(this.tagColorName()).setDesc(t('settings.colors.tagColor.desc'))
      .addColorPicker((picker) => {
        shown = picker;
        picker.setValue(this.owner.tagColor()).onChange(async (value) => {
          if (!this.owner.settings.tagColor && value === this.owner.tagColor()) return;
          await this.setControlValue('tagColor', value);
        });
      })
      .addExtraButton(button => button.setIcon('rotate-ccw').setTooltip(t('settings.colors.tagColor.resetTooltip')).onClick(async () => {
        await this.setControlValue('tagColor', '');
        shown?.setValue(this.owner.tagColor());
      }));
  }

  private depthName(index: number): string {
    return index === 0 ? t('settings.colors.depthRoot') : t('settings.colors.depthLevel', { index });
  }

  private colorMode(setting: Setting): Setting {
    const value = !this.owner.settings.customColors ? 'default' : this.owner.settings.hierarchyColors ? 'depth' : 'single';
    return setting.setName(t('settings.colors.mode.name')).setDesc(t('settings.colors.mode.desc')).addDropdown(dropdown => {
      dropdown.addOption('default', t('settings.colors.mode.default'))
        .addOption('single', t('settings.colors.mode.single'))
        .addOption('depth', t('settings.colors.mode.depth'))
        .setValue(value).onChange(mode => this.setControlValue('colorMode', mode));
    });
  }

  private palettePreset(setting: Setting): Setting {
    return setting.setName(t('settings.colors.palette.name')).setDesc(t('settings.colors.palette.desc'))
      .addDropdown(dropdown => {
        this.paletteDropdown = dropdown;
        fillPaletteSelect(dropdown.selectEl, this.owner.settings);
        dropdown.setValue(paletteSelection(this.owner.settings)).onChange(key => this.owner.choosePalette(key));
      })
      .addExtraButton(button => button.setIcon('plus').setTooltip(t('settings.colors.palette.addTooltip')).onClick(() => { void this.owner.resizePalette(1); }))
      .addExtraButton(button => button.setIcon('minus').setTooltip(t('settings.colors.palette.removeTooltip')).onClick(() => { void this.owner.resizePalette(-1); }));
  }

  private paletteSave(setting: Setting): Setting {
    this.paletteSaveSetting = setting;
    return setting.setName(t('settings.colors.myPalettes.name')).setDesc(this.paletteStatus())
      .addButton(button => button.setButtonText(t('settings.colors.myPalettes.saveAs')).onClick(() => this.owner.promptSavePalette()))
      .addButton(button => button.setButtonText(t('settings.colors.myPalettes.manage')).onClick(() => this.owner.managePalettes()));
  }

  private paletteStatus(): string {
    return paletteSelection(this.owner.settings) === 'custom'
      ? t('settings.colors.myPalettes.descWorking')
      : t('settings.colors.myPalettes.descSaved');
  }

  syncPaletteControls(): void {
    if (this.paletteDropdown) {
      fillPaletteSelect(this.paletteDropdown.selectEl, this.owner.settings);
      this.paletteDropdown.setValue(paletteSelection(this.owner.settings));
    }
    const colors = this.owner.settings.hierarchyPalette;
    if (this.paletteSetting && this.palettePickers.length !== colors.length) this.paletteColors(this.paletteSetting);
    else colors.forEach((color, i) => { this.palettePickers[i]?.setValue(color); });
    this.paletteSaveSetting?.setDesc(this.paletteStatus());
  }

  private paletteColors(setting: Setting): Setting {
    this.paletteSetting = setting;
    const palette = this.owner.settings.hierarchyPalette;
    const desc = palette.length === 1
      ? t('settings.colors.levelColors.descSingle')
      : tPlural('settings.colors.levelColors.desc', palette.length, { last: palette.length - 1 });
    setting.setName(t('settings.colors.levelColors.name')).setDesc(desc);
    setting.settingEl.addClass('tag-ontology-palette-setting');
    setting.controlEl.empty();
    this.palettePickers = [];
    const row = setting.controlEl.createDiv('tag-ontology-palette-colors');
    palette.forEach((color, index) => {
      const slot = row.createDiv('tag-ontology-palette-slot');
      slot.setAttribute('aria-label', this.depthName(index));
      new Setting(slot).setName(String(index)).addColorPicker(picker => {
        this.palettePickers.push(picker);
        picker.setValue(color).onChange(async value => {
          await this.owner.setPaletteColor(index, value);
        });
      });
    });
    return setting;
  }

  // Closing settings commits a path still being typed, as leaving the field would.
  hide(): void { void this.commitPath?.(); super.hide(); }

  // Fallback for Obsidian older than 1.13, which never calls getSettingDefinitions().
  display(): void { this.renderLegacy(); }

  private renderLegacy(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName(t('settings.general.heading')).setHeading();
    new Setting(containerEl).setName(t('settings.general.language.name')).setDesc(t('settings.general.language.desc')).addDropdown((dropdown) => {
      for (const [key, label] of Object.entries(this.languageOptions())) dropdown.addOption(key, label);
      dropdown.setValue(this.owner.settings.language).onChange(value => this.setControlValue('language', value));
    });
    new Setting(containerEl).setName(t('settings.dictionary.heading')).setHeading();
    this.dictionaryPathSetting(new Setting(containerEl));
    new Setting(containerEl).setName(t('settings.dictionary.kebab.name')).setDesc(t('settings.dictionary.kebab.desc')).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.kebabNames).onChange(value => this.setControlValue('kebabNames', value));
    });
    new Setting(containerEl).setName(t('settings.colors.heading')).setHeading();
    this.colorMode(new Setting(containerEl));
    const custom: Setting[] = [], palette: Setting[] = [];
    palette.push(this.palettePreset(new Setting(containerEl)));
    palette.push(this.paletteColors(new Setting(containerEl)));
    palette.push(this.paletteSave(new Setting(containerEl)));
    for (const row of palette) row.settingEl.toggle(this.owner.settings.customColors && this.owner.settings.hierarchyColors);
    custom.push(this.tagColor(new Setting(containerEl)));
    custom.push(new Setting(containerEl).setName(t('settings.colors.titleAccent.name')).setDesc(t('settings.colors.titleAccent.desc')).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.titleAccent).onChange(value => this.setControlValue('titleAccent', value));
    }));
    for (const setting of custom) setting.settingEl.toggle(this.owner.settings.customColors);
    new Setting(containerEl).setName(t('settings.sidebar.heading')).setHeading();
    new Setting(containerEl).setName(t('settings.sidebar.tagList.name')).setDesc(t('settings.sidebar.tagList.desc')).addDropdown((dropdown) => {
      dropdown.addOption('chips', t('settings.sidebar.tagList.chips')).addOption('list', t('settings.sidebar.tagList.list')).setValue(this.owner.settings.tagListStyle).onChange(value => this.setControlValue('tagListStyle', value));
    });
    new Setting(containerEl).setName(t('settings.focus.heading')).setHeading();
    const scope: Setting[] = [];
    new Setting(containerEl).setName(t('settings.focus.main.name')).setDesc(t('settings.focus.main.desc')).addToggle((toggle) => {
      toggle.setValue(this.owner.settings.focus).onChange((value) => {
        for (const setting of scope) setting.settingEl.toggle(value);
        return this.setControlValue('focus', value);
      });
    });
    for (const [key, nameKey, descKey] of [
      ['focusDescendants', 'settings.focus.descendants.name', 'settings.focus.descendants.desc'],
      ['focusNotes', 'settings.focus.notes.name', 'settings.focus.notes.desc'],
    ] as const) {
      scope.push(new Setting(containerEl).setName(t(nameKey)).setDesc(t(descKey)).addToggle((toggle) => {
        toggle.setValue(this.owner.settings[key]).onChange(value => this.setControlValue(key, value));
      }));
    }
    for (const setting of scope) setting.settingEl.toggle(this.owner.settings.focus);
    new Setting(containerEl).setName(t('settings.views.heading')).setHeading();
    for (const [key, nameKey, descKey] of [
      ['enableTree', 'settings.views.tree.name', 'settings.views.tree.desc'],
      ['enableTreeHorizontal', 'settings.views.treeHorizontal.name', 'settings.views.treeHorizontal.desc'],
      ['enable3d', 'settings.views.graph3d.name', 'settings.views.graph3d.desc'],
      ['enableExplorer', 'settings.views.explorer.name', 'settings.views.explorer.desc'],
    ] as const) {
      new Setting(containerEl).setName(t(nameKey)).setDesc(t(descKey)).addToggle(toggle => toggle.setValue(this.owner.settings[key]).onChange(value => this.setControlValue(key, value)));
    }
  }
}
