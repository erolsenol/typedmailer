# Support policy

## Runtime support

TypedMailer requires Node.js 22 or newer. CI tests Node.js 22 and 24; Node.js 26 runs as a non-blocking compatibility canary while it is Current. We support the latest patch release of each Node.js major that is in its official maintenance or active LTS period; end-of-life Node.js releases are unsupported even when they satisfy the package engine range.

Install the provider SDK required by your selected adapter. Provider SDKs are optional peer dependencies; see the [provider contracts](docs/provider-contracts.md) and README compatibility table.

## Versioning

TypedMailer follows Semantic Versioning for its public TypeScript API and documented runtime behavior:

- Patch: backward-compatible bug and security fixes.
- Minor: backward-compatible features and provider support.
- Major: breaking API, runtime requirement, or documented behavior changes.

A documented provider capability is part of the public contract. Changes to these guarantees require compatibility review, tests, and a changelog entry.

## Security and support

Report vulnerabilities through GitHub's private vulnerability reporting. For usage questions and reproducible bugs, use the repository's GitHub Issues. Include the TypedMailer version, Node.js version, provider and SDK version, and sanitized error fields. Never include credentials, recipient addresses, message content, or unreviewed provider error causes.
