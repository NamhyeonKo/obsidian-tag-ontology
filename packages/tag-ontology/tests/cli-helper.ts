// Runs the CLI as a real process, the way a script or the TOW skills will.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixture = fileURLToPath(new URL('fixtures/vault/', import.meta.url));
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));

export function cli(args: string[], cwd = fixture) {
  const run = spawnSync(process.execPath, [main, ...args], { cwd, encoding: 'utf8' });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

// With --json: the parsed document as well.
export function json(args: string[], cwd = fixture) {
  const run = cli([...args, '--json'], cwd);
  return { ...run, doc: JSON.parse(run.stdout) as Record<string, unknown> };
}

// A copy of the fixture vault, for a test that writes to it.
export function copyOfFixture(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'tag-ontology-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}
