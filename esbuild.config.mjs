import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { licenseNotice } from './scripts/notices.mjs';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2021',
  outfile: 'main.js',
  sourcemap: false,
  minify: true,
  // The bundled packages' licence notices, which minifying would otherwise drop.
  banner: { js: licenseNotice(fileURLToPath(new URL('.', import.meta.url))) },
});
