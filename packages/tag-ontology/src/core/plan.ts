// Changes from a changes file, applied in memory and checked: what `plan` reports and `apply` writes (docs/cli.md, plan).
import { apply, nameError, type Change, type RawDictionary, type RawEntry } from './dictionary.ts';
import { isShapeIssue, isWellFormed, issue, validate, type Issue, type ValidateOptions } from './validate.ts';

export type EntryDiff =
  | { tag: string; status: 'added'; after: RawEntry }
  | { tag: string; status: 'removed'; before: RawEntry }
  | { tag: string; status: 'changed'; before: RawEntry; after: RawEntry };

// Applied: the new dictionary, what differs, and the new dictionary's issues. Refused: why nothing could be applied.
export type Plan =
  | { applied: true; dictionary: RawDictionary; diff: EntryDiff[]; issues: Issue[] }
  | { applied: false; issues: Issue[] };

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

function diffOf(before: RawDictionary, after: RawDictionary): EntryDiff[] {
  const tags = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return tags.flatMap((tag): EntryDiff[] => {
    const was = Object.hasOwn(before, tag) ? before[tag] : undefined, now = Object.hasOwn(after, tag) ? after[tag] : undefined;
    if (!was) return now ? [{ tag, status: 'added', after: now }] : [];
    if (!now) return [{ tag, status: 'removed', before: was }];
    // Compared as the file stores them, so a change of key order is a change too.
    return JSON.stringify(was) === JSON.stringify(now) ? [] : [{ tag, status: 'changed', before: was, after: now }];
  });
}

export function planChanges(raw: unknown, changes: readonly Change[], options: ValidateOptions = {}): Plan {
  // Reference problems are fine: a change can fix them. Entries of the wrong shape are not.
  const found = validate(raw, options);
  if (!isWellFormed(raw, found)) return { applied: false, issues: found.filter(isShapeIssue) };
  let current = raw;
  for (const [index, change] of changes.entries()) {
    const target = change.kind === 'add' ? change.draft.name : change.tag;
    const refuse = (message: string): Plan => ({ applied: false, issues: [issue('invalid-change', `changes[${index}]: ${message}`, { tag: target, change: index })] });
    if (change.kind !== 'add' && !Object.hasOwn(current, change.tag)) return refuse(`Unknown tag ${change.tag}`);
    // The edit form's rule for a new name: a valid Obsidian tag, not taken by another tag ignoring case.
    const renamed = change.kind === 'add' ? change.draft.name : change.kind === 'edit' && change.draft.name !== change.tag ? change.draft.name : undefined;
    const error = renamed === undefined ? undefined : nameError(renamed, current, change.kind === 'edit' ? change.tag : undefined);
    if (error) return refuse(error);
    try {
      current = apply(current, change);
    } catch (thrown) {
      return refuse(reason(thrown));
    }
  }
  return { applied: true, dictionary: current, diff: diffOf(raw, current), issues: validate(current, options) };
}
