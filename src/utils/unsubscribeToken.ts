import crypto from 'crypto';
import { env } from '../env';

// HMAC of app key + (lowercased) email, keyed with the JWT secret —
// deterministic and stateless, so unsubscribe links need no token table.
// The app key is part of the MAC, so a Fitness link can't unsubscribe the
// same address from SOS (or vice versa).
//
// Note: links from emails sent before apps existed (MAC of the email only)
// no longer verify; those subscribers can unsubscribe from the next email.
export function unsubscribeToken(appKey: string, email: string): string {
  return crypto
    .createHmac('sha256', env.jwtSecret)
    .update(`${appKey}:${email.trim().toLowerCase()}`)
    .digest('hex');
}

export function verifyUnsubscribeToken(appKey: string, email: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(appKey, email));
  const actual = Buffer.from(token ?? '');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
