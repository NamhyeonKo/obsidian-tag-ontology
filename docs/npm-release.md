# Releasing tag-ontology to npm

The package in `packages/tag-ontology` has an independent version and MIT license. The plugin's version, `manifest.json`, `versions.json` and numeric release tags do not change for a package release.

## Authentication

The package publishes through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). Since 0.1.1 the repository holds no npm token. The trusted publisher on npmjs.com has these values:

- Publisher: GitHub Actions
- Organization/user: `NamhyeonKo`
- Repository: `obsidian-tag-ontology`
- Workflow filename: `publish-package.yml`
- Environment: empty (the workflow does not select a GitHub environment)
- Allowed actions: `npm publish` (not `npm dist-tag`)

The workflow runs on GitHub-hosted runners with `id-token: write` and npm 11.19.1, and requests provenance explicitly. A version published this way shows `GitHub Actions <npm-oidc-no-reply@github.com>` as its publisher.

If the trusted publisher is ever removed, a new one must publish successfully within two days, or it expires. 0.1.0 was published once with a short-lived granular token in the Actions secret `NPM_TOKEN`, because a trusted publisher can only be configured for a package that exists. That secret and the token are gone. npm ends direct publishing with granular tokens in January 2027, so the token path isn't a fallback.

## Publish a version

1. On a branch from `dev`, set the new version in three places, then open the PR, review it and merge it into `dev` after the Node 22.18.0/24 checks pass:

   ```sh
   npm version X.Y.Z --workspace tag-ontology --no-git-tag-version
   # set "tag-ontology": "X.Y.Z" in the root package.json
   npm install --package-lock-only
   ```

   The package version, the root workspace dependency and `package-lock.json` must agree.
2. Before tagging, confirm `npm run check:package` passes and inspect `npm publish --workspace tag-ontology --access public --dry-run`.
3. Tag the merge commit on `dev` and push the tag:

   ```sh
   git tag tag-ontology-X.Y.Z <merge-commit>
   git push origin tag-ontology-X.Y.Z
   ```

The [publish workflow](../.github/workflows/publish-package.yml) runs the full checks on Node 22.18.0 and 24 before publishing. The publish job verifies the tag matches the package version, rebuilds, and runs `npm publish --workspace tag-ontology --access public --provenance`. The numeric-tag plugin release workflow does not run for this tag.

## Verify the registry result

```sh
npm view tag-ontology@X.Y.Z version _npmUser dist.integrity --json --prefer-online
npm install tag-ontology@X.Y.Z --prefer-online   # in an empty folder
npx --no-install tag-ontology --version
npm audit signatures
```

`--prefer-online` matters right after a release: npm's local cache may still hold the package metadata from before it, and an install then fails with `ETARGET`. `npm audit signatures` should report a verified attestation, the provenance statement from this repository's workflow. Repeat the library imports and CLI checks from `scripts/check-package.mjs` on the installed version.

npm shows the README from the published tarball, so README changes reach the npm page only with the next version.

If publishing fails, keep the tag at the same reviewed commit, correct the npm configuration and rerun the failed workflow. Do not create or overwrite a different source under the same version.

The registry also lists `0.0.0-stage`, an empty placeholder (`"stub": true`) that npm created when the package was first published. It isn't `latest` and nothing installs it.
