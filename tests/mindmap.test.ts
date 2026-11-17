import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import cytoscape from 'cytoscape';
import type { MindMapData } from '../src/mindmap.ts';

class Element {
  style = { transform: '' };
  children: Element[] = []; parent?: Element; classes = new Set<string>(); attrs: Record<string, string> = {};
  text = ''; hidden = false; disabled = false; removed = false;
  events = new Map<string, (event?: { preventDefault(): void }) => void>(); css: Record<string, string> = {};
  classList = { add: (name: string) => this.classes.add(name), toggle: (name: string, on: boolean) => this.toggleClass(name, on) };
  createDiv(options: string | { cls?: string; text?: string } = '') { const child = new Element();
    const cls = typeof options === 'string' ? options : options.cls ?? '';
    for (const name of cls.split(' ')) if (name) child.classes.add(name);
    if (typeof options !== 'string') child.text = options.text ?? '';
    this.appendChild(child); return child; }
  createEl(_name: string, opts?: { cls?: string; text?: string }) { const child = this.createDiv(opts?.cls); child.text = opts?.text ?? ''; return child; }
  createSvg() { return this.createDiv(); }
  appendChild(child: Element) { child.remove(); child.removed = false; child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.removed = true; }
  replaceChildren() { this.children = []; }
  empty() { this.children = []; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  setText(text: string) { this.text = text; }
  setCssProps(props: Record<string, string>) { Object.assign(this.css, props); }
  addClass(name: string) { this.classes.add(name); }
  removeClass(name: string) { this.classes.delete(name); }
  toggleClass(name: string, on: boolean) { if (on) this.classes.add(name); else this.classes.delete(name); }
  addEventListener(name: string, callback: (event?: { preventDefault(): void }) => void) { this.events.set(name, callback); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function setup(closeBeforeLoad = false, color: (tag: string) => string | undefined = () => undefined) {
  let width = 0, height = 0, fits = 0, zoom = 1, disconnected = false, destroyed = false, resize = () => {};
  let pan = { x: 0, y: 0 };
  const handlers = new Map<string, () => void>();
  let options: { minZoom: number; autoungrabify?: boolean } | undefined;
  const positions = new Map<string, { x: number; y: number }>();
  const node = (id: string) => ({ id: () => id, empty: () => !positions.has(id), nonempty: () => positions.has(id),
    position(at?: { x: number; y: number }) { if (at) positions.set(id, at); return positions.get(id); },
    renderedPosition: () => positions.get(id), remove: () => positions.delete(id) });
  const graph = { on(events: string, callback: () => void) { for (const name of events.split(' ')) handlers.set(name, callback); }, batch(callback: () => void) { callback(); }, nodes: () => [...positions.keys()].map(node),
    getElementById: node, add(item: { data: { id: string }; position: { x: number; y: number } }) { positions.set(item.data.id, item.position); },
    width: () => width, height: () => height, resize() {}, zoom(value?: { level: number }) { if (value) zoom = value.level; return zoom; },
    minZoom: () => 0.000001, maxZoom: () => 2.5,
    elements: () => ({ boundingBox() {
      const xs = [...positions.values()].map(p => p.x), ys = [...positions.values()].map(p => p.y);
      const x1 = Math.min(...xs) - 20, y1 = Math.min(...ys) - 10;
      return { x1, y1, w: Math.max(...xs) + 20 - x1, h: Math.max(...ys) + 10 - y1 };
    } }),
    viewport(value: { zoom: number; pan: { x: number; y: number } }) { fits++; zoom = value.zoom; pan = value.pan; },
    pan: () => pan, animate() {}, destroy() { destroyed = true; } };
  const context = createContext({ console, window: { setTimeout, clearTimeout }, ResizeObserver: class {
    constructor(callback: () => void) { resize = callback; } observe() {} disconnect() { disconnected = true; }
  } });
  const dependency = new SyntheticModule(['default'], function () { this.setExport('default', (opts: { minZoom: number; autoungrabify?: boolean }) => { options = opts; return graph; }); }, { context });
  await dependency.link(() => { throw new Error('Unexpected import'); }); await dependency.evaluate();
  const code = await transform(readFileSync(new URL('../src/mindmap.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const search = new SyntheticModule(['TagSuggest'], function () { this.setExport('TagSuggest', class { close() {} }); }, { context });
  await search.link(() => { throw new Error('Unexpected import'); }); await search.evaluate();
  const module = new SourceTextModule(code.code, { context, importModuleDynamically: () => Promise.resolve(dependency) });
  await module.link(specifier => { if (specifier === './search.ts') return search; throw new Error('Unexpected static import'); }); await module.evaluate();
  const Constructor = (module.namespace as { MindMap: new(root: Element, select: (tag: string) => void, toggle: (tag: string) => void, start: { app: object; suggest(query: string): never[]; choose(tag?: string): void; color(tag: string): string | undefined }) => {
    draw(data: MindMapData): void; fit(covered?: { left: number; right: number; top: number; bottom: number }): void; destroy(): void;
  } }).MindMap;
  const root = new Element(), selected: string[] = [], toggled: string[] = [], chosen: (string | undefined)[] = [];
  const map = new Constructor(root, tag => selected.push(tag), tag => toggled.push(tag), { app: {}, suggest: () => [], choose: tag => chosen.push(tag), color });
  if (closeBeforeLoad) map.destroy();
  await settle();
  return { root, map, selected, toggled, chosen, options: () => options, zoom: () => zoom, fits: () => fits, pan: () => pan,
    viewport(x: number, y: number, scale: number) { pan = { x, y }; zoom = scale; resize(); },
    emit: (name: string) => handlers.get(name)!(),
    resize(w: number, h: number) { width = w; height = h; resize(); }, disconnected: () => disconnected, disposed: () => disconnected && destroyed };
}
const data: MindMapData = { root: 'root', nodes: [{ id: '#root', tag: 'root', name: 'Root', x: 0, y: 0, expandable: true, expanded: false }], edges: [] };

test('pan and zoom update only the layer transform instead of inherited CSS variables', async () => {
  const t = await setup(); t.resize(800, 600); t.map.draw(data); t.viewport(25, -40, 1.5);
  const layer = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-layer'))!;
  assert.equal(layer.style.transform, 'translate(25px, -40px) scale(1.5)');
  assert.equal(layer.css['--mindmap-pan-x'], undefined); t.map.destroy();
});

test('the layer is composited only while the view moves, then paints sharp again', async () => {
  const t = await setup(); t.resize(800, 600); t.map.draw(data);
  const layer = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-layer'))!;
  assert.equal(layer.classes.has('is-moving'), false);
  t.emit('zoom'); t.emit('pan');
  assert.equal(layer.classes.has('is-moving'), true);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(layer.classes.has('is-moving'), false);
  t.emit('resize');
  assert.equal(layer.classes.has('is-moving'), false); t.map.destroy();
});

test('a hidden mind map defers Fit until its pane has a size and permits fitting large maps', async () => {
  const t = await setup(); t.map.draw(data); t.map.fit();
  assert.equal(t.fits(), 0, 'zero-sized background tab must retain its pending fit');
  t.resize(800, 600); assert.equal(t.fits(), 1);
  assert.equal(t.zoom(), 1, 'a single starting node should not zoom so far in that its children begin off-screen');
  assert.ok(t.options()!.minZoom <= 0.001);
  t.map.destroy(); assert.ok(t.disposed());
});

test('Fit centers the map in the part of the view the toolbar, legend and settings leave uncovered', async () => {
  const t = await setup(); t.resize(800, 600); t.map.draw(data);
  t.map.fit({ left: 0, right: 0, top: 0, bottom: 0 }); const open = t.pan();
  t.map.fit({ left: 100, right: 40, top: 0, bottom: 80 });
  // The free part spans x 100..760 and y 0..520, so its middle is 30 right of and 40 above the view's.
  assert.equal(t.pan().x - open.x, 30); assert.equal(t.pan().y - open.y, -40);
  // A toolbar along the top in a short pane: y 60..520, whose middle is 10 above the view's.
  t.map.fit({ left: 0, right: 0, top: 60, bottom: 80 });
  assert.equal(t.pan().y - open.y, -10);
  t.map.destroy();
});

test('labels sit inside the gesture container and separate selection from branch buttons', async () => {
  const t = await setup(); t.resize(800, 600); t.map.draw(data);
  const stage = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-stage'))!;
  const layer = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-layer'))!;
  assert.equal(layer.parent, stage, 'wheel and pinch over a label must reach the pan/zoom container');
  const label = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-name'))!;
  const toggle = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-toggle'))!;
  label.events.get('click')!(); assert.deepEqual(t.selected, ['root']); assert.deepEqual(t.toggled, []);
  toggle.events.get('click')!(); assert.deepEqual(t.toggled, ['root']);
  assert.equal(toggle.attrs['aria-expanded'], 'false');
  assert.equal(label.attrs['aria-label'], 'Show #root details');
  t.map.destroy();
});


test('switching layouts before the renderer import completes leaves no observer or late graph', async () => {
  const t = await setup(true);
  assert.equal(t.options(), undefined);
  assert.equal(t.disconnected(), true);
  assert.ok(!t.root.all().some(el => el.classes.has('tag-ontology-mindmap')));
});


test('the initial mind map shows a starting-tag picker until a starting tag is chosen', async () => {
  const t = await setup();
  t.map.draw({ nodes: [], edges: [], roots: ['a', 'b'] });
  const start = t.root.all().find(el => el.classes.has('tag-ontology-mindmap-start'))!;
  assert.equal(start.hidden, false);
  assert.ok(start.classes.has('tag-ontology-explorer-start'), 'reuse the explorer start screen styling');
  assert.ok(t.root.all().some(el => el.text === 'Root tags'));
  assert.ok(t.root.all().find(el => el.text === '#a')!.classes.has('tag'));
  t.root.all().find(el => el.text === '#a')!.events.get('click')!({ preventDefault() {} });
  assert.deepEqual(t.chosen, ['a']);
  t.map.draw(data);
  assert.equal(start.hidden, true);
  t.map.destroy();
});


test('the hidden positioning nodes cannot be dragged away from the HTML labels', async () => {
  const t = await setup();
  const cy = cytoscape({ headless: true, autoungrabify: t.options()!.autoungrabify, elements: [{ data: { id: 'root' } }] });
  assert.equal(cy.getElementById('root').grabbable(), false);
  cy.destroy(); t.map.destroy();
});

test('starting tags use custom colors only while enabled, including the continue tag', async () => {
  let custom = false;
  const t = await setup(false, tag => custom ? (tag === 'a' ? '#123456' : '#abcdef') : undefined);
  const picker = { nodes: [], edges: [], roots: ['a'], startFrom: 'b' };
  for (const enabled of [false, true, false]) {
    custom = enabled; t.map.draw(picker);
    const chips = t.root.all().filter(el => el.classes.has('tag'));
    assert.equal(chips.length, 2);
    assert.equal(chips.find(el => el.text === '#a')!.css['--tag-ontology-tags'], enabled ? '#123456' : undefined);
    assert.equal(chips.find(el => el.text === 'Continue from #b')!.css['--tag-ontology-tags'], enabled ? '#abcdef' : undefined);
  }
  t.map.destroy();
});
