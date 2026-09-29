# Releasing TypedMailer

## First public release

TypedMailer is published as a public npm package. Releases are published by GitHub Actions through npm Trusted Publishing and include npm provenance.

Configure the npm package's Trusted Publisher for GitHub Actions with user `erolsenol`, repository `typedmailer`, and workflow filename `publish.yml`. npm documents the setup in [Trusted publishers](https://docs.npmjs.com/trusted-publishers/).

The publish workflow starts when a GitHub Release is published. It installs the current npm CLI, verifies the release tag against `package.json` and the changelog, runs package checks and the dependency audit, then publishes with npm OIDC provenance. After publication it verifies the provenance attestation for that exact version. The original `1.0.0` release predates Trusted Publishing and has no provenance attestation. See [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

The active npm identity is `erol.senol`, so TypedMailer uses the unscoped package name `typedmailer`. The `@erolsenol` organization scope is not available to this npm account.

## Subsequent releases

Prepare version and changelog changes on `development`, then open a pull request from `development` to `main`. Merge only after required CI checks pass. Create the release tag and GitHub Release from the resulting `main` commit; do not publish from a work branch. See the [branching strategy](docs/branching-strategy.md).

Before each release:

1. Confirm npm Trusted Publishing is configured for package `typedmailer`, GitHub owner `erolsenol`, repository `typedmailer`, and workflow filename `publish.yml`. Do this before creating a GitHub Release because publishing the release starts the npm workflow.
2. Update `version` in `package.json` and the root package entry in `package-lock.json` together. Add a matching changelog section and confirm the documented APIs and examples match the package exports.
3. Run `npm ci`, `RELEASE_TAG=vX.Y.Z npm run release:check`, `npm run check`, `npm run security:audit`, and `npm pack --dry-run`. Confirm the Mailpit integration job passes in CI.
4. Commit the release changes and push a `vX.Y.Z` tag that points to that exact commit.
5. Publish a GitHub Release for the tag. The workflow repeats the preflight and package checks, publishes with npm OIDC, and verifies the published version's provenance attestation.
6. Confirm the workflow completed and npm signature audit reports provenance for that exact version before announcing it. If the publish workflow exhausts its registry propagation retries, run the `Verify published npm provenance` workflow with the same version; it checks the existing package and does not publish again. A GitHub Release or successful `npm publish` step alone is not provenance evidence.

Never put an npm write token in the repository or workflow secrets when trusted publishing is configured. npm package visibility is public; keep provider credentials and npm credentials out of package contents and Git history.
