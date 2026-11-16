import { MindMap, type MindMapData } from './mindmap.ts';
import { mindmapPositions } from './mindmap-layout.ts';
import { renderDepthLegend } from './legend.ts';
import { graphModeBar, modeEnabled, type GraphMode } from './graph-modes.ts';
import { Graph3DCanvas } from './graph3d.ts';
import { ExplorerCanvas } from './explorer.ts';
import { ItemView, Modal, Notice, TFile, setIcon, setTooltip, type App, type WorkspaceLeaf } from 'obsidian';
import { treePositions } from './layout.ts';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, focusIds, type EdgeKind, type NativeData, type NodeColor, type Resolved } from './layer.ts';
import type { Settings } from './settings.ts';
import { TagSuggest } from './search.ts';
import { groupNonCanonical, groupRedundant } from './check.ts';
import { TAKE_OUT, relativeTime, tagsOfNote } from './explorer-layout.ts';
import { changedFields, deletionPreview, draftOf, emptyDraft, excluded, isKebabName, nameError, normalizeName, type Change, type Draft, type Ontology, type RawDictionary } from 'tag-ontology';

interface Texture { constructor: { from(canvas: HTMLCanvasElement): Texture }; destroy(): void }
interface NativeLink {
  source: { id: string }; target: { id: string };
  line?: { texture: Texture }; render: () => void;
}
interface NativeRenderer {
  setData: (data: NativeData) => unknown;
  onNodeClick: (event: MouseEvent, id: string, type: string) => void;
  changed(): void; resetPan(): void;
  width: number; height: number; scale: number; targetScale: number; panX?: number; panY?: number;
  setScale(scale: number): void; setPan(x: number, y: number): void;
  fShowArrow: boolean;
  getHighlightNode: () => unknown;
  worker: { postMessage: (message: Record<string, unknown>) => void };
  workerResults: unknown;
  nodes: { id: string; x: number; y: number; fx: number | null; fy: number | null; color: unknown; render?: () => void; getSize?: () => number }[];
  links: NativeLink[];
}
type RendererNode = NativeRenderer['nodes'][number];
interface GraphEngine { getOptions(): Record<string, unknown>; setOptions(options: Record<string, unknown>): void; onOptionsChange(): void }
interface NativeView extends ItemView { renderer: NativeRenderer; dataEngine?: GraphEngine; update(): void }
interface Session {
  leaf: WorkspaceLeaf; view: NativeView; renderer: NativeRenderer; active: boolean;
  original: NativeRenderer['setData']; wrapped: NativeRenderer['setData'];
  click: NativeRenderer['onNodeClick']; ownClick?: NativeRenderer['onNodeClick'];
  hovered: NativeRenderer['getHighlightNode']; ownHighlight?: NativeRenderer['getHighlightNode'];
  // What Focus keeps bright, the selected tag's node, and what getHighlightNode() answers for the node or link drawing now.
  focusIds?: Set<string>; focusNode?: RendererNode; drawing?: unknown;
  overlay: HTMLElement; status: HTMLElement; legend: HTMLElement; mindmap?: MindMap; mindmapAnchor?: string; mindmapRoot?: string;
  // The engine's latest data, already filtered by the core graph; every render layers it again.
  base?: NativeData; resolved?: Resolved;
  // The layered data last sent to the renderer, with the colors it gave each node.
  data?: NativeData;
  kinds: Map<string, EdgeKind>;
  links: Map<NativeLink, { render: () => void; texture?: Texture }>;
  nodeRenders: Map<RendererNode, () => void>;
  texture?: Texture; layout?: string;
  pendingRender?: boolean;
  staticPositions?: { key: string; positions: Map<string, { x: number; y: number }> };
  choice: Settings['layout']; mindmapExpanded: string[];
  viewports: Map<Settings['layout'], { scale: number; targetScale: number; x: number; y: number; positions: Map<string, { x: number; y: number }> }>;
  toggles: Partial<Record<ToggleKey, HTMLElement>>;
  mode: '2d' | '3d' | 'explorer'; nativePaused?: boolean; syncModes(): void;
  canvases: Map<'3d' | 'explorer', { root: HTMLElement; graph: Graph3DCanvas | ExplorerCanvas; ready: Promise<void> }>;
  // The tag the last click picked, and when the first press of the current click sequence began.
  lastTag?: { tag: string; at: number }; firstDown?: number; pressCount: number;
  press: (event: MouseEvent) => void; double: () => void;
  fitFrame?: number; stopFit: () => void; stopInput: () => void; repin: () => void; grab: () => void;
  // Where a tree layout put each node, for a dragged one to return to.
  home: Map<string, { x: number; y: number }>;
}
type LayerSettings = Pick<Settings, 'expanded' | 'showNotes' | 'showRelated' | 'layout'>;
type ToggleKey = 'showNotes' | 'showRelated';
// What the sidebar shows; the back and forward buttons move through these.
type PanelView = { kind: 'roots' } | { kind: 'tag'; tag: string } | { kind: 'check' } | { kind: 'note'; path: string } | { kind: 'group'; tag: string; source?: ExplorerPanel };
// An open form over the panel. Edits go to the draft; base is the dictionary as it was when the form opened.
// alias: text still in the alias input, not yet added with Enter. open: the field whose input its + opened.
// query: text typed in an open parent, child or related input, so a redraw keeps it.
type Mode = ({ kind: 'edit'; tag: string } | { kind: 'new' }) & { base: RawDictionary; draft: Draft; alias?: string; query?: string; open?: 'aliases' | ListKey };
type ListKey = 'parents' | 'children' | 'related';
const TOGGLES: [ToggleKey, string, string][] = [['showNotes', 'file-text', 'Notes'], ['showRelated', 'link', 'Related']];
export const PANEL_VIEW = 'tag-ontology-panel';
// The explorer, for the sidebar's view of one of its note groups: the notes it holds, newest first, and taking some out.
export interface ExplorerPanel { groupNotes(tag: string): { path: string; mtime: number }[] | undefined; takeOut(tag: string, paths: string[]): void }
// A graph NativeGraphs drives besides the core graph tabs (the 3D view): it layers the shared state itself.
export interface LinkedGraph {
  isVisible?(): boolean;
  // Layer again; 'refresh' also rebuilds the graph's own data, as nothing else tells it about note edits.
  draw(operation: string): void;
  // The selection or what Focus keeps bright changed.
  paint(): void;
  // The tag is in this graph's part of the hierarchy.
  has(tag: string): boolean;
  // Bring a tag the sidebar revealed into view.
  focusOn(tag: string): void;
  // A tag was renamed in the editor; called before the reload, which would otherwise look like the tag going.
  renamed?(from: string, to: string): void;
}
// Two clicks on the same tag within this many milliseconds make a double click.
export const DOUBLE_CLICK_MS = 200;
// Stands in for the highlighted node while Focus fades something: no node links to this id.
const FADED = { id: '\0focus' };

// How far in from each side of a graph view the controls drawn over it reach, in CSS pixels plus a gap: the toolbar column on
// the left, the legend and status line at the bottom, and the settings buttons or panel on the right. Fits use the rest.
export function coveredEdges(view: HTMLElement) {
  const box = view.getBoundingClientRect(), gap = 12, edge = { left: 0, right: 0, bottom: 0 };
  for (const el of Array.from(view.querySelectorAll('.tag-ontology-tools > *'))) {
    const rect = el.getBoundingClientRect();
    if (rect.width) edge.left = Math.max(edge.left, rect.right - box.left + gap);
  }
  for (const el of Array.from(view.querySelectorAll('.tag-ontology-legend, .tag-ontology-status'))) {
    const rect = el.getBoundingClientRect();
    if (rect.height) edge.bottom = Math.max(edge.bottom, box.bottom - rect.top + gap);
  }
  for (const el of Array.from(view.querySelectorAll('.graph-controls'))) {
    const rect = el.getBoundingClientRect();
    if (rect.width) edge.right = Math.max(edge.right, box.right - rect.left + gap);
  }
  return edge;
}
export type CoveredEdges = ReturnType<typeof coveredEdges>;

const sameSet = (a?: Set<string>, b?: Set<string>) => a === b || (!!a && !!b && a.size === b.size && [...a].every(id => b.has(id)));
// The renderer's color format. The core graph redraws for every node whose color is a different object, so each color is made once.
const colors = new Map<string, NodeColor>();
const hexColor = (hex: string): NodeColor => colors.get(hex) ?? colors.set(hex, { a: 1, rgb: parseInt(hex.slice(1), 16) }).get(hex)!;
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

// Screen radius a revealed tag is zoomed to: a small child tag zooms in further than a large parent.
// A smallest node (8) lands at scale 2, a root with 16 children at about 1.3.
const REVEAL_SIZE = 16;
// How long the camera takes to glide to a revealed tag.
const REVEAL_MS = 350;
// How long a single click on a 2D node waits for a second click before it moves the camera (Cytoscape's default).
const SINGLE_CLICK_WAIT_MS = 250;
const FOLLOW_MS = 2000;

export class NativeGraphs {
  private sessions = new Map<WorkspaceLeaf, Session>();
  // Set on unload, so a graph still opening doesn't reveal a tag and save settings afterwards.
  private destroyed = false;
  private centerTimer?: number;
  private current?: Session;
  private linked = new Set<LinkedGraph>();
  private failed = new WeakSet<WorkspaceLeaf>();
  // One sidebar panel serves every graph tab: a tag's details, the dictionary check, or the root tags until either is chosen.
  private panel?: HTMLElement;
  private history: PanelView[] = [{ kind: 'roots' }]; private at = 0;
  private nav: Partial<Record<'back' | 'forward' | 'home' | 'add' | 'edit' | 'expand', HTMLButtonElement>> = {};
  private mode?: Mode; private saving = false; private searchBox?: HTMLInputElement;
  // The last graph click on a dictionary tag, to tell a double click.
  private lastClick?: { id: string; at: number };
  // Updates the open form's count line and Save button in place.
  private syncForm = () => {};
  metrics: { operation: string; ms: number; nodes: number; visible: boolean }[] = [];
  explorer?: ExplorerPanel;
  constructor(private owner: TagOntologyPlugin) {}

  private get selected() { const view = this.history[this.at]; return view.kind === 'tag' ? view.tag : undefined; }
  private get checking() { return this.history[this.at].kind === 'check'; }
  // Like a browser: a new view drops the forward entries.
  private go(view: PanelView) {
    const previous = this.history[this.at];
    if (view.kind === previous.kind && (view.kind === 'group' && previous.kind === 'group'
      ? view.tag === previous.tag && view.source === previous.source : JSON.stringify(view) === JSON.stringify(previous))) return;
    this.history = [...this.history.slice(0, this.at + 1), view]; this.at = this.history.length - 1;
  }
  private step(by: number) {
    this.leave(() => { this.at = Math.min(Math.max(this.at + by, 0), this.history.length - 1); this.showSelection(); });
  }
  // Every way to show something else in the sidebar goes through here, so an open form is never left behind.
  // Unsaved edits are only dropped when the user says so.
  private leave(next: () => void) {
    // A save or delete that is writing can't be called off, and it moves the sidebar itself when it ends.
    if (this.saving) return;
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
      const legend = overlay.createDiv('tag-ontology-legend');
      const status = overlay.createDiv('tag-ontology-status'); status.setAttribute('role', 'status');
      const session: Session = {
        leaf, view, renderer: r, active: true, original: r.setData, wrapped: () => {}, choice: this.owner.settings.layout, mindmapExpanded: [], viewports: new Map(),
        click: r.onNodeClick, hovered: r.getHighlightNode, overlay, status, legend, kinds: new Map(), links: new Map(), nodeRenders: new Map(), toggles: {}, mode: '2d', syncModes: () => {}, canvases: new Map(), stopFit: () => {}, stopInput: () => {}, press: () => {}, double: () => {}, repin: () => {}, grab: () => {}, home: new Map(), pressCount: 0,
      };
      session.stopFit = () => { if (session.fitFrame !== undefined) window.cancelAnimationFrame(session.fitFrame); session.fitFrame = undefined; };
      // User input stops a camera move, and a single click's move still waiting to start: it must not override a pan or zoom.
      session.stopInput = () => { session.stopFit(); window.clearTimeout(this.centerTimer); };
      for (const event of ['pointerdown', 'wheel', 'keydown']) view.contentEl.addEventListener(event, session.stopInput, { capture: true });
      // On release the core graph unpins the node under the pointer, and the drag has restarted its simulation, which would
      // then carry the node off. The tree layouts pin it again and ease it back to its place with a slight overshoot, like
      // a spring; grabbing it again stops that. The core graph hears the release on the window in the capture phase, so
      // listening on the same window after it catches a release anywhere, such as over the sidebar. A drag starts with a
      // press on the graph, so each press listens on the window the graph is in then, which follows a tab moved to a popout.
      session.repin = () => {
        if (!session.active || session.choice === 'force') return;
        const released = r.nodes.filter(node => node.fx === null).map(node => ({ node, x: node.x, y: node.y, home: session.home.get(node.id) ?? node }));
        if (!released.length) return;
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
      session.grab = () => view.contentEl.win.addEventListener('pointerup', session.repin, { once: true });
      view.contentEl.addEventListener('pointerdown', session.grab, { capture: true });
      session.wrapped = data => {
        if (!session.active) return session.original.call(r, data);
        const first = !session.base;
        session.base = data;
        return this.render(session, first ? 'initial' : 'update');
      };
      r.setData = session.wrapped;
      // A click acts at once and moves the camera, so the second click of a double click can land off the node. The
      // browser's dblclick follows the system's double-click time and distance around the first click (like Windows'
      // double-click rectangle), not what is under the pointer, so it decides the double click here.
      session.ownClick = r.onNodeClick = (event, id, type) => {
        const tag = session.active ? session.resolved?.tagOf.get(id) : undefined;
        if (!tag) { session.click.call(r, event, id, type); return; }
        // The second press of a double click belongs to the tag the first one picked; the camera has moved, so it may be on
        // another node, which must not take the selection. The dblclick that follows handles it.
        if (session.pressCount >= 2) return;
        session.lastTag = { tag, at: performance.now() };
        this.clickTag(tag, false, leaf);
      };
      session.press = event => {
        session.pressCount = event.detail;
        if (event.detail === 1) session.firstDown = performance.now();
      };
      view.contentEl.addEventListener('mousedown', session.press, { capture: true });
      session.double = () => {
        const last = session.lastTag;
        // Only a double click whose first click picked a tag.
        if (!session.active || !last || session.firstDown === undefined || last.at < session.firstDown) return;
        session.lastTag = undefined;
        this.clickTag(last.tag, true, leaf);
      };
      view.contentEl.addEventListener('dblclick', session.double);
      // Node and link drawing fade everything not linked to the node this returns. With focus on and nothing hovered or dragged,
      // the selected tag and its own links draw as if it were hovered, the rest of what Focus keeps bright as if nothing were,
      // and everything else sees a node nothing links to, so it fades.
      session.ownHighlight = r.getHighlightNode = () => session.hovered.call(r) || (!session.focusIds ? null : session.drawing === undefined ? FADED : session.drawing);
      // A column of round icon buttons keeps the core graph settings on the right uncovered.
      this.iconButton(tools, 'chevrons-down-up', 'Collapse all', () => this.collapseAll(leaf));
      this.iconButton(tools, 'chevrons-up-down', 'Expand all', () => this.expandAll(leaf));
      this.iconButton(tools, 'scan', 'Fit', () => this.fit(session));
      tools.createDiv('tag-ontology-separator');
      for (const [key, icon, name] of TOGGLES) {
        session.toggles[key] = this.iconButton(tools, icon, name, () => {
          if (key === 'showNotes' && session.choice !== 'force') return;
          this.toggleFilter(key);
        });
        session.toggles[key].addClass('tag-ontology-toggle');
      }
      tools.createDiv('tag-ontology-separator');
      this.iconButton(tools, 'book-open-check', 'Dictionary check', () => this.checkDictionary());
      tools.createDiv('tag-ontology-separator');
      session.syncModes = graphModeBar(tools, this.owner, leaf);
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
      catch (error) { this.fail(leaf, error); }
    }
    this.syncNav();
  }

  // The tab goes back to the core graph and stays with it until the plugin loads again.
  private fail(leaf: WorkspaceLeaf, error: unknown) {
    this.failed.add(leaf); this.detach(leaf, true);
    new Notice(`Detached the tag ontology from the graph: ${String(error)}`);
  }

  // Note edits only change counts and note lists; the core graph re-sends its own data for them, so only redraw for the dictionary or settings.
  refresh(redraw = true) {
    this.attach();
    const model = this.owner.model!, settings = this.owner.settings;
    const kept = settings.expanded.filter(tag => model.entries.has(tag));
    if (kept.length !== settings.expanded.length) { settings.expanded = kept; void this.owner.saveState(); }
    for (const session of this.sessions.values()) {
      for (const [mode, entry] of session.canvases) if (mode === '3d' ? !settings.enable3d : !settings.enableExplorer) {
        entry.graph.unload(); entry.root.remove(); session.canvases.delete(mode);
        if (session.mode === mode) session.mode = '2d';
      }
      // A tab showing a turned-off tree goes to force, whatever layout another tab picked last.
      if (!modeEnabled(settings, session.choice)) { session.choice = 'force'; if (session.mode === '2d') this.render(session, 'layout'); }
      this.showMode(session);
    }
    if (redraw) for (const session of this.sessions.values()) this.render(session, 'refresh');
    this.drawLinked('refresh');
    this.renderPanel();
  }

  link(view: LinkedGraph) { this.linked.add(view); }
  unlink(view: LinkedGraph) { this.linked.delete(view); }

  activate(leaf: WorkspaceLeaf | null) {
    const session = leaf ? this.sessions.get(leaf) : undefined;
    if (session) this.current = session;
    // Switching tabs can hide or show the graph, which the panel's graph button follows.
    this.syncNav();
  }

  graphMode(leaf: WorkspaceLeaf): GraphMode {
    const session = this.sessions.get(leaf), mode = session?.mode;
    if (!mode && leaf.view.getViewType() === 'tag-ontology-3d') return '3d';
    if (!mode && leaf.view.getViewType() === 'tag-ontology-explorer') return 'explorer';
    return mode && mode !== '2d' ? mode : session?.choice ?? this.owner.settings.layout;
  }

  async switchMode(leaf: WorkspaceLeaf, mode: GraphMode | '2d'): Promise<void> {
    const session = this.sessions.get(leaf);
    if (!session) {
      if (leaf.view.getViewType() === 'graph') new Notice('The graph is not ready. Try switching modes again.');
      else await this.owner.openView(mode, false, leaf);
      return;
    }
    if (mode === '2d') mode = session.choice;
    if (!modeEnabled(this.owner.settings, mode)) return;
    this.current = session;
    session.stopFit();
    if (mode !== '3d' && mode !== 'explorer') {
      session.mode = '2d';
      if (session.choice !== mode) {
        const r = session.renderer;
        session.viewports.set(session.choice, { scale: r.scale, targetScale: r.targetScale, x: r.panX ?? 0, y: r.panY ?? 0,
          positions: new Map(r.nodes.map(node => [node.id, { x: node.x, y: node.y }])) });
        session.choice = mode;
        this.owner.settings.layout = mode;
        void this.owner.saveState();
        this.render(session, 'layout');
      }
      this.showMode(session);
      return;
    }
    session.mode = mode;
    let entry = session.canvases.get(mode);
    if (!entry) {
      const root = session.view.contentEl.createDiv('tag-ontology-mode');
      const graph = mode === '3d' ? new Graph3DCanvas(root, this.owner, leaf) : new ExplorerCanvas(root, this.owner, leaf);
      entry = { root, graph, ready: Promise.resolve() };
      session.canvases.set(mode, entry); graph.load();
      entry.ready = graph.open();
    }
    this.showMode(session);
    try { await entry.ready; }
    catch (error) {
      if (!session.active || session.canvases.get(mode) !== entry) return;
      entry.graph.unload(); entry.root.remove(); session.canvases.delete(mode);
      if (session.mode === mode) session.mode = '2d';
      new Notice(`Could not open the graph: ${String(error)}`);
    }
    if (session.active) this.showMode(session);
  }

  private showMode(session: Session) {
    const explorer = this.explorer;
    if (session.mode === '2d' && session.pendingRender) {
      session.pendingRender = false; this.render(session, 'refresh');
      if (!session.active) return;
    }
    if (session.mode !== '2d' && !session.nativePaused) {
      session.stopFit(); session.nativePaused = true;
      session.renderer.worker.postMessage({ run: false });
    } else if (session.mode === '2d' && session.nativePaused) {
      session.nativePaused = false;
      if (session.choice === 'force') session.renderer.worker.postMessage({ run: true });
      session.renderer.changed();
    }
    session.view.contentEl.toggleClass('has-embedded-graph', session.mode !== '2d');
    for (const [mode, entry] of session.canvases) {
      entry.root.hidden = mode !== session.mode;
      entry.graph.setVisible(mode === session.mode);
    }
    session.syncModes();
    this.syncNav();
    if (this.explorer !== explorer) this.renderPanel();
  }
  // One graph failing to draw mustn't keep the others or the sidebar from updating.
  drawLinked(operation: string) {
    for (const view of this.linked) {
      try { view.draw(operation); } catch (error) { console.error('Tag Ontology:', error); }
    }
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
    // With no graph on screen, expanding would change a graph nobody sees, so the button opens one instead.
    this.nav.expand = this.navButton(bar, 'circle-small', 'Expand in graph', () => {
      const tag = this.selected;
      if (!this.graphShown()) { void this.owner.openView().then(() => { if (!this.destroyed && tag && this.owner.model?.entries.has(tag)) this.reveal(tag); }); return; }
      if (tag) this.toggleExpanded(tag);
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

  get savedExpanded(): string[] { return this.owner.settings.expanded; }

  private graphShown() {
    return [...this.sessions.values()].some(session => session.view.contentEl.isShown()) || [...this.linked].some(view => view.isVisible?.());
  }

  private activeSession(leaf?: WorkspaceLeaf) {
    const active = leaf ?? this.owner.app.workspace.getActiveViewOfType(ItemView)?.leaf;
    const session = (active ? this.sessions.get(active) : undefined) ?? (this.current?.active ? this.current : this.sessions.values().next().value);
    if (session) this.current = session;
    return session;
  }

  private settingsFor(session: Session) {
    return { ...this.owner.settings, layout: session.choice,
      expanded: session.choice === 'mindmap' ? session.mindmapExpanded : this.owner.settings.expanded };
  }

  // Graph state is shared by every graph tab, like the core graph's own options.
  private update(patch: Partial<LayerSettings>, operation: string, session = this.activeSession()) {
    const local = !!patch.expanded && session?.choice === 'mindmap' && session.mode === '2d';
    if (local && patch.expanded) {
      session.mindmapExpanded = [...patch.expanded];
      patch = { ...patch }; delete patch.expanded;
    }
    Object.assign(this.owner.settings, patch);
    void this.owner.saveState();
    if (local) this.render(session, operation);
    else {
      for (const session of this.sessions.values()) this.render(session, operation);
      this.drawLinked(operation);
    }
    this.renderPanel();
  }

  // Every redraw comes through here: native updates, refreshes and the user's own actions. One that fails can leave the
  // renderer half updated, so only that tab lets go, and the others still draw.
  private render(session: Session, operation: string) {
    if (session.mode !== '2d') { session.pendingRender = true; return; }
    session.pendingRender = false;
    try { return this.draw(session, operation); }
    catch (error) { this.fail(session.leaf, error); }
  }

  private draw(session: Session, operation: string) {
    const model = this.owner.model, settings = this.settingsFor(session);
    if (!model || !session.active || !session.base) return;
    if (operation !== 'update' && operation !== 'refresh') session.stopFit();
    if (session.mindmapRoot && !model.placed.has(session.mindmapRoot)) session.mindmapRoot = undefined;
    renderDepthLegend(session.legend, settings, { color: (depth, color) => { void this.owner.setPaletteColor(depth, color); },
      choose: key => { void this.owner.choosePalette(key); }, save: () => this.owner.promptSavePalette() });
    const start = performance.now();
    // The tree layouts show the tag hierarchy alone; the saved Notes choice applies again in Force.
    const layer = buildLayer(session.base, model, { root: settings.layout === 'mindmap' ? session.mindmapRoot : undefined, expanded: new Set(settings.expanded), showNotes: settings.showNotes && settings.layout === 'force', showRelated: settings.showRelated,
      hierarchyColors: settings.customColors && settings.hierarchyColors, hierarchyPalette: settings.hierarchyPalette,
      tagColor: settings.customColors ? hexColor(this.owner.tagColor()) : undefined });
    // Links draw their style from the kinds every frame, and a link that only changes kind is no change to the core graph.
    const restyled = layer.kinds.size !== session.kinds.size || [...layer.kinds].some(([key, kind]) => session.kinds.get(key) !== kind);
    session.resolved = layer.resolved; session.kinds = layer.kinds; session.data = layer.data;
    const r = session.renderer, worker = r.worker, post = worker.postMessage;
    // A tree pins every node, so the reheat the core graph sends with new nodes or links would only simulate positions
    // nobody sees. The worker still gets the nodes and links, for Force to start from.
    if (settings.layout !== 'force' || session.mode !== '2d') worker.postMessage = (message: Record<string, unknown>) => {
      const rest = { ...message }; delete rest.alpha; delete rest.run; post.call(worker, rest);
    };
    let result: unknown;
    try { result = session.original.call(r, layer.data); } finally { worker.postMessage = post; }
    this.paint(session);
    if (restyled) r.changed();
    this.styleLinks(session);
    this.styleNodes(session);
    // Native updates (metadata changes, file opens) re-enter here; refitting on them would discard the user's zoom.
    const layoutChanged = session.layout !== settings.layout;
    session.layout = settings.layout;
    if (settings.layout !== 'force') this.staticLayout(session);
    // Taking over from a tree releases its pins and restarts the simulation from the tree's positions. Otherwise the core
    // graph reheats by itself when nodes or links change, and reheating on every update would shake a settled graph.
    else if (layoutChanged) {
      for (const node of r.nodes) {
        node.fx = null; node.fy = null;
        const saved = session.viewports.get('force')?.positions.get(node.id);
        if (saved) { node.x = saved.x; node.y = saved.y; }
      }
      if (session.mode === '2d') r.worker.postMessage({ nodes: Object.fromEntries(r.nodes.map(n => [n.id, [n.x, n.y]])), alpha: 0.3, run: true });
    }
    session.view.contentEl.toggleClass('is-mindmap', settings.layout === 'mindmap');
    if (settings.layout === 'mindmap') this.syncMindMap(session);
    if (session.mindmap) session.mindmap.el.hidden = settings.layout !== 'mindmap';
    this.syncToolbar(session);
    const viewport = layoutChanged ? session.viewports.get(settings.layout) : undefined;
    if (viewport) {
      r.setScale(viewport.scale); r.targetScale = viewport.targetScale; r.setPan(viewport.x, viewport.y); r.changed();
    } else if (layoutChanged || operation === 'initial' || operation === 'roots' || operation === 'expand-all') this.fit(session);
    if (operation === 'initial' || operation === 'roots') this.follow(session, () => this.fit(session));
    const notes = Object.values(layer.data.nodes).filter(n => n.type !== 'tag').length;
    // The core graph's Tags filter is off by default, which leaves nothing to layer the dictionary onto.
    const tagsShown = Object.values(session.base.nodes).some(n => n.type === 'tag');
    session.status.textContent = settings.layout === 'mindmap' && !session.mindmapRoot ? 'Choose a starting tag to explore its branch.' : tagsShown
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
      const key = edgeKey(link.source.id, link.target.id), saved = session.links.get(link);
      // Ordinary note links need no per-frame wrapper while Focus is inactive.
      if (!session.focusIds && !session.kinds.has(key)) {
        if (saved) {
          link.render = saved.render;
          if (link.line && saved.texture) link.line.texture = saved.texture;
          session.links.delete(link);
        }
        continue;
      }
      if (saved) continue;
      const original = { render: link.render, texture: link.line?.texture };
      session.links.set(link, original);
      // A link keeps its endpoints, so build the key once instead of on every frame.
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
        // The core graph fades arrows out below scale 0.3; up to 0.35 they are under 5% opacity, yet drawing a thousand of
        // them took a fifth of each frame in a fully expanded vault.
        const arrows = r.fShowArrow, ids = session.focusIds, center = session.focusNode;
        r.fShowArrow = kind === 'broader' ? r.scale > 0.35 : kind === 'related' ? false : arrows;
        session.drawing = !ids ? undefined : center && (link.source.id === center.id || link.target.id === center.id) ? center
          : ids.has(link.source.id) && ids.has(link.target.id) ? null : FADED;
        try { original.render.call(link); } finally { r.fShowArrow = arrows; session.drawing = undefined; }
      };
    }
  }

  // Like links, each node draws while getHighlightNode() answers for it, so Focus can keep any set of nodes bright.
  private styleNodes(session: Session) {
    const current = new Set(session.renderer.nodes);
    for (const node of session.nodeRenders.keys()) if (!current.has(node)) session.nodeRenders.delete(node);
    for (const node of session.renderer.nodes) {
      if (!session.focusIds) {
        const saved = session.nodeRenders.get(node);
        if (saved) { node.render = saved; session.nodeRenders.delete(node); }
        continue;
      }
      const original = node.render;
      if (!original || session.nodeRenders.has(node)) continue;
      session.nodeRenders.set(node, original);
      node.render = () => {
        const ids = session.focusIds;
        session.drawing = !ids ? undefined : node.id === session.focusNode?.id ? node : ids.has(node.id) ? null : FADED;
        try { original.call(node); } finally { session.drawing = undefined; }
      };
    }
  }

  private staticLayout(session: Session) {
    const r = session.renderer, model = this.owner.model!, { visible, idOf } = session.resolved!, settings = this.settingsFor(session);
    const ids = [...visible].map(tag => idOf.get(tag)!), inTree = new Set(ids), expanded = new Set(settings.expanded);
    const edges = [...visible].flatMap(tag => (model.entries.get(tag)!.broader ?? []).filter(parent => visible.has(parent) && (settings.layout !== 'mindmap' || expanded.has(parent)))
      .map(parent => [idOf.get(parent)!, idOf.get(tag)!] as [string, string]));
    // Notes are hidden here, so the only other nodes are tags the hierarchy doesn't place; the layout puts them in its corner.
    const outside = r.nodes.map(node => node.id).filter(id => !inTree.has(id));
    const key = JSON.stringify([settings.layout, ids, edges, outside]);
    if (session.staticPositions?.key !== key) session.staticPositions = { key, positions: settings.layout === 'mindmap' ? mindmapPositions(ids, edges, outside)
      : treePositions(ids, edges, settings.layout === 'tree-horizontal', outside) };
    const positions = session.staticPositions.positions;
    r.workerResults = null; session.home.clear();
    let moved = false;
    for (const node of r.nodes) {
      const p = positions.get(node.id)!;
      // The renderer treats fx = 0 as unpinned, so keep coordinates off exact zero.
      const x = p.x + .01, y = p.y + .01;
      session.home.set(node.id, { x, y });
      if (node.x === x && node.y === y && node.fx === x && node.fy === y) continue;
      node.x = node.fx = x; node.y = node.fy = y; moved = true;
    }
    // Native updates that change nothing re-enter here, and a redraw runs about a second of frames.
    if (moved) r.changed();
  }

  private syncMindMap(session: Session) {
    const model = this.owner.model!, resolved = session.resolved!, expanded = new Set(session.mindmapExpanded);
    session.mindmap ??= new MindMap(session.view.contentEl, tag => this.clickTag(tag, false, session.leaf), tag => {
      session.mindmapAnchor = session.resolved?.idOf.get(tag);
      this.toggleExpanded(tag, session.leaf);
    }, {
      app: this.owner.app,
      color: tag => this.owner.settings.customColors ? this.owner.tagColor(tag) : undefined,
      suggest: query => (this.owner.model?.suggest(query, 20) ?? []).filter(item => this.owner.model?.placed.has(item.tag)).slice(0, 10),
      choose: tag => {
        if (tag && !this.owner.model?.placed.has(tag)) return;
        session.mindmapRoot = tag;
        this.update({ expanded: [] }, 'mindmap-root', session);
        session.mindmap?.fit();
      },
    });
    const nodes: MindMapData['nodes'] = session.renderer.nodes.map(node => {
      const tag = resolved.tagOf.get(node.id), raw = node.color;
      const rgb = raw && typeof raw === 'object' && 'rgb' in raw && typeof raw.rgb === 'number' ? raw.rgb : undefined;
      return {
        id: node.id, tag, name: tag ?? node.id, x: node.x, y: node.y,
        color: rgb === undefined ? undefined : '#' + rgb.toString(16).padStart(6, '0'),
        expandable: !!tag && (model.children.get(tag) ?? []).some(child => resolved.range.has(child)),
        expanded: !!tag && expanded.has(tag),
      };
    });
    const ids = new Set(nodes.map(node => node.id)), edges: MindMapData['edges'] = [];
    for (const [source, node] of Object.entries(session.data!.nodes)) for (const target of Object.keys(node.links)) {
      const related = session.kinds.get(edgeKey(source, target)) === 'related';
      const parent = resolved.tagOf.get(source);
      if (!related && parent && !expanded.has(parent)) continue;
      if (ids.has(source) && ids.has(target)) edges.push({ source, target, related });
    }
    session.mindmap.draw({ root: session.mindmapRoot, roots: model.roots, startFrom: this.selected && model.placed.has(this.selected) ? this.selected : undefined, nodes: session.mindmapRoot ? nodes : [], edges: session.mindmapRoot ? edges : [], anchor: session.mindmapAnchor, selected: this.selected ? resolved.idOf.get(this.selected) : undefined, bright: session.focusIds });
    session.mindmapAnchor = undefined;
  }

  get selectedTag() { return this.selected; }

  // True when this click on the node follows another on it within DOUBLE_CLICK_MS; the click after a double click starts over.
  // A click selects at once and never waits for a second one.
  isDouble(id: string): boolean {
    const now = performance.now(), double = this.lastClick?.id === id && now - this.lastClick.at < DOUBLE_CLICK_MS;
    this.lastClick = double ? undefined : { id, at: now };
    return double;
  }

  // A click on a dictionary tag in any graph: select it, and on a double click expand or collapse it.
  clickTag(tag: string, double: boolean, leaf?: WorkspaceLeaf) {
    this.activeSession(leaf);
    window.clearTimeout(this.centerTimer);
    this.leave(() => {
      this.go({ kind: 'tag', tag });
      if (double) this.toggleExpanded(tag, leaf);
      else this.showSelection();
      // Either click brings the tag to the middle of the graph it was clicked in. Like a single tap that requires a double
      // tap to fail (UIKit's require(toFail:)), a single click waits to see whether a second click follows, so the node
      // stays under the pointer for it; a double click moves at once.
      // Only 2D graph tabs have a session to move; the sidebar comes forward from any graph.
      const session = leaf && this.sessions.get(leaf);
      if (session && double) this.centerOn(session, tag);
      else if (session) this.centerTimer = window.setTimeout(() => { if (!this.destroyed) this.centerOn(session, tag); }, SINGLE_CLICK_WAIT_MS);
      this.showPanel(true);
    });
  }

  // The 3D view shows its toolbar before a dictionary has loaded; until one has, there is nothing to expand or collapse.
  collapseAll(leaf?: WorkspaceLeaf) { if (this.owner.model) this.update({ expanded: [] }, 'roots', this.activeSession(leaf)); }
  expandAll(leaf?: WorkspaceLeaf) { if (this.owner.model) this.update({ expanded: [...this.owner.model.entries.keys()] }, 'expand-all', this.activeSession(leaf)); }
  toggleFilter(key: ToggleKey) { this.update({ [key]: !this.owner.settings[key] }, 'filter'); }
  // The explorer's note and group cards show here, like a tag.
  showNote(path: string) { this.leave(() => { this.go({ kind: 'note', path }); this.showSelection(); this.showPanel(true); }); }
  showGroup(tag: string, source = this.explorer) { this.leave(() => { this.go({ kind: 'group', tag, source }); this.showSelection(); this.showPanel(true); }); }
  // A renamed note keeps the sidebar views of it, back and forward included.
  noteRenamed(from: string, to: string) {
    this.history = this.history.map(view => view.kind === 'note' && view.path === from ? { kind: 'note', path: to } : view);
    this.renderPanel();
  }
  checkDictionary() { this.leave(() => { this.go({ kind: 'check' }); this.renderPanel(); this.showPanel(true); }); }

  // A double click and the panel button do the same thing. Collapsing leaves the tags below it expanded, so they come back as they were.
  private toggleExpanded(tag: string, leaf?: WorkspaceLeaf) {
    // Read the live state: Expand all or another tab may have changed it since the bar was drawn.
    const session = this.activeSession(leaf), live = session?.choice === 'mindmap' && session.mode === '2d' ? session.mindmapExpanded : this.owner.settings.expanded;
    this.update({ expanded: live.includes(tag) ? live.filter(t => t !== tag) : [...live, tag] }, 'expand:' + tag, session);
  }

  private reveal(tag: string) {
    if (this.mode) { this.leave(() => this.reveal(tag)); return; }
    // Suggestions can outlive a dictionary reload that removed the tag.
    if (!this.owner.model?.entries.has(tag)) { new Notice('That tag is no longer in the dictionary.'); return; }
    this.go({ kind: 'tag', tag });
    // Expansion is shared by every graph tab; with no graph open it is saved for the next one.
    const sessions = [...this.sessions.values()], linked = [...this.linked];
    if (sessions.length + linked.length && !sessions.some(s => s.resolved?.range.has(tag)) && !linked.some(view => view.has(tag))) {
      new Notice('Not in the current graph.'); this.showSelection(); return;
    }
    // An expanded ancestor can still sit under a collapsed one, so walk every ancestor.
    const session = this.activeSession(), expanded = new Set(session?.mode === '2d' ? this.settingsFor(session).expanded : this.owner.settings.expanded), pending = [tag], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current); expanded.add(current);
      pending.push(...this.owner.model.entries.get(current)?.broader ?? []);
    }
    this.update({ expanded: [...expanded] }, 'reveal');
    // Center the chosen tag in every open graph; with no graph open there is nothing to move.
    for (const session of this.sessions.values()) this.centerOn(session, tag);
    for (const view of this.linked) if (view.isVisible?.() !== false) view.focusOn(tag);
  }

  // Moves a tag to the middle of a 2D graph, zoomed in by its node's size.
  private centerOn(session: Session, tag: string) {
    if (session.mode !== '2d') return;
    const id = session.resolved?.idOf.get(tag), r = session.renderer;
    if (!id) return;
    if (session.choice === 'mindmap' && session.mindmap) { session.mindmap.focusOn(id); return; }
    // One eased camera move: the node glides from where it is to the middle while the zoom goes to where the node is
    // REVEAL_SIZE on screen. Scale and pan are both set here every frame, so the core graph's own zoom easing never pulls
    // the other way (after a pinch its targetScale can still hold an older, smaller zoom). It starts from the zoom on screen
    // and never zooms out. After the move the node stays centered while the force layout settles, and the zoom follows
    // its size, which changes when expanding changes its links.
    const ratio = devicePixelRatio, from = r.scale, node0 = r.nodes.find(n => n.id === id);
    if (!node0) return;
    const startX = node0.x * from + (r.panX ?? 0), startY = node0.y * from + (r.panY ?? 0);
    const center = (progress: number) => {
      const node = r.nodes.find(n => n.id === id);
      if (!node) return;
      const size = node.getSize?.(), to = Math.max(from, size ? REVEAL_SIZE / size : from);
      const t = 1 - (1 - Math.min(1, progress * FOLLOW_MS / REVEAL_MS)) ** 3, scale = from + (to - from) * t;
      const x = startX + (r.width * ratio / 2 - startX) * t, y = startY + (r.height * ratio / 2 - startY) * t;
      r.targetScale = scale; r.setScale(scale);
      r.setPan(x - node.x * scale, y - node.y * scale); r.changed();
    };
    this.follow(session, center);
  }

  // Shows the selected tag in the panel and in every graph without layering the graphs again.
  private showSelection() {
    this.renderPanel();
    for (const session of this.sessions.values()) this.paint(session);
    for (const view of this.linked) view.paint();
  }

  // Node and link drawing read what Focus keeps bright every frame, so a new selection needs no new data. A redraw runs
  // about a second of frames, so it is only asked for when that changed.
  private paint(session: Session) {
    const settings = this.owner.settings, model = this.owner.model, tag = this.selected, resolved = session.resolved, data = session.data;
    // A selected tag collapsed out of sight has nothing to keep bright, so nothing fades.
    const bright = settings.focus && model && tag && resolved?.visible.has(tag) && data
      ? focusIds(data, resolved, model, tag, { descendants: settings.focusDescendants, notes: settings.focusNotes }) : undefined;
    if (session.choice === 'mindmap') session.mindmap?.paint(tag ? resolved?.idOf.get(tag) : undefined, bright);
    const center = bright ? session.renderer.nodes.find(node => node.id === resolved!.idOf.get(tag!)) : undefined;
    if (!sameSet(bright, session.focusIds) || center !== session.focusNode) { session.focusIds = bright; session.focusNode = center; this.styleLinks(session); this.styleNodes(session); session.renderer.changed(); }
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
    panel.setCssProps({ '--tag-ontology-color': this.owner.tagColor(this.selected) });
    // The sidebar's tags match the graph's whenever custom colors are on; the title has its own setting.
    panel.toggleClass('tag-ontology-tinted', this.owner.settings.customColors);
    const view = this.history[this.at];
    if (this.checking) this.inventory(panel, model);
    else if (this.selected && model.entries.has(this.selected)) this.inspect(panel, model, this.selected);
    else if (view.kind === 'note' && this.owner.app.vault.getAbstractFileByPath(view.path) instanceof TFile) this.noteView(panel, model, view.path);
    else if (view.kind === 'group' && (view.source ?? this.explorer)?.groupNotes(view.tag)) {
      const source = (view.source ?? this.explorer)!;
      this.groupView(panel, view.tag, source.groupNotes(view.tag)!, source);
    }
    else { panel.createEl('h4', { text: `Root tags (${model.roots.length})` }); this.tagLinks(panel, model.roots); }
  }

  private missing() {
    return this.owner.dictionaryFound === false;
  }

  // Creating is left to the user: a file that is still syncing looks missing too, and it shows up here on its own when it arrives.
  private notFound(panel: HTMLElement) {
    panel.createEl('h4', { text: 'Tag dictionary not found' });
    panel.createEl('p', { text: `${this.owner.dictionaryPath} is not in the vault. If the vault is still syncing, the dictionary appears here once the file arrives. You can change the path in the plugin settings.` });
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

  private noteView(panel: HTMLElement, model: Ontology, path: string) {
    panel.createEl('h3', { text: path.split('/').at(-1)!.replace(/\.md$/, '') });
    panel.createEl('p', { text: path, cls: 'tag-ontology-muted' });
    const tags = tagsOfNote(model, path);
    if (tags.length) this.tagLinks(panel, tags);
    panel.createEl('button', { text: 'Open note', cls: 'mod-cta' }).addEventListener('click', () => this.openNote(path));
  }

  // A group's notes, newest first: filter them by name, tick some to take out, or take the latest out.
  private groupView(panel: HTMLElement, tag: string, notes: { path: string; mtime: number }[], source: ExplorerPanel) {
    panel.createEl('h3', { text: `${count(notes.length, 'note', 'notes')} · #${tag}` });
    const filter = panel.createEl('input', { type: 'search', placeholder: 'Filter notes', attr: { 'aria-label': 'Filter notes' } });
    const list = panel.createEl('ul', { cls: 'tag-ontology-group' }), now = Date.now();
    let rows: { input: HTMLInputElement; path: string }[] = [];
    const draw = () => {
      list.empty();
      const query = filter.value.trim().toLowerCase(), name = (path: string) => path.split('/').at(-1)!.replace(/\.md$/, '');
      rows = notes.filter(note => name(note.path).toLowerCase().includes(query)).map(note => {
        const label = list.createEl('li').createEl('label');
        const input = label.createEl('input', { type: 'checkbox' });
        label.createSpan({ text: name(note.path) });
        label.createEl('small', { text: relativeTime(note.mtime, now), cls: 'tag-ontology-muted' });
        return { input, path: note.path };
      });
    };
    filter.addEventListener('input', draw);
    draw();
    const buttons = panel.createDiv('tag-ontology-group-buttons');
    buttons.createEl('button', { text: 'Take out selected', cls: 'mod-cta' }).addEventListener('click', () => {
      const picked = rows.filter(row => row.input.checked).map(row => row.path);
      if (picked.length) source.takeOut(tag, picked);
    });
    buttons.createEl('button', { text: `Take out latest ${TAKE_OUT}` }).addEventListener('click', () => source.takeOut(tag, notes.slice(0, TAKE_OUT).map(note => note.path)));
  }

  private inventory(panel: HTMLElement, model: Ontology) {
    const found = this.owner.checkUsage();
    panel.createEl('h3', { text: `Not in dictionary (${model.unregistered.size})` });
    panel.createEl('p', { text: 'Compares tags used across the vault with the dictionary. Nothing is added, changed or deleted.' });
    for (const [tag, paths] of model.unregistered) {
      const details = panel.createEl('details'); details.createEl('summary', { text: `#${tag} · ${paths.length} note${paths.length === 1 ? '' : 's'}` });
      const similar = found?.unregistered.find(item => item.tag === tag)?.similar;
      if (similar?.length) details.createEl('p', { text: 'Similar: ' + similar.map(name => '#' + name).join(', '), cls: 'tag-ontology-muted' });
      this.noteLinks(details, paths);
    }
    if (found) {
      const aliases = groupNonCanonical(found.nonCanonical);
      if (aliases.length) {
        const details = panel.createEl('details'); details.createEl('summary', { text: `Written as an alias or in another case (${aliases.length})` });
        details.createEl('p', { text: 'Obsidian does not find these notes under the dictionary tag. Rename the tag in each note to the dictionary name.' });
        for (const group of aliases) {
          const nested = details.createEl('details');
          nested.createEl('summary', { text: `#${group.tag} → #${group.canonical} · ${group.notes.length} note${group.notes.length === 1 ? '' : 's'}` });
          this.noteLinks(nested, group.notes);
        }
      }
      const broader = groupRedundant(found.redundant);
      if (broader.length) {
        const details = panel.createEl('details'); details.createEl('summary', { text: `Broader tag next to a narrower tag (${broader.length})` });
        details.createEl('p', { text: 'These notes carry a tag and one of its descendants. Keep both only when the note explains each directly.' });
        for (const group of broader) {
          const nested = details.createEl('details');
          nested.createEl('summary', { text: `#${group.tag} · ${group.notes.length} note${group.notes.length === 1 ? '' : 's'}` });
          this.noteLinks(nested, group.notes);
        }
      }
    }
    const unused = panel.createEl('details'); unused.createEl('summary', { text: `Unused dictionary tags (${model.unused.length})` });
    unused.createEl('p', { text: 'These may be grouping concepts. Unused does not mean they should be deleted.' });
    this.tagLinks(unused, model.unused);
  }

  // Obsidian's own tag style tells tags apart from buttons and note links.
  private tagLinks(parent: HTMLElement, tags: readonly string[]) {
    const list = parent.createDiv('tag-ontology-tags');
    for (const tag of tags) {
      const link = list.createEl('a', { href: '#', text: '#' + tag, cls: 'tag' });
      if (this.owner.settings.customColors) link.setCssProps({ '--tag-ontology-tags': this.owner.tagColor(tag) });
      link.addEventListener('click', e => { e.preventDefault(); this.reveal(tag); });
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

  // Obsidian's tag rules, plus kebab-case names while that setting is on.
  private nameProblem(name: string, base: RawDictionary, current?: string): string | undefined {
    return nameError(name, base, current)
      ?? (this.owner.settings.kebabNames && !isKebabName(name) ? 'Use lowercase letters and digits joined by hyphens (kebab-case tag names are on in settings).' : undefined);
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
    const facet = () => {
      form.createEl('label', { text: 'Facet' });
      const input = form.createEl('input', { type: 'text', attr: { 'aria-label': 'Facet', placeholder: 'Optional, for example language' } });
      input.value = draft.facet ?? '';
      input.addEventListener('input', () => {
        const facet = input.value.trim();
        if (facet) draft.facet = facet;
        else if (tag !== undefined && typeof base[tag]?.facet === 'string') draft.facet = null;
        else delete draft.facet;
        this.syncForm();
      });
    };
    const list = (kind: ListKey, label: string, placeholder: string) => { form.createEl('label', { text: label }); this.picker(form, kind, placeholder); };
    if (tag === undefined) {
      list('parents', 'Parents', 'Add a parent');
      if (!draft.parents.length) form.createDiv({ cls: 'tag-ontology-hint', text: 'No parent: it becomes a root tag.' });
      list('children', 'Children', 'Add a child'); list('related', 'Related', 'Add a related tag');
      describe(); aliases(); facet();
    } else {
      describe(); aliases(); facet();
      list('parents', 'Parents', 'Add a parent'); list('children', 'Children', 'Add a child'); list('related', 'Related', 'Add a related tag');
    }
    const status = panel.createDiv('tag-ontology-count'), footer = panel.createDiv('tag-ontology-footer');
    const remove = tag === undefined ? undefined : footer.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    remove?.addEventListener('click', () => this.confirmDelete());
    footer.createDiv('tag-ontology-spacer');
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.cancel());
    const save = footer.createEl('button', { text: tag === undefined ? 'Add' : 'Save', cls: 'mod-cta' });
    save.addEventListener('click', () => { void this.save(); });
    const notes = tag === undefined ? 0 : model.counts(tag).direct;
    this.syncForm = () => {
      // A new tag's empty name is not an error yet, only not ready.
      // An unchanged name is never an error, so a key written before these rules can still be edited.
      const error = tag === undefined ? draft.name ? this.nameProblem(draft.name, base) : undefined : draft.name === tag ? undefined : this.nameProblem(draft.name, base, tag);
      const changes = mode.kind === 'edit' ? changedFields(base, mode.tag, typed(mode)) : 0;
      // Notes match dictionary tags ignoring case, so a case-only rename keeps them.
      const hint = tag === undefined ? 'Pick one, or type a new name.'
        : draft.name.toLowerCase() !== tag.toLowerCase() && notes ? `${notes} note${notes === 1 ? ' uses' : 's use'} #${tag}. ${notes === 1 ? 'It keeps' : 'They keep'} it and it will show as not in the dictionary.` : '';
      note.toggleClass('tag-ontology-error', !!error); note.toggleClass('tag-ontology-hint', !error);
      note.setText(error ?? hint);
      status.setText(`${count(changes, 'change', 'changes')} not saved`); status.hidden = !changes;
      save.disabled = (tag === undefined ? !draft.name : !changes) || !!error || this.saving;
      // Neither can run while a save is writing, so their buttons say so instead of opening a dialog that does nothing.
      cancel.disabled = this.saving;
      if (remove) remove.disabled = this.saving;
    };
    this.syncForm();
  }

  // Tags use Obsidian's tag style, which it gives to links only.
  private chips(parent: HTMLElement, items: string[], text: (item: string) => string, remove: (item: string) => void, asTag = false): HTMLElement {
    const list = parent.createDiv('tag-ontology-tags');
    for (const item of items) {
      const chip = asTag ? list.createEl('a', { text: text(item), cls: 'tag tag-ontology-chip' }) : list.createSpan({ text: text(item), cls: 'tag-ontology-chip' });
      if (asTag && this.owner.settings.customColors) chip.setCssProps({ '--tag-ontology-tags': this.owner.tagColor(item) });
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
      mode.query = '';
      this.drawForm();
    });
    return open;
  }

  private picker(parent: HTMLElement, kind: ListKey, placeholder: string) {
    const mode = this.mode!;
    const list = this.chips(parent, mode.draft[kind], tag => '#' + tag, tag => { mode.draft[kind] = mode.draft[kind].filter(t => t !== tag); }, true);
    if (!this.opener(list, kind, placeholder)) return;
    const input = parent.createEl('input', { type: 'text', attr: { placeholder } });
    input.value = mode.query ?? '';
    input.addEventListener('input', () => { mode.query = input.value; });
    new TagSuggest(this.owner.app, input, query => {
      const skip = excluded(mode.base, mode.kind === 'edit' ? mode.tag : undefined, mode.draft, kind);
      // The model can already hold tags added to the file after the form opened; the draft only knows the base.
      return (this.owner.model?.suggest(query, 50) ?? []).filter(s => Object.hasOwn(mode.base, s.tag) && !skip.has(s.tag)).slice(0, 10);
    }, tag => { mode.draft[kind] = [...mode.draft[kind], tag]; mode.query = ''; this.drawForm(); });
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
      const error = mode.kind === 'edit' && name === mode.tag ? undefined : this.nameProblem(name, base, mode.kind === 'edit' ? mode.tag : undefined);
      if (error) { new Notice(error); return false; }
      const change: Change = mode.kind === 'edit' ? { kind: 'edit', tag, draft } : { kind: 'add', draft };
      if (!await this.owner.saveChange(change, base)) return false;
      if (name !== tag) {
        this.owner.settings.expanded = this.owner.settings.expanded.map(t => t === tag ? name : t);
        for (const session of this.sessions.values()) {
          session.mindmapExpanded = session.mindmapExpanded.map(t => t === tag ? name : t);
          if (session.mindmapRoot === tag) session.mindmapRoot = name;
        }
        void this.owner.saveState();
        this.history = this.history.map(view => view.kind === 'tag' && view.tag === tag ? { kind: 'tag', tag: name }
          : view.kind === 'group' && view.tag === tag ? { ...view, tag: name } : view);
        for (const view of this.linked) view.renamed?.(tag, name);
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
    const session = this.activeSession();
    const expanded = tag !== undefined && (session?.mode === '2d' ? this.settingsFor(session).expanded : this.owner.settings.expanded).includes(tag);
    // The icon shows the tag's state in the graph; the button keeps the accent color whenever it can be used.
    const shown = this.graphShown();
    // Expanding only shows child tags, so a tag without any is always as open as it gets.
    const leaf = tag !== undefined && !this.owner.model!.children.get(tag)?.length;
    disable(expand, shown && (!tag || leaf)); expand.toggleClass('is-active', !shown || !!tag && !leaf);
    // Forms start from the last dictionary that loaded, so they wait while the file is missing or broken.
    const blocked = this.missing() || this.owner.error !== undefined;
    disable(add, !this.owner.model || blocked); add.toggleClass('is-active', this.mode?.kind === 'new');
    disable(edit, !tag || blocked); edit.toggleClass('is-active', this.mode?.kind === 'edit');
    setIcon(expand, !shown ? 'git-fork' : expanded || leaf ? 'waypoints' : 'circle-small');
    setTooltip(expand, !shown ? 'Open graph' : leaf ? 'No child tags' : expanded ? 'Collapse in graph' : 'Expand in graph', { placement: 'bottom' });
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
    const settings = this.settingsFor(session);
    for (const [key, , name] of TOGGLES) {
      const button = session.toggles[key];
      if (!button) continue;
      const disabled = key === 'showNotes' && settings.layout !== 'force';
      button.toggleClass('is-active', settings[key] && !disabled); button.setAttribute('aria-pressed', String(settings[key] && !disabled));
      button.setAttribute('aria-disabled', String(disabled));
      this.label(button, disabled ? 'Notes are hidden in tree layouts' : `${name}: ${settings[key] ? 'shown' : 'hidden'}`);
    }
    session.syncModes();
  }

  openNote(path: string) {
    const file = this.owner.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('The note was moved or deleted. Reload the dictionary and try again.'); return; }
    void this.owner.app.workspace.getLeaf('tab').openFile(file).catch(error => new Notice(`Could not open the note: ${String(error)}`));
  }

  // Repeats a move every frame for a while (two seconds while the force layout settles) and passes how far along it is,
  // ending on 1; any user input stops it.
  private follow(session: Session, move: (progress: number) => void, ms = FOLLOW_MS) {
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
    if (session.mode !== '2d') return;
    if (session.choice === 'mindmap' && session.mindmap) { session.mindmap.fit(coveredEdges(session.view.contentEl)); return; }
    const r = session.renderer;
    if (!r.width || !r.height || !r.nodes.length) return;
    // One pass rather than Math.min(...xs): spreading a graph of about 125,000 nodes into one call overflows the stack.
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const { x, y } of r.nodes) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    // The graph fits in the space the toolbar, legend, status line and the core settings buttons leave uncovered.
    const edge = coveredEdges(session.view.contentEl), width = Math.max(1, r.width - edge.left - edge.right), height = Math.max(1, r.height - edge.bottom);
    const scale = Math.min(1.4, width * devicePixelRatio / (right - left + 220), height * devicePixelRatio / (bottom - top + 220));
    r.targetScale = scale; r.setScale(scale);
    r.setPan((edge.left + width / 2) * devicePixelRatio - (left + right) / 2 * scale, height / 2 * devicePixelRatio - (top + bottom) / 2 * scale);
    r.changed();
  }

  private detach(id: WorkspaceLeaf, redraw: boolean) {
    const s = this.sessions.get(id); if (!s) return;
    s.active = false;
    for (const { graph, root } of s.canvases.values()) { graph.unload(); root.remove(); }
    s.canvases.clear();
    s.stopFit();
    for (const event of ['pointerdown', 'wheel', 'keydown']) s.view.contentEl.removeEventListener(event, s.stopInput, { capture: true });
    s.view.contentEl.removeEventListener('pointerdown', s.grab, { capture: true });
    s.view.contentEl.removeEventListener('mousedown', s.press, { capture: true });
    s.view.contentEl.removeEventListener('dblclick', s.double);
    s.view.contentEl.win.removeEventListener('pointerup', s.repin);
    if (s.renderer.setData === s.wrapped) s.renderer.setData = s.original;
    if (s.renderer.onNodeClick === s.ownClick) s.renderer.onNodeClick = s.click;
    if (s.renderer.getHighlightNode === s.ownHighlight) s.renderer.getHighlightNode = s.hovered;
    for (const [node, render] of s.nodeRenders) node.render = render;
    for (const [link, original] of s.links) {
      link.render = original.render;
      if (link.line && original.texture) link.line.texture = original.texture;
    }
    s.mindmap?.destroy();
    s.texture?.destroy();
    s.overlay.remove(); s.view.contentEl.removeClass('tag-ontology-native'); s.view.contentEl.removeClass('is-mindmap'); s.view.contentEl.removeClass('has-embedded-graph');
    this.sessions.delete(id);
    if (redraw) {
      for (const node of s.renderer.nodes) { node.fx = null; node.fy = null; }
      s.view.update();
    }
  }
  destroy() { this.destroyed = true; window.clearTimeout(this.centerTimer); for (const id of [...this.sessions.keys()]) this.detach(id, true); }
}
