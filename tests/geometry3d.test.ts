import assert from 'node:assert/strict';
import test from 'node:test';
import { arrowAt, fogRange, labelBounds, labelScale } from '../src/geometry3d.ts';

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

test('fog leaves everything in front of the orbit center clear and fades the back of the graph at most halfway', () => {
  const { near, far } = fogRange(100, 50);
  assert.equal(near, 100);
  // The farthest a node can be is the camera's distance to the center plus the graph's radius.
  assert.equal((100 + 50 - near) / (far - near), 0.5);
});

test('close up, the nodes behind still show', () => {
  const { near, far } = fogRange(5, 400);
  assert.ok((5 + 400 - near) / (far - near) <= 0.5);
});

test('a graph with no size still gets a fog band', () => {
  const { near, far } = fogRange(10, 0);
  assert.ok(far > near);
});

test('a label smaller than the minimum on screen grows to it, and one past the maximum shrinks to it', () => {
  assert.equal(labelScale(3, 12, 24), 4);
  assert.equal(labelScale(48, 12, 24), 0.5);
  assert.equal(labelScale(16, 12, 24), 1);
});

test('label bounds grow with the label size, and without perspective a label has one size', () => {
  assert.deepEqual(labelBounds(1, true), { min: 12, max: 24 });
  assert.deepEqual(labelBounds(1.5, true), { min: 18, max: 36 });
  assert.deepEqual(labelBounds(2, false), { min: 24, max: 24 });
});
