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
  getDisplayText() { return 'Tag ontology'; }
  getIcon() { return 'git-fork'; }

  async onOpen() {
    this.closed = false;
    const root = this.contentEl;
    root.empty();
    root.addClass('tag-ontology-view');
    this.canvas = root.createDiv('tag-ontology-canvas');
    this.canvas.setAttribute('aria-label', 'Tag ontology graph. Search or click a tag to explore.');
    const tools = root.createDiv('tag-ontology-tools');
    this.search = tools.createEl('input', { type: 'search', placeholder: 'Search tags or aliases' });
    this.search.setAttribute('aria-label', 'Search tags or aliases');
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
      else new Notice('No matching tag.');
    });
    this.inventory = tools.createEl('button', { text: 'Dictionary check' });
    this.inventory.addEventListener('click', () => this.inspectInventory());
    const actions = root.createDiv('tag-ontology-actions');
    this.iconButton(actions, 'scan', 'Fit graph', () => this.fit());
    this.iconButton(actions, 'fold-vertical', 'Collapse all', () => { void this.collapseAll(); });
    this.iconButton(actions, 'settings', 'Graph options', () => {
      this.options.hidden = !this.options.hidden;
    });
    this.options = root.createDiv('tag-ontology-options');
    this.options.hidden = true;
    const layoutLabel = this.options.createEl('label', { text: 'Layout' });
    const select = layoutLabel.createEl('select');
    select.setAttribute('aria-label', 'Layout');
    for (const [value, text] of [['force', 'Force'], ['tree', 'Tree'], ['radial', 'Radial']]) {
      select.createEl('option', { value, text });
    }
    select.value = this.plugin.settings.layout;
    select.addEventListener('change', () => {
      this.plugin.settings.layout = select.value as 'force' | 'tree' | 'radial';
      void this.plugin.saveSettings();
    });
    const relatedLabel = this.options.createEl('label', { text: 'Related links' });
    const related = relatedLabel.createEl('input', { type: 'checkbox' });
    related.checked = true;
    related.addEventListener('change', () => { this.showRelated = related.checked; void this.render('related'); });
    this.options.createEl('button', { text: 'Expand all' }).addEventListener('click', () => { void this.expandAll(); });
    this.options.createEl('button', { text: 'Reload' }).addEventListener('click', () => { void this.refresh(); });
    this.options.createEl('p', { text: 'Solid arrow: parent → child\nDashed line: related\nDouble-click a tag to expand or collapse' });
    this.panel = root.createDiv('tag-ontology-panel');
    this.panel.hidden = true;
    this.status = root.createDiv('tag-ontology-status');
    this.status.setAttribute('role', 'status');
    this.status.textContent = 'Loading dictionary…';
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
      this.inventory.textContent = `Dictionary check · ${model.unregistered.size} unregistered`;
      await this.render(this.metrics.length ? 'refresh' : 'initial');
      if (this.selected && model.entries.has(this.selected)) this.inspect(this.selected);
      if (this.metrics.length === 1) this.metrics[0]!.ms = performance.now() - started;
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.status.textContent = `Could not open the graph: ${error instanceof Error ? error.message : String(error)}`;
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
    this.status.textContent = `${graph.nodes.filter(n => n.kind === 'tag').length} / ${model.entries.size} tags · ${graph.nodes.filter(n => n.kind === 'note').length} notes · ${model.roots.length} roots`;
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
    this.iconButton(heading, 'x', 'Close tag details', () => { this.panel.hidden = true; });
    this.panel.createEl('p', { text: entry.description });
    if (entry.aliases.length) this.panel.createEl('p', { text: entry.aliases.join(' · '), cls: 'tag-ontology-muted' });
    this.panel.createEl('button', { text: this.expanded.has(tag) ? 'Collapse children and notes' : 'Expand children and notes' })
      .addEventListener('click', () => { void this.toggleTag(tag); });
    const relations = this.panel.createDiv('tag-ontology-relations');
    for (const [label, tags] of [['Parents', entry.broader ?? []], ['Children', model.children.get(tag) ?? []], ['Related', entry.related ?? []]] as const) {
      if (!tags.length) continue;
      const group = relations.createEl('details');
      group.createEl('summary', { text: `${label} ${tags.length}` });
      for (const other of tags) group.createEl('button', { text: other }).addEventListener('click', () => { void this.selectTag(other); });
    }
    const counts = model.counts(tag);
    this.panel.createEl('h4', { text: `${counts.direct} direct · ${counts.rollup} including descendants` });
    for (const [rollup, title] of [[false, `Tagged notes (${counts.direct})`], [true, `Including descendants (${counts.rollup})`]] as const) {
      const details = this.panel.createEl('details');
      details.open = !rollup;
      details.createEl('summary', { text: title });
      const list = details.createEl('ul');
      for (const path of model.notesFor(tag, rollup)) {
        const item = list.createEl('li');
        const link = item.createEl('a', { text: path.split('/').at(-1)!.slice(0, -3), href: '#', attr: { title: path } });
        link.addEventListener('click', e => { e.preventDefault(); void this.openNote(path, e.metaKey || e.ctrlKey); });
      }
      if (!list.children.length) list.createEl('li', { text: 'None', cls: 'tag-ontology-muted' });
    }
  }

  private inspectInventory() {
    const model = this.model;
    if (!model) return;
    this.panel.empty(); this.panel.hidden = false;
    this.panel.createEl('strong', { text: 'Dictionary check' });
    this.panel.createEl('p', { text: 'Compares tags used in the vault with the dictionary. No files are changed.' });
    this.panel.createEl('h4', { text: `Not in dictionary (${model.unregistered.size})` });
    for (const [tag, paths] of model.unregistered) {
      this.panel.createEl('button', { text: `${tag} · ${paths.length} note${paths.length === 1 ? '' : 's'}`, cls: 'tag-ontology-inventory-item' })
        .addEventListener('click', () => this.inspectUnregistered(tag));
    }
    const unused = this.panel.createEl('details');
    unused.createEl('summary', { text: `Unused dictionary tags (${model.unused.length})` });
    unused.createEl('p', { text: 'These may be grouping concepts or reserved for later. Unused does not mean they should be deleted.' });
    for (const tag of model.unused) {
      unused.createEl('button', { text: tag, cls: 'tag-ontology-inventory-item' }).addEventListener('click', () => { void this.selectTag(tag); });
    }
  }

  private inspectUnregistered(tag: string) {
    const model = this.model;
    if (!model) return;
    this.panel.empty(); this.panel.hidden = false;
    this.panel.createEl('strong', { text: tag });
    this.panel.createEl('p', { text: 'This tag is not in the dictionary. Parents and related tags are not guessed, and nothing is registered automatically.' });
    const alias = [...model.entries].find(([, entry]) => entry.aliases.some(a => a.toLowerCase() === tag.toLowerCase()));
    if (alias) this.panel.createEl('p', { text: `Matches an alias of dictionary tag ${alias[0]}. Notes and the dictionary are left unchanged.` });
    const paths = model.unregistered.get(tag) ?? [];
    this.panel.createEl('h4', { text: `Notes using it (${paths.length})` });
    const list = this.panel.createEl('ul');
    for (const path of paths) {
      const link = list.createEl('li').createEl('a', { text: path.split('/').at(-1)!.slice(0, -3), href: '#', attr: { title: path } });
      link.addEventListener('click', e => { e.preventDefault(); void this.openNote(path, e.metaKey || e.ctrlKey); });
    }
    this.panel.createEl('button', { text: 'Back to dictionary check' }).addEventListener('click', () => this.inspectInventory());
  }

  private async openNote(path: string, newTab = false) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('The note was moved or deleted. Run "Reload dictionary" and try again.'); return; }
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
