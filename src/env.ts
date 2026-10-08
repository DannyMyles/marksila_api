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
  // Comma-separated browser origins allowed to call the API directly. The
  // frontends normally go through their own same-origin /api proxy, so this
  // only matters for tools like Swagger UI or a frontend without a proxy.
  corsOrigins: (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  // SMTP is intentionally optional at startup — sendMail() fails at send-time
  // (logged, non-fatal) rather than crashing the server if unconfigured.
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  // Fallbacks for apps that don't set their own notificationEmail/frontendUrl.
  adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER || '',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  // YouTube video sync is optional — without a key the route returns an
  // empty list. The channel itself is per app (App.youtubeChannelHandle).
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',
};
