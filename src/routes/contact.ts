import { Router } from 'express';
import { tenantOf } from '../middleware/tenant';
import { optionalAuth } from '../middleware/userAuth';
import { publicWriteLimiter } from '../middleware/rateLimiters';
import { createEnquiry, enquiryInputSchema } from '../services/enquiries';

export const contactRouter = Router();

/**
 * @openapi
 * /api/v1/contact:
 *   post:
 *     summary: Contact-page message. Saved as an enquiry (type contact) so it shows in the admin, then emailed to the team.
 *     tags: [Contact]
 */
contactRouter.post('/', publicWriteLimiter, optionalAuth, async (req, res, next) => {
  try {
    const input = enquiryInputSchema.parse({ ...req.body, type: 'contact' });
    const { enquiry, whatsapp } = await createEnquiry(tenantOf(req), input, req.user?.id);
    res.json({ message: 'Message sent', reference: enquiry.reference, whatsapp });
  } catch (err) {
    next(err);
  }
});
