import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  adminApiKey: required('ADMIN_API_KEY'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  // SMTP is intentionally optional at startup — sendMail() fails at send-time
  // (logged, non-fatal) rather than crashing the server if unconfigured.
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER || '',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  // M-Pesa (Daraja) is intentionally optional at startup — when unset, the
  // payment provider factory (src/payments/index.ts) falls back to the
  // simulated StubMpesaProvider instead of failing to boot.
  mpesaEnv: process.env.MPESA_ENV ?? 'sandbox',
  mpesaConsumerKey: process.env.MPESA_CONSUMER_KEY ?? '',
  mpesaConsumerSecret: process.env.MPESA_CONSUMER_SECRET ?? '',
  mpesaShortcode: process.env.MPESA_SHORTCODE ?? '',
  mpesaPasskey: process.env.MPESA_PASSKEY ?? '',
  mpesaCallbackUrl: process.env.MPESA_CALLBACK_URL ?? '',
  // YouTube video sync is intentionally optional at startup, same pattern as
  // M-Pesa above — src/services/youtube.ts checks this and the route
  // returns an empty list rather than failing if unset.
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',
  youtubeChannelHandle: process.env.YOUTUBE_CHANNEL_HANDLE ?? 'marksila254',
};
