import { draftOf, type RawDictionary } from '../core/dictionary.ts';
import { Ontology } from '../core/ontology.ts';
import { UsageError } from './arguments.ts';

export function show(model: Ontology, dictionary: RawDictionary, query: string, notes: boolean, exact: boolean) {
  let tag = model.entries.has(query) ? query : [...model.entries.keys()].find(name => name.toLowerCase() === query.toLowerCase());
  let matchedAlias: string | undefined;
  if (tag === undefined) {
    const matches = [...model.entries].flatMap(([name, entry]) => {
      const alias = entry.aliases.find(item => item.toLowerCase() === query.toLowerCase());
      return alias === undefined ? [] : [{ tag: name, alias }];
    });
    if (matches.length > 1) throw new UsageError(`Ambiguous alias ${query}: ${matches.map(item => item.tag).join(', ')}.`);
    tag = matches[0]?.tag;
    matchedAlias = matches[0]?.alias;
  }
  if (tag === undefined) {
    const suggestions = model.suggest(query).map(item => item.tag);
    throw new UsageError(`Unknown tag ${query}.${suggestions.length ? ` Try: ${suggestions.join(', ')}.` : ''}`);
  }
  // Use a stack so a deep hierarchy doesn't exhaust the JavaScript call stack.
  const paths: string[][] = [], pending = [[tag]];
  while (pending.length) {
    const path = pending.pop()!;
    const parents = model.entries.get(path[0]!)?.broader ?? [];
    if (!parents.length) paths.push(path);
    else for (const parent of [...new Set(parents)].sort().reverse()) pending.push([parent, ...path]);
  }
  return {
    tag, ...matchedAlias === undefined ? {} : { matchedAlias },
    entry: dictionary[tag]!, placed: model.placed.has(tag), paths,
    descendants: model.descendants(tag).size, notes: model.counts(tag),
    ...notes ? { notePaths: model.notesFor(tag, !exact) } : {},
    draft: draftOf(dictionary, tag),
  };
}

export type Shown = ReturnType<typeof show>;
