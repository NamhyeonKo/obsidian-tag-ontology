# Design decisions

Why the `tag-ontology` package and CLI are built the way they are. Each entry gives the decision, the reason, and what was rejected. A new decision gets a new entry; one that is replaced is marked so, not deleted. *(planned)* marks a decision that is agreed but not in the code yet.

## 1. Plugin at the root, library in `packages/tag-ontology`

npm workspaces: the Obsidian plugin stays at the repository root and the library lives in `packages/tag-ontology`.

- **Why:** Obsidian reads `manifest.json`, the README and the release assets from the root of the plugin repository, so the plugin can't move. A workspace package lets the plugin import the library by name (`from 'tag-ontology'`), the way any other user will.
- **Rejected:** a separate repository now. The plugin and the library change together while the rules are being unified; the package boundary already makes a later move a copy.

## 2. MIT for the package, AGPL for the plugin

- **Why:** the package is meant to be a dependency of other tools (the TOW skills, scripts). MIT lets them depend on it without license questions. One author holds the copyright of both, so the package can be licensed differently.

## 3. A `source` export condition during development

`package.json` exports `source` (the TypeScript in `src/`) next to `types` and `default` (the built `dist/`). esbuild, `tsc` and `node --test` in this repository resolve `source`; published consumers get `dist`.

- **Why:** the plugin and the tests use the library's current source with no build step in between, and Node 22.18+ runs the `.ts` files directly. Consumers still get JavaScript and declaration files.
- **Rejected:** TypeScript project references with a build before every test run (slower, two outputs to keep in sync); path aliases in `tsconfig` (esbuild and Node would each need their own copy).

## 4. Strict compiler options in the package

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `NodeNext`.

- **Why:** the dictionary is a `Record<string, RawEntry>` read by key everywhere, and a missing key is the most likely bug. `noUncheckedIndexedAccess` makes every `dict[tag]` possibly `undefined`; turning it on found `apply()` reading tags that weren't in the dictionary, which now throws `Unknown tag` instead of a `TypeError`. `exactOptionalPropertyTypes` keeps "field absent" (an unplaced tag has no `broader`) apart from "field set to `undefined`".

## 5. Errors only for what stops the plugin; everything else is a warning

An issue is an **error** when the plugin can't open the dictionary with it (today: when the `Ontology` constructor throws). Style and consistency problems are **warnings**, and fail only with `--strict`.

- **Why:** the plugin and `vault_meta.py` disagree today (kebab-case names, empty descriptions and alias collisions are errors in Python and allowed in the plugin). Making them errors would make the plugin refuse dictionaries it opens now. Warnings keep every existing dictionary usable, and `--strict` lets a vault that wants the stricter rules have them.
- Kebab-case names are a vault convention, so they are an opt-in warning (`--names kebab`), not the default rule.

## 6. One validator

All rules live in `core/validate.ts`, which returns a list of issues. The `Ontology` constructor calls it and throws on the first error.

- **Why:** two copies of a rule drift, which is how the plugin and `vault_meta.py` ended up with different rules. With one function, the plugin, the CLI and anything built on the CLI agree by construction.
- **How:** each issue code has its severity in one `as const` table, and the `IssueCode` type is derived from its keys (`keyof typeof SEVERITY`), so a code can't be used without a severity. The constructor calls `assertDictionary()`, an assertion function (`asserts raw is RawDictionary`): once it returns, TypeScript treats the parsed JSON as a dictionary and the model needs no casts.
- **Checked:** an integration test runs `vault_meta.py`'s dictionary checks on the real dictionary and on a fixture that breaks every rule, and compares the count for each rule.

## 7. Dependencies point one way: `cli → vault → core` *(planned)*

`core` does no I/O and imports neither Node nor Obsidian. `vault` reads files with Node. `cli` parses arguments and sets exit codes. ESLint's `no-restricted-imports` enforces the direction.

- **Why:** the plugin bundles `core` into a browser-like environment, so a Node import there would break it. Pure functions are also tested without temporary files. The `tag-ontology` entry point exports only `core`; Node code is under `tag-ontology/vault`.

## 8. Notes are parsed in one place: the CLI *(planned)*

The TypeScript CLI is the only note parser. The TOW skills (Python, separate repository) read `scan --json` instead of parsing notes themselves.

- **Why:** a second parser in Python would be a second set of tag rules to keep in step with Obsidian's.

## 9. YAML with the `yaml` package

`yaml` 2.9.1, pinned. It has no dependencies.

- **Why:** frontmatter tags can be a block list, an inline list (`tags: [a, b]`) or a string. The regular expression in `vault_meta.py` reads only block lists. A real YAML parser handles all of them, and the core schema keeps dates as strings.
- **Rejected:** `gray-matter`, which depends on `js-yaml` 3 and three more packages for a job one parser does.
- **Found later:** Obsidian 1.14.5 parses frontmatter with the same package and its default options (see 20), so a note gives the same values and the same errors.

## 10. The changes file is the core `Change` type

`plan` and `apply` read `{ "changes": Change[] }`, the same `Change` the plugin's edit form produces.

- **Why:** the plugin, the CLI and a future chatbot then go through the same `apply()`, so an edit means the same thing everywhere.

## 11. No vault conventions in the CLI

Which folders hold notes, `category` and `type` fields, archive folders: none of it is built in. The CLI takes `--exclude` globs; the TOW skills, which own those conventions, pass them.

- **Why:** the CLI is for any vault with a `Tag-Dictionary.json`; one vault's layout would be wrong for the next.

## 12. Machine-readable output is a contract

`--json` output, issue codes and exit codes are written down in [cli.md](cli.md) and versioned by `schemaVersion`. Text output isn't.

- **Why:** other programs (the TOW skills first) parse the output. A field they rely on can't change silently, and a version number tells them when it did. Adding fields doesn't bump the version, so readers ignore what they don't know.
- Every JSON document has the same four fields (`schemaVersion`, `command`, `ok`, `issues`), so a reader can check the outcome before it knows the command.

## 13. Exit codes 0, 1, 2, 3 and 70

0 success, 1 problems found, 2 wrong usage, 3 conflict, 70 internal error.

- **Why:** a caller has to tell "the dictionary has errors" (fix the dictionary) from "I called it wrong" (fix the call) from "someone else changed the file" (plan again). Node exits with 1 on an uncaught exception, which would read as "problems found", so the CLI catches unexpected errors and exits with 70 (`EX_SOFTWARE` in BSD `sysexits.h`).
- A dictionary that isn't valid JSON is exit 1 (an `invalid-dictionary` issue), not 2: judging the file is `check`'s job.

## 14. Optimistic concurrency with a content hash

`plan` reports the dictionary's SHA-256; `apply --base <hash>` writes only if the file still has it, through a temporary file and a rename.

- **Why:** the plugin, git and editors write the same file and none of them takes a lock, so a lock in the CLI would protect nothing. A hash of the bytes catches every change since `plan`, including a reformat. The rename means a reader sees the old file or the new one, never half.
- **Known limit:** a write between the hash check and the rename isn't detected. That window is a few milliseconds of a command run by hand or by a script.

## 15. The plugin's file layout

`apply` writes with `serialize()`: one entry per line, sorted by tag, unknown fields kept.

- **Why:** it is what the plugin writes, and a save changes only the lines of the entries it touched, which reads well in git. On the real vault (997 tags), reading and writing back with `serialize()` gives the same bytes.

## 16. Note tags match dictionary tags ignoring case

`#Python` on a note counts for the `python` tag. It is reported under `nonCanonical`, but the tag counts as used.

- **Why:** Obsidian treats tags that differ only in case as one tag, and the plugin's graph does the same. `vault_meta.py sync` compares exactly, so it would call `python` unused there. On the real vault the two give the same counts, because no note uses a case variant (checked 2026-11-01).
- An alias on a note doesn't count as using the tag: Obsidian doesn't know aliases, so the note isn't found under the tag.

## 17. A tag with narrower tags is never "unused"

- **Why:** a grouping node such as `machine-learning` is there to hold narrower tags; notes carry the specific ones. Reporting it would bury the unused leaf tags. `vault_meta.py sync` uses the same rule.
- Unused is judged over the whole vault even when `usage` is given paths, also as `sync` does, so a scoped run doesn't call every tag outside the scope unused.

## 18. Output in English

- **Why:** the package is open source and its users aren't only Korean speakers. Messages and docs are in English; the vault's own content can be in any language.

## 19. Similar tags by their longest common subsequence

Two names, lowercased, are similar when they are equal with `-` removed, or when 2 × their longest common subsequence (LCS) ≥ 0.85 × their total length.

- **Why:** `vault_meta.py sync` uses `difflib.SequenceMatcher(...).ratio() >= 0.85`. That ratio is 2 × matched characters / total length, where difflib finds the matches greedily, so they never exceed the LCS. Using the LCS itself finds every pair difflib finds, plus the few its greedy matching misses. On the real dictionary's 496,506 tag pairs, difflib finds 55 similar pairs; this rule finds the same 55 and `langgraph-edge` / `langgraph-node`.
- **Rejected:** a Levenshtein distance within 15% of the longer name (the first draft). It misses the plural of a short tag, the most common slip: `llm` / `llms` is 1 edit in 4 characters, while difflib's ratio is 0.86. Porting difflib's algorithm: more code for an answer that is only an approximation of this one.
- **Cost:** the LCS table is length × length per pair, and a length check skips most pairs first: 997 unregistered tags against the dictionary take about 0.5 s.

## 20. Note parsing follows Obsidian's own code

The rules for frontmatter, tags and headings come from the Obsidian 1.14.5 app bundle (`worker.js`, which builds the metadata cache, and `app.js`, which has `getAllTags` and `parseFrontMatterTags`), not from the help pages or guesses.

- **Why:** the plugin reads tags through Obsidian's metadata cache, so the CLI is right exactly when it agrees with that cache. The help pages leave out what decides edge cases: only a key named `tags` counts (not `tag`), a string is never split, a list drops numbers, and the tag pattern excludes Unicode punctuation.
- **Simplified:** Obsidian runs a full Markdown parser, an old remark with its own extensions. The CLI reads the blocks (list items with their columns, quotes, code, math, HTML, `%%` comments, headings, tables) and then the inline text of each, which is the part tags and headings depend on. A Markdown library would be dozens of packages, and today's CommonMark parsers differ from Obsidian's old remark exactly where it matters here: lazy lines in list items, setext headings, emphasis.
- **Checked:** Obsidian's `worker.js`, run locally in Node, is the reference: what it returns for a note is what the plugin sees. The CLI agrees with it on all 681 notes of the two vaults tried and on 73 crafted notes. On 20,000 random notes built from unclosed and nested constructs, about 2% still differ, for example where Obsidian pairs emphasis across lines. Fixture tests pin each rule, each checked against the worker; Obsidian's code isn't part of this repository.

## 21. Scanned frontmatter must fit JSON

`readFrontmatter()` keeps the parsed YAML mapping. When that mapping cannot be represented as JSON, `scan()` returns `frontmatter: null` with an `invalid-frontmatter` warning, while keeping the tags read from it.

- **Why:** valid YAML can contain circular aliases. One such note must not abort an entire `scan --json` run. Shared aliases that are not circular still serialize normally, and the raw frontmatter reader keeps its Obsidian behavior.
