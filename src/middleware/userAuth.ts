import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface AuthedUser {
  id: number;
  email: string;
  role: 'user' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function signUserToken(user: AuthedUser): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyUserToken(token: string): AuthedUser {
  const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  return { id: Number(decoded.sub), email: decoded.email, role: decoded.role };
}

/**
 * Requires a valid `Authorization: Bearer <jwt>` header for the logged-in
 * user (customer or admin) — distinct from `requireAdminKey`, which gates
 * Product/Category/Order admin routes with a static shared secret.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = verifyUserToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Like requireAuth, but doesn't reject when the token is missing or invalid —
 * just leaves req.user unset and continues. Lets a route stay usable by
 * guests while still capturing who the caller is when they happen to be
 * logged in (e.g. associating a guest-checkout-capable order with an
 * account when one is present).
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (token) {
    try {
      req.user = verifyUserToken(token);
    } catch {
      // invalid/expired token — proceed as anonymous rather than rejecting
    }
  }
  next();
}

/** requireAuth + role === 'admin'. Protects Blog/Testimonial/Training writes. */
export function requireAdminRole(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}
