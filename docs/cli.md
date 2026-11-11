# tag-ontology CLI

> **Contract: `schemaVersion` 1, for `tag-ontology` 0.2.1.** JSON fields, issue codes and exit codes are versioned below. Breaking JSON changes require a new schema version; additive fields do not. Contract changes are documented here before the code changes.

`tag-ontology` checks, queries and edits a tag dictionary (`Tag-Dictionary.json`) against the Markdown notes of a vault. It applies the same rules as the Obsidian plugin in this repository, because both use the `tag-ontology` package.

```sh
npx tag-ontology <command> [arguments] [options]
```

| Command | What it does | Writes |
| --- | --- | --- |
| [`check`](#check) | Validates the dictionary and reports errors and warnings | nothing |
| [`scan [paths…]`](#scan) | Reads notes: frontmatter, tags, body tags, headings | nothing |
| [`usage [paths…]`](#usage) | Compares the tags on notes with the dictionary | nothing |
| [`show <tag>`](#show) | One tag: its place in the hierarchy, notes, and an editable draft | nothing |
| [`subset <tag…>`](#subset) | Prints selected tags and their broader ancestors as a dictionary | nothing |
| [`plan <changes.json>`](#plan) | Applies changes in memory and reports the result | nothing |
| [`apply <changes.json> --base <hash>`](#apply) | Writes the result of `plan` if the dictionary hasn't changed | the dictionary |

Only `--json` output, issue codes and exit codes are a contract. The text printed without `--json` is for people and may change in any release.

## Options

| Option | Commands | Meaning |
| --- | --- | --- |
| `--root <dir>` | all | Vault folder. Default: the current directory. |
| `--dictionary <file>` | all but `scan` | Dictionary file, relative to `--root` unless absolute. By default, the CLI uses the first file found in this order: `tow/tag-dictionary.json`, `.tow/tag-dictionary.json`, `Tag-Dictionary.json`. This shared order was introduced in 0.3.0; previously, the default was `Tag-Dictionary.json`. |
| `--exclude <glob>` | `scan`, `usage`, `show` | Skip notes. Repeatable. See [Notes](#notes). |
| `--tags-file <file>` | `scan`, `usage`, `show` | JSON object mapping note paths to `{ "tags": string[] }`; repeatable. File paths are relative to `--root` unless absolute. |
| `--names <rule>` | all but `scan` | Tag name rule for warnings: `obsidian` (default) or `kebab`. See [`name-format`](#issue-codes). |
| `--strict` | `check`, `usage`, `plan`, `apply` | Treat warnings, and `usage` findings, as failures (exit code 1). |
| `--json` | all | Print one JSON document on stdout. See [JSON output](#json-output). |
| `--help`, `--version` | — | Print help or the version, exit 0. |

Paths given as arguments are relative to `--root` and must be inside it.

## Notes

A note is a `.md` file under `--root`. The CLI skips:

- any path with a segment that starts with `.` (`.obsidian`, `.trash`, `.git`), the same rule as the plugin;
- a note when an `--exclude` glob matches its path or the path of a folder above it. Globs are matched against paths relative to `--root` with `/` separators: `*` and `?` stay within one segment, `**` spans any number of segments. `--exclude 99_Etc` skips that folder, `--exclude '**/archive'` skips every `archive` folder;
- symbolic links (not followed).

Vault conventions such as which folders hold notes are not built in; pass them as `--exclude`.

Overlay tags from repeatable `--tags-file` inputs are a third tag source for `scan`, `usage` and `show`. Each file maps vault-relative note paths (using `/` separators) to objects with a string-list `tags`; these tags are normalized like frontmatter tags and apply even when the note already has tags. Absolute paths, backslashes and paths outside `--root` are rejected. One leading `./` is stripped from each key; paths must then have no empty, `.` or `..` segments. Keys match paths in exact case. A key whose file does not exist with that exact case produces an `overlay-missing-note` warning. An existing file that is excluded, hidden, not `.md`, a symlink, or outside the paths scanned is ignored silently. Tags for one path from multiple files are combined in file order without duplicates.

What the CLI reads from a note follows Obsidian 1.14.5's metadata cache, which is what the plugin sees:

- **Frontmatter**: the note must start with exactly `---` and a line break (a byte order mark before it is dropped); the block closes at the next line that starts with `---`. Line endings are normalized to `\n` first, so CRLF works. It is parsed with the `yaml` package, as in Obsidian: YAML 1.2, so dates and `yes`/`no` stay strings, and a repeated key is an error. A block that is empty, isn't a mapping or doesn't parse gives no frontmatter (the last two with an `invalid-frontmatter` warning). A mapping that cannot be represented as JSON, such as circular YAML aliases, also gives `frontmatter: null` and that warning; its tags are still read, and scanning continues.
- **Tags** (`tags`): the value of the first frontmatter key named `tags`, in any case (`tag` is not read). A string is one tag (it isn't split at commas), and a list gives its string items (numbers are dropped). Empty items and ones with a space are dropped, then each is trimmed and loses one leading `#`. Order and duplicates are kept.
- **Body tags** (`bodyTags`): `#` followed by anything but whitespace, the ASCII punctuation other than `-`, `_` and `/`, and the Unicode punctuation blocks (U+2000–206F, U+2E00–2E7F), so letters of any script, digits, emoji and nested tags (`a/b`) are fine. Digits only (`#1984`) is not a tag.
  - The `#` must start a piece of inline text: a line, or after whitespace, inline code, a `[[wikilink]]`, an HTML tag, the `[` of a link, a table cell's `|`, or the opening `*`, `_`, `~` or `=` of emphasis, a strikethrough or a highlight that is closed (`**#tag**`, `_#tag_` gives `tag`).
  - Nothing counts in fenced code (inside a list item or a quote too, ending with it), indented code, `$$` math blocks, `$…$` inline math or inline code (both may run over several lines of a paragraph), HTML comments and HTML blocks, `[[…]]` and images.
  - Tags inside `%%` comments count, as in Obsidian. A `%%` comment over several lines holds no headings or code; it runs to the next `%%`, or to the end of the note.
- **Headings**: the note's top-level headings, not those in lists, quotes, code, HTML or `%%` comments. ATX headings are `#` to `######` and a space, closing `#`s removed; a setext heading underlines a one-line paragraph with `===` or `---`. The text is as written, markup kept.

Obsidian parses full Markdown with an old version of remark. The CLI reads the blocks and then the inline text of each, which is the part of the structure tags and headings depend on. It was compared with the metadata cache that Obsidian 1.14.5's own worker builds: it agrees on every note of the two vaults tried (681 notes) and on the examples above. Random notes built from unclosed and nested constructs still differ about 2% of the time, for example when Obsidian pairs emphasis across lines.

A note tag **matches** a dictionary tag when the names are equal ignoring case, because Obsidian treats `#Python` and `#python` as one tag. Aliases never make a match: Obsidian doesn't know about them, so a note tagged with an alias isn't found under the tag.

## Exit codes

| Code | Meaning | stdout with `--json` |
| --- | --- | --- |
| 0 | Success. | the result |
| 1 | Problems found: `issues` has an error, or, with `--strict`, a warning or a `usage` finding. `apply` wrote nothing. | the result |
| 2 | Wrong usage: unknown command or option, missing or extra argument, a file that can't be read (including a malformed or unreadable `--tags-file`), a changes file that isn't valid JSON or doesn't have the [expected shape](#changes-file), an unknown tag for `show` or `subset`, or no tag for `subset`. | empty; the message is on stderr |
| 3 | Conflict: the dictionary's hash isn't the `--base` given to `apply`. Nothing was written. | the result, with `conflict` |
| 70 | Internal error, a bug. Don't trust stdout. | undefined |

A dictionary file that exists but isn't valid JSON is not a usage error: it is reported as an [`invalid-dictionary`](#issue-codes) issue, with exit code 1.

## JSON output

With `--json`, stdout holds exactly one JSON document, UTF-8, ending in a newline. Every document has these fields:

```json
{
  "schemaVersion": 1,
  "command": "check",
  "ok": true,
  "issues": []
}
```

- `schemaVersion`: the version of this contract. It goes up when a field is removed or renamed or changes meaning. Adding a field, an issue code or a command doesn't change it, so readers should ignore fields they don't know.
- `ok`: `true` exactly when the exit code is 0.
- `issues`: problems found, in this order: errors before warnings, then by `tag`, `path`, `code` and `target`.
- Paths are relative to `--root`, with `/` separators.
- A hash is `sha256:` followed by the lowercase hex SHA-256 of the dictionary file's bytes.

### Issues

```json
{ "code": "unknown-reference", "severity": "error", "tag": "dropout", "field": "broader", "target": "deep-learnin", "message": "dropout.broader: unknown tag deep-learnin" }
```

| Field | Type | When present |
| --- | --- | --- |
| `code` | string | always; one of the [issue codes](#issue-codes) |
| `severity` | `"error"` or `"warning"` | always; fixed for each code |
| `tag` | string | the dictionary entry the issue is about |
| `field` | `"description"`, `"aliases"`, `"broader"`, `"related"` or `"facet"` | the entry field involved |
| `target` | string | the other tag or name involved |
| `path` | string | the note the issue is about |
| `change` | number | `plan`/`apply`: index of the change in the changes file |
| `message` | string | always; for people, may change |

The same objects come from the library: `validate(raw, { names })` in `tag-ontology` returns them, already sorted.

### Issue codes

An **error** is something that stops the plugin from opening the dictionary. Everything else is a **warning**, and fails only with `--strict`.

| Code | Severity | When | Fields |
| --- | --- | --- | --- |
| `invalid-dictionary` | error | The file isn't valid JSON, or isn't a JSON object. | — |
| `invalid-entry` | error | An entry isn't an object with a string `description`. | `tag` |
| `invalid-field` | error | `aliases`, `broader` or `related` isn't an array of strings, or `facet` isn't a string. | `tag`, `field` |
| `unknown-reference` | error | `broader` or `related` names a tag that isn't in the dictionary. | `tag`, `field`, `target` |
| `self-reference` | error | A tag lists itself in `broader` or `related`. | `tag`, `field` |
| `broader-cycle` | error | Following `broader` from a tag leads back to it. One issue per tag on a cycle; tags below a cycle get none, and a tag listing itself is a `self-reference` instead. | `tag` |
| `invalid-change` | error | `plan`/`apply` (added with them): a change names a tag that isn't in the dictionary, or adds or renames to a name that is taken (ignoring case) or isn't a valid Obsidian tag. | `change`, `tag` |
| `empty-description` | warning | The description is empty or only whitespace. | `tag`, `field` |
| `invalid-name` | warning | The tag name isn't a valid Obsidian tag: empty, has whitespace, has characters other than letters, digits, `_`, `-` and `/`, or is digits only. | `tag` |
| `name-format` | warning | Only with `--names kebab`, and only for names Obsidian accepts: the name isn't lowercase letters and digits separated by single hyphens (`[a-z0-9]+(-[a-z0-9]+)*`). | `tag` |
| `name-collision` | warning | Two names in the dictionary, tag names or aliases, are equal ignoring case, including an alias equal to its own tag. Tag names are taken first, then aliases, each in tag order; the issue is on the entry holding the later name (`field` is `aliases` when that name is an alias), and `target` is the tag holding the first. | `tag`, `field`, `target` |
| `related-in-hierarchy` | warning | A `related` tag is also an ancestor or a descendant. One issue per `related` item. | `tag`, `field`, `target` |
| `unplaced` | warning | The entry has no `broader` key, so it has no place in the hierarchy. (`"broader": []` makes a root.) | `tag` |
| `redundant-broader` | warning | A parent is also reached through another parent. | `tag`, `field`, `target` |
| `invalid-frontmatter` | warning | `scan`/`usage`: a note's frontmatter isn't valid YAML, isn't a mapping, or cannot be represented as JSON. | `path` |
| `overlay-missing-note` | warning | A `--tags-file` key doesn't match a file in the vault using exact-case path matching. | `path` |

## Commands

### check

```sh
tag-ontology check [--names kebab] [--strict] [--json]
```

Validates the dictionary. The result has only the common fields; `issues` lists everything found.

### scan

```sh
tag-ontology scan [paths…] [--exclude <glob>…] [--tags-file <file>…] [--json]
```

Reads every note in `paths` (files or folders; default: the whole vault), sorted by path. Doesn't read the dictionary.

```json
{
  "schemaVersion": 1,
  "command": "scan",
  "ok": true,
  "issues": [],
  "notes": [
    {
      "path": "03_Resources/ml/Dropout.md",
      "frontmatter": { "type": "resource", "tags": ["dropout", "overfitting"] },
      "tags": ["dropout", "overfitting"],
      "bodyTags": ["deep-learning"],
      "overlayTags": ["rag"],
      "headings": [{ "level": 2, "text": "1.1. Idea" }]
    }
  ]
}
```

- `frontmatter`: the parsed YAML, or `null` when there is none or it is invalid (then an `invalid-frontmatter` warning).
- `tags`: as written, duplicates kept, so a reader can report them.
- `bodyTags`: each tag once, in the order it first appears.
- `overlayTags`: present only when at least one `--tags-file` is given; normalized tags from those files for this note, duplicates removed.

### usage

```sh
tag-ontology usage [paths…] [--exclude <glob>…] [--tags-file <file>…] [--names kebab] [--strict] [--json]
```

Compares the tags on notes (`tags` and `bodyTags`, plus `overlayTags` when supplied) with the dictionary. If the dictionary has errors, `usage` reports them and exits 1 without the fields below.

```json
{
  "schemaVersion": 1,
  "command": "usage",
  "ok": true,
  "issues": [],
  "scanned": 464,
  "unregistered": [{ "tag": "llm-agent", "notes": ["00_Inbox/Agents.md"], "similar": ["llm-agents"] }],
  "nonCanonical": [{ "path": "02_Areas/ML.md", "tag": "ML", "canonical": "machine-learning" }],
  "unused": ["aes"],
  "redundant": [{ "path": "03_Resources/ml/Dropout.md", "tag": "machine-learning", "narrower": ["dropout"] }]
}
```

- `issues`: the dictionary's warnings, `invalid-frontmatter` for notes in `paths`, and `overlay-missing-note` warnings when supplied `--tags-file` keys refer to missing files.
- `scanned`: how many notes are in `paths`.
- `unregistered`: tags on notes that match no dictionary tag or alias, sorted by tag, with the notes using them. `similar` lists, sorted, the dictionary tags and other unregistered tags that look like a typo of it. Compared lowercased and counted in characters (code points, not UTF-16 units), two names are similar when they are equal with `-` removed, or when 2 × their longest common subsequence ≥ 0.85 × their total length. That is the ratio Python's `difflib` approximates, so it finds every pair `vault_meta.py sync` finds.
- `nonCanonical`: a note tag written differently from its dictionary tag, either an alias (ignoring case) or the tag name in different case, once per note and spelling, sorted by path and tag. `canonical` is the name to write instead.
- `unused`: dictionary tags that no note matches and that have no narrower tags. A tag with narrower tags is a grouping node and is fine without notes. **This is judged over the whole vault even when `paths` is given**, so a scoped run doesn't call every tag outside the scope unused.
- `redundant`: a note that has both a tag and one of its descendants (`narrower`), one row per such tag, sorted by path and tag. This is a structural review candidate: it does not judge whether the note's body explains both concepts directly. Two exceptions: a tag with a `facet` (context such as a language goes along with narrower tags), and a tag that names the note itself, i.e. its name or an alias equals the note's file name, a part of it split at ` - `, `(`, `)` or `:`, or a whitespace-separated word in it, comparing letters and digits only, ignoring case.

With `--strict`, any entry in `unregistered`, `nonCanonical` or `unused` fails the run (`redundant` candidates do not).

The library's `usage(dictionary, notes, inScope)` returns `scanned`, `unregistered`, `nonCanonical`, `unused` and `redundant`; the CLI adds the common fields.

### show

```sh
tag-ontology show <tag> [--notes] [--exact] [--exclude <glob>…] [--tags-file <file>…] [--names kebab] [--json]
```

Finds `<tag>` by name, then by name ignoring case, then by alias ignoring case. An unknown tag, or an alias held by several tags, exits 2. If the dictionary has errors, `show` reports them and exits 1.

```json
{
  "schemaVersion": 1,
  "command": "show",
  "ok": true,
  "issues": [],
  "tag": "dropout",
  "matchedAlias": "Dropout regularization",
  "entry": { "aliases": ["Dropout regularization"], "description": "Randomly disabling units during training.", "broader": ["deep-learning"], "related": ["overfitting"], "facet": "technique" },
  "placed": true,
  "paths": [["computer-science", "machine-learning", "deep-learning", "dropout"]],
  "descendants": 0,
  "notes": { "direct": 1, "rollup": 1 },
  "notePaths": ["03_Resources/ml/Dropout.md"],
  "draft": { "name": "dropout", "description": "Randomly disabling units during training.", "aliases": ["Dropout regularization"], "parents": ["deep-learning"], "children": [], "related": ["overfitting"] }
}
```

- `issues`: the dictionary's warnings about this tag (as `tag` or `target`), and `overlay-missing-note` warnings when supplied `--tags-file` keys refer to missing files.
- `matchedAlias`: present only when `<tag>` matched an alias.
- `entry`: the entry as stored in the file, including fields the CLI doesn't know.
- `placed`: whether a root (`"broader": []`) is reachable through `broader`.
- `paths`: every chain of `broader` links, from a tag with no parents down to this tag.
- `descendants`: how many tags are below it.
- `notes`: notes with this tag (`direct`) and with it or a descendant (`rollup`).
- `notePaths`: only with `--notes`. Notes with the tag or a descendant, or only the tag with `--exact`.
- `noteMatches`: only with `--notes`, in `notePaths` order. Each note has matching dictionary tags (the dictionary key, ignoring case) and their source: `tags`, `bodyTags` or `overlay`. Matches are sorted by tag, then by source in that order; with `--exact`, only the queried tag is included.
- `draft`: the tag as the edit form sees it, with `children` and two-way `related` filled in. Change it and put it in an `edit` change.

### subset

```sh
tag-ontology subset <tag…> [--dictionary <file>] [--names <rule>] [--json]
```

Finds each requested tag by name, then by name ignoring case, then by alias ignoring case. An unknown tag, or an alias held by several tags, exits 2. If the dictionary has errors, `subset` reports them and exits 1. Each selected tag includes every ancestor reached through `broader`; duplicate ancestors in diamond-shaped hierarchies appear once. Entries are copied with all stored fields, while `related` references outside the result are removed (and an empty `related` field is omitted).

Without `--json`, stdout is exactly the resulting dictionary in the same serialization used for dictionary files. With `--json`, the common envelope includes the result in `dictionary`. The command writes nothing.

### plan

```sh
tag-ontology plan <changes.json> [--names kebab] [--strict] [--json]
```

Applies the [changes](#changes-file) in order to the dictionary in memory, validates the result, and writes nothing. The dictionary doesn't have to pass `check` first, so changes can fix it.

```json
{
  "schemaVersion": 1,
  "command": "plan",
  "ok": true,
  "issues": [],
  "base": "sha256:9f2c…",
  "diff": [
    { "tag": "aes", "status": "removed", "before": { "description": "A block cipher.", "broader": ["cryptography"] } },
    { "tag": "dropout", "status": "changed", "before": { "description": "Old.", "broader": ["deep-learning"] }, "after": { "description": "New.", "broader": ["deep-learning"] } },
    { "tag": "llm-agent", "status": "added", "after": { "description": "An LLM that calls tools.", "broader": ["ai"] } }
  ]
}
```

- `issues`: the result's issues. If a change can't be applied, `plan` stops there: `issues` has one `invalid-change` and there is no `diff`.
- `base`: the hash of the dictionary file as read. Pass it to `apply`.
- `diff`: one item per entry that differs, sorted by tag. `status` is `added`, `removed` or `changed`. A rename shows as one `removed` and one `added`, plus `changed` for the tags that point to it.

### apply

```sh
tag-ontology apply <changes.json> --base <hash> [--names kebab] [--strict] [--json]
```

Does what `plan` does, then writes the result if all of these hold:

1. The dictionary file's hash is still `--base` (else exit 3).
2. The result has no errors, and no warnings with `--strict` (else exit 1).
3. `diff` isn't empty (else nothing to write, exit 0).

The file is written in the dictionary layout the plugin uses: one entry per line, sorted by tag, fields the CLI doesn't know kept. A file in another layout is rewritten whole the first time. The new content goes to a temporary file in the same folder, which is then renamed over the dictionary, so a reader never sees half a file. This is not a lock: a write between the hash check and the rename isn't detected.

```json
{
  "schemaVersion": 1,
  "command": "apply",
  "ok": true,
  "issues": [],
  "base": "sha256:9f2c…",
  "diff": [
    { "tag": "aes", "status": "removed", "before": { "description": "A block cipher.", "broader": ["cryptography"] } },
    { "tag": "dropout", "status": "changed", "before": { "description": "Old.", "broader": ["deep-learning"] }, "after": { "description": "New.", "broader": ["deep-learning"] } },
    { "tag": "llm-agent", "status": "added", "after": { "description": "An LLM that calls tools.", "broader": ["ai"] } }
  ],
  "written": true,
  "hash": "sha256:41ab…"
}
```

- `written`: whether the file was written.
- `hash`: the new file's hash, only when `written`.
- `conflict`: only with exit code 3: `{ "base": "<the --base given>", "current": "<the file's hash>" }`. Run `plan` again.

## Changes file

```json
{
  "schemaVersion": 1,
  "changes": [
    { "kind": "add", "draft": { "name": "llm-agent", "description": "An LLM that calls tools.", "aliases": [], "parents": ["ai"], "children": [], "related": [] } },
    { "kind": "edit", "tag": "dropout", "draft": { "name": "dropout", "description": "New.", "aliases": [], "parents": ["deep-learning"], "children": [], "related": ["overfitting"] } },
    { "kind": "delete", "tag": "aes" }
  ]
}
```

The shape is the `Change` type exported by `tag-ontology`, which the plugin's edit form also produces. `schemaVersion` is optional; any value but 1 is rejected. Unknown keys are rejected too, so a typo such as `parent` fails (exit 2) instead of being ignored. Every `draft` field except `facet` is required. The optional `facet` is a string to set it, `null` to remove it, or absent to keep the current value.

Each change applies to the result of the one before:

- `add`: a new entry with `description`, `aliases` and `broader` = `parents`. Each tag in `children` gets the new tag as a parent, and `related` is linked both ways.
- `edit`: the full draft replaces the tag's description, aliases and parents. A different `name` renames the tag and every reference to it. Children added or removed in the draft gain or lose this tag as a parent. `related` is rewritten only if the set changed. Start from `show --json`'s `draft` so `children` and `related` are complete.
- `delete`: removes the entry. Its children move up to its parents, and references to it are removed.

Fields other than `description`, `aliases`, `broader` and `related` are kept on every entry a change touches. The draft's optional `facet` field can be used to set or remove `facet`.
