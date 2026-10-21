import { Notice, TFile, type ItemView, type WorkspaceLeaf } from 'obsidian';
import { hierarchyPositions } from './layout.ts';
import type TagOntologyPlugin from './main.ts';
import { buildLayer, edgeKey, type EdgeKind, type NativeData, type Resolved } from './layer.ts';
import type { Settings } from './settings.ts';

interface Texture { constructor: { from(canvas: HTMLCanvasElement): Texture }; destroy(): void }
interface NativeLink {
  source: { id: string }; target: { id: string };
  line?: { texture: Texture }; render: () => void;
}
interface NativeRenderer {
  setData: (data: NativeData) => unknown;
  onNodeClick: (event: MouseEvent, id: string, type: string) => void;
  changed(): void; resetPan(): void;
  width: number; height: number; targetScale: number;
  setScale(scale: number): void; setPan(x: number, y: number): void;
  fShowArrow: boolean;
  worker: Worker;
  workerResults: unknown;
  nodes: { id: string; x: number; y: number; fx: number | null; fy: number | null }[];
  links: NativeLink[];
}
interface NativeView extends ItemView { renderer: NativeRenderer; update(): void }
interface Session {
  leaf: WorkspaceLeaf; view: NativeView; renderer: NativeRenderer; active: boolean;
  original: NativeRenderer['setData']; wrapped: NativeRenderer['setData'];
  click: NativeRenderer['onNodeClick']; ownClick?: NativeRenderer['onNodeClick'];
  tools: HTMLElement; panel: HTMLElement; status: HTMLElement;
  // The engine's latest data, already filtered by the core graph; every render layers it again.
  base?: NativeData; resolved?: Resolved; tagById: Map<string, string>;
  kinds: Map<string, EdgeKind>;
  links: Map<NativeLink, { render: () => void; texture?: Texture }>;
  selected?: string; texture?: Texture; layout?: string; layoutSelect?: HTMLSelectElement;
  toggles: Partial<Record<'showNotes' | 'showRelated', HTMLElement>>;
  fitFrame?: number; stopFit: () => void;
}
type LayerSettings = Pick<Settings, 'expanded' | 'showNotes' | 'showRelated'>;

export class NativeGraphs {
  private sessions = new Map<WorkspaceLeaf, Session>();
  private failed = new WeakSet<WorkspaceLeaf>();
  metrics: { operation: string; ms: number; nodes: number; visible: boolean }[] = [];
  constructor(private owner: TagOntologyPlugin) {}

  attach() {
    const leaves = this.owner.app.workspace.getLeavesOfType('graph');
    for (const [id, session] of this.sessions) {
      if (!leaves.includes(session.leaf) || session.leaf.view !== session.view) this.detach(id, false);
    }
    if (!this.owner.model) return;
    for (const leaf of leaves) {
      if (this.sessions.has(leaf) || this.failed.has(leaf)) continue;
      const view = leaf.view as unknown as NativeView, r = view.renderer;
      if (!r || typeof r.setData !== 'function' || typeof r.onNodeClick !== 'function'
        || !r.worker || !Array.isArray(r.nodes) || !Array.isArray(r.links)) {
        new Notice('Could not attach to the core graph in this Obsidian version.');
        this.failed.add(leaf);
        continue;
      }
      const tools = view.contentEl.createDiv('tag-ontology-tools');
      const panel = view.contentEl.createDiv('tag-ontology-panel'); panel.hidden = true;
      const status = view.contentEl.createDiv('tag-ontology-status'); status.setAttribute('role', 'status');
      const session: Session = {
        leaf, view, renderer: r, active: true, original: r.setData, wrapped: () => {},
        click: r.onNodeClick, tools, panel, status, tagById: new Map(), kinds: new Map(), links: new Map(), toggles: {}, stopFit: () => {},
      };
      session.stopFit = () => { if (session.fitFrame !== undefined) window.cancelAnimationFrame(session.fitFrame); session.fitFrame = undefined; };
      for (const event of ['pointerdown', 'wheel', 'keydown']) view.contentEl.addEventListener(event, session.stopFit, { capture: true });
      session.wrapped = data => {
        if (!session.active) return session.original.call(r, data);
        const first = !session.base;
        session.base = data;
        try { return this.render(session, first ? 'initial' : 'update'); }
        catch (error) {
          this.failed.add(leaf); this.detach(leaf, false);
          new Notice(`Detached the tag ontology from the graph: ${String(error)}`);
          view.update();
        }
      };
      r.setData = session.wrapped;
      session.ownClick = r.onNodeClick = (event, id, type) => {
        const tag = session.active ? session.tagById.get(id) : undefined;
        if (!tag) { session.click.call(r, event, id, type); return; }
        // Clicking only ever expands; collapsing stays explicit so reopening a panel never hides nodes.
        if (!this.owner.settings.expanded.includes(tag)) this.update({ expanded: [...this.owner.settings.expanded, tag] }, 'expand:' + tag);
        this.inspect(session, tag);
      };
      const search = tools.createEl('input', { type: 'search', placeholder: 'Search tags or aliases', attr: { 'aria-label': 'Search tags or aliases' } });
      search.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const q = search.value.trim().toLowerCase();
        if (!q) return;
        const match = [...this.owner.model!.entries].find(([tag, entry]) => tag === q || entry.aliases.some(a => a.toLowerCase() === q));
        if (!match) { new Notice('No matching dictionary tag.'); return; }
        this.reveal(session, match[0]);
      });
      this.button(tools, 'Collapse all', () => { panel.hidden = true; this.update({ expanded: [] }, 'roots'); });
      this.button(tools, 'Expand all', () => this.update({ expanded: [...this.owner.model!.entries.keys()] }, 'expand-all'));
      this.button(tools, 'Fit', () => this.fit(session));
      session.toggles.showNotes = this.toggle(tools, 'Notes', 'showNotes');
      session.toggles.showRelated = this.toggle(tools, 'Related', 'showRelated');
      this.button(tools, 'Dictionary check', () => this.inventory(session));
      const select = session.layoutSelect = tools.createEl('select', { attr: { 'aria-label': 'Layout' } });
      for (const [value, text] of [['force', 'Force'], ['tree', 'Tree'], ['radial', 'Radial']]) select.createEl('option', { value, text });
      select.value = this.owner.settings.layout;
      select.addEventListener('change', () => {
        this.owner.settings.layout = select.value as Settings['layout'];
        void this.owner.saveSettings();
      });
      this.sessions.set(leaf, session);
      view.contentEl.addClass('tag-ontology-native');
      // Ask the engine to send its data again so the first render goes through the layer.
      try { view.update(); }
      catch (error) {
        this.failed.add(leaf); this.detach(leaf, true);
        new Notice(`Detached the tag ontology from the graph: ${String(error)}`);
      }
    }
  }

  refresh() {
    this.attach();
    const model = this.owner.model!, settings = this.owner.settings;
    const kept = settings.expanded.filter(tag => model.entries.has(tag));
    if (kept.length !== settings.expanded.length) { settings.expanded = kept; void this.owner.saveState(); }
    for (const session of this.sessions.values()) {
      this.render(session, 'refresh');
      if (session.selected && !session.panel.hidden && model.entries.has(session.selected)) this.inspect(session, session.selected);
    }
  }

  // Graph state is shared by every graph tab, like the core graph's own options.
  private update(patch: Partial<LayerSettings>, operation: string) {
    Object.assign(this.owner.settings, patch);
    void this.owner.saveState();
    for (const session of this.sessions.values()) {
      this.render(session, operation);
      if (session.selected && !session.panel.hidden) this.inspect(session, session.selected);
    }
  }

  private render(session: Session, operation: string) {
    const model = this.owner.model, settings = this.owner.settings;
    if (!model || !session.active || !session.base) return;
    if (operation !== 'update' && operation !== 'refresh') session.stopFit();
    const start = performance.now();
    const layer = buildLayer(session.base, model, { expanded: new Set(settings.expanded), showNotes: settings.showNotes, showRelated: settings.showRelated });
    session.resolved = layer.resolved; session.kinds = layer.kinds;
    session.tagById = new Map([...layer.resolved.idOf].map(([tag, id]) => [id, tag]));
    const r = session.renderer, result = session.original.call(r, layer.data);
    this.styleLinks(session);
    if (settings.layout !== 'force') this.staticLayout(session, layer.data);
    else {
      for (const node of r.nodes) { node.fx = null; node.fy = null; }
      r.worker.postMessage({ nodes: Object.fromEntries(r.nodes.map(n => [n.id, [n.x, n.y]])), alpha: 0.3, run: true });
    }
    // Native updates (metadata changes, file opens) re-enter here; refitting on them would discard the user's zoom.
    const layoutChanged = session.layout !== settings.layout;
    session.layout = settings.layout;
    if (layoutChanged && session.layoutSelect) session.layoutSelect.value = session.layout;
    for (const [key, button] of Object.entries(session.toggles)) this.syncToggle(button, settings[key as keyof typeof session.toggles]);
    if (layoutChanged || operation === 'initial' || operation === 'roots' || operation === 'expand-all') this.fit(session);
    if (operation === 'initial' || operation === 'roots') {
      session.stopFit();
      const started = performance.now();
      const fitRoots = () => {
        if (!session.active) return;
        this.fit(session);
        session.fitFrame = performance.now() - started < 2000 ? window.requestAnimationFrame(fitRoots) : undefined;
      };
      session.fitFrame = window.requestAnimationFrame(fitRoots);
    }
    const placed = new Set(model.roots.flatMap(root => [root, ...model.descendants(root)])).size;
    const notes = Object.values(layer.data.nodes).filter(n => n.type !== 'tag').length;
    // The core graph's Tags filter is off by default, which leaves nothing to layer the dictionary onto.
    const tagsShown = Object.values(session.base.nodes).some(n => n.type === 'tag');
    session.status.textContent = tagsShown
      ? `${layer.resolved.visible.size} / ${placed} tags · ${notes} notes · ${model.roots.length} roots`
      : 'Turn on Tags in the graph filters to show the dictionary hierarchy.';
    this.metrics.push({ operation, ms: performance.now() - start, nodes: Object.keys(layer.data.nodes).length, visible: document.visibilityState === 'visible' });
    this.metrics = this.metrics.slice(-50);
    return result;
  }

  private styleLinks(session: Session) {
    const r = session.renderer, current = new Set(r.links);
    for (const link of session.links.keys()) if (!current.has(link)) session.links.delete(link);
    for (const link of r.links) {
      if (session.links.has(link)) continue;
      const original = { render: link.render, texture: link.line?.texture };
      session.links.set(link, original);
      link.render = () => {
        if (!original.texture && link.line) original.texture = link.line.texture;
        const kind = session.kinds.get(edgeKey(link.source.id, link.target.id));
        if (link.line && kind === 'related') {
          if (!session.texture) {
            const canvas = createEl('canvas', { attr: { width: 256, height: 2 } });
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white';
            for (let x = 0; x < 256; x += 16) ctx.fillRect(x, 0, 9, 2);
            session.texture = link.line.texture.constructor.from(canvas);
          }
          link.line.texture = session.texture;
        } else if (link.line && original.texture) link.line.texture = original.texture;
        // Hierarchy direction is the meaning of the edge, so it ignores the user's arrow setting; other links follow it.
        const arrows = r.fShowArrow;
        r.fShowArrow = kind === 'broader' ? true : kind === 'related' ? false : arrows;
        try { original.render.call(link); } finally { r.fShowArrow = arrows; }
      };
    }
  }

  private staticLayout(session: Session, data: NativeData) {
    const r = session.renderer, model = this.owner.model!, { visible, idOf } = session.resolved!;
    const tags = [...visible];
    const edges = tags.flatMap(tag => (model.entries.get(tag)!.broader ?? []).filter(parent => visible.has(parent)).map(parent => [parent, tag] as [string, string]));
    const positions = new Map([...hierarchyPositions(tags, edges, model.roots.filter(tag => visible.has(tag)), this.owner.settings.layout === 'radial')]
      .map(([tag, position]) => [idOf.get(tag)!, position]));
    r.worker.postMessage({ run: false }); r.workerResults = null;
    const anchorOf = (id: string) => Object.keys(data.nodes[id]?.links ?? {}).find(target => positions.has(target));
    const xs = [...positions.values()].map(p => p.x), ys = [...positions.values()].map(p => p.y);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    const ring = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 150 : 300;
    const loose = r.nodes.filter(node => !positions.has(node.id) && !anchorOf(node.id)).length;
    const around = new Map<string, number>();
    let ringIndex = 0;
    for (const node of r.nodes) {
      let p = positions.get(node.id);
      const anchor = p ? undefined : anchorOf(node.id);
      if (anchor) {
        // Sunflower spiral keeps many notes around one tag readable without overlapping.
        const k = around.get(anchor) ?? 0, a = positions.get(anchor)!;
        around.set(anchor, k + 1);
        p = { x: a.x + Math.cos(k * 2.39996) * 14 * Math.sqrt(k + 1), y: a.y + Math.sin(k * 2.39996) * 14 * Math.sqrt(k + 1) };
      } else if (!p) {
        const angle = ringIndex++ * 2 * Math.PI / Math.max(1, loose);
        p = { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring };
      }
      // The renderer treats fx = 0 as unpinned, so keep coordinates off exact zero.
      node.x = p.x + .01; node.y = p.y + .01;
      node.fx = node.x; node.fy = node.y;
    }
    r.changed();
  }

  private reveal(session: Session, tag: string) {
    if (!session.resolved?.range.has(tag)) { new Notice('Not in the current graph.'); this.inspect(session, tag); return; }
    // An expanded ancestor can still sit under a collapsed one, so walk every ancestor.
    const expanded = new Set(this.owner.settings.expanded), pending = [tag], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current); expanded.add(current);
      pending.push(...this.owner.model!.entries.get(current)?.broader ?? []);
    }
    this.update({ expanded: [...expanded] }, 'reveal'); this.inspect(session, tag);
  }

  private inspect(session: Session, tag: string) {
    const model = this.owner.model!, entry = model.entries.get(tag)!;
    session.selected = tag;
    const panel = session.panel; panel.empty(); panel.hidden = false;
    this.button(panel, 'Close', () => { panel.hidden = true; });
    panel.createEl('h3', { text: tag }); panel.createEl('p', { text: entry.description });
    if (entry.aliases.length) panel.createEl('p', { text: entry.aliases.join(' · '), cls: 'tag-ontology-muted' });
    const counts = model.counts(tag);
    panel.createEl('h4', { text: `${counts.direct} direct · ${counts.rollup} including descendants` });
    this.button(panel, this.owner.settings.expanded.includes(tag) ? 'Collapse children and notes' : 'Expand children and notes', () => {
      // Read the live state: Expand all or another tab may have changed it since this panel was built.
      const expanded = this.owner.settings.expanded;
      this.update({ expanded: expanded.includes(tag) ? expanded.filter(t => t !== tag) : [...expanded, tag] }, 'expand:' + tag);
    });
    for (const [label, tags] of [['Parents', entry.broader ?? []], ['Children', model.children.get(tag) ?? []], ['Related', entry.related ?? []]] as const) {
      if (!tags.length) continue;
      const details = panel.createEl('details'); details.createEl('summary', { text: `${label} ${tags.length}` });
      for (const other of tags) this.button(details, other, () => this.reveal(session, other));
    }
    for (const [rollup, label] of [[false, 'Tagged notes'], [true, 'Including descendants']] as const) {
      const details = panel.createEl('details'); details.open = !rollup;
      const paths = model.notesFor(tag, rollup); details.createEl('summary', { text: `${label} (${paths.length})` });
      this.noteLinks(details, paths);
    }
  }

  private inventory(session: Session) {
    session.selected = undefined;
    const model = this.owner.model!, panel = session.panel; panel.empty(); panel.hidden = false;
    this.button(panel, 'Close', () => { panel.hidden = true; });
    panel.createEl('h3', { text: `Not in dictionary (${model.unregistered.size})` });
    panel.createEl('p', { text: 'Compares tags used across the vault with the dictionary. Nothing is added, changed or deleted.' });
    for (const [tag, paths] of model.unregistered) {
      const details = panel.createEl('details'); details.createEl('summary', { text: `${tag} · ${paths.length} note${paths.length === 1 ? '' : 's'}` });
      this.noteLinks(details, paths);
    }
    const unused = panel.createEl('details'); unused.createEl('summary', { text: `Unused dictionary tags (${model.unused.length})` });
    unused.createEl('p', { text: 'These may be grouping concepts. Unused does not mean they should be deleted.' });
    for (const tag of model.unused) this.button(unused, tag, () => this.reveal(session, tag));
  }

  private noteLinks(parent: HTMLElement, paths: string[]) {
    const list = parent.createEl('ul');
    for (const path of paths) {
      const link = list.createEl('li').createEl('a', { href: '#', text: path.split('/').at(-1)!.slice(0, -3), attr: { title: path } });
      link.addEventListener('click', e => { e.preventDefault(); this.openNote(path); });
    }
  }
  private button(parent: HTMLElement, text: string, action: () => void) {
    parent.createEl('button', { text }).addEventListener('click', action);
  }
  // Toggle state lives in the shared settings so every graph tab's button shows the same value.
  private toggle(parent: HTMLElement, text: string, key: 'showNotes' | 'showRelated') {
    const button = parent.createEl('button', { text, cls: 'tag-ontology-toggle' });
    button.addEventListener('click', () => this.update({ [key]: !this.owner.settings[key] }, 'filter'));
    this.syncToggle(button, this.owner.settings[key]);
    return button;
  }
  private syncToggle(button: HTMLElement, on: boolean) {
    button.toggleClass('is-active', on); button.setAttribute('aria-pressed', String(on));
  }

  private openNote(path: string) {
    const file = this.owner.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('The note was moved or deleted. Reload the dictionary and try again.'); return; }
    void this.owner.app.workspace.getLeaf('tab').openFile(file).catch(error => new Notice(`Could not open the note: ${String(error)}`));
  }

  private fit(session: Session) {
    const r = session.renderer;
    if (!r.width || !r.height || !r.nodes.length) return;
    const xs = r.nodes.map(n => n.x), ys = r.nodes.map(n => n.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const scale = Math.min(1.4, r.width * devicePixelRatio / (right - left + 220), r.height * devicePixelRatio / (bottom - top + 220));
    r.targetScale = scale; r.setScale(scale);
    r.setPan(r.width * devicePixelRatio / 2 - (left + right) / 2 * scale, r.height * devicePixelRatio / 2 - (top + bottom) / 2 * scale);
    r.changed();
  }

  private detach(id: WorkspaceLeaf, redraw: boolean) {
    const s = this.sessions.get(id); if (!s) return;
    s.active = false;
    s.stopFit();
    for (const event of ['pointerdown', 'wheel', 'keydown']) s.view.contentEl.removeEventListener(event, s.stopFit, { capture: true });
    if (s.renderer.setData === s.wrapped) s.renderer.setData = s.original;
    if (s.renderer.onNodeClick === s.ownClick) s.renderer.onNodeClick = s.click;
    for (const [link, original] of s.links) {
      link.render = original.render;
      if (link.line && original.texture) link.line.texture = original.texture;
    }
    s.texture?.destroy();
    s.tools.remove(); s.panel.remove(); s.status.remove(); s.view.contentEl.removeClass('tag-ontology-native');
    this.sessions.delete(id);
    if (redraw) {
      for (const node of s.renderer.nodes) { node.fx = null; node.fy = null; }
      s.view.update();
    }
  }
  destroy() { for (const id of [...this.sessions.keys()]) this.detach(id, true); }
}
