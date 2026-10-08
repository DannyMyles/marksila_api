import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { slugify } from '../utils/slugify';
import { ApiError } from '../middleware/errorHandler';
import { parseId } from '../utils/validation';
import { tenantOf } from '../middleware/tenant';

export const categoriesRouter = Router();

async function assertOwnCategory(appId: number, id: number) {
  const category = await prisma.category.findFirst({ where: { id, appId }, select: { id: true } });
  if (!category) throw new ApiError(404, 'Category not found');
}

const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
});

/**
 * @openapi
 * /api/categories:
 *   get:
 *     summary: List all product categories
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: List of categories with product counts
 */
categoriesRouter.get('/', async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { appId: tenantOf(req).id },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    res.json(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        productCount: c._count.products,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/categories:
 *   post:
 *     summary: Create a category (admin)
 *     tags: [Categories]
 *     security: [{ AdminKey: [] }]
 */
categoriesRouter.post('/', requireAdminKey, async (req, res, next) => {
  try {
    const input = categoryInputSchema.parse(req.body);
    const category = await prisma.category.create({
      data: { appId: tenantOf(req).id, name: input.name, description: input.description, slug: slugify(input.name) },
    });
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/categories/{id}:
 *   put:
 *     summary: Update a category (admin)
 *     tags: [Categories]
 *     security: [{ AdminKey: [] }]
 */
categoriesRouter.put('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwnCategory(tenantOf(req).id, id);
    const input = categoryInputSchema.partial().parse(req.body);
    const data: { name?: string; description?: string; slug?: string } = { ...input };
    if (input.name) data.slug = slugify(input.name);
    const category = await prisma.category.update({ where: { id }, data });
    res.json(category);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/categories/{id}:
 *   delete:
 *     summary: Delete a category (admin)
 *     tags: [Categories]
 *     security: [{ AdminKey: [] }]
 */
categoriesRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwnCategory(tenantOf(req).id, id);
    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new ApiError(409, `Cannot delete category with ${productCount} product(s). Reassign or delete them first.`);
    }
    await prisma.category.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
