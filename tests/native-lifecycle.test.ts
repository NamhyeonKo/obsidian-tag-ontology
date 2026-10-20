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

test('native session restores callbacks and lazy textures without breaking a later wrapper', async () => {
  let frame = 0;
  const frames = new Map<number, () => void>();
  const context = createContext({
    performance, document: { visibilityState: 'visible', createElement: () => ({ getContext: () => ({ fillRect() {} }) }) },
    requestAnimationFrame: (fn: () => void) => { frames.set(++frame, fn); return frame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const code = await transform(readFileSync(new URL('../src/native.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? { Notice: class {}, TFile: File }
      : specifier === './layout.ts' ? { hierarchyPositions: () => { throw new Error('Force must use the native worker'); } }
      : { nativeData, edgeKey };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const NativeGraphs = (module.namespace as { NativeGraphs: new(owner: object) => { attach(): void; refresh(): void; destroy(): void } }).NativeGraphs;
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
  contentEl.all().find(el => el.text === '하위 태그·직접 노트 펼치기')!.events.get('click')!();
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
