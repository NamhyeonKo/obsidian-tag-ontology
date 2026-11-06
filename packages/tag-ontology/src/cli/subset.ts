import type { RawDictionary } from '../core/dictionary.ts';
import { Ontology } from '../core/ontology.ts';
import { resolveTag } from './show.ts';

export function subset(model: Ontology, dictionary: RawDictionary, queries: readonly string[]): RawDictionary {
  const included = new Set<string>();
  const pending = queries.map(query => resolveTag(model, query).tag);
  while (pending.length) {
    const tag = pending.pop()!;
    if (included.has(tag)) continue;
    included.add(tag);
    for (const parent of model.entries.get(tag)?.broader ?? []) pending.push(parent);
  }

  const result: RawDictionary = {};
  for (const tag of Object.keys(dictionary)) {
    if (!included.has(tag)) continue;
    const entry = { ...dictionary[tag]! };
    if (entry.related) {
      entry.related = entry.related.filter(related => included.has(related));
      if (!entry.related.length) delete entry.related;
    }
    Object.defineProperty(result, tag, { value: entry, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
