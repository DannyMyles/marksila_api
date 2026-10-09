import { z } from 'zod';
import { Enquiry, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ApiError } from '../middleware/errorHandler';
import { Tenant, adminUrlFor, frontendUrlFor, notificationEmailFor } from '../middleware/tenant';
import { phoneSchema } from '../utils/validation';
import { generateReference } from '../utils/reference';
import { deliverEmailInBackground, enquiryAlertEmail, enquiryReceivedEmail } from '../mailer';
import { enquiryWhatsApp } from './whatsapp';
import { parseSiteSettings } from './siteSettings';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const enquiryInputSchema = z
  .object({
    type: z.enum(['contact', 'booking', 'corporate', 'quote']).default('contact'),
    serviceId: z.coerce.number().int().positive().optional(),
    packageId: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(2, 'Please enter your name').max(100),
    phone: phoneSchema,
    email: z
      .string()
      .trim()
      .email('Please enter a valid email')
      .max(255)
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    company: optionalText(160),
    participants: z.coerce.number().int().min(1).max(10000).optional(),
    preferredDate: z
      .string()
      .optional()
      .transform((v) => (v ? new Date(v) : undefined))
      .refine((d) => !d || !Number.isNaN(d.getTime()), 'Invalid date'),
    location: optionalText(200),
    // Free-text service name (legacy contact form "service" dropdown).
    service: optionalText(200),
    message: optionalText(5000),
    requestId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'contact' && !v.message) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'Please enter a message' });
    }
    if (v.type === 'corporate' && !v.company) {
      ctx.addIssue({ code: 'custom', path: ['company'], message: 'Please enter your company or organisation' });
    }
    if ((v.type === 'corporate' || v.type === 'quote') && !v.email) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Please enter an email so we can send your quote' });
    }
    if (v.preferredDate) {
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      if (v.preferredDate < startOfToday) {
        ctx.addIssue({ code: 'custom', path: ['preferredDate'], message: 'Please choose a future date' });
      }
    }
  });

export type EnquiryInput = z.infer<typeof enquiryInputSchema>;

/** Public view of an enquiry (what the customer who sent it may see). */
export function serializeEnquiryPublic(e: Enquiry) {
  return {
    reference: e.reference,
    type: e.type,
    status: e.status,
    serviceName: e.serviceName,
    packageName: e.packageName,
    participants: e.participants,
    preferredDate: e.preferredDate,
    estimate: e.estimate,
    createdAt: e.createdAt,
  };
}

export function serializeEnquiryAdmin(e: Enquiry & { training?: { id: number; title: string; slug: string | null } | null }) {
  return {
    id: e.id,
    ...serializeEnquiryPublic(e),
    name: e.name,
    phone: e.phone,
    email: e.email,
    company: e.company,
    location: e.location,
    message: e.message,
    adminNotes: e.adminNotes,
    quotedAmount: e.quotedAmount,
    serviceId: e.trainingId,
    packageId: e.packageId,
    service: e.training ? { id: e.training.id, title: e.training.title, slug: e.training.slug } : null,
    updatedAt: e.updatedAt,
  };
}

function estimateFor(
  pricing: { pricingType: 'fixed' | 'per_person' | 'quote'; priceAmount: number | null },
  participants: number | undefined
): number | null {
  if (!pricing.priceAmount || pricing.pricingType === 'quote') return null;
  return pricing.pricingType === 'per_person' ? pricing.priceAmount * (participants ?? 1) : pricing.priceAmount;
}

/**
 * Validates an enquiry against this app's catalogue, saves it and sends the
 * acknowledgement + team alert emails in the background. Returns the saved
 * record and a WhatsApp hand-off link. Retries with the same requestId
 * return the original record without emailing again.
 */
export async function createEnquiry(tenant: Tenant, input: EnquiryInput, userId?: number) {
  if (input.requestId) {
    const previous = await prisma.enquiry.findUnique({
      where: { appId_requestId: { appId: tenant.id, requestId: input.requestId } },
    });
    if (previous) return { enquiry: previous, whatsapp: enquiryWhatsApp(tenant, previous), duplicate: true };
  }

  let type = input.type;
  let serviceName = input.service ?? null;
  let packageName: string | null = null;
  let estimate: number | null = null;
  let trainingId: number | undefined;
  let packageId: number | undefined;

  if (input.serviceId) {
    const service = await prisma.training.findFirst({
      where: { id: input.serviceId, appId: tenant.id, published: true },
      include: { packages: { where: { active: true } } },
    });
    if (!service) throw new ApiError(404, 'That service is no longer available.');
    if (!service.available) throw new ApiError(409, `${service.title} is not currently taking bookings — please contact us for alternatives.`);
    trainingId = service.id;
    serviceName = service.title;

    let pricing: { pricingType: 'fixed' | 'per_person' | 'quote'; priceAmount: number | null } = service;
    let min = service.minParticipants;
    let max = service.maxParticipants;
    if (input.packageId) {
      const pkg = service.packages.find((p) => p.id === input.packageId);
      if (!pkg) throw new ApiError(404, 'That package is no longer available.');
      packageId = pkg.id;
      packageName = pkg.name;
      pricing = pkg;
      min = pkg.minParticipants ?? min;
      max = pkg.maxParticipants ?? max;
    }

    if (input.participants && min && input.participants < min) {
      throw new ApiError(400, `${packageName ?? serviceName} needs at least ${min} participants.`);
    }
    if (input.participants && max && input.participants > max) {
      if (type === 'booking') {
        throw new ApiError(400, `${packageName ?? serviceName} takes up to ${max} participants — please request a quote for larger groups.`);
      }
    }

    if (pricing.pricingType === 'quote' && type === 'booking') type = 'quote';
    estimate = estimateFor(pricing, input.participants);

    // Large corporate groups are always priced by quotation.
    const threshold = parseSiteSettings(tenant.settings).corporate?.minGroupForQuote;
    if (type === 'corporate' && threshold && (input.participants ?? 0) >= threshold) estimate = null;
  }

  let enquiry: Enquiry | undefined;
  for (let attempt = 0; !enquiry; attempt++) {
    try {
      enquiry = await prisma.enquiry.create({
        data: {
          appId: tenant.id,
          reference: generateReference(tenant.enquiryPrefix),
          type,
          name: input.name,
          phone: input.phone,
          email: input.email,
          company: input.company,
          participants: input.participants,
          preferredDate: input.preferredDate,
          location: input.location,
          trainingId,
          packageId,
          serviceName,
          packageName,
          estimate,
          message: input.message,
          userId,
          requestId: input.requestId,
        },
      });
    } catch (err) {
      const dup = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!dup) throw err;
      // Same requestId submitted concurrently: return the winner.
      if (input.requestId) {
        const winner = await prisma.enquiry.findUnique({
          where: { appId_requestId: { appId: tenant.id, requestId: input.requestId } },
        });
        if (winner) return { enquiry: winner, whatsapp: enquiryWhatsApp(tenant, winner), duplicate: true };
      }
      if (attempt >= 4) throw err;
    }
  }

  const whatsapp = enquiryWhatsApp(tenant, enquiry);
  deliverEmailInBackground({
    tenant,
    kind: 'enquiry_received',
    to: enquiry.email,
    template: enquiryReceivedEmail(enquiry, { whatsappUrl: whatsapp?.url, siteUrl: frontendUrlFor(tenant) }),
    dedupeKey: `enquiry-received:${enquiry.id}`,
    entity: { type: 'enquiry', id: enquiry.id },
  });
  deliverEmailInBackground({
    tenant,
    kind: 'enquiry_alert',
    to: notificationEmailFor(tenant),
    template: enquiryAlertEmail(enquiry, adminUrlFor(tenant, `/enquiries?q=${encodeURIComponent(enquiry.reference)}`)),
    dedupeKey: `enquiry-alert:${enquiry.id}`,
    entity: { type: 'enquiry', id: enquiry.id },
    replyTo: enquiry.email ?? undefined,
  });

  return { enquiry, whatsapp, duplicate: false };
}
