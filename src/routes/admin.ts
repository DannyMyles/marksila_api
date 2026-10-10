import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { tenantOf } from '../middleware/tenant';
import { isEmailConfigured } from '../mailer';

/** Admin-only overviews that span several record types of one app. */
export const adminRouter = Router();
adminRouter.use(requireAdminKey);

const countBy = <K extends string>(rows: { _count: { _all: number } }[], key: K) =>
  Object.fromEntries(rows.map((r) => [(r as unknown as Record<K, string>)[key], r._count._all]));

/**
 * @openapi
 * /api/v1/admin/stats:
 *   get:
 *     summary: Dashboard summary for this app — bookings, enquiries, services, orders and email delivery (admin)
 *     tags: [Admin]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
adminRouter.get('/stats', async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [
      bookingStatus,
      bookingParticipants,
      bookings30,
      enquiryStatus,
      enquiryType,
      enquiries30,
      services,
      upcomingEvents,
      orderStatus,
      orderRevenue,
      emailStatus,
      users,
      subscribers,
      testimonials,
      recentBookings,
      recentEnquiries,
      nextEvents,
      failedEmails,
    ] = await Promise.all([
      prisma.eventRegistration.groupBy({ by: ['status'], where: { appId }, _count: { _all: true } }),
      prisma.eventRegistration.aggregate({ where: { appId, status: { in: ['confirmed', 'completed'] } }, _sum: { participants: true, total: true } }),
      prisma.eventRegistration.count({ where: { appId, createdAt: { gte: since30 } } }),
      prisma.enquiry.groupBy({ by: ['status'], where: { appId }, _count: { _all: true } }),
      prisma.enquiry.groupBy({ by: ['type'], where: { appId }, _count: { _all: true } }),
      prisma.enquiry.count({ where: { appId, createdAt: { gte: since30 } } }),
      prisma.training.groupBy({ by: ['audience'], where: { appId, published: true }, _count: { _all: true } }),
      prisma.event.count({ where: { appId, published: true, date: { gte: startOfToday } } }),
      prisma.order.groupBy({ by: ['status'], where: { appId }, _count: { _all: true } }),
      prisma.order.aggregate({ where: { appId, paymentStatus: 'paid' }, _sum: { total: true } }),
      prisma.emailLog.groupBy({ by: ['status'], where: { appId, createdAt: { gte: since30 } }, _count: { _all: true } }),
      prisma.user.count({ where: { appId } }),
      prisma.newsletterSubscriber.count({ where: { appId } }),
      prisma.testimonial.count({ where: { appId, isActive: true } }),
      prisma.eventRegistration.findMany({
        where: { appId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { event: { select: { id: true, title: true, date: true } } },
      }),
      prisma.enquiry.findMany({
        where: { appId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, reference: true, type: true, status: true, name: true, company: true, serviceName: true, participants: true, createdAt: true },
      }),
      prisma.event.findMany({
        where: { appId, published: true, date: { gte: startOfToday } },
        orderBy: { date: 'asc' },
        take: 5,
        select: { id: true, title: true, slug: true, date: true, time: true, maxSpots: true },
      }),
      prisma.emailLog.count({ where: { appId, status: 'failed', createdAt: { gte: since30 } } }),
    ]);

    const taken = nextEvents.length
      ? await prisma.eventRegistration.groupBy({
          by: ['eventId'],
          where: { eventId: { in: nextEvents.map((e) => e.id) }, status: { not: 'cancelled' } },
          _sum: { participants: true },
        })
      : [];
    const takenBy = new Map(taken.map((t) => [t.eventId, t._sum.participants ?? 0]));
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

    const bookingsByStatus = countBy(bookingStatus, 'status');
    const enquiriesByStatus = countBy(enquiryStatus, 'status');
    const enquiriesByType = countBy(enquiryType, 'type');
    const servicesByAudience = countBy(services, 'audience');
    const ordersByStatus = countBy(orderStatus, 'status');

    res.json({
      bookings: {
        total: sum(bookingsByStatus),
        byStatus: bookingsByStatus,
        last30Days: bookings30,
        confirmedParticipants: bookingParticipants._sum.participants ?? 0,
        confirmedValue: bookingParticipants._sum.total ?? 0,
      },
      enquiries: {
        total: sum(enquiriesByStatus),
        byStatus: enquiriesByStatus,
        byType: enquiriesByType,
        open: (enquiriesByStatus.new ?? 0) + (enquiriesByStatus.contacted ?? 0) + (enquiriesByStatus.quoted ?? 0),
        corporate: (enquiriesByType.corporate ?? 0) + (enquiriesByType.quote ?? 0),
        last30Days: enquiries30,
      },
      services: { total: sum(servicesByAudience), byAudience: servicesByAudience, upcomingEvents },
      orders: { total: sum(ordersByStatus), byStatus: ordersByStatus, paidRevenue: orderRevenue._sum.total ?? 0 },
      emails: { configured: isEmailConfigured(tenantOf(req).key), last30Days: countBy(emailStatus, 'status'), failed: failedEmails },
      audience: { users, subscribers, testimonials },
      recentBookings: recentBookings.map((b) => ({
        id: b.id,
        ticketNumber: b.ticketNumber,
        attendeeName: b.attendeeName,
        participants: b.participants,
        total: b.total,
        status: b.status,
        createdAt: b.createdAt,
        event: b.event,
      })),
      recentEnquiries,
      nextEvents: nextEvents.map((e) => ({ ...e, spotsTaken: takenBy.get(e.id) ?? 0 })),
    });
  } catch (err) {
    next(err);
  }
});

const emailListSchema = z.object({
  status: z.enum(['queued', 'sent', 'failed', 'skipped']).optional(),
  q: z.string().trim().max(100).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/**
 * @openapi
 * /api/v1/admin/emails:
 *   get:
 *     summary: Email delivery log for this app (admin)
 *     tags: [Admin]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
adminRouter.get('/emails', async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const query = emailListSchema.parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    const where: Prisma.EmailLogWhereInput = {
      appId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.q ? { OR: [{ to: { contains: query.q } }, { subject: { contains: query.q } }, { kind: { contains: query.q } }] } : {}),
    };
    const [total, emails] = await Promise.all([
      prisma.emailLog.count({ where }),
      prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, kind: true, to: true, subject: true, status: true, error: true, entityType: true, entityId: true, attempts: true, createdAt: true, sentAt: true },
      }),
    ]);
    res.json({ emails, total, page: query.page, pageSize: query.pageSize, configured: isEmailConfigured(tenantOf(req).key) });
  } catch (err) {
    next(err);
  }
});
