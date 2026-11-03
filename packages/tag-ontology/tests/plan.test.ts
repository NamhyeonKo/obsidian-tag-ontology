import assert from 'node:assert/strict';
import test from 'node:test';
import type { Change, Draft } from '../src/core/dictionary.ts';
import { planChanges } from '../src/core/plan.ts';

const dict = {
  ai: { description: 'AI', broader: [] },
  ml: { description: 'ML', aliases: ['machine learning'], broader: ['ai'], facet: 'field' },
  dl: { description: 'DL', broader: ['ml'] },
};
const draft = (over: Partial<Draft>): Draft => ({ name: 'x', description: 'X', aliases: [], parents: [], children: [], related: [], ...over });

test('changes apply in order, each to the result of the one before, and the diff lists every entry that differs', () => {
  const changes: Change[] = [
    { kind: 'add', draft: draft({ name: 'llm', description: 'LLM', parents: ['dl'] }) },
    { kind: 'edit', tag: 'ml', draft: draft({ name: 'ml', description: 'Machine learning', aliases: ['machine learning'], parents: ['ai'], children: ['dl'] }) },
    { kind: 'delete', tag: 'llm' },
    { kind: 'add', draft: draft({ name: 'rl', description: 'RL', parents: ['ml'] }) },
  ];
  const result = planChanges(dict, changes);
  assert.ok(result.applied);
  assert.deepEqual(result.diff, [
    { tag: 'ml', status: 'changed', before: dict.ml, after: { description: 'Machine learning', aliases: ['machine learning'], broader: ['ai'], facet: 'field' } },
    { tag: 'rl', status: 'added', after: { description: 'RL', broader: ['ml'] } },
  ]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(Object.keys(result.dictionary).sort(), ['ai', 'dl', 'ml', 'rl']);
  // The input is left alone.
  assert.equal(dict.ml.description, 'ML');
});

test('a rename is a removed and an added entry, and the tags that point to it change', () => {
  const result = planChanges(dict, [{ kind: 'edit', tag: 'ml', draft: draft({ name: 'machine-learning', description: 'ML', aliases: ['machine learning'], parents: ['ai'], children: ['dl'] }) }]);
  assert.ok(result.applied);
  assert.deepEqual(result.diff.map(({ tag, status }) => [tag, status]), [['dl', 'changed'], ['machine-learning', 'added'], ['ml', 'removed']]);
});

test('the result is validated, so a change can fix a broken reference or break one', () => {
  const broken = { ...dict, dl: { description: 'DL', broader: ['gone'] } };
  const fixed = planChanges(broken, [{ kind: 'edit', tag: 'dl', draft: draft({ name: 'dl', description: 'DL', parents: ['ml'] }) }]);
  assert.ok(fixed.applied);
  assert.deepEqual(fixed.issues, []);
  const breaking = planChanges(dict, [{ kind: 'edit', tag: 'dl', draft: draft({ name: 'dl', description: '', parents: ['gone'] }) }]);
  assert.ok(breaking.applied);
  assert.deepEqual(breaking.issues.map(issue => issue.code), ['unknown-reference', 'empty-description']);
});

test('a change that cannot apply stops the plan with one invalid-change', () => {
  const cases: [Change, RegExp][] = [
    [{ kind: 'delete', tag: 'gone' }, /gone/],
    [{ kind: 'edit', tag: 'constructor', draft: draft({ name: 'constructor' }) }, /constructor/],
    [{ kind: 'add', draft: draft({ name: 'ML' }) }, /already/],
    [{ kind: 'add', draft: draft({ name: 'two words' }) }, /spaces/],
    [{ kind: 'edit', tag: 'ml', draft: draft({ name: 'AI', parents: ['ai'] }) }, /already/],
    [{ kind: 'add', draft: draft({ name: 'new', children: ['gone'] }) }, /gone/],
  ];
  for (const [change, message] of cases) {
    const result = planChanges(dict, [{ kind: 'delete', tag: 'dl' }, change]);
    assert.equal(result.applied, false);
    assert.deepEqual(result.issues.map(({ code, severity, change: index }) => ({ code, severity, index })), [{ code: 'invalid-change', severity: 'error', index: 1 }]);
    assert.match(result.issues[0]?.message ?? '', message);
  }
  // Renaming a tag to itself in other case is no collision with itself.
  assert.ok(planChanges(dict, [{ kind: 'edit', tag: 'dl', draft: draft({ name: 'DL', parents: ['ml'] }) }]).applied);
});

test('changes do not apply to a file that is not a dictionary of entries', () => {
  for (const raw of [null, [], { a: { description: 1 } }, { a: { description: 'A', broader: 'b' } }]) {
    const result = planChanges(raw, []);
    assert.equal(result.applied, false);
    assert.ok(result.issues.length > 0 && result.issues.every(issue => issue.severity === 'error'));
  }
});
