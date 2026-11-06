import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cli, copyOfFixture, fixture, json } from './cli-helper.ts';

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

test('--help aligns the --tags-file description with adjacent option descriptions', () => {
  const help = cli(['--help']).stdout;
  assert.match(help, /^  --tags-file <file>    Tags for files without them; repeatable \(scan, usage, show\)$/m);
});

test('--version and --help print and exit 0', () => {
  assert.deepEqual(cli(['--version']), { code: 0, stdout: `${version}\n`, stderr: '' });
  const help = cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: tag-ontology <command>/);
  assert.match(help.stdout, /^  --tags-file <file>    Tags for files without them; repeatable \(scan, usage, show\)$/m);
});

test('wrong usage exits 2 with nothing on stdout and the reason on stderr', () => {
  for (const args of [[], ['frobnicate'], ['check', '--nope'], ['scan', '--strict'], ['check', '--exclude', 'x'], ['check', 'extra'],
    ['show'], ['check', '--names', 'snake'], ['check', '--dictionary', 'missing.json'], ['scan', '../'], ['scan', 'missing.md'], ['scan', '--tags-file', 'missing.json']]) {
    const run = cli([...args, '--json']);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(run.stdout, '', args.join(' '));
    assert.match(run.stderr, /^tag-ontology: /, args.join(' '));
  }
  assert.match(cli(['check', '--dictionary', 'missing.json']).stderr, /missing\.json/);
});

test('check prints the common fields and exits 0 on a clean dictionary', () => {
  const run = json(['check']);
  assert.equal(run.code, 0);
  assert.deepEqual(run.doc, { schemaVersion: 1, command: 'check', ok: true, issues: [] });
  assert.ok(run.stdout.endsWith('}\n') && run.stdout.indexOf('\n') === run.stdout.length - 1, 'one JSON document and a newline');
  assert.match(cli(['check']).stdout, /No problems/);
});

test('--root points at the vault from anywhere', () => {
  assert.equal(json(['check', '--root', fixture], tmpdir()).code, 0);
  assert.equal(json(['--root', fixture, 'check'], tmpdir()).code, 0);
  assert.equal(json(['check', '--dictionary', join(fixture, 'Tag-Dictionary.json')], tmpdir()).code, 0);
});

test('a dictionary that is not JSON is an invalid-dictionary error, exit 1', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), '{ "ai": ');
  const run = json(['check'], vault);
  assert.equal(run.code, 1);
  assert.equal(run.doc.ok, false);
  assert.deepEqual((run.doc.issues as { code: string }[]).map(issue => issue.code), ['invalid-dictionary']);
});

test('warnings fail only with --strict; --names kebab adds name-format', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({ Snake_Case: { description: 'X', broader: [] }, loose: { description: 'Y' } }));
  assert.equal(json(['check'], vault).code, 0);
  const strict = json(['check', '--strict'], vault);
  assert.equal(strict.code, 1);
  assert.equal(strict.doc.ok, false);
  const codes = (args: string[]) => (json(args, vault).doc.issues as { code: string }[]).map(issue => issue.code);
  assert.deepEqual(codes(['check']), ['unplaced']);
  assert.deepEqual(codes(['check', '--names', 'kebab']), ['name-format', 'unplaced']);
});

test('scan reads every note, with invalid frontmatter as a warning, and exits 0', () => {
  const run = json(['scan']);
  assert.equal(run.code, 0);
  assert.equal(run.doc.ok, true);
  const notes = run.doc.notes as { path: string }[];
  assert.deepEqual(notes.map(note => note.path), ['Nested/Deep/Note.md', 'notes/Alpha.md', 'notes/Broken.md', 'notes/archive/Old.md']);
  assert.deepEqual(notes[1], {
    path: 'notes/Alpha.md',
    frontmatter: { tags: ['machine-learning', 'cnn'], type: 'resource' },
    tags: ['machine-learning', 'cnn'],
    bodyTags: ['deep-learning', 'ML', 'ai'],
    headings: [{ level: 1, text: 'Alpha' }, { level: 2, text: 'Details #ai' }],
  });
  assert.deepEqual((run.doc.issues as { code: string; path: string }[]).map(({ code, path }) => ({ code, path })),
    [{ code: 'invalid-frontmatter', path: 'notes/Broken.md' }]);
});

test('scan narrows to paths and skips excluded notes', () => {
  const paths = (args: string[]) => (json(['scan', ...args]).doc.notes as { path: string }[]).map(note => note.path);
  assert.deepEqual(paths(['notes/archive']), ['notes/archive/Old.md']);
  assert.deepEqual(paths(['--exclude', 'notes']), ['Nested/Deep/Note.md']);
  assert.deepEqual(paths(['--exclude', 'notes', '--exclude', 'Nested']), []);
});

test('options need their values and are accepted only by the commands that use them', () => {
  for (const args of [['check', '--root'], ['check', '--root', '--json'], ['scan', '--dictionary', 'x'],
    ['show', 'ai', '--strict'], ['check', '--notes'], ['usage', '--base', 'x'], ['apply', 'changes.json', 'extra']]) {
    const run = cli(args);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(run.stdout, '');
  }
  const longPath = cli(['check', '--dictionary', 'a'.repeat(300), '--json']);
  assert.equal(longPath.code, 2);
  assert.equal(longPath.stdout, '');
});

test('scan reports non-JSON frontmatter without losing tags or aborting other notes', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'notes/Cyclic.md'), '---\ntags: [ai]\nthing: &anchor\n  child: *anchor\n---\n# Heading\n#quantum\n');
  writeFileSync(join(vault, 'notes/Shared.md'), '---\nthing: &anchor { child: value }\nother: *anchor\n---\n');
  const run = json(['scan', 'notes/Cyclic.md', 'notes/Shared.md'], vault);
  assert.equal(run.code, 0);
  assert.deepEqual(run.doc.notes, [
    { path: 'notes/Cyclic.md', frontmatter: null, tags: ['ai'], bodyTags: ['quantum'], headings: [{ level: 1, text: 'Heading' }] },
    { path: 'notes/Shared.md', frontmatter: { thing: { child: 'value' }, other: { child: 'value' } }, tags: [], bodyTags: [], headings: [] },
  ]);
  assert.deepEqual((run.doc.issues as { code: string; path: string }[]).map(({ code, path }) => ({ code, path })),
    [{ code: 'invalid-frontmatter', path: 'notes/Cyclic.md' }]);
});
