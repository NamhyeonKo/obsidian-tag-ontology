import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import * as palettes from '../src/palettes.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings.ts';

class DomEl {
  children: DomEl[] = [];
  parentElement?: DomEl;
  classes: Set<string>;
  classList: { toggle(cls: string, force?: boolean): boolean; contains(cls: string): boolean };
  hidden = false;
  offsetWidth = 0;
  offsetHeight = 0;
  clientHeight = 0;
  scrollHeight = 0;
  private measure?: (el: DomEl) => void;

  constructor(cls = '', measure?: (el: DomEl) => void) {
    this.classes = new Set(cls.split(/\s+/).filter(Boolean));
    this.measure = measure;
    this.classList = {
      toggle: (name, force) => {
        const on = force ?? !this.classes.has(name);
        if (on) this.classes.add(name); else this.classes.delete(name);
        return on;
      },
      contains: name => this.classes.has(name),
    };
  }

  empty() { this.children = []; }
  setAttribute() {}
  setCssProps() {}
  addEventListener() {}
  createSpan() { return this.createEl('span'); }
  createEl(_tag: string, options?: { cls?: string }) {
    const child = new DomEl(options?.cls, this.measure);
    child.parentElement = this;
    this.children.push(child);
    this.measure?.(child);
    return child;
  }
  all(): DomEl[] { return [this, ...this.children.flatMap(child => child.all())]; }
  closest(selector: string): DomEl | null {
    const name = selector.replace(/^\./, '');
    for (let cur: DomEl | undefined = this; cur; cur = cur.parentElement) if (cur.classes.has(name)) return cur;
    return null;
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): DomEl[] {
    const names = selector.split(',').map(part => part.trim().replace(/^\./, ''));
    return this.all().slice(1).filter(el => names.some(name => el.classes.has(name)));
  }
}

async function setup() {
  const observed: DomEl[] = [];
  let triggerResize: (entries: { target: DomEl }[]) => void = () => {};
  class MockResizeObserver {
    constructor(cb: (entries: { target: DomEl }[]) => void) { triggerResize = cb; }
    observe(target: DomEl) { observed.push(target); }
  }
  const styles = new WeakMap<DomEl, Record<string, string>>();
  const context = createContext({
    getComputedStyle: (el: DomEl) => styles.get(el) ?? { rowGap: '0' },
    ResizeObserver: MockResizeObserver,
  });
  const code = await transform(readFileSync(new URL('../src/legend.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(async specifier => {
    const exports: Record<string, unknown> = specifier === 'obsidian'
      ? { Menu: class {}, setIcon() {}, setTooltip() {} }
      : specifier === './palettes.ts'
        ? { ...palettes }
        : {};
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const renderDepthLegend = (module.namespace as { renderDepthLegend: (el: DomEl, settings: Settings, actions: object) => void }).renderDepthLegend;

  const measureLegend = (el: DomEl) => {
    if (el.classes.has('tag-ontology-legend-levels')) el.clientHeight = 147;
  };
  const overlay = new DomEl('tag-ontology-overlay');
  styles.set(overlay, { rowGap: '12px' });
  const tools = overlay.createEl('div', { cls: 'tag-ontology-tools' });
  styles.set(tools, { rowGap: '8px' });
  const layouts = tools.createEl('div', { cls: 'tag-ontology-layouts' });
  const buttons: DomEl[] = [];
  for (let i = 0; i < 3; i++) {
    const b = tools.createEl('button', { cls: 'tag-ontology-icon' }); b.offsetHeight = b.offsetWidth = 34; buttons.push(b);
  }
  for (let i = 0; i < 2; i++) {
    const sep = tools.createEl('div', { cls: 'tag-ontology-separator' }); sep.offsetWidth = 20; sep.offsetHeight = 1;
  }
  for (let i = 0; i < 6; i++) {
    const b = layouts.createEl('button', { cls: 'tag-ontology-icon' }); b.offsetHeight = b.offsetWidth = 34; buttons.push(b);
  }
  const legend = new DomEl('tag-ontology-legend', measureLegend);
  legend.parentElement = overlay;
  legend.offsetHeight = 193; legend.clientHeight = 191;
  overlay.children.push(legend);
  const actions = overlay.createEl('div', { cls: 'tag-ontology-actions' }); actions.offsetHeight = 46;
  const status = overlay.createEl('div', { cls: 'tag-ontology-status' }); status.offsetHeight = 16;

  const syncLegendBoxes = (saveButton: boolean, listRows: number) => {
    const list = legend.querySelector('.tag-ontology-legend-levels');
    if (list) list.scrollHeight = listRows * 18.375;
    const chrome = saveButton ? 80 : 46;
    legend.scrollHeight = (legend.hidden ? 0 : chrome - 2) + (list?.clientHeight ?? 0);
  };

  return { overlay, buttons, legend, observed, triggerResize: () => triggerResize([{ target: overlay }]), renderDepthLegend, syncLegendBoxes };
}

test('renderDepthLegend switches overlay compact mode from measured tools, legend, and status bounds rather than a hardcoded height', async () => {
  const t = await setup();
  const base: Settings = { ...DEFAULT_SETTINGS, customColors: true, hierarchyColors: true };
  // 8 levels -> chrome 46 + listWant 147 = 193; needed = 388 + 193 + 16 + 24 = 621.
  t.overlay.clientHeight = 640;
  t.renderDepthLegend(t.legend, base, { color() {}, choose() {}, save() {} });
  t.syncLegendBoxes(false, 8);
  t.renderDepthLegend(t.legend, base, { color() {}, choose() {}, save() {} });
  assert.equal(t.overlay.classList.contains('is-compact'), false, 'tall pane keeps vertical toolbar');

  t.overlay.clientHeight = 520;
  t.triggerResize();
  assert.equal(t.overlay.classList.contains('is-compact'), true, 'medium pane flips toolbar compact before crushing the 8-level legend');

  // With the legend off, bottom need drops to actions (46): needed = 388 + 46 + 16 + 24 = 474 <= 520.
  t.renderDepthLegend(t.legend, { ...base, hierarchyColors: false }, { color() {}, choose() {}, save() {} });
  assert.equal(t.overlay.classList.contains('is-compact'), false, 'same pane height keeps vertical toolbar when legend is hidden');

  t.overlay.clientHeight = 460;
  t.triggerResize();
  assert.equal(t.overlay.classList.contains('is-compact'), true, 'hiding legend still compacts below 474px');

  // Turning off 3 layout buttons lowers toolsNeed from 388 to 262: 262 + 46 + 16 + 24 = 348 <= 460.
  for (const button of t.buttons.slice(0, 3)) button.hidden = true;
  t.triggerResize();
  assert.equal(t.overlay.classList.contains('is-compact'), false, 'fewer enabled modes shrink vertical toolbar threshold dynamically');
  for (const button of t.buttons.slice(0, 3)) button.hidden = false;

  // Small 3-level palette shrinks legendNeed (~101px), keeping vertical toolbar in a 540px pane where 8 levels compact.
  const shortPalette = ['#112233', '#445566', '#778899'];
  t.overlay.clientHeight = 540;
  t.renderDepthLegend(t.legend, { ...base, hierarchyPalette: shortPalette }, { color() {}, choose() {}, save() {} });
  t.syncLegendBoxes(false, 3);
  t.triggerResize();
  assert.equal(t.overlay.classList.contains('is-compact'), false, 'shorter palettes need less vertical room before compacting');

  // Huge 16-level palette caps legend target height at 8 rows so tall panes scroll instead of forcing top toolbar.
  const longPalette = Array.from({ length: 16 }, () => '#112233');
  t.overlay.clientHeight = 640;
  t.renderDepthLegend(t.legend, { ...base, hierarchyPalette: longPalette }, { color() {}, choose() {}, save() {} });
  t.syncLegendBoxes(false, 16);
  t.triggerResize();
  assert.equal(t.overlay.classList.contains('is-compact'), false);

  // Even when a clipped container leaves list.clientHeight at 0, chrome + save button (80px) keeps threshold accurate.
  t.renderDepthLegend(t.legend, { ...base, hierarchyPalettePreset: 'custom', customHierarchyPalette: base.hierarchyPalette }, { color() {}, choose() {}, save() {} });
  const list = t.legend.querySelector('.tag-ontology-legend-levels')!;
  list.clientHeight = 0; t.legend.offsetHeight = 46; t.legend.clientHeight = 44;
  t.syncLegendBoxes(true, 8);
  t.overlay.clientHeight = 640; // needed = 388 + (80 + 147) + 16 + 24 = 655 > 640
  t.triggerResize();
  assert.equal(t.overlay.classList.contains('is-compact'), true);
  assert.equal(t.observed.length, 4, 'observer registers overlay, tools, layouts, and status once without duplicates');
});
