import { Notice, TFile, setIcon, setTooltip, type ItemView, type WorkspaceLeaf } from 'obsidian';
import { hierarchyPositions } from './layout.ts';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, type EdgeKind, type NativeData, type NodeColor, type Resolved } from './layer.ts';
import type { Settings } from './settings.ts';
import type { Ontology } from './ontology.ts';
import { TagSuggest } from './search.ts';

interface Texture { constructor: { from(canvas: HTMLCanvasElement): Texture }; destroy(): void }
interface NativeLink {
  source: { id: string }; target: { id: string };
  line?: { texture: Texture }; render: () => void;
}
interface NativeRenderer {
  setData: (data: NativeData) => unknown;
  onNodeClick: (event: MouseEvent, id: string, type: string) => void;
  changed(): void; resetPan(): void;
  width: number; height: number; scale: number; targetScale: number;
  setScale(scale: number): void; setPan(x: number, y: number): void;
  fShowArrow: boolean;
  getHighlightNode: () => unknown;
  worker: Worker;
  workerResults: unknown;
  nodes: { id: string; x: number; y: number; fx: number | null; fy: number | null; color: unknown }[];
  links: NativeLink[];
}
interface GraphEngine { getOptions(): Record<string, unknown>; setOptions(options: Record<string, unknown>): void; onOptionsChange(): void }
interface NativeView extends ItemView { renderer: NativeRenderer; dataEngine?: GraphEngine; update(): void }
interface Session {
  leaf: WorkspaceLeaf; view: NativeView; renderer: NativeRenderer; active: boolean;
  original: NativeRenderer['setData']; wrapped: NativeRenderer['setData'];
  click: NativeRenderer['onNodeClick']; ownClick?: NativeRenderer['onNodeClick'];
  hovered: NativeRenderer['getHighlightNode']; ownHighlight?: NativeRenderer['getHighlightNode']; focus?: unknown;
  tools: HTMLElement; status: HTMLElement;
  // The engine's latest data, already filtered by the core graph; every render layers it again.
  base?: NativeData; resolved?: Resolved; tagById: Map<string, string>;
  // The layered data last sent to the renderer, with the colors it gave each node.
  data?: NativeData;
  kinds: Map<string, EdgeKind>;
  links: Map<NativeLink, { render: () => void; texture?: Texture }>;
  texture?: Texture; layout?: string;
  toggles: Partial<Record<ToggleKey, HTMLElement>>; layoutButtons: Partial<Record<Settings['layout'], HTMLElement>>;
  fitFrame?: number; stopFit: () => void;
}
type LayerSettings = Pick<Settings, 'expanded' | 'showNotes' | 'showRelated'>;
type ToggleKey = 'showNotes' | 'showRelated';
const TOGGLES: [ToggleKey, string, string][] = [['showNotes', 'file-text', 'Notes'], ['showRelated', 'link', 'Related']];
const LAYOUTS: [Settings['layout'], string, string][] = [['force', 'share-2', 'Force'], ['tree', 'network', 'Tree'], ['radial', 'orbit', 'Radial']];
export const PANEL_VIEW = 'tag-ontology-panel';
// The renderer's color format.
const hexColor = (hex: string): NodeColor => ({ a: 1, rgb: parseInt(hex.slice(1), 16) });

export class NativeGraphs {
  private sessions = new Map<WorkspaceLeaf, Session>();
  private failed = new WeakSet<WorkspaceLeaf>();
  // One sidebar panel serves every graph tab: a tag's details, the dictionary check, or the root tags until either is chosen.
  private panel?: HTMLElement; private selected?: string; private checking = false;
  metrics: { operation: string; ms: number; nodes: number; visible: boolean }[] = [];
  constructor(private owner: TagOntologyPlugin) {}

  attach() {
    const leaves = this.owner.app.workspace.getLeavesOfType('graph');
    for (const [id, session] of this.sessions) {
      if (!leaves.includes(session.leaf) || session.leaf.view !== session.view) this.detach(id, false);
    }
    if (!this.owner.model) return;
    for (const leaf of leaves) {
      if (this.sessions.has(leaf) || this.failed.has(leaf)) continue;
      const view = leaf.view as unknown as NativeView, r = view.renderer;
      if (!r || typeof r.setData !== 'function' || typeof r.onNodeClick !== 'function'
        || !r.worker || !Array.isArray(r.nodes) || !Array.isArray(r.links)) {
        new Notice('Could not attach to the core graph in this Obsidian version.');
        this.failed.add(leaf);
        continue;
      }
      const tools = view.contentEl.createDiv('tag-ontology-tools');
      const status = view.contentEl.createDiv('tag-ontology-status'); status.setAttribute('role', 'status');
      const session: Session = {
        leaf, view, renderer: r, active: true, original: r.setData, wrapped: () => {},
        click: r.onNodeClick, hovered: r.getHighlightNode, tools, status, tagById: new Map(), kinds: new Map(), links: new Map(), toggles: {}, layoutButtons: {}, stopFit: () => {},
      };
      session.stopFit = () => { if (session.fitFrame !== undefined) window.cancelAnimationFrame(session.fitFrame); session.fitFrame = undefined; };
      for (const event of ['pointerdown', 'wheel', 'keydown']) view.contentEl.addEventListener(event, session.stopFit, { capture: true });
      session.wrapped = data => {
        if (!session.active) return session.original.call(r, data);
        const first = !session.base;
        session.base = data;
        try { return this.render(session, first ? 'initial' : 'update'); }
        catch (error) {
          this.failed.add(leaf); this.detach(leaf, false);
          new Notice(`Detached the tag ontology from the graph: ${String(error)}`);
          view.update();
        }
      };
      r.setData = session.wrapped;
      session.ownClick = r.onNodeClick = (event, id, type) => {
        const tag = session.active ? session.tagById.get(id) : undefined;
        if (!tag) { session.click.call(r, event, id, type); return; }
        this.selected = tag; this.checking = false;
        // Clicking only ever expands; collapsing stays explicit so reopening a panel never hides nodes.
        if (!this.owner.settings.expanded.includes(tag)) this.update({ expanded: [...this.owner.settings.expanded, tag] }, 'expand:' + tag);
        else this.showSelection();
        this.showPanel(true);
      };
      // Node and link drawing fade everything not linked to this node; with focus on, the selected tag counts as hovered when nothing else is.
      session.ownHighlight = r.getHighlightNode = () => session.hovered.call(r) || session.focus || null;
      // A column of round icon buttons keeps the core graph settings on the right uncovered.
      const buttons = tools.createDiv('tag-ontology-buttons');
      this.iconButton(buttons, 'chevrons-down-up', 'Collapse all', () => this.update({ expanded: [] }, 'roots'));
      this.iconButton(buttons, 'chevrons-up-down', 'Expand all', () => this.update({ expanded: [...this.owner.model!.entries.keys()] }, 'expand-all'));
      this.iconButton(buttons, 'scan', 'Fit', () => this.fit(session));
      buttons.createDiv('tag-ontology-separator');
      for (const [key, icon, name] of TOGGLES) {
        session.toggles[key] = this.iconButton(buttons, icon, name, () => {
          if (key === 'showNotes' && this.owner.settings.layout !== 'force') return;
          this.update({ [key]: !this.owner.settings[key] }, 'filter');
        });
        session.toggles[key].addClass('tag-ontology-toggle');
      }
      buttons.createDiv('tag-ontology-separator');
      this.iconButton(buttons, 'book-open-check', 'Dictionary check', () => { this.checking = true; this.renderPanel(); this.showPanel(true); });
      buttons.createDiv('tag-ontology-separator');
      for (const [layout, icon, name] of LAYOUTS) {
        session.layoutButtons[layout] = this.iconButton(buttons, icon, `Layout: ${name}`, () => {
          this.owner.settings.layout = layout;
          void this.owner.saveSettings();
        });
      }
      this.syncToolbar(session);
      this.sessions.set(leaf, session);
      view.contentEl.addClass('tag-ontology-native');
      // Obsidian ships with the Tags filter off; turn it on once for a fresh install, then leave it to the user.
      if (this.owner.firstRun && view.dataEngine) {
        this.owner.firstRun = false;
        const options = view.dataEngine.getOptions();
        if (!options.showTags) { options.showTags = true; view.dataEngine.setOptions(options); view.dataEngine.onOptionsChange(); }
        void this.owner.saveState();
      }
      // Ask the engine to send its data again so the first render goes through the layer.
      try { view.update(); }
      catch (error) {
        this.failed.add(leaf); this.detach(leaf, true);
        new Notice(`Detached the tag ontology from the graph: ${String(error)}`);
      }
    }
  }

  refresh() {
    this.attach();
    const model = this.owner.model!, settings = this.owner.settings;
    const kept = settings.expanded.filter(tag => model.entries.has(tag));
    if (kept.length !== settings.expanded.length) { settings.expanded = kept; void this.owner.saveState(); }
    for (const session of this.sessions.values()) this.render(session, 'refresh');
    this.renderPanel();
  }

  // Called by the sidebar view whenever Obsidian opens it.
  mount(el: HTMLElement) {
    el.empty(); el.addClass('tag-ontology-sidebar');
    const search = el.createEl('input', { type: 'search', placeholder: 'Search tags or aliases', attr: { 'aria-label': 'Search tags or aliases' } });
    new TagSuggest(this.owner.app, search, query => this.owner.model?.suggest(query) ?? [], tag => this.reveal(tag));
    search.addEventListener('keydown', e => {
      // An open popover handles Enter first and clears the input; this covers a closed popover (e.g. after Escape).
      // Enter that commits an IME composition (e.g. Korean) is not a submit; Obsidian's own suggest skips it too.
      if (e.key !== 'Enter' || e.isComposing || !search.value.trim()) return;
      const [first] = this.owner.model?.suggest(search.value) ?? [];
      if (!first) { new Notice('No matching dictionary tag.'); return; }
      search.value = '';
      this.reveal(first.tag);
    });
    this.panel = el.createDiv('tag-ontology-panel');
    this.renderPanel();
  }

  // The panel is a sidebar tab the user can drag to either side; Obsidian reuses it wherever it is.
  // Only user actions create it: after a plugin reload Obsidian restores the old tab late, so creating one
  // while attaching would leave two.
  showPanel(reveal: boolean) {
    void this.owner.app.workspace.ensureSideLeaf(PANEL_VIEW, 'left', { reveal });
  }

  // Graph state is shared by every graph tab, like the core graph's own options.
  private update(patch: Partial<LayerSettings>, operation: string) {
    Object.assign(this.owner.settings, patch);
    void this.owner.saveState();
    for (const session of this.sessions.values()) this.render(session, operation);
    this.renderPanel();
  }

  private render(session: Session, operation: string) {
    const model = this.owner.model, settings = this.owner.settings;
    if (!model || !session.active || !session.base) return;
    if (operation !== 'update' && operation !== 'refresh') session.stopFit();
    const start = performance.now();
    // Tree and Radial show the tag hierarchy alone; the saved Notes choice applies again in Force.
    const layer = buildLayer(session.base, model, { expanded: new Set(settings.expanded), showNotes: settings.showNotes && settings.layout === 'force', showRelated: settings.showRelated,
      tagColor: settings.customColors ? hexColor(settings.tagColor) : undefined });
    session.resolved = layer.resolved; session.kinds = layer.kinds;
    session.tagById = new Map([...layer.resolved.idOf].map(([tag, id]) => [id, tag]));
    const r = session.renderer, result = session.original.call(r, layer.data);
    session.data = layer.data; this.paint(session);
    this.styleLinks(session);
    if (settings.layout !== 'force') this.staticLayout(session, layer.data);
    else {
      for (const node of r.nodes) { node.fx = null; node.fy = null; }
      r.worker.postMessage({ nodes: Object.fromEntries(r.nodes.map(n => [n.id, [n.x, n.y]])), alpha: 0.3, run: true });
    }
    // Native updates (metadata changes, file opens) re-enter here; refitting on them would discard the user's zoom.
    const layoutChanged = session.layout !== settings.layout;
    session.layout = settings.layout;
    this.syncToolbar(session);
    if (layoutChanged || operation === 'initial' || operation === 'roots' || operation === 'expand-all') this.fit(session);
    if (operation === 'initial' || operation === 'roots') this.follow(session, () => this.fit(session));
    const placed = new Set(model.roots.flatMap(root => [root, ...model.descendants(root)])).size;
    const notes = Object.values(layer.data.nodes).filter(n => n.type !== 'tag').length;
    // The core graph's Tags filter is off by default, which leaves nothing to layer the dictionary onto.
    const tagsShown = Object.values(session.base.nodes).some(n => n.type === 'tag');
    session.status.textContent = tagsShown
      ? `${layer.resolved.visible.size} / ${placed} tags · ${notes} notes · ${model.roots.length} roots`
      : 'Turn on Tags in the graph filters to show the dictionary hierarchy.';
    this.metrics.push({ operation, ms: performance.now() - start, nodes: Object.keys(layer.data.nodes).length, visible: document.visibilityState === 'visible' });
    this.metrics = this.metrics.slice(-50);
    return result;
  }

  private styleLinks(session: Session) {
    const r = session.renderer, current = new Set(r.links);
    for (const link of session.links.keys()) if (!current.has(link)) session.links.delete(link);
    for (const link of r.links) {
      if (session.links.has(link)) continue;
      const original = { render: link.render, texture: link.line?.texture };
      session.links.set(link, original);
      link.render = () => {
        if (!original.texture && link.line) original.texture = link.line.texture;
        const kind = session.kinds.get(edgeKey(link.source.id, link.target.id));
        if (link.line && kind === 'related') {
          if (!session.texture) {
            const canvas = createEl('canvas', { attr: { width: 256, height: 2 } });
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white';
            for (let x = 0; x < 256; x += 16) ctx.fillRect(x, 0, 9, 2);
            session.texture = link.line.texture.constructor.from(canvas);
          }
          link.line.texture = session.texture;
        } else if (link.line && original.texture) link.line.texture = original.texture;
        // Hierarchy direction is the meaning of the edge, so it ignores the user's arrow setting; other links follow it.
        const arrows = r.fShowArrow;
        r.fShowArrow = kind === 'broader' ? true : kind === 'related' ? false : arrows;
        try { original.render.call(link); } finally { r.fShowArrow = arrows; }
      };
    }
  }

  private staticLayout(session: Session, data: NativeData) {
    const r = session.renderer, model = this.owner.model!, { visible, idOf } = session.resolved!;
    const tags = [...visible];
    const edges = tags.flatMap(tag => (model.entries.get(tag)!.broader ?? []).filter(parent => visible.has(parent)).map(parent => [parent, tag] as [string, string]));
    const positions = new Map([...hierarchyPositions(tags, edges, model.roots.filter(tag => visible.has(tag)), this.owner.settings.layout === 'radial')]
      .map(([tag, position]) => [idOf.get(tag)!, position]));
    r.worker.postMessage({ run: false }); r.workerResults = null;
    const anchorOf = (id: string) => Object.keys(data.nodes[id]?.links ?? {}).find(target => positions.has(target));
    const xs = [...positions.values()].map(p => p.x), ys = [...positions.values()].map(p => p.y);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    const ring = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 150 : 300;
    const loose = r.nodes.filter(node => !positions.has(node.id) && !anchorOf(node.id)).length;
    const around = new Map<string, number>();
    let ringIndex = 0;
    for (const node of r.nodes) {
      let p = positions.get(node.id);
      const anchor = p ? undefined : anchorOf(node.id);
      if (anchor) {
        // Sunflower spiral keeps many notes around one tag readable without overlapping.
        const k = around.get(anchor) ?? 0, a = positions.get(anchor)!;
        around.set(anchor, k + 1);
        p = { x: a.x + Math.cos(k * 2.39996) * 14 * Math.sqrt(k + 1), y: a.y + Math.sin(k * 2.39996) * 14 * Math.sqrt(k + 1) };
      } else if (!p) {
        const angle = ringIndex++ * 2 * Math.PI / Math.max(1, loose);
        p = { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring };
      }
      // The renderer treats fx = 0 as unpinned, so keep coordinates off exact zero.
      node.x = p.x + .01; node.y = p.y + .01;
      node.fx = node.x; node.fy = node.y;
    }
    r.changed();
  }

  private reveal(tag: string) {
    // Suggestions can outlive a dictionary reload that removed the tag.
    if (!this.owner.model?.entries.has(tag)) { new Notice('That tag is no longer in the dictionary.'); return; }
    this.selected = tag; this.checking = false;
    // Expansion is shared by every graph tab; with no graph open it is saved for the next one.
    const sessions = [...this.sessions.values()];
    if (sessions.length && !sessions.some(s => s.resolved?.range.has(tag))) { new Notice('Not in the current graph.'); this.showSelection(); return; }
    // An expanded ancestor can still sit under a collapsed one, so walk every ancestor.
    const expanded = new Set(this.owner.settings.expanded), pending = [tag], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current); expanded.add(current);
      pending.push(...this.owner.model.entries.get(current)?.broader ?? []);
    }
    this.update({ expanded: [...expanded] }, 'reveal');
    // Center the chosen tag in every open graph; with no graph open there is nothing to move.
    for (const session of this.sessions.values()) {
      const id = session.resolved?.idOf.get(tag), r = session.renderer;
      if (!id) continue;
      const center = () => {
        const node = r.nodes.find(n => n.id === id);
        if (node) { r.setPan(r.width * devicePixelRatio / 2 - node.x * r.scale, r.height * devicePixelRatio / 2 - node.y * r.scale); r.changed(); }
      };
      center(); this.follow(session, center);
    }
  }

  // Shows the selected tag in the panel and in every graph without layering the graphs again.
  private showSelection() {
    this.renderPanel();
    for (const session of this.sessions.values()) this.paint(session);
  }

  // Tags to show in the highlight color for the current selection.
  private highlighted(): string[] {
    const settings = this.owner.settings, model = this.owner.model, tag = this.selected, entry = tag ? model?.entries.get(tag) : undefined;
    if (!settings.customColors || !model || !tag || !entry) return [];
    return [
      ...settings.highlightSelected ? [tag] : [],
      ...settings.highlightDescendants ? model.descendants(tag) : [],
      ...settings.highlightConnected ? [...entry.broader ?? [], ...model.children.get(tag) ?? [], ...entry.related ?? []] : [],
    ];
  }

  // The renderer reads node colors every frame, so recoloring needs no new data: highlighted tags take the
  // highlight color and every other node the color the layer gave it.
  private paint(session: Session) {
    const r = session.renderer, highlight = hexColor(this.owner.settings.highlightColor);
    const ids = new Set(this.highlighted().flatMap(tag => session.resolved?.idOf.get(tag) ?? []));
    for (const node of r.nodes) node.color = ids.has(node.id) ? highlight : session.data?.nodes[node.id]?.color ?? null;
    const focused = this.owner.settings.focus && this.selected ? session.resolved?.idOf.get(this.selected) : undefined;
    session.focus = focused && r.nodes.find(n => n.id === focused);
    r.changed();
  }

  private renderPanel() {
    const panel = this.panel, model = this.owner.model;
    if (!panel || !model) return;
    panel.empty();
    panel.setCssProps({ '--tag-ontology-color': this.owner.settings.highlightColor });
    if (this.checking) this.inventory(panel, model);
    else if (this.selected && model.entries.has(this.selected)) this.inspect(panel, model, this.selected);
    else { panel.createEl('h4', { text: `Root tags (${model.roots.length})` }); this.tagLinks(panel, model.roots); }
  }

  private inspect(panel: HTMLElement, model: Ontology, tag: string) {
    const entry = model.entries.get(tag)!, expanded = this.owner.settings.expanded.includes(tag);
    const header = panel.createDiv('tag-ontology-header');
    const { customColors, titleAccent } = this.owner.settings;
    header.createEl('h3', { text: tag, cls: customColors && titleAccent ? 'tag-ontology-accent' : undefined });
    const toggle = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': expanded ? 'Collapse children and notes' : 'Expand children and notes' } });
    setIcon(toggle, expanded ? 'chevrons-down-up' : 'chevrons-up-down');
    toggle.addEventListener('click', () => {
      // Read the live state: Expand all or another tab may have changed it since this panel was built.
      const live = this.owner.settings.expanded;
      this.update({ expanded: live.includes(tag) ? live.filter(t => t !== tag) : [...live, tag] }, 'expand:' + tag);
    });
    panel.createEl('p', { text: entry.description });
    if (entry.aliases.length) panel.createEl('p', { text: entry.aliases.join(' · '), cls: 'tag-ontology-muted' });
    const counts = model.counts(tag);
    panel.createEl('h4', { text: `${counts.direct} direct · ${counts.rollup} including descendants` });
    for (const [label, tags] of [['Parents', entry.broader ?? []], ['Children', model.children.get(tag) ?? []], ['Related', entry.related ?? []]] as const) {
      if (!tags.length) continue;
      const details = panel.createEl('details'); details.open = true; details.createEl('summary', { text: `${label} ${tags.length}` });
      this.tagLinks(details, tags);
    }
    panel.createEl('hr');
    for (const [rollup, label] of [[false, 'Tagged notes'], [true, 'Including descendants']] as const) {
      const details = panel.createEl('details'); details.open = !rollup;
      const paths = model.notesFor(tag, rollup); details.createEl('summary', { text: `${label} (${paths.length})` });
      this.noteLinks(details, paths);
    }
  }

  private inventory(panel: HTMLElement, model: Ontology) {
    panel.createEl('h3', { text: `Not in dictionary (${model.unregistered.size})` });
    panel.createEl('p', { text: 'Compares tags used across the vault with the dictionary. Nothing is added, changed or deleted.' });
    for (const [tag, paths] of model.unregistered) {
      const details = panel.createEl('details'); details.createEl('summary', { text: `#${tag} · ${paths.length} note${paths.length === 1 ? '' : 's'}` });
      this.noteLinks(details, paths);
    }
    const unused = panel.createEl('details'); unused.createEl('summary', { text: `Unused dictionary tags (${model.unused.length})` });
    unused.createEl('p', { text: 'These may be grouping concepts. Unused does not mean they should be deleted.' });
    this.tagLinks(unused, model.unused);
  }

  // Obsidian's own tag style tells tags apart from buttons and note links.
  private tagLinks(parent: HTMLElement, tags: readonly string[]) {
    const list = parent.createDiv('tag-ontology-tags');
    for (const tag of tags) {
      list.createEl('a', { href: '#', text: '#' + tag, cls: 'tag' }).addEventListener('click', e => { e.preventDefault(); this.reveal(tag); });
    }
  }

  private noteLinks(parent: HTMLElement, paths: string[]) {
    const list = parent.createEl('ul');
    for (const path of paths) {
      const link = list.createEl('li').createEl('a', { href: '#', text: path.split('/').at(-1)!.slice(0, -3), attr: { title: path } });
      link.addEventListener('click', e => { e.preventDefault(); this.openNote(path); });
    }
  }
  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    this.label(button, label);
    button.addEventListener('click', action);
    return button;
  }
  private label(button: HTMLElement, text: string) {
    setTooltip(button, text, { placement: 'right' });
    button.setAttribute('aria-label', text);
  }
  // Toolbar state lives in the shared settings so every graph tab shows the same values.
  private syncToolbar(session: Session) {
    const settings = this.owner.settings;
    for (const [key, , name] of TOGGLES) {
      const button = session.toggles[key];
      if (!button) continue;
      const disabled = key === 'showNotes' && settings.layout !== 'force';
      button.toggleClass('is-active', settings[key] && !disabled); button.setAttribute('aria-pressed', String(settings[key] && !disabled));
      button.toggleClass('is-disabled', disabled); button.setAttribute('aria-disabled', String(disabled));
      this.label(button, disabled ? 'Notes are hidden in Tree and Radial' : `${name}: ${settings[key] ? 'shown' : 'hidden'}`);
    }
    for (const [layout] of LAYOUTS) {
      const button = session.layoutButtons[layout];
      button?.toggleClass('is-active', settings.layout === layout); button?.setAttribute('aria-pressed', String(settings.layout === layout));
    }
  }

  private openNote(path: string) {
    const file = this.owner.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('The note was moved or deleted. Reload the dictionary and try again.'); return; }
    void this.owner.app.workspace.getLeaf('tab').openFile(file).catch(error => new Notice(`Could not open the note: ${String(error)}`));
  }

  // Repeats a camera move every frame for two seconds while the force layout settles; any user input stops it.
  private follow(session: Session, move: () => void) {
    session.stopFit();
    const started = performance.now();
    const frame = () => {
      if (!session.active) return;
      move();
      session.fitFrame = performance.now() - started < 2000 ? window.requestAnimationFrame(frame) : undefined;
    };
    session.fitFrame = window.requestAnimationFrame(frame);
  }

  private fit(session: Session) {
    const r = session.renderer;
    if (!r.width || !r.height || !r.nodes.length) return;
    const xs = r.nodes.map(n => n.x), ys = r.nodes.map(n => n.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const scale = Math.min(1.4, r.width * devicePixelRatio / (right - left + 220), r.height * devicePixelRatio / (bottom - top + 220));
    r.targetScale = scale; r.setScale(scale);
    r.setPan(r.width * devicePixelRatio / 2 - (left + right) / 2 * scale, r.height * devicePixelRatio / 2 - (top + bottom) / 2 * scale);
    r.changed();
  }

  private detach(id: WorkspaceLeaf, redraw: boolean) {
    const s = this.sessions.get(id); if (!s) return;
    s.active = false;
    s.stopFit();
    for (const event of ['pointerdown', 'wheel', 'keydown']) s.view.contentEl.removeEventListener(event, s.stopFit, { capture: true });
    if (s.renderer.setData === s.wrapped) s.renderer.setData = s.original;
    if (s.renderer.onNodeClick === s.ownClick) s.renderer.onNodeClick = s.click;
    if (s.renderer.getHighlightNode === s.ownHighlight) s.renderer.getHighlightNode = s.hovered;
    for (const [link, original] of s.links) {
      link.render = original.render;
      if (link.line && original.texture) link.line.texture = original.texture;
    }
    s.texture?.destroy();
    s.tools.remove(); s.status.remove(); s.view.contentEl.removeClass('tag-ontology-native');
    this.sessions.delete(id);
    if (redraw) {
      for (const node of s.renderer.nodes) { node.fx = null; node.fy = null; }
      s.view.update();
    }
  }
  destroy() { for (const id of [...this.sessions.keys()]) this.detach(id, true); }
}
