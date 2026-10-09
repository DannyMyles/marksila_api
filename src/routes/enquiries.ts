import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { optionalAuth } from '../middleware/userAuth';
import { tenantOf } from '../middleware/tenant';
import { ApiError } from '../middleware/errorHandler';
import { publicWriteLimiter } from '../middleware/rateLimiters';
import { parseId } from '../utils/validation';
import { deliverEmail, deliveryMessage, enquiryUpdateEmail } from '../mailer';
import { chatWhatsApp } from '../services/whatsapp';
import { createEnquiry, enquiryInputSchema, serializeEnquiryAdmin, serializeEnquiryPublic } from '../services/enquiries';

/**
 * Enquiries: contact messages, service bookings, corporate bookings and
 * quotation requests. Public POST saves the request (nothing is confirmed)
 * and returns a WhatsApp link; admins follow up and move the status along.
 */
export const enquiriesRouter = Router();

const STATUSES = ['new', 'contacted', 'quoted', 'confirmed', 'completed', 'cancelled'] as const;
const TYPES = ['contact', 'booking', 'corporate', 'quote'] as const;

/**
 * @openapi
 * /api/v1/enquiries:
 *   post:
 *     summary: Send an enquiry, service booking, corporate booking or quote request (public). Returns a reference and a WhatsApp link.
 *     tags: [Enquiries]
 */
enquiriesRouter.post('/', publicWriteLimiter, optionalAuth, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = enquiryInputSchema.parse(req.body);
    const { enquiry, whatsapp, duplicate } = await createEnquiry(tenant, input, req.user?.id);
    res.status(duplicate ? 200 : 201).json({
      enquiry: serializeEnquiryPublic(enquiry),
      whatsapp,
      duplicate,
      message:
        enquiry.type === 'contact'
          ? 'Thanks — your message has been sent. We will get back to you shortly.'
          : 'Thanks — your request has been received. It is not confirmed yet: we will contact you to confirm.',
    });
  } catch (err) {
    next(err);
  }
});

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  type: z.enum(TYPES).optional(),
  serviceId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(['newest', 'oldest', 'preferredDate']).default('newest'),
});

/**
 * @openapi
 * /api/v1/enquiries:
 *   get:
 *     summary: List this app's enquiries with search, filters and pagination (admin)
 *     tags: [Enquiries]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
enquiriesRouter.get('/', requireAdminKey, async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const query = listSchema.parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    const where: Prisma.EnquiryWhereInput = {
      appId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.serviceId ? { trainingId: query.serviceId } : {}),
      ...(query.q
        ? {
            OR: [
              { reference: { contains: query.q } },
              { name: { contains: query.q } },
              { phone: { contains: query.q } },
              { email: { contains: query.q } },
              { company: { contains: query.q } },
              { serviceName: { contains: query.q } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.EnquiryOrderByWithRelationInput =
      query.sort === 'oldest' ? { createdAt: 'asc' } : query.sort === 'preferredDate' ? { preferredDate: 'asc' } : { createdAt: 'desc' };

    const [total, rows, byStatus, byType] = await Promise.all([
      prisma.enquiry.count({ where }),
      prisma.enquiry.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { training: { select: { id: true, title: true, slug: true } } },
      }),
      prisma.enquiry.groupBy({ by: ['status'], where: { appId }, _count: { _all: true } }),
      prisma.enquiry.groupBy({ by: ['type'], where: { appId }, _count: { _all: true } }),
    ]);
    res.json({
      enquiries: rows.map(serializeEnquiryAdmin),
      total,
      page: query.page,
      pageSize: query.pageSize,
      statusCounts: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      typeCounts: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    });
  } catch (err) {
    next(err);
  }
});

enquiriesRouter.get('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const id = parseId(req.params.id);
    const enquiry = await prisma.enquiry.findFirst({
      where: { id, appId },
      include: { training: { select: { id: true, title: true, slug: true } } },
    });
    if (!enquiry) throw new ApiError(404, 'Enquiry not found');
    const emails = await prisma.emailLog.findMany({
      where: { appId, entityType: 'enquiry', entityId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, to: true, subject: true, status: true, error: true, createdAt: true, sentAt: true },
    });
    res.json({ enquiry: serializeEnquiryAdmin(enquiry), emails });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  adminNotes: z.string().trim().max(5000).nullable().optional(),
  quotedAmount: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  // Email the customer about this change (status / quote) with an optional note.
  notify: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
});

/**
 * @openapi
 * /api/v1/enquiries/{id}:
 *   patch:
 *     summary: Update status, quote or internal notes (admin). With notify=true the customer is emailed.
 *     tags: [Enquiries]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
enquiriesRouter.patch('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = updateSchema.parse(req.body);
    const id = parseId(req.params.id);
    const existing = await prisma.enquiry.findFirst({ where: { id, appId: tenant.id } });
    if (!existing) throw new ApiError(404, 'Enquiry not found');
    if (input.status === 'quoted' && !(input.quotedAmount ?? existing.quotedAmount)) {
      throw new ApiError(400, 'Enter the quoted amount before marking this as quoted.');
    }

    const enquiry = await prisma.enquiry.update({
      where: { id },
      data: { status: input.status, adminNotes: input.adminNotes, quotedAmount: input.quotedAmount },
      include: { training: { select: { id: true, title: true, slug: true } } },
    });

    let email: { status: string; message: string } | undefined;
    if (input.notify) {
      if (!enquiry.email) {
        email = { status: 'no_recipient', message: deliveryMessage('no_recipient', 'Customer email') };
      } else {
        const result = await deliverEmail({
          tenant,
          kind: 'enquiry_update',
          to: enquiry.email,
          template: enquiryUpdateEmail(enquiry, {
            note: input.note,
            whatsappUrl: chatWhatsApp(tenant, `Hello ${tenant.name}, about my request ${enquiry.reference}.`)?.url,
          }),
          entity: { type: 'enquiry', id: enquiry.id },
        });
        email = { status: result.status, message: deliveryMessage(result.status, 'Customer email') };
      }
    }
    res.json({ enquiry: serializeEnquiryAdmin(enquiry), email });
  } catch (err) {
    next(err);
  }
});

enquiriesRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const existing = await prisma.enquiry.findFirst({ where: { id, appId: tenantOf(req).id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'Enquiry not found');
    await prisma.enquiry.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
