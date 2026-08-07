import { Router } from 'express';
import path from 'path';
import QRCode from 'qrcode';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import { paymentProvider } from '../payments';
import { describeMpesaResult } from '../payments/mpesaResultCodes';
import { applyMpesaResultToRegistration } from '../payments/applyMpesaResult';
import { sendMail, eventTicketEmail, eventRegistrationAlertEmail } from '../mailer';
import { uploadEventImage, eventsUploadDir } from '../uploads';
import { env } from '../env';
import { parseId, urlOrPathSchema, phoneSchema } from '../utils/validation';
import { publicWriteLimiter } from '../middleware/rateLimiters';

export const eventsRouter = Router();

function generateTicketNumber(): string {
  const random = Math.random().toString(36).slice(2, 11).toUpperCase();
  return `EVT-${random}`;
}

function imageInfoFor(event: any) {
  const hasImage = Boolean(event.imageFilename || event.imageUrl);
  return {
    hasImage,
    type: event.imageFilename ? 'uploaded' : event.imageUrl ? 'external' : undefined,
    contentType: event.imageContentType ?? undefined,
    size: event.imageSize ?? undefined,
    url: hasImage ? `/api/v1/events/${event.id}/image` : '',
  };
}

function serializeEvent(event: any) {
  const confirmedCount = event._count?.registrations ?? 0;
  const imageInfo = imageInfoFor(event);
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    description: event.description,
    date: event.date,
    time: event.time,
    location: event.location,
    trainers: event.trainers ? JSON.parse(event.trainers) : [],
    image: imageInfo.url,
    imageInfo,
    price: event.price,
    maxSpots: event.maxSpots,
    spotsRemaining: Math.max(0, event.maxSpots - confirmedCount),
    popular: event.popular,
    published: event.published,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function serializeRegistration(reg: any) {
  return {
    id: reg.id,
    ticketNumber: reg.ticketNumber,
    attendeeName: reg.attendeeName,
    attendeePhone: reg.attendeePhone,
    attendeeEmail: reg.user?.email,
    status: reg.status,
    paymentRef: reg.paymentRef,
    checkedInAt: reg.checkedInAt,
    createdAt: reg.createdAt,
  };
}

const countActiveRegistrations = {
  _count: { select: { registrations: { where: { status: { not: 'cancelled' as const } } } } },
};

/**
 * @openapi
 * /api/v1/events:
 *   get:
 *     summary: List published events
 *     tags: [Events]
 */
eventsRouter.get('/', async (req, res, next) => {
  try {
    const { upcoming } = req.query as Record<string, string | undefined>;
    const where: any = { published: true };
    if (upcoming === 'true') {
      // `date` only ever stores a calendar date (midnight) — an event dated
      // "today" would incorrectly look already-passed once it's past
      // midnight if compared against the exact current instant instead of
      // the start of today.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      where.date = { gte: startOfToday };
    }

    const events = await prisma.event.findMany({
      where,
      include: countActiveRegistrations,
      orderBy: { date: 'asc' },
    });
    res.json({ events: events.map(serializeEvent) });
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
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.get('/:id/edit', requireAdminRole, async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: parseId(req.params.id) },
      include: countActiveRegistrations,
    });
    if (!event) throw new ApiError(404, 'Event not found');
    res.json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:id/image', async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: parseId(req.params.id) } });
    if (!event) throw new ApiError(404, 'Event not found');
    if (event.imageFilename) {
      return res.sendFile(path.join(eventsUploadDir, event.imageFilename));
    }
    if (event.imageUrl) {
      return res.redirect(302, event.imageUrl);
    }
    throw new ApiError(404, 'No image for this event');
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:slug', async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { slug: req.params.slug },
      include: countActiveRegistrations,
    });
    if (!event) throw new ApiError(404, 'Event not found');
    res.json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
});

const boolField = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const eventFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  date: z.string().min(1),
  time: z.string().min(1).max(50),
  location: z.string().trim().min(1).max(300),
  trainers: z.string().min(1), // JSON-encoded string[]
  imageUrl: urlOrPathSchema.optional(),
  price: z.coerce.number().int().min(0),
  maxSpots: z.coerce.number().int().positive(),
  popular: boolField,
  published: boolField,
});

function parseTrainers(raw: string): string[] {
  let trainers: unknown;
  try {
    trainers = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Invalid trainers format');
  }
  if (!Array.isArray(trainers) || trainers.length === 0 || !trainers.every((t) => typeof t === 'string')) {
    throw new ApiError(400, 'At least one trainer is required');
  }
  return trainers;
}

async function uniqueSlug(title: string, excludeId?: number): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  while (await prisma.event.findFirst({ where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) } })) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

/**
 * @openapi
 * /api/v1/events:
 *   post:
 *     summary: Create an event (admin)
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.post('/', requireAdminRole, uploadEventImage.single('image'), async (req, res, next) => {
  try {
    const input = eventFormSchema.parse(req.body);
    const slug = await uniqueSlug(input.title);
    const file = req.file;
    const trainers = parseTrainers(input.trainers);

    const event = await prisma.event.create({
      data: {
        title: input.title,
        slug,
        description: input.description,
        date: new Date(input.date),
        time: input.time,
        location: input.location,
        trainers: JSON.stringify(trainers),
        imageUrl: !file ? input.imageUrl : undefined,
        imageFilename: file?.filename,
        imageContentType: file?.mimetype,
        imageSize: file?.size,
        price: input.price,
        maxSpots: input.maxSpots,
        popular: input.popular ?? false,
        published: input.published ?? true,
      },
      include: countActiveRegistrations,
    });
    res.status(201).json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
});

const eventUpdateFormSchema = eventFormSchema.partial();

eventsRouter.put('/:id', requireAdminRole, uploadEventImage.single('image'), async (req, res, next) => {
  try {
    const input = eventUpdateFormSchema.parse(req.body);
    const id = parseId(req.params.id);
    const file = req.file;

    const data: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      time: input.time,
      location: input.location,
      price: input.price,
      maxSpots: input.maxSpots,
      popular: input.popular,
      published: input.published,
    };
    if (input.date) data.date = new Date(input.date);
    if (input.title) data.slug = await uniqueSlug(input.title, id);
    if (input.trainers) {
      data.trainers = JSON.stringify(parseTrainers(input.trainers));
    }
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

    const event = await prisma.event.update({ where: { id }, data, include: countActiveRegistrations });
    res.json({ event: serializeEvent(event) });
  } catch (err) {
    next(err);
  }
});

eventsRouter.delete('/:id', requireAdminRole, async (req, res, next) => {
  try {
    await prisma.event.delete({ where: { id: parseId(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/{id}/registrations:
 *   get:
 *     summary: List registrations for an event (admin)
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.get('/:id/registrations', requireAdminRole, async (req, res, next) => {
  try {
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId: parseId(req.params.id) },
      include: { user: { select: { email: true } } },
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
 *     summary: Check a ticket in at the door, by ticket number (scanned QR or typed) (admin)
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.post('/:id/registrations/checkin', requireAdminRole, async (req, res, next) => {
  try {
    const input = checkinSchema.parse(req.body);
    const eventId = parseId(req.params.id);

    const registration = await prisma.eventRegistration.findFirst({
      where: { ticketNumber: input.ticketNumber, eventId },
      include: { user: { select: { email: true } } },
    });
    if (!registration) {
      throw new ApiError(404, 'No ticket with that number was found for this event.');
    }

    if (registration.status === 'cancelled') {
      return res.json({ registration: serializeRegistration(registration), outcome: 'blocked_cancelled' });
    }
    if (registration.status === 'pending_payment') {
      return res.json({ registration: serializeRegistration(registration), outcome: 'blocked_unpaid' });
    }
    if (registration.checkedInAt) {
      return res.json({ registration: serializeRegistration(registration), outcome: 'already_checked_in' });
    }

    const updated = await prisma.eventRegistration.update({
      where: { id: registration.id },
      data: { checkedInAt: new Date() },
      include: { user: { select: { email: true } } },
    });
    res.json({ registration: serializeRegistration(updated), outcome: 'checked_in' });
  } catch (err) {
    next(err);
  }
});

const registerSchema = z.object({
  attendeeName: z.string().trim().min(1).max(100),
  attendeePhone: phoneSchema,
});

/**
 * @openapi
 * /api/v1/events/{slug}/register:
 *   post:
 *     summary: Register the logged-in user for an event
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.post('/:slug/register', requireAuth, publicWriteLimiter, async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);

    const event = await prisma.event.findUnique({
      where: { slug: req.params.slug },
      include: countActiveRegistrations,
    });
    if (!event || !event.published) throw new ApiError(404, 'Event not found');

    const spotsRemaining = event.maxSpots - (event._count?.registrations ?? 0);
    if (spotsRemaining <= 0) throw new ApiError(409, 'This event is fully booked.');

    const existing = await prisma.eventRegistration.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: req.user!.id } },
    });
    if (existing) throw new ApiError(409, 'You are already registered for this event.');

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new ApiError(404, 'User not found');

    const ticketNumber = generateTicketNumber();
    let paymentRef: string | undefined;
    let payment: { status: string; reference: string; message: string } | null = null;

    if (event.price > 0) {
      payment = await paymentProvider.initiate({
        orderNumber: ticketNumber,
        amount: event.price,
        phone: input.attendeePhone,
      });
      paymentRef = payment.reference;
    }

    const registration = await prisma.eventRegistration.create({
      data: {
        ticketNumber,
        eventId: event.id,
        userId: user.id,
        attendeeName: input.attendeeName,
        attendeePhone: input.attendeePhone,
        status: event.price > 0 ? 'pending_payment' : 'confirmed',
        paymentRef,
      },
    });

    // Ticket email is a side effect of an already-persisted registration —
    // never let a slow/failed send affect the registration response.
    (async () => {
      try {
        const qrBuffer = await QRCode.toBuffer(ticketNumber, { width: 400 });
        const { subject, html } = eventTicketEmail({
          ticketNumber,
          attendeeName: input.attendeeName,
          eventTitle: event.title,
          date: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
          time: event.time,
          location: event.location,
          price: event.price,
        });
        await sendMail({
          to: user.email,
          subject,
          html,
          attachments: [{ filename: 'ticket-qr.png', content: qrBuffer, cid: 'qr-ticket' }],
        });
      } catch (err) {
        console.error(`[events] Failed to send ticket email for ${ticketNumber}:`, err);
      }
    })();

    // Admin alert — same non-blocking side-effect treatment as the ticket email above.
    (async () => {
      try {
        const { subject, html } = eventRegistrationAlertEmail({
          ticketNumber,
          eventTitle: event.title,
          attendeeName: input.attendeeName,
          attendeePhone: input.attendeePhone,
          attendeeEmail: user.email,
          price: event.price,
        });
        await sendMail({ to: env.adminNotificationEmail, subject, html });
      } catch (err) {
        console.error(`[events] Failed to send admin alert for ${ticketNumber}:`, err);
      }
    })();

    res.status(201).json({ registration: serializeRegistration({ ...registration, user }), payment });
  } catch (err) {
    next(err);
  }
});

function serializeMyRegistration(reg: any) {
  return {
    id: reg.id,
    ticketNumber: reg.ticketNumber,
    attendeeName: reg.attendeeName,
    attendeePhone: reg.attendeePhone,
    status: reg.status,
    paymentRef: reg.paymentRef,
    createdAt: reg.createdAt,
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
  };
}

/**
 * @openapi
 * /api/v1/events/registrations/mine:
 *   get:
 *     summary: List the logged-in user's own event registrations/tickets
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.get('/registrations/mine', requireAuth, async (req, res, next) => {
  try {
    const registrations = await prisma.eventRegistration.findMany({
      where: { userId: req.user!.id },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ registrations: registrations.map(serializeMyRegistration) });
  } catch (err) {
    next(err);
  }
});

const registrationStatusSchema = z.object({
  status: z.enum(['pending_payment', 'confirmed', 'cancelled']),
});

/**
 * @openapi
 * /api/v1/events/registrations/{id}/status:
 *   patch:
 *     summary: Update a registration's status (admin)
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.patch('/registrations/:id/status', requireAdminRole, async (req, res, next) => {
  try {
    const input = registrationStatusSchema.parse(req.body);
    const registration = await prisma.eventRegistration.update({
      where: { id: parseId(req.params.id) },
      data: { status: input.status },
      include: { user: { select: { email: true } } },
    });
    res.json({ registration: serializeRegistration(registration) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/registrations/{id}/status:
 *   get:
 *     summary: Get the status of the logged-in user's own registration (for payment polling)
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.get('/registrations/:id/status', requireAuth, async (req, res, next) => {
  try {
    let registration = await prisma.eventRegistration.findUnique({ where: { id: parseId(req.params.id) } });
    if (!registration) throw new ApiError(404, 'Registration not found');
    if (registration.userId !== req.user!.id) throw new ApiError(403, 'Not your registration');

    // Fallback for a callback that hasn't (or, on localhost, can't) land —
    // actively ask Safaricom on every poll while still pending payment.
    if (registration.status === 'pending_payment' && registration.paymentRef && paymentProvider.queryStatus) {
      const result = await paymentProvider.queryStatus(registration.paymentRef);
      if (result) {
        registration = await applyMpesaResultToRegistration(registration, result);
      }
    }

    // No TicketStatus value represents "failed" (only pending_payment stays
    // put after a decline, so the customer can retry) — a stored, non-zero
    // result code is the real signal that a specific attempt already failed.
    const paymentFailed = registration.paymentResultCode !== null && registration.paymentResultCode !== 0;
    res.json({
      status: registration.status,
      paymentFailed,
      paymentFailureReason: paymentFailed
        ? describeMpesaResult(registration.paymentResultCode!, registration.paymentResultDesc ?? '')
        : undefined,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/events/registrations/{id}/retry-payment:
 *   post:
 *     summary: Re-initiate M-Pesa payment for a registration whose STK push failed, was cancelled, or timed out
 *     tags: [Events]
 *     security: [{ BearerAuth: [] }]
 */
eventsRouter.post('/registrations/:id/retry-payment', requireAuth, publicWriteLimiter, async (req, res, next) => {
  try {
    const registration = await prisma.eventRegistration.findUnique({
      where: { id: parseId(req.params.id) },
      include: { event: true },
    });
    if (!registration) throw new ApiError(404, 'Registration not found');
    if (registration.userId !== req.user!.id) throw new ApiError(403, 'Not your registration');
    if (registration.status !== 'pending_payment') {
      throw new ApiError(409, 'This registration does not have a pending payment');
    }

    const payment = await paymentProvider.initiate({
      orderNumber: registration.ticketNumber,
      amount: registration.event.price,
      phone: registration.attendeePhone,
    });

    const updated = await prisma.eventRegistration.update({
      where: { id: registration.id },
      // Clear the previous attempt's result so the old failure reason
      // doesn't linger on screen while this fresh STK push is in flight.
      data: { paymentRef: payment.reference, paymentResultCode: null, paymentResultDesc: null },
      include: { user: { select: { email: true } } },
    });
    res.json({ registration: serializeRegistration(updated), payment });
  } catch (err) {
    next(err);
  }
});
