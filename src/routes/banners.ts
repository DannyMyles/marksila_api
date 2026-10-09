import { Router } from 'express';
import { z } from 'zod';
import { Banner, Prisma } from '@prisma/client';
import { Request } from 'express';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { optionalAuth } from '../middleware/userAuth';
import { tenantOf } from '../middleware/tenant';
import { ApiError } from '../middleware/errorHandler';
import { parseId, urlOrPathSchema } from '../utils/validation';
import { removeUpload, uploadBannerImage, uploadUrl } from '../uploads';

/** Homepage banners and time-limited promotional offers. */
export const bannersRouter = Router();

function serializeBanner(req: Request, b: Banner) {
  return {
    id: b.id,
    placement: b.placement,
    title: b.title,
    subtitle: b.subtitle,
    badge: b.badge,
    image: b.imageFilename ? uploadUrl(req, 'banners', b.imageFilename) : b.imageUrl,
    ctaLabel: b.ctaLabel,
    ctaUrl: b.ctaUrl,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    order: b.order,
    active: b.active,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? new Date(v) : null))
  .refine((d) => !d || !Number.isNaN(d.getTime()), 'Invalid date');
const boolField = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === 'true'));

// Multipart form (image upload) — every field arrives as a string.
const bannerSchema = z.object({
  placement: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits or dashes').default('home'),
  title: z.string().trim().min(1).max(160),
  subtitle: optionalText(1000),
  badge: optionalText(60),
  imageUrl: z.union([urlOrPathSchema, z.literal('')]).optional(),
  ctaLabel: optionalText(60),
  ctaUrl: z.union([urlOrPathSchema, z.literal('')]).optional(),
  startsAt: optionalDate,
  endsAt: optionalDate,
  order: z.coerce.number().int().min(0).max(10000).optional(),
  active: boolField,
});

/**
 * @openapi
 * /api/v1/banners:
 *   get:
 *     summary: Banners currently live for this app (active and inside their date window). ?placement=home|promo|corporate. Admins pass all=true.
 *     tags: [Banners]
 */
bannersRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const all = req.query.all === 'true' && req.user?.role === 'admin';
    const placement = typeof req.query.placement === 'string' && req.query.placement ? req.query.placement : undefined;
    const now = new Date();
    const where: Prisma.BannerWhereInput = {
      appId: tenantOf(req).id,
      ...(placement ? { placement } : {}),
      ...(all
        ? {}
        : {
            active: true,
            AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
          }),
    };
    const banners = await prisma.banner.findMany({ where, orderBy: [{ order: 'asc' }, { id: 'desc' }] });
    res.json({ banners: banners.map((b) => serializeBanner(req, b)) });
  } catch (err) {
    next(err);
  }
});

function checkWindow(startsAt?: Date | null, endsAt?: Date | null) {
  if (startsAt && endsAt && endsAt < startsAt) throw new ApiError(400, 'The end date must be after the start date.');
}

bannersRouter.post('/', requireAdminKey, uploadBannerImage.single('image'), async (req, res, next) => {
  try {
    const input = bannerSchema.parse(req.body);
    checkWindow(input.startsAt, input.endsAt);
    const banner = await prisma.banner.create({
      data: {
        ...input,
        appId: tenantOf(req).id,
        imageUrl: req.file ? null : input.imageUrl || null,
        imageFilename: req.file?.filename,
        ctaUrl: input.ctaUrl || null,
        active: input.active ?? true,
      },
    });
    res.status(201).json({ banner: serializeBanner(req, banner) });
  } catch (err) {
    removeUpload(req, 'banners', req.file?.filename);
    next(err);
  }
});

bannersRouter.put('/:id', requireAdminKey, uploadBannerImage.single('image'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const existing = await prisma.banner.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!existing) throw new ApiError(404, 'Banner not found');
    const input = bannerSchema.partial().parse(req.body);
    checkWindow(input.startsAt === undefined ? existing.startsAt : input.startsAt, input.endsAt === undefined ? existing.endsAt : input.endsAt);
    const data: Prisma.BannerUpdateInput = { ...input, imageUrl: undefined, ctaUrl: input.ctaUrl === undefined ? undefined : input.ctaUrl || null };
    if (req.file) {
      data.imageFilename = req.file.filename;
      data.imageUrl = null;
    } else if (input.imageUrl !== undefined) {
      data.imageUrl = input.imageUrl || null;
      if (input.imageUrl) data.imageFilename = null;
    }
    const banner = await prisma.banner.update({ where: { id }, data });
    if (req.file || input.imageUrl) removeUpload(req, 'banners', existing.imageFilename);
    res.json({ banner: serializeBanner(req, banner) });
  } catch (err) {
    removeUpload(req, 'banners', req.file?.filename);
    next(err);
  }
});

bannersRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const existing = await prisma.banner.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!existing) throw new ApiError(404, 'Banner not found');
    await prisma.banner.delete({ where: { id } });
    removeUpload(req, 'banners', existing.imageFilename);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
