# Releasing TypedMailer

## First npm release

Bootstrap the first version from an authenticated npm CLI session so the package exists in the registry:

1. Confirm the package name is still available with `npm view typedmailer` and verify the publishing account with `npm whoami`.
2. Run `npm ci`, `npm run typecheck`, `npm run build`, and `npm pack --dry-run`.
3. Publish the initial `0.1.0` package publicly from that authenticated npm session with `npm publish --access public`; complete npm's interactive two-factor prompt if requested.
4. In npm package settings, add a GitHub Actions trusted publisher for user `erolsenol`, repository `typedmailer`, workflow `publish.yml`, and permit publishing from that publisher.
5. Do not create a GitHub Release for `v0.1.0`; it would trigger a second publish of the same version. Start automated npm releases with the next version using `.github/workflows/publish.yml` and npm OIDC provenance.

The active npm identity is `erol.senol`, so TypedMailer uses the unscoped package name `typedmailer`. The `@erolsenol` organization scope is not available to this npm account.

## Subsequent releases

1. Update `version` in `package.json` and the root package entry in `package-lock.json` together. Add a matching entry to `CHANGELOG.md`.
2. Run `npm ci`, `npm run typecheck`, `npm run build`, and `npm pack --dry-run`.
3. Commit the release changes and push a `vX.Y.Z` tag for the same commit.
4. Publish a GitHub Release for that tag. The release workflow repeats package checks and publishes to npm using the configured trusted publisher.

Never put an npm write token in the repository or workflow secrets when trusted publishing is configured. npm package visibility is public; keep provider credentials and npm credentials out of package contents and Git history.
