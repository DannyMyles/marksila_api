import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';

/**
 * Parses a route param expected to be a positive integer id. Throws a clean
 * 400 instead of letting `NaN` reach Prisma and surface as an uncaught 500.
 */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'Invalid id');
  }
  return id;
}

// Reasonably permissive — allows optional leading +, digits, spaces and
// hyphens, 7-20 characters. Loose enough for international formats without
// letting through obvious garbage that would otherwise reach the payment
// provider or an outbound email untouched.
export const phoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^\+?[0-9\s-]{7,20}$/, 'Invalid phone number');

// For image fields that accept either a relative path already served by the
// frontend (e.g. "/images/012.jpeg", the convention used throughout the seed
// data and admin forms) or a full http(s) URL. Rejects anything else
// (`javascript:`, etc.) — these values can end up in `res.redirect()`.
export const urlOrPathSchema = z
  .string()
  .max(2048)
  .refine((v) => v.startsWith('/') || /^https?:\/\//i.test(v), {
    message: 'Must be a relative path (starting with /) or an http(s) URL',
  });

// Matches the password policy already established and validated as correct
// in the frontend's admin user-creation form: 8+ chars, at least one
// lowercase, uppercase, digit, and special character.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/\d/, 'Password must include a number')
  .regex(/[@$!%*?&]/, 'Password must include a special character (@$!%*?&)');
