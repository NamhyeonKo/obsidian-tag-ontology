// The dictionary file on disk: read with the hash `apply --base` compares, and written whole in one rename (docs/decisions.md, 14).
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DICTIONARY_LOCATIONS } from '../core/locations.ts';
import { serialize, type RawDictionary } from '../core/dictionary.ts';
import { issue, type Issue } from '../core/validate.ts';

export interface DictionaryFile {
  // The parsed JSON, not validated yet; undefined when the file isn't JSON, with an invalid-dictionary issue.
  raw: unknown;
  // "sha256:" and the hex SHA-256 of the file's bytes.
  hash: string;
  issues: Issue[];
}

const hashOf = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function findDictionary(root: string): string {
  for (const location of DICTIONARY_LOCATIONS) {
    const file = join(root, location);
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // Missing locations are skipped.
    }
  }
  return join(root, DICTIONARY_LOCATIONS[0]);
}

// Throws when the file can't be read. A file that isn't JSON is a problem with the dictionary, which `check` reports.
export function readDictionary(file: string): DictionaryFile {
  const bytes = readFileSync(file), hash = hashOf(bytes);
  try {
    return { raw: JSON.parse(bytes.toString('utf8')) as unknown, hash, issues: [] };
  } catch (error) {
    return { raw: undefined, hash, issues: [issue('invalid-dictionary', `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)] };
  }
}

// The new content goes to a hidden temporary file beside the dictionary and replaces it in one rename, so a reader sees
// the old file or the new one, never half of one. Returns the new file's hash.
export function writeDictionary(file: string, dict: RawDictionary): string {
  const text = serialize(dict), temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return hashOf(text);
}
