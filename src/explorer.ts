import { ItemView, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import type { Core } from 'cytoscape';
import type TagOntologyPlugin from './main.ts';
import type { LinkedGraph } from './native.ts';

export const VIEW_EXPLORER = 'tag-ontology-explorer';

// Palantir-style exploration: start from an empty canvas and bring tags, notes and note groups out one relation at a time.
// It shares the sidebar with the other graphs through NativeGraphs, but not their expansion or focus.
export class ExplorerView extends ItemView implements LinkedGraph {
  private cy?: Core;
  private closed = false;
  private stage?: HTMLElement; private status?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private owner: TagOntologyPlugin) { super(leaf); }
  getViewType(): string { return VIEW_EXPLORER; }
  getDisplayText(): string { return 'Ontology explorer'; }
  getIcon(): string { return 'waypoints'; }

  async onOpen(): Promise<void> {
    // With the explorer off, a tab the workspace brings back closes before it loads Cytoscape.
    if (!this.owner.settings.enableExplorer) { this.leaf.detach(); return; }
    // One explorer: the sidebar's group view and reveal talk to it, so a second one from Split or a restored workspace closes.
    if (this.app.workspace.getLeavesOfType(VIEW_EXPLORER).some(leaf => leaf !== this.leaf && leaf.view instanceof ExplorerView && leaf.view.cy)) {
      this.leaf.detach(); return;
    }
    const root = this.contentEl;
    root.empty(); root.addClass('tag-ontology-explorer');
    this.stage = root.createDiv('tag-ontology-explorer-stage');
    const overlay = root.createDiv('tag-ontology-overlay'), tools = overlay.createDiv('tag-ontology-tools');
    this.status = overlay.createDiv('tag-ontology-status'); this.status.setAttribute('role', 'status');
    this.button(tools, 'scan', 'Fit', () => { this.cy?.animate({ fit: { eles: this.cy.elements(), padding: 40 } }, { duration: 300 }); });
    this.button(tools, 'eraser', 'Clear canvas', () => { this.cy?.elements().remove(); });
    tools.createDiv('tag-ontology-separator');
    this.button(tools, 'git-fork', 'Open in 2D', () => { void this.owner.openView(); });
    const { default: cytoscape } = await import('cytoscape');
    if (this.closed) return;
    this.cy = cytoscape({ container: this.stage, minZoom: 0.1, maxZoom: 3 });
    this.owner.native.link(this);
  }

  onClose(): Promise<void> {
    this.closed = true;
    this.owner.native.unlink(this);
    this.cy?.destroy(); this.cy = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  draw(): void {}
  paint(): void {}
  // Any dictionary tag can be brought onto the canvas.
  has(tag: string): boolean { return !!this.owner.model?.entries.has(tag); }
  focusOn(): void {}

  private button(parent: HTMLElement, icon: string, label: string, action: () => void) {
    const button = parent.createEl('button', { cls: 'clickable-icon tag-ontology-icon' });
    setIcon(button, icon);
    setTooltip(button, label, { placement: 'right' });
    button.addEventListener('click', action);
    return button;
  }
}
