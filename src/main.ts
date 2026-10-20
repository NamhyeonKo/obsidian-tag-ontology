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
  private refreshTimer?: ReturnType<typeof setTimeout>;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new OntologyView(leaf, this));
    this.addRibbonIcon('graph', '태그 온톨로지 열기', () => { void this.openView(); });
    this.addCommand({ id: 'open-tag-ontology', name: '태그 온톨로지 열기', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'open-tag-ontology-detail', name: '태그 온톨로지 상세 뷰어 (호환 모드)', callback: () => { void this.openDetailView(); } });
    this.addCommand({ id: 'refresh-tag-ontology', name: '태그 온톨로지 새로고침', callback: () => {
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
    if (!isValidDictionaryPath(this.settings.dictionaryPath)) throw new Error('사전 경로가 허용되지 않습니다.');
    const start = performance.now();
    const file = this.app.vault.getAbstractFileByPath(this.settings.dictionaryPath);
    if (!(file instanceof TFile)) throw new Error(`태그 사전 파일을 찾을 수 없습니다: ${this.settings.dictionaryPath}`);
    let raw: unknown;
    try { raw = JSON.parse(await this.app.vault.cachedRead(file)); }
    catch (error) { throw new Error(`태그 사전을 읽을 수 없습니다: ${String(error)}`); }
    const dictionaryMs = performance.now() - start;
    const indexStart = performance.now();
    const files = this.app.vault.getMarkdownFiles().filter((note) => isIncludedNote(note.path));
    const notes: Note[] = files.map((note) => {
      const cache = this.app.metadataCache.getFileCache(note);
      if (!cache) throw new Error(`메타데이터 캐시가 아직 준비되지 않았습니다: ${note.path}`);
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
    } catch (error) { new Notice(`그래프를 열지 못했습니다: ${String(error)}`); }
  }

  async openDetailView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refreshViews(); }, 300);
  }

  private async refreshViews(): Promise<void> {
    try { await this.loadModel(); this.native.refresh(); }
    catch (error) { console.error('Tag Ontology:', error); }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof OntologyView) await leaf.view.refresh();
    }
  }

  onunload(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.native.destroy();
  }
}

class OntologySettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: TagOntologyPlugin) { super(app, owner); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('태그 사전 경로').setDesc('Vault 내부 JSON 파일 경로').addText((text) => {
      text.setValue(this.owner.settings.dictionaryPath).onChange(async (path) => {
        if (!isValidDictionaryPath(path)) { new Notice('설정 폴더를 제외한 Vault 내부 JSON 경로를 입력하세요.'); return; }
        this.owner.settings.dictionaryPath = path;
        await this.owner.saveSettings();
      });
    });
    new Setting(containerEl).setName('그래프 배치').addDropdown((dropdown) => {
      dropdown.addOptions({ force: '힘 기반', tree: '트리', radial: '방사형' })
        .setValue(this.owner.settings.layout).onChange(async (layout) => {
          this.owner.settings = sanitizeSettings({ ...this.owner.settings, layout });
          await this.owner.saveSettings();
        });
    });
  }
}
