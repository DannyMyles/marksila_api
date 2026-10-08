import { Router } from 'express';
import { tenantOf } from '../middleware/tenant';
import { normalizeWhatsAppNumber } from '../services/whatsapp';

export const appInfoRouter = Router();

/**
 * @openapi
 * /api/v1/app:
 *   get:
 *     summary: Public details of the app identified by X-App-Key (name, WhatsApp, contact)
 *     tags: [App]
 */
appInfoRouter.get('/', (req, res) => {
  const t = tenantOf(req);
  res.json({
    key: t.key,
    name: t.name,
    whatsappNumber: t.whatsappNumber ? normalizeWhatsAppNumber(t.whatsappNumber) : null,
    contactEmail: t.contactEmail,
    contactPhone: t.contactPhone,
    location: t.location,
  });
});
