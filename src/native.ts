import { Modal, Notice, TFile, setIcon, setTooltip, type App, type ItemView, type WorkspaceLeaf } from 'obsidian';
import { treePositions } from './layout.ts';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, type EdgeKind, type NativeData, type NodeColor, type Resolved } from './layer.ts';
import type { Settings } from './settings.ts';
import type { Ontology } from './ontology.ts';
import { TagSuggest } from './search.ts';
import { changedFields, deletionPreview, draftOf, emptyDraft, excluded, nameError, normalizeName, type Change, type Draft, type RawDictionary } from './dictionary.ts';

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
  overlay: HTMLElement; status: HTMLElement;
  // The engine's latest data, already filtered by the core graph; every render layers it again.
  base?: NativeData; resolved?: Resolved;
  // The layered data last sent to the renderer, with the colors it gave each node.
  data?: NativeData;
  kinds: Map<string, EdgeKind>;
  links: Map<NativeLink, { render: () => void; texture?: Texture }>;
  texture?: Texture; layout?: string;
  toggles: Partial<Record<ToggleKey, HTMLElement>>; layoutButtons: Partial<Record<Settings['layout'], HTMLElement>>;
  fitFrame?: number; stopFit: () => void; repin: () => void;
  // Where a tree layout put each node, for a dragged one to return to.
  home: Map<string, { x: number; y: number }>;
}
type LayerSettings = Pick<Settings, 'expanded' | 'showNotes' | 'showRelated' | 'layout'>;
type ToggleKey = 'showNotes' | 'showRelated';
// What the sidebar shows; the back and forward buttons move through these.
type PanelView = { kind: 'roots' } | { kind: 'tag'; tag: string } | { kind: 'check' };
// An open form over the panel. Edits go to the draft; base is the dictionary as it was when the form opened.
// alias: text still in the alias input, not yet added with Enter. open: the field whose input its + opened.
type Mode = ({ kind: 'edit'; tag: string } | { kind: 'new' }) & { base: RawDictionary; draft: Draft; alias?: string; open?: 'aliases' | ListKey };
type ListKey = 'parents' | 'children' | 'related';
const TOGGLES: [ToggleKey, string, string][] = [['showNotes', 'file-text', 'Notes'], ['showRelated', 'link', 'Related']];
const LAYOUTS: [Settings['layout'], string, string][] = [['force', 'share-2', 'Force'], ['tree', 'network', 'Vertical tree'], ['tree-horizontal', 'list-tree', 'Horizontal tree']];
export const PANEL_VIEW = 'tag-ontology-panel';
// The renderer's color format.
const hexColor = (hex: string): NodeColor => ({ a: 1, rgb: parseInt(hex.slice(1), 16) });
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// The draft with the alias still being typed, so typing one and pressing Save keeps it.
function typed(mode: Mode): Draft {
  const alias = mode.alias?.trim();
  return alias && !mode.draft.aliases.includes(alias) ? { ...mode.draft, aliases: [...mode.draft.aliases, alias] } : mode.draft;
}

// A question with a few answers, in the middle of the window like Obsidian's own delete confirmation.
class ChoiceModal extends Modal {
  constructor(app: App, title: string, private lines: string[], private buttons: { text: string; cls?: string; action: () => void }[]) {
    super(app);
    this.titleEl.setText(title);
  }
  onOpen() {
    if (this.lines.length) { const list = this.contentEl.createEl('ul'); for (const line of this.lines) list.createEl('li', { text: line }); }
    const row = this.contentEl.createDiv('modal-button-container');
    for (const { text, cls, action } of this.buttons) row.createEl('button', { text, cls }).addEventListener('click', () => { this.close(); action(); });
  }
  onClose() { this.contentEl.empty(); }
}

export class NativeGraphs {
  private sessions = new Map<WorkspaceLeaf, Session>();
  private failed = new WeakSet<WorkspaceLeaf>();
  // One sidebar panel serves every graph tab: a tag's details, the dictionary check, or the root tags until either is chosen.
  private panel?: HTMLElement;
  private history: PanelView[] = [{ kind: 'roots' }]; private at = 0;
  private nav: Partial<Record<'back' | 'forward' | 'home' | 'add' | 'edit' | 'expand', HTMLButtonElement>> = {};
  private mode?: Mode; private saving = false; private searchBox?: HTMLInputElement;
  // Updates the open form's count line and Save button in place.
  private syncForm = () => {};
  metrics: { operation: string; ms: number; nodes: number; visible: boolean }[] = [];
  constructor(private owner: TagOntologyPlugin) {}

  private get selected() { const view = this.history[this.at]; return view.kind === 'tag' ? view.tag : undefined; }
  private get checking() { return this.history[this.at].kind === 'check'; }
  // Like a browser: a new view drops the forward entries.
  private go(view: PanelView) {
    if (JSON.stringify(view) === JSON.stringify(this.history[this.at])) return;
    this.history = [...this.history.slice(0, this.at + 1), view]; this.at = this.history.length - 1;
  }
  private step(by: number) {
    this.leave(() => { this.at = Math.min(Math.max(this.at + by, 0), this.history.length - 1); this.showSelection(); });
  }
  // Every way to show something else in the sidebar goes through here, so an open form is never left behind.
  // Unsaved edits are only dropped when the user says so.
  private leave(next: () => void) {
    const mode = this.mode, changes = mode?.kind === 'edit' ? changedFields(mode.base, mode.tag, typed(mode)) : 0;
    if (mode?.kind !== 'edit' || !changes) { this.mode = undefined; next(); return; }
    new ChoiceModal(this.owner.app, `${count(changes, 'change', 'changes')} to #${mode.tag} ${changes === 1 ? 'is' : 'are'} not saved`, [], [
      { text: 'Keep editing', action: () => {} },
      { text: 'Discard', action: () => { this.mode = undefined; next(); } },
      { text: 'Save', cls: 'mod-cta', action: () => { void this.save().then(saved => { if (saved) next(); }); } },
    ]).open();
  }

  attach() {
    const leaves = this.owner.app.workspace.getLeavesOfType('graph');
    for (const [id, session] of this.sessions) {
      if (!leaves.includes(session.leaf) || session.leaf.view !== session.view) this.detach(id, false);
    }
    if (!this.owner.model) return;
    for (const leaf of leaves) {
      // A background tab is restored as a placeholder with no renderer yet; the layout change that loads it attaches it.
      if (this.sessions.has(leaf) || this.failed.has(leaf) || leaf.isDeferred) continue;
      const view = leaf.view as unknown as NativeView, r = view.renderer;
      if (!r || typeof r.setData !== 'function' || typeof r.onNodeClick !== 'function'
        || !r.worker || !Array.isArray(r.nodes) || !Array.isArray(r.links)) {
        new Notice('Could not attach to the core graph in this Obsidian version.');
        this.failed.add(leaf);
        continue;
      }
      // The toolbar and the status line share one column, so a status line that wraps pushes the buttons up instead of covering them.
      const overlay = view.contentEl.createDiv('tag-ontology-overlay'), tools = overlay.createDiv('tag-ontology-tools');
      const status = overlay.createDiv('tag-ontology-status'); status.setAttribute('role', 'status');
      const session: Session = {
        leaf, view, renderer: r, active: true, original: r.setData, wrapped: () => {},
        click: r.onNodeClick, hovered: r.getHighlightNode, overlay, status, kinds: new Map(), links: new Map(), toggles: {}, layoutButtons: {}, stopFit: () => {}, repin: () => {}, home: new Map(),
      };
      session.stopFit = () => { if (session.fitFrame !== undefined) window.cancelAnimationFrame(session.fitFrame); session.fitFrame = undefined; };
      for (const event of ['pointerdown', 'wheel', 'keydown']) view.contentEl.addEventListener(event, session.stopFit, { capture: true });
      // On release the core graph unpins the node under the pointer (its window listener runs first), and the drag has
      // restarted its simulation, which would then carry the node off. The tree layouts pin it again and ease it back to
      // its place with a slight overshoot, like a spring; grabbing it again stops that.
      // ponytail: a release outside the graph pane is missed; listen on window if that matters.
      session.repin = () => {
        if (!session.active || this.owner.settings.layout === 'force') return;
        const released = r.nodes.filter(node => node.fx === null).map(node => ({ node, x: node.x, y: node.y, home: session.home.get(node.id) ?? node }));
        if (!released.length) return;
        r.worker.postMessage({ run: false });
        for (const { node } of released) { node.fx = node.x; node.fy = node.y; }
        this.follow(session, progress => {
          const k = 1 + 2.2 * (progress - 1) ** 3 + 1.2 * (progress - 1) ** 2;
          for (const { node, x, y, home } of released) {
            node.x = node.fx = progress < 1 ? x + (home.x - x) * k : home.x;
            node.y = node.fy = progress < 1 ? y + (home.y - y) * k : home.y;
          }
          r.changed();
        }, 450);
      };
      view.contentEl.addEventListener('pointerup', session.repin);
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
        const tag = session.active ? session.resolved?.tagOf.get(id) : undefined;
        if (!tag) { session.click.call(r, event, id, type); return; }
        this.leave(() => {
          this.go({ kind: 'tag', tag });
          // Clicking only ever expands; collapsing stays explicit so reopening a panel never hides nodes.
          if (!this.owner.settings.expanded.includes(tag)) this.update({ expanded: [...this.owner.settings.expanded, tag] }, 'expand:' + tag);
          else this.showSelection();
          this.showPanel(true);
        });
      };
      // Node and link drawing fade everything not linked to this node; with focus on, the selected tag counts as hovered when nothing else is.
      session.ownHighlight = r.getHighlightNode = () => session.hovered.call(r) || session.focus || null;
      // A column of round icon buttons keeps the core graph settings on the right uncovered.
      this.iconButton(tools, 'chevrons-down-up', 'Collapse all', () => this.update({ expanded: [] }, 'roots'));
      this.iconButton(tools, 'chevrons-up-down', 'Expand all', () => this.update({ expanded: [...this.owner.model!.entries.keys()] }, 'expand-all'));
      this.iconButton(tools, 'scan', 'Fit', () => this.fit(session));
      tools.createDiv('tag-ontology-separator');
      for (const [key, icon, name] of TOGGLES) {
        session.toggles[key] = this.iconButton(tools, icon, name, () => {
          if (key === 'showNotes' && this.owner.settings.layout !== 'force') return;
          this.update({ [key]: !this.owner.settings[key] }, 'filter');
        });
        session.toggles[key].addClass('tag-ontology-toggle');
      }
      tools.createDiv('tag-ontology-separator');
      this.iconButton(tools, 'book-open-check', 'Dictionary check', () => this.leave(() => { this.go({ kind: 'check' }); this.renderPanel(); this.showPanel(true); }));
      tools.createDiv('tag-ontology-separator');
      for (const [layout, icon, name] of LAYOUTS) {
        session.layoutButtons[layout] = this.iconButton(tools, icon, `Layout: ${name}`, () => {
          if (this.owner.settings.layout !== layout) this.update({ layout }, 'layout');
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

  // Note edits only change counts and note lists; the core graph re-sends its own data for them, so only redraw for the dictionary or settings.
  refresh(redraw = true) {
    this.attach();
    const model = this.owner.model!, settings = this.owner.settings;
    const kept = settings.expanded.filter(tag => model.entries.has(tag));
    if (kept.length !== settings.expanded.length) { settings.expanded = kept; void this.owner.saveState(); }
    if (redraw) for (const session of this.sessions.values()) this.render(session, 'refresh');
    this.renderPanel();
  }

  // Called by the sidebar view whenever Obsidian opens it.
  mount(el: HTMLElement) {
    el.empty(); el.addClass('tag-ontology-sidebar');
    const bar = el.createDiv('tag-ontology-nav');
    this.nav.back = this.navButton(bar, 'arrow-left', 'Back', () => this.step(-1));
    this.nav.forward = this.navButton(bar, 'arrow-right', 'Forward', () => this.step(1));
    this.nav.home = this.navButton(bar, 'home', 'Home', () => this.leave(() => { this.go({ kind: 'roots' }); this.showSelection(); }));
    bar.createDiv('tag-ontology-spacer');
    this.nav.add = this.navButton(bar, 'plus', 'New tag', () => this.mode?.kind === 'new' ? this.cancel() : this.leave(() => this.startNew()));
    this.nav.edit = this.navButton(bar, 'pencil', 'Edit tag', () => this.mode?.kind === 'edit' ? this.cancel() : this.leave(() => this.startEdit()));
    this.nav.expand = this.navButton(bar, 'circle-small', 'Expand in graph', () => {
      const tag = this.selected;
      if (!tag) return;
      // Read the live state: Expand all or another tab may have changed it since the bar was drawn.
      const live = this.owner.settings.expanded;
      this.update({ expanded: live.includes(tag) ? live.filter(t => t !== tag) : [...live, tag] }, 'expand:' + tag);
    });
    this.nav.expand.addClass('tag-ontology-expand');
    const search = this.searchBox = el.createEl('input', { type: 'search', placeholder: 'Search tags or aliases', attr: { 'aria-label': 'Search tags or aliases' } });
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
    // Obsidian mounts again when the tab is reopened; an open form comes back with it.
    if (this.mode) this.drawForm(); else this.renderPanel();
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
    // The tree layouts show the tag hierarchy alone; the saved Notes choice applies again in Force.
    const layer = buildLayer(session.base, model, { expanded: new Set(settings.expanded), showNotes: settings.showNotes && settings.layout === 'force', showRelated: settings.showRelated,
      tagColor: settings.customColors ? hexColor(settings.tagColor) : undefined });
    session.resolved = layer.resolved; session.kinds = layer.kinds;
    const r = session.renderer, result = session.original.call(r, layer.data);
    session.data = layer.data; this.paint(session);
    this.styleLinks(session);
    if (settings.layout !== 'force') this.staticLayout(session);
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
    const notes = Object.values(layer.data.nodes).filter(n => n.type !== 'tag').length;
    // The core graph's Tags filter is off by default, which leaves nothing to layer the dictionary onto.
    const tagsShown = Object.values(session.base.nodes).some(n => n.type === 'tag');
    session.status.textContent = tagsShown
      ? `${layer.resolved.visible.size} / ${model.placed.size} tags · ${notes} notes · ${model.roots.length} roots`
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
      // A link keeps its endpoints, so build the key once instead of on every frame.
      const key = edgeKey(link.source.id, link.target.id);
      link.render = () => {
        if (!original.texture && link.line) original.texture = link.line.texture;
        const kind = session.kinds.get(key);
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

  private staticLayout(session: Session) {
    const r = session.renderer, model = this.owner.model!, { visible, idOf } = session.resolved!;
    const ids = [...visible].map(tag => idOf.get(tag)!), inTree = new Set(ids);
    const edges = [...visible].flatMap(tag => (model.entries.get(tag)!.broader ?? []).filter(parent => visible.has(parent))
      .map(parent => [idOf.get(parent)!, idOf.get(tag)!] as [string, string]));
    // Notes are hidden here, so the only other nodes are tags the hierarchy doesn't place; the layout puts them in its corner.
    const positions = treePositions(ids, edges, this.owner.settings.layout === 'tree-horizontal', r.nodes.map(node => node.id).filter(id => !inTree.has(id)));
    r.worker.postMessage({ run: false }); r.workerResults = null; session.home.clear();
    for (const node of r.nodes) {
      const p = positions.get(node.id)!;
      // The renderer treats fx = 0 as unpinned, so keep coordinates off exact zero.
      node.x = p.x + .01; node.y = p.y + .01; session.home.set(node.id, { x: node.x, y: node.y });
      node.fx = node.x; node.fy = node.y;
    }
    r.changed();
  }

  private reveal(tag: string) {
    if (this.mode) { this.leave(() => this.reveal(tag)); return; }
    // Suggestions can outlive a dictionary reload that removed the tag.
    if (!this.owner.model?.entries.has(tag)) { new Notice('That tag is no longer in the dictionary.'); return; }
    this.go({ kind: 'tag', tag });
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
      ...settings.highlightConnected ? [...entry.broader ?? [], ...model.children.get(tag) ?? [], ...model.related(tag)] : [],
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

  renderPanel() {
    this.syncNav();
    // An open form is never rebuilt here: refreshes come with every note edit and would drop what is being typed.
    if (this.mode) return;
    const panel = this.panel, model = this.owner.model, error = this.owner.error;
    if (!panel) return;
    if (this.missing()) { panel.empty(); this.notFound(panel); return; }
    if (!model && !error) return;
    panel.empty();
    if (error) this.loadError(panel, error);
    if (!model) return;
    panel.setCssProps({ '--tag-ontology-color': this.owner.settings.highlightColor });
    if (this.checking) this.inventory(panel, model);
    else if (this.selected && model.entries.has(this.selected)) this.inspect(panel, model, this.selected);
    else { panel.createEl('h4', { text: `Root tags (${model.roots.length})` }); this.tagLinks(panel, model.roots); }
  }

  private missing() {
    return !(this.owner.app.vault.getAbstractFileByPath(this.owner.settings.dictionaryPath) instanceof TFile);
  }

  // Creating is left to the user: a file that is still syncing looks missing too, and it shows up here on its own when it arrives.
  private notFound(panel: HTMLElement) {
    panel.createEl('h4', { text: 'Tag dictionary not found' });
    panel.createEl('p', { text: `${this.owner.settings.dictionaryPath} is not in the vault. If the vault is still syncing, the dictionary appears here once the file arrives. You can change the path in the plugin settings.` });
    const create = panel.createEl('button', { text: 'Create empty dictionary', cls: 'mod-cta' });
    create.addEventListener('click', () => { create.disabled = true; void this.owner.createDictionary().finally(() => { create.disabled = false; }); });
  }

  // A dictionary that stops loading leaves the last version that loaded on show, under the reason; fixing the file reloads it.
  private loadError(panel: HTMLElement, error: string) {
    panel.createEl('h4', { text: 'Could not load the tag dictionary' });
    panel.createEl('p', { text: error, cls: 'tag-ontology-error' });
    const shown = this.owner.model ? 'The graph and this panel show the last version that loaded. ' : '';
    panel.createEl('p', { text: `${shown}Fix the file and this updates on its own. New tag and Edit tag are off until then.`, cls: 'tag-ontology-muted' });
    if (this.owner.model) panel.createEl('hr');
  }

  private inspect(panel: HTMLElement, model: Ontology, tag: string) {
    const entry = model.entries.get(tag)!;
    const header = panel.createDiv('tag-ontology-header');
    const { customColors, titleAccent } = this.owner.settings;
    header.createEl('h3', { text: tag, cls: customColors && titleAccent ? 'tag-ontology-accent' : undefined });
    panel.createEl('p', { text: entry.description });
    if (entry.aliases.length) panel.createEl('p', { text: entry.aliases.join(' · '), cls: 'tag-ontology-muted' });
    const counts = model.counts(tag);
    panel.createEl('h4', { text: `${counts.direct} direct · ${counts.rollup} including descendants` });
    for (const [label, tags] of [['Parents', entry.broader ?? []], ['Children', model.children.get(tag) ?? []], ['Related', model.related(tag)]] as const) {
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
  private startEdit() {
    const tag = this.selected, raw = this.owner.raw;
    if (!tag || !raw || !Object.hasOwn(raw, tag)) return;
    const base = structuredClone(raw);
    this.mode = { kind: 'edit', tag, base, draft: draftOf(base, tag) };
    this.drawForm();
  }

  private cancel() {
    this.leave(() => this.showSelection());
  }

  private confirmDelete() {
    const mode = this.mode, model = this.owner.model;
    if (mode?.kind !== 'edit' || !model) return;
    const { tag, base } = mode, { parents, children, roots, related } = deletionPreview(base, tag), notes = model.counts(tag).direct;
    const tags = (list: string[]) => list.map(item => '#' + item).join(', ');
    const lines = [
      ...children.length && parents.length ? [`${count(children.length, 'child moves', 'children move')} under ${tags(parents)}`] : [],
      ...roots.length && !parents.length ? [count(roots.length, 'child becomes a root tag', 'children become root tags')] : [],
      ...related.length ? [`Removed from related of ${tags(related)}`] : [],
      ...notes ? [`${count(notes, 'note keeps', 'notes keep')} #${tag}; it will show as not in the dictionary.`] : [],
    ];
    new ChoiceModal(this.owner.app, `Delete #${tag}?`, lines, [
      { text: 'Cancel', action: () => {} },
      { text: 'Delete', cls: 'mod-warning', action: () => { void this.remove(tag, base, parents); } },
    ]).open();
  }

  // Deleting writes at once: a deleted tag has no draft to keep.
  private async remove(tag: string, base: RawDictionary, parents: string[]) {
    if (this.saving) return;
    this.saving = true; this.syncForm();
    try {
      if (!await this.owner.saveChange({ kind: 'delete', tag }, base)) return;
      this.mode = undefined;
      // The deleted tag leaves the history, and so do the neighbors that would then repeat.
      const kept = this.history.slice(0, this.at + 1).filter(view => !(view.kind === 'tag' && view.tag === tag));
      this.history = kept.filter((view, i) => !i || JSON.stringify(view) !== JSON.stringify(kept[i - 1]));
      if (!this.history.length) this.history = [{ kind: 'roots' }];
      this.at = this.history.length - 1;
      this.go(parents[0] ? { kind: 'tag', tag: parents[0] } : { kind: 'roots' });
      this.showSelection();
      await this.owner.reload();
    } finally { this.saving = false; this.syncForm(); }
  }

  private startNew() {
    const raw = this.owner.raw;
    if (!raw) return;
    const base = structuredClone(raw);
    this.mode = { kind: 'new', base, draft: emptyDraft() };
    this.drawForm();
  }

  private drawForm() {
    const panel = this.panel, mode = this.mode, model = this.owner.model;
    if (!panel || !mode || !model) return;
    panel.empty(); this.syncNav();
    const { base, draft } = mode, tag = mode.kind === 'edit' ? mode.tag : undefined, form = panel.createDiv('tag-ontology-form');
    if (tag === undefined) form.createEl('h3', { text: 'New tag' });
    form.createEl('label', { text: 'Name' });
    const name = form.createEl('input', { type: 'text', attr: { 'aria-label': 'Name' } });
    name.value = draft.name;
    const note = form.createDiv();
    name.addEventListener('input', () => { draft.name = normalizeName(name.value); this.syncForm(); });
    if (tag === undefined) {
      // Tags already used in notes come first, the most used at the top.
      new TagSuggest(this.owner.app, name, query => [...model.unregistered]
        .filter(([item]) => item.toLowerCase().includes(query.trim().toLowerCase()))
        .sort(([a, left], [b, right]) => right.length - left.length || a.localeCompare(b)).slice(0, 10)
        .map(([item, paths]) => ({ tag: item, notes: paths.length })), chosen => { name.value = draft.name = chosen; this.syncForm(); });
      name.addEventListener('focus', () => { if (!name.value) name.dispatchEvent(new Event('input')); });
    }
    const describe = () => {
      form.createEl('label', { text: 'Description' });
      const description = form.createEl('textarea', { attr: { 'aria-label': 'Description', rows: '3', ...tag === undefined ? { placeholder: 'Optional' } : {} } });
      description.value = draft.description;
      description.addEventListener('input', () => { draft.description = description.value; this.syncForm(); });
    };
    const aliases = () => {
      form.createEl('label', { text: 'Aliases' });
      const list = this.chips(form, draft.aliases, item => item, item => { draft.aliases = draft.aliases.filter(a => a !== item); });
      if (!this.opener(list, 'aliases', 'Add an alias')) return;
      const alias = form.createEl('input', { type: 'text', attr: { placeholder: 'Add an alias' } });
      alias.value = mode.alias ?? '';
      alias.addEventListener('input', () => { mode.alias = alias.value; this.syncForm(); });
      alias.addEventListener('keydown', e => {
        const value = alias.value.trim();
        if (e.key !== 'Enter' || e.isComposing || !value) return;
        if (!draft.aliases.includes(value)) draft.aliases = [...draft.aliases, value];
        mode.alias = '';
        this.drawForm();
      });
      alias.focus();
    };
    const list = (kind: ListKey, label: string, placeholder: string) => { form.createEl('label', { text: label }); this.picker(form, kind, placeholder); };
    if (tag === undefined) {
      list('parents', 'Parents', 'Add a parent');
      if (!draft.parents.length) form.createDiv({ cls: 'tag-ontology-hint', text: 'No parent: it becomes a root tag.' });
      describe(); aliases();
    } else {
      describe(); aliases();
      list('parents', 'Parents', 'Add a parent'); list('children', 'Children', 'Add a child'); list('related', 'Related', 'Add a related tag');
    }
    const status = panel.createDiv('tag-ontology-count'), footer = panel.createDiv('tag-ontology-footer');
    if (tag !== undefined) footer.createEl('button', { text: 'Delete', cls: 'mod-warning' }).addEventListener('click', () => this.confirmDelete());
    footer.createDiv('tag-ontology-spacer');
    footer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.cancel());
    const save = footer.createEl('button', { text: tag === undefined ? 'Add' : 'Save', cls: 'mod-cta' });
    save.addEventListener('click', () => { void this.save(); });
    const notes = tag === undefined ? 0 : model.counts(tag).direct;
    this.syncForm = () => {
      // A new tag's empty name is not an error yet, only not ready.
      // An unchanged name is never an error, so a key written before these rules can still be edited.
      const error = tag === undefined ? draft.name ? nameError(draft.name, base) : undefined : draft.name === tag ? undefined : nameError(draft.name, base, tag);
      const changes = tag === undefined ? 0 : changedFields(base, tag, typed(mode));
      // Notes match dictionary tags ignoring case, so a case-only rename keeps them.
      const hint = tag === undefined ? 'Pick one, or type a new name.'
        : draft.name.toLowerCase() !== tag.toLowerCase() && notes ? `${notes} note${notes === 1 ? ' uses' : 's use'} #${tag}. ${notes === 1 ? 'It keeps' : 'They keep'} it and it will show as not in the dictionary.` : '';
      note.toggleClass('tag-ontology-error', !!error); note.toggleClass('tag-ontology-hint', !error);
      note.setText(error ?? hint);
      status.setText(`${count(changes, 'change', 'changes')} not saved`); status.hidden = !changes;
      save.disabled = (tag === undefined ? !draft.name : !changes) || !!error || this.saving;
    };
    this.syncForm();
  }

  // Tags use Obsidian's tag style, which it gives to links only.
  private chips(parent: HTMLElement, items: string[], text: (item: string) => string, remove: (item: string) => void, asTag = false): HTMLElement {
    const list = parent.createDiv('tag-ontology-tags');
    for (const item of items) {
      const chip = asTag ? list.createEl('a', { text: text(item), cls: 'tag tag-ontology-chip' }) : list.createSpan({ text: text(item), cls: 'tag-ontology-chip' });
      const button = chip.createEl('button', { cls: 'clickable-icon tag-ontology-remove', attr: { 'aria-label': `Remove ${text(item)}` } });
      setIcon(button, 'x');
      button.addEventListener('click', () => { remove(item); this.drawForm(); });
    }
    return list;
  }

  // Only dictionary tags can be linked, and never one that would make a cycle.
  // A field's input stays out of the way until the + after its last item is pressed, and stays open while items are added one after another.
  private opener(list: HTMLElement, key: 'aliases' | ListKey, placeholder: string): boolean {
    const mode = this.mode!, open = mode.open === key;
    const add = list.createEl('button', { cls: 'clickable-icon tag-ontology-add', attr: { 'aria-label': placeholder } });
    setIcon(add, 'plus'); add.toggleClass('is-active', open);
    add.addEventListener('click', () => {
      mode.open = open ? undefined : key;
      // A closed alias input leaves nothing half typed behind to count as a change.
      if (mode.open !== 'aliases') mode.alias = '';
      this.drawForm();
    });
    return open;
  }

  private picker(parent: HTMLElement, kind: ListKey, placeholder: string) {
    const mode = this.mode!;
    const list = this.chips(parent, mode.draft[kind], tag => '#' + tag, tag => { mode.draft[kind] = mode.draft[kind].filter(t => t !== tag); }, true);
    if (!this.opener(list, kind, placeholder)) return;
    const input = parent.createEl('input', { type: 'text', attr: { placeholder } });
    new TagSuggest(this.owner.app, input, query => {
      const skip = mode.kind === 'edit' ? excluded(mode.base, mode.tag, mode.draft, kind) : new Set(mode.draft[kind]);
      // The model can already hold tags added to the file after the form opened; the draft only knows the base.
      return (this.owner.model?.suggest(query, 50) ?? []).filter(s => Object.hasOwn(mode.base, s.tag) && !skip.has(s.tag)).slice(0, 10);
    }, tag => { mode.draft[kind] = [...mode.draft[kind], tag]; this.drawForm(); });
    input.focus();
  }

  // Saves the open form; false leaves it open with the draft for another try.
  private async save(): Promise<boolean> {
    const mode = this.mode;
    if (!mode || this.saving) return false;
    this.saving = true; this.syncForm();
    try {
      const { base } = mode, draft = typed(mode), name = draft.name, tag = mode.kind === 'edit' ? mode.tag : name;
      // The dialog's Save reaches here without the form's checks.
      const error = mode.kind === 'edit' && name === mode.tag ? undefined : nameError(name, base, mode.kind === 'edit' ? mode.tag : undefined);
      if (error) { new Notice(error); return false; }
      const change: Change = mode.kind === 'edit' ? { kind: 'edit', tag, draft } : { kind: 'add', draft };
      if (!await this.owner.saveChange(change, base)) return false;
      if (name !== tag) {
        this.owner.settings.expanded = this.owner.settings.expanded.map(t => t === tag ? name : t); void this.owner.saveState();
        this.history = this.history.map(view => view.kind === 'tag' && view.tag === tag ? { kind: 'tag', tag: name } : view);
      }
      this.mode = undefined;
      this.go({ kind: 'tag', tag: name });
      this.showSelection();
      await this.owner.reload();
      return true;
    } finally { this.saving = false; this.syncForm(); }
  }

  private navButton(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon' });
    setIcon(button, icon);
    setTooltip(button, label, { placement: 'bottom' });
    button.addEventListener('click', () => { if (!button.disabled) action(); });
    return button;
  }
  private syncNav() {
    const { back, forward, add, edit, expand } = this.nav;
    if (!back || !forward || !add || !edit || !expand) return;
    // Searching would only leave the form, so the box steps aside while one is open.
    if (this.searchBox) this.searchBox.hidden = !!this.mode;
    const disable = (button: HTMLButtonElement, off: boolean) => { button.disabled = off; button.setAttribute('aria-disabled', String(off)); };
    disable(back, this.at === 0); disable(forward, this.at === this.history.length - 1);
    const tag = this.selected && this.owner.model?.entries.has(this.selected) ? this.selected : undefined;
    const expanded = tag !== undefined && this.owner.settings.expanded.includes(tag);
    // The icon shows the tag's state in the graph; the button keeps the accent color whenever it can be used.
    disable(expand, !tag); expand.toggleClass('is-active', !!tag);
    // Forms start from the last dictionary that loaded, so they wait while the file is missing or broken.
    const blocked = this.missing() || this.owner.error !== undefined;
    disable(add, !this.owner.model || blocked); add.toggleClass('is-active', this.mode?.kind === 'new');
    disable(edit, !tag || blocked); edit.toggleClass('is-active', this.mode?.kind === 'edit');
    setIcon(expand, expanded ? 'waypoints' : 'circle-small');
    setTooltip(expand, expanded ? 'Collapse in graph' : 'Expand in graph', { placement: 'bottom' });
  }
  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    this.label(button, label);
    button.addEventListener('click', action);
    return button;
  }
  // setTooltip also sets aria-label, which screen readers and the tests use.
  private label(button: HTMLElement, text: string) {
    setTooltip(button, text, { placement: 'right' });
  }
  // Toolbar state lives in the shared settings so every graph tab shows the same values.
  private syncToolbar(session: Session) {
    const settings = this.owner.settings;
    for (const [key, , name] of TOGGLES) {
      const button = session.toggles[key];
      if (!button) continue;
      const disabled = key === 'showNotes' && settings.layout !== 'force';
      button.toggleClass('is-active', settings[key] && !disabled); button.setAttribute('aria-pressed', String(settings[key] && !disabled));
      button.setAttribute('aria-disabled', String(disabled));
      this.label(button, disabled ? 'Notes are hidden in tree layouts' : `${name}: ${settings[key] ? 'shown' : 'hidden'}`);
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

  // Repeats a move every frame for a while (two seconds while the force layout settles) and passes how far along it is,
  // ending on 1; any user input stops it.
  private follow(session: Session, move: (progress: number) => void, ms = 2000) {
    session.stopFit();
    const started = performance.now();
    const frame = () => {
      if (!session.active) return;
      const progress = Math.min(1, (performance.now() - started) / ms);
      move(progress);
      session.fitFrame = progress < 1 ? window.requestAnimationFrame(frame) : undefined;
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
    s.view.contentEl.removeEventListener('pointerup', s.repin);
    if (s.renderer.setData === s.wrapped) s.renderer.setData = s.original;
    if (s.renderer.onNodeClick === s.ownClick) s.renderer.onNodeClick = s.click;
    if (s.renderer.getHighlightNode === s.ownHighlight) s.renderer.getHighlightNode = s.hovered;
    for (const [link, original] of s.links) {
      link.render = original.render;
      if (link.line && original.texture) link.line.texture = original.texture;
    }
    s.texture?.destroy();
    s.overlay.remove(); s.view.contentEl.removeClass('tag-ontology-native');
    this.sessions.delete(id);
    if (redraw) {
      for (const node of s.renderer.nodes) { node.fx = null; node.fy = null; }
      s.view.update();
    }
  }
  destroy() { for (const id of [...this.sessions.keys()]) this.detach(id, true); }
}
