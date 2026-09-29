# Integration smoke workflow

Pull request CI runs a Mailpit integration job with a pinned service image. It verifies SMTP acceptance and then checks Mailpit's REST API for the unique message, recipient, subject, and body. This does not contact a real mailbox. The separate `Provider integration smoke` workflow also runs weekly or manually and always sends one message to an isolated Mailpit service.

The workflow can also send controlled live messages through Resend or Amazon SES. To enable one, set the repository variable `TYPEDMAILER_INTEGRATION_PROVIDERS` to a comma-separated list such as `mailpit,resend` or `mailpit,ses`, then configure the following values:

| Provider   | Repository variables                                                                                   | Repository secrets                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Resend     | `TYPEDMAILER_SMOKE_FROM`, `TYPEDMAILER_SMOKE_TO`                                                       | `TYPEDMAILER_RESEND_API_KEY`                                                                    |
| Amazon SES | `TYPEDMAILER_SMOKE_FROM`, `TYPEDMAILER_SMOKE_TO`, `TYPEDMAILER_AWS_REGION`, `TYPEDMAILER_AWS_ROLE_ARN` | No long-lived AWS access key; configure the GitHub OIDC provider and a narrowly scoped IAM role |

For SES, the repository already has a `provider-smoke` GitHub environment limited to the `main` branch. Configure the AWS GitHub OIDC provider and a role with trust subject `repo:erolsenol/typedmailer:environment:provider-smoke`, then set `TYPEDMAILER_AWS_ROLE_ARN` to that role's ARN. Grant it only `ses:SendEmail` for the test identity. Use a verified sender and a mailbox reserved for automated tests. Enabling a provider sends a real email whenever the workflow runs. Remove that provider from the variable to stop live sends. The workflow never enables live providers implicitly.
