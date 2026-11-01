import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';

test('package layers reject Node, Obsidian and reverse imports, including dynamic imports and require', async () => {
  const lint = new ESLint();
  const cases: [string, string, string][] = [
    ['core/dictionary.ts', "import fs from 'node:fs'; export { fs };", 'no-restricted-imports'],
    ['core/dictionary.ts', "import fs from 'fs'; export { fs };", 'no-restricted-imports'],
    ['core/dictionary.ts', "import { Plugin } from 'obsidian'; export { Plugin };", 'no-restricted-imports'],
    ['core/dictionary.ts', "export { scan } from '../vault/index.ts';", 'no-restricted-imports'],
    ['core/dictionary.ts', "export const load = () => import('node:fs');", 'no-restricted-syntax'],
    ['core/dictionary.ts', "export const load = () => import('../vault/index.ts');", 'no-restricted-syntax'],
    ['core/dictionary.ts', "export const fs = require('node:fs');", 'no-restricted-syntax'],
    ['vault/scan.ts', "export { UsageError } from '../cli/arguments.ts';", 'no-restricted-imports'],
    ['vault/scan.ts', "export const load = () => import('../cli/arguments.ts');", 'no-restricted-syntax'],
  ];
  for (const [file, source, rule] of cases) {
    const [result] = await lint.lintText(source, { filePath: join('packages/tag-ontology/src', file) });
    assert.ok(result?.messages.some(message => message.ruleId === rule), `${file}: ${source}`);
  }
});
