# Contributing

Issues and pull requests are welcome. For provider changes, describe capability differences and preserve the common API's predictable behavior.

Before opening a pull request:

1. Keep provider credentials and real recipient data out of commits and logs.
2. Run `npm ci` after cloning to install dependencies and enable the Git hooks.
3. Run `npm run check` before opening a pull request. The pre-push hook runs this same full package check automatically.
4. Update the README when public behavior or setup changes.
5. Update `CHANGELOG.md` for user-visible behavior or public API changes. Follow `RELEASING.md` for version and publication steps.

The pre-commit hook checks staged TypeScript and documentation/configuration formatting, then runs the unit tests and a staged whitespace check. The pre-push hook runs lint, formatting, tests, typecheck, build, and an npm package dry run.

Changes that affect public types or provider behavior should include a concise migration note.
