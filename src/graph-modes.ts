import { Menu, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import type TagOntologyPlugin from './main.ts';
import type { Settings } from './settings.ts';
import { t } from './i18n/index.ts';
import type { StringMessageKey } from './i18n/locales/en.ts';

export type GraphMode = Settings['layout'] | '3d' | 'explorer';
export const GRAPH_MODES: [GraphMode, string, StringMessageKey][] = [
  ['force', 'share-2', 'graph.mode.force'], ['mindmap', 'brain-circuit', 'graph.mode.mindmap'],
  ['tree', 'network', 'graph.mode.tree'], ['tree-horizontal', 'list-tree', 'graph.mode.treeHorizontal'],
  ['3d', 'box', 'graph.mode.3d'], ['explorer', 'waypoints', 'views.explorerTitle'],
];

const FLAGS = { '3d': 'enable3d', explorer: 'enableExplorer', tree: 'enableTree', 'tree-horizontal': 'enableTreeHorizontal' } as const;
// Force and mind map are always on; the other modes each have a setting.
export function modeEnabled(settings: Settings, mode: GraphMode): boolean {
  return !(mode in FLAGS) || settings[FLAGS[mode as keyof typeof FLAGS]];
}

export function graphModeBar(parent: HTMLElement, owner: TagOntologyPlugin, leaf: WorkspaceLeaf): () => void {
  const group = parent.createDiv('tag-ontology-layouts');
  const buttons = GRAPH_MODES.map(([mode, icon, labelKey]) => {
    const button = group.createEl('button', { cls: 'clickable-icon tag-ontology-icon', attr: { type: 'button' } });
    setIcon(button, icon);
    button.addEventListener('click', () => { void owner.native.switchMode(leaf, mode); });
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      new Menu().addItem(item => item.setTitle(t('graph.openInNewTab')).setIcon('external-link').onClick(() => { void owner.openView(mode, true); })).showAtMouseEvent(event);
    });
    return { mode, button, labelKey };
  });
  const sync = () => {
    const current = owner.native.graphMode(leaf);
    for (const { mode, button, labelKey } of buttons) {
      setTooltip(button, t('graph.modeTooltip', { name: t(labelKey) }), { placement: 'right' });
      button.hidden = !modeEnabled(owner.settings, mode);
      button.toggleClass('is-active', mode === current); button.setAttribute('aria-pressed', String(mode === current));
    }
  };
  sync(); return sync;
}
