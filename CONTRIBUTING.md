# Contributing to Tag Ontology

Thank you for your interest in contributing to **Tag Ontology**! Whether you are reporting a bug, proposing a feature, improving documentation, or submitting a pull request, your help is warmly welcomed.

Please read through this guide to get started. By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Reporting Issues

- **Bug Reports**: If you encounter unexpected behavior or errors, please open an issue using the [Bug Report Template](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues/new?template=bug_report.yml). Be sure to include your Obsidian version, operating system, and steps to reproduce.
- **Feature Requests**: Have an idea for improving Tag Ontology? Submit a [Feature Request](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues/new?template=feature_request.yml) explaining your use case and desired behavior.

---

## Development Setup

The repository is organized as an npm workspace containing the Obsidian plugin and the standalone `tag-ontology` library/CLI under `packages/tag-ontology/`.

### Requirements
- **Node.js**: `22.18.0` or later (uses native TypeScript type-stripping for tests).
- **npm**: `10` or later.

### Quick Start
```sh
# 1. Clone repository
git clone https://github.com/NamhyeonKo/obsidian-tag-ontology.git
cd obsidian-tag-ontology

# 2. Install dependencies
npm ci

# 3. Build both plugin and package
npm run build

# 4. Deploy build into the sample vault
npm run deploy -- "examples/sample-vault"
```

---

## Commit Guidelines

We follow the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification:

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding or correcting tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `chore`: Other changes that do not modify src or test files

### Examples
```text
feat(graph): add 3D fly-to navigation on node click
fix(vault): preserve existing data.json during deploy
docs: update installation and update instructions
```

---

## Verification Before Committing

Before creating a commit or submitting a pull request, ensure all checks pass cleanly:

```sh
# Run Obsidian community review linter rules
npm run lint

# Run unit tests
npm test

# Verify build succeeds
npm run build

# For changes to packages/tag-ontology, run the package verification:
npm run check:package
```

- `npm run lint` must report `0 errors`.
- If modifying `styles.css`, test across dark and light themes.

---

## Testing Inside Obsidian

Plugins are installed per vault. You can test your local changes in Obsidian using the included sample vault or your own testing vault:

```sh
# Build and deploy to sample vault
npm run build && npm run deploy -- "examples/sample-vault"

# Or deploy to an existing custom test vault
npm run deploy -- "/path/to/your/test-vault"
```

After deploying:
1. In Obsidian, open the Command Palette (`Cmd/Ctrl+P`) and execute:
   ```text
   Reload app without saving
   ```
   *(Or toggle the plugin off and on under **Settings → Community plugins**)*
2. In the Graph view settings (gear icon), verify that **Filters → Tags** is enabled.
3. Verify changes in both the core 2D Graph view and the 3D view.

---

## Pull Request Process

1. **Branch from `dev`**: All development branches should branch from and target `dev`. The `main` branch is reserved for tagged stable releases.
2. **Keep PRs focused**: Keep each pull request focused on a single logical change or feature.
3. **Run checks**: Verify that `npm run lint`, `npm test`, and `npm run build` pass before opening the PR.
4. **Fill out the template**: Describe the changes, how they were tested, and reference any relevant issue numbers.

---

## License Agreement

Tag Ontology is open source software licensed under the [MIT License](LICENSE).

By submitting a contribution (pull request, patch, code, or documentation), you agree that your contribution is provided under the terms of the project's MIT License without any additional terms or conditions.

---

## Maintainer Release Flow

1. Bump version on `dev`:
   ```sh
   npm version x.y.z --no-git-tag-version
   ```
2. Update `manifest.json` and `versions.json`.
3. Open and merge a PR from `dev` into `main`.
4. Tag the merge commit on `main` (`git tag x.y.z origin/main && git push origin x.y.z`).
5. GitHub Actions builds the release assets and publishes a draft release.
6. Verify assets with the community review scan and publish the release.
