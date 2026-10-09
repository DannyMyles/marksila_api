import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { optionalAuth } from '../middleware/userAuth';
import { tenantOf } from '../middleware/tenant';
import { parseId } from '../utils/validation';
import { assertOwned } from '../utils/tenantScope';

export const faqsRouter = Router();

const faqSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(5000),
  category: z
    .string()
    .trim()
    .max(60)
    .optional()
    .nullable()
    .transform((v) => v || null),
  order: z.coerce.number().int().min(0).max(10000).optional(),
  published: z.boolean().optional(),
});

/**
 * @openapi
 * /api/v1/faqs:
 *   get:
 *     summary: Published FAQs of this app (admins pass all=true to include hidden ones). Optional ?category=
 *     tags: [FAQs]
 */
faqsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const all = req.query.all === 'true' && req.user?.role === 'admin';
    const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
    const faqs = await prisma.faq.findMany({
      where: { appId: tenantOf(req).id, ...(all ? {} : { published: true }), ...(category ? { category } : {}) },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    res.json({ faqs });
  } catch (err) {
    next(err);
  }
});

faqsRouter.post('/', requireAdminKey, async (req, res, next) => {
  try {
    const input = faqSchema.parse(req.body);
    const faq = await prisma.faq.create({ data: { ...input, appId: tenantOf(req).id } });
    res.status(201).json({ faq });
  } catch (err) {
    next(err);
  }
});

faqsRouter.put('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwned(prisma.faq, tenantOf(req).id, id, 'FAQ');
    const faq = await prisma.faq.update({ where: { id }, data: faqSchema.partial().parse(req.body) });
    res.json({ faq });
  } catch (err) {
    next(err);
  }
});

faqsRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwned(prisma.faq, tenantOf(req).id, id, 'FAQ');
    await prisma.faq.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
