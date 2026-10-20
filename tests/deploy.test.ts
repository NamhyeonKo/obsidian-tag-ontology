import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tag-ontology-deploy-'));
  const source = join(root, 'source');
  const vault = join(root, 'vault with spaces');
  const installed = join(vault, '.obsidian/plugins/tag-ontology');
  mkdirSync(join(source, 'scripts'), { recursive: true });
  mkdirSync(installed, { recursive: true });
  copyFileSync(new URL('../scripts/deploy.mjs', import.meta.url), join(source, 'scripts/deploy.mjs'));
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({ id: 'tag-ontology' }));
  writeFileSync(join(source, 'main.js'), 'new build');
  writeFileSync(join(source, 'styles.css'), 'new styles');
  writeFileSync(join(installed, 'main.js'), 'old build');
  writeFileSync(join(installed, 'data.json'), '{"dictionaryPath":"custom.json","layout":"tree"}');
  const run = (...args: string[]) => spawnSync(process.execPath, [join(source, 'scripts/deploy.mjs'), ...args],
    { cwd: root, encoding: 'utf8' });
  return { root, source, vault, installed, run };
}

test('deploy copies only release artifacts from its source directory and preserves existing settings', () => {
  const f = fixture();
  try {
    assert.equal(f.run(f.vault).status, 0);
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      assert.deepEqual(readFileSync(join(f.installed, name)), readFileSync(join(f.source, name)));
    }
    assert.equal(readFileSync(join(f.installed, 'data.json'), 'utf8'), '{"dictionaryPath":"custom.json","layout":"tree"}');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('deploy rejects missing or invalid vault arguments before changing installed files', () => {
  const f = fixture();
  try {
    assert.notEqual(f.run().status, 0);
    assert.notEqual(f.run(f.root).status, 0);
    assert.notEqual(f.run(f.vault, 'extra').status, 0);
    assert.equal(readFileSync(join(f.installed, 'main.js'), 'utf8'), 'old build');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('deploy checks all artifacts and installed plugin identity before copying', () => {
  const f = fixture();
  try {
    rmSync(join(f.source, 'styles.css'));
    assert.notEqual(f.run(f.vault).status, 0);
    assert.equal(readFileSync(join(f.installed, 'main.js'), 'utf8'), 'old build');
    writeFileSync(join(f.source, 'styles.css'), 'new styles');
    writeFileSync(join(f.installed, 'manifest.json'), JSON.stringify({ id: 'another-plugin' }));
    assert.notEqual(f.run(f.vault).status, 0);
    assert.equal(readFileSync(join(f.installed, 'main.js'), 'utf8'), 'old build');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
