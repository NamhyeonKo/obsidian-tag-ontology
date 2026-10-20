import { Notice, TFile, type ItemView, type WorkspaceLeaf } from 'obsidian';
import { hierarchyPositions } from './layout.ts';
import type TagOntologyPlugin from './main.ts';
import { nativeData, edgeKey, type NativeData } from './native-data.ts';
import type { Graph, GraphEdge } from './ontology.ts';

interface Texture { constructor: { from(canvas: HTMLCanvasElement): Texture }; destroy(): void }
interface NativeLink {
  source: { id: string }; target: { id: string };
  line?: { texture: Texture }; render(): void;
}
interface NativeRenderer {
  setData(data: NativeData): unknown;
  onNodeClick(event: MouseEvent, id: string, type: string): void;
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
  click: NativeRenderer['onNodeClick']; ownClick?: NativeRenderer['onNodeClick']; expanded: Set<string>;
  tools: HTMLElement; panel: HTMLElement; status: HTMLElement;
  kinds: Map<string, GraphEdge['kind']>;
  links: Map<NativeLink, { render: () => void; texture?: Texture }>;
  selected?: string; texture?: Texture; layout?: string;
  fitFrame?: number; stopFit: () => void;
}

export class NativeGraphs {
  private sessions = new Map<WorkspaceLeaf, Session>();
  private failed = new WeakSet<WorkspaceLeaf>();
  metrics: { operation: string; ms: number; nodes: number; edges: number; visible: boolean }[] = [];
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
        new Notice('이 Obsidian 버전의 내장 그래프를 연결할 수 없습니다. 상세 뷰어 명령을 사용하세요.');
        this.failed.add(leaf);
        continue;
      }
      const tools = view.contentEl.createDiv('tag-ontology-tools');
      const panel = view.contentEl.createDiv('tag-ontology-panel'); panel.hidden = true;
      const status = view.contentEl.createDiv('tag-ontology-status'); status.setAttribute('role', 'status');
      const session: Session = {
        leaf, view, renderer: r, active: true, original: r.setData, wrapped: () => {},
        click: r.onNodeClick, expanded: new Set(), tools, panel, status, kinds: new Map(), links: new Map(), stopFit: () => {},
      };
      session.stopFit = () => { if (session.fitFrame !== undefined) cancelAnimationFrame(session.fitFrame); session.fitFrame = undefined; };
      for (const event of ['pointerdown', 'wheel', 'keydown']) view.contentEl.addEventListener(event, session.stopFit, { capture: true });
      session.wrapped = data => {
        if (!session.active) return session.original.call(r, data);
        try { return this.render(session, 'update'); }
        catch (error) {
          this.failed.add(leaf); this.detach(leaf, false);
          new Notice(`온톨로지 연결을 해제했습니다: ${String(error)}`);
          view.update();
        }
      };
      r.setData = session.wrapped;
      session.ownClick = r.onNodeClick = (event, id, type) => {
        if (!session.active) session.click.call(r, event, id, type);
        else if (type === 'tag' && this.owner.model?.entries.has(id.slice(1))) this.inspect(session, id.slice(1));
        else if (type !== 'tag') this.openNote(id);
      };
      const search = tools.createEl('input', { type: 'search', placeholder: '태그·별칭 찾기', attr: { 'aria-label': '태그·별칭 찾기' } });
      search.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const q = search.value.trim().toLowerCase();
        if (!q) return;
        const match = [...this.owner.model!.entries].find(([tag, entry]) => tag === q || entry.aliases.some(a => a.toLowerCase() === q));
        if (!match) { new Notice('일치하는 사전 태그가 없습니다.'); return; }
        this.reveal(session, match[0]);
      });
      this.button(tools, '루트만', () => { session.expanded.clear(); panel.hidden = true; this.render(session, 'roots'); });
      this.button(tools, '모두 펼치기', () => { session.expanded = new Set(this.owner.model!.entries.keys()); this.render(session, 'expand-all'); });
      this.button(tools, '맞춤', () => this.fit(session));
      this.button(tools, '사전 대조', () => this.inventory(session));
      const select = tools.createEl('select', { attr: { 'aria-label': '레이아웃' } });
      for (const [value, text] of [['force', 'Force'], ['tree', 'Tree'], ['radial', 'Radial']]) select.createEl('option', { value, text });
      select.value = this.owner.settings.layout;
      select.addEventListener('change', () => {
        this.owner.settings.layout = select.value as 'force' | 'tree' | 'radial';
        void this.owner.saveSettings();
      });
      this.sessions.set(leaf, session);
      view.contentEl.addClass('tag-ontology-native');
      try { this.render(session, 'initial'); }
      catch (error) {
        this.failed.add(leaf); this.detach(leaf, true);
        new Notice(`온톨로지 연결을 해제했습니다: ${String(error)}`);
      }
    }
  }

  refresh() {
    this.attach();
    for (const session of this.sessions.values()) {
      session.expanded = new Set([...session.expanded].filter(t => this.owner.model!.entries.has(t)));
      this.render(session, 'refresh');
      if (session.selected && this.owner.model!.entries.has(session.selected)) this.inspect(session, session.selected);
    }
  }

  private render(session: Session, operation: string) {
    const model = this.owner.model;
    if (!model || !session.active) return;
    if (operation !== 'update' && operation !== 'refresh') session.stopFit();
    const start = performance.now(), graph = model.visible(session.expanded);
    const { data, kinds } = nativeData(graph), r = session.renderer;
    session.kinds = kinds;
    const result = session.original.call(r, data);
    this.styleLinks(session);
    if (this.owner.settings.layout !== 'force') this.staticLayout(session, graph);
    else {
      for (const node of r.nodes) { node.fx = null; node.fy = null; }
      if (operation === 'initial' || operation === 'roots') r.nodes.forEach((node, i) => {
        node.x = Math.cos(i * Math.PI * 2 / r.nodes.length) * 250;
        node.y = Math.sin(i * Math.PI * 2 / r.nodes.length) * 250;
      });
      r.worker.postMessage({ nodes: Object.fromEntries(r.nodes.map(n => [n.id, [n.x, n.y]])), alpha: 0.3, run: true });
    }
    // Native updates (metadata changes, file opens) re-enter here; refitting on them would discard the user's zoom.
    const layoutChanged = session.layout !== this.owner.settings.layout;
    session.layout = this.owner.settings.layout;
    if (layoutChanged || operation === 'initial' || operation === 'roots' || operation === 'expand-all') this.fit(session);
    if (operation === 'initial' || operation === 'roots') {
      session.stopFit();
      const started = performance.now();
      const fitRoots = () => {
        if (!session.active) return;
        this.fit(session);
        session.fitFrame = performance.now() - started < 2000 ? requestAnimationFrame(fitRoots) : undefined;
      };
      session.fitFrame = requestAnimationFrame(fitRoots);
    }
    session.status.textContent = `${graph.nodes.filter(n => n.kind === 'tag').length} / ${model.entries.size} 태그 · ${graph.nodes.filter(n => n.kind === 'note').length} 노트 · 루트 ${model.roots.length}`;
    this.metrics.push({ operation, ms: performance.now() - start, nodes: graph.nodes.length, edges: graph.edges.length, visible: document.visibilityState === 'visible' });
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
            const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 2;
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white';
            for (let x = 0; x < 256; x += 16) ctx.fillRect(x, 0, 9, 2);
            session.texture = link.line.texture.constructor.from(canvas);
          }
          link.line.texture = session.texture;
        } else if (link.line && original.texture) link.line.texture = original.texture;
        const arrows = r.fShowArrow;
        r.fShowArrow = kind === 'broader';
        try { original.render.call(link); } finally { r.fShowArrow = arrows; }
      };
    }
  }

  private staticLayout(session: Session, graph: Graph) {
    const r = session.renderer;
    const ids = new Map(graph.nodes.map(n => [n.id, n.kind === 'tag' ? '#' + n.tag : n.path!]));
    const positions = new Map([...hierarchyPositions(graph, this.owner.model!.roots, this.owner.settings.layout === 'radial')]
      .map(([id, position]) => [ids.get(id)!, position]));
      r.worker.postMessage({ run: false }); r.workerResults = null;
      const parents = new Map(graph.edges.filter(e => e.kind === 'note').map(e => [ids.get(e.target)!, ids.get(e.source)!]));
      for (const [i, node] of r.nodes.entries()) {
        const item = positions.get(node.id);
        const parentId = parents.get(node.id);
        const p = item ?? (parentId ? positions.get(parentId) : undefined) ?? { x: 0, y: 0 };
        node.x = item ? p.x + .01 : p.x + Math.cos(i * 2.39996) * 50;
        node.y = item ? p.y + .01 : p.y + Math.sin(i * 2.39996) * 50;
        node.fx = node.x; node.fy = node.y;
      }
      r.changed();
  }

  private reveal(session: Session, tag: string) {
    const pending = [tag], seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const parent of this.owner.model!.entries.get(current)?.broader ?? []) { session.expanded.add(parent); pending.push(parent); }
    }
    this.render(session, 'reveal'); this.inspect(session, tag);
  }

  private inspect(session: Session, tag: string) {
    const model = this.owner.model!, entry = model.entries.get(tag)!;
    session.selected = tag;
    const panel = session.panel; panel.empty(); panel.hidden = false;
    this.button(panel, '닫기', () => { panel.hidden = true; });
    panel.createEl('h3', { text: tag }); panel.createEl('p', { text: entry.description });
    if (entry.aliases.length) panel.createEl('p', { text: entry.aliases.join(' · '), cls: 'tag-ontology-muted' });
    const counts = model.counts(tag);
    panel.createEl('h4', { text: `직접 ${counts.direct}개 / 하위 포함 ${counts.rollup}개` });
    this.button(panel, session.expanded.has(tag) ? '하위 태그·직접 노트 접기' : '하위 태그·직접 노트 펼치기', () => {
      session.expanded.has(tag) ? session.expanded.delete(tag) : session.expanded.add(tag);
      this.render(session, 'expand:' + tag); this.inspect(session, tag);
    });
    for (const [label, tags] of [['상위', entry.broader ?? []], ['하위', model.children.get(tag) ?? []], ['연관', entry.related ?? []]] as const) {
      if (!tags.length) continue;
      const details = panel.createEl('details'); details.createEl('summary', { text: `${label} ${tags.length}` });
      for (const other of tags) this.button(details, other, () => this.reveal(session, other));
    }
    for (const [rollup, label] of [[false, '직접 달린 노트'], [true, '하위 포함 노트']] as const) {
      const details = panel.createEl('details'); details.open = !rollup;
      const paths = model.notesFor(tag, rollup); details.createEl('summary', { text: `${label} (${paths.length})` });
      this.noteLinks(details, paths);
    }
  }

  private inventory(session: Session) {
    session.selected = undefined;
    const model = this.owner.model!, panel = session.panel; panel.empty(); panel.hidden = false;
    this.button(panel, '닫기', () => { panel.hidden = true; });
    panel.createEl('h3', { text: `사전 미등록 ${model.unregistered.size}개` });
    panel.createEl('p', { text: 'Vault 전체의 사용 태그를 대조합니다. 자동 등록·수정·삭제하지 않습니다.' });
    for (const [tag, paths] of model.unregistered) {
      const details = panel.createEl('details'); details.createEl('summary', { text: `${tag} · ${paths.length}개 노트` });
      this.noteLinks(details, paths);
    }
    const unused = panel.createEl('details'); unused.createEl('summary', { text: `직접 사용 없는 사전 개념 ${model.unused.length}개` });
    unused.createEl('p', { text: '분류용 개념일 수 있으며 삭제 대상이라는 뜻은 아닙니다.' });
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

  private openNote(path: string) {
    const file = this.owner.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('노트가 이동되었거나 삭제되었습니다. 새로고침해 주세요.'); return; }
    void this.owner.app.workspace.getLeaf('tab').openFile(file).catch(error => new Notice(`노트를 열지 못했습니다: ${String(error)}`));
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
