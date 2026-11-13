// The explorer's object cards (Palantir Vertex's "Object card"): a colored icon tile, a title, a type line, then rows of
// properties. Cytoscape can't draw HTML in a node, so each card is an SVG image, which stays sharp at any zoom.
export interface CardTheme { card: string; border: string; title: string; sub: string; row: string; divider: string; font: string }
export type CardIcon = 'tag' | 'note' | 'group';
export interface Card { icon: CardIcon; color: string; title: string; sub: string; rows: [label: string, value: string][]; width: number; stacked?: boolean }

const ICONS: Record<CardIcon, string> = {
  tag: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" stroke="white" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" stroke="white" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  group: '<path d="M4 7h12v12H4z M8 3h12v12" stroke="white" stroke-width="2" fill="none" stroke-linejoin="round"/>',
};
// A data URI image can't use the fonts the page loaded, so a theme's web font falls back to these.
const SYSTEM_FONTS = '-apple-system, "Segoe UI", sans-serif';
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function cardHeight(rows: number): number {
  return 52 + rows * 20 + (rows ? 8 : 0);
}

// The text if it fits, else its longest start that fits with an ellipsis. Measured, so wide scripts such as Korean get cut sooner.
export function fit(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  let n = chars.length - 1;
  while (n > 0 && measure(chars.slice(0, n).join('') + '…') > maxWidth) n--;
  return chars.slice(0, n).join('') + '…';
}

export function cardImage(card: Card, theme: CardTheme, measure: (text: string, px: number, bold: boolean) => number) {
  const { width } = card, height = cardHeight(card.rows.length), back = card.stacked ? 8 : 0;
  const w = width - back, h = height - back;
  const box = (dx: number, dy: number, opacity?: number) =>
    `<rect x="${1 + dx}" y="${1 + dy}" width="${w - 2}" height="${h - 2}" rx="5" fill="${theme.card}" stroke="${theme.border}"${opacity === undefined ? '' : ` opacity="${opacity}"`}/>`;
  const text = (x: number, y: number, px: number, bold: boolean, fill: string, value: string, max: number, end = false) =>
    `<text x="${x}" y="${y}" font-size="${px}"${bold ? ' font-weight="600"' : ''} fill="${fill}"${end ? ' text-anchor="end"' : ''}>${esc(fit(value, max, t => measure(t, px, bold)))}</text>`;
  const parts = [
    card.stacked ? box(8, 8, 0.5) + box(4, 4, 0.8) : '', box(0, 0),
    `<rect x="10" y="10" width="32" height="32" rx="5" fill="${card.color}"/>`,
    `<g transform="translate(14 14)">${ICONS[card.icon]}</g>`,
    text(52, 24, 13, true, theme.title, card.title, w - 64),
    text(52, 39, 11, false, theme.sub, card.sub, w - 64),
    card.rows.length ? `<line x1="1" x2="${w - 1}" y1="52" y2="52" stroke="${theme.divider}"/>` : '',
    ...card.rows.map(([label, value], i) => text(10, 70 + i * 20, 11, true, theme.row, label, w / 2 - 12)
      + text(w - 12, 70 + i * 20, 11, false, theme.row, value, w / 2 - 12, true)),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${esc(`${theme.font}, ${SYSTEM_FONTS}`)}">${parts.join('')}</svg>`;
  return { uri: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), width, height };
}
