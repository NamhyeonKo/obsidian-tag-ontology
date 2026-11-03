import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cli, copyOfFixture, json } from './cli-helper.ts';

test('usage compares the notes with the dictionary', () => {
  const run = json(['usage']);
  assert.equal(run.code, 0);
  assert.deepEqual(run.doc, {
    schemaVersion: 1, command: 'usage', ok: true,
    issues: [{ code: 'invalid-frontmatter', severity: 'warning', path: 'notes/Broken.md', message: (run.doc.issues as { message: string }[])[0]?.message }],
    scanned: 4,
    unregistered: [{ tag: 'quantum', notes: ['notes/Broken.md'], similar: [] }],
    nonCanonical: [{ path: 'notes/Alpha.md', tag: 'ML', canonical: 'machine-learning' }],
    unused: ['unused-leaf'],
    redundant: [
      { path: 'notes/Alpha.md', tag: 'ai', narrower: ['cnn', 'deep-learning', 'machine-learning'] },
      { path: 'notes/Alpha.md', tag: 'deep-learning', narrower: ['cnn'] },
      { path: 'notes/Alpha.md', tag: 'machine-learning', narrower: ['cnn', 'deep-learning'] },
    ],
  });
  assert.equal(json(['usage', '--strict']).code, 1);
  assert.match(cli(['usage']).stdout, /quantum/);
});

test('usage with paths reports on those notes, and judges unused over the whole vault', () => {
  const run = json(['usage', 'notes/archive']);
  assert.equal(run.code, 0);
  assert.deepEqual([run.doc.scanned, run.doc.unregistered, run.doc.nonCanonical, run.doc.redundant, run.doc.issues], [1, [], [], [], []]);
  assert.deepEqual(run.doc.unused, ['unused-leaf']);
});

test('usage and show report a dictionary with errors and nothing else, exit 1', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({ ai: { description: 'AI', broader: ['gone'] } }));
  for (const args of [['usage'], ['show', 'ai']]) {
    const run = json(args, vault);
    assert.equal(run.code, 1);
    assert.deepEqual(Object.keys(run.doc), ['schemaVersion', 'command', 'ok', 'issues']);
    assert.deepEqual((run.doc.issues as { code: string }[]).map(issue => issue.code), ['unknown-reference']);
  }
});

test('show finds a tag by alias and gives its place, notes and draft', () => {
  const run = json(['show', 'ML']);
  assert.equal(run.code, 0);
  assert.deepEqual(run.doc, {
    schemaVersion: 1, command: 'show', ok: true, issues: [],
    tag: 'machine-learning',
    matchedAlias: 'ML',
    entry: { aliases: ['ML'], description: 'Learning from data', broader: ['ai'] },
    placed: true,
    paths: [['ai', 'machine-learning']],
    descendants: 2,
    notes: { direct: 1, rollup: 2 },
    draft: { name: 'machine-learning', description: 'Learning from data', aliases: ['ML'], parents: ['ai'], children: ['deep-learning'], related: [] },
  });
  assert.match(cli(['show', 'ML']).stdout, /Learning from data/);
});

test('show finds a tag by name ignoring case, lists notes with --notes, and only its own with --exact', () => {
  const run = json(['show', 'Machine-Learning', '--notes']);
  assert.equal(run.doc.tag, 'machine-learning');
  assert.equal('matchedAlias' in run.doc, false);
  assert.deepEqual(run.doc.notePaths, ['Nested/Deep/Note.md', 'notes/Alpha.md']);
  assert.deepEqual(json(['show', 'machine-learning', '--notes', '--exact']).doc.notePaths, ['notes/Alpha.md']);
  assert.deepEqual(json(['show', 'cnn']).doc.paths, [['ai', 'machine-learning', 'deep-learning', 'cnn']]);
  assert.deepEqual(json(['show', 'machine-learning', '--exclude', 'notes']).doc.notes, { direct: 0, rollup: 1 });
});

test('show of an unknown tag is wrong usage, with suggestions', () => {
  const run = cli(['show', 'machine']);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /Unknown tag machine.*machine-learning/);
});

test('show prefers tag names over aliases, rejects ambiguous aliases, and filters warnings', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({
    a: { description: 'A', aliases: ['Shared', 'b'], broader: [] },
    b: { description: 'B', aliases: ['shared'], broader: ['a'] },
    loose: { description: 'Loose' },
  }));
  assert.equal(json(['show', 'b'], vault).doc.tag, 'b');
  assert.equal(json(['show', 'B'], vault).doc.tag, 'b');
  const run = cli(['show', 'SHARED', '--json'], vault);
  assert.equal(run.code, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /Ambiguous.*a, b/);
  assert.deepEqual((json(['show', 'a'], vault).doc.issues as { code: string }[]).map(item => item.code), ['name-collision', 'name-collision']);
  const loose = json(['show', 'loose'], vault).doc;
  assert.equal(loose.placed, false);
  assert.deepEqual(loose.paths, [['loose']]);
});

test('show lists every parent chain and preserves unknown entry fields', t => {
  const vault = copyOfFixture(t);
  const entry = { description: 'Leaf', broader: ['a', 'b'], custom: { keep: true } };
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({
    a: { description: 'A', broader: [] }, b: { description: 'B', broader: [] }, leaf: entry,
  }));
  const run = json(['show', 'leaf'], vault);
  assert.deepEqual(run.doc.paths, [['a', 'leaf'], ['b', 'leaf']]);
  assert.deepEqual(run.doc.entry, entry);
});
