import assert from 'node:assert/strict';
import test from 'node:test';
import { isKebabName, validate, type Issue } from '../src/core/validate.ts';

// What an issue points at, without the message, which is for people and may change.
const where = (issues: Issue[]) => issues.map(({ message, ...rest }) => {
  assert.ok(message.length > 0);
  return rest;
});

test('a consistent dictionary has no issues', () => {
  assert.deepEqual(validate({
    cs: { description: 'Computer science', aliases: ['computing'], broader: [] },
    ml: { description: 'Machine learning', broader: ['cs'], related: ['stats'] },
    stats: { description: 'Statistics', broader: [], facet: 'field' },
  }), []);
});

test('a value that is not a JSON object is one invalid-dictionary error', () => {
  for (const raw of [null, [], 'text', 42]) {
    assert.deepEqual(where(validate(raw)), [{ code: 'invalid-dictionary', severity: 'error' }]);
  }
});

test('an entry without a string description is invalid-entry', () => {
  for (const entry of [null, [], {}, { description: 42 }]) {
    assert.deepEqual(where(validate({ a: entry })), [{ code: 'invalid-entry', severity: 'error', tag: 'a' }]);
  }
});

test('a list field that is not an array of strings, or a facet that is not a string, is invalid-field', () => {
  for (const [field, value] of [['aliases', 'alias'], ['aliases', null], ['broader', [42]], ['related', null], ['facet', true]] as const) {
    assert.deepEqual(where(validate({ a: { description: 'A', broader: [], [field]: value } })),
      [{ code: 'invalid-field', severity: 'error', tag: 'a', field }]);
  }
});

test('broader and related must name tags in the dictionary, and not the tag itself', () => {
  for (const field of ['broader', 'related'] as const) {
    assert.deepEqual(where(validate({ a: { description: 'A', broader: [], [field]: ['missing'] } })),
      [{ code: 'unknown-reference', severity: 'error', tag: 'a', field, target: 'missing' }]);
  }
  // A self-reference is reported once, not again as a cycle.
  assert.deepEqual(where(validate({ a: { description: 'A', broader: ['a'] } })),
    [{ code: 'self-reference', severity: 'error', tag: 'a', field: 'broader' }]);
  assert.deepEqual(where(validate({ a: { description: 'A', broader: [], related: ['a'] } })),
    [{ code: 'self-reference', severity: 'error', tag: 'a', field: 'related' }]);
});

test('a broader cycle is reported on each tag on it, not on the tags below it', () => {
  assert.deepEqual(where(validate({
    a: { description: 'A', broader: ['c'] },
    b: { description: 'B', broader: ['a'] },
    c: { description: 'C', broader: ['b'] },
    below: { description: 'Below', broader: ['c'] },
  })), ['a', 'b', 'c'].map(tag => ({ code: 'broader-cycle', severity: 'error', tag })));
});

test('an entry that is invalid still counts as a tag others can reference', () => {
  assert.deepEqual(where(validate({ a: { description: 42 }, b: { description: 'B', broader: ['a'] } })),
    [{ code: 'invalid-entry', severity: 'error', tag: 'a' }]);
});

test('an empty or blank description is a warning', () => {
  for (const description of ['', '  ']) {
    assert.deepEqual(where(validate({ a: { description, broader: [] } })),
      [{ code: 'empty-description', severity: 'warning', tag: 'a', field: 'description' }]);
  }
});

test('a tag name Obsidian would not accept is invalid-name', () => {
  for (const tag of ['', 'two words', 'a.b', '1984']) {
    assert.deepEqual(where(validate({ [tag]: { description: 'X', broader: [] } })),
      [{ code: 'invalid-name', severity: 'warning', tag }]);
  }
  // Nested tags, underscores and letters outside ASCII are fine.
  assert.deepEqual(validate({ 'a/b_c': { description: 'X', broader: [] }, 태그: { description: 'X', broader: [] } }), []);
});

test('kebab-case names are checked only when asked for', () => {
  const raw = { Python: { description: 'X', broader: [] }, snake_case: { description: 'X', broader: [] }, 'kebab-case-2': { description: 'X', broader: [] } };
  assert.deepEqual(validate(raw), []);
  assert.deepEqual(where(validate(raw, { names: 'kebab' })), [
    { code: 'name-format', severity: 'warning', tag: 'Python' },
    { code: 'name-format', severity: 'warning', tag: 'snake_case' },
  ]);
});

test('names equal ignoring case collide; tag names are taken before aliases', () => {
  assert.deepEqual(where(validate({
    'machine-learning': { description: 'X', aliases: ['ML'], broader: [] },
    ml: { description: 'X', broader: [] },
    AI: { description: 'X', broader: [] },
    ai: { description: 'X', aliases: ['Ai', 'artificial intelligence', 'Artificial Intelligence'], broader: [] },
  })), [
    { code: 'name-collision', severity: 'warning', tag: 'ai', target: 'AI' },
    { code: 'name-collision', severity: 'warning', tag: 'ai', field: 'aliases', target: 'AI' },
    { code: 'name-collision', severity: 'warning', tag: 'ai', field: 'aliases', target: 'ai' },
    { code: 'name-collision', severity: 'warning', tag: 'machine-learning', field: 'aliases', target: 'ml' },
  ]);
});

test('a related tag that is also an ancestor or a descendant is related-in-hierarchy', () => {
  assert.deepEqual(where(validate({
    root: { description: 'X', broader: [], related: ['leaf'] },
    mid: { description: 'X', broader: ['root'] },
    leaf: { description: 'X', broader: ['mid'], related: ['root'] },
  })), [
    { code: 'related-in-hierarchy', severity: 'warning', tag: 'leaf', field: 'related', target: 'root' },
    { code: 'related-in-hierarchy', severity: 'warning', tag: 'root', field: 'related', target: 'leaf' },
  ]);
});

test('an entry without broader is unplaced; an empty broader makes a root', () => {
  assert.deepEqual(where(validate({ root: { description: 'X', broader: [] }, loose: { description: 'X' } })),
    [{ code: 'unplaced', severity: 'warning', tag: 'loose' }]);
});

test('a parent already reached through another parent is redundant-broader', () => {
  assert.deepEqual(where(validate({
    cs: { description: 'X', broader: [] },
    ml: { description: 'X', broader: ['cs'] },
    dl: { description: 'X', broader: ['ml', 'cs'] },
  })), [{ code: 'redundant-broader', severity: 'warning', tag: 'dl', field: 'broader', target: 'cs' }]);
});

test('errors come before warnings, then issues are sorted by tag, code and target', () => {
  const issues = validate({
    b: { description: '', broader: ['x', 'missing'] },
    a: { description: 'A' },
    c: { description: 'C', broader: [], related: ['gone'] },
  });
  assert.deepEqual(issues.map(issue => [issue.severity, issue.tag, issue.code, issue.target]), [
    ['error', 'b', 'unknown-reference', 'missing'],
    ['error', 'b', 'unknown-reference', 'x'],
    ['error', 'c', 'unknown-reference', 'gone'],
    ['warning', 'a', 'unplaced', undefined],
    ['warning', 'b', 'empty-description', undefined],
  ]);
});

test('inherited object keys are not taken for tags', () => {
  assert.deepEqual(where(validate({ a: { description: 'A', broader: ['constructor'], related: ['__proto__'] } })), [
    { code: 'unknown-reference', severity: 'error', tag: 'a', field: 'related', target: '__proto__' },
    { code: 'unknown-reference', severity: 'error', tag: 'a', field: 'broader', target: 'constructor' },
  ]);
});

test('hierarchy warnings still hold on and below a broader cycle', () => {
  assert.deepEqual(where(validate({
    a: { description: 'A', broader: ['b'], related: ['b'] },
    b: { description: 'B', broader: ['a'] },
    c: { description: 'C', broader: ['a', 'b'] },
  })), [
    { code: 'broader-cycle', severity: 'error', tag: 'a' },
    { code: 'broader-cycle', severity: 'error', tag: 'b' },
    { code: 'related-in-hierarchy', severity: 'warning', tag: 'a', field: 'related', target: 'b' },
    { code: 'redundant-broader', severity: 'warning', tag: 'c', field: 'broader', target: 'a' },
    { code: 'redundant-broader', severity: 'warning', tag: 'c', field: 'broader', target: 'b' },
  ]);
});

test('a 10,000-level chain validates in about linear time', () => {
  const chain = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`t${i}`, { description: 'X', broader: i ? [`t${i - 1}`] : [] }]));
  // The plugin validates on every refresh. Keeping every tag's ancestors took 2.4 s and 1.5 GB here; a walk per question takes milliseconds.
  const start = performance.now();
  assert.deepEqual(validate(chain), []);
  assert.ok(performance.now() - start < 1000, `took ${Math.round(performance.now() - start)} ms`);
});

test('isKebabName accepts only lowercase words and digits joined by single hyphens', () => {
  for (const name of ['ml', 'machine-learning', 'cve-2026-41266']) assert.ok(isKebabName(name), name);
  for (const name of ['', 'ML', 'Python', 'machine_learning', 'a--b', '-a', 'a-', 'a/b']) assert.ok(!isKebabName(name), name);
});
