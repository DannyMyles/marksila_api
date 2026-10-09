import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { optionalAuth, requireAuth } from '../middleware/userAuth';
import { requireAdminKey } from '../middleware/adminAuth';
import { Tenant, adminUrlFor, frontendUrlFor, notificationEmailFor, tenantOf } from '../middleware/tenant';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import {
  deliverEmail,
  deliverEmailInBackground,
  deliveryMessage,
  bookingReceivedEmail,
  bookingAlertEmail,
  bookingStatusEmail,
  bookingReminderEmail,
  BookingForEmail,
} from '../mailer';
import { uploadEventImage, uploadPath, removeUpload } from '../uploads';
import { parseId, urlOrPathSchema, phoneSchema } from '../utils/validation';
import { generateReference } from '../utils/reference';
import { assertOwned, uniqueSlugFor } from '../utils/tenantScope';
import { bookingWhatsApp, chatWhatsApp } from '../services/whatsapp';
import { publicWriteLimiter } from '../middleware/rateLimiters';

/**
 * Events double as bookable experiences: Fitness uses them for classes and
 * bootcamps, SOS for adventures/tours. Booking is one short form (name,
 * phone, how many people) — no account and no online payment. The booking
 * is saved as `pending`, the response carries a WhatsApp link with the
 * booking summary, and an admin confirms it once they've spoken.
 */
export const eventsRouter = Router();

const MAX_PARTICIPANTS = 20;
const EVENT_KINDS = ['event', 'adventure'] as const;

function imageInfoFor(event: { id: number; imageFilename: string | null; imageUrl: string | null; imageContentType?: string | null; imageSize?: number | null }) {
  const hasImage = Boolean(event.imageFilename || event.imageUrl);
  return {
    hasImage,
    type: event.imageFilename ? 'uploaded' : event.imageUrl ? 'external' : undefined,
    contentType: event.imageContentType ?? undefined,
    size: event.imageSize ?? undefined,
    url: hasImage ? `/api/v1/events/${event.id}/image` : '',
  };
}

type EventRow = Prisma.EventGetPayload<object>;

function serializeEvent(event: EventRow, spotsTaken: number) {
  const imageInfo = imageInfoFor(event);
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    description: event.description,
    date: event.date,
    time: event.time,
    location: event.location,
    kind: event.kind,
    trainers: event.trainers ? JSON.parse(event.trainers) : [],
    category: event.category,
    difficulty: event.difficulty,
    duration: event.duration,
    image: imageInfo.url,
    imageInfo,
    price: event.price,
    maxSpots: event.maxSpots,
    spotsRemaining: Math.max(0, event.maxSpots - spotsTaken),
    popular: event.popular,
    published: event.published,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

type RegistrationRow = Prisma.EventRegistrationGetPayload<object>;

function serializeRegistration(reg: RegistrationRow) {
  return {
    id: reg.id,
    ticketNumber: reg.ticketNumber,
    attendeeName: reg.attendeeName,
    attendeePhone: reg.attendeePhone,
    attendeeEmail: reg.attendeeEmail,
    participants: reg.participants,
    total: reg.total,
    notes: reg.notes,
    status: reg.status,
    checkedInAt: reg.checkedInAt,
    createdAt: reg.createdAt,
    updatedAt: reg.updatedAt,
  };
}

const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'] as const;

type EventForEmail = { title: string; date: Date; time: string; location: string; price: number };

function bookingForEmail(reg: RegistrationRow, event: EventForEmail): BookingForEmail {
  return { ...reg, event };
}

/** Customer email for a booking's current status (confirmed / cancelled / ...). */
function sendBookingStatusEmail(tenant: Tenant, reg: RegistrationRow, event: EventForEmail, dedupe: boolean) {
  return deliverEmail({
    tenant,
    kind: 'booking_status',
    to: reg.attendeeEmail,
    template: bookingStatusEmail(bookingForEmail(reg, event), {
      whatsappUrl: chatWhatsApp(tenant, `Hello ${tenant.name}, about my booking ${reg.ticketNumber}.`)?.url,
      siteUrl: frontendUrlFor(tenant),
    }),
    dedupeKey: dedupe ? `booking-status:${reg.id}:${reg.status}` : undefined,
    entity: { type: 'booking', id: reg.id },
  });
}

function sendBookingReceivedEmails(tenant: Tenant, reg: RegistrationRow, event: EventForEmail, whatsappUrl?: string) {
  const booking = bookingForEmail(reg, event);
  deliverEmailInBackground({
    tenant,
    kind: 'booking_received',
    to: reg.attendeeEmail,
    template: bookingReceivedEmail(booking, { whatsappUrl, withQr: true }),
    dedupeKey: `booking-received:${reg.id}`,
    entity: { type: 'booking', id: reg.id },
    // QR of the reference, for door check-in.
    attachments: async () => [
      { filename: 'ticket-qr.png', content: await QRCode.toBuffer(reg.ticketNumber, { width: 400, margin: 1 }), cid: 'qr-ticket' },
    ],
  });
  deliverEmailInBackground({
    tenant,
    kind: 'booking_alert',
    to: notificationEmailFor(tenant),
    template: bookingAlertEmail(booking, adminUrlFor(tenant, `/bookings?q=${encodeURIComponent(reg.ticketNumber)}`)),
    dedupeKey: `booking-alert:${reg.id}`,
    entity: { type: 'booking', id: reg.id },
    replyTo: reg.attendeeEmail ?? undefined,
  });
}

/** Spots taken per event = sum of participants over non-cancelled bookings. */
async function spotsTakenFor(eventIds: number[]): Promise<Map<number, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await prisma.eventRegistration.groupBy({
    by: ['eventId'],
    where: { eventId: { in: eventIds }, status: { not: 'cancelled' } },
    _sum: { participants: true },
  });
  return new Map(rows.map((r) => [r.eventId, r._sum.participants ?? 0]));
}

async function serializeEvents(events: EventRow[]) {
  const taken = await spotsTakenFor(events.map((e) => e.id));
  return events.map((e) => serializeEvent(e, taken.get(e.id) ?? 0));
}

/**
 * @openapi
 * /api/v1/events:
 *   get:
 *     summary: List this app's published events (admins can pass all=true to include drafts)
 *     tags: [Events]
 */
eventsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { upcoming, all, kind } = req.query as Record<string, string | undefined>;
    const where: Prisma.EventWhereInput = { appId: tenantOf(req).id };
    if (kind && EVENT_KINDS.includes(kind as (typeof EVENT_KINDS)[number])) where.kind = kind;
    if (!(all === 'true' && req.user?.role === 'admin')) where.published = true;
    if (upcoming === 'true') {
      // `date` stores a calendar date (midnight UTC) — compare against the
      // start of today so an event dated today still counts as upcoming.
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      where.date = { gte: startOfToday };
    }

    const events = await prisma.event.findMany({ where, orderBy: { date: 'asc' } });
    res.json({ events: await serializeEvents(events) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/registrations/mine:
 *   get:
 *     summary: List the logged-in user's own bookings
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.get('/registrations/mine', requireAuth, async (req, res, next) => {
  try {
    const registrations = await prisma.eventRegistration.findMany({
      where: { userId: req.user!.id, appId: tenantOf(req).id },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      registrations: registrations.map((reg) => ({
        ...serializeRegistration(reg),
        event: {
          id: reg.event.id,
          title: reg.event.title,
          slug: reg.event.slug,
          date: reg.event.date,
          time: reg.event.time,
          location: reg.event.location,
          price: reg.event.price,
          image: imageInfoFor(reg.event).url,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/registrations/all:
 *   get:
 *     summary: All of this app's bookings, newest first, with their event (admin dashboard). Optional ?status=pending|confirmed|cancelled
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
const registrationListSchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  eventId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['newest', 'oldest', 'eventDate']).default('newest'),
});

eventsRouter.get('/registrations/all', requireAdminKey, async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const query = registrationListSchema.parse(
      Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '' && v !== undefined))
    );
    const where: Prisma.EventRegistrationWhereInput = {
      appId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.q
        ? {
            OR: [
              { ticketNumber: { contains: query.q } },
              { attendeeName: { contains: query.q } },
              { attendeePhone: { contains: query.q } },
              { attendeeEmail: { contains: query.q } },
              { event: { title: { contains: query.q } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.EventRegistrationOrderByWithRelationInput =
      query.sort === 'oldest' ? { createdAt: 'asc' } : query.sort === 'eventDate' ? { event: { date: 'asc' } } : { createdAt: 'desc' };
    const [total, registrations, counts] = await Promise.all([
      prisma.eventRegistration.count({ where }),
      prisma.eventRegistration.findMany({
        where,
        include: { event: { select: { id: true, title: true, slug: true, date: true, time: true, location: true, price: true } } },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.eventRegistration.groupBy({ by: ['status'], where: { appId }, _count: { _all: true } }),
    ]);
    res.json({
      registrations: registrations.map((r) => ({ ...serializeRegistration(r), event: r.event })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  } catch (err) {
    next(err);
  }
});

const registrationStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES),
  notify: z.boolean().default(true),
});

/**
 * @openapi
 * /api/v1/events/registrations/{id}/status:
 *   patch:
 *     summary: Move a booking to pending / confirmed / completed / cancelled (admin). Emails the customer unless notify=false.
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.patch('/registrations/:id/status', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = registrationStatusSchema.parse(req.body);
    const id = parseId(req.params.id);
    const existing = await prisma.eventRegistration.findFirst({ where: { id, appId: tenant.id }, include: { event: true } });
    if (!existing) throw new ApiError(404, 'Booking not found');

    if (input.status !== 'cancelled' && existing.status === 'cancelled') {
      // Re-activating a cancelled booking takes spots again — make sure they exist.
      const taken = await prisma.eventRegistration.aggregate({
        where: { eventId: existing.eventId, status: { not: 'cancelled' } },
        _sum: { participants: true },
      });
      const remaining = existing.event.maxSpots - (taken._sum.participants ?? 0);
      if (existing.participants > remaining) {
        throw new ApiError(409, `Not enough spots left to restore this booking (${Math.max(0, remaining)} left).`);
      }
    }

    const registration = await prisma.eventRegistration.update({ where: { id }, data: { status: input.status } });
    let email: { status: string; message: string } | undefined;
    if (input.notify && input.status !== existing.status) {
      const result = await sendBookingStatusEmail(tenant, registration, existing.event, true);
      email = { status: result.status, message: deliveryMessage(result.status, 'Customer email') };
    }
    res.json({ registration: serializeRegistration(registration), email });
  } catch (err) {
    next(err);
  }
});

const notifySchema = z.object({ type: z.enum(['received', 'status', 'reminder']) });

/**
 * @openapi
 * /api/v1/events/registrations/{id}/notify:
 *   post:
 *     summary: (Re)send the booking-received, current-status or reminder email to the customer (admin)
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.post('/registrations/:id/notify', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const { type } = notifySchema.parse(req.body);
    const id = parseId(req.params.id);
    const reg = await prisma.eventRegistration.findFirst({ where: { id, appId: tenant.id }, include: { event: true } });
    if (!reg) throw new ApiError(404, 'Booking not found');
    if (!reg.attendeeEmail) throw new ApiError(400, 'This booking has no email address.');
    if (type === 'reminder' && reg.status === 'cancelled') throw new ApiError(409, 'This booking is cancelled.');

    const whatsappUrl = chatWhatsApp(tenant, `Hello ${tenant.name}, about my booking ${reg.ticketNumber}.`)?.url;
    const result =
      type === 'status'
        ? await sendBookingStatusEmail(tenant, reg, reg.event, false)
        : await deliverEmail({
            tenant,
            kind: type === 'reminder' ? 'booking_reminder' : 'booking_received',
            to: reg.attendeeEmail,
            template:
              type === 'reminder'
                ? bookingReminderEmail(bookingForEmail(reg, reg.event), { whatsappUrl })
                : bookingReceivedEmail(bookingForEmail(reg, reg.event), { whatsappUrl, withQr: true }),
            entity: { type: 'booking', id: reg.id },
            attachments:
              type === 'received'
                ? async () => [
                    { filename: 'ticket-qr.png', content: await QRCode.toBuffer(reg.ticketNumber, { width: 400, margin: 1 }), cid: 'qr-ticket' },
                  ]
                : undefined,
          });
    const label = type === 'reminder' ? 'Reminder' : type === 'status' ? 'Status email' : 'Booking email';
    res.status(result.status === 'sent' ? 200 : 502).json({ status: result.status, message: deliveryMessage(result.status, label) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/{id}/edit:
 *   get:
 *     summary: Get a single event by numeric id, regardless of published status (admin — for the edit form)
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.get('/:id/edit', requireAdminKey, async (req, res, next) => {
  try {
    const event = await prisma.event.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!event) throw new ApiError(404, 'Event not found');
    res.json({ event: (await serializeEvents([event]))[0] });
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:id/image', async (req, res, next) => {
  try {
    const event = await prisma.event.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!event) throw new ApiError(404, 'Event not found');
    if (event.imageFilename) {
      return res.sendFile(uploadPath(req, 'events', event.imageFilename));
    }
    if (event.imageUrl) {
      return res.redirect(302, event.imageUrl);
    }
    throw new ApiError(404, 'No image for this event');
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { appId_slug: { appId: tenantOf(req).id, slug: req.params.slug } },
    });
    if (!event || (!event.published && req.user?.role !== 'admin')) throw new ApiError(404, 'Event not found');
    res.json({ event: (await serializeEvents([event]))[0] });
  } catch (err) {
    next(err);
  }
});

const boolField = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const optionalLabel = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const eventFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  date: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date'),
  time: z.string().trim().min(1).max(50),
  location: z.string().trim().min(1).max(300),
  trainers: z.string().optional(), // JSON-encoded string[] (guides/trainers), may be empty
  imageUrl: urlOrPathSchema.optional(),
  price: z.coerce.number().int().min(0),
  maxSpots: z.coerce.number().int().positive(),
  kind: z.enum(EVENT_KINDS).optional(),
  category: optionalLabel(60),
  difficulty: optionalLabel(40),
  duration: optionalLabel(60),
  popular: boolField,
  published: boolField,
});

function parseTrainers(raw: string | undefined): string[] {
  if (!raw) return [];
  let trainers: unknown;
  try {
    trainers = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Invalid trainers format');
  }
  if (!Array.isArray(trainers) || !trainers.every((t) => typeof t === 'string')) {
    throw new ApiError(400, 'Invalid trainers format');
  }
  return trainers.map((t) => t.trim()).filter(Boolean);
}

const uniqueSlug = (appId: number, title: string, excludeId?: number) =>
  uniqueSlugFor(prisma.event, appId, slugify(title), excludeId);

/**
 * @openapi
 * /api/v1/events:
 *   post:
 *     summary: Create an event (admin)
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.post('/', requireAdminKey, uploadEventImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = eventFormSchema.parse(req.body);
    const file = req.file;

    const event = await prisma.event.create({
      data: {
        appId,
        title: input.title,
        slug: await uniqueSlug(appId, input.title),
        description: input.description,
        date: new Date(input.date),
        time: input.time,
        location: input.location,
        trainers: JSON.stringify(parseTrainers(input.trainers)),
        kind: input.kind ?? 'event',
        category: input.category,
        difficulty: input.difficulty,
        duration: input.duration,
        imageUrl: !file ? input.imageUrl : undefined,
        imageFilename: file?.filename,
        imageContentType: file?.mimetype,
        imageSize: file?.size,
        price: input.price,
        maxSpots: input.maxSpots,
        popular: input.popular ?? false,
        published: input.published ?? true,
      },
    });
    res.status(201).json({ event: serializeEvent(event, 0) });
  } catch (err) {
    removeUpload(req, 'events', req.file?.filename);
    next(err);
  }
});

const eventUpdateFormSchema = eventFormSchema.partial();

eventsRouter.put('/:id', requireAdminKey, uploadEventImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = eventUpdateFormSchema.parse(req.body);
    const id = parseId(req.params.id);
    const file = req.file;
    const existing = await prisma.event.findFirst({ where: { id, appId } });
    if (!existing) throw new ApiError(404, 'Event not found');

    const data: Prisma.EventUncheckedUpdateInput = {
      title: input.title,
      description: input.description,
      time: input.time,
      location: input.location,
      price: input.price,
      maxSpots: input.maxSpots,
      kind: input.kind,
      category: input.category,
      difficulty: input.difficulty,
      duration: input.duration,
      popular: input.popular,
      published: input.published,
    };
    if (input.date) data.date = new Date(input.date);
    if (input.title && input.title !== existing.title) data.slug = await uniqueSlug(appId, input.title, id);
    if (input.trainers !== undefined) data.trainers = JSON.stringify(parseTrainers(input.trainers));
    if (file) {
      data.imageFilename = file.filename;
      data.imageContentType = file.mimetype;
      data.imageSize = file.size;
      data.imageUrl = null;
    } else if (input.imageUrl) {
      data.imageUrl = input.imageUrl;
      data.imageFilename = null;
      data.imageContentType = null;
      data.imageSize = null;
    }

    const event = await prisma.event.update({ where: { id }, data });
    if (file || input.imageUrl) removeUpload(req, 'events', existing.imageFilename);
    res.json({ event: (await serializeEvents([event]))[0] });
  } catch (err) {
    removeUpload(req, 'events', req.file?.filename);
    next(err);
  }
});

eventsRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const event = await prisma.event.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!event) throw new ApiError(404, 'Event not found');
    await prisma.event.delete({ where: { id } });
    removeUpload(req, 'events', event.imageFilename);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/{id}/registrations:
 *   get:
 *     summary: List bookings for an event (admin)
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.get('/:id/registrations', requireAdminKey, async (req, res, next) => {
  try {
    const eventId = parseId(req.params.id);
    const appId = tenantOf(req).id;
    await assertOwned(prisma.event, appId, eventId, 'Event');
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId, appId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ registrations: registrations.map(serializeRegistration) });
  } catch (err) {
    next(err);
  }
});

const checkinSchema = z.object({
  ticketNumber: z.string().trim().min(1).max(50),
});

/**
 * @openapi
 * /api/v1/events/{id}/registrations/checkin:
 *   post:
 *     summary: Check a booking in at the door, by reference (scanned QR or typed) (admin)
 *     tags: [Events]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
eventsRouter.post('/:id/registrations/checkin', requireAdminKey, async (req, res, next) => {
  try {
    const input = checkinSchema.parse(req.body);
    const eventId = parseId(req.params.id);

    const registration = await prisma.eventRegistration.findFirst({
      where: { ticketNumber: input.ticketNumber.toUpperCase(), eventId, appId: tenantOf(req).id },
    });
    if (!registration) {
      throw new ApiError(404, 'No booking with that reference was found for this event.');
    }

    if (registration.status === 'cancelled') {
      return res.json({ registration: serializeRegistration(registration), outcome: 'blocked_cancelled' });
    }
    if (registration.status === 'pending') {
      return res.json({ registration: serializeRegistration(registration), outcome: 'blocked_unconfirmed' });
    }
    if (registration.checkedInAt) {
      return res.json({ registration: serializeRegistration(registration), outcome: 'already_checked_in' });
    }

    const updated = await prisma.eventRegistration.update({
      where: { id: registration.id },
      data: { checkedInAt: new Date() },
    });
    res.json({ registration: serializeRegistration(updated), outcome: 'checked_in' });
  } catch (err) {
    next(err);
  }
});

const registerSchema = z.object({
  attendeeName: z.string().trim().min(1).max(100),
  attendeePhone: phoneSchema,
  attendeeEmail: z.string().trim().email().max(255).optional().or(z.literal('')).transform((v) => v || undefined),
  participants: z.coerce.number().int().min(1).max(MAX_PARTICIPANTS).default(1),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || undefined),
  requestId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

/**
 * @openapi
 * /api/v1/events/{slug}/register:
 *   post:
 *     summary: Book an event (guest or logged in). Returns the booking plus a WhatsApp link with the booking summary.
 *     tags: [Events]
 */
eventsRouter.post('/:slug/register', publicWriteLimiter, optionalAuth, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = registerSchema.parse(req.body);
    const user = req.user
      ? await prisma.user.findFirst({ where: { id: req.user.id, appId: tenant.id } })
      : null;

    // A retried submission (double tap, flaky network) returns the original
    // booking — no second set of spots, no second round of emails.
    if (input.requestId) {
      const previous = await prisma.eventRegistration.findUnique({
        where: { appId_requestId: { appId: tenant.id, requestId: input.requestId } },
        include: { event: true },
      });
      if (previous) {
        return res.status(200).json({
          registration: serializeRegistration(previous),
          whatsapp: bookingWhatsApp(tenant, previous),
          duplicate: true,
        });
      }
    }

    const { registration, event } = await prisma.$transaction(async (tx) => {
      const found = await tx.event.findUnique({
        where: { appId_slug: { appId: tenant.id, slug: req.params.slug } },
      });
      if (!found || !found.published) throw new ApiError(404, 'Event not found');

      // Lock the event row so two people can't both take the last spots.
      await tx.$queryRaw`SELECT id FROM \`Event\` WHERE id = ${found.id} FOR UPDATE`;

      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      if (found.date < startOfToday) throw new ApiError(409, 'This event has already taken place.');

      const taken = await tx.eventRegistration.aggregate({
        where: { eventId: found.id, status: { not: 'cancelled' } },
        _sum: { participants: true },
      });
      const remaining = found.maxSpots - (taken._sum.participants ?? 0);
      if (remaining <= 0) throw new ApiError(409, 'This event is fully booked.');
      if (input.participants > remaining) {
        throw new ApiError(409, `Only ${remaining} ${remaining === 1 ? 'spot is' : 'spots are'} left for this event.`);
      }

      if (user) {
        const existing = await tx.eventRegistration.findFirst({
          where: { eventId: found.id, userId: user.id, status: { not: 'cancelled' } },
        });
        if (existing) throw new ApiError(409, `You've already booked this event (ref ${existing.ticketNumber}).`);
      }

      const created = await tx.eventRegistration.create({
        data: {
          appId: tenant.id,
          ticketNumber: generateReference(tenant.bookingPrefix),
          eventId: found.id,
          userId: user?.id,
          attendeeName: input.attendeeName,
          attendeePhone: input.attendeePhone,
          attendeeEmail: input.attendeeEmail ?? user?.email,
          participants: input.participants,
          notes: input.notes,
          total: found.price * input.participants,
          status: 'pending',
          requestId: input.requestId,
        },
      });
      return { registration: created, event: found };
    });

    const whatsapp = bookingWhatsApp(tenant, { ...registration, event });
    sendBookingReceivedEmails(tenant, registration, event, whatsapp?.url);

    res.status(201).json({ registration: serializeRegistration(registration), whatsapp });
  } catch (err) {
    next(err);
  }
});
