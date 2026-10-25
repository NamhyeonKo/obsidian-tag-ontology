import { AbstractInputSuggest, type App } from 'obsidian';
import type { Suggestion } from './ontology.ts';

// Type-ahead for the graph search box, using Obsidian's own suggestion popover.
export class TagSuggest extends AbstractInputSuggest<Suggestion> {
  constructor(app: App, private input: HTMLInputElement,
    private source: (query: string) => Suggestion[], private onChoose: (tag: string) => void) {
    super(app, input);
  }

  protected getSuggestions(query: string): Suggestion[] {
    return this.source(query);
  }

  renderSuggestion(value: Suggestion, el: HTMLElement): void {
    el.createDiv({ text: value.tag, cls: 'tag-ontology-suggestion-tag' });
    const detail = value.alias ?? (value.notes === undefined ? undefined : `${value.notes} note${value.notes === 1 ? '' : 's'}`);
    if (detail) el.createDiv({ text: detail, cls: 'tag-ontology-suggestion-alias' });
  }

  selectSuggestion(value: Suggestion): void {
    this.input.value = '';
    this.close();
    this.onChoose(value.tag);
  }
}
