import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { serialize, type RawDictionary } from '../src/core/dictionary.ts';
import { cli, copyOfFixture, json } from './cli-helper.ts';

const dict: RawDictionary = {
  ai: { description: 'AI', broader: [] },
  stats: { description: 'Statistics', broader: [] },
  ml: { description: 'ML', broader: ['ai', 'stats'], related: ['ops'] },
  ops: { description: 'Ops', broader: [] },
  dl: { description: 'DL', broader: ['ml'] },
  cnn: { description: 'CNN', broader: ['dl'], facet: 'technique', note: 'kept' },
  nlp: { description: 'NLP', broader: ['ai'], aliases: ['Natural language processing'] },
};

function subsetVault(t: { after: (fn: () => void) => void }): string {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify(dict));
  return vault;
}

test('subset gives the tags with every broader ancestor, related pruned to the subset', t => {
  const vault = subsetVault(t);
  const run = cli(['subset', 'cnn'], vault);
  assert.equal(run.code, 0);
  const expected = {
    ai: dict.ai!,
    stats: dict.stats!,
    ml: { description: 'ML', broader: ['ai', 'stats'] },
    dl: dict.dl!,
    cnn: dict.cnn!,
  };
  assert.equal(run.stdout, serialize(expected));
});

test('related links inside the subset are kept; a diamond keeps every ancestor once', t => {
  const run = json(['subset', 'cnn', 'ops', 'nlp'], subsetVault(t));
  assert.deepEqual(Object.keys(run.doc.dictionary as object).sort(), ['ai', 'cnn', 'dl', 'ml', 'nlp', 'ops', 'stats']);
  assert.deepEqual((run.doc.dictionary as RawDictionary).ml?.related, ['ops']);
});

test('subset output passes check', t => {
  const vault = subsetVault(t), other = copyOfFixture(t);
  writeFileSync(join(other, 'Tag-Dictionary.json'), cli(['subset', 'cnn'], vault).stdout);
  const check = json(['check'], other);
  assert.equal(check.code, 0);
  assert.deepEqual((check.doc.issues as { severity: string }[]).filter(issue => issue.severity === 'error'), []);
});

test('subset resolves case and aliases like show; unknown or missing tags exit 2 without writing', t => {
  const vault = subsetVault(t), before = readFileSync(join(vault, 'Tag-Dictionary.json'));
  assert.ok('nlp' in (json(['subset', 'natural language processing'], vault).doc.dictionary as object));
  assert.ok('cnn' in (json(['subset', 'CNN'], vault).doc.dictionary as object));
  assert.equal(cli(['subset', 'missing'], vault).code, 2);
  assert.equal(cli(['subset'], vault).code, 2);
  assert.deepEqual(readFileSync(join(vault, 'Tag-Dictionary.json')), before);
});

test('subset reports dictionary errors and exits 1 without a result', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({ ai: { description: 'AI', broader: ['missing'] } }));
  const run = json(['subset', 'ai'], vault);
  assert.equal(run.code, 1);
  assert.equal('dictionary' in run.doc, false);
  assert.deepEqual((run.doc.issues as { code: string }[]).map(issue => issue.code), ['unknown-reference']);
});

test('subset includes dictionary warnings in its JSON envelope', t => {
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({ ai: { description: 'AI' } }));
  const run = json(['subset', 'ai'], vault);
  assert.equal(run.code, 0);
  assert.deepEqual((run.doc.issues as { code: string }[]).map(issue => issue.code), ['unplaced']);
  assert.ok('ai' in (run.doc.dictionary as object));
});
