import { Menu, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import type TagOntologyPlugin from './main.ts';
import type { Settings } from './settings.ts';

export type GraphMode = Settings['layout'] | '3d' | 'explorer';
export const GRAPH_MODES: [GraphMode, string, string][] = [
  ['force', 'share-2', 'Force'], ['mindmap', 'brain-circuit', 'Mind map'],
  ['tree', 'network', 'Vertical tree'], ['tree-horizontal', 'list-tree', 'Horizontal tree'],
  ['3d', 'box', '3D'], ['explorer', 'waypoints', 'Ontology explorer'],
];

export function graphModeBar(parent: HTMLElement, owner: TagOntologyPlugin, leaf: WorkspaceLeaf): () => void {
  const group = parent.createDiv('tag-ontology-layouts');
  const buttons = GRAPH_MODES.map(([mode, icon, name]) => {
    const button = group.createEl('button', { cls: 'clickable-icon tag-ontology-icon', attr: { type: 'button' } });
    setIcon(button, icon); setTooltip(button, `Layout: ${name}`, { placement: 'right' });
    button.addEventListener('click', () => { void owner.native.switchMode(leaf, mode); });
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      new Menu().addItem(item => item.setTitle('Open in new tab').setIcon('external-link').onClick(() => { void owner.openView(mode, true); })).showAtMouseEvent(event);
    });
    return { mode, button };
  });
  const sync = () => {
    const current = owner.native.graphMode(leaf);
    for (const { mode, button } of buttons) {
      button.hidden = mode === '3d' && !owner.settings.enable3d || mode === 'explorer' && !owner.settings.enableExplorer;
      button.toggleClass('is-active', mode === current); button.setAttribute('aria-pressed', String(mode === current));
    }
  };
  sync(); return sync;
}
