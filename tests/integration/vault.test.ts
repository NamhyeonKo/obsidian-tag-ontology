import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Ontology, validate } from 'tag-ontology';

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

// vault_meta.py's dictionary messages, by the issue code that stands for the same rule.
const PYTHON_RULES: [string, string][] = [
  ['형식 위반', 'name-format'], ['설명 없음', 'empty-description'], ['중복 상위', 'redundant-broader'], ['중복 ', 'name-collision'],
  ['사전에 없음', 'unknown-reference'], ['자기 자신', 'self-reference'], ['순환', 'broader-cycle'],
  ['related 이면서', 'related-in-hierarchy'], ['미배치', 'unplaced'],
];
const pythonCodes = (root: string) => (JSON.parse(execFileSync('python3', ['-B', '-c', [
  'import runpy,json',
  "m=runpy.run_path('99_Etc/scripts/vault_meta.py',run_name='read_only_check')",
  'errors,warns=[],[]',
  "m['tag_dictionary'](errors,warns)",
  'print(json.dumps(errors+warns,ensure_ascii=False))',
].join('\n')], { cwd: root, encoding: 'utf8' })) as string[])
  .map(message => PYTHON_RULES.find(([text]) => message.includes(text))?.[1] ?? message).sort();
// vault_meta.py has no Obsidian name rule, and requires kebab-case names.
const ourCodes = (raw: unknown) => validate(raw, { names: 'kebab' }).filter(issue => issue.code !== 'invalid-name').map(issue => issue.code).sort();

test('validate() finds what vault_meta.py finds, rule by rule, on the real dictionary and on one that breaks every rule', t => {
  assert.ok(process.env.OBSIDIAN_VAULT_PATH, 'Set OBSIDIAN_VAULT_PATH to the vault directory.');
  const root = resolve(process.env.OBSIDIAN_VAULT_PATH);
  assert.deepEqual(ourCodes(JSON.parse(readFileSync(join(root, 'Tag-Dictionary.json'), 'utf8'))), pythonCodes(root));

  // The script finds the dictionary two folders above itself, so a copy reads the fixture and the vault is left alone.
  const dir = mkdtempSync(join(tmpdir(), 'tag-ontology-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '99_Etc', 'scripts'), { recursive: true });
  copyFileSync(join(root, '99_Etc', 'scripts', 'vault_meta.py'), join(dir, '99_Etc', 'scripts', 'vault_meta.py'));
  const fixture = {
    root: { description: 'Root', broader: [] },
    Snake_Case: { description: 'Not kebab-case', broader: ['root'] },
    blank: { description: '', broader: ['root'] },
    ml: { description: 'X', aliases: ['ML'], broader: ['root'] },
    'machine-learning': { description: 'X', aliases: ['ml'], broader: ['root'] },
    dangling: { description: 'X', broader: ['nowhere'], related: ['gone'] },
    narcissus: { description: 'X', broader: ['root'], related: ['narcissus'] },
    loop1: { description: 'X', broader: ['loop2'] },
    loop2: { description: 'X', broader: ['loop1'] },
    below: { description: 'X', broader: ['loop1'] },
    child: { description: 'X', broader: ['root'], related: ['root'] },
    floating: { description: 'X' },
    deep: { description: 'X', broader: ['child', 'root'] },
  };
  writeFileSync(join(dir, 'Tag-Dictionary.json'), JSON.stringify(fixture));
  const ours = ourCodes(fixture);
  assert.deepEqual(new Set(ours), new Set(PYTHON_RULES.map(([, code]) => code)), 'the fixture breaks every rule');
  assert.deepEqual(ours, pythonCodes(dir));
});
