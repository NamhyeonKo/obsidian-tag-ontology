import type { App } from 'obsidian';
import type { Suggestion } from 'tag-ontology';
import { TagSuggest } from './search.ts';
import type { Core } from 'cytoscape';
import { t } from './i18n/index.ts';

export interface MindMapNode {
  id: string; tag?: string; name: string; x: number; y: number; color?: string;
  expandable: boolean; expanded: boolean;
}
export interface MindMapStart { app: App; suggest(query: string): Suggestion[]; choose(tag?: string): void; color(tag: string): string | undefined; onMove?(): void }
export interface MindMapData {
  root?: string; roots?: string[]; startFrom?: string;
  nodes: MindMapNode[];
  edges: { source: string; target: string; related: boolean }[];
  selected?: string; anchor?: string; bright?: ReadonlySet<string>;
}
interface Card { el: HTMLElement; name: HTMLButtonElement; toggle: HTMLButtonElement; tag?: string }

// Cytoscape supplies pan, zoom and fit; real DOM buttons keep labels and branch controls keyboard accessible.
export class MindMap {
  // How far the view's own controls reach in from its sides, kept for fits after a resize.
  private covered = { left: 0, right: 0, top: 0, bottom: 0 };
  private cy?: Core;
  private data?: MindMapData;
  private closed = false;
  private pendingFit = true;
  private centering = false;
  private cards = new Map<string, Card>();
  private layer: HTMLElement;
  private lines: SVGSVGElement;
  private resize: ResizeObserver;
  private settle?: number;
  private suggest: TagSuggest;
  private start: HTMLElement;
  private startHeading: HTMLElement;
  private startHint: HTMLElement;
  private startSearch: HTMLElement;
  private startRoots: HTMLElement;
  private errorEl?: HTMLElement;
  private choices: HTMLElement;
  private continueChoices: HTMLElement;
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, private select: (tag: string) => void, private toggle: (tag: string) => void, private startActions: MindMapStart) {
    this.el = parent.createDiv('tag-ontology-mindmap');
    const stage = this.el.createDiv('tag-ontology-mindmap-stage');
    this.start = this.el.createDiv('tag-ontology-explorer-start tag-ontology-mindmap-start');
    this.startHeading = this.start.createEl('h3');
    this.startHint = this.start.createEl('p', { cls: 'tag-ontology-muted' });
    this.startSearch = this.start.createEl('input', { type: 'search' });
    this.suggest = new TagSuggest(startActions.app, this.startSearch as HTMLInputElement, query => startActions.suggest(query), tag => startActions.choose(tag));
    this.continueChoices = this.start.createDiv('tag-ontology-tags');
    this.startRoots = this.start.createDiv({ cls: 'tag-ontology-muted' });
    this.choices = this.start.createDiv('tag-ontology-tags');
    this.syncLocaleText();
    this.layer = this.el.createDiv('tag-ontology-mindmap-layer');
    this.lines = this.layer.createSvg('svg');
    this.lines.classList.add('tag-ontology-mindmap-lines');
    this.lines.setAttribute('aria-hidden', 'true');
    this.layer.appendChild(this.lines);
    this.resize = new ResizeObserver(() => { this.cy?.resize(); this.limitZoom(); this.fitWhenReady(); this.transform(); });
    this.resize.observe(this.el);
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (this.closed) return;
      this.cy = cytoscape({ container: stage, autoungrabify: true, minZoom: 0.000001, maxZoom: 2.5, style: [
        { selector: 'node', style: { width: 208, height: 32, opacity: 0 } },
      ] });
      stage.appendChild(this.layer);
      this.cy.on('pan zoom', () => { this.moving(); this.transform(); if (!this.centering) this.startActions.onMove?.(); });
      this.cy.on('resize', () => this.transform());
      for (const type of ['mousedown', 'touchstart', 'wheel']) this.el.addEventListener(type, () => { this.centering = false; }, { capture: true });
      if (this.data) this.draw(this.data);
    }).catch(error => {
      if (this.closed) return;
      console.error('Tag Ontology mind map:', error);
      this.errorEl = this.el.createEl('p', { cls: 'tag-ontology-mindmap-error', text: t('mindmap.loadFailed') });
    });
  }

  private syncLocaleText(): void {
    this.startHeading.setText(t('graph.startHeading'));
    this.startHint.setText(t('graph.startHint'));
    this.startSearch.setAttribute('placeholder', t('sidebar.searchPlaceholder'));
    this.startSearch.setAttribute('aria-label', t('mindmap.searchLabel'));
    this.startRoots.setText(t('graph.startRoots'));
    this.errorEl?.setText(t('mindmap.loadFailed'));
  }

  refreshLocale(): void {
    this.syncLocaleText();
    this.continueChoices.empty();
    if (this.data?.startFrom) this.choice(this.continueChoices, this.data.startFrom, t('graph.continueFrom', { tag: this.data.startFrom }));
    for (const node of this.data?.nodes ?? []) {
      const card = this.cards.get(node.id);
      if (card) this.cardLabels(card, node);
    }
  }

  private choice(parent: HTMLElement, tag: string, label: string): void {
    const chip = parent.createEl('a', { href: '#', text: label, cls: 'tag' }), color = this.startActions.color(tag);
    if (color) chip.setCssProps({ '--tag-ontology-tags': color });
    chip.addEventListener('click', event => { event.preventDefault(); this.startActions.choose(tag); });
  }

  private cardLabels(card: Card, node: MindMapNode): void {
    card.name.setAttribute('aria-label', node.tag ? t('mindmap.showDetails', { tag: node.tag }) : node.name);
    card.toggle.setAttribute('aria-label', t(node.expanded ? 'mindmap.collapseTag' : 'mindmap.expandTag', { label: node.tag ?? node.name }));
  }

  draw(data: MindMapData): void {
    this.data = data;
    this.start.hidden = !!data.root;
    this.choices.empty(); this.continueChoices.empty();
    if (data.startFrom) this.choice(this.continueChoices, data.startFrom, t('graph.continueFrom', { tag: data.startFrom }));
    for (const tag of data.roots ?? []) this.choice(this.choices, tag, '#' + tag);
    const cy = this.cy;
    if (!cy || this.closed) return;
    const ids = new Set(data.nodes.map(n => n.id));
    const anchorId = data.anchor ?? data.selected;
    const selected = anchorId ? cy.getElementById(anchorId) : undefined;
    const anchor = selected?.nonempty() ? selected.renderedPosition() : undefined;
    cy.batch(() => {
      for (const node of cy.nodes()) if (!ids.has(node.id())) node.remove();
      for (const node of data.nodes) {
        const at = { x: node.x, y: node.y }, existing = cy.getElementById(node.id);
        if (existing.empty()) cy.add({ data: { id: node.id }, position: at }); else existing.position(at);
      }
    });
    for (const [id, card] of this.cards) if (!ids.has(id)) { card.el.remove(); this.cards.delete(id); }
    for (const node of data.nodes) {
      let card = this.cards.get(node.id);
      if (!card) {
        const el = this.layer.createDiv('tag-ontology-mindmap-node');
        const name = el.createEl('button', { cls: 'tag-ontology-mindmap-name' });
        const toggle = el.createEl('button', { cls: 'tag-ontology-mindmap-toggle' });
        card = { el, name, toggle };
        const current = card;
        name.addEventListener('click', () => { if (current.tag) this.select(current.tag); });
        toggle.addEventListener('click', () => { if (current.tag) this.toggle(current.tag); });
        this.cards.set(node.id, card);
      }
      card.tag = node.tag;
      card.name.setText(node.name); card.name.disabled = !node.tag;
      card.name.setAttribute('title', node.name);
      card.el.setCssProps({ '--mindmap-x': `${node.x}px`, '--mindmap-y': `${node.y}px`, '--mindmap-color': node.color ?? 'var(--graph-node-tag, var(--color-accent))' });
      card.toggle.hidden = !node.expandable;
      card.toggle.setText(node.expanded ? '‹' : '›');
      card.toggle.setAttribute('aria-expanded', String(node.expanded));
      this.cardLabels(card, node);
    }
    this.lines.replaceChildren();
    const byId = new Map(data.nodes.map(node => [node.id, node]));
    for (const edge of data.edges) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const path = this.lines.createSvg('path');
      const start = a.x + 104, end = b.x - 104, middle = (start + end) / 2;
      path.setAttribute('d', edge.related ? `M${a.x},${a.y} L${b.x},${b.y}` : `M${start},${a.y} C${middle},${a.y} ${middle},${b.y} ${end},${b.y}`);
      path.classList.toggle('is-related', edge.related);
      path.classList.toggle('is-faded', !!data.bright && (!data.bright.has(a.id) || !data.bright.has(b.id)));
      this.lines.appendChild(path);
    }
    this.paint(data.selected, data.bright);
    this.limitZoom();
    if (this.pendingFit) this.fitWhenReady();
    else if (anchor && anchorId && ids.has(anchorId)) {
      const at = cy.getElementById(anchorId).position(), zoom = cy.zoom();
      const hold = anchorId === data.selected;
      if (hold) this.centering = true;
      try { cy.pan({ x: anchor.x - at.x * zoom, y: anchor.y - at.y * zoom }); } finally { if (hold) this.centering = false; }
    }
    this.transform();
  }

  paint(selected?: string, bright?: ReadonlySet<string>): void {
    if (this.data) { this.data.selected = selected; this.data.bright = bright; }
    for (const [id, card] of this.cards) {
      card.el.toggleClass('is-selected', id === selected);
      card.el.toggleClass('is-faded', !!bright && !bright.has(id));
      card.name.setAttribute('aria-pressed', String(id === selected));
    }
    // Selection can change without rebuilding the map's data.
    const edges = this.data?.edges ?? [];
    Array.from(this.lines.children).forEach((path, i) => {
      const edge = edges[i];
      path.classList.toggle('is-faded', !!bright && !!edge && (!bright.has(edge.source) || !bright.has(edge.target)));
    });
  }

  private ready(): boolean { return !!this.cy?.width() && !!this.cy.height() && !!this.data?.nodes.length; }
  // The part of the view the toolbar, legend and settings buttons leave uncovered, and the zoom that fits the map in it with a
  // 64px margin, like cy.fit(undefined, 64).
  private fitArea() {
    const cy = this.cy!, { left, right, top, bottom } = this.covered, pad = 64, box = cy.elements().boundingBox();
    const width = Math.max(1, cy.width() - left - right), height = Math.max(1, cy.height() - top - bottom);
    const zoom = Math.min(Math.max(1, width - 2 * pad) / Math.max(1, box.w), Math.max(1, height - 2 * pad) / Math.max(1, box.h));
    return { left, top, width, height, box, zoom };
  }
  // Zooming out stops when the map takes half of the room Fit gives it (or at half of 100% for a small map), so it can't shrink
  // to a dot, and Fit always lands above it. The limit never rises above the current zoom: after a branch closes the view stays
  // where it is, and zooming out from there does nothing instead of jumping in.
  private limitZoom(): void {
    if (!this.ready()) return;
    this.cy!.minZoom(Math.min(this.cy!.zoom(), Math.min(1, this.fitArea().zoom) / 2));
  }
  private fitWhenReady(): void {
    if (!this.pendingFit || !this.ready()) return;
    const cy = this.cy!, { left, top, width, height, box, zoom: fits } = this.fitArea();
    let zoom = Math.min(cy.maxZoom(), fits);
    if (this.data!.nodes.length === 1) zoom = Math.min(zoom, 1);
    // Cytoscape clamps the viewport to the limit, which an earlier, smaller view may have left above this fit.
    cy.minZoom(Math.min(cy.minZoom(), zoom));
    cy.viewport({ zoom, pan: { x: left + width / 2 - (box.x1 + box.w / 2) * zoom, y: top + height / 2 - (box.y1 + box.h / 2) * zoom } });
    this.pendingFit = false;
    this.limitZoom();
  }
  fit(covered = this.covered): void { this.centering = false; this.covered = covered; this.pendingFit = true; this.fitWhenReady(); this.startActions.onMove?.(); }
  focusOn(id: string): void {
    const node = this.cy?.getElementById(id);
    if (!node?.nonempty()) return;
    this.centering = true;
    this.cy?.animate({ center: { eles: node } }, { duration: 200, complete: () => { this.centering = false; } });
  }
  // While the view moves, the layer is its own GPU layer: each frame only scales and shifts the bitmap it already has, instead
  // of painting every card and line again. Text blurs a little while zooming, so the layer goes back to normal painting, once
  // and sharp at the new zoom, when the gesture stops.
  private moving(): void {
    this.layer.addClass('is-moving');
    window.clearTimeout(this.settle);
    this.settle = window.setTimeout(() => this.layer.removeClass('is-moving'), 150);
  }
  private transform(): void {
    if (!this.cy) return;
    const pan = this.cy.pan();
    this.layer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${this.cy.zoom()})`;
  }
  destroy(): void { window.clearTimeout(this.settle); this.closed = true; this.resize.disconnect(); this.suggest.close(); this.cy?.destroy(); this.cards.clear(); this.el.remove(); }
}
