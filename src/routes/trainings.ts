import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import { parseId } from '../utils/validation';

export const trainingsRouter = Router();

function serializeTraining(t: any) {
  return {
    id: String(t.id),
    title: t.title,
    slug: t.slug ?? undefined,
    description: t.description,
    features: t.features ? JSON.parse(t.features) : [],
    price: t.price,
    image: t.image,
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
trainingsRouter.get('/', async (_req, res, next) => {
  try {
    const trainings = await prisma.training.findMany({ orderBy: { order: 'asc' } });
    res.json({ trainings: trainings.map(serializeTraining) });
  } catch (err) {
    next(err);
  }
});

trainingsRouter.get('/:id', async (req, res, next) => {
  try {
    const training = await prisma.training.findUnique({ where: { id: parseId(req.params.id) } });
    if (!training) throw new ApiError(404, 'Training not found');
    res.json({ training: serializeTraining(training) });
  } catch (err) {
    next(err);
  }
});

const trainingInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  features: z.array(z.string().max(300)).min(1).max(50),
  price: z.string().trim().min(1).max(100),
  image: z.string().trim().min(1).max(2048),
  icon: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  popular: z.boolean().optional(),
  order: z.number().int().optional(),
  published: z.boolean().optional(),
});

async function uniqueSlug(title: string, excludeId?: number): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  while (await prisma.training.findFirst({ where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) } })) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

/**
 * @openapi
 * /api/v1/trainings:
 *   post:
 *     summary: Create a training program (admin)
 *     tags: [Trainings]
 *     security: [{ BearerAuth: [] }]
 */
trainingsRouter.post('/', requireAdminRole, async (req, res, next) => {
  try {
    const input = trainingInputSchema.parse(req.body);
    const slug = await uniqueSlug(input.title);
    const training = await prisma.training.create({
      data: {
        title: input.title,
        slug,
        description: input.description,
        features: JSON.stringify(input.features),
        price: input.price,
        image: input.image,
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

const trainingUpdateSchema = trainingInputSchema.partial();

trainingsRouter.put('/:id', requireAdminRole, async (req, res, next) => {
  try {
    const input = trainingUpdateSchema.parse(req.body);
    const id = parseId(req.params.id);
    const data: Record<string, unknown> = { ...input };
    if (input.features) data.features = JSON.stringify(input.features);
    if (input.title) data.slug = await uniqueSlug(input.title, id);

    const training = await prisma.training.update({ where: { id }, data });
    res.json({ training: serializeTraining(training) });
  } catch (err) {
    next(err);
  }
});

trainingsRouter.delete('/:id', requireAdminRole, async (req, res, next) => {
  try {
    await prisma.training.delete({ where: { id: parseId(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
