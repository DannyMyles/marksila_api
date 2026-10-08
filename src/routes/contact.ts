import { Router } from 'express';
import { z } from 'zod';
import { mailBrandFor, notificationEmailFor, tenantOf } from '../middleware/tenant';
import { ApiError } from '../middleware/errorHandler';
import { sendMail, contactNotificationEmail } from '../mailer';
import { phoneSchema } from '../utils/validation';
import { publicWriteLimiter } from '../middleware/rateLimiters';

export const contactRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  service: z.string().max(100).optional(),
  message: z.string().trim().min(1).max(5000),
});

/**
 * @openapi
 * /api/v1/contact:
 *   post:
 *     summary: Send a message from the public Contact page to the site owner
 *     tags: [Contact]
 */
contactRouter.post('/', publicWriteLimiter, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = contactSchema.parse(req.body);
    const { subject, html } = contactNotificationEmail({ ...input, email: input.email || undefined });

    try {
      await sendMail({
        to: notificationEmailFor(tenant),
        brand: mailBrandFor(tenant),
        subject,
        html,
        replyTo: input.email || undefined,
      });
    } catch (err) {
      console.error('[contact] Failed to send notification email:', err);
      throw new ApiError(503, 'Unable to send your message right now — please try WhatsApp or phone instead.');
    }

    res.json({ message: 'Message sent' });
  } catch (err) {
    next(err);
  }
});
