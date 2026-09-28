export type MailErrorCode = 'configuration' | 'authentication' | 'rate_limit' | 'network' | 'provider' | 'unsupported';

export class MailError extends Error {
  constructor(
    message: string,
    readonly code: MailErrorCode,
    readonly provider: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MailError';
  }
}

export function normalizeProviderError(error: unknown, provider: string): MailError {
  if (error instanceof MailError) return error;

  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const status =
    typeof candidate?.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate?.status === 'number'
        ? candidate.status
        : typeof candidate?.code === 'number'
          ? candidate.code
          : typeof (error as { responseCode?: unknown } | null)?.responseCode === 'number'
            ? (error as { responseCode: number }).responseCode
            : typeof (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode ===
                'number'
              ? (error as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode
              : undefined;
  const code =
    typeof candidate?.code === 'string'
      ? candidate.code
      : typeof candidate?.name === 'string'
        ? candidate.name
        : undefined;
  const authenticationFailure =
    status === 401 ||
    status === 403 ||
    code === 'EAUTH' ||
    code === 'AccessDeniedException' ||
    code === 'UnrecognizedClientException' ||
    code === 'InvalidClientTokenId';
  const rateLimitFailure = status === 429 || code === 'ThrottlingException' || code === 'TooManyRequestsException';
  const safeMessage = authenticationFailure
    ? 'The email provider rejected the configured credentials.'
    : rateLimitFailure
      ? 'The email provider rate limit was reached.'
      : status !== undefined
        ? `The email provider request failed with status ${status}.`
        : code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ENOTFOUND'
          ? 'Could not connect to the email provider.'
          : 'The email provider could not accept the message.';

  const errorCode: MailErrorCode = authenticationFailure
    ? 'authentication'
    : rateLimitFailure
      ? 'rate_limit'
      : code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ENOTFOUND'
        ? 'network'
        : 'provider';
  const retryable =
    errorCode === 'network' ||
    errorCode === 'rate_limit' ||
    (provider !== 'smtp' && status !== undefined && status >= 500 && status < 600);
  return new MailError(safeMessage, errorCode, provider, retryable, { cause: error });
}
