import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { licenseNotice } from './scripts/notices.mjs';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  // three-render-objects imports the WebGPU renderer and three-forcegraph the ngraph engine, which the 3D view never uses
  // (see the stubs).
  alias: { 'three/webgpu': './src/webgpu-stub.ts', 'ngraph.forcelayout': './src/ngraph-stub.ts' },
  format: 'cjs',
  target: 'es2021',
  outfile: 'main.js',
  sourcemap: false,
  minify: true,
  // The bundled packages' licence notices, which minifying would otherwise drop.
  banner: { js: licenseNotice(fileURLToPath(new URL('.', import.meta.url))) },
});
