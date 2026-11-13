import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardHeight, cardImage, fit, type Card, type CardTheme } from '../src/explorer-card.ts';

const theme: CardTheme = { card: '#2a2a2a', border: '#444444', title: '#e6e6e6', sub: '#9a9a9a', row: '#bdbdbd', divider: '#3a3a3a', font: '"Inter"' };
const measure = (text: string) => text.length * 7;
const card = (over: Partial<Card> = {}): Card => ({ icon: 'tag', color: '#14b8a6', title: '#ml', sub: 'concept · Tag', rows: [['Direct notes', '3']], width: 230, ...over });
const svgOf = (uri: string) => {
  const prefix = 'data:image/svg+xml;utf8,';
  assert.ok(uri.startsWith(prefix));
  return decodeURIComponent(uri.slice(prefix.length));
};

test('cardHeight leaves room for the header and each row', () => {
  assert.equal(cardHeight(0), 52);
  assert.equal(cardHeight(1), 80);
  assert.equal(cardHeight(3), 120);
});

test('cardImage is as wide as the card and as tall as its rows', () => {
  const image = cardImage(card({ rows: [['a', '1'], ['b', '2'], ['c', '3']] }), theme, measure);
  assert.equal(image.width, 230); assert.equal(image.height, 120);
  assert.match(svgOf(image.uri), /^<svg [^>]*width="230" height="120"/);
});

test('escapes XML in titles, subtitles and rows', () => {
  const svg = svgOf(cardImage(card({ title: 'a<b&"c', sub: 'x>y', rows: [['k<', 'v&']] }), theme, measure).uri);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  for (const text of ['a&lt;b&amp;&quot;c', 'x&gt;y', 'k&lt;', 'v&amp;']) assert.ok(svg.includes(text), text);
  assert.ok(!svg.includes('a<b'));
});

test('truncates by measured width', () => {
  const wide = (text: string) => [...text].reduce((sum, c) => sum + (c.charCodeAt(0) >= 0xac00 ? 20 : 10), 0);
  assert.equal(fit('abc', 55, wide), 'abc');
  assert.equal(fit('abcdefghij', 55, wide), 'abcd…');
  assert.equal(fit('가나다라마', 55, wide), '가나…');
});

test('a stacked card draws two offset copies behind it', () => {
  const backs = (stacked: boolean) => (svgOf(cardImage(card({ stacked }), theme, measure).uri).match(/<rect [^>]*opacity=/g) ?? []).length;
  assert.equal(backs(false), 0);
  assert.equal(backs(true), 2);
});

test('uses the theme font with the system fallback', () => {
  const svg = svgOf(cardImage(card(), theme, measure).uri);
  assert.match(svg, /font-family="&quot;Inter&quot;, -apple-system/);
});
