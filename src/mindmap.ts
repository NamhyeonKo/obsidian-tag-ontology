import type { App } from 'obsidian';
import type { Suggestion } from 'tag-ontology';
import { TagSuggest } from './search.ts';
import type { Core } from 'cytoscape';

export interface MindMapNode {
  id: string; tag?: string; name: string; x: number; y: number; color?: string;
  expandable: boolean; expanded: boolean;
}
export interface MindMapStart { app: App; suggest(query: string): Suggestion[]; choose(tag?: string): void }
export interface MindMapData {
  root?: string; roots?: string[]; startFrom?: string;
  nodes: MindMapNode[];
  edges: { source: string; target: string; related: boolean }[];
  selected?: string; anchor?: string; bright?: ReadonlySet<string>;
}
interface Card { el: HTMLElement; name: HTMLButtonElement; toggle: HTMLButtonElement; tag?: string }

// Cytoscape supplies pan, zoom and fit; real DOM buttons keep labels and branch controls keyboard accessible.
export class MindMap {
  private cy?: Core;
  private data?: MindMapData;
  private closed = false;
  private pendingFit = true;
  private cards = new Map<string, Card>();
  private layer: HTMLElement;
  private lines: SVGSVGElement;
  private resize: ResizeObserver;
  private suggest: TagSuggest;
  private start: HTMLElement;
  private choices: HTMLElement;
  private continueChoices: HTMLElement;
  private changeRoot: HTMLButtonElement;
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, private select: (tag: string) => void, private toggle: (tag: string) => void, private startActions: MindMapStart) {
    this.el = parent.createDiv('tag-ontology-mindmap');
    this.el.setAttribute('aria-label', 'Tag mind map');
    const stage = this.el.createDiv('tag-ontology-mindmap-stage');
    this.start = this.el.createDiv('tag-ontology-explorer-start tag-ontology-mindmap-start');
    this.start.createEl('h3', { text: 'Where do you want to start?' });
    this.start.createEl('p', { text: 'Search for a tag or pick a root tag.', cls: 'tag-ontology-muted' });
    const search = this.start.createEl('input', { type: 'search', placeholder: 'Search tags or aliases', attr: { 'aria-label': 'Choose a starting tag' } });
    this.suggest = new TagSuggest(startActions.app, search, query => startActions.suggest(query), tag => startActions.choose(tag));
    this.continueChoices = this.start.createDiv('tag-ontology-tags');
    this.start.createDiv({ text: 'Root tags', cls: 'tag-ontology-muted' });
    this.choices = this.start.createDiv('tag-ontology-tags');
    this.changeRoot = this.el.createEl('button', { cls: 'tag-ontology-mindmap-change-root', text: 'Change starting tag' });
    this.changeRoot.hidden = true;
    this.changeRoot.addEventListener('click', () => startActions.choose());
    this.layer = this.el.createDiv('tag-ontology-mindmap-layer');
    this.lines = this.layer.createSvg('svg');
    this.lines.classList.add('tag-ontology-mindmap-lines');
    this.lines.setAttribute('aria-hidden', 'true');
    this.layer.appendChild(this.lines);
    this.resize = new ResizeObserver(() => { this.cy?.resize(); this.fitWhenReady(); this.transform(); });
    this.resize.observe(this.el);
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (this.closed) return;
      this.cy = cytoscape({ container: stage, autoungrabify: true, minZoom: 0.000001, maxZoom: 2.5, style: [
        { selector: 'node', style: { width: 208, height: 32, opacity: 0 } },
      ] });
      stage.appendChild(this.layer);
      this.cy.on('pan zoom resize', () => this.transform());
      if (this.data) this.draw(this.data);
    }).catch(error => {
      if (this.closed) return;
      console.error('Tag Ontology mind map:', error);
      this.el.createEl('p', { cls: 'tag-ontology-mindmap-error', text: 'Could not open the mind map. Choose another layout and try again.' });
    });
  }

  draw(data: MindMapData): void {
    this.data = data;
    this.start.hidden = !!data.root;
    this.changeRoot.hidden = !data.root;
    this.choices.empty(); this.continueChoices.empty();
    const choice = (parent: HTMLElement, tag: string, label: string) => parent.createEl('a', { href: '#', text: label, cls: 'tag' }).addEventListener('click', event => { event.preventDefault(); this.startActions.choose(tag); });
    if (data.startFrom) choice(this.continueChoices, data.startFrom, `Continue from #${data.startFrom}`);
    for (const tag of data.roots ?? []) choice(this.choices, tag, '#' + tag);
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
      card.name.setAttribute('aria-label', node.tag ? `Show #${node.tag} details` : node.name);
      card.name.setAttribute('title', node.name);
      card.el.setCssProps({ '--mindmap-x': `${node.x}px`, '--mindmap-y': `${node.y}px`, '--mindmap-color': node.color ?? 'var(--graph-node-tag, var(--color-accent))' });
      card.toggle.hidden = !node.expandable;
      card.toggle.setText(node.expanded ? '‹' : '›');
      card.toggle.setAttribute('aria-expanded', String(node.expanded));
      card.toggle.setAttribute('aria-label', `${node.expanded ? 'Collapse' : 'Expand'} #${node.tag ?? node.name}`);
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
    if (this.pendingFit) this.fitWhenReady();
    else if (anchor && anchorId && ids.has(anchorId)) {
      const at = cy.getElementById(anchorId).position(), zoom = cy.zoom();
      cy.pan({ x: anchor.x - at.x * zoom, y: anchor.y - at.y * zoom });
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

  private fitWhenReady(): void {
    if (!this.pendingFit || !this.cy || !this.cy.width() || !this.cy.height() || !this.data?.nodes.length) return;
    this.cy.fit(undefined, 64);
    if (this.data.nodes.length === 1 && this.cy.zoom() > 1) this.cy.zoom({ level: 1, renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 } });
    this.pendingFit = false;
  }
  fit(): void { this.pendingFit = true; this.fitWhenReady(); }
  focusOn(id: string): void {
    const node = this.cy?.getElementById(id);
    if (node?.nonempty()) this.cy?.animate({ center: { eles: node } }, { duration: 200 });
  }
  private transform(): void {
    if (!this.cy) return;
    const pan = this.cy.pan();
    this.layer.setCssProps({ '--mindmap-pan-x': `${pan.x}px`, '--mindmap-pan-y': `${pan.y}px`, '--mindmap-zoom': String(this.cy.zoom()) });
  }
  destroy(): void { this.closed = true; this.resize.disconnect(); this.suggest.close(); this.cy?.destroy(); this.cards.clear(); this.el.remove(); }
}
