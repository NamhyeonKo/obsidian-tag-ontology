import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Ontology } from '../../src/ontology.ts';

test('real vault counts agree with the existing Python CLI for root, middle and leaf', () => {
  assert.ok(process.env.OBSIDIAN_VAULT_PATH, 'Set OBSIDIAN_VAULT_PATH to the vault directory.');
  const root = resolve(process.env.OBSIDIAN_VAULT_PATH);
  const baseline = JSON.parse(execFileSync('python3', ['-B', '-c', [
    'import runpy,json',
    "m=runpy.run_path('99_Etc/scripts/vault_meta.py',run_name='read_only_check')",
    "print(json.dumps(m['note_tags'](),ensure_ascii=False))",
  ].join('\n')], { cwd: root, encoding: 'utf8' })) as Record<string, string[]>;
  const model = new Ontology(JSON.parse(readFileSync(join(root, 'Tag-Dictionary.json'), 'utf8')),
    Object.entries(baseline).map(([path, tags]) => ({ path, tags })));
  assert.equal(model.roots.length, 14);
  for (const tag of ['ai', 'machine-learning', 'dropout']) {
    for (const exact of [true, false]) {
      const lines = execFileSync('python3', ['-B', '99_Etc/scripts/vault_meta.py', 'notes', tag, ...(exact ? ['--exact'] : [])],
        { cwd: root, encoding: 'utf8' }).trim();
      const paths = lines ? lines.split('\n').map(line => line.split('  [')[0]).sort() : [];
      assert.deepEqual(model.notesFor(tag, !exact), paths, `${tag} exact=${exact}`);
    }
  }
});
