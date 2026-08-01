import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../env';

/**
 * Interim admin gate for this milestone: the Next.js server forwards a shared
 * secret from a server-only env var. Browsers never see this key. Full
 * user-level RBAC (roles, per-admin JWTs) is planned for a later phase.
 */
export function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header('x-admin-key');
  const keyBuffer = Buffer.from(key ?? '', 'utf8');
  const expectedBuffer = Buffer.from(env.adminApiKey, 'utf8');
  const isValid =
    keyBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(keyBuffer, expectedBuffer);
  if (!isValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
