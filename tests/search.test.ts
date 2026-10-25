import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { transform } from 'esbuild';
import type { Suggestion } from '../src/ontology.ts';

class Div {
  children: { text: string; cls: string }[] = [];
  // Spread so the options object, built inside the module's realm, compares with plain objects here.
  createDiv(options: { text: string; cls: string }) { this.children.push({ ...options }); }
}
// Stands in for Obsidian's popover base class; only close() is used.
class AbstractInputSuggest { closed = 0; close() { this.closed++; } }
interface Suggest { closed: number; renderSuggestion(value: Suggestion, el: Div): void; selectSuggestion(value: Suggestion): void; getSuggestions(query: string): Suggestion[] }

async function setup() {
  const context = createContext({});
  const code = await transform(readFileSync(new URL('../src/search.ts', import.meta.url), 'utf8'), { loader: 'ts', target: 'es2022', format: 'esm' });
  const module = new SourceTextModule(code.code, { context });
  await module.link(() => new SyntheticModule(['AbstractInputSuggest'], function () { this.setExport('AbstractInputSuggest', AbstractInputSuggest); }, { context }));
  await module.evaluate();
  const TagSuggest = (module.namespace as { TagSuggest: new(...args: unknown[]) => Suggest }).TagSuggest;
  const input = { value: 'mach' }, queries: string[] = [], chosen: string[] = [];
  const suggest = new TagSuggest({}, input, (query: string) => { queries.push(query); return [{ tag: 'machine-learning' }]; }, (tag: string) => chosen.push(tag));
  return { suggest, input, queries, chosen };
}

test('suggestions come from the source for the typed query', async () => {
  const t = await setup();
  assert.deepEqual(t.suggest.getSuggestions('mach'), [{ tag: 'machine-learning' }]);
  assert.deepEqual(t.queries, ['mach']);
});

test('a suggestion shows the tag, and the alias that matched under it', async () => {
  const t = await setup(), plain = new Div(), alias = new Div();
  t.suggest.renderSuggestion({ tag: 'machine-learning' }, plain);
  t.suggest.renderSuggestion({ tag: 'machine-learning', alias: 'ML' }, alias);
  assert.deepEqual(plain.children, [{ text: 'machine-learning', cls: 'tag-ontology-suggestion-tag' }]);
  assert.deepEqual(alias.children, [{ text: 'machine-learning', cls: 'tag-ontology-suggestion-tag' }, { text: 'ML', cls: 'tag-ontology-suggestion-alias' }]);
});

test('choosing a suggestion clears the box, closes the popover and reveals the tag', async () => {
  const t = await setup();
  t.suggest.selectSuggestion({ tag: 'machine-learning', alias: 'ML' });
  assert.equal(t.input.value, '');
  assert.equal(t.suggest.closed, 1);
  assert.deepEqual(t.chosen, ['machine-learning']);
});

test('suggestions with a note count show it under the tag', async () => {
  const t = await setup(), one = new Div(), two = new Div();
  t.suggest.renderSuggestion({ tag: 'to-read', notes: 1 }, one);
  t.suggest.renderSuggestion({ tag: 'book', notes: 2 }, two);
  assert.deepEqual(one.children[1], { text: '1 note', cls: 'tag-ontology-suggestion-alias' });
  assert.deepEqual(two.children[1], { text: '2 notes', cls: 'tag-ontology-suggestion-alias' });
});
