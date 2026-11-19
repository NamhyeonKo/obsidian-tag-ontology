import { renderDepthLegend } from './legend.ts';
import { Component, ItemView, Setting, debounce, setIcon, setTooltip, type SliderComponent, type ToggleComponent, type WorkspaceLeaf } from 'obsidian';
import { graphModeBar } from './graph-modes.ts';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type SpriteText from 'three-spritetext';
import type { BufferGeometry, Color, ConeGeometry, Fog, InstancedMesh, LineBasicMaterial, LineDashedMaterial, LineSegments, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, SphereGeometry, Texture, Vector3 } from 'three';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, focusIds, linkTone, type EdgeKind, type NativeData } from './layer.ts';
import { DOUBLE_CLICK_MS, coveredEdges, type LinkedGraph } from './native.ts';
import { DEFAULT_SETTINGS, FORCES, LABEL_SIZE, cssColorToHex, type Forces } from './settings.ts';
import { arrowAt, cameraDepth, fitView, fogRange, labelBounds, labelScale, springBack, type Point } from './geometry3d.ts';

export const VIEW_3D = 'tag-ontology-3d';

export class Graph3DView extends ItemView {
  private canvas?: Graph3DCanvas;
  constructor(leaf: WorkspaceLeaf, private owner: TagOntologyPlugin) { super(leaf); }
  getViewType() { return VIEW_3D; }
  getDisplayText() { return '3D tag ontology'; }
  getIcon() { return 'box'; }
  async onOpen() {
    if (!this.owner.settings.enable3d) { this.leaf.detach(); return; }
    this.canvas = this.addChild(new Graph3DCanvas(this.contentEl, this.owner, this.leaf));
    this.canvas.setVisible(true); await this.canvas.open();
  }
  onClose() { if (this.canvas) this.removeChild(this.canvas); return Promise.resolve(); }
}

interface Node3D {
  id: string; type: string; tag?: string; name: string; degree: number; radius: number;
  x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
  dot?: Mesh<SphereGeometry, MeshBasicMaterial>; label?: SpriteText;
}
interface Link3D { source: string | Node3D; target: string | Node3D; kind: EdgeKind | 'note' }
type Graph = ForceGraph3DInstance<Node3D, Link3D>;
interface ControlsLike { addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }
type Layer = ReturnType<typeof buildLayer>;
type Three = typeof import('./three.ts');

// The 2D graph's Display defaults in 3D units: nodes and links start a little smaller than 2D's 1.
const NODE_SIZE = 0.8, LINK_OPACITY = 0.8;
// The gravity, repulsion, and link forces scale from 2D; cooling stops once alpha drops below this floor.
const REPEL_SCALE = -6, DISTANCE_SCALE = 0.12, CENTER_SCALE = 0.04, ALPHA_MIN = 0.001;
const ARROW = 1.8, DASH = 1.6, GAP = 1.2;
// A click flies the camera this close to the tag, keeping the direction it looks from.
const FLY_DISTANCE = 90, FLY_MS = 1000;
// Without drag tension, a dropped node eases back home over this duration.
const SPRING_MS = 450;
// Faded nodes and labels stay faintly visible, as in 2D.
const FADED_NODE = 0.2, FADED_LABEL = 0.15;
// Labels hang under their node and fade out between these camera distances, as they do when zooming out in 2D. Their size on
// screen follows the label settings (see labelBounds).
const TEXT_HEIGHT = 2.2, FONT_SIZE = 48, LABEL_NEAR = 300, LABEL_FAR = 650;
// Used when a theme leaves a graph color unset or in a format cssColorToHex can't read.
const FALLBACK = { note: '#b8b8b8', tag: '#55c26a', line: '#5a5a5a', text: '#dadada', background: '#1e1e1e', accent: '#8b6cef' };
const TOGGLES = [['showNotes', 'file-text', 'Notes'], ['showRelated', 'link', 'Related']] as const;

const idOf = (end: string | Node3D) => typeof end === 'string' ? end : end.id;
const basename = (path: string) => path.split('/').at(-1)!.replace(/\.md$/, '');
// A faded line: the line color most of the way to the background.
const mix = (from: string, to: string, share: number) => '#' + [1, 3, 5].map(at => {
  const a = parseInt(from.slice(at, at + 2), 16), b = parseInt(to.slice(at, at + 2), 16);
  return Math.round(a + (b - a) * share).toString(16).padStart(2, '0');
}).join('');
// Like 2D, a node grows a little with its links.
const radiusOf = (degree: number) => (1.4 + Math.sqrt(degree) * 0.3) * NODE_SIZE;

// The tag hierarchy in three dimensions. It layers the same shared state as the 2D graph, through NativeGraphs.
export class Graph3DCanvas extends Component implements LinkedGraph {
  private graph?: Graph;
  private three?: Three; private ball?: SphereGeometry; private pickMaterial?: MeshBasicMaterial; private closed = false;
  // Where the camera looks, refreshed every frame.
  private forward?: Vector3;
  private stage?: HTMLElement; private status?: HTMLElement; private legend?: HTMLElement; private recenter?: HTMLElement;
  private toggles: Partial<Record<typeof TOGGLES[number][0], HTMLElement>> = {};
  private colors = FALLBACK;
  // The theme's interface font. A canvas can't read CSS variables, so the name is resolved here.
  private font = 'sans-serif';
  private base?: NativeData; private layer?: Layer;
  private nodes = new Map<string, Node3D>(); private links: Link3D[] = [];
  // The node ids and links last handed to the library, to tell an edit that changes nothing it draws.
  private shape?: string;
  private fitTimer?: number; private flyTimer?: number; private resize?: ResizeObserver;
  private controls?: ControlsLike;
  private centeredTag?: string; private moved = false;
  private dragging = false; private restoreAlphaMin = false;
  // Where flyTo is sending the camera so tween frames don't mark the view as user-moved.
  private flyDest?: { x: number; y: number; z: number; until: number };
  private onControlChange = () => {
    const dest = this.flyDest;
    if (dest) {
      const p = this.graph?.camera().position;
      if (p && Math.hypot(p.x - dest.x, p.y - dest.y, p.z - dest.z) < 0.05) { this.flyDest = undefined; return; }
      if (performance.now() < dest.until) return;
      this.flyDest = undefined;
    }
    if (!this.moved) { this.moved = true; this.syncRecenter(); }
  };
  // The hovered node, and what stays bright: around the hovered node, or what Focus keeps bright around the selected tag.
  private hover?: Node3D; private center?: string; private lit?: Set<string>;
  // Without drag tension, where each grabbed node came from and active return springs.
  private homes = new Map<Node3D, Point>(); private springs = new Map<Node3D, { from: Point; start: number }>();
  // Nodes are drawn in two instanced meshes (lit opaque and faded transparent), while each node keeps an invisible pick sphere
  // for 3d-force-graph pointer events. Links are drawn by three objects (solid, dashed, arrows) instead of one draw call each.
  private litDots?: InstancedMesh<SphereGeometry, MeshLambertMaterial>; private fadedDots?: InstancedMesh<SphereGeometry, MeshLambertMaterial>;
  private litDotMaterial?: MeshLambertMaterial; private fadedDotMaterial?: MeshLambertMaterial;
  private dotsDirty = true; private dotColor?: Color;
  private lines?: LineSegments<BufferGeometry, LineBasicMaterial>; private dashes?: LineSegments<BufferGeometry, LineDashedMaterial>;
  private arrows?: InstancedMesh<ConeGeometry, MeshLambertMaterial>; private cone?: ConeGeometry; private arrowMaterial?: MeshLambertMaterial;
  private solid: Link3D[] = []; private related: Link3D[] = []; private pointed: Link3D[] = [];
  private linkPositions = new Float64Array(0);
  private linksDirty = true;
  private arrowTransform?: Object3D; private arrowUp?: Vector3; private arrowDirection?: Vector3;

  private visible = false;
  private pendingDraw?: string;
  private pendingRecolor = false;
  private syncModes = () => {};
  private get app() { return this.owner.app; }
  constructor(readonly contentEl: HTMLElement, private owner: TagOntologyPlugin, private leaf: WorkspaceLeaf) { super(); }

  async open(): Promise<void> {
    const root = this.contentEl;
    root.empty(); root.addClass('tag-ontology-3d');
    this.stage = root.createDiv('tag-ontology-3d-stage');
    const overlay = root.createDiv('tag-ontology-overlay'), tools = overlay.createDiv('tag-ontology-tools'), actions = overlay.createDiv('tag-ontology-actions'), recenter = this.recenter = overlay.createDiv('tag-ontology-recenter');
    recenter.hidden = true;
    this.legend = overlay.createDiv('tag-ontology-legend');
    const stopLegend = renderDepthLegend(this.legend, this.owner.settings, { color: (depth, color) => { void this.owner.setPaletteColor(depth, color); },
      choose: key => { void this.owner.choosePalette(key); }, save: () => this.owner.promptSavePalette() });
    this.register(() => stopLegend?.());
    this.status = overlay.createDiv('tag-ontology-status'); this.status.setAttribute('role', 'status');
    const native = this.owner.native;
    this.button(actions, 'chevrons-down-up', 'Collapse all', () => native.collapseAll(this.leaf), 'top');
    this.button(actions, 'chevrons-up-down', 'Expand all', () => native.expandAll(this.leaf), 'top');
    // Fit wins over a flight still waiting for a second click, which the toolbar's press, outside the stage, doesn't cancel.
    this.button(actions, 'scan', 'Fit', () => this.fit(), 'top');
    this.button(recenter, 'locate-fixed', 'Center on selected tag', () => { const tag = native.selectedTag; if (tag) this.focusOn(tag); }, 'top');
    for (const [key, icon, name] of TOGGLES) {
      this.toggles[key] = this.button(tools, icon, name, () => native.toggleFilter(key));
      this.toggles[key].addClass('tag-ontology-toggle');
    }
    tools.createDiv('tag-ontology-separator');
    this.button(tools, 'book-open-check', 'Dictionary check', () => native.checkDictionary());
    // The same mode controls as the core graph and ontology explorer.
    tools.createDiv('tag-ontology-separator');
    this.syncModes = graphModeBar(tools, this.owner, this.leaf);
    this.controlPanel(root);
    this.colors = this.readColors(); this.font = this.readFont();
    this.status.setText('Loading the graph…');
    const three = this.three = await import('./three.ts');
    if (this.closed) return;
    let created: Graph;
    try { created = new three.ForceGraph3D(this.stage, { controlType: 'orbit' }) as unknown as Graph; }
    catch (error) {
      // Without WebGL (hardware acceleration off, or a GPU Chromium blocks) there is nothing to draw on.
      console.error('Tag Ontology:', error);
      this.status.setText('Could not start the graph. It needs hardware acceleration, which is in the advanced settings.');
      return;
    }
    this.ball = new three.SphereGeometry(1, 16, 12);
    this.pickMaterial = new three.MeshBasicMaterial({ visible: false });
    this.litDotMaterial = new three.MeshLambertMaterial();
    this.fadedDotMaterial = new three.MeshLambertMaterial({ transparent: true, opacity: FADED_NODE });
    this.forward = new three.Vector3();
    const graph = this.graph = created
      .backgroundColor(this.colors.background)
      .showNavInfo(false)
      .nodeLabel(() => '')
      // The node's radius, so arrows stop at its edge.
      .nodeRelSize(1)
      .nodeVal(node => node.radius ** 3)
      .nodeThreeObject(node => this.nodeObject(node))
      // The links still pull on the layout, but this view draws them itself (see placeLinks).
      .linkVisibility(false)
      .onNodeHover(item => { this.hover = item ?? undefined; this.contentEl.toggleClass('is-pointing', !!item); this.paint(); })
      .onNodeClick(item => this.click(item))
      .onNodeDrag((item, translate) => this.grab(item, translate))
      .onNodeDragEnd(item => this.release(item))
      .onEngineTick(() => { if (this.restoreAlphaMin && !this.dragging) { this.restoreAlphaMin = false; this.graph?.d3AlphaMin(ALPHA_MIN); } })
      // The layout stops once it has cooled down rather than after a set time on the clock, so a tab paused in the background
      // carries on where it left off when shown again.
      .cooldownTime(Infinity)
      .d3AlphaMin(ALPHA_MIN);
    this.applyForces();
    this.controls = graph.controls() as ControlsLike;
    this.controls.addEventListener('change', this.onControlChange);
    const canvas = (graph.renderer() as { domElement?: HTMLElement }).domElement;
    if (canvas) {
      const onLost = (event: Event) => { event.preventDefault(); graph.pauseAnimation(); };
      const onRestored = () => { if (!this.closed) { this.paint(); if (this.isVisible()) graph.resumeAnimation(); } };
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      this.register(() => {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      });
    }
    graph.d3Force('gravity', this.gravity());
    graph.scene().fog = new three.Fog(this.colors.background, 1, 1000);
    // Related links are dashed, as in 2D. Hierarchy links always show their direction with an arrow. The objects span the whole
    // graph and move every frame, so they are never culled.
    this.lines = new three.LineSegments(new three.BufferGeometry(), new three.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: LINK_OPACITY }));
    this.dashes = new three.LineSegments(new three.BufferGeometry(), new three.LineDashedMaterial({ vertexColors: true, transparent: true, opacity: LINK_OPACITY, dashSize: DASH, gapSize: GAP }));
    this.cone = new three.ConeGeometry(ARROW / 4, ARROW, 8);
    this.arrowMaterial = new three.MeshLambertMaterial({ transparent: true, opacity: LINK_OPACITY });
    for (const object of [this.lines, this.dashes]) { object.frustumCulled = false; graph.scene().add(object); }
    // Fog and label fading follow the camera; three calls this before drawing every frame of the library's own loop.
    graph.scene().onBeforeRender = () => this.frame();
    // A tab in the background has no size; the library would keep drawing it every frame, so it pauses until shown again.
    this.resize = new ResizeObserver(() => {
      const width = this.stage?.clientWidth ?? 0, height = this.stage?.clientHeight ?? 0;
      if (!this.visible || !width || !height) { graph.pauseAnimation(); return; }
      this.flushDraw();
      graph.width(width).height(height).resumeAnimation();
    });
    this.resize.observe(this.stage);
    // A fit still waiting for the layout to spread, or a flight waiting for a second click, gives way once the user moves the
    // camera, as in 2D. A second click cancels the flight with its press.
    for (const type of ['pointerdown', 'wheel'] as const) this.registerDomEvent(this.stage, type, () => {
      window.clearTimeout(this.fitTimer); window.clearTimeout(this.flyTimer);
      if (type === 'wheel') this.flyDest = undefined;
    }, { capture: true });
    this.registerDomEvent(this.stage, 'pointermove', event => { if (event.buttons) this.flyDest = undefined; }, { capture: true });
    // Letting go of a dragged node, the library sends the page a made-up touch pointerup, which the orbit controls can't match to
    // the mouse, so they throw. The real pointerup comes right after and ends them, so the made-up one is stopped.
    this.registerDomEvent(this.contentEl.doc, 'pointerup', event => { if (!event.isTrusted && event.pointerType === 'touch') event.stopImmediatePropagation(); }, { capture: true });
    this.registerEvent(this.app.workspace.on('css-change', () => this.recolor()));
    // Obsidian's accent color setting only rewrites the accent variables on <body>, with no css-change, so <body> is watched too.
    const accentWatch = new MutationObserver(() => this.recolor());
    accentWatch.observe(this.contentEl.doc.body, { attributes: true, attributeFilter: ['style'] });
    this.register(() => accentWatch.disconnect());
    this.owner.native.link(this);
    this.draw('refresh');
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.flushDraw();
    if (visible && this.stage?.clientWidth && this.stage.clientHeight) this.graph?.width(this.stage.clientWidth).height(this.stage.clientHeight).resumeAnimation();
    else this.graph?.pauseAnimation();
    this.syncModes();
  }

  isVisible() { return this.visible && this.contentEl.isShown(); }

  private flushDraw() {
    if (!this.isVisible()) return;
    if (this.pendingRecolor) this.recolor();
    if (!this.pendingDraw) return;
    const operation = this.pendingDraw; this.pendingDraw = undefined; this.draw(operation);
  }

  // The WebGL context and GPU resources go with the graph tab.
  onunload(): void {
    this.closed = true;
    this.owner.native.unlink(this);
    this.resize?.disconnect();
    this.controls?.removeEventListener('change', this.onControlChange); this.controls = undefined; this.flyDest = undefined;
    window.clearTimeout(this.fitTimer); window.clearTimeout(this.flyTimer);
    const graph = this.graph;
    if (graph) {
      graph.pauseAnimation();
      graph.scene().traverse(object => {
        const { geometry, material } = object as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
        geometry?.dispose();
        for (const each of [material ?? []].flat()) { (each as Material & { map?: Texture }).map?.dispose(); each.dispose(); }
      });
      this.ball?.dispose(); this.pickMaterial?.dispose();
      this.litDotMaterial?.dispose(); this.fadedDotMaterial?.dispose();
      this.litDots?.dispose(); this.fadedDots?.dispose(); this.arrows?.dispose();
      graph.renderer().forceContextLoss(); graph.renderer().dispose();
      graph._destructor();
    }
    this.graph = undefined; this.litDots = undefined; this.fadedDots = undefined; this.nodes.clear(); this.links = []; this.shape = undefined;
    this.homes.clear(); this.springs.clear(); this.dragging = false; this.restoreAlphaMin = false; this.pendingRecolor = false;
    this.contentEl.empty();
  }

  draw(operation: string) {
    this.syncModes();
    if (!this.isVisible()) { this.pendingDraw = this.pendingDraw === 'refresh' || operation === 'refresh' ? 'refresh' : operation; return; }
    const graph = this.graph, model = this.owner.model, settings = this.owner.settings;
    if (!graph || !this.status) return;
    if (this.legend) renderDepthLegend(this.legend, settings, { color: (depth, color) => { void this.owner.setPaletteColor(depth, color); },
      choose: key => { void this.owner.choosePalette(key); }, save: () => this.owner.promptSavePalette() });
    if (!model) { this.status.setText(this.owner.error ? `Could not load the tag dictionary: ${this.owner.error}` : 'Loading the tag dictionary…'); return; }
    const first = !this.layer;
    if (operation === 'refresh' || !this.base) this.base = this.owner.graphData();
    const layer = this.layer = buildLayer(this.base, model, { expanded: new Set(settings.expanded), showNotes: settings.showNotes, showRelated: settings.showRelated });
    const data = layer.data.nodes, degree = new Map<string, number>(), next = new Map<string, Node3D>(), fresh: Node3D[] = [];
    const links: Link3D[] = [];
    for (const [id, node] of Object.entries(data)) for (const target of Object.keys(node.links)) {
      if (!Object.hasOwn(data, target)) continue;
      links.push({ source: id, target, kind: layer.kinds.get(edgeKey(id, target)) ?? 'note' });
      degree.set(id, (degree.get(id) ?? 0) + 1); degree.set(target, (degree.get(target) ?? 0) + 1);
    }
    for (const [id, node] of Object.entries(data)) {
      // Keeping a node's object keeps its position, so expanding moves notes over to the child tags instead of starting over.
      const kept = this.nodes.get(id), item: Node3D = kept ?? { id, type: node.type, name: '', degree: 0, radius: 0 };
      if (!kept) fresh.push(item);
      item.type = node.type; item.tag = layer.resolved.tagOf.get(id);
      item.name = node.type === 'tag' ? id : basename(id);
      item.degree = degree.get(id) ?? 0; item.radius = radiusOf(item.degree);
      this.size(item);
      next.set(id, item);
    }
    // A new node starts beside a node it links to that is already on screen. The neighbor table is built once, not per node.
    if (fresh.length && this.nodes.size) {
      const near = new Map<string, string[]>();
      const add = (from: string, to: string) => { const list = near.get(from); if (list) list.push(to); else near.set(from, [to]); };
      for (const link of links) { add(idOf(link.source), idOf(link.target)); add(idOf(link.target), idOf(link.source)); }
      for (const item of fresh) {
        const anchor = this.nodes.get((near.get(item.id) ?? []).find(id => this.nodes.has(id)) ?? '');
        if (anchor?.x === undefined) continue;
        const jitter = () => (Math.random() - 0.5) * 6;
        item.x = anchor.x + jitter(); item.y = (anchor.y ?? 0) + jitter(); item.z = (anchor.z ?? 0) + jitter();
      }
    }
    for (const [id, old] of this.nodes) {
      if (next.has(id)) continue;
      if (old.label) { old.label.material.map?.dispose(); old.label.material.dispose(); }
    }
    this.nodes = next;
    // Notes are edited far more often than their tags and links change. Handing the library the same graph again would heat
    // the layout up and rebuild every line, so an edit that changes nothing it draws leaves it still, as 2D does.
    const shape = JSON.stringify([[...next.keys()], links.map(link => [link.source, link.target, link.kind])]);
    if (shape !== this.shape) { this.shape = shape; this.links = links; graph.graphData({ nodes: [...next.values()], links }); this.buildDots(); this.buildLinks(); }
    if (operation.startsWith('expand:')) this.moved = true;
    this.paint();
    const notes = [...next.values()].filter(item => item.type !== 'tag').length;
    this.status.setText(`${layer.resolved.visible.size} / ${model.placed.size} tags · ${notes} notes · ${model.roots.length} roots`);
    for (const [key, , name] of TOGGLES) {
      const button = this.toggles[key], on = settings[key];
      button?.toggleClass('is-active', on); button?.setAttribute('aria-pressed', String(on));
      if (button) setTooltip(button, `${name}: ${on ? 'shown' : 'hidden'}`, { placement: 'right' });
    }
    // The layout needs a moment to spread before it can be fitted.
    if (first || operation === 'roots' || operation === 'expand-all') {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = window.setTimeout(() => this.fit(), first ? 1500 : 900);
    }
  }

  // As in 2D: the hovered node takes the accent color and so do its links, and everything not linked to it fades. With Focus on and
  // nothing hovered, what Focus keeps around the selected tag stays bright; a selected tag collapsed out of sight fades nothing.
  paint() {
    const graph = this.graph, layer = this.layer, model = this.owner.model, settings = this.owner.settings, tag = this.owner.native.selectedTag;
    this.center = this.hover?.id; this.lit = undefined;
    if (this.hover) {
      this.lit = new Set([this.hover.id]);
      for (const link of this.links) {
        const source = idOf(link.source), target = idOf(link.target);
        if (source === this.center) this.lit.add(target);
        if (target === this.center) this.lit.add(source);
      }
    } else if (settings.focus && tag && model && layer?.resolved.visible.has(tag)) {
      // The selected tag looks hovered, as in 2D.
      this.center = layer.resolved.idOf.get(tag);
      this.lit = focusIds(layer.data, layer.resolved, model, tag, { descendants: settings.focusDescendants, notes: settings.focusNotes });
    }
    this.dotsDirty = true;
    if (graph) { this.placeDots(); this.colorLinks(); }
    this.syncRecenter();
  }

  private syncRecenter() {
    if (!this.recenter) return;
    const tag = this.owner.native.selectedTag, visible = !!tag && !!this.layer?.resolved.visible.has(tag);
    this.recenter.hidden = !visible || (!this.moved && this.centeredTag === tag);
  }

  has(tag: string) { return !!this.layer?.resolved.range.has(tag); }

  // The tag may have only just come into view, so this waits until the simulation has placed it, for up to two seconds.
  focusOn(tag: string) {
    window.clearTimeout(this.flyTimer);
    const id = this.layer?.resolved.idOf.get(tag), started = performance.now();
    if (id !== undefined) { this.centeredTag = tag; this.moved = false; this.syncRecenter(); }
    const attempt = () => {
      const item = id === undefined ? undefined : this.nodes.get(id);
      if (item?.x !== undefined) { this.flyTo(item); return; }
      if (performance.now() - started < 2000) this.flyTimer = window.setTimeout(attempt, 100);
    };
    attempt();
  }

  // A click selects a dictionary tag at once; a second click soon after expands or collapses it, as in 2D. The flight to it
  // waits until a second click can no longer come: flying at once moved a tag off to the side out from under the pointer, so
  // the second click missed it. A note opens in a new tab; a tag the dictionary lacks does nothing.
  private click(item: Node3D) {
    const native = this.owner.native, double = native.isDouble(item.id);
    if (item.tag) {
      native.clickTag(item.tag, double, this.leaf);
      if (!double) {
        this.centeredTag = item.tag; this.moved = false; this.syncRecenter();
        this.flyTimer = window.setTimeout(() => this.flyTo(item), DOUBLE_CLICK_MS);
      }
    }
    else if (item.type !== 'tag' && !double) native.openNote(item.id);
  }

  private flyTo(item: Node3D) {
    const graph = this.graph;
    if (!graph || item.x === undefined) return;
    // A tag the user asked for wins over a fit still waiting for the layout.
    window.clearTimeout(this.fitTimer);
    const camera = graph.cameraPosition(), at = { x: item.x, y: item.y ?? 0, z: item.z ?? 0 };
    const dx = camera.x - at.x, dy = camera.y - at.y, dz = camera.z - at.z, length = Math.hypot(dx, dy, dz) || 1;
    const dest = { x: at.x + dx / length * FLY_DISTANCE, y: at.y + dy / length * FLY_DISTANCE, z: at.z + dz / length * FLY_DISTANCE };
    this.flyDest = { ...dest, until: performance.now() + FLY_MS + 1000 };
    graph.cameraPosition(dest, at, FLY_MS);
  }

  private lineColor(link: Link3D) {
    const tone = linkTone(idOf(link.source), idOf(link.target), { center: this.center, lit: this.lit, hovered: !!this.hover });
    return tone === 'accent' ? this.colors.accent : tone === 'faded' ? mix(this.colors.line, this.colors.background, 0.7) : this.colors.line;
  }

  // A node object the library builds later (after expanding) takes the highlight in effect then.
  private colorOf(item: Node3D) {
    if (item.id === this.center) return this.colors.accent;
    if (item.type !== 'tag') return this.colors.note;
    return this.owner.settings.customColors ? this.owner.tagColor(item.tag) : this.colors.tag;
  }

  private nodeObject(item: Node3D): Object3D {
    const three = this.three!, group = new three.Object3D();
    // Invisible pick sphere keeps 3d-force-graph hover, click and drag working with zero draw calls; visible spheres are instanced.
    const dot = item.dot = new three.Mesh(this.ball, this.pickMaterial);
    group.add(dot);
    this.size(item);
    return group;
  }

  // Labels are built only when a node comes into range (or focus), avoiding hundreds of off-screen 2D canvases.
  private ensureLabel(item: Node3D) {
    if (item.label) return item.label;
    const three = this.three, group = item.dot?.parent;
    if (!three || !group) return undefined;
    const label = item.label = new three.SpriteText(item.name, TEXT_HEIGHT, this.colors.text);
    label.fontFace = this.font; label.fontSize = FONT_SIZE;
    label.material.depthWrite = false; label.material.transparent = true;
    // Hangs from its top edge just under the node, so it never covers the node at any size.
    label.center.set(0.5, 1);
    // Its size at TEXT_HEIGHT; every frame scales it from this to keep it readable.
    label.userData.base = { x: label.scale.x, y: label.scale.y };
    // Only the node sphere handles pointer events; labels pass hover, drag, and clicks through like in 2D.
    label.raycast = () => {};
    label.position.set(0, -(item.radius + 0.6), 0);
    group.add(label);
    return label;
  }

  private size(item: Node3D) {
    item.dot?.scale.setScalar(item.radius);
    item.label?.position.set(0, -(item.radius + 0.6), 0);
  }

  private buildDots() {
    const three = this.three, scene = this.graph?.scene();
    if (!three || !scene || !this.ball || !this.litDotMaterial || !this.fadedDotMaterial) return;
    const count = Math.max(1, this.nodes.size);
    for (const old of [this.litDots, this.fadedDots]) if (old) { scene.remove(old); old.dispose(); }
    this.litDots = new three.InstancedMesh(this.ball, this.litDotMaterial, count);
    this.fadedDots = new three.InstancedMesh(this.ball, this.fadedDotMaterial, count);
    for (const mesh of [this.litDots, this.fadedDots]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.raycast = () => {};
      scene.add(mesh);
    }
    this.dotsDirty = true;
  }

  private placeDots(moved = false) {
    const three = this.three, litDots = this.litDots, fadedDots = this.fadedDots;
    if (!three || !litDots || !fadedDots || (!this.dotsDirty && !moved)) return;
    this.dotsDirty = false;
    const placed = this.arrowTransform ??= new three.Object3D(), color = this.dotColor ??= new three.Color();
    let litCount = 0, fadedCount = 0;
    for (const item of this.nodes.values()) {
      if (item.x === undefined) { this.dotsDirty = true; continue; }
      placed.position.set(item.x, item.y ?? 0, item.z ?? 0);
      placed.scale.setScalar(item.radius);
      placed.updateMatrix();
      color.set(this.colorOf(item));
      if (!this.lit || this.lit.has(item.id)) {
        litDots.setMatrixAt(litCount, placed.matrix); litDots.setColorAt(litCount, color); litCount++;
      } else {
        fadedDots.setMatrixAt(fadedCount, placed.matrix); fadedDots.setColorAt(fadedCount, color); fadedCount++;
      }
    }
    litDots.count = litCount; fadedDots.count = fadedCount;
    litDots.instanceMatrix.needsUpdate = true; if (litDots.instanceColor) litDots.instanceColor.needsUpdate = true;
    fadedDots.instanceMatrix.needsUpdate = true; if (fadedDots.instanceColor) fadedDots.instanceColor.needsUpdate = true;
  }

  // New buffers for a new set of links: one segment each in the solid or the dashed lines, and an arrow for each hierarchy link.
  private buildLinks() {
    const three = this.three!, scene = this.graph!.scene();
    this.solid = this.links.filter(link => link.kind !== 'related');
    this.related = this.links.filter(link => link.kind === 'related');
    this.pointed = this.links.filter(link => link.kind === 'broader');
    for (const [object, list] of [[this.lines!, this.solid], [this.dashes!, this.related]] as const) {
      object.geometry.dispose();
      object.geometry = new three.BufferGeometry();
      object.geometry.setAttribute('position', new three.BufferAttribute(new Float32Array(list.length * 6), 3));
      object.geometry.setAttribute('color', new three.BufferAttribute(new Float32Array(list.length * 6), 3));
    }
    if (this.arrows) { scene.remove(this.arrows); this.arrows.dispose(); }
    this.arrows = new three.InstancedMesh(this.cone, this.arrowMaterial, Math.max(1, this.pointed.length));
    this.arrows.count = this.pointed.length; this.arrows.frustumCulled = false;
    scene.add(this.arrows);
    this.linksDirty = true;
    this.placeLinks();
  }

  // Every frame, as the layout moves the nodes.
  private placeLinks(): boolean {
    const three = this.three, arrows = this.arrows;
    if (!three || !arrows) return false;
    let changed = this.linksDirty;
    if (this.linkPositions.length !== this.nodes.size * 3) { this.linkPositions = new Float64Array(this.nodes.size * 3); changed = true; }
    let offset = 0;
    for (const node of this.nodes.values()) {
      const x = node.x ?? 0, y = node.y ?? 0, z = node.z ?? 0;
      if (this.linkPositions[offset] !== x || this.linkPositions[offset + 1] !== y || this.linkPositions[offset + 2] !== z) changed = true;
      this.linkPositions[offset++] = x; this.linkPositions[offset++] = y; this.linkPositions[offset++] = z;
    }
    // Orbit and zoom move the camera, not the links; reuse their GPU buffers until nodes move.
    if (!changed) return false;
    this.linksDirty = false;
    const at = (end: string | Node3D) => (typeof end === 'string' ? this.nodes.get(end) : end) ?? { x: 0, y: 0, z: 0, radius: 0 };
    for (const [object, list] of [[this.lines!, this.solid], [this.dashes!, this.related]] as const) {
      const position = object.geometry.getAttribute('position') as InstanceType<Three['BufferAttribute']>, values = position.array as Float32Array;
      list.forEach((link, index) => {
        const from = at(link.source), to = at(link.target);
        const offset = index * 6;
        values[offset] = from.x ?? 0; values[offset + 1] = from.y ?? 0; values[offset + 2] = from.z ?? 0;
        values[offset + 3] = to.x ?? 0; values[offset + 4] = to.y ?? 0; values[offset + 5] = to.z ?? 0;
      });
      position.needsUpdate = true;
    }
    if (this.related.length) this.dashes!.computeLineDistances();
    const placed = this.arrowTransform ??= new three.Object3D(), up = this.arrowUp ??= new three.Vector3(0, 1, 0), direction = this.arrowDirection ??= new three.Vector3();
    this.pointed.forEach((link, index) => {
      const from = at(link.source), to = at(link.target);
      const arrow = arrowAt({ x: from.x ?? 0, y: from.y ?? 0, z: from.z ?? 0 }, { x: to.x ?? 0, y: to.y ?? 0, z: to.z ?? 0 }, to.radius, ARROW);
      // Nodes overlapping leave no line to put an arrow on, so it shrinks to nothing.
      placed.scale.setScalar(arrow ? 1 : 0);
      if (arrow) {
        placed.position.set(arrow.center.x, arrow.center.y, arrow.center.z);
        placed.quaternion.setFromUnitVectors(up, direction.set(arrow.direction.x, arrow.direction.y, arrow.direction.z));
      }
      placed.updateMatrix();
      arrows.setMatrixAt(index, placed.matrix);
    });
    arrows.instanceMatrix.needsUpdate = true;
    return true;
  }

  // Link colors follow the highlight, like the nodes'.
  private colorLinks() {
    const three = this.three, arrows = this.arrows;
    if (!three || !arrows) return;
    const color = new three.Color();
    for (const [object, list] of [[this.lines!, this.solid], [this.dashes!, this.related]] as const) {
      const attribute = object.geometry.getAttribute('color') as InstanceType<Three['BufferAttribute']>, values = attribute.array as Float32Array;
      list.forEach((link, index) => {
        color.set(this.lineColor(link));
        values.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
      });
      attribute.needsUpdate = true;
    }
    this.pointed.forEach((link, index) => arrows.setColorAt(index, color.set(this.lineColor(link))));
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
  }

  // With drag tension on, drop ALPHA_MIN while dragging so alphaTarget(0.3) can wake settled layouts, and restore it on the post-drag tick.
  // With tension off: on every drag move the library asks the layout to warm up, so stopping steps moves only the grabbed node.
  private grab(item: Node3D, translate: Point) {
    if (this.owner.settings.dragTension3d) {
      if (!this.dragging) { this.dragging = true; this.restoreAlphaMin = true; this.graph?.d3AlphaMin(0); }
      return;
    }
    this.graph?.cooldownTicks(0);
    // The first move remembers where the node was; grabbed again while easing back, it keeps that place and stops easing.
    if (!this.homes.has(item)) this.homes.set(item, { x: (item.x ?? 0) - translate.x, y: (item.y ?? 0) - translate.y, z: (item.z ?? 0) - translate.z });
    this.springs.delete(item);
  }

  // When tension is off, the library unpins a node let go; it stays pinned while it eases back, then cools the layout down.
  private release(item: Node3D) {
    if (this.owner.settings.dragTension3d) { this.dragging = false; return; }
    this.graph?.cooldownTicks(Infinity);
    if (!this.homes.has(item)) return;
    const from = { x: item.x ?? 0, y: item.y ?? 0, z: item.z ?? 0 };
    item.fx = from.x; item.fy = from.y; item.fz = from.z;
    this.springs.set(item, { from, start: performance.now() });
  }

  private syncDragMode() {
    if (this.owner.settings.dragTension3d) {
      for (const item of this.springs.keys()) item.fx = item.fy = item.fz = undefined;
      this.springs.clear(); this.homes.clear();
      this.graph?.cooldownTicks(Infinity);
      return;
    }
    this.dragging = false; this.restoreAlphaMin = false;
    this.graph?.d3AlphaMin(ALPHA_MIN);
  }

  private degreeOf(end: string | Node3D) { return this.nodes.get(idOf(end))?.degree ?? 1; }

  // Nodes with no links drift far out on repulsion alone, so the view fits the linked ones; a graph of loose nodes fits them all.
  // The library's own zoomToFit frames every last node from a box corner, which left the graph small in the middle.
  fit() {
    window.clearTimeout(this.fitTimer); window.clearTimeout(this.flyTimer);
    const graph = this.graph;
    if (!graph) return;
    const all = [...this.nodes.values()], linked = all.some(node => node.degree > 0);
    const points = all.filter(node => !linked || node.degree > 0).map(node => ({ x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 }));
    if (!points.length) return;
    this.flyDest = undefined;
    if (!this.moved) { this.moved = true; this.syncRecenter(); }
    // The graph fits in the part of the view the toolbar, legend, status line and settings panel leave uncovered.
    const width = this.contentEl.clientWidth || 1, height = this.contentEl.clientHeight || 1, edge = coveredEdges(this.contentEl);
    const free = { width: Math.max(1, width - edge.left - edge.right) / width, height: Math.max(1, height - edge.top - edge.bottom) / height };
    const camera = graph.camera() as PerspectiveCamera, { center, distance } = fitView(points, camera.fov, camera.aspect, free);
    // The camera keeps the direction it looks from, and looks off center so the graph's middle sits in the middle of the free
    // part: that part's middle lies (shiftX, shiftY) pixels right of and below the view's.
    const target = (graph.controls() as { target: Point }).target, from = camera.position;
    const dx = from.x - target.x, dy = from.y - target.y, dz = from.z - target.z, length = Math.hypot(dx, dy, dz) || 1;
    const perPixel = 2 * distance * Math.tan(camera.fov * Math.PI / 360) / height, m = camera.matrixWorld.elements;
    const shiftX = (edge.left + free.width * width / 2 - width / 2) * perPixel, shiftY = (edge.top + free.height * height / 2 - height / 2) * perPixel;
    // The camera's right and up directions are the first two columns of its world matrix.
    const look = { x: center.x - m[0] * shiftX + m[4] * shiftY, y: center.y - m[1] * shiftX + m[5] * shiftY, z: center.z - m[2] * shiftX + m[6] * shiftY };
    graph.cameraPosition({ x: look.x + dx / length * distance, y: look.y + dy / length * distance, z: look.z + dz / length * distance }, look, 600);
  }

  // The charge and link forces read the settings when set; the center pull reads them every tick (see gravity).
  private applyForces() {
    const graph = this.graph, { repel, link, distance } = this.owner.settings.forces3d;
    if (!graph) return;
    // d3's forces come untyped; these are the calls used on them.
    (graph.d3Force('charge') as unknown as { strength(value: number): void }).strength(repel * REPEL_SCALE);
    // Like d3's default, a link between busy nodes pulls less.
    (graph.d3Force('link') as unknown as { distance(value: number): { strength(value: (link: Link3D) => number): void } })
      .distance(distance * DISTANCE_SCALE).strength(item => link / Math.max(1, Math.min(this.degreeOf(item.source), this.degreeOf(item.target))));
  }

  // The 2D graph pulls every node toward the middle; this does the same on all three axes.
  private gravity() {
    let nodes: Node3D[] = [];
    const force = (alpha: number) => {
      const pull = this.owner.settings.forces3d.center * CENTER_SCALE * alpha;
      for (const node of nodes as (Node3D & { vx: number; vy: number; vz: number })[]) {
        node.vx -= (node.x ?? 0) * pull; node.vy -= (node.y ?? 0) * pull; node.vz -= (node.z ?? 0) * pull;
      }
    };
    force.initialize = (list: Node3D[]) => { nodes = list; };
    return force;
  }

  private frame() {
    const graph = this.graph;
    if (!graph) return;
    const view = graph.camera() as PerspectiveCamera, camera = view.position, target = (graph.controls() as { target: typeof camera }).target;
    // How many pixels tall a TEXT_HEIGHT label is on screen at distance 1.
    const pixels = graph.height() / (2 * Math.tan(view.fov * Math.PI / 360)) * TEXT_HEIGHT;
    const bounds = labelBounds(this.owner.settings.labelSize, this.owner.settings.perspectiveLabels);
    const forward = this.forward ? view.getWorldDirection(this.forward) : undefined;
    let radius = 0;
    const now = performance.now();
    for (const [item, spring] of this.springs) {
      // Pressed again while easing back, it holds still under the pointer, and eases on from there if let go without a move.
      // The library marks a node it is dragging from the press on, before the first move calls grab().
      if ((item as { __initialFixedPos?: unknown }).__initialFixedPos) { spring.from = { x: item.x ?? 0, y: item.y ?? 0, z: item.z ?? 0 }; spring.start = now; continue; }
      const { from, start } = spring, home = this.homes.get(item)!, done = now - start >= SPRING_MS || this.nodes.get(item.id) !== item;
      const at = springBack(from, home, (now - start) / SPRING_MS);
      item.x = item.fx = at.x; item.y = item.fy = at.y; item.z = item.fz = at.z;
      // The scene's positions were already worked out for this frame, so the node's own are brought up to date.
      const object = item.dot?.parent;
      object?.position.set(at.x, at.y, at.z); object?.updateMatrixWorld();
      if (done) { item.fx = item.fy = item.fz = undefined; this.springs.delete(item); this.homes.delete(item); }
    }
    const moved = this.placeLinks();
    this.placeDots(moved);
    for (const item of this.nodes.values()) {
      if (item.x === undefined) continue;
      radius = Math.max(radius, Math.hypot(item.x - target.x, (item.y ?? 0) - target.y, (item.z ?? 0) - target.z));
      const lit = !this.lit || this.lit.has(item.id);
      const distance = Math.hypot(camera.x - item.x, camera.y - (item.y ?? 0), camera.z - (item.z ?? 0));
      const far = Math.min(1, Math.max(0, (LABEL_FAR - distance) / (LABEL_FAR - LABEL_NEAR)));
      // While something is highlighted, its labels stay readable at any distance. A label faded out entirely isn't built or drawn.
      const opacity = !lit ? FADED_LABEL * far : this.lit ? 1 : far;
      if (opacity <= 0) { if (item.label) item.label.visible = false; continue; }
      const label = this.ensureLabel(item);
      if (!label) continue;
      label.material.opacity = opacity;
      label.visible = true;
      // The size on screen follows the depth along the view, not the straight distance, which is longer off to the side.
      const depth = forward ? Math.max(0.001, cameraDepth(camera, forward, { x: item.x, y: item.y ?? 0, z: item.z ?? 0 })) : distance;
      const base = label.userData.base as { x: number; y: number }, scale = labelScale(pixels / depth, bounds.min, bounds.max);
      label.scale.set(base.x * scale, base.y * scale, 1);
    }
    // The fog follows the zoom and the graph's size: what is in front of the orbit center stays clear, the back fades.
    const fog = graph.scene().fog as Fog | null;
    if (fog) { const band = fogRange(camera.distanceTo(target), radius); fog.near = band.near; fog.far = band.far; }
  }

  // Obsidian's graph colors from the theme in use; a theme change repaints with them.
  private readColors() {
    const style = getComputedStyle(this.contentEl), read = (name: string, fallback: string) => cssColorToHex(style.getPropertyValue(name)) ?? fallback;
    return {
      note: read('--graph-node', FALLBACK.note), tag: read('--graph-node-tag', FALLBACK.tag), line: read('--graph-line', FALLBACK.line),
      text: read('--graph-text', FALLBACK.text), background: read('--background-primary', FALLBACK.background), accent: read('--interactive-accent', FALLBACK.accent),
    };
  }

  private readFont() {
    return getComputedStyle(this.contentEl).getPropertyValue('--font-interface').trim() || 'sans-serif';
  }

  private recolor() {
    const graph = this.graph;
    if (!graph) return;
    if (!this.isVisible()) { this.pendingRecolor = true; return; }
    this.pendingRecolor = false;
    const prev = this.colors, next = this.readColors();
    const font = this.readFont(), refont = font !== this.font;
    const textChanged = next.text !== prev.text;
    const changed = refont || next.note !== prev.note || next.tag !== prev.tag || next.line !== prev.line
      || textChanged || next.background !== prev.background || next.accent !== prev.accent;
    if (!changed) return;
    this.colors = next; this.font = font;
    if (next.background !== prev.background) {
      graph.backgroundColor(next.background);
      (graph.scene().fog as Fog | null)?.color.set(next.background);
    }
    if (textChanged || refont) for (const item of this.nodes.values()) {
      const label = item.label;
      if (!label) continue;
      if (textChanged) label.color = next.text;
      // A new font redraws the label at a new width, so its unscaled size is read again.
      if (refont) { label.fontFace = font; label.userData.base = { x: label.scale.x, y: label.scale.y }; }
    }
    this.paint();
  }

  // The label and force settings, in a panel opened with a gear at the top right, built like the 2D graph's settings panel.
  // Every 3D tab reads the label settings each frame, so a change shows at once everywhere; saving waits until the slider stops.
  private controlPanel(root: HTMLElement) {
    // The settings tab replaces the settings object on every change, so each change writes to the current one.
    const owner = this.owner, save = debounce(() => void owner.saveState(), 500, true);
    const panel = root.createDiv('graph-controls is-close tag-ontology-3d-controls');
    // Real buttons, unlike the core panel's, so the keyboard reaches them.
    const close = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-close' });
    const open = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-open' });
    setIcon(close, 'x'); setTooltip(close, 'Close'); setIcon(open, 'settings'); setTooltip(open, 'Open graph settings');
    // A collapsible section with its rows laid out like the core panel's: a toggle beside its name, a slider under it.
    const section = (name: string) => {
      const el = panel.createDiv('tree-item graph-control-section');
      const heading = el.createDiv('tree-item-self mod-collapsible');
      const icon = heading.createDiv('tree-item-icon collapse-icon');
      setIcon(icon, 'right-triangle');
      heading.createDiv('tree-item-inner').createEl('header', { cls: 'graph-control-section-header', text: name });
      const body = el.createDiv('tree-item-children');
      // As in the core panel, the icon carries the state too, which turns it.
      heading.addEventListener('click', () => {
        const collapsed = !el.hasClass('is-collapsed');
        el.toggleClass('is-collapsed', collapsed); icon.toggleClass('is-collapsed', collapsed); body.toggle(!collapsed);
      });
      return body;
    };
    const labels = section('Labels');
    let toggle: ToggleComponent | undefined, slider: SliderComponent | undefined;
    const perspective = new Setting(labels).setName('Perspective labels').addToggle(component => (toggle = component).setValue(owner.settings.perspectiveLabels).onChange(value => {
      if (value !== owner.settings.perspectiveLabels) { owner.settings.perspectiveLabels = value; save(); }
    }));
    perspective.settingEl.addClass('mod-toggle');
    setTooltip(perspective.nameEl, 'Labels grow as you come closer. Off: one size at any distance.');
    // The labels follow the slider while it is dragged.
    new Setting(labels).setName('Label size').addSlider(component => (slider = component).setLimits(LABEL_SIZE.min, LABEL_SIZE.max, LABEL_SIZE.step).setInstant(true)
      .setValue(owner.settings.labelSize).onChange(value => { if (value !== owner.settings.labelSize) { owner.settings.labelSize = value; save(); } }))
      .settingEl.addClass('mod-slider');
    // As in 2D, moving a force slider warms the layout up so it settles into the new balance.
    const forces = section('Forces'), sliders = new Map<keyof Forces, SliderComponent>();
    let tension: ToggleComponent | undefined;
    const dragTension = new Setting(forces).setName('Drag tension').addToggle(component => (tension = component).setValue(owner.settings.dragTension3d).onChange(value => {
      if (value === owner.settings.dragTension3d) return;
      owner.settings.dragTension3d = value; this.syncDragMode(); save();
    }));
    dragTension.settingEl.addClass('mod-toggle');
    setTooltip(dragTension.nameEl, 'Pull connected nodes when dragging. Off: only the dragged node moves.');
    for (const key of Object.keys(FORCES) as (keyof Forces)[]) {
      const { name, min, max, step } = FORCES[key];
      new Setting(forces).setName(name).addSlider(component => { sliders.set(key, component); component.setLimits(min, max, step).setInstant(true)
        .setValue(owner.settings.forces3d[key]).onChange(value => {
          if (value === owner.settings.forces3d[key]) return;
          owner.settings.forces3d = { ...owner.settings.forces3d, [key]: value };
          this.applyForces(); this.graph?.d3ReheatSimulation(); save();
        }); }).settingEl.addClass('mod-slider');
    }
    new Setting(forces).addButton(button => button.setButtonText('Restore defaults').onClick(() => {
      owner.settings.forces3d = { ...DEFAULT_SETTINGS.forces3d };
      owner.settings.dragTension3d = DEFAULT_SETTINGS.dragTension3d;
      tension?.setValue(owner.settings.dragTension3d); this.syncDragMode();
      for (const [key, component] of sliders) component.setValue(owner.settings.forces3d[key]);
      this.applyForces(); this.graph?.d3ReheatSimulation(); save();
    }));
    // Another 3D tab may have changed the settings since this panel was built, so it shows them afresh each time it opens.
    open.addEventListener('click', () => {
      toggle?.setValue(owner.settings.perspectiveLabels); slider?.setValue(owner.settings.labelSize);
      tension?.setValue(owner.settings.dragTension3d);
      for (const [key, component] of sliders) component.setValue(owner.settings.forces3d[key]);
      panel.removeClass('is-close');
    });
    close.addEventListener('click', () => panel.addClass('is-close'));
  }

  private button(parent: HTMLElement, icon: string, label: string, action: () => void, placement: 'right' | 'top' = 'right') {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    setTooltip(button, label, { placement });
    button.addEventListener('click', action);
    return button;
  }
}
