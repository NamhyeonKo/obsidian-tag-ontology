import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

// The licence of every package the bundle takes code from (the runtime dependencies and theirs), as one comment for the top of
// main.js. MIT, ISC and BSD ask that their notice goes with every copy, and minifying drops the ones inside the code.
// Packages that ship the same text share one copy of it.
export function licenseNotice(root) {
  const found = new Map();
  const visit = (name, from) => {
    if (found.has(name)) return;
    // npm puts a package next to the one that needs it only when versions clash; otherwise it is at the top.
    const dir = [join(from, 'node_modules', name), join(root, 'node_modules', name)].find(each => existsSync(join(each, 'package.json')));
    if (!dir) throw new Error(`Dependency not installed: ${name}`);
    found.set(name, dir);
    for (const dependency of Object.keys(read(dir).dependencies ?? {})) visit(dependency, dir);
  };
  for (const name of Object.keys(read(root).dependencies ?? {})) visit(name, root);
  const byText = new Map();
  for (const [name, dir] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const pkg = read(dir), file = readdirSync(dir).find(each => /^licen[cs]e(\.(md|txt))?$/i.test(each));
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : String(pkg.license);
    byText.set(text, [...byText.get(text) ?? [], `${name}@${pkg.version}`]);
  }
  const body = [...byText].map(([text, names]) => `${names.join(', ')}\n\n${text}`).join('\n\n---\n\n');
  // A licence text must not end the comment early.
  return `/*!\nTag Ontology bundles the packages below. Their licences follow.\n\n${body.replaceAll('*/', '* /')}\n*/`;
}
