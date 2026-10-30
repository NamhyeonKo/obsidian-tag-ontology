import { ItemView, Setting, debounce, setIcon, setTooltip, type SliderComponent, type ToggleComponent, type WorkspaceLeaf } from 'obsidian';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type SpriteText from 'three-spritetext';
import type { BufferGeometry, ConeGeometry, Fog, InstancedMesh, LineBasicMaterial, LineDashedMaterial, LineSegments, Material, Mesh, MeshLambertMaterial, Object3D, PerspectiveCamera, SphereGeometry, Texture, Vector3 } from 'three';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, focusIds, linkTone, type EdgeKind, type NativeData } from './layer.ts';
import type { LinkedGraph } from './native.ts';
import { LABEL_SIZE, cssColorToHex } from './settings.ts';
import { arrowAt, cameraDepth, fogRange, labelBounds, labelScale } from './geometry3d.ts';

export const VIEW_3D = 'tag-ontology-3d';

interface Node3D {
  id: string; type: string; tag?: string; name: string; degree: number; radius: number;
  x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
  dot?: Mesh<SphereGeometry, MeshLambertMaterial>; label?: SpriteText;
}
interface Link3D { source: string | Node3D; target: string | Node3D; kind: EdgeKind | 'note' }
type Graph = ForceGraph3DInstance<Node3D, Link3D>;
type Layer = ReturnType<typeof buildLayer>;
type Three = typeof import('./three.ts');

// The 2D graph's Display and Forces defaults, in 3D units (the in-view settings panel comes later). Nodes and links start a
// little smaller than 2D's 1, and 2D's default link distance of 250 is 30 here.
const NODE_SIZE = 0.8, LINK_OPACITY = 0.8, REPEL = -10 * 6, LINK_DISTANCE = 250 * 0.12, CENTER = 0.52 * 0.04;
const ARROW = 1.8, DASH = 1.6, GAP = 1.2;
// A click flies the camera this close to the tag, keeping the direction it looks from.
const FLY_DISTANCE = 90, FLY_MS = 1000;
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
export class Graph3DView extends ItemView implements LinkedGraph {
  private graph?: Graph;
  private three?: Three; private ball?: SphereGeometry; private closed = false;
  // Where the camera looks, refreshed every frame.
  private forward?: Vector3;
  private stage?: HTMLElement; private status?: HTMLElement;
  private toggles: Partial<Record<typeof TOGGLES[number][0], HTMLElement>> = {};
  private colors = FALLBACK;
  // The theme's interface font. A canvas can't read CSS variables, so the name is resolved here.
  private font = 'sans-serif';
  private base?: NativeData; private layer?: Layer;
  private nodes = new Map<string, Node3D>(); private links: Link3D[] = [];
  // The node ids and links last handed to the library, to tell an edit that changes nothing it draws.
  private shape?: string;
  private fitTimer?: number; private flyTimer?: number; private resize?: ResizeObserver;
  // The hovered node, and what stays bright: around the hovered node, or what Focus keeps bright around the selected tag.
  private hover?: Node3D; private center?: string; private lit?: Set<string>;
  // Every link is drawn by three objects, solid lines, dashed related lines and the hierarchy arrows, instead of one object
  // each: with thousands of links, one draw call per link was most of a frame.
  private lines?: LineSegments<BufferGeometry, LineBasicMaterial>; private dashes?: LineSegments<BufferGeometry, LineDashedMaterial>;
  private arrows?: InstancedMesh<ConeGeometry, MeshLambertMaterial>; private cone?: ConeGeometry; private arrowMaterial?: MeshLambertMaterial;
  private solid: Link3D[] = []; private related: Link3D[] = []; private pointed: Link3D[] = [];

  constructor(leaf: WorkspaceLeaf, private owner: TagOntologyPlugin) { super(leaf); }
  getViewType(): string { return VIEW_3D; }
  getDisplayText(): string { return '3D tag ontology'; }
  getIcon(): string { return 'box'; }

  async onOpen(): Promise<void> {
    // With the 3D view off, a tab the workspace brings back on start closes before it loads three.js. The plugin closes the
    // tabs open when it is turned off.
    if (!this.owner.settings.enable3d) { this.leaf.detach(); return; }
    const root = this.contentEl;
    root.empty(); root.addClass('tag-ontology-3d');
    this.stage = root.createDiv('tag-ontology-3d-stage');
    const overlay = root.createDiv('tag-ontology-overlay'), tools = overlay.createDiv('tag-ontology-tools');
    this.status = overlay.createDiv('tag-ontology-status'); this.status.setAttribute('role', 'status');
    const native = this.owner.native;
    this.button(tools, 'chevrons-down-up', 'Collapse all', () => native.collapseAll());
    this.button(tools, 'chevrons-up-down', 'Expand all', () => native.expandAll());
    this.button(tools, 'scan', 'Fit', () => this.graph?.zoomToFit(600, 40));
    tools.createDiv('tag-ontology-separator');
    for (const [key, icon, name] of TOGGLES) {
      this.toggles[key] = this.button(tools, icon, name, () => native.toggleFilter(key));
      this.toggles[key].addClass('tag-ontology-toggle');
    }
    tools.createDiv('tag-ontology-separator');
    this.button(tools, 'book-open-check', 'Dictionary check', () => native.checkDictionary());
    // Back to the core graph, under the core graph's own icon.
    tools.createDiv('tag-ontology-separator');
    this.button(tools, 'git-fork', 'Open in 2D', () => { void this.owner.openView(); });
    this.labelPanel(root);
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
    this.ball = new three.SphereGeometry(1, 48, 32);
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
      // A dragged node follows the simulation again once it is let go.
      .onNodeDragEnd(item => { item.fx = undefined; item.fy = undefined; item.fz = undefined; })
      // The layout stops once it has cooled down rather than after a set time on the clock, so a tab paused in the background
      // carries on where it left off when shown again.
      .cooldownTime(Infinity)
      .d3AlphaMin(0.001);
    // d3's forces come untyped; these are the calls used on them.
    (graph.d3Force('charge') as unknown as { strength(value: number): void }).strength(REPEL);
    // Like d3's default, a link between busy nodes pulls less.
    (graph.d3Force('link') as unknown as { distance(value: number): { strength(value: (link: Link3D) => number): void } })
      .distance(LINK_DISTANCE).strength(link => 1 / Math.max(1, Math.min(this.degreeOf(link.source), this.degreeOf(link.target))));
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
      if (!width || !height) { graph.pauseAnimation(); return; }
      graph.width(width).height(height).resumeAnimation();
    });
    this.resize.observe(this.stage);
    // A fit still waiting for the layout to spread gives way once the user moves the camera, as in 2D.
    for (const type of ['pointerdown', 'wheel'] as const) this.registerDomEvent(this.stage, type, () => window.clearTimeout(this.fitTimer), { capture: true });
    this.registerEvent(this.app.workspace.on('css-change', () => this.recolor()));
    // Obsidian's accent color setting only rewrites the accent variables on <body>, with no css-change, so <body> is watched too.
    const accentWatch = new MutationObserver(() => this.recolor());
    accentWatch.observe(this.contentEl.doc.body, { attributes: true, attributeFilter: ['style'] });
    this.register(() => accentWatch.disconnect());
    this.owner.native.link(this);
    this.draw('refresh');
  }

  // The WebGL context and everything on the GPU go with the tab, so opening and closing it again and again doesn't pile them up.
  onClose(): Promise<void> {
    this.closed = true;
    this.owner.native.unlink(this);
    this.resize?.disconnect();
    window.clearTimeout(this.fitTimer); window.clearTimeout(this.flyTimer);
    const graph = this.graph;
    if (graph) {
      graph.pauseAnimation();
      graph.scene().traverse(object => {
        const { geometry, material } = object as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
        geometry?.dispose();
        for (const each of [material ?? []].flat()) { (each as Material & { map?: Texture }).map?.dispose(); each.dispose(); }
      });
      this.ball?.dispose(); this.arrows?.dispose();
      graph.renderer().forceContextLoss(); graph.renderer().dispose();
      graph._destructor();
    }
    this.graph = undefined; this.nodes.clear(); this.links = []; this.shape = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  draw(operation: string) {
    const graph = this.graph, model = this.owner.model, settings = this.owner.settings;
    if (!graph || !this.status) return;
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
    this.nodes = next;
    // Notes are edited far more often than their tags and links change. Handing the library the same graph again would heat
    // the layout up and rebuild every line, so an edit that changes nothing it draws leaves it still, as 2D does.
    const shape = JSON.stringify([[...next.keys()], links.map(link => [link.source, link.target, link.kind])]);
    if (shape !== this.shape) { this.shape = shape; this.links = links; graph.graphData({ nodes: [...next.values()], links }); this.buildLinks(); }
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
      this.fitTimer = window.setTimeout(() => this.graph?.zoomToFit(600, 40), first ? 1500 : 900);
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
    for (const item of this.nodes.values()) item.dot?.material.color.set(this.colorOf(item));
    if (graph) this.colorLinks();
  }

  has(tag: string) { return !!this.layer?.resolved.range.has(tag); }

  // The tag may have only just come into view, so this waits until the simulation has placed it, for up to two seconds.
  focusOn(tag: string) {
    window.clearTimeout(this.flyTimer);
    const id = this.layer?.resolved.idOf.get(tag), started = performance.now();
    const attempt = () => {
      const item = id === undefined ? undefined : this.nodes.get(id);
      if (item?.x !== undefined) { this.flyTo(item); return; }
      if (performance.now() - started < 2000) this.flyTimer = window.setTimeout(attempt, 100);
    };
    attempt();
  }

  // A click selects a dictionary tag at once and flies to it; a second click soon after expands or collapses it, as in 2D.
  // A note opens in a new tab; a tag the dictionary lacks does nothing.
  private click(item: Node3D) {
    const native = this.owner.native, double = native.isDouble(item.id);
    if (item.tag) { native.clickTag(item.tag, double); if (!double) this.flyTo(item); }
    else if (item.type !== 'tag' && !double) native.openNote(item.id);
  }

  private flyTo(item: Node3D) {
    const graph = this.graph;
    if (!graph || item.x === undefined) return;
    // A tag the user asked for wins over a fit still waiting for the layout.
    window.clearTimeout(this.fitTimer);
    const camera = graph.cameraPosition(), at = { x: item.x, y: item.y ?? 0, z: item.z ?? 0 };
    const dx = camera.x - at.x, dy = camera.y - at.y, dz = camera.z - at.z, length = Math.hypot(dx, dy, dz) || 1;
    graph.cameraPosition({ x: at.x + dx / length * FLY_DISTANCE, y: at.y + dy / length * FLY_DISTANCE, z: at.z + dz / length * FLY_DISTANCE }, at, FLY_MS);
  }

  private lineColor(link: Link3D) {
    const tone = linkTone(idOf(link.source), idOf(link.target), { center: this.center, lit: this.lit, hovered: !!this.hover });
    return tone === 'accent' ? this.colors.accent : tone === 'faded' ? mix(this.colors.line, this.colors.background, 0.7) : this.colors.line;
  }

  // A node object the library builds later (after expanding) takes the highlight in effect then.
  private colorOf(item: Node3D) {
    if (item.id === this.center) return this.colors.accent;
    if (item.type !== 'tag') return this.colors.note;
    return this.owner.settings.customColors ? this.owner.tagColor() : this.colors.tag;
  }

  private nodeObject(item: Node3D): Object3D {
    const three = this.three!, group = new three.Object3D();
    const dot = item.dot = new three.Mesh(this.ball, new three.MeshLambertMaterial({ color: this.colorOf(item), transparent: true }));
    group.add(dot);
    // ponytail: every node is still its own sphere and label, two draw calls each (links are drawn together, see placeLinks).
    // With 999 tags and 730 notes all expanded a frame takes about 4 ms; with many thousands of notes shown an instanced sphere
    // mesh and a label atlas would be next.
    const label = item.label = new three.SpriteText(item.name, TEXT_HEIGHT, this.colors.text);
    label.fontFace = this.font; label.fontSize = FONT_SIZE;
    label.material.depthWrite = false; label.material.transparent = true;
    // Hangs from its top edge just under the node, so it never covers the node at any size.
    label.center.set(0.5, 1);
    // Its size at TEXT_HEIGHT; every frame scales it from this to keep it readable.
    label.userData.base = { x: label.scale.x, y: label.scale.y };
    group.add(label);
    this.size(item);
    return group;
  }

  private size(item: Node3D) {
    item.dot?.scale.setScalar(item.radius);
    item.label?.position.set(0, -(item.radius + 0.6), 0);
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
    this.placeLinks();
  }

  // Every frame, as the layout moves the nodes.
  private placeLinks() {
    const three = this.three, arrows = this.arrows;
    if (!three || !arrows) return;
    const at = (end: string | Node3D) => (typeof end === 'string' ? this.nodes.get(end) : end) ?? { x: 0, y: 0, z: 0, radius: 0 };
    for (const [object, list] of [[this.lines!, this.solid], [this.dashes!, this.related]] as const) {
      const position = object.geometry.getAttribute('position') as InstanceType<Three['BufferAttribute']>, values = position.array as Float32Array;
      list.forEach((link, index) => {
        const from = at(link.source), to = at(link.target);
        values.set([from.x ?? 0, from.y ?? 0, from.z ?? 0, to.x ?? 0, to.y ?? 0, to.z ?? 0], index * 6);
      });
      position.needsUpdate = true;
    }
    if (this.related.length) this.dashes!.computeLineDistances();
    const placed = new three.Object3D(), up = new three.Vector3(0, 1, 0), direction = new three.Vector3();
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

  private degreeOf(end: string | Node3D) { return this.nodes.get(idOf(end))?.degree ?? 1; }

  // The 2D graph pulls every node toward the middle; this does the same on all three axes.
  private gravity() {
    let nodes: Node3D[] = [];
    const force = (alpha: number) => {
      const pull = CENTER * alpha;
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
    this.placeLinks();
    for (const item of this.nodes.values()) {
      if (item.x === undefined) continue;
      radius = Math.max(radius, Math.hypot(item.x - target.x, (item.y ?? 0) - target.y, (item.z ?? 0) - target.z));
      const lit = !this.lit || this.lit.has(item.id);
      if (item.dot) item.dot.material.opacity = lit ? 1 : FADED_NODE;
      if (!item.label) continue;
      const distance = Math.hypot(camera.x - item.x, camera.y - (item.y ?? 0), camera.z - (item.z ?? 0));
      const far = Math.min(1, Math.max(0, (LABEL_FAR - distance) / (LABEL_FAR - LABEL_NEAR)));
      // While something is highlighted, its labels stay readable at any distance. A label faded out entirely isn't drawn at all.
      item.label.material.opacity = !lit ? FADED_LABEL * far : this.lit ? 1 : far;
      item.label.visible = item.label.material.opacity > 0;
      // The size on screen follows the depth along the view, not the straight distance, which is longer off to the side.
      const depth = forward ? Math.max(0.001, cameraDepth(camera, forward, { x: item.x, y: item.y ?? 0, z: item.z ?? 0 })) : distance;
      const base = item.label.userData.base as { x: number; y: number }, scale = labelScale(pixels / depth, bounds.min, bounds.max);
      item.label.scale.set(base.x * scale, base.y * scale, 1);
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
    this.colors = this.readColors();
    const font = this.readFont(), refont = font !== this.font;
    this.font = font;
    graph.backgroundColor(this.colors.background);
    (graph.scene().fog as Fog | null)?.color.set(this.colors.background);
    for (const item of this.nodes.values()) {
      const label = item.label;
      if (!label) continue;
      label.color = this.colors.text;
      // A new font redraws the label at a new width, so its unscaled size is read again.
      if (refont) { label.fontFace = font; label.userData.base = { x: label.scale.x, y: label.scale.y }; }
    }
    this.paint();
  }

  // The label settings, in a panel opened with a gear at the top right, built like the 2D graph's settings panel. Every 3D tab
  // reads them each frame, so a change shows at once everywhere; saving waits until the slider stops moving.
  private labelPanel(root: HTMLElement) {
    // The settings tab replaces the settings object on every change, so each change writes to the current one.
    const owner = this.owner, save = debounce(() => void owner.saveState(), 500, true);
    const panel = root.createDiv('graph-controls is-close tag-ontology-3d-controls');
    // Real buttons, unlike the core panel's, so the keyboard reaches them.
    const close = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-close' });
    const open = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-open' });
    setIcon(close, 'x'); setTooltip(close, 'Close'); setIcon(open, 'settings'); setTooltip(open, 'Open label settings');
    // A collapsible section with its rows laid out like the core panel's: a toggle beside its name, a slider under it.
    const section = panel.createDiv('tree-item graph-control-section');
    const heading = section.createDiv('tree-item-self mod-collapsible');
    const icon = heading.createDiv('tree-item-icon collapse-icon');
    setIcon(icon, 'right-triangle');
    heading.createDiv('tree-item-inner').createEl('header', { cls: 'graph-control-section-header', text: 'Labels' });
    const body = section.createDiv('tree-item-children');
    heading.addEventListener('click', () => {
      const collapsed = !section.hasClass('is-collapsed');
      // As in the core panel, the icon carries the state too, which turns it.
      section.toggleClass('is-collapsed', collapsed); icon.toggleClass('is-collapsed', collapsed); body.toggle(!collapsed);
    });
    let toggle: ToggleComponent | undefined, slider: SliderComponent | undefined;
    const perspective = new Setting(body).setName('Perspective labels').addToggle(component => (toggle = component).setValue(owner.settings.perspectiveLabels).onChange(value => {
      if (value !== owner.settings.perspectiveLabels) { owner.settings.perspectiveLabels = value; save(); }
    }));
    perspective.settingEl.addClass('mod-toggle');
    setTooltip(perspective.nameEl, 'Labels grow as you come closer. Off: one size at any distance.');
    // The labels follow the slider while it is dragged.
    new Setting(body).setName('Label size').addSlider(component => (slider = component).setLimits(LABEL_SIZE.min, LABEL_SIZE.max, LABEL_SIZE.step).setInstant(true)
      .setValue(owner.settings.labelSize).onChange(value => { if (value !== owner.settings.labelSize) { owner.settings.labelSize = value; save(); } }))
      .settingEl.addClass('mod-slider');
    // Another 3D tab may have changed the settings since this panel was built, so it shows them afresh each time it opens.
    open.addEventListener('click', () => {
      toggle?.setValue(owner.settings.perspectiveLabels); slider?.setValue(owner.settings.labelSize);
      panel.removeClass('is-close');
    });
    close.addEventListener('click', () => panel.addClass('is-close'));
  }

  private button(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    setTooltip(button, label, { placement: 'right' });
    button.addEventListener('click', action);
    return button;
  }
}
