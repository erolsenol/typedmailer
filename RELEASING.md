# Releasing TypedMailer

## First npm release

Bootstrap the first version from an authenticated npm CLI session so the package exists in the registry:

1. Confirm the package name is still available with `npm view typedmailer` and verify the publishing account with `npm whoami`.
2. Run `npm ci`, `npm run check`, `npm run security:audit`, and `npm pack --dry-run`.
3. Run `RELEASE_TAG=v1.0.0 npm run release:check`; the tag, `package.json`, and a matching `CHANGELOG.md` section must agree.
4. Publish the initial stable `1.0.0` package publicly from that authenticated npm session with `npm publish --access public`; complete npm's interactive two-factor prompt if requested.
5. Once the package exists, configure its npm Trusted Publisher for GitHub Actions, user `erolsenol`, repository `typedmailer`, workflow filename `publish.yml`, and allow direct publishing. npm documents the setup in [Trusted publishers](https://docs.npmjs.com/trusted-publishers/).
6. Do not create a GitHub Release for `v1.0.0`; it would trigger a second publish of the same version. For later releases, run the release preflight and CI before publishing the GitHub Release. The publish workflow repeats the tag/version/changelog guard, package checks, and audit before npm OIDC publishing. npm creates provenance automatically for trusted publishing from a public GitHub repository; see [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

The active npm identity is `erol.senol`, so TypedMailer uses the unscoped package name `typedmailer`. The `@erolsenol` organization scope is not available to this npm account.

## Subsequent releases

1. Update `version` in `package.json` and the root package entry in `package-lock.json` together. Add a matching entry to `CHANGELOG.md`.
2. Run `RELEASE_TAG=vX.Y.Z npm run release:check`, `npm ci`, `npm run check`, `npm run security:audit`, and `npm pack --dry-run`.
3. Commit the release changes and push a `vX.Y.Z` tag for the same commit.
4. Publish a GitHub Release for that tag. The release workflow repeats package checks and publishes to npm using the configured trusted publisher.

Never put an npm write token in the repository or workflow secrets when trusted publishing is configured. npm package visibility is public; keep provider credentials and npm credentials out of package contents and Git history.
