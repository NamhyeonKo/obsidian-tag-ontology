import assert from 'node:assert/strict';
import test from 'node:test';
import { groupNonCanonical, groupRedundant } from '../src/check.ts';
import type { NonCanonical, Redundant } from 'tag-ontology';

test('groupNonCanonical groups tags and canonical names with sorted unique paths', () => {
  const rows: NonCanonical[] = [
    { path: 'b.md', tag: 'ML', canonical: 'machine-learning' },
    { path: 'a.md', tag: 'ML', canonical: 'machine-learning' },
    { path: 'a.md', tag: 'ML', canonical: 'machine-learning' },
    { path: 'c.md', tag: 'Ai', canonical: 'ai' },
  ];
  const copy = structuredClone(rows);
  assert.deepEqual(groupNonCanonical(rows), [
    { tag: 'Ai', canonical: 'ai', notes: ['c.md'] },
    { tag: 'ML', canonical: 'machine-learning', notes: ['a.md', 'b.md'] },
  ]);
  assert.deepEqual(rows, copy);
});

test('groupNonCanonical keeps case-distinct tags separate', () => {
  assert.deepEqual(groupNonCanonical([
    { path: 'a.md', tag: 'ml', canonical: 'machine-learning' },
    { path: 'b.md', tag: 'ML', canonical: 'machine-learning' },
  ]), [
    { tag: 'ML', canonical: 'machine-learning', notes: ['b.md'] },
    { tag: 'ml', canonical: 'machine-learning', notes: ['a.md'] },
  ]);
});

test('groupRedundant groups tags with sorted unique paths', () => {
  const rows: Redundant[] = [
    { path: 'z.md', tag: 'deep-learning', narrower: ['dropout'] },
    { path: 'a.md', tag: 'deep-learning', narrower: ['cnn'] },
    { path: 'a.md', tag: 'ai', narrower: ['deep-learning'] },
  ];
  assert.deepEqual(groupRedundant(rows), [
    { tag: 'ai', notes: ['a.md'] },
    { tag: 'deep-learning', notes: ['a.md', 'z.md'] },
  ]);
});

test('grouping functions return empty arrays for empty input', () => {
  assert.deepEqual(groupNonCanonical([]), []);
  assert.deepEqual(groupRedundant([]), []);
});
