# tag-ontology

Validate, query and edit a `Tag-Dictionary.json` against the Markdown notes in a vault. The MIT-licensed library and CLI share their dictionary rules with the [Tag Ontology Obsidian plugin](https://github.com/NamhyeonKo/obsidian-tag-ontology).

Requires **Node.js 22.18 or later**. The CLI does not require Obsidian. The library is ESM; CommonJS callers can use dynamic `import()`.

Published on npm as [`tag-ontology`](https://www.npmjs.com/package/tag-ontology), with [provenance](https://docs.npmjs.com/generating-provenance-statements) from this repository's GitHub Actions.

## Installation

```sh
npm install tag-ontology
npx tag-ontology check --root /path/to/vault --json
```

Or from a repository checkout:

```sh
npm ci
npm run build
node packages/tag-ontology/dist/cli/main.js check --root /path/to/vault --json
```

## CLI

| Command | Purpose |
| --- | --- |
| `check` | Validate the dictionary; add `--strict` to fail on warnings |
| `scan [paths…]` | Read frontmatter, tags, body tags and headings |
| `usage [paths…]` | Find unregistered, non-canonical, unused and redundant tags |
| `show <tag>` | Show hierarchy, note counts and an editable draft; `--notes` lists paths |
| `plan <changes.json>` | Preview changes in memory and return the dictionary hash |
| `apply <changes.json> --base <hash>` | Write validated changes only while the hash still matches |

The vault root defaults to the current directory; the dictionary defaults to `Tag-Dictionary.json`. `--exclude` globs are repeatable for `scan`, `usage` and `show`. Folder conventions are supplied by the caller. `scan` does not need a dictionary.

`--json` prints one document with `schemaVersion: 1`, `command`, `ok` and `issues`, followed by command-specific fields. Exit codes are 0 (success), 1 (problems found), 2 (wrong usage), 3 (dictionary changed) and 70 (internal error).

The [full CLI contract](https://github.com/NamhyeonKo/obsidian-tag-ontology/blob/dev/docs/cli.md) defines every option, field, issue code and note-parsing rule. Text output is for people and is not a versioned interface.

## Editing safely

Start an edit from `show --json`'s complete `draft`, including `children` and `related`. A changes file has a `changes` array of `add`, `edit` and `delete` objects; unknown keys are rejected.

```json
{
  "schemaVersion": 1,
  "changes": [
    {
      "kind": "add",
      "draft": {
        "name": "new-tag",
        "description": "A new concept.",
        "aliases": [],
        "parents": [],
        "children": [],
        "related": []
      }
    }
  ]
}
```

```sh
npx tag-ontology plan changes.json --root /path/to/vault --json
# Copy the complete base value from the plan output:
npx tag-ontology apply changes.json --root /path/to/vault --base sha256:... --json
```

`apply` writes only the dictionary, preserves unknown entry fields and uses the plugin's one-entry-per-line layout. It writes a temporary file and renames it over the original. The hash is checked again before writing, but a write between that check and the rename is not detected. Note files are never edited.

## Library

The main entry point has no filesystem or Obsidian imports:

```js
import { Ontology, validate } from 'tag-ontology';

const dictionary = {
  ai: { description: 'Artificial intelligence', broader: [] },
  'machine-learning': { description: 'Learning from data', broader: ['ai'] },
};
const issues = validate(dictionary, { names: 'kebab' });
const model = new Ontology(dictionary, [
  { path: 'Notes/Training.md', tags: ['machine-learning'] },
]);
console.log(issues); // []
console.log(model.notesFor('ai', true)); // ['Notes/Training.md']
```

Node-only file access is under `tag-ontology/vault`:

```js
import { readDictionary, scan } from 'tag-ontology/vault';
import { usage, validate } from 'tag-ontology';

const { raw, issues: fileIssues } = readDictionary('/path/to/vault/Tag-Dictionary.json');
const issues = fileIssues.length ? fileIssues : validate(raw);
if (issues.some(issue => issue.severity === 'error')) throw new Error('Invalid dictionary');
const { notes } = scan('/path/to/vault', { exclude: ['**/archive'] });
const result = usage(raw, notes.map(note => ({
  path: note.path,
  tags: [...note.tags, ...note.bodyTags],
})));
console.log(result.unregistered);
```

`validate()` returns errors for dictionaries the plugin cannot open, and warnings for consistency/style issues. `planChanges(raw, changes, options)` applies the same `Change` objects as the CLI, without I/O, and returns the changed dictionary, entry diff and issues.

## Limits

- Names match dictionary tags ignoring case. Aliases are reported as non-canonical and do not count as using a tag.
- Unused tags are judged over all scanned notes, even when usage findings are scoped to particular paths.
- Note parsing follows Obsidian 1.14.5's worker. It agrees on the real vaults tested, but some unclosed or nested Markdown constructs still differ; see the contract.
- Frontmatter that cannot fit JSON, such as circular YAML aliases, is returned by `scan` as `null` with a warning. Its tags are retained.

## License

[MIT](LICENSE) for this package and its contents. The Obsidian plugin at the repository root is separately licensed under AGPL-3.0-or-later.
