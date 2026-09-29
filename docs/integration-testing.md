# Integration smoke workflow

The `Provider integration smoke` workflow runs weekly or manually. It is intentionally separate from pull request CI. It always sends one message to an isolated Mailpit service; this does not contact a real mailbox.

The workflow can also send controlled live messages through Resend or Amazon SES. To enable one, set the repository variable `TYPEDMAILER_INTEGRATION_PROVIDERS` to a comma-separated list such as `mailpit,resend` or `mailpit,ses`, then configure the following values:

| Provider   | Repository variables                                                       | Repository secrets                                                                                                                     |
| ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Resend     | `TYPEDMAILER_SMOKE_FROM`, `TYPEDMAILER_SMOKE_TO`                           | `TYPEDMAILER_RESEND_API_KEY`                                                                                                           |
| Amazon SES | `TYPEDMAILER_SMOKE_FROM`, `TYPEDMAILER_SMOKE_TO`, `TYPEDMAILER_AWS_REGION` | `TYPEDMAILER_AWS_ACCESS_KEY_ID`, `TYPEDMAILER_AWS_SECRET_ACCESS_KEY`; `TYPEDMAILER_AWS_SESSION_TOKEN` when using temporary credentials |

Use a verified sender and a mailbox reserved for automated tests. Enabling a provider sends a real email whenever the workflow runs. Remove that provider from the variable to stop live sends. The workflow never enables live providers implicitly.
