import { ItemView, Notice, TFile, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { Core, Layouts, EventObject, NodeSingular } from 'cytoscape';
import type TagOntologyPlugin from './main.ts';
import { createGraph } from './renderer.ts';
import { forceLayoutOptions } from './layout.ts';
import type { GraphHandle } from './renderer.ts';
import type { Ontology } from './ontology.ts';

export const VIEW_TYPE = 'tag-ontology';
const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export class OntologyView extends ItemView {
  private handle?: GraphHandle;
  private model?: Ontology;
  private canvas!: HTMLElement;
  private panel!: HTMLElement;
  private status!: HTMLElement;
  private search!: HTMLInputElement;
  private options!: HTMLElement;
  private inventory!: HTMLButtonElement;
  private layout?: Layouts;
  private expanded = new Set<string>();
  private selected?: string;
  private showRelated = true;
  private closed = false;
  private generation = 0;
  private resize?: ResizeObserver;
  metrics: { operation: string; ms: number; nodes: number; edges: number; settledMs?: number }[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: TagOntologyPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '태그 온톨로지'; }
  getIcon() { return 'git-fork'; }

  async onOpen() {
    this.closed = false;
    const root = this.contentEl;
    root.empty();
    root.addClass('tag-ontology-view');
    this.canvas = root.createDiv('tag-ontology-canvas');
    this.canvas.setAttribute('aria-label', '태그 온톨로지 그래프. 검색 또는 태그 클릭으로 탐색합니다.');
    const tools = root.createDiv('tag-ontology-tools');
    this.search = tools.createEl('input', { type: 'search', placeholder: '태그·별칭 찾기' });
    this.search.setAttribute('aria-label', '태그·별칭 찾기');
    this.search.setAttribute('list', 'tag-ontology-search');
    this.search.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !this.model) return;
      const q = this.search.value.trim().toLowerCase();
      if (!q) return;
      const entries = [...this.model.entries];
      const match = entries.find(([tag, entry]) => tag === q || entry.aliases.some(a => a.toLowerCase() === q))
        ?? entries.find(([tag, entry]) => tag.includes(q) || entry.aliases.some(a => a.toLowerCase().includes(q)));
      if (match) void this.selectTag(match[0]);
      else if (this.model.unregistered.has(this.search.value.trim())) this.inspectUnregistered(this.search.value.trim());
      else new Notice('일치하는 태그가 없습니다.');
    });
    this.inventory = tools.createEl('button', { text: '사전 대조' });
    this.inventory.addEventListener('click', () => this.inspectInventory());
    const actions = root.createDiv('tag-ontology-actions');
    this.iconButton(actions, 'scan', '그래프 맞춤', () => this.fit());
    this.iconButton(actions, 'fold-vertical', '루트만 보기', () => { void this.collapseAll(); });
    this.iconButton(actions, 'settings', '그래프 설정', () => {
      this.options.hidden = !this.options.hidden;
    });
    this.options = root.createDiv('tag-ontology-options');
    this.options.hidden = true;
    const layoutLabel = this.options.createEl('label', { text: '레이아웃' });
    const select = layoutLabel.createEl('select');
    select.setAttribute('aria-label', '레이아웃');
    for (const [value, text] of [['force', 'Force'], ['tree', 'Tree'], ['radial', 'Radial']]) {
      select.createEl('option', { value, text });
    }
    select.value = this.plugin.settings.layout;
    select.addEventListener('change', () => {
      this.plugin.settings.layout = select.value as 'force' | 'tree' | 'radial';
      void this.plugin.saveSettings();
    });
    const relatedLabel = this.options.createEl('label', { text: '연관 관계' });
    const related = relatedLabel.createEl('input', { type: 'checkbox' });
    related.checked = true;
    related.addEventListener('change', () => { this.showRelated = related.checked; void this.render('related'); });
    this.options.createEl('button', { text: '모두 펼치기' }).addEventListener('click', () => { void this.expandAll(); });
    this.options.createEl('button', { text: '새로고침' }).addEventListener('click', () => { void this.refresh(); });
    this.options.createEl('p', { text: '실선 화살표: 상위 → 하위\n점선: 연관\n태그를 두 번 클릭하면 펼침/접힘' });
    this.panel = root.createDiv('tag-ontology-panel');
    this.panel.hidden = true;
    this.status = root.createDiv('tag-ontology-status');
    this.status.setAttribute('role', 'status');
    this.status.textContent = '사전을 불러오는 중…';
    // Attach the tab before waiting for the canvas's first painted frame.
    void this.refresh();
  }

  async refresh() {
    const generation = ++this.generation;
    const started = performance.now();
    try {
      const model = await this.plugin.loadModel();
      if (this.closed || generation !== this.generation) return;
      if (!this.handle) {
        const handle = createGraph(this.canvas);
        if (this.closed || generation !== this.generation) { handle.destroy(); return; }
        this.handle = handle;
        this.style();
        handle.cy.on('tap', 'node', (e: EventObject) => {
          const node = e.target as NodeSingular;
          if (node.data('kind') === 'note') void this.openNote(node.data('path'), !!e.originalEvent?.metaKey || !!e.originalEvent?.ctrlKey);
          else void this.selectTag(node.data('tag'));
        });
        handle.cy.on('dbltap', 'node[kind = "tag"]', (e: EventObject) => { void this.toggleTag(e.target.data('tag')); });
        handle.cy.on('mouseover', 'node', (e: EventObject) => {
          const n = e.target as NodeSingular;
          handle.cy.elements().not(n.closedNeighborhood()).addClass('muted');
          n.addClass('hovered');
        });
        handle.cy.on('mouseout', 'node', () => { handle.cy.elements().removeClass('muted hovered'); });
        handle.cy.on('tap', (e: EventObject) => {
          if (e.target === handle.cy) { this.panel.hidden = true; handle.cy.nodes().unselect(); }
        });
        this.resize = new ResizeObserver(() => handle.cy.resize());
        this.resize.observe(this.canvas);
        this.registerEvent(this.app.workspace.on('css-change', () => this.style()));
      }
      this.model = model;
      this.expanded = new Set([...this.expanded].filter(tag => model.entries.has(tag)));
      this.contentEl.querySelector('datalist')?.remove();
      const choices = this.contentEl.createEl('datalist', { attr: { id: 'tag-ontology-search' } });
      for (const tag of [...model.entries.keys(), ...model.unregistered.keys()]) choices.createEl('option', { value: tag });
      this.inventory.textContent = `사전 대조 · 미등록 ${model.unregistered.size}`;
      await this.render(this.metrics.length ? 'refresh' : 'initial');
      if (this.selected && model.entries.has(this.selected)) this.inspect(this.selected);
      if (this.metrics.length === 1) this.metrics[0]!.ms = performance.now() - started;
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.status.textContent = `그래프를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`;
      new Notice(this.status.textContent, 10000);
    }
  }

  private style() {
    if (!this.handle) return;
    const probe = this.contentEl.createDiv();
    const color = (name: string) => {
      probe.className = `graph-view ${name}`;
      return getComputedStyle(probe).color;
    };
    const fill = color('color-fill'), tag = color('color-fill-tag'), text = color('color-text');
    const line = color('color-line'), active = color('color-fill-highlight');
    probe.remove();
    this.handle.cy.style([
      { selector: 'node', style: {
        width: 'data(radius)', height: 'data(radius)', label: 'data(name)',
        'background-color': fill, color: text, 'font-family': 'var(--font-interface)',
        'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': 4,
        'min-zoomed-font-size': 7, 'overlay-opacity': 0, 'border-width': 0,
      } },
      { selector: 'node[kind = "tag"]', style: { 'background-color': tag } },
      { selector: 'edge', style: { width: 0.65, 'line-color': line, 'curve-style': 'straight', opacity: 0.65 } },
      { selector: 'edge[kind = "broader"]', style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': line, 'arrow-scale': 0.55 } },
      { selector: 'edge[kind = "related"]', style: { 'line-style': 'dashed', width: 0.8 } },
      { selector: ':selected, .hovered', style: { 'background-color': active, color: active } },
      { selector: '.muted', style: { opacity: 0.12 } },
    ]);
  }

  private async render(operation: string) {
    const cy = this.handle?.cy, model = this.model;
    if (!cy || !model || this.closed) return;
    this.layout?.stop();
    const started = performance.now();
    const graph = model.visible(this.expanded, this.showRelated);
    const wanted = new Set([...graph.nodes, ...graph.edges].map(e => e.id));
    const center = { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 };
    cy.batch(() => {
      cy.elements().filter(el => !wanted.has(el.id())).remove();
      graph.nodes.forEach((node, i) => {
        const radius = node.kind === 'note' ? 5 : 7 + Math.min(9, Math.log2(1 + node.size) * 1.2);
        const data = { ...node, name: node.label, radius };
        const existing = cy.getElementById(node.id);
        if (existing.length) existing.data(data);
        else cy.add({ group: 'nodes', data, position: {
          x: center.x + Math.cos(i * 2.39996) * (40 + Math.sqrt(i) * 25),
          y: center.y + Math.sin(i * 2.39996) * (40 + Math.sqrt(i) * 25),
        } });
      });
      for (const edge of graph.edges) if (!cy.getElementById(edge.id).length) cy.add({ group: 'edges', data: edge });
    });
    const kind = this.plugin.settings.layout;
    if (kind === 'force') {
      this.layout = cy.layout(forceLayoutOptions());
    } else {
      const hierarchy = cy.nodes('[kind = "tag"]').union(cy.edges('[kind = "broader"]'));
      this.layout = hierarchy.layout({ name: 'breadthfirst', directed: true, circle: kind === 'radial',
        roots: model.roots.map(tag => 'tag:' + tag),
        spacingFactor: 1.6, padding: 45, fit: false, animate: false, avoidOverlap: true });
    }
    const metric = { operation, ms: 0, nodes: graph.nodes.length, edges: graph.edges.length, settledMs: undefined as number | undefined };
    this.metrics.push(metric);
    this.metrics = this.metrics.slice(-50);
    this.layout.one('layoutstop', () => {
      if (this.closed || cy.destroyed()) return;
      if (kind !== 'force') {
        cy.nodes('[kind = "note"]').forEach((node, i) => {
          const parent = node.neighborhood().nodes()[0];
          const p = parent ? parent.position() : center;
          node.position({ x: p.x + Math.cos(i * 2.39996) * 65, y: p.y + Math.sin(i * 2.39996) * 65 });
        });
      }
      metric.settledMs = performance.now() - started;
      this.fit();
    });
    this.layout.run();
    this.status.textContent = `${graph.nodes.filter(n => n.kind === 'tag').length} / ${model.entries.size} 태그 · ${graph.nodes.filter(n => n.kind === 'note').length} 노트 · 루트 ${model.roots.length}`;
    await painted();
    metric.ms = performance.now() - started;
  }

  async selectTag(tag: string) {
    if (!this.model?.entries.has(tag)) return;
    const stack = [tag], seen = new Set<string>();
    while (stack.length) {
      const item = stack.pop()!;
      if (seen.has(item)) continue;
      seen.add(item);
      for (const parent of this.model.entries.get(item)?.broader ?? []) { this.expanded.add(parent); stack.push(parent); }
    }
    if (!this.handle?.cy.getElementById('tag:' + tag).length) await this.render('reveal');
    this.selected = tag;
    this.handle?.cy.nodes().unselect();
    this.handle?.cy.getElementById('tag:' + tag).select();
    this.inspect(tag);
  }

  async toggleTag(tag: string) {
    if (!this.model?.entries.has(tag)) return;
    this.expanded.has(tag) ? this.expanded.delete(tag) : this.expanded.add(tag);
    await this.render('expand:' + tag);
    if (this.selected) this.inspect(this.selected);
  }
  async expandAll() {
    this.expanded = new Set(this.model?.entries.keys());
    await this.render('expand-all');
  }
  async collapseAll() {
    this.expanded.clear(); this.panel.hidden = true; this.selected = undefined;
    await this.render('collapse-all');
  }

  private inspect(tag: string) {
    const model = this.model!, entry = model.entries.get(tag)!;
    this.panel.empty();
    this.panel.hidden = false;
    const heading = this.panel.createDiv('tag-ontology-panel-heading');
    heading.createEl('strong', { text: tag });
    this.iconButton(heading, 'x', '태그 정보 닫기', () => { this.panel.hidden = true; });
    this.panel.createEl('p', { text: entry.description });
    if (entry.aliases.length) this.panel.createEl('p', { text: entry.aliases.join(' · '), cls: 'tag-ontology-muted' });
    this.panel.createEl('button', { text: this.expanded.has(tag) ? '하위 태그·직접 노트 접기' : '하위 태그·직접 노트 펼치기' })
      .addEventListener('click', () => { void this.toggleTag(tag); });
    const relations = this.panel.createDiv('tag-ontology-relations');
    for (const [label, tags] of [['상위', entry.broader ?? []], ['하위', model.children.get(tag) ?? []], ['연관', entry.related ?? []]] as const) {
      if (!tags.length) continue;
      const group = relations.createEl('details');
      group.createEl('summary', { text: `${label} ${tags.length}` });
      for (const other of tags) group.createEl('button', { text: other }).addEventListener('click', () => { void this.selectTag(other); });
    }
    const counts = model.counts(tag);
    this.panel.createEl('h4', { text: `직접 ${counts.direct}개 / 하위 포함 ${counts.rollup}개` });
    for (const [rollup, title] of [[false, `직접 달린 노트 (${counts.direct})`], [true, `하위 포함 노트 (${counts.rollup})`]] as const) {
      const details = this.panel.createEl('details');
      details.open = !rollup;
      details.createEl('summary', { text: title });
      const list = details.createEl('ul');
      for (const path of model.notesFor(tag, rollup)) {
        const item = list.createEl('li');
        const link = item.createEl('a', { text: path.split('/').at(-1)!.slice(0, -3), href: '#', attr: { title: path } });
        link.addEventListener('click', e => { e.preventDefault(); void this.openNote(path, e.metaKey || e.ctrlKey); });
      }
      if (!list.children.length) list.createEl('li', { text: '없음', cls: 'tag-ontology-muted' });
    }
  }

  private inspectInventory() {
    const model = this.model;
    if (!model) return;
    this.panel.empty(); this.panel.hidden = false;
    this.panel.createEl('strong', { text: '태그 사전 대조' });
    this.panel.createEl('p', { text: 'Vault의 실제 사용 태그와 사전을 비교합니다. 파일을 수정하지 않습니다.' });
    this.panel.createEl('h4', { text: `사전 미등록 ${model.unregistered.size}개` });
    for (const [tag, paths] of model.unregistered) {
      this.panel.createEl('button', { text: `${tag} · ${paths.length}개 노트`, cls: 'tag-ontology-inventory-item' })
        .addEventListener('click', () => this.inspectUnregistered(tag));
    }
    const unused = this.panel.createEl('details');
    unused.createEl('summary', { text: `직접 사용 없는 사전 개념 ${model.unused.length}개` });
    unused.createEl('p', { text: '상위 분류나 나중에 쓸 개념일 수 있습니다. 삭제 대상이라는 뜻은 아닙니다.' });
    for (const tag of model.unused) {
      unused.createEl('button', { text: tag, cls: 'tag-ontology-inventory-item' }).addEventListener('click', () => { void this.selectTag(tag); });
    }
  }

  private inspectUnregistered(tag: string) {
    const model = this.model;
    if (!model) return;
    this.panel.empty(); this.panel.hidden = false;
    this.panel.createEl('strong', { text: tag });
    this.panel.createEl('p', { text: '사전 미등록 태그입니다. 상위·연관 관계를 추정하거나 자동 등록하지 않습니다.' });
    const alias = [...model.entries].find(([, entry]) => entry.aliases.some(a => a.toLowerCase() === tag.toLowerCase()));
    if (alias) this.panel.createEl('p', { text: `사전 별칭 일치: ${alias[0]}. 노트와 사전은 그대로 유지합니다.` });
    const paths = model.unregistered.get(tag) ?? [];
    this.panel.createEl('h4', { text: `사용 노트 ${paths.length}개` });
    const list = this.panel.createEl('ul');
    for (const path of paths) {
      const link = list.createEl('li').createEl('a', { text: path.split('/').at(-1)!.slice(0, -3), href: '#', attr: { title: path } });
      link.addEventListener('click', e => { e.preventDefault(); void this.openNote(path, e.metaKey || e.ctrlKey); });
    }
    this.panel.createEl('button', { text: '사전 대조 목록' }).addEventListener('click', () => this.inspectInventory());
  }

  private async openNote(path: string, newTab = false) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('노트가 이동되었거나 삭제되었습니다. 새로고침해 주세요.'); return; }
    const noteLeaf = !newTab ? this.app.workspace.getLeavesOfType('markdown').at(-1) : undefined;
    await (noteLeaf ?? this.app.workspace.getLeaf('tab')).openFile(file);
  }
  private fit() {
    const cy = this.handle?.cy;
    if (!cy || !cy.nodes().length) return;
    cy.fit(undefined, 65);
    if (cy.zoom() > 1.4) cy.zoom(1.4);
    cy.center();
  }
  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label, title: label } });
    setIcon(button, icon);
    button.addEventListener('click', action);
    return button;
  }
  async onClose() {
    this.closed = true; this.generation++;
    this.layout?.stop(); this.resize?.disconnect();
    this.handle?.destroy(); this.handle = undefined;
    this.contentEl.empty();
  }
}
