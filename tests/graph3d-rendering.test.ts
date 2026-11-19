import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import * as THREE from 'three';
import { Ontology } from 'tag-ontology';
import * as layer from '../src/layer.ts';
import * as settings from '../src/settings.ts';
import * as geometry from '../src/geometry3d.ts';

interface Node { id: string; x: number; y: number; z: number; radius: number }
interface Renderer {
  three: typeof THREE; graph: { scene(): THREE.Scene; pauseAnimation(): void; graphData?(data: unknown): void }; nodes: Map<string, Node>;
  status?: { setText(text: string): void };
  draw(operation: string): void; setVisible(visible: boolean): void; pendingDraw?: string;
  links: { source: string | Node; target: string | Node; kind: string }[];
  lines: THREE.LineSegments; dashes: THREE.LineSegments; cone: THREE.ConeGeometry; arrowMaterial: THREE.MeshLambertMaterial;
  arrows: THREE.InstancedMesh; buildLinks(): void; placeLinks(): void;
}
async function setup(owner: object = {}) {
  const context = createContext({ performance: { now: () => 0 }, window: { setTimeout: () => 0, clearTimeout: () => {} } });
  const code = await transform(readFileSync(new URL('../src/graph3d.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? { Component: class {}, ItemView: class {}, Setting: class {}, debounce() {}, setIcon() {}, setTooltip() {} }
      : specifier === './legend.ts' ? { renderDepthLegend() {} }
      : specifier === './graph-modes.ts' ? { graphModeBar() {} }
      : specifier === './native.ts' ? { DOUBLE_CLICK_MS: 200, coveredEdges: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) }
      : specifier === './settings.ts' ? { ...settings } : specifier === './geometry3d.ts' ? { ...geometry } : { ...layer };
    return new SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
  });
  await module.evaluate();
  const Canvas = (module.namespace as unknown as { Graph3DCanvas: new(root: object, owner: object, leaf: object) => Renderer }).Graph3DCanvas;
  const canvas = new Canvas({ isShown: () => true }, owner, {}), scene = new THREE.Scene();
  canvas.three = THREE; canvas.graph = { scene: () => scene, pauseAnimation() {}, graphData() {} };
  canvas.status = { setText() {} };
  canvas.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  canvas.dashes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial());
  canvas.cone = new THREE.ConeGeometry(1, 1, 8); canvas.arrowMaterial = new THREE.MeshLambertMaterial();
  canvas.nodes = new Map([['a', { id: 'a', x: 0, y: 0, z: 0, radius: 1 }], ['b', { id: 'b', x: 20, y: 10, z: 5, radius: 1 }]]);
  canvas.links = [{ source: 'a', target: 'b', kind: 'broader' }, { source: 'b', target: 'a', kind: 'related' }];
  canvas.buildLinks();
  return canvas;
}

test('camera-only frames do not rebuild or upload stationary 3D link geometry', async () => {
  const c = await setup(), position = c.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
  const version = position.version, arrows = c.arrows.instanceMatrix.version;
  for (let frame = 0; frame < 120; frame++) c.placeLinks();
  assert.equal(position.version, version); assert.equal(c.arrows.instanceMatrix.version, arrows);
  c.nodes.get('b')!.x = 30; c.placeLinks();
  assert.equal(position.version, version + 1); assert.equal(position.array[3], 30);
  assert.equal(c.arrows.instanceMatrix.version, arrows + 1);
});

test('changing topology refreshes 3D link buffers even when all positions are unchanged', async () => {
  const c = await setup();
  c.links = [{ source: 'b', target: 'a', kind: 'broader' }]; c.buildLinks();
  assert.deepEqual([...c.lines.geometry.getAttribute('position').array], [20, 10, 5, 0, 0, 0]);
  assert.equal(c.dashes.geometry.getAttribute('position').count, 0);
});

test('hidden 3D updates are coalesced and a full refresh is flushed on return', async () => {
  const c = await setup(), nodes = c.nodes;
  c.draw('refresh'); c.draw('filter');
  assert.equal(c.pendingDraw, 'refresh'); assert.equal(c.nodes, nodes);
  const operations: string[] = [];
  c.draw = operation => { operations.push(operation); };
  c.setVisible(true);
  assert.deepEqual(operations, ['refresh']); assert.equal(c.pendingDraw, undefined);
  c.setVisible(false); c.setVisible(true);
  assert.deepEqual(operations, ['refresh'], 'unchanged visibility must not force another redraw');
});

test('settings redraws reuse base graphData and do not drop queued vault refreshes', async () => {
  let baseBuilds = 0;
  const model = new Ontology({ root: { description: '', broader: [] } }, [{ path: 'A.md', tags: ['root'] }]);
  const owner = {
    model,
    settings: { ...settings.DEFAULT_SETTINGS },
    native: { selectedTag: undefined },
    tagColor: () => '#123456',
    graphData: () => { baseBuilds++; return { nodes: { 'A.md': { type: '', links: { '#root': true } }, '#root': { type: 'tag', links: {} } }, numLinks: 0 }; },
  };
  const c = await setup(owner);
  c.setVisible(true);
  c.draw('refresh');
  assert.equal(baseBuilds, 1);

  c.draw('settings');
  assert.equal(baseBuilds, 1, 'settings redraws do not rebuild vault graphData');

  c.setVisible(false);
  c.draw('refresh');
  c.draw('settings');
  assert.equal(c.pendingDraw, 'refresh', 'pending note/vault refresh is preserved across subsequent settings redraw');
  c.setVisible(true);
  assert.equal(baseBuilds, 2);
});

class El {
  children: El[] = []; classes = new Set<string>(); attrs: Record<string, string> = {}; hidden = false; text = '';
  events = new Map<string, ((e?: unknown) => void)[]>();
  doc = { body: { style: '' }, addEventListener() {} };
  createDiv(cls = '') { const child = new El(); for (const c of cls.split(' ')) if (c) child.classes.add(c); this.children.push(child); return child; }
  createEl(_tag: string, opts?: { cls?: string }) { return this.createDiv(opts?.cls); }
  setText(t: string) { this.text = t; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  setCssProps() {}
  querySelectorAll() { return []; } querySelector() { return null; }
  addClass(cls: string) { this.classes.add(cls); } removeClass(cls: string) { this.classes.delete(cls); }
  hasClass(cls: string) { return this.classes.has(cls); }
  toggleClass(cls: string, on: boolean) { if (on) this.classes.add(cls); else this.classes.delete(cls); }
  toggle(show: boolean) { this.hidden = !show; }
  empty() { this.children = []; } isShown() { return true; }
  get clientWidth() { return 800; } get clientHeight() { return 600; }
  addEventListener(type: string, fn: (e?: unknown) => void) { const list = this.events.get(type) ?? []; list.push(fn); this.events.set(type, list); }
  removeEventListener(type: string, fn: (e?: unknown) => void) { const list = this.events.get(type); if (list) this.events.set(type, list.filter(item => item !== fn)); }
  all(): El[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

async function openCanvas(opts: {
  owner: object;
  fakeGraph: object;
  now?: () => number;
  cssVar?: (name: string) => string;
  onMutationObserver?: (cb: () => void) => void;
  SpriteText?: unknown;
}) {
  const root = new El();
  const context = createContext({
    performance: { now: () => opts.now?.() ?? 0 },
    window: { setTimeout: () => 0, clearTimeout: () => {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { constructor(cb: () => void) { opts.onMutationObserver?.(cb); } observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: (name: string) => opts.cssVar?.(name) ?? '' }),
    createEl: () => ({ getContext: () => ({ fillRect() {}, measureText: () => ({ width: 20 }) }) }),
  });
  const code = await transform(readFileSync(new URL('../src/graph3d.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const threeMock = { ...THREE, ...(opts.SpriteText ? { SpriteText: opts.SpriteText } : {}), ForceGraph3D: class { constructor() { return opts.fakeGraph; } } };
  const module = new SourceTextModule(code.code, {
    context,
    importModuleDynamically: async () => {
      const m = new SyntheticModule(Object.keys(threeMock), function () { for (const [k, v] of Object.entries(threeMock)) this.setExport(k, v); }, { context });
      await m.link(() => { throw new Error('unexpected'); }); await m.evaluate(); return m;
    },
  });
  const toggles = new Map<string, (value: boolean) => void>(), toggleValues = new Map<string, unknown>(), buttons = new Map<string, () => void>();
  const control = (name: string) => {
    const api = {
      setValue(value: unknown) { toggleValues.set(name, value); return api; },
      setLimits() { return api; }, setInstant() { return api; },
      onChange(fn: (value: boolean) => void) { toggles.set(name, fn); return api; },
      setButtonText(label: string) { name = label; return api; },
      onClick(fn: () => void) { buttons.set(name, fn); return api; },
    };
    return api;
  };
  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? {
      Component: class { register() {} registerEvent() {} registerDomEvent(el: El, type: string, fn: (e?: unknown) => void) { el.addEventListener(type, fn); } },
      ItemView: class {},
      Setting: class { name = ''; nameEl = new El(); settingEl = new El(); setName(name: string) { this.name = name; return this; } addToggle(fn: (c: ReturnType<typeof control>) => void) { fn(control(this.name)); return this; } addSlider(fn: (c: ReturnType<typeof control>) => void) { fn(control(this.name)); return this; } addButton(fn: (c: ReturnType<typeof control>) => void) { fn(control(this.name)); return this; } },
      debounce: (fn: () => void) => fn, setIcon(el: El, id: string) { el.attrs.icon = id; }, setTooltip(el: El, text: string) { el.attrs['aria-label'] = text; },
    }
      : specifier === './legend.ts' ? { renderDepthLegend() {} }
      : specifier === './graph-modes.ts' ? { graphModeBar() { return () => {}; } }
      : specifier === './native.ts' ? { DOUBLE_CLICK_MS: 200, coveredEdges: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) }
      : specifier === './settings.ts' ? { ...settings } : specifier === './geometry3d.ts' ? { ...geometry } : { ...layer };
    return new SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context });
  });
  await module.evaluate();
  const Canvas = (module.namespace as unknown as {
    Graph3DCanvas: new(root: El, owner: object, leaf: object) => Renderer & { ball: THREE.SphereGeometry; open(): Promise<void>; focusOn(tag: string): void; fit(): void; paint(): void; unload?(): void; onunload(): void };
  }).Graph3DCanvas;
  const canvas = new Canvas(root, opts.owner, {});
  canvas.setVisible(true);
  await canvas.open();
  return { canvas, root, toggles, toggleValues, buttons };
}

test('recenter button tracks 3D focus, tween arrival, user camera change, wheel interrupt, fit, and expand', async () => {
  const controlListeners = new Map<string, Set<() => void>>();
  let camPos = { x: 0, y: 0, z: 200 }, lastTarget: { x: number; y: number; z: number } | undefined;
  let alphaMin = 0, cooldownTicks = Infinity;
  let onDrag: ((item: unknown, translate: { x: number; y: number; z: number }) => void) | undefined, onDragEnd: ((item: unknown) => void) | undefined, onTick: (() => void) | undefined;
  const fakeGraph = {
    backgroundColor() { return this; }, showNavInfo() { return this; }, nodeLabel() { return this; }, nodeRelSize() { return this; },
    nodeVal() { return this; }, nodeThreeObject() { return this; }, linkVisibility() { return this; }, onNodeHover() { return this; },
    onNodeClick() { return this; },
    onNodeDrag(fn: (item: unknown, translate: { x: number; y: number; z: number }) => void) { onDrag = fn; return this; },
    onNodeDragEnd(fn: (item: unknown) => void) { onDragEnd = fn; return this; },
    onEngineTick(fn: () => void) { onTick = fn; return this; },
    cooldownTime() { return this; },
    cooldownTicks(v?: number) { if (v === undefined) return cooldownTicks; cooldownTicks = v; return this; },
    d3AlphaMin(v?: number) { if (v === undefined) return alphaMin; alphaMin = v; return this; },
    width() { return this; }, height() { return this; },
    d3Force: () => ({ strength() { return this; }, distance() { return this; } }),
    d3ReheatSimulation() {}, pauseAnimation() {}, resumeAnimation() {},
    scene: () => Object.assign(new THREE.Scene(), { fog: undefined, onBeforeRender: undefined }),
    camera: () => ({ position: camPos, fov: 45, aspect: 1.33, matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] } }),
    controls: () => ({
      target: { x: 0, y: 0, z: 0 },
      addEventListener(type: string, fn: () => void) { const s = controlListeners.get(type) ?? new Set(); s.add(fn); controlListeners.set(type, s); },
      removeEventListener(type: string, fn: () => void) { controlListeners.get(type)?.delete(fn); },
    }),
    cameraPosition(pos?: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }) {
      if (!pos) return { ...camPos };
      lastTarget = pos; void lookAt; return this;
    },
    graphData() { return this; },
    renderer: () => ({ forceContextLoss() {}, dispose() {} }), _destructor() {},
  };
  let now = 0;
  let saved = 0;
  const model = new Ontology({ root: { description: '', broader: [] }, leaf: { description: '', broader: ['root'] } }, []);
  const owner = {
    model,
    settings: { ...settings.DEFAULT_SETTINGS },
    saveState() { saved++; },
    native: { selectedTag: 'root' as string | undefined, renderPanel() {}, link() {}, unlink() {}, isDouble: () => false, clickTag() {}, toggleFilter() {}, checkDictionary() {}, collapseAll() {}, expandAll() {} },
    tagColor: () => '#123456',
    app: { workspace: { on: () => () => {} } },
    graphData: () => ({ nodes: { '#root': { type: 'tag', links: {} }, '#leaf': { type: 'tag', links: {} } }, numLinks: 0 }),
  };
  const { canvas: c, root, toggles, toggleValues, buttons } = await openCanvas({ owner, fakeGraph, now: () => now });
  const recenter = root.all().find(el => el.classes.has('tag-ontology-recenter'))!;
  const recenterBtn = root.all().find(el => el.attrs['aria-label'] === 'Center on selected tag')!;
  const emitChange = () => controlListeners.get('change')?.forEach(fn => fn());

  assert.equal(recenter.hidden, false, 'shown initially when a tag is already selected without focusing');
  c.nodes.get('#root')!.x = 0; c.nodes.get('#root')!.y = 0; c.nodes.get('#root')!.z = 0;
  recenterBtn.events.get('click')![0]();
  assert.equal(recenter.hidden, true, 'hides when clicking recenter flies to selected tag');

  // Simulate mid-flight tween updates even past nominal duration until destination arrival.
  now = 1500;
  emitChange();
  assert.equal(recenter.hidden, true, 'ignores late tween frames while still away from destination');
  camPos = { ...lastTarget! };
  emitChange();
  assert.equal(recenter.hidden, true, 'arriving at destination completes flight without marking moved');

  camPos = { x: camPos.x + 15, y: camPos.y, z: camPos.z };
  emitChange();
  assert.equal(recenter.hidden, false, 'user orbit or pan shows recenter');

  c.focusOn('root');
  assert.equal(recenter.hidden, true);
  const stage = root.all().find(el => el.classes.has('tag-ontology-3d-stage'))!;
  stage.events.get('wheel')![0]();
  emitChange();
  assert.equal(recenter.hidden, false, 'wheel clears active flight target and shows recenter');

  c.focusOn('root');
  assert.equal(recenter.hidden, true);
  c.draw('expand:root');
  assert.equal(recenter.hidden, false, 'sidebar expand marks layout moved');

  owner.native.selectedTag = 'leaf';
  c.paint();
  assert.equal(recenter.hidden, true, 'hides when the selected tag is collapsed out of view');

  // With dragTension3d on (default), dragging lifts alphaMin so settled layouts wake up and restores it on post-drag tick.
  const dragged = c.nodes.get('#root')! as Node & { fx?: number };
  assert.equal(alphaMin, 0.001);
  onDrag!(dragged, { x: 10, y: 0, z: 0 });
  assert.equal(alphaMin, 0);
  assert.equal(cooldownTicks, Infinity);
  onTick!();
  assert.equal(alphaMin, 0, 'keeps alphaMin off while dragging');
  onDragEnd!(dragged);
  assert.equal(alphaMin, 0, 'waits for a physics tick to raise alpha before restoring alphaMin');
  onTick!();
  assert.equal(alphaMin, 0.001, 'restores alphaMin after post-drag tick');

  const sections = root.all().filter(el => el.classes.has('graph-control-section'));
  assert.equal(sections.length, 2);
  assert.ok(sections.every(el => !el.classes.has('is-collapsed')), 'Labels and Forces sections open expanded by default');
  // With dragTension3d off, dragging stops the simulation and pins the released node to spring back cleanly.
  toggles.get('Drag tension')!(false);
  assert.equal(owner.settings.dragTension3d, false);
  assert.equal(saved, 1);
  onDrag!(dragged, { x: 10, y: 0, z: 0 });
  assert.equal(cooldownTicks, 0);
  onDragEnd!(dragged);
  assert.equal(cooldownTicks, Infinity);
  assert.equal(dragged.fx, dragged.x);
  buttons.get('Restore defaults')!();
  assert.equal(owner.settings.dragTension3d, true);
  assert.equal(toggleValues.get('Drag tension'), true);
  assert.equal(dragged.fx, undefined, 're-enabling drag tension clears active return springs cleanly');
  assert.equal(saved, 2);

  // Turning tension off before release skips spring-back when no home was recorded, and turning it back on mid-drag restores cooldown.
  const state = c as unknown as { homes: Map<unknown, unknown>; springs: Map<unknown, unknown> };
  dragged.fx = undefined;
  onDrag!(dragged, { x: 10, y: 0, z: 0 });
  assert.equal(alphaMin, 0);
  toggles.get('Drag tension')!(false);
  assert.equal(alphaMin, 0.001);
  onDragEnd!(dragged);
  assert.equal(dragged.fx, undefined);
  assert.equal(state.springs.size, 0, 'does not queue a spring without a pre-drag home');

  onDrag!(dragged, { x: 10, y: 0, z: 0 });
  assert.equal(cooldownTicks, 0);
  toggles.get('Drag tension')!(true);
  assert.equal(cooldownTicks, Infinity, 'restores cooldown even when tension turns on before release');
  assert.equal(state.homes.size, 0, 'clears off-mode drag homes when tension turns on');
  onDragEnd!(dragged);

  lastTarget = undefined;
  c.fit();
  assert.ok(lastTarget, 'public fit() frames 3D graph for Home action');
  c.onunload();
});

test('3D node labels are created lazily when visible, ignore pointer raycasts, and dispose on removal', async () => {
  const model = new Ontology({ tag: { description: '', broader: [] }, far: { description: '', broader: [] } }, [{ path: 'Note.md', tags: ['tag'] }]);
  const owner = {
    model,
    settings: { ...settings.DEFAULT_SETTINGS, focus: false },
    native: { selectedTag: undefined },
    tagColor: () => '#123456',
    graphData: () => ({
      nodes: {
        '#tag': { type: 'tag', links: {} },
        '#far': { type: 'tag', links: {} },
        'Note.md': { type: '', links: { '#tag': true } },
      },
      numLinks: 1,
    }),
  };
  const c = await setup(owner);
  const internal = c as unknown as {
    ball: THREE.SphereGeometry;
    pickMaterial: THREE.MeshBasicMaterial;
    litDotMaterial: THREE.MeshLambertMaterial;
    fadedDotMaterial: THREE.MeshLambertMaterial;
    litDots?: THREE.InstancedMesh;
    fadedDots?: THREE.InstancedMesh;
    forward: THREE.Vector3;
    nodes: Map<string, { id: string; type: string; tag?: string; name: string; degree: number; radius: number; x?: number; y?: number; z?: number; dot?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; label?: THREE.Sprite }>;
    nodeObject(item: { id: string; type: string; tag?: string; name: string; degree: number; radius: number; dot?: THREE.Mesh; label?: THREE.Sprite }): THREE.Object3D;
    buildDots(): void;
    frame(): void;
  };
  let createdLabels = 0;
  let disposedMaps = 0, disposedLabelMaterials = 0;
  class SpriteTextStub extends THREE.Sprite {
    fontFace = ''; fontSize = 0;
    private _color = '';
    get color() { return this._color; }
    set color(value: string) { this._color = value; }
    constructor(_text = '', _height = 1, color = '') {
      const mat = new THREE.SpriteMaterial();
      mat.map = { dispose() { disposedMaps++; } } as unknown as THREE.Texture;
      const origDispose = mat.dispose.bind(mat);
      mat.dispose = () => { disposedLabelMaterials++; origDispose(); };
      super(mat);
      this._color = color;
      createdLabels++;
    }
  }
  c.three = { ...THREE, SpriteText: SpriteTextStub } as unknown as typeof THREE;
  internal.ball = new THREE.SphereGeometry(1, 16, 12);
  internal.pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  internal.litDotMaterial = new THREE.MeshLambertMaterial();
  internal.fadedDotMaterial = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.2 });
  internal.forward = new THREE.Vector3();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  Object.assign(c.graph, {
    camera: () => camera,
    controls: () => ({ target: new THREE.Vector3(0, 0, 0) }),
    height: () => 600,
  });

  type TestNode = { id: string; type: string; tag?: string; name: string; degree: number; radius: number; x?: number; y?: number; z?: number; dot?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; label?: THREE.Sprite };
  const nearTag: TestNode = { id: '#tag', type: 'tag', tag: 'tag', name: '#tag', degree: 1, radius: 1.5, x: 0, y: 0, z: 0 };
  const nearNote: TestNode = { id: 'Note.md', type: 'note', name: 'Note', degree: 1, radius: 1.2, x: 0, y: 0, z: 0 };
  const farTag: TestNode = { id: '#far', type: 'tag', tag: 'far', name: '#far', degree: 1, radius: 1.5, x: 0, y: 0, z: -900 };
  const groups = new Map<string, THREE.Object3D>();
  internal.nodes = new Map([nearTag, nearNote, farTag].map(item => {
    groups.set(item.id, internal.nodeObject(item));
    return [item.id, item];
  }));
  internal.buildDots();

  assert.equal(createdLabels, 0, 'nodeObject does not eagerly build SpriteText canvases');
  internal.frame();
  assert.equal(internal.litDots!.count, 3, 'all nodes draw in a single instanced mesh when unlit');
  assert.equal(internal.fadedDots!.count, 0);
  assert.equal(createdLabels, 2, 'frame builds SpriteText only for visible near nodes');
  assert.ok(nearTag.label && nearNote.label, 'near nodes receive lazy labels');
  assert.equal(farTag.label, undefined, 'far unlit nodes keep no SpriteText texture');

  // Stationary frames reuse instanced dot buffers without re-uploading.
  const dotVersion = internal.litDots!.instanceMatrix.version;
  internal.frame();
  assert.equal(internal.litDots!.instanceMatrix.version, dotVersion, 'camera-only frame skips instanced dot upload');

  for (const item of [nearTag, nearNote]) {
    const group = groups.get(item.id)!;
    item.label!.scale.set(12, 2.2, 1);
    group.updateMatrixWorld(true);

    const ray = new THREE.Raycaster();
    // Aiming at the invisible pick sphere still hits the mesh while instanced render spheres ignore raycasts.
    const dotNdc = new THREE.Vector3(0, 0, 0).project(camera);
    ray.setFromCamera(new THREE.Vector2(dotNdc.x, dotNdc.y), camera);
    const dotHits = ray.intersectObject(group, true);
    assert.equal(dotHits[0]?.object, item.dot, `${item.type} invisible pick sphere is clickable`);
    assert.deepEqual(ray.intersectObject(internal.litDots!, true), [], 'instanced render dots ignore raycasts');

    // Aiming at the hanging label hits nothing (passes through).
    const labelPos = new THREE.Vector3(0, -(item.radius + 1.5), 0).project(camera);
    ray.setFromCamera(new THREE.Vector2(labelPos.x, labelPos.y), camera);
    assert.deepEqual(ray.intersectObject(group, true), [], `${item.type} label ignores raycasts`);
  }

  // Removing a node on redraw disposes its lazy label texture/material without disposing shared pickMaterial.
  let disposedPickMaterials = 0;
  const origPickDispose = internal.pickMaterial.dispose.bind(internal.pickMaterial);
  internal.pickMaterial.dispose = () => { disposedPickMaterials++; origPickDispose(); };
  owner.settings.showNotes = false;
  c.setVisible(true);
  c.draw('filter');
  assert.equal(disposedPickMaterials, 0, 'shared pick material stays alive across redraws');
  assert.equal(disposedMaps, 1, 'removed node label texture is disposed');
  assert.equal(disposedLabelMaterials, 1, 'removed node label material is disposed');
  assert.equal(internal.litDots!.count, 2, 'instanced dots rebuild to match remaining nodes');
});

test('3D uses lightweight sphere geometry, defers hidden recolors, skips redundant label redraws, and handles WebGL context loss', async () => {
  const canvasEl = new El();
  let paused = 0, resumed = 0, bgCalls = 0, mutationCb: (() => void) | undefined;
  let cssVars: Record<string, string> = {
    '--graph-node': '#b8b8b8', '--graph-node-tag': '#55c26a', '--graph-line': '#5a5a5a',
    '--graph-text': '#dadada', '--background-primary': '#1e1e1e', '--interactive-accent': '#8b6cef', '--font-interface': 'Inter',
  };
  let labelColorSets = 0, labelFontSets = 0;
  class SpriteTextStub extends THREE.Sprite {
    private _color = ''; private _fontFace = ''; fontSize = 0;
    get color() { return this._color; }
    set color(value: string) { labelColorSets++; this._color = value; }
    get fontFace() { return this._fontFace; }
    set fontFace(value: string) { labelFontSets++; this._fontFace = value; }
    constructor(_text = '', _height = 1, color = '') { super(new THREE.SpriteMaterial()); this._color = color; }
  }
  const fakeGraph = {
    backgroundColor() { bgCalls++; return this; }, showNavInfo() { return this; }, nodeLabel() { return this; }, nodeRelSize() { return this; },
    nodeVal() { return this; }, nodeThreeObject() { return this; }, linkVisibility() { return this; }, onNodeHover() { return this; },
    onNodeClick() { return this; }, onNodeDrag() { return this; }, onNodeDragEnd() { return this; }, onEngineTick() { return this; },
    cooldownTime() { return this; }, cooldownTicks() { return this; }, d3AlphaMin() { return this; },
    width() { return this; }, height() { return this; },
    d3Force: () => ({ strength() { return this; }, distance() { return this; } }),
    d3ReheatSimulation() {},
    pauseAnimation() { paused++; }, resumeAnimation() { resumed++; },
    scene: () => Object.assign(new THREE.Scene(), { fog: undefined, onBeforeRender: undefined }),
    camera: () => ({ position: { x: 0, y: 0, z: 200 }, fov: 45, aspect: 1.33, matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] } }),
    controls: () => ({ target: { x: 0, y: 0, z: 0 }, addEventListener() {}, removeEventListener() {} }),
    cameraPosition: () => ({ x: 0, y: 0, z: 200 }),
    graphData() { return this; },
    renderer: () => ({ domElement: canvasEl, forceContextLoss() {}, dispose() {} }),
    _destructor() {},
  };
  const model = new Ontology({ root: { description: '', broader: [] } }, []);
  const owner = {
    model, settings: { ...settings.DEFAULT_SETTINGS },
    saveState() {},
    native: { selectedTag: undefined, renderPanel() {}, link() {}, unlink() {}, isDouble: () => false, clickTag() {}, toggleFilter() {}, checkDictionary() {}, collapseAll() {}, expandAll() {} },
    tagColor: () => '#123456',
    app: { workspace: { on: () => () => {} } },
    graphData: () => ({ nodes: { '#root': { type: 'tag', links: {} } }, numLinks: 0 }),
  };
  const { canvas: c } = await openCanvas({
    owner, fakeGraph, SpriteText: SpriteTextStub,
    cssVar: name => cssVars[name] ?? '',
    onMutationObserver: cb => { mutationCb = cb; },
  });

  // Lightweight sphere tessellation (~8.5x fewer triangles than 48x32).
  assert.ok(c.ball.parameters.widthSegments <= 16 && c.ball.parameters.heightSegments <= 12, 'uses lightweight sphere segments');

  // Attach a label to #root and verify accent-only body style changes do not regenerate label canvases.
  const rootNode = c.nodes.get('#root')! as Node & { label?: SpriteTextStub };
  rootNode.label = new SpriteTextStub('#root', 2.2, '#dadada');
  const bgBefore = bgCalls;
  cssVars = { ...cssVars, '--interactive-accent': '#ff0000' };
  mutationCb!();
  assert.equal(labelColorSets, 0, 'accent-only change does not redraw SpriteText canvases');
  assert.equal(labelFontSets, 0, 'unchanged font does not redraw SpriteText canvases');
  assert.equal(bgCalls, bgBefore, 'unchanged background does not reset renderer background');

  // Hidden recolor is deferred until visible again.
  c.setVisible(false);
  cssVars = { ...cssVars, '--graph-text': '#ffffff', '--background-primary': '#000000' };
  mutationCb!();
  assert.equal(labelColorSets, 0, 'hidden 3D defers recolor until shown');
  assert.equal(bgCalls, bgBefore);
  c.setVisible(true);
  assert.equal(labelColorSets, 1, 'deferred recolor updates text color once visible');
  assert.equal(bgCalls, bgBefore + 1);

  // WebGL context loss prevents default and pauses animation; restore resumes only when visible.
  let prevented = false;
  const lostListeners = canvasEl.events.get('webglcontextlost') ?? [];
  const restoredListeners = canvasEl.events.get('webglcontextrestored') ?? [];
  assert.equal(lostListeners.length, 1, 'registers webglcontextlost listener');
  assert.equal(restoredListeners.length, 1, 'registers webglcontextrestored listener');
  const pausedBefore = paused, resumedBefore = resumed;
  lostListeners[0]({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(paused, pausedBefore + 1);
  restoredListeners[0]();
  assert.equal(resumed, resumedBefore + 1);

  c.setVisible(false);
  const resumedHidden = resumed;
  restoredListeners[0]();
  assert.equal(resumed, resumedHidden, 'context restore while hidden does not resume animation');
  c.onunload();
});
