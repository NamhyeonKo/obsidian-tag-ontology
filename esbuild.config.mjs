import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { licenseNotice } from './scripts/notices.mjs';
const result = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  // Bundle the workspace tag-ontology package from its TypeScript source.
  conditions: ['source'],
  // three-render-objects imports the WebGPU renderer and three-forcegraph the ngraph engine, which the 3D view never uses
  // (see the stubs).
  alias: { 'three/webgpu': './src/webgpu-stub.ts', 'ngraph.forcelayout': './src/ngraph-stub.ts' },
  format: 'cjs',
  target: 'es2021',
  outfile: 'main.js',
  sourcemap: false,
  minify: true,
  metafile: true,
  // The bundled packages' licence notices, which minifying would otherwise drop.
  banner: { js: licenseNotice(fileURLToPath(new URL('.', import.meta.url))) },
});
const external = Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path));
assert.deepEqual([...new Set(external)].sort(), ['obsidian'], 'The plugin must require only obsidian at runtime.');
