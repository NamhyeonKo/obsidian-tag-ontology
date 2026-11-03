import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { serialize } from '../src/core/dictionary.ts';
import { readDictionary, writeDictionary } from '../src/vault/dictionary-file.ts';

const temp = (t: { after: (fn: () => void) => void }) => {
  const dir = mkdtempSync(join(tmpdir(), 'tag-ontology-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
};
const sha256 = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('reading gives the parsed dictionary and the SHA-256 of its bytes', t => {
  const file = join(temp(t), 'Tag-Dictionary.json');
  writeFileSync(file, '{\n"ai": {"description": "AI", "broader": []}\n}\n');
  const read = readDictionary(file);
  assert.deepEqual(read.raw, { ai: { description: 'AI', broader: [] } });
  assert.equal(read.hash, sha256(readFileSync(file)));
  assert.match(read.hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(read.issues, []);
});

test('a file that is not JSON is an invalid-dictionary error, not an exception', t => {
  const file = join(temp(t), 'Tag-Dictionary.json');
  writeFileSync(file, '{ "ai": ');
  const read = readDictionary(file);
  assert.equal(read.raw, undefined);
  assert.deepEqual(read.issues.map(({ code, severity }) => ({ code, severity })), [{ code: 'invalid-dictionary', severity: 'error' }]);
});

test('a missing file throws', t => {
  assert.throws(() => readDictionary(join(temp(t), 'missing.json')), { code: 'ENOENT' });
});

test('writing replaces the file with the serialized dictionary and leaves no temporary file', t => {
  const dir = temp(t), file = join(dir, 'Tag-Dictionary.json');
  writeFileSync(file, '{}');
  const dict = { ml: { description: 'ML', broader: ['ai'] }, ai: { description: 'AI', broader: [] } };
  const hash = writeDictionary(file, dict);
  assert.equal(readFileSync(file, 'utf8'), serialize(dict));
  assert.equal(hash, sha256(readFileSync(file)));
  assert.deepEqual(readdirSync(dir), ['Tag-Dictionary.json']);
});
