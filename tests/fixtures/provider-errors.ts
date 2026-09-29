/** Sanitized SDK-shaped errors; messages contain no credentials, recipients, or request data. */
export const providerErrorFixtures = {
  resendAuth: Object.assign(new Error('Authentication failed'), { statusCode: 401 }),
  brevoRateLimit: Object.assign(new Error('Rate limited'), { status: 429 }),
  postmarkAuth: Object.assign(new Error('Authentication failed'), { statusCode: 403 }),
  sendgridRateLimit: Object.assign(new Error('Rate limited'), { code: 429 }),
  mailgunUnavailable: Object.assign(new Error('Service unavailable'), { status: 503 }),
  sesThrottle: Object.assign(new Error('Request throttled'), {
    name: 'ThrottlingException',
    $metadata: { httpStatusCode: 400 },
  }),
  smtpRejected: Object.assign(new Error('Message rejected'), { responseCode: 550, code: 'EMESSAGE' }),
} as const;
