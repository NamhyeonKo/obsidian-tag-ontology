# Contributing

Thanks for helping improve Tag Ontology. Bug reports and feature requests go in [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues). Please use the issue forms so the Obsidian version and OS are included.

## Development setup

Requires Node.js 22.18 or later.

```sh
npm ci
npm run build
npm run deploy -- "examples/sample-vault"
```

See [Project structure](README.md#project-structure) for where things live.

## Commit messages

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`, `revert`.
- Mark breaking changes with `!` after the type (`feat!: ...`) or a `BREAKING CHANGE:` footer.
- Keep one kind of change per commit. Split a bug fix and a docs update into two commits.

Examples from this repo:

```text
fix(graph): keep user zoom in tree and radial layouts
feat(graph): add notes and related toggles to the toolbar
docs: add demo GIF and screenshots
```

## Before you commit

```sh
npm run lint    # same rules as the Obsidian community review; must report 0 errors
npm test
npm run build
```

- The lint does not check CSS (`!important`, `:has()` and so on). If you change `styles.css`, mention it in the PR so the maintainer can run a preview scan.
- Add or update a test in `tests/` for behavior changes.

## Pull requests

1. Work on a branch, not `main`.
2. Open a PR. CI runs lint, tests and build.
3. Describe what changed and how you tested it in Obsidian.

## Testing in Obsidian

- Plugins are installed per vault. Deploy into the vault that is actually open:

  ```sh
  npm run build && npm run deploy -- "examples/sample-vault"
  ```

  The target vault needs a `.obsidian/` folder; opening it once in Obsidian creates it.
- After deploying, disable and re-enable the plugin, or restart Obsidian.
- Quick check that the new build is loaded: the core graph toolbar shows the **Notes** and **Related** toggles.
- The plugin has two views. Know which one you are testing:

  | View | Tab title | `data-type` | Source |
  | --- | --- | --- | --- |
  | Core graph integration (default) | Graph view | `graph` | `src/native.ts` |
  | Compatibility viewer | Tag ontology | `tag-ontology` | `src/view.ts` |

- When inspecting CSS in DevTools, select the `.view-content` div, not the `canvas`. The `padding: 0` on the canvas is Obsidian's own inline style.
- `npm run test:vault` is the maintainer's integration test against a private vault (`OBSIDIAN_VAULT_PATH`). You don't need to run it.

## Maintainers

### Releasing

1. Merge the release-ready changes into `main` through a PR with passing CI.
2. Bump the version:
   - `npm version x.y.z --no-git-tag-version` (updates `package.json` and `package-lock.json`)
   - set the same `version` in `manifest.json`
   - add `"x.y.z": "<minAppVersion>"` to `versions.json`
   - commit as `chore: release x.y.z`
3. Push a tag that matches the version exactly, with no `v` prefix:

   ```sh
   git fetch origin main && git tag x.y.z origin/main && git push origin x.y.z
   ```

4. GitHub Actions lints, tests, builds, attests `main.js`, `manifest.json` and `styles.css`, and creates a **draft** release.
5. Write release notes on the draft. An empty description gets a review Recommendation. Notes can be edited after publishing without a new version.
6. In the [community dashboard](https://community.obsidian.md), put the tag in **Review branch** and run a preview scan. Publish the draft only when it reports no errors.
7. Click **Check for new releases** in the dashboard and check the review. After editing only the notes of a published release, use **… → Request review**.

### Community review

- **Errors** fail the review and the plugin drops out of search within 24 hours. **Warnings** and **Recommendations** don't block publishing.
- The review and the byte-for-byte build check use the **commit the release tag points to**. Commits made after tagging go into the next version.
- Always publish the assets CI built. Never upload a local build.

Known review findings:

| Finding | Where | Status |
| --- | --- | --- |
| Vault Enumeration (Recommendation) | `getMarkdownFiles()` in `src/main.ts` | Intended. Counting notes per tag needs the full note list |
| `getSettingDefinitions()` not implemented (Warning) | Settings tab in `src/main.ts` | Settings search on 1.13+. Needs a compatibility check with older versions first |
| `:has()` (CSS Warning) | Core graph settings rules in `styles.css` | Needs a replacement selector and an in-app test |

Known CSS issue: in the compatibility viewer, `.tag-ontology-view { overflow: hidden }` loses to Obsidian's more specific `.workspace-leaf-content .view-content { overflow: auto }`. Move it to the `[data-type="tag-ontology"]` selector like `padding: 0`.
