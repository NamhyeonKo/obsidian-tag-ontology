import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import * as settings from '../src/settings.ts';
import * as i18n from '../src/i18n/index.ts';

class El {
  children: El[] = [];
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  text = '';
  visible = true;
  events = new Map<string, Array<(e?: unknown) => void>>();

  constructor(cls = '', text = '') {
    for (const part of cls.split(/\s+/).filter(Boolean)) this.classes.add(part);
    this.text = text;
  }

  empty() { this.children = []; }
  addClass(cls: string) { for (const part of cls.split(/\s+/).filter(Boolean)) this.classes.add(part); }
  removeClass(cls: string) { this.classes.delete(cls); }
  hasClass(cls: string) { return this.classes.has(cls); }
  toggleClass(cls: string, force?: boolean) {
    const on = force ?? !this.classes.has(cls);
    if (on) this.classes.add(cls); else this.classes.delete(cls);
  }
  toggle(show: boolean) { this.visible = show; }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    const list = this.events.get(type) ?? [];
    list.push(fn);
    this.events.set(type, list);
  }
  createDiv(clsOrOpts?: string | { cls?: string; text?: string }) {
    const opts = typeof clsOrOpts === 'string' ? { cls: clsOrOpts } : clsOrOpts;
    return this.createEl('div', opts);
  }
  createEl(_tag: string, opts?: { cls?: string; text?: string }) {
    const child = new El(opts?.cls, opts?.text);
    this.children.push(child);
    return child;
  }
  all(): El[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

interface ControlRecord {
  section: string;
  name: string;
  kind: 'search' | 'toggle' | 'slider' | 'button';
  value: unknown;
  placeholder?: string;
  setValue(v: unknown): void;
  fire(v?: unknown): void;
}

async function setup(initial?: Partial<settings.Settings>) {
  const context = createContext({});
  const code = await transform(readFileSync(new URL('../src/controls3d.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  const records: ControlRecord[] = [];
  const pending = new Set<() => void>();
  let cancelled = 0;

  class Setting {
    nameEl = new El();
    settingEl = new El();
    private name = '';
    private section = '';

    constructor(containerEl: El) {
      this.section = containerEl.all().find(el => el.classes.has('graph-control-section-header'))?.text ?? '';
      containerEl.children.push(this.settingEl);
    }

    setName(name: string) { this.name = name; this.nameEl.text = name; return this; }

    addSearch(cb: (c: unknown) => void) {
      let current = '';
      let onChange: (v: string) => void = () => {};
      const rec: ControlRecord = {
        section: this.section, name: this.name || 'search', kind: 'search', value: current,
        setValue: v => { current = String(v); rec.value = current; },
        fire: v => { current = String(v); rec.value = current; onChange(current); },
      };
      records.push(rec);
      const comp = {
        setPlaceholder: (p: string) => { rec.placeholder = p; return comp; },
        setValue: (v: string) => { rec.setValue(v); return comp; },
        onChange: (fn: (v: string) => void) => { onChange = fn; return comp; },
      };
      cb(comp);
      return this;
    }

    addToggle(cb: (c: unknown) => void) {
      let current = false;
      let onChange: (v: boolean) => void = () => {};
      const rec: ControlRecord = {
        section: this.section, name: this.name, kind: 'toggle', value: current,
        setValue: v => { current = Boolean(v); rec.value = current; },
        fire: v => { current = Boolean(v); rec.value = current; onChange(current); },
      };
      records.push(rec);
      const comp = {
        setValue: (v: boolean) => { rec.setValue(v); return comp; },
        onChange: (fn: (v: boolean) => void) => { onChange = fn; return comp; },
      };
      cb(comp);
      return this;
    }

    addSlider(cb: (c: unknown) => void) {
      let current = 0;
      let onChange: (v: number) => void = () => {};
      const rec: ControlRecord = {
        section: this.section, name: this.name, kind: 'slider', value: current,
        setValue: v => { current = Number(v); rec.value = current; },
        fire: v => { current = Number(v); rec.value = current; onChange(current); },
      };
      records.push(rec);
      const comp = {
        setLimits: () => comp,
        setInstant: () => comp,
        setValue: (v: number) => { rec.setValue(v); return comp; },
        onChange: (fn: (v: number) => void) => { onChange = fn; return comp; },
      };
      cb(comp);
      return this;
    }

    addButton(cb: (c: unknown) => void) {
      let label = '';
      let onClick: () => void = () => {};
      const rec: ControlRecord = {
        section: this.section, name: label, kind: 'button', value: undefined,
        setValue: () => {},
        fire: () => { onClick(); },
      };
      records.push(rec);
      const comp = {
        setButtonText: (t: string) => { label = t; rec.name = t; return comp; },
        onClick: (fn: () => void) => { onClick = fn; return comp; },
      };
      cb(comp);
      return this;
    }
  }

  await module.link(specifier => {
    const exports = specifier === 'obsidian' ? {
      Setting,
      debounce: (fn: () => void) => Object.assign(() => { pending.add(fn); }, {
        cancel: () => { if (pending.delete(fn)) cancelled++; },
      }),
      setIcon: (el: El, id: string) => { el.attrs.icon = id; },
      setTooltip: (el: El, text: string) => { el.attrs['aria-label'] = text; },
    }
      : specifier === './settings.ts' ? { ...settings }
      : specifier === './i18n/index.ts' ? { ...i18n }
      : {};
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
    }, { context });
  });
  await module.evaluate();

  const { Controls3D } = module.namespace as {
    Controls3D: new (root: El, owner: object, callbacks: object) => { sync(): void; refreshLocale(): void; destroy(): void };
  };
  const owner = {
    settings: { ...structuredClone(settings.DEFAULT_SETTINGS), ...structuredClone(initial ?? {}) },
    saves: 0,
    saveState() { this.saves++; },
  };
  const calls: string[] = [];
  const root = new El();
  const controls = new Controls3D(root, owner, {
    onFilters: () => calls.push('filters'),
    onDisplay: (kind: string) => calls.push(`display:${kind}`),
    onForces: () => calls.push('forces'),
    onDragTension: () => calls.push('dragTension'),
    onResetAll: () => calls.push('resetAll'),
  });
  const panel = root.all().find(el => el.classes.has('tag-ontology-3d-controls'))!;
  const flush = () => { const fns = [...pending]; pending.clear(); for (const fn of fns) fn(); };
  return { root, panel, controls, owner, calls, records, flush, cancelled: () => cancelled };
}

test('renders 2D-style Controls3D panel with 3 collapsible sections and header buttons', async () => {
  const t = await setup();
  assert.equal(t.panel.hasClass('graph-controls'), true);
  assert.equal(t.panel.hasClass('is-close'), true);
  assert.ok(t.panel.all().find(el => el.classes.has('mod-open') && el.attrs.icon === 'settings'));
  assert.ok(t.panel.all().find(el => el.classes.has('mod-close') && el.attrs.icon === 'x'));
  assert.ok(t.panel.all().find(el => el.classes.has('mod-reset') && el.attrs.icon === 'rotate-ccw'));
  const headers = t.panel.all().filter(el => el.classes.has('graph-control-section-header')).map(el => el.text);
  assert.deepEqual(headers, ['Filters', 'Display', 'Forces']);
  assert.equal(t.records.find(r => r.kind === 'search')?.placeholder, 'Search files...');
});

test('search, toggles, and per-section Restore defaults reset only their own section', async () => {
  const t = await setup();
  const byName = (name: string) => t.records.find(r => r.name === name)!;

  // Mutate all 3 sections
  const search = t.records.find(r => r.kind === 'search')!;
  search.fire('path:notes -draft');
  assert.equal(t.owner.settings.filters3d.search, 'path:notes -draft');
  assert.deepEqual(t.calls, []);
  t.flush();
  assert.deepEqual(t.calls, ['filters']);
  assert.equal(t.owner.saves, 1);

  t.calls.length = 0;
  byName('Attachments').fire(true);
  byName('Existing files only').fire(false);
  byName('Orphans').fire(false);
  byName('Arrows').fire(true);
  byName('Node size').fire(2.4);
  byName('Link thickness').fire(3.2);
  byName('Perspective labels').fire(false);
  byName('Label size').fire(1.4);
  byName('Drag tension').fire(false);
  byName('Center force').fire(0.2);
  t.flush();

  const resets = t.records.filter(r => r.name === 'Restore defaults');
  assert.equal(resets.length, 3);

  // Filters reset leaves Display & Forces intact.
  t.calls.length = 0;
  resets[0]!.fire();
  const snap = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(snap(t.owner.settings.filters3d), settings.DEFAULT_SETTINGS.filters3d);
  assert.equal(search.value, '');
  assert.equal(byName('Attachments').value, false);
  assert.equal(t.owner.settings.display3d.nodeSize, 2.4);
  assert.equal(t.owner.settings.forces3d.center, 0.2);
  assert.deepEqual(t.calls, ['filters']);

  // Display reset leaves Filters & Forces intact.
  byName('Attachments').fire(true);
  t.calls.length = 0;
  resets[1]!.fire();
  assert.deepEqual(snap(t.owner.settings.display3d), settings.DEFAULT_SETTINGS.display3d);
  assert.equal(t.owner.settings.perspectiveLabels, settings.DEFAULT_SETTINGS.perspectiveLabels);
  assert.equal(t.owner.settings.labelSize, settings.DEFAULT_SETTINGS.labelSize);
  assert.equal(t.owner.settings.filters3d.attachments, true);
  assert.equal(t.owner.settings.forces3d.center, 0.2);
  assert.deepEqual(t.calls, ['display:reset']);

  // Forces reset leaves Filters & Display intact.
  byName('Node size').fire(1.9);
  t.calls.length = 0;
  resets[2]!.fire();
  assert.deepEqual(snap(t.owner.settings.forces3d), settings.DEFAULT_SETTINGS.forces3d);
  assert.equal(t.owner.settings.dragTension3d, settings.DEFAULT_SETTINGS.dragTension3d);
  assert.equal(t.owner.settings.display3d.nodeSize, 1.9);
  assert.equal(t.owner.settings.filters3d.attachments, true);
  assert.deepEqual(t.calls, ['dragTension', 'forces']);

  // Header mod-reset resets all 3 sections in one call.
  search.fire('pending-debounce');
  t.calls.length = 0;
  const savesBefore = t.owner.saves;
  t.panel.all().find(el => el.classes.has('mod-reset'))!.events.get('click')?.[0]?.();
  assert.deepEqual(snap(t.owner.settings.filters3d), settings.DEFAULT_SETTINGS.filters3d);
  assert.deepEqual(snap(t.owner.settings.display3d), settings.DEFAULT_SETTINGS.display3d);
  assert.deepEqual(snap(t.owner.settings.forces3d), settings.DEFAULT_SETTINGS.forces3d);
  assert.deepEqual(t.calls, ['resetAll']);
  assert.equal(t.owner.saves, savesBefore + 1);
  t.flush();
  assert.deepEqual(t.calls, ['resetAll'], 'header reset cancels pending debounced search');
});

test('sync updates controls on open, refreshLocale preserves panel/collapse state, and destroy cancels timers', async () => {
  const t = await setup();
  t.owner.settings.filters3d.search = 'tag:ai';
  t.owner.settings.display3d.linkThickness = 2.5;
  t.panel.all().find(el => el.classes.has('mod-open'))!.events.get('click')?.[0]?.();
  assert.equal(t.panel.hasClass('is-close'), false);
  assert.equal(t.records.find(r => r.kind === 'search')?.value, 'tag:ai');
  assert.equal(t.records.find(r => r.name === 'Link thickness')?.value, 2.5);

  const sections = () => t.panel.all().filter(el => el.classes.has('graph-control-section'));
  sections()[1]!.all().find(el => el.classes.has('mod-collapsible'))!.events.get('click')?.[0]?.();
  assert.equal(sections()[1]!.hasClass('is-collapsed'), true);

  try {
    i18n.setLocale('ko');
    t.controls.refreshLocale();
    assert.equal(t.panel.hasClass('is-close'), false);
    assert.equal(sections()[1]!.hasClass('is-collapsed'), true);
    const koHeaders = t.panel.all().filter(el => el.classes.has('graph-control-section-header')).map(el => el.text);
    assert.deepEqual(koHeaders, ['필터', '표시', '장력']);
  } finally {
    i18n.setLocale('en');
  }

  t.records.find(r => r.kind === 'search')!.fire('unsaved');
  t.controls.destroy();
  assert.ok(t.cancelled() >= 1);
});
