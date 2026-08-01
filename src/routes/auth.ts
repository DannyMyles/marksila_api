import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { env } from '../env';
import { ApiError } from '../middleware/errorHandler';
import { requireAuth, signUserToken, verifyUserToken } from '../middleware/userAuth';
import { sendMail, passwordResetEmail, verificationEmail } from '../mailer';
import { passwordSchema } from '../utils/validation';
import { authLimiter } from '../middleware/rateLimiters';

export const authRouter = Router();

function serializeUser(user: { id: number; name: string; username: string; email: string; role: string }) {
  return { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role };
}

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(255),
  password: passwordSchema,
});

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     summary: Create a new account
 *     tags: [Auth]
 */
authRouter.post('/register', authLimiter, async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
    });
    if (existing) throw new ApiError(409, 'An account with that email or username already exists');

    const passwordHash = await bcrypt.hash(input.password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const user = await prisma.user.create({
      data: {
        name: input.name,
        username: input.username,
        email: input.email,
        password: passwordHash,
        role: 'user',
        emailVerified: false,
        verifyToken,
        verifyTokenExpiry,
      },
    });

    const verifyUrl = `${env.frontendUrl}/verify-email?token=${verifyToken}`;
    const { subject, html } = verificationEmail(verifyUrl);
    sendMail({ to: user.email, subject, html }).catch((err) =>
      console.error(`[auth] Failed to send verification email to ${user.email}:`, err)
    );

    res.status(201).json({
      message: 'Account created. Check your email to verify your account before logging in.',
      user: serializeUser(user),
    });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     summary: Log in and receive a JWT
 *     tags: [Auth]
 */
authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw new ApiError(401, 'Invalid email or password');

    const valid = await bcrypt.compare(input.password, user.password);
    if (!valid) throw new ApiError(401, 'Invalid email or password');

    if (!user.isActive) throw new ApiError(403, 'This account has been deactivated');
    if (!user.emailVerified) {
      throw new ApiError(403, 'Please verify your email before logging in. Check your inbox for the verification link.');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const token = signUserToken({ id: user.id, email: user.email, role: user.role });

    res.json({ message: 'Login successful', user: { ...serializeUser(user), token } });
  } catch (err) {
    next(err);
  }
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Re-issue a token from a still-valid one (no separate refresh-token store in this milestone)
 *     tags: [Auth]
 */
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const input = refreshSchema.parse(req.body);
    const decoded = verifyUserToken(input.refreshToken);
    const token = signUserToken(decoded);
    res.json({ accessToken: token });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const GENERIC_FORGOT_PASSWORD_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

/**
 * @openapi
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Request a password reset email
 *     tags: [Auth]
 */
authRouter.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    // Always respond the same way whether or not the email matched a user —
    // avoids leaking which emails have accounts.
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpiry } });

      const resetUrl = `${env.frontendUrl}/reset-password?token=${resetToken}`;
      const { subject, html } = passwordResetEmail(resetUrl);
      sendMail({ to: user.email, subject, html }).catch((err) =>
        console.error(`[auth] Failed to send password reset email to ${user.email}:`, err)
      );
    }

    res.json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/auth/verify-reset-token/{token}:
 *   get:
 *     summary: Check whether a password reset token is still valid
 *     tags: [Auth]
 */
authRouter.get('/verify-reset-token/:token', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { resetToken: req.params.token } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new ApiError(400, 'This reset link is invalid or has expired');
    }
    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * @openapi
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset password using a valid reset token
 *     tags: [Auth]
 */
authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const input = resetPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { resetToken: input.token } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new ApiError(400, 'This reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

/**
 * @openapi
 * /api/v1/auth/verify-email:
 *   post:
 *     summary: Verify an account's email using the token sent at registration
 *     tags: [Auth]
 */
authRouter.post('/verify-email', async (req, res, next) => {
  try {
    const input = verifyEmailSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { verifyToken: input.token } });
    if (!user || !user.verifyTokenExpiry || user.verifyTokenExpiry < new Date()) {
      throw new ApiError(400, 'This verification link is invalid or has expired');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verifyToken: null, verifyTokenExpiry: null },
    });

    res.json({ message: 'Email verified — you can now log in' });
  } catch (err) {
    next(err);
  }
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

const GENERIC_RESEND_VERIFICATION_MESSAGE = 'If an account exists for that email and needs verifying, a new link has been sent.';

/**
 * @openapi
 * /api/v1/auth/resend-verification:
 *   post:
 *     summary: Resend the email verification link
 *     tags: [Auth]
 */
authRouter.post('/resend-verification', authLimiter, async (req, res, next) => {
  try {
    const input = resendVerificationSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    // Same anti-enumeration shape as /forgot-password — respond identically
    // whether or not the email matched an unverified account.
    if (user && !user.emailVerified) {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.user.update({ where: { id: user.id }, data: { verifyToken, verifyTokenExpiry } });

      const verifyUrl = `${env.frontendUrl}/verify-email?token=${verifyToken}`;
      const { subject, html } = verificationEmail(verifyUrl);
      sendMail({ to: user.email, subject, html }).catch((err) =>
        console.error(`[auth] Failed to resend verification email to ${user.email}:`, err)
      );
    }

    res.json({ message: GENERIC_RESEND_VERIFICATION_MESSAGE });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     summary: Get the current logged-in user
 *     tags: [Auth]
 *     security: [{ BearerAuth: [] }]
 */
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new ApiError(404, 'User not found');
    res.json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});
