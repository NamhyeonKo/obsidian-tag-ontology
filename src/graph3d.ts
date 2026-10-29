import { ItemView, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type SpriteText from 'three-spritetext';
import type { Fog, LineDashedMaterial, Material, Mesh, MeshLambertMaterial, Object3D, SphereGeometry, Texture } from 'three';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, type EdgeKind, type NativeData } from './layer.ts';
import type { LinkedGraph } from './native.ts';
import { cssColorToHex } from './settings.ts';

export const VIEW_3D = 'tag-ontology-3d';

interface Node3D {
  id: string; type: string; tag?: string; name: string; degree: number; radius: number;
  x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
  dot?: Mesh<SphereGeometry, MeshLambertMaterial>; label?: SpriteText;
}
interface Link3D { source: string | Node3D; target: string | Node3D; kind: EdgeKind | 'note'; dashes?: LineDashedMaterial }
type Graph = ForceGraph3DInstance<Node3D, Link3D>;
type Layer = ReturnType<typeof buildLayer>;
type Three = typeof import('./three.ts');

// The 2D graph's Display and Forces defaults, in 3D units (the in-view settings panel comes later). Nodes and links start a
// little smaller than 2D's 1, and 2D's default link distance of 250 is 30 here.
const NODE_SIZE = 0.8, LINK_OPACITY = 0.8, REPEL = -10 * 6, LINK_DISTANCE = 250 * 0.12, CENTER = 0.52 * 0.04;
const ARROW = 1.8, DASH = 1.6, GAP = 1.2;
// Labels hang under their node and fade out between these camera distances, as they do when zooming out in 2D.
const TEXT_HEIGHT = 2.2, FONT_SIZE = 48, LABEL_NEAR = 300, LABEL_FAR = 650;
const FONT = 'var(--font-interface)';
// Used when a theme leaves a graph color unset or in a format cssColorToHex can't read.
const FALLBACK = { note: '#b8b8b8', tag: '#55c26a', line: '#5a5a5a', text: '#dadada', background: '#1e1e1e', accent: '#8b6cef' };
const TOGGLES = [['showNotes', 'file-text', 'Notes'], ['showRelated', 'link', 'Related']] as const;

const idOf = (end: string | Node3D) => typeof end === 'string' ? end : end.id;
const basename = (path: string) => path.split('/').at(-1)!.replace(/\.md$/, '');
// Like 2D, a node grows a little with its links.
const radiusOf = (degree: number) => (1.4 + Math.sqrt(degree) * 0.3) * NODE_SIZE;

// The tag hierarchy in three dimensions. It layers the same shared state as the 2D graph, through NativeGraphs.
export class Graph3DView extends ItemView implements LinkedGraph {
  private graph?: Graph;
  private three?: Three; private ball?: SphereGeometry; private closed = false;
  private stage?: HTMLElement; private status?: HTMLElement;
  private toggles: Partial<Record<typeof TOGGLES[number][0], HTMLElement>> = {};
  private colors = FALLBACK;
  private base?: NativeData; private layer?: Layer;
  private nodes = new Map<string, Node3D>(); private links: Link3D[] = [];
  private fitTimer?: number; private resize?: ResizeObserver;

  constructor(leaf: WorkspaceLeaf, private owner: TagOntologyPlugin) { super(leaf); }
  getViewType(): string { return VIEW_3D; }
  getDisplayText(): string { return '3D tag ontology'; }
  getIcon(): string { return 'box'; }

  async onOpen(): Promise<void> {
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
    this.colors = this.readColors();
    this.status.setText('Loading the graph…');
    const three = this.three = await import('./three.ts');
    if (this.closed) return;
    this.ball = new three.SphereGeometry(1, 48, 32);
    const graph = this.graph = (new three.ForceGraph3D(this.stage, { controlType: 'orbit' }) as unknown as Graph)
      .backgroundColor(this.colors.background)
      .showNavInfo(false)
      .nodeLabel(() => '')
      // The node's radius, so arrows stop at its edge.
      .nodeRelSize(1)
      .nodeVal(node => node.radius ** 3)
      .nodeThreeObject(node => this.nodeObject(node))
      .linkColor(() => this.colors.line)
      .linkOpacity(LINK_OPACITY)
      // Hierarchy links always show their direction.
      .linkDirectionalArrowLength(link => link.kind === 'broader' ? ARROW : 0)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor(() => this.colors.line)
      // Related links are dashed, as in 2D; the dashes follow the line as it moves.
      .linkMaterial(link => link.kind === 'related' ? (link.dashes ??= new three.LineDashedMaterial({ color: this.colors.line, dashSize: DASH, gapSize: GAP })) : null)
      .linkPositionUpdate((line, _coords, link) => { if (link.kind === 'related') (line as Object3D & { computeLineDistances?: () => void }).computeLineDistances?.(); })
      .cooldownTime(6000);
    // d3's forces come untyped; these are the calls used on them.
    (graph.d3Force('charge') as unknown as { strength(value: number): void }).strength(REPEL);
    // Like d3's default, a link between busy nodes pulls less.
    (graph.d3Force('link') as unknown as { distance(value: number): { strength(value: (link: Link3D) => number): void } })
      .distance(LINK_DISTANCE).strength(link => 1 / Math.max(1, Math.min(this.degreeOf(link.source), this.degreeOf(link.target))));
    graph.d3Force('gravity', this.gravity());
    graph.scene().fog = new three.Fog(this.colors.background, 1, 1000);
    // Fog and label fading follow the camera; three calls this before drawing every frame of the library's own loop.
    graph.scene().onBeforeRender = () => this.frame();
    this.resize = new ResizeObserver(() => { if (this.stage) graph.width(this.stage.clientWidth).height(this.stage.clientHeight); });
    this.resize.observe(this.stage);
    this.registerEvent(this.app.workspace.on('css-change', () => this.recolor()));
    this.owner.native.link(this);
    this.draw('refresh');
  }

  // The WebGL context and everything on the GPU go with the tab, so opening and closing it again and again doesn't pile them up.
  onClose(): Promise<void> {
    this.closed = true;
    this.owner.native.unlink(this);
    this.resize?.disconnect();
    window.clearTimeout(this.fitTimer);
    const graph = this.graph;
    if (graph) {
      graph.pauseAnimation();
      graph.scene().traverse(object => {
        const { geometry, material } = object as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
        geometry?.dispose();
        for (const each of [material ?? []].flat()) { (each as Material & { map?: Texture }).map?.dispose(); each.dispose(); }
      });
      this.ball?.dispose();
      graph.renderer().forceContextLoss(); graph.renderer().dispose();
      graph._destructor();
    }
    this.graph = undefined; this.nodes.clear(); this.links = [];
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
    this.links = [];
    for (const [id, node] of Object.entries(data)) for (const target of Object.keys(node.links)) {
      if (!Object.hasOwn(data, target)) continue;
      this.links.push({ source: id, target, kind: layer.kinds.get(edgeKey(id, target)) ?? 'note' });
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
      for (const link of this.links) { add(idOf(link.source), idOf(link.target)); add(idOf(link.target), idOf(link.source)); }
      for (const item of fresh) {
        const anchor = this.nodes.get((near.get(item.id) ?? []).find(id => this.nodes.has(id)) ?? '');
        if (anchor?.x === undefined) continue;
        const jitter = () => (Math.random() - 0.5) * 6;
        item.x = anchor.x + jitter(); item.y = (anchor.y ?? 0) + jitter(); item.z = (anchor.z ?? 0) + jitter();
      }
    }
    this.nodes = next;
    graph.graphData({ nodes: [...next.values()], links: this.links });
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

  paint() {
    for (const item of this.nodes.values()) item.dot?.material.color.set(this.colorOf(item));
  }

  has(tag: string) { return !!this.layer?.resolved.range.has(tag); }

  focusOn(_tag: string) {}

  private colorOf(item: Node3D) {
    if (item.type !== 'tag') return this.colors.note;
    return this.owner.settings.customColors ? this.owner.tagColor() : this.colors.tag;
  }

  private nodeObject(item: Node3D): Object3D {
    const three = this.three!, group = new three.Object3D();
    const dot = item.dot = new three.Mesh(this.ball, new three.MeshLambertMaterial({ color: this.colorOf(item), transparent: true }));
    group.add(dot);
    // ponytail: one label texture per node; switch to a label atlas if thousands of visible nodes stutter.
    const label = item.label = new three.SpriteText(item.name, TEXT_HEIGHT, this.colors.text);
    label.fontFace = FONT; label.fontSize = FONT_SIZE;
    label.material.depthWrite = false; label.material.transparent = true;
    // Hangs from its top edge just under the node, so it never covers the node at any size.
    label.center.set(0.5, 1);
    group.add(label);
    this.size(item);
    return group;
  }

  private size(item: Node3D) {
    item.dot?.scale.setScalar(item.radius);
    item.label?.position.set(0, -(item.radius + 0.6), 0);
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
    const camera = graph.camera().position, fog = graph.scene().fog as Fog | null;
    // The fog band follows the zoom: it starts a little in front of the orbit center and ends a bit past it.
    if (fog) { const distance = camera.distanceTo((graph.controls() as { target: typeof camera }).target); fog.near = distance * 0.7; fog.far = distance * 1.7; }
    for (const item of this.nodes.values()) {
      if (item.x === undefined || !item.label) continue;
      const distance = Math.hypot(camera.x - item.x, camera.y - (item.y ?? 0), camera.z - (item.z ?? 0));
      item.label.material.opacity = Math.min(1, Math.max(0, (LABEL_FAR - distance) / (LABEL_FAR - LABEL_NEAR)));
    }
  }

  // Obsidian's graph colors from the theme in use; a theme change repaints with them.
  private readColors() {
    const style = getComputedStyle(this.contentEl), read = (name: string, fallback: string) => cssColorToHex(style.getPropertyValue(name)) ?? fallback;
    return {
      note: read('--graph-node', FALLBACK.note), tag: read('--graph-node-tag', FALLBACK.tag), line: read('--graph-line', FALLBACK.line),
      text: read('--graph-text', FALLBACK.text), background: read('--background-primary', FALLBACK.background), accent: read('--interactive-accent', FALLBACK.accent),
    };
  }

  private recolor() {
    const graph = this.graph;
    if (!graph) return;
    this.colors = this.readColors();
    graph.backgroundColor(this.colors.background);
    (graph.scene().fog as Fog | null)?.color.set(this.colors.background);
    for (const item of this.nodes.values()) if (item.label) item.label.color = this.colors.text;
    for (const link of this.links) link.dashes?.color.set(this.colors.line);
    graph.linkColor(graph.linkColor()).linkDirectionalArrowColor(graph.linkDirectionalArrowColor());
    this.paint();
  }

  private button(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    setTooltip(button, label, { placement: 'right' });
    button.addEventListener('click', action);
    return button;
  }
}
