import crypto from 'crypto';
import { env } from '../env';

// HMAC of the (lowercased) email, keyed with the app's existing JWT secret —
// deterministic and stateless, so unsubscribe links need no new DB column
// or token-storage table; anyone with the token can only unsubscribe that
// one address, never enumerate or affect others.
export function unsubscribeToken(email: string): string {
  return crypto.createHmac('sha256', env.jwtSecret).update(email.trim().toLowerCase()).digest('hex');
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email));
  const actual = Buffer.from(token ?? '');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
