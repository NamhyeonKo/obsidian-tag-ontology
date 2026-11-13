import type { Ontology } from 'tag-ontology';

// Where the explorer puts new cards, what the Search Around menu offers and which lines join the cards, without the DOM.
export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export interface Box { x1: number; y1: number; x2: number; y2: number }

// More notes than this become one group card. Taking out the latest takes this many.
export const GROUP_THRESHOLD = 15, TAKE_OUT = 10;
// Cards expanded from one card stand in columns this far apart, at most this many to a column, this far apart in it.
export const COLUMN_STEP = 320, COLUMN_MAX = 12, STACK_GAP = 20;
// Room kept clear around a card.
const MARGIN = { x: 24, y: 16 };
const PALETTE = ['#4ea1ff', '#f0a33c', '#e5484d', '#30a46c', '#a67cf0', '#14b8a6', '#e879a6', '#a3a33a'];

const boxAt = (p: Point, s: Size): Box => ({ x1: p.x - s.w / 2, y1: p.y - s.h / 2, x2: p.x + s.w / 2, y2: p.y + s.h / 2 });

// The wanted spot, or the nearest one clear of every taken box, stepping down and up in turn by a card and a gap.
// ponytail: O(n²) overlap scan; a grid index if canvases reach thousands of cards.
export function freeSpot(want: Point, size: Size, taken: Box[]): Point {
  const hit = (x: number, y: number) => taken.some(b => x - size.w / 2 - MARGIN.x < b.x2 && x + size.w / 2 + MARGIN.x > b.x1
    && y - size.h / 2 - MARGIN.y < b.y2 && y + size.h / 2 + MARGIN.y > b.y1);
  for (let k = 0; k < 200; k++) {
    const y = want.y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (size.h + STACK_GAP);
    if (!hit(want.x, y)) return { x: want.x, y };
  }
  return want;
}

// New cards in columns beside the anchor (right with side 1, left with -1), each column centered on it. Cards already on the
// canvas never move; a new card that would land on one, or on another new card, steps aside.
export function placeColumn(anchor: Point, side: 1 | -1, sizes: Size[], taken: Box[]): Point[] {
  const boxes = [...taken], placed: Point[] = [];
  for (let start = 0, column = 1; start < sizes.length; start += COLUMN_MAX, column++) {
    const chunk = sizes.slice(start, start + COLUMN_MAX);
    const height = chunk.reduce((sum, s) => sum + s.h, 0) + (chunk.length - 1) * STACK_GAP;
    let top = anchor.y - height / 2;
    for (const size of chunk) {
      const spot = freeSpot({ x: anchor.x + side * COLUMN_STEP * column, y: top + size.h / 2 }, size, boxes);
      placed.push(spot); boxes.push(boxAt(spot, size));
      top += size.h + STACK_GAP;
    }
  }
  return placed;
}

// A card added on its own (from the start screen, the sidebar or a search): the origin on an empty canvas, else right of
// everything and level with the bottom of the canvas.
export function placeAside(taken: Box[], size: Size): Point {
  if (!taken.length) return { x: 0, y: 0 };
  const right = Math.max(...taken.map(b => b.x2)), bottom = Math.max(...taken.map(b => b.y2));
  return freeSpot({ x: right + COLUMN_STEP / 2, y: bottom - size.h / 2 }, size, taken);
}

export interface OnCanvas { tags: ReadonlySet<string>; notes: ReadonlySet<string>; groups: ReadonlySet<string> }

// What the Search Around menu can still bring out of a tag: everything not on the canvas yet. Notes are the tag's own (not its
// descendants'), and none once the tag has a group card, which holds them.
export function searchAround(model: Ontology, tag: string, on: OnCanvas) {
  const off = (tags: readonly string[]) => tags.filter(other => !on.tags.has(other));
  return {
    children: off(model.children.get(tag) ?? []),
    parents: off(model.entries.get(tag)?.broader ?? []),
    related: off(model.related(tag)),
    notes: on.groups.has(tag) ? [] : model.notesFor(tag, false).filter(path => !on.notes.has(path)),
  };
}

export type EdgeKind = 'broader' | 'related' | 'note';
export interface EdgeDef { id: string; kind: EdgeKind; source: string; target: string }

// Every line the cards on the canvas call for, whoever brought them out: hierarchy and related lines between tags, a line from
// each tag to the notes carrying it, and from a group's tag to the group.
export function canvasEdges(model: Ontology, on: OnCanvas): EdgeDef[] {
  const edges: EdgeDef[] = [];
  for (const tag of on.tags) {
    for (const parent of model.entries.get(tag)?.broader ?? []) {
      if (on.tags.has(parent)) edges.push({ id: `h:${parent}->${tag}`, kind: 'broader', source: `tag:${parent}`, target: `tag:${tag}` });
    }
    for (const other of model.related(tag)) {
      if (tag < other && on.tags.has(other)) edges.push({ id: `r:${tag}--${other}`, kind: 'related', source: `tag:${tag}`, target: `tag:${other}` });
    }
    for (const path of model.direct.get(tag) ?? []) {
      if (on.notes.has(path)) edges.push({ id: `n:${tag}->${path}`, kind: 'note', source: `tag:${tag}`, target: `note:${path}` });
    }
    if (on.groups.has(tag)) edges.push({ id: `g:${tag}`, kind: 'note', source: `tag:${tag}`, target: `group:${tag}` });
  }
  return edges;
}

export function tagsOfNote(model: Ontology, path: string): string[] {
  return [...model.direct].filter(([, paths]) => paths.includes(path)).map(([tag]) => tag).sort();
}

// Facets are free text, so each takes the palette color of its place in name order.
export function facetColors(facets: Iterable<string>): Map<string, string> {
  return new Map([...new Set(facets)].sort().map((facet, i) => [facet, PALETTE[i % PALETTE.length]]));
}

export function relativeTime(mtime: number, now: number): string {
  const days = Math.floor((now - mtime) / 864e5);
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (days < 1) return 'today';
  if (days < 30) return ago(days, 'day');
  if (days < 365) return ago(Math.floor(days / 30), 'month');
  return ago(Math.floor(days / 365), 'year');
}

// What a dictionary or note change leaves without a place on the canvas: tags gone from the dictionary, notes whose file is
// gone, and groups whose tag is gone or that hold nothing any more. Each surviving group keeps the notes that still exist and
// still carry its tag. A note that only lost a tag stays; canvasEdges drops its line.
export function pruneCanvas(model: Ontology, exists: (path: string) => boolean, on: OnCanvas, groups: ReadonlyMap<string, string[]>) {
  const groupPaths = new Map<string, string[]>(), gone: string[] = [];
  for (const tag of on.groups) {
    const tagged = new Set(model.notesFor(tag, false));
    const kept = model.entries.has(tag) ? (groups.get(tag) ?? []).filter(path => exists(path) && tagged.has(path)) : [];
    if (kept.length) groupPaths.set(tag, kept); else gone.push(tag);
  }
  return { tags: [...on.tags].filter(tag => !model.entries.has(tag)), notes: [...on.notes].filter(path => !exists(path)), groups: gone, groupPaths };
}
