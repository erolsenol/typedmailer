export type MailErrorCode = 'configuration' | 'authentication' | 'rate_limit' | 'network' | 'provider' | 'unsupported';

export interface MailErrorOptions extends ErrorOptions {
  readonly deliveryUnknown?: boolean;
  /** HTTP or SMTP response status, when supplied by the SDK. */
  readonly status?: number;
  /** Provider retry delay in seconds. Does not authorize automatic retry. */
  readonly retryAfterSeconds?: number;
}

export class MailError extends Error {
  readonly deliveryUnknown: boolean;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

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
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
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
  const candidate = record(error);
  const status = responseStatus(error);
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
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    });
  }

  const candidate = record(error);
  const status = responseStatus(error);
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
  const retryAfterSeconds = retryAfter(error);
  return new MailError(safeMessage, errorCode, provider, retryable, {
    cause: error,
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    deliveryUnknown: operation === 'send' && mayHaveBeenAccepted(error, provider),
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function responseStatus(error: unknown): number | undefined {
  const candidate = record(error);
  const metadata = record(candidate.$metadata);
  const response = record(candidate.response);
  return [
    candidate.statusCode,
    candidate.status,
    candidate.code,
    candidate.responseCode,
    metadata.httpStatusCode,
    response.status,
  ].find(
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599,
  );
}

function retryAfter(error: unknown): number | undefined {
  const candidate = record(error);
  const response = record(candidate.response);
  const headers = response.headers ?? candidate.headers;
  const value =
    headers instanceof Headers
      ? headers.get('retry-after')
      : Object.entries(record(headers)).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' && typeof text !== 'number') return undefined;
  const seconds =
    typeof text === 'number' || /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : (Date.parse(text) - Date.now()) / 1_000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}
