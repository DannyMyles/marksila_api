import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { parseId } from '../utils/validation';
import { publicWriteLimiter } from '../middleware/rateLimiters';

export const newsletterRouter = Router();

function serializeSubscriber(s: { id: number; email: string; createdAt: Date }) {
  return { id: String(s.id), email: s.email, createdAt: s.createdAt };
}

const subscribeSchema = z.object({
  email: z.string().trim().email().max(255),
});

/**
 * @openapi
 * /api/v1/newsletter/subscribe:
 *   post:
 *     summary: Subscribe an email to the newsletter
 *     tags: [Newsletter]
 */
newsletterRouter.post('/subscribe', publicWriteLimiter, async (req, res, next) => {
  try {
    const input = subscribeSchema.parse(req.body);
    // Re-subscribing with an already-known email is a silent success, not an
    // error — that's the standard newsletter UX and avoids leaking whether
    // an address is already on the list.
    await prisma.newsletterSubscriber.upsert({
      where: { email: input.email },
      update: {},
      create: { email: input.email },
    });
    res.status(201).json({ message: 'Subscribed' });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/newsletter:
 *   get:
 *     summary: List newsletter subscribers (admin)
 *     tags: [Newsletter]
 *     security: [{ BearerAuth: [] }]
 */
newsletterRouter.get('/', requireAdminRole, async (_req, res, next) => {
  try {
    const subscribers = await prisma.newsletterSubscriber.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ subscribers: subscribers.map(serializeSubscriber) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/newsletter/{id}:
 *   delete:
 *     summary: Remove a subscriber (admin)
 *     tags: [Newsletter]
 *     security: [{ BearerAuth: [] }]
 */
newsletterRouter.delete('/:id', requireAdminRole, async (req, res, next) => {
  try {
    await prisma.newsletterSubscriber.delete({ where: { id: parseId(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
