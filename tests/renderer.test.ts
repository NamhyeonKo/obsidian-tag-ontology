import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

test('renderer registers bundled force layout and owns idempotent cleanup', async () => {
  let options: Record<string, unknown> | undefined, destroys = 0, registrations = 0;
  const cy = { destroy: () => { destroys++; } };
  const extension = () => {};
  const cytoscape = Object.assign((value: Record<string, unknown>) => { options = value; return cy; }, {
    use(value: unknown) { assert.equal(value, extension); registrations++; },
  });
  const context = createContext({});
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/renderer.ts', import.meta.url), 'utf8'));
  const module = new SourceTextModule(source, { context });
  await module.link(specifier => {
    assert.ok(['cytoscape', 'cytoscape-d3-force'].includes(specifier), 'renderer must only load bundled graph dependencies');
    return new SyntheticModule(['default'], function () {
      this.setExport('default', specifier === 'cytoscape' ? cytoscape : extension);
    }, { context });
  });
  await module.evaluate();
  const createGraph = (module.namespace as { createGraph: (host: object) => { cy: typeof cy; destroy(): void } }).createGraph;
  const host = {};
  const handle = createGraph(host);
  assert.equal(registrations, 1);
  assert.equal(options?.container, host);
  assert.equal(options?.boxSelectionEnabled, false);
  assert.equal(handle.cy, cy);
  handle.destroy(); handle.destroy();
  assert.equal(destroys, 1);
});
