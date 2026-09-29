# Contributing

Issues and pull requests are welcome. For provider changes, describe capability differences and preserve the common API's predictable behavior.

Use the [branching and release strategy](docs/branching-strategy.md) for branch names, pull request targets, and release merges.

Before opening a pull request:

1. Keep provider credentials and real recipient data out of commits and logs.
2. Run `npm ci` after cloning to install dependencies and enable the Git hooks.
3. Run `npm run check` and `npm run security:audit` before opening a pull request. The pre-push hook runs the full package check automatically.
4. Update the README when public behavior or setup changes.
5. Update `CHANGELOG.md` for user-visible behavior or public API changes. Follow `RELEASING.md` for version and publication steps.

The CI package matrix runs the full `npm run check` gate on Node.js 22 and 24 using the lockfile's provider SDK versions. A separate floor job installs each provider's minimum supported SDK version and reruns typecheck, tests, and build. The packed-package smoke check installs the tarball with optional peers omitted, then compiles an external TypeScript consumer against every provider option and public result/error type, including webhook exports. This covers current and minimum SDK versions plus installation without provider SDKs. Node.js 26 runs as a non-blocking compatibility check.

The SES/SNS signature unit test generates a short-lived local certificate with the OpenSSL command line tool. Install OpenSSL to run the complete test suite locally.

The pre-commit hook checks staged TypeScript and documentation/configuration formatting, then runs the unit tests and a staged whitespace check. The pre-push hook runs lint, formatting, tests, typecheck, build, npm package contents, and the packed-consumer smoke test. CI and the publish workflow also run the npm dependency audit.

Changes that affect public types or provider behavior should include a concise migration note.
