// How the tags on notes compare with the dictionary: what `tag-ontology usage` reports (docs/cli.md, usage).
import { isIncludedNote, Ontology, type Note } from './ontology.ts';

export interface Unregistered { tag: string; notes: string[]; similar: string[] }
export interface NonCanonical { path: string; tag: string; canonical: string }
export interface Redundant { path: string; tag: string; narrower: string[] }
export interface Usage {
  scanned: number;
  unregistered: Unregistered[];
  nonCanonical: NonCanonical[];
  unused: string[];
  redundant: Redundant[];
}

// vault_meta.py sync calls two names similar at a difflib ratio of 0.85. difflib approximates 2 × common characters
// (longest common subsequence) / total length, which is computed exactly here, so a plural of a short name still counts.
const SIMILAR = 0.85;

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byPathAndTag = (a: { path: string; tag: string }, b: { path: string; tag: string }) => compare(a.path, b.path) || compare(a.tag, b.tag);

function commonLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const row = [0];
    for (let j = 0; j < b.length; j++) row.push(a[i] === b[j] ? (previous[j] ?? 0) + 1 : Math.max(previous[j + 1] ?? 0, row[j] ?? 0));
    previous = row;
  }
  return previous[b.length] ?? 0;
}

function similar(a: string, b: string): boolean {
  if (a.replaceAll('-', '') === b.replaceAll('-', '')) return true;
  // By character (code point), as Python counts: a letter outside the BMP is two UTF-16 units of a string.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- The contract compares code points, as Python does, not graphemes.
  const x = [...a], y = [...b], total = x.length + y.length;
  // There can't be more characters in common than the shorter name has, which rules out most pairs before the table.
  return 2 * Math.min(x.length, y.length) >= SIMILAR * total && 2 * commonLength(x, y) >= SIMILAR * total;
}

// Letters and digits only, ignoring case, so "Deep Learning" and deep-learning name the same concept.
const concept = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// What a note is about by its file name: the whole name, and its parts split at " - ", "(", ")" or ":".
function titleConcepts(path: string): Set<string> {
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return new Set([stem, ...stem.split(/\s+-\s+|[():]/)].map(concept).filter(Boolean));
}

// `notes` are all the vault's notes: unused tags are judged over them, the rest only over the notes `inScope` keeps.
// The dictionary must have no errors (validate()); the model this builds throws the first one.
export function usage(dictionary: unknown, notes: Note[], inScope: (path: string) => boolean = () => true): Usage {
  const model = new Ontology(dictionary, []);
  // Tag names are taken before aliases, as in validate(), so a name that is both resolves to the tag.
  const byName = new Map<string, string>(), byAlias = new Map<string, string>();
  for (const tag of model.entries.keys()) if (!byName.has(tag.toLowerCase())) byName.set(tag.toLowerCase(), tag);
  for (const [tag, entry] of model.entries) {
    for (const alias of entry.aliases) if (!byAlias.has(alias.toLowerCase())) byAlias.set(alias.toLowerCase(), tag);
  }

  const included = notes.filter(note => isIncludedNote(note.path));
  const scoped = included.filter(note => inScope(note.path));
  const unregistered = new Map<string, Set<string>>();
  const nonCanonical: NonCanonical[] = [], redundant: Redundant[] = [];
  for (const note of scoped) {
    // Dictionary tags on the note, by their dictionary name. An alias is not one: Obsidian doesn't find the note under the tag.
    const tagged = new Set<string>();
    for (const tag of new Set(note.tags)) {
      const name = byName.get(tag.toLowerCase()), canonical = name ?? byAlias.get(tag.toLowerCase());
      if (name !== undefined) tagged.add(name);
      if (canonical === undefined) unregistered.set(tag, (unregistered.get(tag) ?? new Set()).add(note.path));
      else if (canonical !== tag) nonCanonical.push({ path: note.path, tag, canonical });
    }
    const concepts = titleConcepts(note.path);
    for (const tag of tagged) {
      const entry = model.entries.get(tag);
      // A facet such as a language is context and goes along with narrower tags; the note's own concept may too.
      if (!entry || entry.facet || [tag, ...entry.aliases].some(name => concepts.has(concept(name)))) continue;
      const narrower = [...model.descendants(tag)].filter(item => tagged.has(item)).sort();
      if (narrower.length) redundant.push({ path: note.path, tag, narrower });
    }
  }

  const used = new Set(included.flatMap(note => note.tags.map(tag => tag.toLowerCase())));
  const pool = [...model.entries.keys(), ...unregistered.keys()];
  return {
    scanned: scoped.length,
    unregistered: [...unregistered].sort(([a], [b]) => compare(a, b)).map(([tag, paths]) => ({
      tag,
      notes: [...paths].sort(),
      similar: pool.filter(other => other !== tag && similar(other.toLowerCase(), tag.toLowerCase())).sort(),
    })),
    nonCanonical: nonCanonical.sort(byPathAndTag),
    // A tag with narrower tags groups them and is fine without notes of its own.
    unused: [...model.entries.keys()].filter(tag => !used.has(tag.toLowerCase()) && !model.children.get(tag)?.length),
    redundant: redundant.sort(byPathAndTag),
  };
}
