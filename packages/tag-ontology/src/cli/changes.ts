import { readFileSync } from 'node:fs';
import { isRecord, isStringList } from '../core/guards.ts';
import type { Change } from '../core/dictionary.ts';
import { UsageError } from './arguments.ts';

const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

function isChange(value: unknown): value is Change {
  if (!isRecord(value)) return false;
  if (value.kind === 'delete') return onlyKeys(value, ['kind', 'tag']) && typeof value.tag === 'string';
  if (value.kind !== 'add' && value.kind !== 'edit') return false;
  if (!onlyKeys(value, value.kind === 'add' ? ['kind', 'draft'] : ['kind', 'tag', 'draft'])) return false;
  if (value.kind === 'edit' && typeof value.tag !== 'string') return false;
  const draft = value.draft;
  return isRecord(draft) && onlyKeys(draft, ['name', 'description', 'aliases', 'parents', 'children', 'related'])
    && typeof draft.name === 'string' && typeof draft.description === 'string'
    && isStringList(draft.aliases) && isStringList(draft.parents) && isStringList(draft.children) && isStringList(draft.related);
}

export function readChanges(file: string): Change[] {
  const text = readFileSync(file, 'utf8');
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new UsageError(`${file}: changes file is not valid JSON.`); }
  if (!isRecord(raw) || !onlyKeys(raw, ['schemaVersion', 'changes'])
    || Object.hasOwn(raw, 'schemaVersion') && raw.schemaVersion !== 1 || !Array.isArray(raw.changes)) {
    throw new UsageError(`${file}: expected { schemaVersion?: 1, changes: Change[] }.`);
  }
  const changes: Change[] = [];
  for (const [index, value] of raw.changes.entries()) {
    if (!isChange(value)) throw new UsageError(`${file}: changes[${index}] has an invalid shape or unknown fields. Every draft field is required.`);
    changes.push(value);
  }
  return changes;
}
