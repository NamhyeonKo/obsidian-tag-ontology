import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cli, copyOfFixture, json } from './cli-helper.ts';

function overlayVault(t: { after: (fn: () => void) => void }): string {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({
    ai: { description: 'AI', broader: [] },
    retrieval: { description: 'Retrieval', broader: ['ai'] },
    rag: { description: 'RAG', broader: ['retrieval'], aliases: ['retrieval-augmented generation'] },
  }));
  mkdirSync(join(vault, 'docs'));
  writeFileSync(join(vault, 'docs/Plain.md'), '# Plain\n');
  writeFileSync(join(vault, 'docs/Tagged.md'), '---\ntags: [ai]\n---\n');
  writeFileSync(join(vault, 'shared.json'), JSON.stringify({
    'docs/Plain.md': { tags: ['#rag', ' rag '], sha256: 'x' },
    'docs/Gone.md': { tags: ['ai'] },
  }));
  writeFileSync(join(vault, 'local.json'), JSON.stringify({ './docs/Plain.md': { tags: ['retrieval'] } }));
  return vault;
}

test('scan reports overlay tags from every --tags-file, normalized and combined', t => {
  const run = json(['scan', 'docs', '--tags-file', 'shared.json', '--tags-file', 'local.json'], overlayVault(t));
  assert.equal(run.code, 0);
  const byPath = new Map((run.doc.notes as { path: string; overlayTags: string[]; tags: string[] }[]).map(n => [n.path, n]));
  assert.deepEqual(byPath.get('docs/Plain.md')?.overlayTags, ['rag', 'retrieval']);
  assert.deepEqual(byPath.get('docs/Tagged.md')?.overlayTags, []);
  assert.deepEqual((run.doc.issues as { code: string; path: string }[]).filter(i => i.code === 'overlay-missing-note').map(i => i.path), ['docs/Gone.md']);
});

test('scan without --tags-file prints no overlayTags field', t => {
  const run = json(['scan', 'docs'], overlayVault(t));
  assert.ok((run.doc.notes as object[]).every(n => !('overlayTags' in n)));
});

test('show and usage count overlay tags like note tags', t => {
  const vault = overlayVault(t);
  const shown = json(['show', 'ai', '--notes', '--tags-file', 'shared.json'], vault).doc;
  assert.ok((shown.notePaths as string[]).includes('docs/Plain.md'));
  assert.deepEqual((shown.issues as { code: string; path: string }[]).filter(i => i.code === 'overlay-missing-note').map(i => i.path), ['docs/Gone.md']);
  const used = json(['usage', '--tags-file', 'shared.json'], vault).doc;
  assert.ok(!(used.unused as string[]).includes('rag'));
  assert.deepEqual((used.issues as { code: string; path: string }[]).filter(i => i.code === 'overlay-missing-note').map(i => i.path), ['docs/Gone.md']);
});

test('a malformed overlay file or key is wrong usage, exit 2', t => {
  const vault = overlayVault(t);
  for (const body of ['[]', '{"docs/Plain.md": {"tags": "rag"}}', '{"../x.md": {"tags": ["ai"]}}', '{"/outside.md": {"tags": ["ai"]}}', '{"C:/outside.md": {"tags": ["ai"]}}', '{"docs\\\\Plain.md": {"tags": ["ai"]}}', 'not json']) {
    writeFileSync(join(vault, 'bad.json'), body);
    assert.equal(cli(['scan', '--tags-file', 'bad.json'], vault).code, 2, body);
  }
});

test('an overlay key differing only in case from the file is reported missing', t => {
  const vault = overlayVault(t);
  writeFileSync(join(vault, 'case.json'), JSON.stringify({ 'docs/plain.md': { tags: ['ai'] } }));
  const run = json(['scan', 'docs', '--tags-file', 'case.json'], vault);
  assert.deepEqual((run.doc.issues as { code: string; path: string }[]).filter(i => i.code === 'overlay-missing-note').map(i => i.path), ['docs/plain.md']);
});

test('an overlay key with a case-mismatched parent directory is reported missing', t => {
  const vault = overlayVault(t);
  writeFileSync(join(vault, 'case.json'), JSON.stringify({ 'Docs/Plain.md': { tags: ['ai'] } }));
  const run = json(['scan', 'docs', '--tags-file', 'case.json'], vault);
  assert.deepEqual((run.doc.issues as { code: string; path: string }[]).filter(i => i.code === 'overlay-missing-note').map(i => i.path), ['Docs/Plain.md']);
});

test('overlay path checks propagate filesystem errors other than missing paths', t => {
  const vault = overlayVault(t);
  const blocked = join(vault, 'blocked');
  mkdirSync(blocked);
  writeFileSync(join(vault, 'blocked.json'), JSON.stringify({ 'blocked/Plain.md': { tags: ['ai'] } }));
  writeFileSync(join(blocked, 'Plain.md'), '');
  chmodSync(blocked, 0);
  let run: ReturnType<typeof cli>;
  try { run = cli(['usage', '--exclude', 'blocked', '--tags-file', 'blocked.json'], vault); }
  finally { chmodSync(blocked, 0o700); }
  assert.equal(run.code, 2);
  assert.match(run.stderr, /EACCES|EPERM/);
});

test('--tags-file is refused for check, plan and apply', t => {
  const vault = overlayVault(t);
  assert.equal(cli(['check', '--tags-file', 'shared.json'], vault).code, 2);
  assert.equal(cli(['plan', 'changes.json', '--tags-file', 'shared.json'], vault).code, 2);
  assert.equal(cli(['apply', 'changes.json', '--base', `sha256:${'0'.repeat(64)}`, '--tags-file', 'shared.json'], vault).code, 2);
});
