import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { parseId } from '../utils/validation';
import { publicWriteLimiter } from '../middleware/rateLimiters';
import { sendMail, newsletterCampaignEmail, MailBrand } from '../mailer';
import { frontendUrlFor, mailBrandFor, tenantOf } from '../middleware/tenant';
import { assertOwned } from '../utils/tenantScope';
import { unsubscribeToken, verifyUnsubscribeToken } from '../utils/unsubscribeToken';
import { ApiError } from '../middleware/errorHandler';

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
    const appId = tenantOf(req).id;
    await prisma.newsletterSubscriber.upsert({
      where: { appId_email: { appId, email: input.email } },
      update: {},
      create: { appId, email: input.email },
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
newsletterRouter.get('/', requireAdminRole, async (req, res, next) => {
  try {
    const subscribers = await prisma.newsletterSubscriber.findMany({
      where: { appId: tenantOf(req).id },
      orderBy: { createdAt: 'desc' },
    });
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
    const id = parseId(req.params.id);
    await assertOwned(prisma.newsletterSubscriber, tenantOf(req).id, id, 'Subscriber');
    await prisma.newsletterSubscriber.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SEND_BATCH_SIZE = 20;
const SEND_BATCH_DELAY_MS = 2000;

async function sendCampaignInBackground(
  campaign: { subject: string; message: string; brand: MailBrand; frontendUrl: string; appKey: string },
  subscribers: { email: string }[]
) {
  const { subject, message, brand, frontendUrl, appKey } = campaign;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < subscribers.length; i += SEND_BATCH_SIZE) {
    const batch = subscribers.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((sub) => {
        const unsubscribeUrl = `${frontendUrl}/newsletter/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${unsubscribeToken(appKey, sub.email)}`;
        const { html } = newsletterCampaignEmail({ subject, message, unsubscribeUrl });
        return sendMail({ to: sub.email, subject, html, brand });
      })
    );
    sent += results.filter((r) => r.status === 'fulfilled').length;
    failed += results.filter((r) => r.status === 'rejected').length;
    if (i + SEND_BATCH_SIZE < subscribers.length) {
      await sleep(SEND_BATCH_DELAY_MS);
    }
  }
  console.log(`[newsletter] Campaign "${subject}" finished: ${sent} sent, ${failed} failed, ${subscribers.length} total.`);
}

const sendCampaignSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  message: z.string().trim().min(1).max(5000),
});

/**
 * @openapi
 * /api/v1/newsletter/send:
 *   post:
 *     summary: Send a one-off campaign email to every subscriber (admin)
 *     tags: [Newsletter]
 *     security: [{ BearerAuth: [] }]
 */
newsletterRouter.post('/send', requireAdminRole, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = sendCampaignSchema.parse(req.body);
    const subscribers = await prisma.newsletterSubscriber.findMany({ where: { appId: tenant.id }, select: { email: true } });
    if (subscribers.length === 0) {
      throw new ApiError(400, 'There are no subscribers to send to yet.');
    }

    // Batched + throttled to stay well under typical SMTP provider rate
    // limits and avoid looking like a spam burst — runs after the response
    // so the admin isn't stuck waiting on what could be a slow, long send.
    sendCampaignInBackground(
      {
        subject: input.subject,
        message: input.message,
        brand: mailBrandFor(tenant),
        frontendUrl: frontendUrlFor(tenant),
        appKey: tenant.key,
      },
      subscribers
    ).catch((err) =>
      console.error('[newsletter] Campaign send failed:', err)
    );

    res.status(202).json({ message: 'Campaign queued', recipientCount: subscribers.length });
  } catch (err) {
    next(err);
  }
});

const unsubscribeSchema = z.object({
  email: z.string().trim().email(),
  token: z.string().min(1),
});

/**
 * @openapi
 * /api/v1/newsletter/unsubscribe:
 *   get:
 *     summary: Unsubscribe an email using the signed link sent in campaign emails
 *     tags: [Newsletter]
 */
newsletterRouter.get('/unsubscribe', async (req, res, next) => {
  try {
    const input = unsubscribeSchema.parse(req.query);
    const tenant = tenantOf(req);
    if (!verifyUnsubscribeToken(tenant.key, input.email, input.token)) {
      throw new ApiError(400, 'This unsubscribe link is invalid.');
    }
    await prisma.newsletterSubscriber.deleteMany({ where: { appId: tenant.id, email: input.email } });
    res.json({ message: 'You have been unsubscribed.' });
  } catch (err) {
    next(err);
  }
});
