import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Ontology, usage, validate } from 'tag-ontology';

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
    loop1: { description: 'X', broader: ['loop2'], related: ['loop2'] },
    loop2: { description: 'X', broader: ['loop1'] },
    below: { description: 'X', broader: ['loop1', 'loop2'] },
    child: { description: 'X', broader: ['root'], related: ['root'] },
    floating: { description: 'X' },
    deep: { description: 'X', broader: ['child', 'root'] },
  };
  writeFileSync(join(dir, 'Tag-Dictionary.json'), JSON.stringify(fixture));
  const ours = ourCodes(fixture);
  assert.deepEqual(new Set(ours), new Set(PYTHON_RULES.map(([, code]) => code)), 'the fixture breaks every rule');
  assert.deepEqual(ours, pythonCodes(dir));
});

// The note tags vault_meta.py reads, from the folders sync scans, archives included as sync includes them.
const pythonNotes = (root: string) => Object.entries(JSON.parse(execFileSync('python3', ['-B', '-c', [
  'import runpy,json',
  "m=runpy.run_path('99_Etc/scripts/vault_meta.py',run_name='read_only_check')",
  "print(json.dumps(m['note_tags'](True),ensure_ascii=False))",
].join('\n')], { cwd: root, encoding: 'utf8' })) as Record<string, string[]>).map(([path, tags]) => ({ path, tags }));

// sync prints a block per finding, headed "[미등록 2개]" and so on; this reads back the four that usage() also reports.
function syncFindings(root: string) {
  const out = execFileSync('python3', ['-B', '99_Etc/scripts/vault_meta.py', 'sync'], { cwd: root, encoding: 'utf8' });
  const blocks = new Map(out.split('\n\n').map(block => {
    const [head = '', ...lines] = block.split('\n');
    return [head.slice(1, head.indexOf(' ')), { head, lines: lines.map(line => line.trim()).filter(Boolean) }];
  }));
  return {
    unregistered: (blocks.get('미등록')?.lines ?? []).map(line => {
      const [tag = '', rest = ''] = line.split('  ← ');
      return { tag, similar: rest.split('⚠ 비슷한 태그: ')[1]?.split(', ') ?? [] };
    }),
    // In the order the tags are written; usage() sorts them by path and tag.
    nonCanonical: (blocks.get('별칭으로')?.lines ?? []).map(line => {
      const [, path = '', tag = '', canonical = ''] = /^(.+): '(.+)' → (.+)$/.exec(line) ?? [];
      return { path, tag, canonical };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.tag < b.tag ? -1 : 1),
    unused: blocks.get('사전에는')?.head.split('] ')[1]?.split(', ') ?? [],
    redundant: (blocks.get('상위·하위')?.lines ?? []).map(line => {
      const at = line.lastIndexOf('.md: ') + 3;
      return { path: line.slice(0, at), tags: line.slice(at + 2).split(', ').sort() };
    }),
    // sync prints at most 20 notes with redundant tags, but its heading counts them all.
    redundantNotes: Number(/(\d+)개 노트/.exec(blocks.get('상위·하위')?.head ?? '')?.[1] ?? 0),
  };
}

function ourFindings(root: string) {
  const result = usage(JSON.parse(readFileSync(join(root, 'Tag-Dictionary.json'), 'utf8')), pythonNotes(root));
  const redundant = new Map<string, string[]>();
  for (const row of result.redundant) redundant.set(row.path, [...redundant.get(row.path) ?? [], row.tag]);
  return {
    unregistered: result.unregistered.map(({ tag, similar }) => ({ tag, similar })),
    nonCanonical: result.nonCanonical,
    unused: result.unused,
    redundant: [...redundant].map(([path, tags]) => ({ path, tags: tags.sort() })),
  };
}

// The redundant notes sync printed must match ours for the same notes, and the count must match for all of them.
function assertAgree(root: string) {
  const { redundantNotes, ...theirs } = syncFindings(root), ours = ourFindings(root);
  assert.equal(ours.redundant.length, redundantNotes);
  const printed = new Set(theirs.redundant.map(row => row.path));
  assert.deepEqual({ ...ours, redundant: ours.redundant.filter(row => printed.has(row.path)) }, {
    ...theirs, redundant: theirs.redundant.sort((a, b) => a.path < b.path ? -1 : 1),
  });
  return theirs;
}

test('usage() reports what vault_meta.py sync reports, on the real vault and on one with every kind of finding', t => {
  assert.ok(process.env.OBSIDIAN_VAULT_PATH, 'Set OBSIDIAN_VAULT_PATH to the vault directory.');
  const root = resolve(process.env.OBSIDIAN_VAULT_PATH);
  assert.ok(assertAgree(root).redundant.length > 0, 'the real vault has redundant tags to compare');

  const dir = mkdtempSync(join(tmpdir(), 'tag-ontology-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '99_Etc', 'scripts'), { recursive: true });
  copyFileSync(join(root, '99_Etc', 'scripts', 'vault_meta.py'), join(dir, '99_Etc', 'scripts', 'vault_meta.py'));
  // sync reads these four folders and fails if one is missing.
  for (const folder of ['01_Projects', '02_Areas', '03_Resources', '04_Archives']) mkdirSync(join(dir, folder));
  writeFileSync(join(dir, 'Tag-Dictionary.json'), JSON.stringify({
    ai: { description: 'AI', aliases: ['artificial-intelligence'], broader: [] },
    'machine-learning': { description: 'ML', aliases: ['ML'], broader: ['ai'] },
    'deep-learning': { description: 'DL', broader: ['machine-learning'] },
    cnn: { description: 'CNN', broader: ['deep-learning'] },
    python: { description: 'Python', broader: [], facet: 'language' },
    pandas: { description: 'pandas', broader: ['python'] },
    'llm-agents': { description: 'Agents', broader: ['ai'] },
    'graph-database': { description: 'Unused', broader: ['ai'] },
  }));
  const note = (path: string, tags: string[]) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), `---\ntags:\n${tags.map(tag => `  - ${tag}\n`).join('')}---\n# ${path}\n`);
  };
  note('03_Resources/Training.md', ['ai', 'machine-learning', 'cnn']);
  // Two aliases on one note, written in the opposite of sorted order.
  note('03_Resources/ML - Overview.md', ['artificial-intelligence', 'ML', 'machine-learning', 'deep-learning']);
  note('03_Resources/Pandas.md', ['python', 'pandas', 'llm-agents']);
  note('01_Projects/p/archive/Typos.md', ['llm-agent', 'llmagents', 'cnns', 'transformer', 'transformers', 'rag']);
  // More notes with redundant tags than the 20 sync prints.
  for (let i = 10; i < 31; i++) note(`02_Areas/Generated/Note ${i}.md`, ['ai', 'cnn']);
  assert.ok(Object.values(assertAgree(dir)).every(found => found.length > 0), 'the fixture has every kind of finding');
});
