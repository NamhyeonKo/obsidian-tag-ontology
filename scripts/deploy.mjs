import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const vaultPath = process.argv[2];
if (!vaultPath || process.argv.length !== 3) {
  throw new Error('Usage: npm run deploy -- /path/to/obsidian-vault');
}
const config = join(resolve(vaultPath), '.obsidian');
if (!statSync(config).isDirectory()) throw new Error('Vault .obsidian directory is required.');
const files = ['main.js', 'manifest.json', 'styles.css'];
for (const name of files) accessSync(join(source, name), constants.R_OK);
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
if (manifest.id !== 'tag-ontology') throw new Error('Unexpected source plugin ID.');
const target = join(config, 'plugins', manifest.id);
const installedManifest = join(target, 'manifest.json');
if (existsSync(installedManifest)
  && JSON.parse(readFileSync(installedManifest, 'utf8')).id !== manifest.id) {
  throw new Error('Installed plugin ID does not match.');
}
mkdirSync(target, { recursive: true });
for (const name of files) copyFileSync(join(source, name), join(target, name));
console.log(`Installed ${files.join(', ')} to ${target}. Existing data.json preserved.`);
