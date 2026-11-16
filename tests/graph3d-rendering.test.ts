import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import * as THREE from 'three';
import * as layer from '../src/layer.ts';
import * as settings from '../src/settings.ts';
import * as geometry from '../src/geometry3d.ts';

interface Node { id: string; x: number; y: number; z: number; radius: number }
interface Renderer {
  three: typeof THREE; graph: { scene(): THREE.Scene; pauseAnimation(): void }; nodes: Map<string, Node>;
  draw(operation: string): void; setVisible(visible: boolean): void; pendingDraw?: string;
  links: { source: string | Node; target: string | Node; kind: string }[];
  lines: THREE.LineSegments; dashes: THREE.LineSegments; cone: THREE.ConeGeometry; arrowMaterial: THREE.MeshLambertMaterial;
  arrows: THREE.InstancedMesh; buildLinks(): void; placeLinks(): void;
}
async function setup() {
  const context = createContext({});
  const code = await transform(readFileSync(new URL('../src/graph3d.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? { Component: class {}, ItemView: class {}, Setting: class {}, debounce() {}, setIcon() {}, setTooltip() {} }
      : specifier === './legend.ts' ? { renderDepthLegend() {} }
      : specifier === './graph-modes.ts' ? { graphModeBar() {} }
      : specifier === './native.ts' ? { DOUBLE_CLICK_MS: 350 }
      : specifier === './settings.ts' ? { ...settings } : specifier === './geometry3d.ts' ? { ...geometry } : { ...layer };
    return new SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
  });
  await module.evaluate();
  const Canvas = (module.namespace as unknown as { Graph3DCanvas: new(root: object, owner: object, leaf: object) => Renderer }).Graph3DCanvas;
  const canvas = new Canvas({ isShown: () => true }, {}, {}), scene = new THREE.Scene();
  canvas.three = THREE; canvas.graph = { scene: () => scene, pauseAnimation() {} };
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
