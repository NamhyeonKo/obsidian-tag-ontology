import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cli, copyOfFixture } from './cli-helper.ts';

// Without --json the CLI prints text for people. It isn't a contract, so these check what a reader needs, not the layout.
const text = (args: string[], cwd?: string) => {
  const run = cli(args, cwd);
  assert.ok(!run.stdout.trimStart().startsWith('{'), `${args.join(' ')} printed JSON`);
  assert.ok(run.stdout.endsWith('\n'));
  return run;
};

test('check lists each problem and counts them', t => {
  assert.match(text(['check']).stdout, /No problems found/);
  const vault = copyOfFixture(t);
  writeFileSync(join(vault, 'Tag-Dictionary.json'), JSON.stringify({ root: { description: 'R', broader: ['gone'] }, loose: { description: 'L' } }));
  const run = text(['check'], vault);
  assert.equal(run.code, 1);
  assert.match(run.stdout, /^error: .*gone/m);
  assert.match(run.stdout, /^warning: .*loose/m);
  assert.match(run.stdout, /1 error, 1 warning/);
});

test('scan lists each note with its tags and headings', () => {
  const { stdout } = text(['scan', 'notes']);
  assert.match(stdout, /^notes\/Alpha\.md$/m);
  assert.match(stdout, /tags: machine-learning, cnn/);
  assert.match(stdout, /body tags: deep-learning, ML, ai/);
  assert.match(stdout, /^warning: notes\/Broken\.md/m);
  assert.match(stdout, /3 notes/);
});

test('usage groups its findings', () => {
  const { stdout } = text(['usage']);
  assert.match(stdout, /4 notes scanned/);
  assert.match(stdout, /Unregistered \(1\)[\s\S]*quantum.*notes\/Broken\.md/);
  assert.match(stdout, /notes\/Alpha\.md: ML -> machine-learning/);
  assert.match(stdout, /Unused \(1\): unused-leaf/);
  assert.match(stdout, /Redundant \(3\)[\s\S]*notes\/Alpha\.md: ai \(narrower: cnn, deep-learning, machine-learning\)/);
  assert.match(text(['usage', 'notes/archive']).stdout, /No unregistered, non-canonical or redundant tags/);
});

test('show describes the tag', () => {
  const { stdout } = text(['show', 'ML', '--notes']);
  assert.match(stdout, /^machine-learning \(matched alias ML\)$/m);
  assert.match(stdout, /Learning from data/);
  assert.match(stdout, /ai > machine-learning/);
  assert.match(stdout, /Children: deep-learning/);
  assert.match(stdout, /Notes: 1 direct, 2 with narrower tags/);
  assert.match(stdout, /^ {2}notes\/Alpha\.md$/m);
});

test('plan and apply show the diff and what happened to the file', t => {
  const vault = copyOfFixture(t), dictionary = join(vault, 'Tag-Dictionary.json');
  const draft = { name: 'transformer', description: 'Attention', aliases: [], parents: ['deep-learning'], children: [], related: [] };
  writeFileSync(join(vault, 'changes.json'), JSON.stringify({ changes: [{ kind: 'add', draft }, { kind: 'delete', tag: 'unused-leaf' }] }));
  const base = `sha256:${createHash('sha256').update(readFileSync(dictionary)).digest('hex')}`;
  const plan = text(['plan', 'changes.json'], vault).stdout;
  assert.match(plan, /^\+ transformer$/m);
  assert.match(plan, /^- unused-leaf$/m);
  assert.ok(plan.includes(`--base ${base}`));
  const stale = text(['apply', 'changes.json', '--base', `sha256:${'0'.repeat(64)}`], vault);
  assert.equal(stale.code, 3);
  assert.match(stale.stdout, /changed since plan/);
  const applied = text(['apply', 'changes.json', '--base', base], vault).stdout;
  assert.match(applied, /^Written\./m);
  assert.ok(applied.includes(`sha256:${createHash('sha256').update(readFileSync(dictionary)).digest('hex')}`));
});

test('control characters from notes are shown as escapes, not sent to the terminal', t => {
  const vault = copyOfFixture(t);
  // OSC 52 asks a terminal to set the clipboard; a carriage return can overwrite what is already on the line.
  writeFileSync(join(vault, 'Hostile.md'), '# Title \u001b]52;c;aGk=\u0007 end\n\n#tag\rspoof\n');
  for (const args of [['scan', 'Hostile.md'], ['usage', 'Hostile.md']]) {
    const { stdout } = text(args, vault);
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(stdout), `${args[0]} printed a control character`);
  }
  assert.match(text(['scan', 'Hostile.md'], vault).stdout, /# Title \\u001b\]52;c;aGk=\\u0007 end/);
  // --json escapes them already.
  assert.ok(!cli(['scan', 'Hostile.md', '--json'], vault).stdout.includes('\u001b'));
});
