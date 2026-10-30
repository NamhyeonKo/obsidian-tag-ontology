export interface Point { x: number; y: number; z: number }

// Where a link's arrow goes: pointing from the source to the target, with its tip on the target node's surface, as the 2D
// graph draws it. None while the nodes overlap, as there is no line left to put it on.
export function arrowAt(from: Point, to: Point, radius: number, length: number): { center: Point; direction: Point } | undefined {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, distance = Math.hypot(dx, dy, dz);
  if (distance <= radius) return undefined;
  const direction = { x: dx / distance, y: dy / distance, z: dz / distance }, back = radius + length / 2;
  return { center: { x: to.x - direction.x * back, y: to.y - direction.y * back, z: to.z - direction.z * back }, direction };
}

// The depth fog's band for a camera this far from the orbit center, around a graph reaching this far from it. Everything in
// front of the center stays clear and the back of the graph blends at most halfway into the background, so zooming in
// never makes the nodes behind disappear.
export function fogRange(distance: number, radius: number): { near: number; far: number } {
  return { near: distance, far: distance + Math.max(1, radius * 2) };
}

// How much to scale a label that would be this many pixels tall on screen, so it stays readable from afar and stops growing
// when close.
export function labelScale(pixels: number, min: number, max: number): number {
  return pixels < min ? min / pixels : pixels > max ? max / pixels : 1;
}

// The on-screen label height range, in pixels, for a label size: about 2D's label size at 1, growing up to twice that when
// close with perspective, or one size at any distance without.
export function labelBounds(size: number, perspective: boolean): { min: number; max: number } {
  return { min: 12 * size, max: (perspective ? 24 : 12) * size };
}
