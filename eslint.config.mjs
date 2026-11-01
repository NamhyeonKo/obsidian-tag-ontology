import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

export default defineConfig([
  { ignores: ['main.js', 'node_modules/', 'packages/*/dist/', 'validation/', 'examples/', 'scripts/', 'tests/', 'esbuild.config.mjs', 'eslint.config.mjs'] },
  { files: ['src/**/*.ts', 'package.json'], extends: obsidianmd.configs.recommended,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  { files: ['packages/tag-ontology/**/*.ts'], extends: tseslint.configs.strictTypeChecked,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Map/Record lookups are checked by the caller; dictionary edits deliberately delete dynamic keys.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    } },
  { files: ['packages/tag-ontology/tests/**/*.ts'], rules: {
    // node:test owns registered tests and reports their failures without awaiting each registration.
    '@typescript-eslint/no-floating-promises': ['error', { allowForKnownSafeCalls: [{ from: 'package', package: 'node', name: 'test' }] }],
  } },
  { files: ['packages/tag-ontology/src/{core,vault}/**/*.ts'], rules: {
    'no-restricted-syntax': ['error', {
      selector: "ImportExpression, CallExpression[callee.name='require'], TSImportEqualsDeclaration",
      message: 'Use static imports so package layer boundaries can be checked.',
    }],
  } },
  { files: ['packages/tag-ontology/src/core/**/*.ts'], rules: {
    'no-restricted-imports': ['error', {
      paths: [...new Set(builtinModules.flatMap(name => [name, `node:${name}`])), 'obsidian'],
      patterns: ['**/vault', '**/vault/**', '**/cli', '**/cli/**'],
    }],
  } },
  { files: ['packages/tag-ontology/src/vault/**/*.ts'], rules: {
    'no-restricted-imports': ['error', { paths: ['obsidian'], patterns: ['**/cli', '**/cli/**'] }],
  } },
]);
