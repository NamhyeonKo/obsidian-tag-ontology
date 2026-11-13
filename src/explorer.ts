import { ItemView, Menu, TFile, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import type { CollectionReturnValue, Core, EventObject, NodeSingular, StylesheetJson } from 'cytoscape';
import type TagOntologyPlugin from './main.ts';
import type { ExplorerPanel, LinkedGraph } from './native.ts';
import { TagSuggest } from './search.ts';
import { cssColorToHex } from './settings.ts';
import { cardImage, type Card, type CardTheme } from './explorer-card.ts';
import { TAKE_OUT, canvasEdges, facetColors, groupPaths, grouped, placeAside, placeColumn, plural, pruneCanvas, relativeTime, searchAround, type Box, type OnCanvas, type Point, type Size } from './explorer-layout.ts';

export const VIEW_EXPLORER = 'tag-ontology-explorer';

// Used when a theme leaves a color unset or in a format cssColorToHex can't read.
const FALLBACK = { tag: '#55c26a', muted: '#9a9a9a', line: '#5a5a5a', background: '#1e1e1e', card: '#262626', border: '#3a3a3a', text: '#dadada', accent: '#8b6cef' };
const WIDTH = { tag: 230, note: 210, group: 220 };
type Expand = 'children' | 'parents' | 'related';
type Dated = { path: string; mtime: number };
const basename = (path: string) => path.split('/').at(-1)!.replace(/\.md$/, '');

// Palantir-style exploration: start from an empty canvas and bring tags, notes and note groups out one relation at a time.
// It shares the sidebar with the other graphs through NativeGraphs, but not their expansion or focus.
export class ExplorerView extends ItemView implements LinkedGraph, ExplorerPanel {
  private cy?: Core;
  private closed = false;
  private stage?: HTMLElement; private status?: HTMLElement; private start?: HTMLElement; private continueChip?: HTMLElement;
  private colors = FALLBACK; private theme: CardTheme = { card: FALLBACK.card, border: FALLBACK.border, title: FALLBACK.text, sub: FALLBACK.muted, row: FALLBACK.text, divider: FALLBACK.border, font: 'sans-serif' };
  private measurer?: CanvasRenderingContext2D;

  constructor(leaf: WorkspaceLeaf, private owner: TagOntologyPlugin) { super(leaf); }
  getViewType(): string { return VIEW_EXPLORER; }
  getDisplayText(): string { return 'Ontology explorer'; }
  getIcon(): string { return 'waypoints'; }

  async onOpen(): Promise<void> {
    // With the explorer off, a tab the workspace brings back closes before it loads Cytoscape.
    if (!this.owner.settings.enableExplorer) { this.leaf.detach(); return; }
    // One explorer: the sidebar's group view and reveal talk to it, so a second one from Split or a restored workspace closes.
    // The first claims the place before it awaits Cytoscape, so two opening at once can't both stay.
    const native = this.owner.native;
    if (native.explorer && native.explorer !== this) { this.leaf.detach(); return; }
    native.explorer = this;
    const root = this.contentEl;
    root.empty(); root.addClass('tag-ontology-explorer');
    this.stage = root.createDiv('tag-ontology-explorer-stage');
    // The canvas has its own right-click menu.
    this.registerDomEvent(this.stage, 'contextmenu', event => event.preventDefault());
    const overlay = root.createDiv('tag-ontology-overlay'), tools = overlay.createDiv('tag-ontology-tools');
    this.status = overlay.createDiv('tag-ontology-status'); this.status.setAttribute('role', 'status');
    this.button(tools, 'scan', 'Fit', () => { this.cy?.animate({ fit: { eles: this.cy.elements(), padding: 40 } }, { duration: 300 }); });
    // A group the sidebar shows goes with the canvas, so the sidebar draws again.
    this.button(tools, 'eraser', 'Clear canvas', () => { this.cy?.elements().remove(); this.changed(); this.owner.native.renderPanel(); });
    tools.createDiv('tag-ontology-separator');
    this.button(tools, 'git-fork', 'Open in 2D', () => { void this.owner.openView(); });
    this.buildStart(root);
    this.measurer = createEl('canvas').getContext('2d') ?? undefined;
    this.readTheme();
    const { default: cytoscape } = await import('cytoscape');
    if (this.closed) return;
    const cy = this.cy = cytoscape({ container: this.stage, minZoom: 0.1, maxZoom: 3, style: this.style() });
    // The tab can still be laying out when Cytoscape measures its container, and a resized tab needs a new measure too.
    const resize = new ResizeObserver(() => cy.resize());
    resize.observe(this.stage);
    this.register(() => resize.disconnect());
    cy.on('tap', 'node[type="tag"]', event => this.owner.native.clickTag(this.tagOf(event), false));
    cy.on('dbltap', 'node[type="tag"]', event => this.expand(event.target as NodeSingular, 'children'));
    cy.on('cxttap', 'node[type="tag"]', event => this.tagMenu(event));
    cy.on('tap', 'node[type="note"]', event => this.owner.native.showNote(this.pathOf(event)));
    cy.on('dbltap', 'node[type="note"]', event => this.owner.native.openNote(this.pathOf(event)));
    cy.on('cxttap', 'node[type="note"]', event => this.menu(event, [['Open note', 'file-text', () => this.owner.native.openNote(this.pathOf(event))]]));
    cy.on('tap', 'node[type="group"]', event => this.owner.native.showGroup(this.tagOf(event)));
    cy.on('dbltap', 'node[type="group"]', event => this.takeLatest(this.tagOf(event)));
    cy.on('cxttap', 'node[type="group"]', event => this.menu(event, [[`Take out latest ${TAKE_OUT}`, 'arrow-down-to-line', () => this.takeLatest(this.tagOf(event))]]));
    this.registerEvent(this.app.workspace.on('css-change', () => this.recolor()));
    // Obsidian's accent color setting only rewrites the accent variables on <body>, with no css-change, so <body> is watched too.
    const accentWatch = new MutationObserver(() => this.recolor());
    accentWatch.observe(this.contentEl.doc.body, { attributes: true, attributeFilter: ['style'] });
    this.register(() => accentWatch.disconnect());
    // A renamed note keeps its card, its place in a group and its sidebar view; deleted ones go on the refresh that follows.
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.owner.native.noteRenamed(oldPath, file.path);
      if (!this.cy) return;
      this.replace(this.cy.getElementById('note:' + oldPath), 'note:' + file.path, { path: file.path });
      this.changed();
    }));
    this.owner.native.link(this);
    this.changed();
  }

  // Obsidian calls this when the tab changes size; the observer in onOpen covers the first layout too.
  onResize(): void { this.cy?.resize(); }

  onClose(): Promise<void> {
    this.closed = true;
    this.owner.native.unlink(this);
    if (this.owner.native.explorer === this) { this.owner.native.explorer = undefined; this.owner.native.renderPanel(); }
    this.cy?.destroy(); this.cy = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  // A dictionary or note edit, or a settings change such as the tag color: cards that lost their place go, groups keep the notes
  // that still carry their tag, and every card says what is true now. Nothing moves.
  draw(operation: string): void {
    const cy = this.cy, model = this.owner.model;
    if (operation !== 'refresh' || !cy || !model) return;
    const pruned = pruneCanvas(model, path => this.exists(path), this.onCanvas());
    for (const id of [...pruned.tags.map(tag => 'tag:' + tag), ...pruned.notes.map(path => 'note:' + path), ...pruned.groups.map(tag => 'group:' + tag)]) cy.getElementById(id).remove();
    // Redrawing every card ends in changed(), which refills the groups.
    this.recolor();
  }

  // The sidebar's tag is selected on the canvas when its card is there; the start screen offers to continue from it.
  paint(): void {
    this.updateStart();
    const tag = this.owner.native.selectedTag, node = tag ? this.cy?.getElementById('tag:' + tag) : undefined;
    if (!node?.nonempty() || node.selected()) return;
    this.cy!.elements().unselect(); node.select();
  }

  // Any dictionary tag can be brought onto the canvas.
  has(tag: string): boolean { return !!this.owner.model?.entries.has(tag); }
  // A tag picked in the sidebar search or its links joins the canvas, or comes into view if it is there.
  focusOn(tag: string): void { this.addTag(tag); }

  // The editor renamed a tag: its card and group take the new name where they stand. The reload that follows redraws them.
  renamed(from: string, to: string): void {
    const cy = this.cy;
    if (!cy) return;
    this.replace(cy.getElementById('tag:' + from), 'tag:' + to, { tag: to });
    this.replace(cy.getElementById('group:' + from), 'group:' + to, { tag: to });
    this.changed();
  }

  // Cytoscape ids can't change, so a renamed card is a new node with the old one's place, data and selection.
  private replace(old: CollectionReturnValue, id: string, data: Record<string, unknown>) {
    if (old.empty()) return;
    const node = old[0] as NodeSingular, selected = node.selected(), position = { ...node.position() }, kept = { ...node.data() as Record<string, unknown> };
    node.remove();
    const added = this.cy!.add({ group: 'nodes', data: { ...kept, ...data, id }, position });
    if (selected) added.select();
  }

  // The start screen fills an empty canvas: a search, the sidebar's tag to continue from, and the root tags.
  private buildStart(root: HTMLElement) {
    const start = this.start = root.createDiv('tag-ontology-explorer-start');
    start.createEl('h3', { text: 'Where do you want to start?' });
    start.createEl('p', { text: 'Search for a tag or pick a root tag.', cls: 'tag-ontology-muted' });
    const search = start.createEl('input', { type: 'search', placeholder: 'Search tags or aliases', attr: { 'aria-label': 'Search tags or aliases' } });
    new TagSuggest(this.app, search, query => (this.owner.model?.suggest(query) ?? []).filter(item => this.owner.model?.entries.has(item.tag)), tag => this.addTag(tag));
    this.continueChip = start.createDiv('tag-ontology-tags');
    start.createDiv('tag-ontology-explorer-roots');
  }

  private updateStart() {
    const start = this.start, model = this.owner.model;
    if (!start || !this.continueChip) return;
    start.hidden = !!this.cy && this.cy.nodes().nonempty();
    this.continueChip.empty();
    const selected = this.owner.native.selectedTag;
    if (model && selected && model.entries.has(selected)) this.chip(this.continueChip, `Continue from #${selected}`, selected);
    const roots = start.querySelector<HTMLElement>('.tag-ontology-explorer-roots');
    if (!roots) return;
    roots.empty();
    if (!model) return;
    roots.createDiv({ text: 'Root tags', cls: 'tag-ontology-muted' });
    const list = roots.createDiv('tag-ontology-tags');
    for (const tag of model.roots) this.chip(list, '#' + tag, tag);
  }

  private chip(parent: HTMLElement, text: string, tag: string) {
    parent.createEl('a', { href: '#', text, cls: 'tag' }).addEventListener('click', event => { event.preventDefault(); this.addTag(tag); });
  }

  // Everything that changes what is on the canvas ends here.
  private changed() {
    this.regroup();
    this.syncEdges();
    this.updateStart();
    const on = this.onCanvas(), status = this.status;
    if (status) status.textContent = `${plural(on.tags.size, 'tag')} · ${plural(on.notes.size, 'note')} · ${plural(on.groups.size, 'group')}`;
  }

  // Every group holds its tag's notes that aren't cards on the canvas (groupPaths). A group left empty goes; the sidebar draws
  // again when a group changed, as it may be showing it.
  private regroup() {
    const cy = this.cy, model = this.owner.model;
    if (!cy || !model) return;
    const on = this.onCanvas();
    let moved = false;
    cy.nodes('[type="group"]').forEach(group => {
      const paths = groupPaths(model, group.data('tag') as string, on, path => this.exists(path));
      const held = (group.data('notes') as Dated[]).map(note => note.path);
      if (paths.length === held.length && paths.every(path => held.includes(path))) return;
      moved = true;
      if (!paths.length) { group.remove(); return; }
      group.data('notes', paths.map(path => ({ path, mtime: this.mtime(path) })).sort((a, b) => b.mtime - a.mtime));
      this.redraw(group);
    });
    if (moved) this.owner.native.renderPanel();
  }

  private exists(path: string) { return this.app.vault.getAbstractFileByPath(path) instanceof TFile; }

  private onCanvas(): OnCanvas {
    const of = (type: string, key: string) => new Set((this.cy?.nodes(`[type="${type}"]`) ?? []).map(node => node.data(key) as string));
    return { tags: of('tag', 'tag'), notes: of('note', 'path'), groups: of('group', 'tag') };
  }

  private taken(): Box[] {
    return (this.cy?.nodes() ?? []).map(node => { const p = node.position(), w = node.data('w') as number, h = node.data('h') as number; return { x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 }; });
  }

  private tagOf(event: EventObject) { return (event.target as NodeSingular).data('tag') as string; }
  private pathOf(event: EventObject) { return (event.target as NodeSingular).data('path') as string; }

  groupNotes(tag: string): Dated[] | undefined {
    const node = this.cy?.getElementById('group:' + tag);
    return node?.nonempty() ? node.data('notes') as Dated[] : undefined;
  }

  // Notes leave the group for cards in a column beside it; a group left empty goes.
  // The notes become cards in a column beside the group, which shrinks by them (see regroup); a group left empty goes.
  takeOut(tag: string, paths: string[]) {
    const cy = this.cy, group = cy?.getElementById('group:' + tag);
    if (!cy || !group?.nonempty()) return;
    const held = new Set((group.data('notes') as Dated[]).map(note => note.path));
    const fresh = paths.filter(path => held.has(path) && cy.getElementById('note:' + path).empty());
    const cards = fresh.map(path => this.noteCard(path));
    const spots = placeColumn(group.position(), 1, cards.map(card => this.size(card)), this.taken());
    this.reveal(fresh.reduce((all, path, i) => all.union(this.addNode('note:' + path, cards[i], { type: 'note', path }, spots[i])), cy.collection()));
  }

  private takeLatest(tag: string) { this.takeOut(tag, (this.groupNotes(tag) ?? []).slice(0, TAKE_OUT).map(note => note.path)); }

  // A tag's own notes: cards beside it, or one group card when there are too many (see grouped).
  private showNotes(node: NodeSingular) {
    const model = this.owner.model, cy = this.cy;
    if (!model || !cy) return;
    const tag = node.data('tag') as string, paths = searchAround(model, tag, this.onCanvas()).notes;
    if (grouped(paths.length)) {
      const notes = paths.map(path => ({ path, mtime: this.mtime(path) })).sort((a, b) => b.mtime - a.mtime);
      const card = this.groupCard(tag, notes), [spot] = placeColumn(node.position(), 1, [this.size(card)], this.taken());
      this.reveal(this.addNode('group:' + tag, card, { type: 'group', tag, notes }, spot));
      return;
    }
    const cards = paths.map(path => this.noteCard(path));
    const spots = placeColumn(node.position(), 1, cards.map(card => this.size(card)), this.taken());
    this.reveal(paths.reduce((all, path, i) => all.union(this.addNode('note:' + path, cards[i], { type: 'note', path }, spots[i])), cy.collection()));
  }

  private mtime(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file.stat.mtime : 0;
  }

  // The menu of a note or group card: its own items, then removing it.
  private menu(event: EventObject, items: [title: string, icon: string, action: () => void][]) {
    const node = event.target as NodeSingular, menu = new Menu();
    for (const [title, icon, action] of items) menu.addItem(item => item.setTitle(title).setIcon(icon).onClick(action));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from canvas').setIcon('x').onClick(() => this.remove(node)));
    menu.showAtMouseEvent(event.originalEvent);
  }

  // A removed card takes its lines along; the cards brought out of it stay.
  private remove(node: NodeSingular) {
    const group = node.data('type') === 'group';
    node.remove();
    this.changed();
    if (group) this.owner.native.renderPanel();
  }

  // A card on its own, from the start screen or the sidebar: beside everything else, then in view and selected.
  private addTag(tag: string) {
    const cy = this.cy;
    if (!cy || !this.owner.model?.entries.has(tag)) return;
    let node = cy.getElementById('tag:' + tag);
    if (node.empty()) {
      const card = this.tagCard(tag), first = cy.nodes().empty();
      node = this.addNode('tag:' + tag, card, { type: 'tag', tag }, placeAside(this.taken(), this.size(card)));
      this.changed();
      if (first) { cy.zoom(1); cy.center(node); }
    }
    cy.elements().unselect(); node.select();
    cy.animate({ center: { eles: node } }, { duration: 250 });
  }

  private expand(node: NodeSingular, kind: Expand) {
    const model = this.owner.model;
    if (!model || !this.cy) return;
    const tags = searchAround(model, node.data('tag') as string, this.onCanvas())[kind];
    const cards = tags.map(tag => this.tagCard(tag));
    const spots = placeColumn(node.position(), kind === 'parents' ? -1 : 1, cards.map(card => this.size(card)), this.taken());
    this.reveal(tags.reduce((added, tag, i) => added.union(this.addNode('tag:' + tag, cards[i], { type: 'tag', tag }, spots[i])), this.cy.collection()));
  }

  // New cards join their lines, and the view moves to them if any landed outside it; the zoom stays.
  private reveal(added: CollectionReturnValue) {
    const cy = this.cy;
    this.changed();
    if (!cy || added.empty()) return;
    const view = cy.extent(), box = added.boundingBox();
    if (box.x1 < view.x1 || box.x2 > view.x2 || box.y1 < view.y1 || box.y2 > view.y2) cy.animate({ center: { eles: added } }, { duration: 250 });
  }

  private tagMenu(event: EventObject) {
    const model = this.owner.model, node = event.target as NodeSingular;
    if (!model) return;
    const around = searchAround(model, node.data('tag') as string, this.onCanvas()), menu = new Menu();
    const items: [Expand, string, string][] = [['children', 'Expand children', 'git-branch'], ['parents', 'Expand parents', 'arrow-up-circle'], ['related', 'Expand related', 'link']];
    for (const [kind, title, icon] of items) {
      const n = around[kind].length;
      if (n) menu.addItem(item => item.setTitle(`${title} (${n})`).setIcon(icon).onClick(() => this.expand(node, kind)));
    }
    const notes = around.notes.length;
    if (notes) {
      menu.addSeparator();
      menu.addItem(item => item.setTitle(`Show notes (${notes})`).setIcon('file-text').onClick(() => this.showNotes(node)));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from canvas').setIcon('x').onClick(() => this.remove(node)));
    menu.showAtMouseEvent(event.originalEvent);
  }

  private addNode(id: string, card: Card, data: Record<string, unknown>, position: Point): CollectionReturnValue {
    const image = cardImage(card, this.theme, (text, px, bold) => this.measure(text, px, bold));
    return this.cy!.add({ group: 'nodes', data: { id, ...data, img: image.uri, w: image.width, h: image.height }, position });
  }

  private size(card: Card): Size { return { w: card.width, h: cardImage(card, this.theme, () => 0).height }; }

  private measure(text: string, px: number, bold: boolean) {
    const ctx = this.measurer;
    if (!ctx) return text.length * px * 0.6;
    ctx.font = `${bold ? '600 ' : ''}${px}px ${this.theme.font}, -apple-system, "Segoe UI", sans-serif`;
    return ctx.measureText(text).width;
  }

  private tagCard(tag: string): Card {
    const model = this.owner.model!, entry = model.entries.get(tag), counts = model.counts(tag);
    const facets = facetColors([...model.entries.values()].flatMap(each => each.facet ? [each.facet] : []));
    const color = entry?.facet ? facets.get(entry.facet)! : this.owner.settings.customColors ? this.owner.tagColor() : this.colors.tag;
    return { icon: 'tag', color, title: '#' + tag, sub: `${entry?.facet ?? 'concept'} · Tag`, width: WIDTH.tag,
      rows: [['Direct notes', String(counts.direct)], ['Including descendants', String(counts.rollup)], ['Children', String(model.children.get(tag)?.length ?? 0)]] };
  }

  private noteCard(path: string): Card {
    const folder = path.split('/').slice(0, -1).join('/') || '/';
    return { icon: 'note', color: this.colors.muted, title: basename(path), sub: `${folder} · Note`, width: WIDTH.note, rows: [['Modified', relativeTime(this.mtime(path), Date.now())]] };
  }

  private groupCard(tag: string, notes: Dated[]): Card {
    return { icon: 'group', color: this.colors.accent, title: plural(notes.length, 'note'), sub: `#${tag} · Group`, width: WIDTH.group, stacked: true,
      rows: [['Latest', relativeTime(notes[0]?.mtime ?? 0, Date.now())]] };
  }

  private cardOf(node: NodeSingular): Card | undefined {
    const type = node.data('type') as string;
    if (type === 'tag' && this.owner.model?.entries.has(node.data('tag') as string)) return this.tagCard(node.data('tag') as string);
    if (type === 'note') return this.noteCard(node.data('path') as string);
    if (type === 'group') return this.groupCard(node.data('tag') as string, node.data('notes') as Dated[]);
    return undefined;
  }

  private redraw(node: NodeSingular) {
    const card = this.cardOf(node);
    if (!card) return;
    const image = cardImage(card, this.theme, (text, px, bold) => this.measure(text, px, bold));
    node.data({ img: image.uri, w: image.width, h: image.height });
  }

  // Lines follow the dictionary: whatever brought two cards out, the relations between them are drawn.
  private syncEdges() {
    const cy = this.cy, model = this.owner.model;
    if (!cy || !model) return;
    const wanted = new Map(canvasEdges(model, this.onCanvas()).map(edge => [edge.id, edge]));
    cy.edges().filter(edge => !wanted.has(edge.id())).remove();
    for (const edge of wanted.values()) {
      if (cy.getElementById(edge.id).nonempty()) continue;
      cy.add({ group: 'edges', data: { ...edge, label: edge.kind === 'broader' ? 'narrower' : edge.kind === 'related' ? 'related' : '' } });
    }
  }

  private readTheme() {
    const style = getComputedStyle(this.contentEl), read = (name: string, fallback: string) => cssColorToHex(style.getPropertyValue(name)) ?? fallback;
    this.colors = {
      tag: read('--graph-node-tag', FALLBACK.tag), muted: read('--text-muted', FALLBACK.muted), line: read('--graph-line', FALLBACK.line),
      background: read('--background-primary', FALLBACK.background), card: read('--background-secondary', FALLBACK.card),
      border: read('--background-modifier-border', FALLBACK.border), text: read('--text-normal', FALLBACK.text), accent: read('--interactive-accent', FALLBACK.accent),
    };
    const { card, border, text, muted } = this.colors;
    this.theme = { card, border, title: text, sub: muted, row: text, divider: border, font: style.getPropertyValue('--font-interface').trim() || 'sans-serif' };
  }

  // A theme, accent or tag color change redraws every card and line style.
  private recolor() {
    const cy = this.cy;
    if (!cy) return;
    this.readTheme();
    cy.style(this.style());
    cy.nodes().forEach(node => this.redraw(node));
    this.changed();
  }

  private style(): StylesheetJson {
    const { line, accent, muted, background } = this.colors;
    const label = { 'font-size': 10, color: muted, 'text-rotation': 'none' as const, 'text-background-color': background, 'text-background-opacity': 1, 'text-background-padding': '2px', label: 'data(label)' };
    return [
      { selector: 'node', style: { shape: 'round-rectangle', width: 'data(w)', height: 'data(h)', 'background-image': 'data(img)', 'background-fit': 'none', 'background-clip': 'none', 'background-opacity': 0, 'border-width': 0 } },
      { selector: 'node:selected', style: { 'overlay-color': accent, 'overlay-opacity': 0.18, 'overlay-padding': 4, 'overlay-shape': 'round-rectangle' } },
      { selector: 'node:active', style: { 'overlay-opacity': 0 } },
      { selector: 'edge', style: { width: 1, 'line-color': line, 'curve-style': 'bezier', opacity: 0.8 } },
      { selector: 'edge[kind="broader"]', style: { ...label, width: 2, 'line-color': line, 'target-arrow-shape': 'triangle', 'target-arrow-color': line, opacity: 1 } },
      { selector: 'edge[kind="related"]', style: { ...label, width: 1.6, 'line-style': 'dashed', 'line-dash-pattern': [6, 4], 'line-color': accent, opacity: 1 } },
    ];
  }

  private button(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    setTooltip(button, label, { placement: 'right' });
    button.addEventListener('click', action);
    return button;
  }
}
