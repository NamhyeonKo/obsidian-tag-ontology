#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Ontology } from '../core/ontology.ts';
import { planChanges } from '../core/plan.ts';
import { usage } from '../core/usage.ts';
import { serialize } from '../core/dictionary.ts';
import { compareIssues, isWellFormed, validate, type Issue } from '../core/validate.ts';
import { findDictionary, readDictionary, writeDictionary } from '../vault/dictionary-file.ts';
import { PathError, scan } from '../vault/scan.ts';
import { argumentsOf, HELP, UsageError } from './arguments.ts';
import { readChanges } from './changes.ts';
import { overlayIssues, readOverlay } from './overlay.ts';
import { show, type NoteSources } from './show.ts';
import { subset } from './subset.ts';
import { checkText, editText, scanText, showText, usageText, visible, type EditFields } from './text.ts';

function run(): void {
  const args = argumentsOf(process.argv.slice(2));
  if ('info' in args) {
    const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
    process.stdout.write(args.info === 'help' ? HELP : `${version}\n`);
    return;
  }
  const { command, rest, values, names } = args;
  const root = resolve(values.root ?? '.');
  if (!statSync(root).isDirectory()) throw new UsageError(`${root} is not a vault folder.`);
  const overlay = readOverlay(root, values['tags-file'] ?? []);
  const dictionary = values.dictionary === undefined ? findDictionary(root) : resolve(root, values.dictionary);
  const failed = (issues: Issue[]) => issues.some(item => item.severity === 'error' || values.strict);
  // --json prints the contract's document; otherwise `text` says the same for people (checkText for a bare list of issues).
  const output = (issues: Issue[], fields: object = {}, code = failed(issues) ? 1 : 0, text: (sorted: Issue[]) => string[] = checkText) => {
    const sorted = [...issues].sort(compareIssues);
    process.exitCode = code;
    process.stdout.write(values.json ? `${JSON.stringify({ schemaVersion: 1, command, ok: code === 0, issues: sorted, ...fields })}\n` : `${text(sorted).map(visible).join('\n')}\n`);
  };
  const exclude = values.exclude ?? [];
  if (command === 'scan') {
    const result = scan(root, { paths: rest.length ? rest : ['.'], exclude });
    const scanned = new Set(result.notes.map(note => note.path));
    const notes = values['tags-file']?.length
      ? result.notes.map(note => ({ ...note, overlayTags: overlay.get(note.path) ?? [] }))
      : result.notes;
    const issues = [...result.issues, ...overlayIssues(root, overlay, scanned)];
    output(issues, { notes }, undefined, sorted => scanText(result.notes, sorted));
    return;
  }
  const file = readDictionary(dictionary);
  if (command === 'plan' || command === 'apply') {
    const changesFile = resolve(root, rest[0]!);
    const path = relative(root, changesFile);
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new UsageError(`${rest[0]} is outside the vault root.`);
    }
    const changes = readChanges(changesFile);
    const edited = (issues: Issue[], fields: EditFields, code?: number) => { output(issues, fields, code, sorted => editText(command, fields, sorted)); };
    const fields: EditFields = { base: file.hash, ...command === 'apply' ? { written: false } : {} };
    if (command === 'apply' && file.hash !== values.base) {
      edited([], { ...fields, conflict: { base: values.base, current: file.hash } }, 3);
      return;
    }
    if (file.issues.length) { edited(file.issues, fields); return; }
    const plan = planChanges(file.raw, changes, { names });
    if (!plan.applied) { edited(plan.issues, fields); return; }
    const result = { ...fields, diff: plan.diff };
    if (command === 'plan' || failed(plan.issues) || !plan.diff.length) { edited(plan.issues, result); return; }
    // Check again just before writing; planning may have taken time. This is not a lock (docs/cli.md).
    const current = readDictionary(dictionary).hash;
    if (current !== values.base) { edited(plan.issues, { ...result, conflict: { base: values.base, current } }, 3); return; }
    const hash = writeDictionary(dictionary, plan.dictionary);
    edited(plan.issues, { ...result, written: true, hash });
    return;
  }
  const issues = file.issues.length ? file.issues : validate(file.raw, { names });
  if (command === 'check' || issues.some(item => item.severity === 'error')) { output(issues); return; }
  if (!isWellFormed(file.raw, issues)) { output(issues); return; }
  if (command === 'subset') {
    const result = subset(new Ontology(file.raw, []), file.raw, rest);
    if (values.json) output(issues, { dictionary: result });
    else process.stdout.write(serialize(result));
    return;
  }
  const all = scan(root, { exclude });
  const sources = new Map<string, NoteSources>(all.notes.map(note => [note.path, {
    tags: note.tags, bodyTags: note.bodyTags, overlayTags: overlay.get(note.path) ?? [],
  }]));
  const notes = all.notes.map(note => ({ path: note.path, tags: [...note.tags, ...note.bodyTags, ...overlay.get(note.path) ?? []] }));
  if (command === 'usage') {
    const scoped = rest.length ? scan(root, { paths: rest, exclude }) : all;
    const paths = new Set(scoped.notes.map(note => note.path));
    const result = usage(file.raw, notes, path => paths.has(path));
    const found = [...issues, ...scoped.issues, ...overlayIssues(root, overlay, new Set(all.notes.map(note => note.path)))];
    const problems = failed(found) || values.strict && [result.unregistered, result.nonCanonical, result.unused].some(items => items.length);
    output(found, { ...result }, problems ? 1 : 0, sorted => usageText(result, sorted));
    return;
  }
  const result = show(new Ontology(file.raw, notes), file.raw, rest[0]!, values.notes ?? false, values.exact ?? false, sources);
  const found = [...issues.filter(item => item.tag === result.tag || item.target === result.tag), ...overlayIssues(root, overlay, new Set(all.notes.map(note => note.path)))];
  output(found, result, undefined, sorted => showText(result, sorted));
}

try { run(); }
catch (error) {
  const code = error instanceof UsageError || error instanceof PathError
    || error instanceof Error && 'syscall' in error && typeof error.syscall === 'string' ? 2 : 70;
  process.stderr.write(`tag-ontology: ${visible(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = code;
}
