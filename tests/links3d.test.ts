import assert from 'node:assert/strict';
import test from 'node:test';
import { arrowAt } from '../src/links3d.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('an arrow points along the link and its tip touches the target node', () => {
  const arrow = arrowAt({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 2, 1.8)!;
  assert.deepEqual(arrow.direction, { x: 1, y: 0, z: 0 });
  // Tip at 10 - 2 = 8, so the cone's middle is half its length back from there.
  close(arrow.center.x, 8 - 0.9); close(arrow.center.y, 0); close(arrow.center.z, 0);
});

test('an arrow works in any direction', () => {
  const arrow = arrowAt({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -5 }, 1, 2)!;
  assert.deepEqual(arrow.direction, { x: 0, y: 0, z: -1 });
  close(arrow.center.z, -5 + 1 + 1);
});

test('no arrow while the two nodes overlap', () => {
  assert.equal(arrowAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1, 1.8), undefined);
  assert.equal(arrowAt({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 2, 1.8), undefined);
});
