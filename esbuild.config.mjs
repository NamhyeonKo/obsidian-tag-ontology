import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2021',
  outfile: 'main.js',
  sourcemap: false,
  minify: true,
});
