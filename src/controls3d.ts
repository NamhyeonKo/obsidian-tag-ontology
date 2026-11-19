import { Setting, debounce, setIcon, setTooltip, type Debouncer, type SliderComponent, type ToggleComponent } from 'obsidian';
import { DEFAULT_SETTINGS, FORCES, LABEL_SIZE, LINK_THICKNESS, NODE_SIZE, TEXT_FADE, type Forces, type Settings } from './settings.ts';
import { t } from './i18n/index.ts';
import type { StringMessageKey } from './i18n/locales/en.ts';

export type DisplayChangeKind = 'arrows' | 'fade' | 'nodeSize' | 'linkThickness' | 'labels' | 'reset';
export type Sync3dChange = 'filters' | 'forces' | 'dragTension' | DisplayChangeKind;
type SectionKey = 'filters' | 'display' | 'forces';
type FilterToggleKey = 'attachments' | 'existingOnly' | 'orphans';

export interface ControlsOwner {
  settings: Settings;
  saveState(): Promise<void> | void;
}

export interface Controls3DCallbacks {
  onFilters(): void;
  onDisplay(kind: DisplayChangeKind): void;
  onForces(): void;
  onDragTension(): void;
  onResetAll(): void;
}

const FORCE_LABELS: Record<keyof Forces, StringMessageKey> = {
  center: 'controls3d.centerForce',
  repel: 'controls3d.repelForce',
  link: 'controls3d.linkForce',
  distance: 'controls3d.linkDistance',
};

const FILTER_TOGGLES: readonly [FilterToggleKey, StringMessageKey, StringMessageKey][] = [
  ['attachments', 'controls3d.attachments', 'controls3d.attachmentsTooltip'],
  ['existingOnly', 'controls3d.existingOnly', 'controls3d.existingOnlyTooltip'],
  ['orphans', 'controls3d.orphans', 'controls3d.orphansTooltip'],
];

/** 2D-style collapsible gear settings panel for 3D graph views. */
export class Controls3D {
  private readonly panel: HTMLElement;
  private readonly owner: ControlsOwner;
  private readonly callbacks: Controls3DCallbacks;
  private readonly collapsed = new Set<SectionKey>();
  private readonly debouncedFilter: Debouncer<[], void>;
  private readonly debouncedSave: Debouncer<[], void>;
  private syncs: Array<() => void> = [];

  constructor(root: HTMLElement, owner: ControlsOwner, callbacks: Controls3DCallbacks) {
    this.owner = owner;
    this.callbacks = callbacks;
    this.panel = root.createDiv('graph-controls is-close tag-ontology-3d-controls');
    this.debouncedFilter = debounce(() => this.callbacks.onFilters(), 150, true);
    this.debouncedSave = debounce(() => { void this.owner.saveState(); }, 500, true);
    this.render();
  }

  /** Sync every control value from the latest owner settings (for tabs sharing state). */
  sync() {
    for (const update of this.syncs) update();
  }

  /** Re-render labels and tooltips in the current locale while keeping open and collapsed state. */
  refreshLocale() {
    this.render();
  }

  /** Flush pending state saves and cancel pending debounced filter redraws on teardown. */
  destroy() {
    this.debouncedFilter.cancel();
    this.debouncedSave.run();
  }

  private saveNow() {
    this.debouncedSave.cancel();
    void this.owner.saveState();
  }

  private resetFilters(notify: boolean) {
    this.debouncedFilter.cancel();
    this.owner.settings.filters3d = { ...DEFAULT_SETTINGS.filters3d };
    this.sync();
    if (!notify) return;
    this.callbacks.onFilters();
    this.saveNow();
  }

  private resetDisplay(notify: boolean) {
    this.owner.settings.display3d = { ...DEFAULT_SETTINGS.display3d };
    this.owner.settings.perspectiveLabels = DEFAULT_SETTINGS.perspectiveLabels;
    this.owner.settings.labelSize = DEFAULT_SETTINGS.labelSize;
    this.sync();
    if (!notify) return;
    this.callbacks.onDisplay('reset');
    this.saveNow();
  }

  private resetForces(notify: boolean) {
    this.owner.settings.forces3d = { ...DEFAULT_SETTINGS.forces3d };
    this.owner.settings.dragTension3d = DEFAULT_SETTINGS.dragTension3d;
    this.sync();
    if (!notify) return;
    this.callbacks.onDragTension();
    this.callbacks.onForces();
    this.saveNow();
  }

  private resetAll() {
    this.resetFilters(false);
    this.resetDisplay(false);
    this.resetForces(false);
    this.callbacks.onResetAll();
    this.saveNow();
  }

  private render() {
    const panel = this.panel;
    panel.empty();
    this.syncs = [];

    const reset = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-reset' });
    const close = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-close' });
    const open = panel.createEl('button', { cls: 'clickable-icon graph-controls-button mod-open' });
    setIcon(reset, 'rotate-ccw');
    setTooltip(reset, t('controls3d.restoreAll'));
    setIcon(close, 'x');
    setTooltip(close, t('controls3d.close'));
    setIcon(open, 'settings');
    setTooltip(open, t('controls3d.openSettings'));

    const section = (key: SectionKey, title: string) => {
      const el = panel.createDiv('tree-item graph-control-section');
      const heading = el.createDiv('tree-item-self mod-collapsible');
      const icon = heading.createDiv('tree-item-icon collapse-icon');
      setIcon(icon, 'right-triangle');
      heading.createDiv('tree-item-inner').createEl('header', { cls: 'graph-control-section-header', text: title });
      const body = el.createDiv('tree-item-children');
      const applyCollapsed = (isCollapsed: boolean) => {
        el.toggleClass('is-collapsed', isCollapsed);
        icon.toggleClass('is-collapsed', isCollapsed);
        body.toggle(!isCollapsed);
      };
      applyCollapsed(this.collapsed.has(key));
      heading.addEventListener('click', () => {
        const isCollapsed = !el.hasClass('is-collapsed');
        if (isCollapsed) this.collapsed.add(key); else this.collapsed.delete(key);
        applyCollapsed(isCollapsed);
      });
      return body;
    };

    const addToggle = (
      parent: HTMLElement,
      nameKey: StringMessageKey,
      tooltipKey: StringMessageKey,
      get: () => boolean,
      set: (value: boolean) => void,
    ) => {
      let component: ToggleComponent | undefined;
      const row = new Setting(parent).setName(t(nameKey)).addToggle(c => {
        component = c.setValue(get()).onChange(value => {
          if (value !== get()) set(value);
        });
      });
      row.settingEl.addClass('mod-toggle');
      setTooltip(row.nameEl, t(tooltipKey));
      this.syncs.push(() => { component?.setValue(get()); });
    };

    const addSlider = (
      parent: HTMLElement,
      nameKey: StringMessageKey,
      range: { min: number; max: number; step: number },
      get: () => number,
      set: (value: number) => void,
    ) => {
      let component: SliderComponent | undefined;
      const row = new Setting(parent).setName(t(nameKey)).addSlider(c => {
        component = c.setLimits(range.min, range.max, range.step).setInstant(true).setValue(get()).onChange(value => {
          if (value !== get()) set(value);
        });
      });
      row.settingEl.addClass('mod-slider');
      this.syncs.push(() => { component?.setValue(get()); });
    };

    const addReset = (parent: HTMLElement, action: () => void) => {
      const row = new Setting(parent).addButton(btn => btn.setButtonText(t('common.restoreDefaults')).onClick(action));
      row.settingEl.addClass('tag-ontology-3d-reset');
    };

    // Filters section
    const filters = section('filters', t('controls3d.filtersSection'));
    const searchRow = new Setting(filters).addSearch(c => {
      c.setPlaceholder(t('controls3d.searchPlaceholder')).setValue(this.owner.settings.filters3d.search).onChange(value => {
        const next = value.slice(0, 500);
        if (next === this.owner.settings.filters3d.search) return;
        this.owner.settings.filters3d = { ...this.owner.settings.filters3d, search: next };
        this.debouncedFilter();
        this.debouncedSave();
      });
      this.syncs.push(() => { c.setValue(this.owner.settings.filters3d.search); });
    });
    searchRow.settingEl.addClass('mod-search-setting');

    for (const [key, labelKey, tooltipKey] of FILTER_TOGGLES) {
      addToggle(
        filters,
        labelKey,
        tooltipKey,
        () => this.owner.settings.filters3d[key],
        value => {
          this.debouncedFilter.cancel();
          this.owner.settings.filters3d = { ...this.owner.settings.filters3d, [key]: value };
          this.callbacks.onFilters();
          this.saveNow();
        },
      );
    }
    addReset(filters, () => this.resetFilters(true));

    // Display section
    const display = section('display', t('controls3d.displaySection'));
    addToggle(
      display,
      'controls3d.arrows',
      'controls3d.arrowsTooltip',
      () => this.owner.settings.display3d.arrows,
      value => {
        this.owner.settings.display3d = { ...this.owner.settings.display3d, arrows: value };
        this.callbacks.onDisplay('arrows');
        this.saveNow();
      },
    );
    const setDisplayNum = (key: 'textFadeThreshold' | 'nodeSize' | 'linkThickness', kind: DisplayChangeKind, value: number) => {
      this.owner.settings.display3d = { ...this.owner.settings.display3d, [key]: value };
      this.callbacks.onDisplay(kind);
      this.debouncedSave();
    };
    addSlider(display, 'controls3d.textFadeThreshold', TEXT_FADE, () => this.owner.settings.display3d.textFadeThreshold, v => setDisplayNum('textFadeThreshold', 'fade', v));
    addSlider(display, 'controls3d.nodeSize', NODE_SIZE, () => this.owner.settings.display3d.nodeSize, v => setDisplayNum('nodeSize', 'nodeSize', v));
    addSlider(display, 'controls3d.linkThickness', LINK_THICKNESS, () => this.owner.settings.display3d.linkThickness, v => setDisplayNum('linkThickness', 'linkThickness', v));
    addToggle(
      display,
      'controls3d.perspectiveLabels',
      'controls3d.perspectiveLabelsTooltip',
      () => this.owner.settings.perspectiveLabels,
      value => {
        this.owner.settings.perspectiveLabels = value;
        this.callbacks.onDisplay('labels');
        this.saveNow();
      },
    );
    addSlider(
      display,
      'controls3d.labelSize',
      LABEL_SIZE,
      () => this.owner.settings.labelSize,
      value => {
        this.owner.settings.labelSize = value;
        this.callbacks.onDisplay('labels');
        this.debouncedSave();
      },
    );
    addReset(display, () => this.resetDisplay(true));

    // Forces section
    const forces = section('forces', t('controls3d.forcesSection'));
    addToggle(
      forces,
      'controls3d.dragTension',
      'controls3d.dragTensionTooltip',
      () => this.owner.settings.dragTension3d,
      value => {
        this.owner.settings.dragTension3d = value;
        this.callbacks.onDragTension();
        this.saveNow();
      },
    );
    for (const key of Object.keys(FORCES) as (keyof Forces)[]) {
      addSlider(
        forces,
        FORCE_LABELS[key],
        FORCES[key],
        () => this.owner.settings.forces3d[key],
        value => {
          this.owner.settings.forces3d = { ...this.owner.settings.forces3d, [key]: value };
          this.callbacks.onForces();
          this.debouncedSave();
        },
      );
    }
    addReset(forces, () => this.resetForces(true));

    reset.addEventListener('click', () => this.resetAll());
    open.addEventListener('click', () => {
      this.sync();
      panel.removeClass('is-close');
    });
    close.addEventListener('click', () => panel.addClass('is-close'));
  }
}
