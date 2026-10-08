import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { optionalAuth, requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { uploadTestimonialPhoto, uploadPath, removeUpload } from '../uploads';
import { tenantOf } from '../middleware/tenant';
import { parseId } from '../utils/validation';
import { assertOwned } from '../utils/tenantScope';
import { publicWriteLimiter } from '../middleware/rateLimiters';

export const testimonialsRouter = Router();

function photoInfoFor(t: any) {
  const hasPhoto = Boolean(t.photoFilename);
  return {
    hasPhoto,
    contentType: t.photoContentType ?? undefined,
    size: t.photoSize ?? undefined,
    url: hasPhoto ? `/api/v1/testimonials/${t.id}/photo` : '',
  };
}

function serializeTestimonial(t: any) {
  const photoInfo = photoInfoFor(t);
  return {
    id: String(t.id),
    name: t.name,
    role: t.role,
    company: t.company ?? undefined,
    content: t.content,
    rating: t.rating,
    image: t.image ?? '',
    avatarColor: t.avatarColor,
    achievement: t.achievement ?? undefined,
    photoUrl: photoInfo.url,
    photoInfo,
    featured: t.featured,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/**
 * @openapi
 * /api/v1/testimonials:
 *   get:
 *     summary: List all testimonials
 *     tags: [Testimonials]
 */
// Public visitors only see approved testimonials; admins also see pending
// public submissions (isActive=false) so they can review them.
testimonialsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const testimonials = await prisma.testimonial.findMany({
      where: { appId: tenantOf(req).id, ...(isAdmin ? {} : { isActive: true }) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ testimonials: testimonials.map(serializeTestimonial) });
  } catch (err) {
    next(err);
  }
});

testimonialsRouter.get('/:id/photo', async (req, res, next) => {
  try {
    const testimonial = await prisma.testimonial.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!testimonial) throw new ApiError(404, 'Testimonial not found');
    if (!testimonial.photoFilename) throw new ApiError(404, 'No photo for this testimonial');
    res.sendFile(uploadPath(req, 'testimonials', testimonial.photoFilename));
  } catch (err) {
    next(err);
  }
});

testimonialsRouter.get('/:id', async (req, res, next) => {
  try {
    const testimonial = await prisma.testimonial.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!testimonial) throw new ApiError(404, 'Testimonial not found');
    res.json({ testimonial: serializeTestimonial(testimonial) });
  } catch (err) {
    next(err);
  }
});

// Deterministic-but-varied avatar color for public submissions, which don't
// get to pick their own (that's an admin/curation control) — hashing the
// name keeps the same person's color stable across resubmissions.
const AVATAR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
function pickAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

const testimonialSubmitSchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(100),
  company: z.string().trim().max(100).optional(),
  content: z.string().min(20).max(500),
  rating: z.coerce.number().int().min(1).max(5),
});

/**
 * @openapi
 * /api/v1/testimonials/submit:
 *   post:
 *     summary: Publicly submit a testimonial (pending admin approval)
 *     tags: [Testimonials]
 */
testimonialsRouter.post('/submit', publicWriteLimiter, uploadTestimonialPhoto.single('photo'), async (req, res, next) => {
  try {
    const input = testimonialSubmitSchema.parse(req.body);
    const file = req.file;

    const testimonial = await prisma.testimonial.create({
      data: {
        appId: tenantOf(req).id,
        name: input.name,
        role: input.role,
        company: input.company,
        content: input.content,
        rating: input.rating,
        avatarColor: pickAvatarColor(input.name),
        featured: false,
        isActive: false,
        photoFilename: file?.filename,
        photoContentType: file?.mimetype,
        photoSize: file?.size,
      },
    });

    res.status(201).json({
      message: 'Thanks! Your testimonial has been submitted and is pending review.',
      testimonial: serializeTestimonial(testimonial),
    });
  } catch (err) {
    next(err);
  }
});

const boolField = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const testimonialFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(100),
  company: z.string().trim().max(100).optional(),
  content: z.string().min(20).max(500),
  rating: z.coerce.number().int().min(1).max(5),
  // Despite the name, this holds a short initials fallback (e.g. "JD"),
  // shown when no photo is uploaded — not a URL/path, so it must not use
  // urlOrPathSchema (that rejected every admin create/update until now).
  image: z.string().trim().max(10).optional(),
  avatarColor: z.string().min(1).max(50),
  achievement: z.string().trim().max(200).optional(),
  featured: boolField,
});

/**
 * @openapi
 * /api/v1/testimonials:
 *   post:
 *     summary: Create a testimonial (admin)
 *     tags: [Testimonials]
 *     security: [{ BearerAuth: [] }]
 */
testimonialsRouter.post('/', requireAdminRole, uploadTestimonialPhoto.single('photo'), async (req, res, next) => {
  try {
    const input = testimonialFormSchema.parse(req.body);
    const file = req.file;
    const testimonial = await prisma.testimonial.create({
      data: {
        appId: tenantOf(req).id,
        name: input.name,
        role: input.role,
        company: input.company,
        content: input.content,
        rating: input.rating,
        image: input.image,
        avatarColor: input.avatarColor,
        achievement: input.achievement,
        featured: input.featured ?? true,
        photoFilename: file?.filename,
        photoContentType: file?.mimetype,
        photoSize: file?.size,
      },
    });
    res.status(201).json({ testimonial: serializeTestimonial(testimonial) });
  } catch (err) {
    next(err);
  }
});

const testimonialUpdateFormSchema = testimonialFormSchema.partial();

testimonialsRouter.put('/:id', requireAdminRole, uploadTestimonialPhoto.single('photo'), async (req, res, next) => {
  try {
    const input = testimonialUpdateFormSchema.parse(req.body);
    const id = parseId(req.params.id);
    const file = req.file;
    const existing = await prisma.testimonial.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!existing) {
      removeUpload(req, 'testimonials', file?.filename);
      throw new ApiError(404, 'Testimonial not found');
    }

    const data: Record<string, unknown> = { ...input };
    if (file) {
      removeUpload(req, 'testimonials', existing.photoFilename);
      data.photoFilename = file.filename;
      data.photoContentType = file.mimetype;
      data.photoSize = file.size;
    }

    const testimonial = await prisma.testimonial.update({ where: { id }, data });
    res.json({ testimonial: serializeTestimonial(testimonial) });
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({ isActive: z.boolean() });

testimonialsRouter.patch('/:id/status', requireAdminRole, async (req, res, next) => {
  try {
    const input = statusSchema.parse(req.body);
    const id = parseId(req.params.id);
    await assertOwned(prisma.testimonial, tenantOf(req).id, id, 'Testimonial');
    const testimonial = await prisma.testimonial.update({
      where: { id },
      data: { isActive: input.isActive },
    });
    res.json({ testimonial: serializeTestimonial(testimonial) });
  } catch (err) {
    next(err);
  }
});

testimonialsRouter.delete('/:id', requireAdminRole, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const testimonial = await prisma.testimonial.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!testimonial) throw new ApiError(404, 'Testimonial not found');
    await prisma.testimonial.delete({ where: { id } });
    removeUpload(req, 'testimonials', testimonial.photoFilename);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
