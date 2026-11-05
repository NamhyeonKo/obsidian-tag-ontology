import { draftOf, type RawDictionary } from '../core/dictionary.ts';
import { Ontology } from '../core/ontology.ts';
import { UsageError } from './arguments.ts';

export interface NoteSources { tags: string[]; bodyTags: string[]; overlayTags: string[] }

export function resolveTag(model: Ontology, query: string): { tag: string; matchedAlias?: string } {
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
  return { tag, ...matchedAlias === undefined ? {} : { matchedAlias } };
}

export function show(model: Ontology, dictionary: RawDictionary, query: string, notes: boolean, exact: boolean, sources: ReadonlyMap<string, NoteSources>) {
  const { tag, matchedAlias } = resolveTag(model, query);
  // Use a stack so a deep hierarchy doesn't exhaust the JavaScript call stack.
  const paths: string[][] = [], pending = [[tag]];
  while (pending.length) {
    const path = pending.pop()!;
    const parents = model.entries.get(path[0]!)?.broader ?? [];
    if (!parents.length) paths.push(path);
    else for (const parent of [...new Set(parents)].sort().reverse()) pending.push([parent, ...path]);
  }
  const descendants = model.descendants(tag);
  const targetTags = new Set([tag, ...(exact ? [] : descendants)].map(name => name.toLowerCase()));
  const tagByLower = new Map([...model.entries.keys()].map(name => [name.toLowerCase(), name]));
  const notePaths = notes ? model.notesFor(tag, !exact) : undefined;
  const noteMatches = notePaths?.map(path => {
    const noteSources = sources.get(path);
    const matchingTags = new Map<string, Set<'tags' | 'bodyTags' | 'overlay'>>();
    const candidates: [string[], 'tags' | 'bodyTags' | 'overlay'][] = [
      [noteSources?.tags ?? [], 'tags'],
      [noteSources?.bodyTags ?? [], 'bodyTags'],
      [noteSources?.overlayTags ?? [], 'overlay'],
    ];
    for (const [tags, source] of candidates) {
      for (const candidate of tags) {
        const key = tagByLower.get(candidate.toLowerCase());
        if (key === undefined || !targetTags.has(key.toLowerCase())) continue;
        const foundSources = matchingTags.get(key) ?? new Set<'tags' | 'bodyTags' | 'overlay'>();
        foundSources.add(source);
        matchingTags.set(key, foundSources);
      }
    }
    const sourceOrder = { tags: 0, bodyTags: 1, overlay: 2 };
    const matches = [...matchingTags].flatMap(([matchedTag, foundSources]) =>
      [...foundSources].map(source => ({ tag: matchedTag, source })))
      .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : sourceOrder[a.source] - sourceOrder[b.source]));
    return { path, matches };
  });
  return {
    tag, ...matchedAlias === undefined ? {} : { matchedAlias },
    entry: dictionary[tag]!, placed: model.placed.has(tag), paths,
    descendants: descendants.size, notes: model.counts(tag),
    ...notes ? { notePaths, noteMatches } : {},
    draft: draftOf(dictionary, tag),
  };
}

export type Shown = ReturnType<typeof show>;
