import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { Tenant, invalidateTenantCache, tenantOf } from '../middleware/tenant';
import { requireAdminKey } from '../middleware/adminAuth';
import { normalizeWhatsAppNumber } from '../services/whatsapp';
import { mergeSiteSettings, parseSiteSettings, siteSettingsSchema } from '../services/siteSettings';
import { deliverEmail, deliveryMessage, isEmailConfigured } from '../mailer';
import { phoneSchema } from '../utils/validation';

export const appInfoRouter = Router();

function publicInfo(t: Tenant) {
  return {
    key: t.key,
    name: t.name,
    tagline: t.tagline,
    whatsappNumber: t.whatsappNumber ? normalizeWhatsAppNumber(t.whatsappNumber) : null,
    contactEmail: t.contactEmail,
    contactPhone: t.contactPhone,
    location: t.location,
    settings: parseSiteSettings(t.settings),
  };
}

/**
 * @openapi
 * /api/v1/app:
 *   get:
 *     summary: Public business details and website content of the app identified by X-App-Key
 *     tags: [App]
 */
appInfoRouter.get('/', (req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  res.json(publicInfo(tenantOf(req)));
});

/**
 * @openapi
 * /api/v1/app/admin:
 *   get:
 *     summary: Everything the admin Settings screen edits, plus email status (admin)
 *     tags: [App]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
appInfoRouter.get('/admin', requireAdminKey, async (req, res, next) => {
  try {
    const app = await prisma.app.findUniqueOrThrow({ where: { id: tenantOf(req).id } });
    res.json({
      ...publicInfo(app),
      notificationEmail: app.notificationEmail,
      frontendUrl: app.frontendUrl,
      youtubeChannelHandle: app.youtubeChannelHandle,
      orderPrefix: app.orderPrefix,
      bookingPrefix: app.bookingPrefix,
      enquiryPrefix: app.enquiryPrefix,
      emailConfigured: isEmailConfigured(app.key),
    });
  } catch (err) {
    next(err);
  }
});

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    tagline: nullableText(255),
    whatsappNumber: z
      .union([phoneSchema, z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? normalizeWhatsAppNumber(v) : null)),
    contactPhone: nullableText(40),
    contactEmail: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)),
    notificationEmail: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)),
    location: nullableText(200),
    frontendUrl: z
      .union([z.string().trim().url().max(255), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v.replace(/\/+$/, '') : null)),
    youtubeChannelHandle: nullableText(100),
    settings: siteSettingsSchema,
  })
  .partial();

/**
 * @openapi
 * /api/v1/app:
 *   put:
 *     summary: Update business details and website content (admin). `settings` sections are merged, not replaced.
 *     tags: [App]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
appInfoRouter.put('/', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const { settings, ...fields } = updateSchema.parse(req.body);
    const current = await prisma.app.findUniqueOrThrow({ where: { id: tenant.id } });
    const app = await prisma.app.update({
      where: { id: tenant.id },
      data: {
        ...fields,
        ...(settings ? { settings: JSON.stringify(mergeSiteSettings(parseSiteSettings(current.settings), settings)) } : {}),
      },
    });
    invalidateTenantCache();
    res.json({ ...publicInfo(app), notificationEmail: app.notificationEmail, frontendUrl: app.frontendUrl, message: 'Settings saved' });
  } catch (err) {
    next(err);
  }
});

const testEmailSchema = z.object({ to: z.string().trim().email() });

/**
 * @openapi
 * /api/v1/app/test-email:
 *   post:
 *     summary: Send a test email with this app's branding to check the email setup (admin)
 *     tags: [App]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
appInfoRouter.post('/test-email', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const { to } = testEmailSchema.parse(req.body);
    const result = await deliverEmail({
      tenant,
      kind: 'test',
      to,
      template: {
        subject: `Test email from ${tenant.name}`,
        content: {
          preheader: 'Your email settings are working.',
          eyebrow: 'Email check',
          title: 'Your emails are working',
          status: { label: 'Delivered', tone: 'success' },
          intro: [`This is a test email from the ${tenant.name} admin. If you can read it, customers will receive booking and enquiry emails too.`],
          audience: 'team',
        },
      },
    });
    res
      .status(result.status === 'sent' ? 200 : 502)
      .json({ status: result.status, message: result.status === 'sent' ? `Test email sent to ${to}.` : deliveryMessage(result.status, 'Test email'), error: result.error });
  } catch (err) {
    next(err);
  }
});
