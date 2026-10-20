import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import { Ontology } from '../src/ontology.ts';
import { nativeData, edgeKey } from '../src/native-data.ts';

class Element {
  children: Element[] = []; text = ''; hidden = false; value = ''; removed = false;
  events = new Map<string, () => void>();
  createDiv() { return this.createEl('div'); }
  createEl(_tag: string, options?: { text?: string }) {
    const child = new Element(); child.text = options?.text ?? ''; this.children.push(child); return child;
  }
  addEventListener(event: string, fn: () => void) { this.events.set(event, fn); }
  removeEventListener(event: string) { this.events.delete(event); }
  setAttribute() {} addClass() {} removeClass() {}
  empty() { this.children = []; } remove() { this.removed = true; }
  all(): Element[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class File {}
type Controller = { attach(): void; refresh(): void; destroy(): void };

async function loadNative(globals: object, hierarchyPositions: (...args: unknown[]) => Map<string, { x: number; y: number }>) {
  const context = createContext({
    performance, devicePixelRatio: 1, window: globals,
    document: { visibilityState: 'visible' }, createEl: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  const code = await transform(readFileSync(new URL('../src/native.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? { Notice: class {}, TFile: File }
      : specifier === './layout.ts' ? { hierarchyPositions }
      : { nativeData, edgeKey };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return (module.namespace as { NativeGraphs: new(owner: object) => Controller }).NativeGraphs;
}

test('native session restores callbacks and lazy textures without breaking a later wrapper', async () => {
  let frame = 0;
  const frames = new Map<number, () => void>();
  const NativeGraphs = await loadNative({
    requestAnimationFrame: (fn: () => void) => { frames.set(++frame, fn); return frame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  }, () => { throw new Error('Force must use the native worker'); });
  let destroyed = 0, fileClicks = 0, forwards = 0;
  const nativeTexture = { constructor: { from: () => ({ destroy: () => destroyed++ }) } };
  const line = { texture: nativeTexture as object };
  let expectedArrow = false;
  const link = { source: { id: '#a' }, target: { id: '#b' }, line: undefined as { texture: object } | undefined, render() { assert.equal(renderer.fShowArrow, expectedArrow); } };
  const render = link.render;
  const renderer = {
    nodes: [] as { id: string }[], links: [link], fShowArrow: true, worker: { postMessage() {} },
    changed() {}, resetPan() {}, onNodeClick() { fileClicks++; },
    setData(data: { nodes: object }) { forwards++; this.nodes = Object.keys(data.nodes).map(id => ({ id })); },
  };
  const originalSet = renderer.setData, originalClick = renderer.onNodeClick;
  const contentEl = new Element();
  const view = { renderer, contentEl, update() {} }, leaf = { view };
  const owner = {
    model: new Ontology({ a: { description: '', broader: [], related: ['b'] }, b: { description: '', broader: [] } }, []),
    settings: { layout: 'force' }, app: {
      vault: { getAbstractFileByPath: (id: string) => id === 'Real.md' ? new File() : null },
      workspace: { getLeavesOfType: () => [leaf], getLeaf: () => ({ openFile: async () => { fileClicks++; } }) },
    },
  };
  const controller = new NativeGraphs(owner); controller.attach(); controller.attach();
  assert.equal(forwards, 1, 'layout-change must not attach a second wrapper');
  link.line = line; link.render();
  assert.notEqual(line.texture, nativeTexture);
  assert.equal(renderer.fShowArrow, true);
  (renderer.onNodeClick as Function)({}, 'missing.md', ''); assert.equal(fileClicks, 0, 'stale nodes must not create files');
  (renderer.onNodeClick as Function)({}, 'Real.md', ''); assert.equal(fileClicks, 1);
  owner.model = new Ontology({ a: { description: '', broader: [] }, b: { description: '', broader: ['a'] } }, []);
  controller.refresh();
  (renderer.onNodeClick as Function)({}, '#a', 'tag');
  assert.ok(renderer.nodes.some(n => n.id === '#b'), 'clicking a tag expands its children');
  (renderer.onNodeClick as Function)({}, '#a', 'tag');
  assert.ok(renderer.nodes.some(n => n.id === '#b'), 'clicking an expanded tag keeps it expanded');
  assert.ok(contentEl.all().some(el => el.text === 'Collapse children and notes'));
  expectedArrow = true; link.render();
  assert.equal(line.texture, nativeTexture, 'changing related to broader restores a solid line');
  const ours = renderer.setData;
  renderer.setData = data => { ours.call(renderer, data); };
  const laterWrapper = renderer.setData;
  controller.destroy();
  assert.equal(renderer.setData, laterWrapper);
  assert.equal(renderer.onNodeClick, originalClick);
  assert.equal(link.render, render);
  assert.equal(line.texture, nativeTexture);
  assert.equal(destroyed, 1);
  assert.equal(contentEl.children.every(c => c.removed), true);
  assert.equal(frames.size, 0, 'closing must cancel root fit animation');
  assert.equal(contentEl.events.size, 0);
  renderer.setData({ nodes: { 'Real.md': {} } });
  assert.deepEqual(renderer.nodes.map(n => n.id), ['Real.md']);
  assert.notEqual(ours, originalSet);
});

test('tree layout keeps the user zoom across native updates and refits only when the layout changes', async () => {
  const NativeGraphs = await loadNative({ requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
    (graph: unknown) => new Map((graph as { nodes: { id: string }[] }).nodes.map((n, i) => [n.id, { x: i * 400, y: 0 }])));
  const renderer = {
    nodes: [] as { id: string; x: number; y: number; fx: number | null; fy: number | null }[], links: [],
    fShowArrow: true, worker: { postMessage() {} }, workerResults: null, width: 800, height: 600, targetScale: 1, scale: 1,
    changed() {}, resetPan() {}, onNodeClick() {}, setPan() {},
    setScale(scale: number) { this.scale = scale; },
    setData(data: { nodes: object }) { this.nodes = Object.keys(data.nodes).map(id => ({ id, x: 0, y: 0, fx: null, fy: null })); },
  };
  const view = { renderer, contentEl: new Element(), update() {} }, leaf = { view };
  const owner = {
    model: new Ontology({ a: { description: '', broader: [] }, b: { description: '', broader: [] } }, []),
    settings: { layout: 'tree' }, app: { workspace: { getLeavesOfType: () => [leaf] } },
  };
  const controller = new NativeGraphs(owner); controller.attach();
  const fitted = renderer.scale;
  renderer.targetScale = renderer.scale = 5;
  renderer.setData({ nodes: {} });
  assert.equal(renderer.scale, 5, 'a native graph update must not reset the zoom');
  controller.refresh();
  assert.equal(renderer.scale, 5, 'a metadata refresh must not reset the zoom');
  owner.settings.layout = 'radial'; controller.refresh();
  assert.equal(renderer.scale, fitted, 'switching layout refits the new positions');
  controller.destroy();
});
