import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { tenantOf } from './tenant';
import { requireAdminRole } from './userAuth';

export function hashAdminKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Server-to-server admin gate: the app's Next.js server forwards that app's
 * own admin key (never exposed to browsers). Keys are per app and stored
 * only as a sha256 hash, so one app's key can never act on another app's
 * data — it is checked against the tenant resolved for this request.
 */
function hasValidAdminKey(req: Request): boolean {
  const key = req.header('x-admin-key');
  const expected = tenantOf(req).adminKeyHash;
  if (!key || !expected) return false;
  const actual = Buffer.from(hashAdminKey(key), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

/**
 * Admin access for commerce routes: either the app's admin key (Next.js
 * server proxy) or a logged-in admin of this same app (JWT).
 */
export function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  if (hasValidAdminKey(req)) return next();
  if (req.header('authorization')) return requireAdminRole(req, res, next);
  return res.status(401).json({ error: 'Unauthorized' });
}
