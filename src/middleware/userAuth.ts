import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env';
import { tenantOf } from './tenant';

export interface AuthedUser {
  id: number;
  email: string;
  role: 'user' | 'admin';
  appId: number;
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
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, app: user.appId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyUserToken(token: string): AuthedUser {
  const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  if (typeof decoded.app !== 'number') {
    // Tokens issued before apps existed carry no app claim — force a re-login.
    throw new Error('Token has no app claim');
  }
  return { id: Number(decoded.sub), email: decoded.email, role: decoded.role, appId: decoded.app };
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

/**
 * Verifies the token AND that it was issued by the app this request is for —
 * a Fitness login can never be used against SOS (or any other app).
 */
function userFor(req: Request, token: string): AuthedUser | null {
  try {
    const user = verifyUserToken(token);
    return user.appId === tenantOf(req).id ? user : null;
  } catch {
    return null;
  }
}

/** Requires a valid `Authorization: Bearer <jwt>` issued by this app. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = userFor(req, token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = user;
  next();
}

/**
 * Like requireAuth, but doesn't reject when the token is missing or invalid —
 * guests can still check out / book; a logged-in caller just gets the record
 * linked to their account.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (token) {
    req.user = userFor(req, token) ?? undefined;
  }
  next();
}

/** requireAuth + role === 'admin' (of this app). */
export function requireAdminRole(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}
