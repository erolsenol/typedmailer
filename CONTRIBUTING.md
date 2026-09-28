# Contributing

Issues and pull requests are welcome. For provider changes, describe capability differences and preserve the common API's predictable behavior.

Before opening a pull request:

1. Keep provider credentials and real recipient data out of commits and logs.
2. Run `npm run typecheck` and `npm run build`.
3. Update the README when public behavior or setup changes.
4. Update `CHANGELOG.md` for user-visible behavior or public API changes. Follow `RELEASING.md` for version and publication steps.

Changes that affect public types or provider behavior should include a concise migration note.
