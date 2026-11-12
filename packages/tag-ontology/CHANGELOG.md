# Changelog

Changes to the `tag-ontology` package (library and CLI). The [CLI contract](https://github.com/NamhyeonKo/obsidian-tag-ontology/blob/main/docs/cli.md) defines every command, field and exit code.

## 0.3.2 — 2026-11-12

- `add` writes `facet` after `related`, as in hand-written entries and edits. Values and validation are unchanged.

## 0.3.1 — 2026-11-11

- `suggest` shortens a term with no match one character at a time, down to three characters, so a misspelled tag still gets suggestions in one run. The JSON output adds `matched`: the term the suggestions came from, or `null`.

## 0.3.0 — 2026-11-11

- New `suggest <term>` command with `--limit`, using the same ranking as the plugin's sidebar search.
- `facet` can be set, changed or removed through the `draft` of `add` and `edit` changes.
- Without `--dictionary`, the CLI uses the first dictionary it finds: `tow/tag-dictionary.json`, `.tow/tag-dictionary.json`, then `Tag-Dictionary.json`. The library exports this order as `DICTIONARY_LOCATIONS` and `findDictionary`.

## 0.2.1 — 2026-11-11

- Exports `isKebabName` for the kebab-case tag name option.

Earlier versions are in the [commit history](https://github.com/NamhyeonKo/obsidian-tag-ontology/commits/main/packages/tag-ontology).
