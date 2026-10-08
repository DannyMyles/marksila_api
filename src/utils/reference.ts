import crypto from 'crypto';

// Unambiguous alphabet (no 0/O/1/I) — references get read out over the
// phone and typed back from WhatsApp, so they must survive both.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. "MK254-7KQ2ZD" — `prefix` comes from the app (orderPrefix / bookingPrefix). */
export function generateReference(prefix: string, length = 6): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${prefix}-${s}`;
}
