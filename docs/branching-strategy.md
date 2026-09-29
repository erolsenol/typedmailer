# Branching and release strategy

TypedMailer uses `main` for published releases and `development` for integration. Keep `main` releasable; merge completed work into it through a pull request from `development`.

## Day-to-day changes

1. Start a short-lived branch from the latest `development` branch.
2. Name it `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, or `chore/<topic>`.
3. Run `npm run check` and `npm run security:audit`, then open a pull request targeting `development`.
4. Merge after required CI checks pass. Delete the work branch after it is merged.

Dependabot opens dependency update pull requests against `development`. Review and merge each update independently after CI passes. Keep updates that fail compatibility checks out of the integration branch until their dependency constraints are resolved.

## Release flow

1. Update the package version, lockfile, and dated changelog entry on `development`.
2. Open a pull request from `development` to `main` and wait for required checks.
3. Merge the pull request. Create the matching `vX.Y.Z` tag and GitHub Release from that `main` commit.
4. The published GitHub Release triggers the npm Trusted Publishing workflow. Verify its completion and npm provenance before announcing the release.
5. Merge `main` back into `development` if release-only changes were made on `main`.

CI runs on pushes to both long-lived branches and on pull requests. GitHub branch protection requires pull requests and the Node.js 22/24 package checks, provider peer-floor check, and supply-chain check before merging.
