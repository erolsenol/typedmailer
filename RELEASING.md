# Releasing TypedMailer

## First public release

TypedMailer `1.0.0` is published on npm as a public package. Subsequent releases use GitHub Actions trusted publishing and npm provenance.

Configure the npm package's Trusted Publisher for GitHub Actions with user `erolsenol`, repository `typedmailer`, and workflow filename `publish.yml`. npm documents the setup in [Trusted publishers](https://docs.npmjs.com/trusted-publishers/).

The publish workflow starts when a GitHub Release is published. It verifies the tag, package version, and changelog, runs the package checks and audit, then publishes with npm OIDC provenance. After publication it installs that exact version in an isolated project and requires npm's signature audit to find its provenance attestation. This gate fails if Trusted Publishing is not configured or provenance is missing. Version `1.0.0` predates this setup and has no provenance attestation. See [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

The active npm identity is `erol.senol`, so TypedMailer uses the unscoped package name `typedmailer`. The `@erolsenol` organization scope is not available to this npm account.

## Subsequent releases

1. Update `version` in `package.json` and the root package entry in `package-lock.json` together. Add a matching entry to `CHANGELOG.md`.
2. Run `RELEASE_TAG=vX.Y.Z npm run release:check`, `npm ci`, `npm run check`, `npm run security:audit`, and `npm pack --dry-run`.
3. Commit the release changes and push a `vX.Y.Z` tag for the same commit.
4. Publish a GitHub Release for that tag. The release workflow repeats package checks and publishes to npm using the configured trusted publisher.

Never put an npm write token in the repository or workflow secrets when trusted publishing is configured. npm package visibility is public; keep provider credentials and npm credentials out of package contents and Git history.
