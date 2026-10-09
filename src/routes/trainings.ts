import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ServicePackage, Training } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { optionalAuth } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import { parseId, urlOrPathSchema } from '../utils/validation';
import { uploadTrainingImage, uploadPath, removeUpload } from '../uploads';
import { tenantOf } from '../middleware/tenant';
import { uniqueSlugFor } from '../utils/tenantScope';

/**
 * Services ("trainings" for backwards compatibility): every bookable
 * offering of an app — gym programmes, corporate wellness & team-building
 * activities, outdoor activities, classes — with optional priced packages.
 */
export const trainingsRouter = Router();

type TrainingWithPackages = Training & { packages?: ServicePackage[] };

function imageUrlFor(t: Training): string {
  if (t.imageFilename) return `/api/v1/trainings/${t.id}/image`;
  return t.imageUrl ?? '';
}

const parseList = (raw: string | null) => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

function serializePackage(p: ServicePackage) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    priceAmount: p.priceAmount,
    pricingType: p.pricingType,
    priceLabel: p.priceLabel,
    minParticipants: p.minParticipants,
    maxParticipants: p.maxParticipants,
    features: parseList(p.features),
    popular: p.popular,
    order: p.order,
    active: p.active,
  };
}

function serializeTraining(t: TrainingWithPackages, includeInactivePackages = false) {
  return {
    id: String(t.id),
    title: t.title,
    slug: t.slug ?? undefined,
    description: t.description,
    features: parseList(t.features),
    price: t.price,
    priceAmount: t.priceAmount,
    pricingType: t.pricingType,
    category: t.category,
    audience: t.audience,
    duration: t.duration,
    groupSize: t.groupSize,
    schedule: t.schedule,
    level: t.level,
    location: t.location,
    minParticipants: t.minParticipants,
    maxParticipants: t.maxParticipants,
    bookingRequirements: t.bookingRequirements,
    image: imageUrlFor(t),
    icon: t.icon ?? undefined,
    color: t.color ?? undefined,
    popular: t.popular,
    available: t.available,
    order: t.order,
    published: t.published,
    packages: (t.packages ?? [])
      .filter((p) => includeInactivePackages || p.active)
      .sort((a, b) => a.order - b.order || a.id - b.id)
      .map(serializePackage),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const listSchema = z.object({
  audience: z.enum(['individual', 'corporate', 'both']).optional(),
  category: z.string().trim().max(60).optional(),
  all: z.enum(['true', 'false']).optional(),
});

/**
 * @openapi
 * /api/v1/trainings:
 *   get:
 *     summary: List published services. ?audience=corporate also returns "both"; ?category= filters; admins pass all=true for drafts.
 *     tags: [Trainings]
 */
trainingsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const query = listSchema.parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    const isAdminView = query.all === 'true' && req.user?.role === 'admin';
    const where: Prisma.TrainingWhereInput = {
      appId: tenantOf(req).id,
      ...(isAdminView ? {} : { published: true }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.audience
        ? { audience: query.audience === 'both' ? 'both' : { in: [query.audience, 'both'] } }
        : {}),
    };
    const trainings = await prisma.training.findMany({
      where,
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { packages: true },
    });
    res.json({ trainings: trainings.map((t) => serializeTraining(t, isAdminView)) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/trainings/categories:
 *   get:
 *     summary: Distinct categories of published services, with counts
 *     tags: [Trainings]
 */
trainingsRouter.get('/categories', async (req, res, next) => {
  try {
    const rows = await prisma.training.groupBy({
      by: ['category'],
      where: { appId: tenantOf(req).id, published: true, category: { not: null } },
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });
    res.json({ categories: rows.map((r) => ({ name: r.category, count: r._count._all })) });
  } catch (err) {
    next(err);
  }
});

trainingsRouter.get('/slug/:slug', async (req, res, next) => {
  try {
    const training = await prisma.training.findFirst({
      where: { slug: req.params.slug, appId: tenantOf(req).id, published: true },
      include: { packages: true },
    });
    if (!training) throw new ApiError(404, 'Service not found');
    res.json({ training: serializeTraining(training) });
  } catch (err) {
    next(err);
  }
});

trainingsRouter.get('/:id/image', async (req, res, next) => {
  try {
    const training = await prisma.training.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!training) throw new ApiError(404, 'Training not found');
    if (training.imageFilename) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(uploadPath(req, 'trainings', training.imageFilename));
    }
    if (training.imageUrl) {
      return res.redirect(302, training.imageUrl);
    }
    throw new ApiError(404, 'No image for this service');
  } catch (err) {
    next(err);
  }
});

trainingsRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const training = await prisma.training.findFirst({
      where: { id: parseId(req.params.id), appId: tenantOf(req).id, ...(isAdmin ? {} : { published: true }) },
      include: { packages: true },
    });
    if (!training) throw new ApiError(404, 'Training not found');
    res.json({ training: serializeTraining(training, isAdmin) });
  } catch (err) {
    next(err);
  }
});

// Multipart forms send everything as strings; JSON bodies send real types.
const boolField = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === 'true'));
const optionalInt = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === '' || v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: 'custom', message: 'Must be a whole number' });
      return z.NEVER;
    }
    return n;
  });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const trainingFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  features: z.union([z.string(), z.array(z.string())]), // JSON-encoded string[] (or an array in JSON bodies)
  price: z.string().trim().min(1).max(100),
  priceAmount: optionalInt,
  pricingType: z.enum(['fixed', 'per_person', 'quote']).optional(),
  category: optionalText(60),
  audience: z.enum(['individual', 'corporate', 'both']).optional(),
  duration: optionalText(60),
  groupSize: optionalText(60),
  schedule: optionalText(120),
  level: optionalText(40),
  location: optionalText(160),
  minParticipants: optionalInt,
  maxParticipants: optionalInt,
  bookingRequirements: optionalText(2000),
  imageUrl: z.union([urlOrPathSchema, z.literal('')]).optional(),
  icon: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  popular: boolField,
  available: boolField,
  order: z.coerce.number().int().optional(),
  published: boolField,
  packages: z.union([z.string(), z.array(z.unknown())]).optional(), // JSON-encoded PackageInput[]
});

const packageSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform((v) => v || null),
  priceAmount: z.number().int().min(0).nullable().optional(),
  pricingType: z.enum(['fixed', 'per_person', 'quote']).default('fixed'),
  priceLabel: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((v) => v || null),
  minParticipants: z.number().int().min(1).nullable().optional(),
  maxParticipants: z.number().int().min(1).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  popular: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});
type PackageInput = z.infer<typeof packageSchema>;

function parseFeatures(raw: string | string[]): string[] {
  let features: unknown = raw;
  if (typeof raw === 'string') {
    try {
      features = JSON.parse(raw);
    } catch {
      throw new ApiError(400, 'Invalid features format');
    }
  }
  if (!Array.isArray(features) || !features.every((f) => typeof f === 'string')) {
    throw new ApiError(400, 'Invalid features format');
  }
  const cleaned = features.map((f) => f.trim()).filter(Boolean);
  if (cleaned.length === 0) throw new ApiError(400, 'At least one feature is required');
  return cleaned;
}

function parsePackages(raw: string | unknown[] | undefined): PackageInput[] | undefined {
  if (raw === undefined) return undefined;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw || '[]');
    } catch {
      throw new ApiError(400, 'Invalid packages format');
    }
  }
  const parsed = z.array(packageSchema).max(20).safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, `Package ${Number(issue.path[0]) + 1}: ${issue.path.slice(1).join('.') || 'value'} ${issue.message}`);
  }
  for (const p of parsed.data) {
    if (p.minParticipants && p.maxParticipants && p.minParticipants > p.maxParticipants) {
      throw new ApiError(400, `Package "${p.name}": minimum participants is above the maximum.`);
    }
  }
  return parsed.data;
}

function checkParticipants(min?: number | null, max?: number | null) {
  if (min && max && min > max) throw new ApiError(400, 'Minimum participants cannot be above the maximum.');
}

/** Replace a service's packages with `packages` (matching existing ones by id). */
async function syncPackages(tx: Prisma.TransactionClient, trainingId: number, packages: PackageInput[]) {
  const existing = await tx.servicePackage.findMany({ where: { trainingId }, select: { id: true } });
  const existingIds = new Set(existing.map((p) => p.id));
  const keep = new Set(packages.filter((p) => p.id && existingIds.has(p.id)).map((p) => p.id as number));
  await tx.servicePackage.deleteMany({ where: { trainingId, id: { notIn: [...keep] } } });
  for (const [index, p] of packages.entries()) {
    const data = {
      name: p.name,
      description: p.description,
      priceAmount: p.priceAmount ?? null,
      pricingType: p.pricingType,
      priceLabel: p.priceLabel,
      minParticipants: p.minParticipants ?? null,
      maxParticipants: p.maxParticipants ?? null,
      features: JSON.stringify(p.features),
      popular: p.popular,
      order: p.order || index,
      active: p.active,
    };
    if (p.id && keep.has(p.id)) await tx.servicePackage.update({ where: { id: p.id }, data });
    else await tx.servicePackage.create({ data: { ...data, trainingId } });
  }
}

const uniqueSlug = (appId: number, title: string, excludeId?: number) =>
  uniqueSlugFor(prisma.training, appId, slugify(title), excludeId);

/**
 * @openapi
 * /api/v1/trainings:
 *   post:
 *     summary: Create a service, with an optional image upload and packages (admin)
 *     tags: [Trainings]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
trainingsRouter.post('/', requireAdminKey, uploadTrainingImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = trainingFormSchema.parse(req.body);
    const file = req.file;
    const features = parseFeatures(input.features);
    const packages = parsePackages(input.packages) ?? [];
    checkParticipants(input.minParticipants, input.maxParticipants);
    const slug = await uniqueSlug(appId, input.title);

    const training = await prisma.$transaction(async (tx) => {
      const created = await tx.training.create({
        data: {
          appId,
          title: input.title,
          slug,
          description: input.description,
          features: JSON.stringify(features),
          price: input.price,
          priceAmount: input.priceAmount ?? null,
          pricingType: input.pricingType,
          category: input.category,
          audience: input.audience,
          duration: input.duration,
          groupSize: input.groupSize,
          schedule: input.schedule,
          level: input.level,
          location: input.location,
          minParticipants: input.minParticipants ?? null,
          maxParticipants: input.maxParticipants ?? null,
          bookingRequirements: input.bookingRequirements,
          imageUrl: !file ? input.imageUrl || null : undefined,
          imageFilename: file?.filename,
          imageContentType: file?.mimetype,
          imageSize: file?.size,
          icon: input.icon,
          color: input.color,
          popular: input.popular ?? false,
          available: input.available ?? true,
          order: input.order ?? 0,
          published: input.published ?? true,
        },
      });
      await syncPackages(tx, created.id, packages);
      return tx.training.findUniqueOrThrow({ where: { id: created.id }, include: { packages: true } });
    });
    res.status(201).json({ training: serializeTraining(training, true) });
  } catch (err) {
    removeUpload(req, 'trainings', req.file?.filename);
    next(err);
  }
});

const trainingUpdateFormSchema = trainingFormSchema.partial();

/**
 * @openapi
 * /api/v1/trainings/{id}:
 *   put:
 *     summary: Update a service, with an optional image upload; `packages` (when sent) replaces the package list (admin)
 *     tags: [Trainings]
 *     security: [{ AdminKey: [] }, { BearerAuth: [] }]
 */
trainingsRouter.put('/:id', requireAdminKey, uploadTrainingImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = trainingUpdateFormSchema.parse(req.body);
    const id = parseId(req.params.id);
    const file = req.file;
    const existing = await prisma.training.findFirst({ where: { id, appId } });
    if (!existing) throw new ApiError(404, 'Training not found');
    const packages = parsePackages(input.packages);
    checkParticipants(
      input.minParticipants === undefined ? existing.minParticipants : input.minParticipants,
      input.maxParticipants === undefined ? existing.maxParticipants : input.maxParticipants
    );

    const data: Prisma.TrainingUncheckedUpdateInput = {
      title: input.title,
      description: input.description,
      price: input.price,
      priceAmount: input.priceAmount,
      pricingType: input.pricingType,
      category: input.category,
      audience: input.audience,
      duration: input.duration,
      groupSize: input.groupSize,
      schedule: input.schedule,
      level: input.level,
      location: input.location,
      minParticipants: input.minParticipants,
      maxParticipants: input.maxParticipants,
      bookingRequirements: input.bookingRequirements,
      icon: input.icon,
      color: input.color,
      popular: input.popular,
      available: input.available,
      order: input.order,
      published: input.published,
    };
    if (input.features !== undefined) data.features = JSON.stringify(parseFeatures(input.features));
    if (input.title && input.title !== existing.title) data.slug = await uniqueSlug(appId, input.title, id);
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

    const training = await prisma.$transaction(async (tx) => {
      await tx.training.update({ where: { id }, data });
      if (packages) await syncPackages(tx, id, packages);
      return tx.training.findUniqueOrThrow({ where: { id }, include: { packages: true } });
    });
    // Only drop the old file once the new record is safely saved.
    if (file || input.imageUrl) removeUpload(req, 'trainings', existing.imageFilename);
    res.json({ training: serializeTraining(training, true) });
  } catch (err) {
    removeUpload(req, 'trainings', req.file?.filename);
    next(err);
  }
});

trainingsRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const training = await prisma.training.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!training) throw new ApiError(404, 'Training not found');
    await prisma.training.delete({ where: { id } });
    removeUpload(req, 'trainings', training.imageFilename);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
