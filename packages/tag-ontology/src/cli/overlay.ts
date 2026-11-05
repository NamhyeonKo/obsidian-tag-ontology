import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isRecord, isStringList } from '../core/guards.ts';
import { issue, type Issue } from '../core/validate.ts';
import { cleanTags } from '../vault/frontmatter.ts';
import { UsageError } from './arguments.ts';

export function readOverlay(root: string, files: readonly string[]): Map<string, string[]> {
  const overlay = new Map<string, string[]>();
  for (const file of files) {
    const path = isAbsolute(file) ? file : resolve(root, file);
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) {
      if (error instanceof SyntaxError) throw new UsageError(`${path}: overlay file is not valid JSON.`);
      throw error;
    }
    if (!isRecord(raw)) throw new UsageError(`${path}: expected an object mapping note paths to { tags: string[] }.`);
    for (const [key, value] of Object.entries(raw)) {
      const notePath = key.replace(/^\.\//, '');
      if (isAbsolute(key) || /^[A-Za-z]:\//.test(key) || key.includes('\\') || notePath.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new UsageError(`${path}: invalid overlay note path ${key}.`);
      }
      const resolved = resolve(root, notePath);
      const fromRoot = relative(root, resolved);
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new UsageError(`${path}: overlay note path ${key} is outside the vault root.`);
      }
      if (!isRecord(value) || !isStringList(value.tags)) {
        throw new UsageError(`${path}: overlay entry ${key} must have a tags array of strings.`);
      }
      const tags = overlay.get(notePath) ?? [];
      for (const tag of cleanTags(value.tags)) if (!tags.includes(tag)) tags.push(tag);
      overlay.set(notePath, tags);
    }
  }
  return overlay;
}

export function overlayIssues(root: string, overlay: Map<string, string[]>, scanned: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  for (const path of overlay.keys()) {
    if (scanned.has(path)) continue;
    let parent = root, exists = true;
    for (const part of path.split('/')) {
      let entries: string[];
      try { entries = readdirSync(parent); }
      catch (error) {
        if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) { exists = false; break; }
        throw error;
      }
      if (!entries.includes(part)) { exists = false; break; }
      parent = resolve(parent, part);
    }
    if (!exists) issues.push(issue('overlay-missing-note', `Overlay tags refer to missing file ${path}.`, { path }));
  }
  return issues;
}
