import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import { parseId, urlOrPathSchema } from '../utils/validation';
import { uploadTrainingImage, uploadPath, removeUpload } from '../uploads';
import { tenantOf } from '../middleware/tenant';
import { uniqueSlugFor } from '../utils/tenantScope';

export const trainingsRouter = Router();

function imageUrlFor(t: any): string {
  if (t.imageFilename) return `/api/v1/trainings/${t.id}/image`;
  return t.imageUrl ?? '';
}

function serializeTraining(t: any) {
  return {
    id: String(t.id),
    title: t.title,
    slug: t.slug ?? undefined,
    description: t.description,
    features: t.features ? JSON.parse(t.features) : [],
    price: t.price,
    image: imageUrlFor(t),
    icon: t.icon ?? undefined,
    color: t.color ?? undefined,
    popular: t.popular,
    order: t.order,
    published: t.published,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/**
 * @openapi
 * /api/v1/trainings:
 *   get:
 *     summary: List all training programs
 *     tags: [Trainings]
 */
trainingsRouter.get('/', async (req, res, next) => {
  try {
    const trainings = await prisma.training.findMany({ where: { appId: tenantOf(req).id }, orderBy: { order: 'asc' } });
    res.json({ trainings: trainings.map(serializeTraining) });
  } catch (err) {
    next(err);
  }
});

trainingsRouter.get('/:id/image', async (req, res, next) => {
  try {
    const training = await prisma.training.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!training) throw new ApiError(404, 'Training not found');
    if (training.imageFilename) {
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

trainingsRouter.get('/:id', async (req, res, next) => {
  try {
    const training = await prisma.training.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!training) throw new ApiError(404, 'Training not found');
    res.json({ training: serializeTraining(training) });
  } catch (err) {
    next(err);
  }
});

const boolField = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const trainingFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  features: z.string().min(1), // JSON-encoded string[]
  price: z.string().trim().min(1).max(100),
  imageUrl: urlOrPathSchema.optional(),
  icon: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  popular: boolField,
  order: z.coerce.number().int().optional(),
  published: boolField,
});

function parseFeatures(raw: string): string[] {
  let features: unknown;
  try {
    features = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Invalid features format');
  }
  if (!Array.isArray(features) || features.length === 0 || !features.every((f) => typeof f === 'string')) {
    throw new ApiError(400, 'At least one feature is required');
  }
  return features;
}

const uniqueSlug = (appId: number, title: string, excludeId?: number) =>
  uniqueSlugFor(prisma.training, appId, slugify(title), excludeId);

/**
 * @openapi
 * /api/v1/trainings:
 *   post:
 *     summary: Create a training program, with an optional image upload (admin)
 *     tags: [Trainings]
 *     security: [{ BearerAuth: [] }]
 */
trainingsRouter.post('/', requireAdminRole, uploadTrainingImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = trainingFormSchema.parse(req.body);
    const file = req.file;
    if (!file && !input.imageUrl) {
      throw new ApiError(400, 'An image (upload or URL) is required');
    }
    const features = parseFeatures(input.features);
    const slug = await uniqueSlug(appId, input.title);

    const training = await prisma.training.create({
      data: {
        appId,
        title: input.title,
        slug,
        description: input.description,
        features: JSON.stringify(features),
        price: input.price,
        imageUrl: !file ? input.imageUrl : undefined,
        imageFilename: file?.filename,
        imageContentType: file?.mimetype,
        imageSize: file?.size,
        icon: input.icon,
        color: input.color,
        popular: input.popular ?? false,
        order: input.order ?? 0,
        published: input.published ?? true,
      },
    });
    res.status(201).json({ training: serializeTraining(training) });
  } catch (err) {
    next(err);
  }
});

const trainingUpdateFormSchema = trainingFormSchema.partial();

/**
 * @openapi
 * /api/v1/trainings/{id}:
 *   put:
 *     summary: Update a training program, with an optional image upload (admin)
 *     tags: [Trainings]
 *     security: [{ BearerAuth: [] }]
 */
trainingsRouter.put('/:id', requireAdminRole, uploadTrainingImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = trainingUpdateFormSchema.parse(req.body);
    const id = parseId(req.params.id);
    const file = req.file;
    const existing = await prisma.training.findFirst({ where: { id, appId } });
    if (!existing) {
      removeUpload(req, 'trainings', file?.filename);
      throw new ApiError(404, 'Training not found');
    }

    const data: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      price: input.price,
      icon: input.icon,
      color: input.color,
      popular: input.popular,
      order: input.order,
      published: input.published,
    };
    if (input.features) data.features = JSON.stringify(parseFeatures(input.features));
    if (input.title) data.slug = await uniqueSlug(appId, input.title, id);
    if (file || input.imageUrl) removeUpload(req, 'trainings', existing.imageFilename);
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

    const training = await prisma.training.update({ where: { id }, data });
    res.json({ training: serializeTraining(training) });
  } catch (err) {
    next(err);
  }
});

trainingsRouter.delete('/:id', requireAdminRole, async (req, res, next) => {
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
