import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/vault/scan.ts';

const root = fileURLToPath(new URL('fixtures/vault/', import.meta.url));
const paths = (result: ReturnType<typeof scan>) => result.notes.map(note => note.path);

test('every .md note under the root, sorted, skipping hidden paths and other files', () => {
  assert.deepEqual(paths(scan(root)), ['Nested/Deep/Note.md', 'notes/Alpha.md', 'notes/Broken.md', 'notes/archive/Old.md']);
});

test('a note is read into frontmatter, tags, body tags and headings', () => {
  assert.deepEqual(scan(root, { paths: ['notes/Alpha.md'] }).notes, [{
    path: 'notes/Alpha.md',
    frontmatter: { tags: ['machine-learning', 'cnn'], type: 'resource' },
    tags: ['machine-learning', 'cnn'],
    bodyTags: ['deep-learning', 'ML', 'ai'],
    headings: [{ level: 1, text: 'Alpha' }, { level: 2, text: 'Details #ai' }],
  }]);
});

test('invalid frontmatter is null, with an invalid-frontmatter warning for the note', () => {
  const result = scan(root, { paths: ['notes/Broken.md'] });
  assert.deepEqual(result.notes.map(({ frontmatter, tags, bodyTags }) => ({ frontmatter, tags, bodyTags })),
    [{ frontmatter: null, tags: [], bodyTags: ['quantum'] }]);
  assert.deepEqual(result.issues.map(({ code, severity, path }) => ({ code, severity, path })),
    [{ code: 'invalid-frontmatter', severity: 'warning', path: 'notes/Broken.md' }]);
});

test('paths narrow the scan to files and folders, each note once', () => {
  assert.deepEqual(paths(scan(root, { paths: ['notes', 'notes/Alpha.md', './Nested/'] })),
    ['Nested/Deep/Note.md', 'notes/Alpha.md', 'notes/Broken.md', 'notes/archive/Old.md']);
});

test('an exclude glob skips the notes it matches and the folders below a folder it matches', () => {
  const excluded = (...exclude: string[]) => paths(scan(root, { exclude }));
  assert.deepEqual(excluded('notes/archive'), ['Nested/Deep/Note.md', 'notes/Alpha.md', 'notes/Broken.md']);
  assert.deepEqual(excluded('**/archive', 'Nested'), ['notes/Alpha.md', 'notes/Broken.md']);
  // * and ? stay within one segment; ** spans any number.
  assert.deepEqual(excluded('*/B?oken.md'), ['Nested/Deep/Note.md', 'notes/Alpha.md', 'notes/archive/Old.md']);
  assert.deepEqual(excluded('*.md'), paths(scan(root)));
  assert.deepEqual(excluded('**/*.md'), []);
});

test('a path outside the root, or one that does not exist, is refused', () => {
  assert.throws(() => scan(root, { paths: ['../'] }), /outside/);
  assert.throws(() => scan(root, { paths: ['missing.md'] }), /missing\.md/);
});

test('symbolic links are not followed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tag-ontology-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(root, 'notes'), join(dir, 'notes'), { recursive: true });
  symlinkSync(join(dir, 'notes'), join(dir, 'linked'));
  symlinkSync(join(dir, 'notes', 'Alpha.md'), join(dir, 'Alias.md'));
  assert.deepEqual(paths(scan(dir)), ['notes/Alpha.md', 'notes/Broken.md', 'notes/archive/Old.md']);
});
