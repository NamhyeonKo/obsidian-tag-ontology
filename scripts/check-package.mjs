// Inspect and exercise the published tarball, with no workspace source resolution or writes to a real vault.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'tag-ontology-package-'));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
try {
  // prepack builds dist, even after a clean checkout.
  const [pack] = JSON.parse(run('npm', ['pack', '-w', 'tag-ontology', '--pack-destination', temp, '--json']));
  const tarball = join(temp, pack.filename);
  assert.ok(pack.files.some(file => file.path === 'dist/cli/main.js'));
  assert.ok(pack.files.some(file => file.path === 'dist/index.d.ts'));
  assert.ok(pack.files.some(file => file.path === 'LICENSE'));
  assert.ok(!pack.files.some(file => /^(tests|node_modules)\//.test(file.path)));
  process.stdout.write(run('npm', ['exec', '--offline', '--', 'publint', tarball, '--strict']));
  process.stdout.write(run('npm', ['exec', '--offline', '--', 'attw', tarball, '--profile', 'esm-only']));

  const installed = join(temp, 'installed');
  // npm changes config scope under --prefix, so pass the invoking project's cache explicitly.
  const cache = run('npm', ['config', 'get', 'cache']).trim();
  run('npm', ['install', '--prefix', installed, '--cache', cache, '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball]);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Ontology, validate } from 'tag-ontology';
    import { scan } from 'tag-ontology/vault';
    assert.ok(import.meta.resolve('tag-ontology').endsWith('/dist/index.js'));
    assert.deepEqual(validate({}), []);
    assert.deepEqual(new Ontology({}, []).roots, []);
    assert.equal(typeof scan, 'function');
  `], installed);

  const vault = join(temp, 'vault');
  cpSync(join(root, 'packages/tag-ontology/tests/fixtures/vault'), vault, { recursive: true });
  const bin = join(installed, 'node_modules/.bin/tag-ontology');
  const cli = (args, code = 0) => {
    const result = spawnSync(bin, [...args, '--json'], { cwd: vault, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, code, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  const pkg = JSON.parse(readFileSync(join(root, 'packages/tag-ontology/package.json'), 'utf8'));
  assert.equal(run(bin, ['--version'], vault), `${pkg.version}\n`);
  assert.equal(cli(['check']).ok, true);
  assert.equal(cli(['scan']).notes.length, 4);
  assert.deepEqual(cli(['show', 'ML', '--notes']).notePaths, ['Nested/Deep/Note.md', 'notes/Alpha.md']);
  writeFileSync(join(vault, 'changes.json'), JSON.stringify({ changes: [{ kind: 'delete', tag: 'unused-leaf' }] }));
  const plan = cli(['plan', 'changes.json']);
  assert.deepEqual(plan.diff.map(item => [item.tag, item.status]), [['unused-leaf', 'removed']]);
  assert.equal(cli(['apply', 'changes.json', '--base', plan.base]).written, true);
  const before = readFileSync(join(vault, 'Tag-Dictionary.json'), 'utf8');
  assert.equal(cli(['apply', 'changes.json', '--base', plan.base], 3).written, false);
  assert.equal(readFileSync(join(vault, 'Tag-Dictionary.json'), 'utf8'), before);
  console.log('Installed tarball: library/vault imports and CLI checks passed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
