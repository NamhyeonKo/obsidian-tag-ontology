// Which files of a vault are notes, and what `tag-ontology scan` reads from each (docs/cli.md, Notes).
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isIncludedNote } from '../core/ontology.ts';
import { compareIssues, issue, type Issue } from '../core/validate.ts';
import { readBody, type Heading } from './body.ts';
import { frontmatterTags, readFrontmatter } from './frontmatter.ts';

export interface ScannedNote {
  path: string;
  frontmatter: Record<string, unknown> | null;
  // Frontmatter tags as written, duplicates kept; body tags once each, in the order they first appear.
  tags: string[];
  bodyTags: string[];
  headings: Heading[];
}

export interface ScanOptions {
  // Files or folders relative to the root; the whole vault when absent.
  paths?: string[];
  // Globs over paths relative to the root: * and ? within one segment, ** across any number of them.
  exclude?: string[];
}

export interface Scan { notes: ScannedNote[]; issues: Issue[] }

// A path given to scan() that it can't use, which the CLI reports as wrong usage.
export class PathError extends Error {}

const globToRegExp = (glob: string) => new RegExp(`^${glob.replace(/^\.\//, '').replace(/\/$/, '').replace(/\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g,
  token => token === '**/' ? '(?:.*/)?' : token === '**' ? '.*' : token === '*' ? '[^/]*' : token === '?' ? '[^/]' : `\\${token}`)}$`);

export function scan(root: string, options: ScanOptions = {}): Scan {
  const patterns = (options.exclude ?? []).map(globToRegExp);
  const matches = (path: string) => patterns.some(pattern => pattern.test(path));
  // A note is skipped when a glob matches its path or the path of a folder above it.
  const excluded = (path: string) => path.split('/').some((_, i, parts) => matches(parts.slice(0, i + 1).join('/')));
  const found = new Set<string>();

  // Hidden entries and symbolic links are skipped: a Dirent describes the link itself, which is neither a file nor a folder.
  const walk = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || matches(child)) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && isIncludedNote(child)) found.add(child);
    }
  };
  for (const given of options.paths ?? ['.']) {
    const path = relative(resolve(root), resolve(root, given)).split(sep).join('/');
    if (path.startsWith('..') || isAbsolute(path)) throw new PathError(`${given} is outside the vault root.`);
    if (path && excluded(path)) continue;
    // Every part of the path is checked, folders on the way too: a link there could lead anywhere, outside the root as well.
    let stats = lstatSync(root);
    const parts = path ? path.split('/') : [];
    for (const [i] of parts.entries()) {
      const part = lstatSync(join(root, ...parts.slice(0, i + 1)), { throwIfNoEntry: false });
      if (!part) throw new PathError(`${given} doesn't exist.`);
      if (part.isSymbolicLink()) throw new PathError(`${given} is or goes through a symbolic link, which the scan doesn't follow.`);
      stats = part;
    }
    if (stats.isDirectory()) walk(path);
    else if (stats.isFile() && isIncludedNote(path)) found.add(path);
  }

  const notes: ScannedNote[] = [], issues: Issue[] = [];
  for (const path of [...found].sort()) {
    const { frontmatter, body, error } = readFrontmatter(readFileSync(join(root, path), 'utf8'));
    let jsonFrontmatter = frontmatter, problem = error;
    try { JSON.stringify(frontmatter); }
    catch { jsonFrontmatter = null; problem = 'The frontmatter cannot be represented as JSON (for example, circular YAML aliases).'; }
    if (problem !== undefined) issues.push(issue('invalid-frontmatter', `${path}: ${problem}`, { path }));
    const { tags: bodyTags, headings } = readBody(body);
    notes.push({ path, frontmatter: jsonFrontmatter, tags: frontmatterTags(frontmatter), bodyTags, headings });
  }
  return { notes, issues: issues.sort(compareIssues) };
}
