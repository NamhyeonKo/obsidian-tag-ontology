# Releasing tag-ontology to npm

The package in `packages/tag-ontology` has an independent version and MIT license. The plugin's version, `manifest.json`, `versions.json` and numeric release tags do not change for a package release.

## Before publishing

1. Merge the reviewed release preparation into `dev`, after the Node 22.18.0/24 checks pass.
2. Confirm `npm run check:package` passes and inspect `npm publish --workspace tag-ontology --access public --dry-run`.
3. Configure npm authentication for `.github/workflows/publish-package.yml`. No token is stored in the repository.

Prefer [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) when it is configured for the package. Use these exact GitHub values:

- Organization/user: `NamhyeonKo`
- Repository: `obsidian-tag-ontology`
- Workflow filename: `publish-package.yml`
- Environment: leave empty (the workflow does not select a GitHub environment)
- Allow direct `npm publish` for this workflow.

The workflow runs on GitHub-hosted runners with `id-token: write` and npm 11.19.1. It requests provenance explicitly; npm also generates it automatically with trusted publishing. The package's repository URL identifies this public GitHub repository.

For a first publish without a configured trusted publisher, a maintainer can supply a short-lived [granular npm token](https://docs.npmjs.com/about-access-tokens/) that can publish this package. A stage-only token cannot run this workflow's direct `npm publish`. Configure the token in the repository's Actions secret `NPM_TOKEN`, for example from your own terminal:

```sh
gh secret set NPM_TOKEN --repo NamhyeonKo/obsidian-tag-ontology
```

The command prompts for the value. Do not put the token in a commit, command argument or chat. After a successful bootstrap publish, configure trusted publishing for the package, remove the repository secret and revoke the bootstrap token. Direct publishing with bypass-2FA tokens is being deprecated by npm; the token path is for bootstrapping, not a permanent alternative to OIDC.

## Publish a version

The package version and the root workspace dependency must agree. For version `0.1.0`, tag the reviewed `dev` commit:

```sh
git tag tag-ontology-0.1.0 <reviewed-dev-commit>
git push origin tag-ontology-0.1.0
```

The [publish workflow](../.github/workflows/publish-package.yml) runs the full checks on Node 22.18.0 and 24 before publishing. The publish job verifies the tag matches the package version, rebuilds, and runs `npm publish --workspace tag-ontology --access public --provenance`. The numeric-tag plugin release workflow does not run for this tag.

## Verify the registry result

```sh
npm view tag-ontology@0.1.0 version dist.integrity dist.attestations --json
npx --yes tag-ontology@0.1.0 --version
```

Install the registry version in a temporary directory and repeat the library imports and CLI checks from `scripts/check-package.mjs`. Confirm the package's npm page shows provenance from this repository. Update the package/root README release-status text only after the publish has succeeded.

If authentication fails, keep the tag at the same reviewed commit, correct the npm configuration and rerun the failed workflow. Do not create or overwrite a different source under the same version.
