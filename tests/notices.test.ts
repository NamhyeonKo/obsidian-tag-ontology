import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { licenseNotice } from '../scripts/notices.mjs';

// A project with dependency a, which needs b and c; a and c ship the same licence text, b ships none.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tag-ontology-notices-'));
  const pkg = (dir: string, json: object, licence?: [string, string]) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(json));
    if (licence) writeFileSync(join(dir, licence[0]), licence[1]);
  };
  pkg(root, { dependencies: { a: '1' }, devDependencies: { dev: '1' } });
  pkg(join(root, 'node_modules/a'), { name: 'a', version: '1.0.0', license: 'MIT', dependencies: { b: '2', c: '1' } }, ['LICENSE', 'MIT text with */ inside']);
  pkg(join(root, 'node_modules/b'), { name: 'b', version: '2.0.0', license: 'ISC' });
  pkg(join(root, 'node_modules/c'), { name: 'c', version: '1.0.0', license: 'MIT' }, ['LICENSE.md', 'MIT text with */ inside']);
  pkg(join(root, 'node_modules/dev'), { name: 'dev', version: '1.0.0', license: 'MIT' }, ['LICENSE', 'dev only']);
  return root;
}

test('the notice lists every runtime dependency, transitive ones included, and leaves dev dependencies out', () => {
  const notice = licenseNotice(fixture());
  for (const name of ['a@1.0.0', 'b@2.0.0', 'c@1.0.0']) assert.ok(notice.includes(name), name);
  assert.ok(!notice.includes('dev@1.0.0') && !notice.includes('dev only'));
});

test('packages with the same licence text share one copy of it', () => {
  const notice = licenseNotice(fixture());
  assert.ok(notice.includes('a@1.0.0, c@1.0.0'));
  assert.equal(notice.split('MIT text with').length, 2);
});

test('a package without a licence file is named with its licence field', () => {
  assert.ok(licenseNotice(fixture()).includes('b@2.0.0\n\nISC'));
});

test('the notice is one comment that a licence text cannot close early', () => {
  const notice = licenseNotice(fixture());
  assert.ok(notice.startsWith('/*!'));
  assert.ok(notice.endsWith('*/'));
  assert.equal(notice.indexOf('*/'), notice.length - 2);
});
