import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cli, copyOfFixture, json } from './cli-helper.ts';

const hashOf = (file: string) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
const draft = (over: object) => ({ name: 'x', description: 'X', aliases: [], parents: [], children: [], related: [], ...over });
const write = (dir: string, changes: unknown) => { writeFileSync(join(dir, 'changes.json'), JSON.stringify(changes)); return 'changes.json'; };

test('plan applies changes in memory, reports the diff and the base hash, and writes nothing', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json'), before = readFileSync(dictionary, 'utf8');
  const file = write(vault, { schemaVersion: 1, changes: [
    { kind: 'add', draft: draft({ name: 'transformer', description: 'Attention-based networks', parents: ['deep-learning'] }) },
    { kind: 'delete', tag: 'unused-leaf' },
  ] });
  const run = json(['plan', file], vault);
  assert.equal(run.code, 0);
  assert.deepEqual(run.doc, {
    schemaVersion: 1, command: 'plan', ok: true, issues: [],
    base: hashOf(dictionary),
    diff: [
      { tag: 'transformer', status: 'added', after: { description: 'Attention-based networks', broader: ['deep-learning'] } },
      { tag: 'unused-leaf', status: 'removed', before: { description: 'No note uses this', broader: ['ai'] } },
    ],
  });
  assert.equal(readFileSync(dictionary, 'utf8'), before);
});

test('a change that cannot apply is an invalid-change, exit 1, with no diff', t => {
  const vault = copyOfFixture(t);
  const run = json(['plan', write(vault, { changes: [{ kind: 'delete', tag: 'gone' }] })], vault);
  assert.equal(run.code, 1);
  assert.deepEqual((run.doc.issues as { code: string; change: number }[]).map(({ code, change }) => ({ code, change })), [{ code: 'invalid-change', change: 0 }]);
  assert.equal('diff' in run.doc, false);
});

test('a result with errors exits 1; with warnings, only with --strict', t => {
  const vault = copyOfFixture(t);
  const broken = json(['plan', write(vault, { changes: [{ kind: 'add', draft: draft({ name: 'orphan', parents: ['gone'] }) }] })], vault);
  assert.equal(broken.code, 1);
  assert.deepEqual((broken.doc.issues as { code: string }[]).map(issue => issue.code), ['unknown-reference']);
  const file = write(vault, { changes: [{ kind: 'add', draft: draft({ name: 'blank', description: '', parents: ['ai'] }) }] });
  assert.equal(json(['plan', file], vault).code, 0);
  assert.equal(json(['plan', file, '--strict'], vault).code, 1);
});

test('a changes file of the wrong shape is wrong usage', t => {
  const vault = copyOfFixture(t);
  const bad: unknown[] = [
    [], { changes: {} }, { schemaVersion: 2, changes: [] }, { changes: [], extra: true },
    { changes: [{ kind: 'rename', tag: 'ai' }] }, { changes: [{ kind: 'delete' }] }, { changes: [{ kind: 'delete', tag: 'ai', draft: {} }] },
    { changes: [{ kind: 'add', draft: { ...draft({ name: 'y' }), parent: ['ai'] } }] }, { changes: [{ kind: 'add', draft: { name: 'y' } }] },
    { changes: [{ kind: 'edit', tag: 'ai', draft: draft({ aliases: 'AI' }) }] },
  ];
  for (const changes of bad) {
    const run = cli(['plan', write(vault, changes), '--json'], vault);
    assert.equal(run.code, 2, JSON.stringify(changes));
    assert.equal(run.stdout, '');
  }
  writeFileSync(join(vault, 'changes.json'), '{ not json');
  assert.equal(cli(['plan', 'changes.json'], vault).code, 2);
  assert.equal(cli(['plan', 'missing.json'], vault).code, 2);
});

test('apply writes the result when the hash still matches, in the plugin\'s layout', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json');
  const file = write(vault, { changes: [{ kind: 'add', draft: draft({ name: 'transformer', description: 'Attention', parents: ['deep-learning'] }) }] });
  const base = hashOf(dictionary);
  const run = json(['apply', file, '--base', base], vault);
  assert.equal(run.code, 0);
  assert.equal(run.doc.written, true);
  assert.equal(run.doc.base, base);
  assert.equal(run.doc.hash, hashOf(dictionary));
  assert.match(readFileSync(dictionary, 'utf8'), /^"transformer": \{"description": "Attention", "broader": \["deep-learning"\]\},$/m);
  assert.equal(json(['check'], vault).code, 0);
});

test('apply refuses a stale base with exit 3 and writes nothing', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json'), before = readFileSync(dictionary, 'utf8');
  const stale = `sha256:${'0'.repeat(64)}`;
  const run = json(['apply', write(vault, { changes: [{ kind: 'delete', tag: 'unused-leaf' }] }), '--base', stale], vault);
  assert.equal(run.code, 3);
  assert.equal(run.doc.ok, false);
  assert.equal(run.doc.written, false);
  assert.deepEqual(run.doc.conflict, { base: stale, current: hashOf(dictionary) });
  assert.equal(readFileSync(dictionary, 'utf8'), before);
});

test('apply writes nothing for a result with errors, or with nothing to change', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json'), before = readFileSync(dictionary, 'utf8');
  const base = hashOf(dictionary);
  const broken = json(['apply', write(vault, { changes: [{ kind: 'add', draft: draft({ name: 'orphan', parents: ['gone'] }) }] }), '--base', base], vault);
  assert.deepEqual([broken.code, broken.doc.written], [1, false]);
  const empty = json(['apply', write(vault, { changes: [] }), '--base', base], vault);
  assert.deepEqual([empty.code, empty.doc.written, empty.doc.diff], [0, false, []]);
  assert.equal(readFileSync(dictionary, 'utf8'), before);
});

test('apply needs a well-formed --base', t => {
  const vault = copyOfFixture(t), file = write(vault, { changes: [] });
  assert.equal(cli(['apply', file], vault).code, 2);
  assert.equal(cli(['apply', file, '--base', 'abc'], vault).code, 2);
  assert.equal(cli(['plan', file, '--base', hashOf(join(vault, 'Tag-Dictionary.json'))], vault).code, 2);
});

test('apply --strict refuses warnings and preserves the file bytes', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json'), before = readFileSync(dictionary, 'utf8');
  const file = write(vault, { changes: [{ kind: 'add', draft: draft({ name: 'blank', description: '' }) }] });
  const run = json(['apply', file, '--base', hashOf(dictionary), '--strict'], vault);
  assert.deepEqual([run.code, run.doc.written], [1, false]);
  assert.equal(readFileSync(dictionary, 'utf8'), before);
});

test('plan can repair dictionary references; apply checks the base before the result', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json');
  writeFileSync(dictionary, JSON.stringify({ leaf: { description: 'Leaf', broader: ['missing'] } }));
  const file = write(vault, { changes: [{ kind: 'add', draft: draft({ name: 'missing' }) }] });
  assert.equal(json(['plan', file], vault).code, 0);
  const stale = `sha256:${'0'.repeat(64)}`;
  writeFileSync(dictionary, 'invalid JSON');
  assert.equal(json(['apply', file, '--base', stale], vault).code, 3);
  assert.equal(json(['apply', file, '--base', hashOf(dictionary)], vault).code, 1);
});

test('plan removes dangling related references while preserving the original dictionary', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json');
  const original = JSON.stringify({ a: { description: 'A', broader: [], related: ['missing'] } });
  writeFileSync(dictionary, original);
  const file = write(vault, { changes: [{ kind: 'edit', tag: 'a', draft: draft({ name: 'a', description: 'A' }) }] });
  const run = json(['plan', file], vault);
  assert.equal(run.code, 0);
  assert.deepEqual(run.doc.issues, []);
  assert.deepEqual(run.doc.diff, [{
    tag: 'a', status: 'changed', before: { description: 'A', broader: [], related: ['missing'] }, after: { description: 'A', broader: [] },
  }]);
  assert.equal(readFileSync(dictionary, 'utf8'), original);
});
