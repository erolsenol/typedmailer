export type MailErrorCode = 'configuration' | 'authentication' | 'rate_limit' | 'network' | 'provider' | 'unsupported';

export interface MailErrorOptions extends ErrorOptions {
  readonly deliveryUnknown?: boolean;
}

export class MailError extends Error {
  readonly deliveryUnknown: boolean;

  constructor(
    message: string,
    readonly code: MailErrorCode,
    readonly provider: string,
    readonly retryable: boolean,
    options?: MailErrorOptions,
  ) {
    super(message, options);
    this.name = 'MailError';
    this.deliveryUnknown = options?.deliveryUnknown ?? false;
  }
}

export type MailErrorOperation = 'send' | 'verify';

const networkErrorCodes = new Set([
  'ETIMEDOUT',
  'ECONNECTION',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ESOCKET',
]);
const ambiguousNetworkErrorCodes = new Set(['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'EPIPE', 'ESOCKET']);

function mayHaveBeenAccepted(error: unknown, provider: string): boolean {
  const candidate = error as { statusCode?: unknown; status?: unknown; code?: unknown; name?: unknown } | null;
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
  const code = typeof candidate?.code === 'string' ? candidate.code : candidate?.name;

  if (provider === 'smtp' && status !== undefined) return false;
  if (status === 429 || status === 401 || status === 403 || (status !== undefined && status >= 400 && status < 500)) {
    return false;
  }
  if (status !== undefined) return status >= 500 && status < 600;
  return typeof code === 'string' && ambiguousNetworkErrorCodes.has(code);
}

export function normalizeProviderError(
  error: unknown,
  provider: string,
  operation: MailErrorOperation = 'verify',
): MailError {
  if (error instanceof MailError) {
    const deliveryUnknown =
      operation === 'send' && (error.deliveryUnknown || mayHaveBeenAccepted(error.cause, provider));
    if (error.deliveryUnknown === deliveryUnknown) return error;
    return new MailError(error.message, error.code, error.provider, error.retryable, {
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
      deliveryUnknown,
    });
  }

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
        : typeof code === 'string' && networkErrorCodes.has(code)
          ? 'Could not connect to the email provider.'
          : 'The email provider could not accept the message.';

  const errorCode: MailErrorCode = authenticationFailure
    ? 'authentication'
    : rateLimitFailure
      ? 'rate_limit'
      : typeof code === 'string' && networkErrorCodes.has(code)
        ? 'network'
        : 'provider';
  const retryable =
    errorCode === 'network' ||
    errorCode === 'rate_limit' ||
    (provider !== 'smtp' && status !== undefined && status >= 500 && status < 600);
  return new MailError(safeMessage, errorCode, provider, retryable, {
    cause: error,
    deliveryUnknown: operation === 'send' && mayHaveBeenAccepted(error, provider),
  });
}
