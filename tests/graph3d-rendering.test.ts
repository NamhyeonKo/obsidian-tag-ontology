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
  const context = createContext({ window: { setTimeout: () => 0, clearTimeout: () => {} } });
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

test('recenter button tracks 3D focus, tween arrival, user camera change, wheel interrupt, fit, and expand', async () => {
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
    all(): El[] { return [this, ...this.children.flatMap(c => c.all())]; }
  }
  const controlListeners = new Map<string, Set<() => void>>();
  let camPos = { x: 0, y: 0, z: 200 }, lastTarget: { x: number; y: number; z: number } | undefined;
  const fakeGraph = {
    backgroundColor() { return this; }, showNavInfo() { return this; }, nodeLabel() { return this; }, nodeRelSize() { return this; },
    nodeVal() { return this; }, nodeThreeObject() { return this; }, linkVisibility() { return this; }, onNodeHover() { return this; },
    onNodeClick() { return this; }, onNodeDrag() { return this; }, onNodeDragEnd() { return this; }, cooldownTime() { return this; },
    d3AlphaMin() { return this; }, width() { return this; }, height() { return this; },
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
  const model = new Ontology({ root: { description: '', broader: [] }, leaf: { description: '', broader: ['root'] } }, []);
  const owner = {
    model,
    settings: { ...settings.DEFAULT_SETTINGS },
    native: { selectedTag: 'root' as string | undefined, renderPanel() {}, link() {}, unlink() {}, isDouble: () => false, clickTag() {}, toggleFilter() {}, checkDictionary() {}, collapseAll() {}, expandAll() {} },
    tagColor: () => '#123456',
    app: { workspace: { on: () => () => {} } },
    graphData: () => ({ nodes: { '#root': { type: 'tag', links: {} }, '#leaf': { type: 'tag', links: {} } }, numLinks: 0 }),
  };
  const root = new El();
  const context = createContext({
    performance: { now: () => now },
    window: { setTimeout: () => 0, clearTimeout: () => {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    createEl: () => ({ getContext: () => ({ fillRect() {}, measureText: () => ({ width: 20 }) }) }),
  });
  const code = await transform(readFileSync(new URL('../src/graph3d.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const threeMock = { ...THREE, ForceGraph3D: class { constructor() { return fakeGraph; } } };
  const module = new SourceTextModule(code.code, {
    context,
    importModuleDynamically: async () => {
      const m = new SyntheticModule(Object.keys(threeMock), function () { for (const [k, v] of Object.entries(threeMock)) this.setExport(k, v); }, { context });
      await m.link(() => { throw new Error('unexpected'); }); await m.evaluate(); return m;
    },
  });
  const control = () => ({ setValue() { return control(); }, setLimits() { return control(); }, setInstant() { return control(); }, onChange() { return control(); }, setButtonText() { return control(); }, onClick() { return control(); } });
  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? {
      Component: class { register() {} registerEvent() {} registerDomEvent(el: El, type: string, fn: (e?: unknown) => void) { el.addEventListener(type, fn); } },
      ItemView: class {},
      Setting: class { nameEl = new El(); settingEl = new El(); setName() { return this; } addToggle(fn: (c: ReturnType<typeof control>) => void) { fn(control()); return this; } addSlider(fn: (c: ReturnType<typeof control>) => void) { fn(control()); return this; } addButton(fn: (c: ReturnType<typeof control>) => void) { fn(control()); return this; } },
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
    Graph3DCanvas: new(root: El, owner: object, leaf: object) => Renderer & { open(): Promise<void>; focusOn(tag: string): void; fit(): void; paint(): void; unload?(): void; onunload(): void };
  }).Graph3DCanvas;
  const c = new Canvas(root, owner, {});
  c.setVisible(true);
  await c.open();
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

  lastTarget = undefined;
  c.fit();
  assert.ok(lastTarget, 'public fit() frames 3D graph for Home action');
  c.onunload();
});

test('3D node labels ignore pointer raycasts while spheres still hit for tags and notes', async () => {
  const c = await setup({ settings: { ...settings.DEFAULT_SETTINGS }, native: {}, tagColor: () => '#123456' });
  const internal = c as unknown as {
    ball: THREE.SphereGeometry;
    nodeObject(item: { id: string; type: string; tag?: string; name: string; degree: number; radius: number; dot?: THREE.Mesh; label?: THREE.Sprite }): THREE.Object3D;
  };
  class SpriteTextStub extends THREE.Sprite {
    fontFace = ''; fontSize = 0;
    constructor() { super(new THREE.SpriteMaterial()); }
  }
  c.three = { ...THREE, SpriteText: SpriteTextStub } as unknown as typeof THREE;
  internal.ball = new THREE.SphereGeometry(1, 8, 8);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const items: Parameters<typeof internal.nodeObject>[0][] = [
    { id: '#tag', type: 'tag', tag: 'tag', name: 'tag', degree: 1, radius: 1.5 },
    { id: 'Note.md', type: 'note', name: 'Note', degree: 1, radius: 1.2 },
  ];
  for (const item of items) {
    const group = internal.nodeObject(item);
    item.label!.scale.set(12, 2.2, 1);
    group.updateMatrixWorld(true);

    const ray = new THREE.Raycaster();
    // Aiming at the sphere hits the mesh.
    const dotNdc = new THREE.Vector3(0, 0, 0).project(camera);
    ray.setFromCamera(new THREE.Vector2(dotNdc.x, dotNdc.y), camera);
    const dotHits = ray.intersectObject(group, true);
    assert.equal(dotHits[0]?.object, item.dot, `${item.type} sphere is clickable`);

    // Aiming at the hanging label hits nothing (passes through).
    const labelPos = new THREE.Vector3(0, -(item.radius + 1.5), 0).project(camera);
    ray.setFromCamera(new THREE.Vector2(labelPos.x, labelPos.y), camera);
    assert.deepEqual(ray.intersectObject(group, true), [], `${item.type} label ignores raycasts`);
  }
});
