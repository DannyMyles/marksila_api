import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { slugify } from '../utils/slugify';
import { ApiError } from '../middleware/errorHandler';

export const productsRouter = Router();

const productInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  images: z.array(z.string().min(1)).min(1),
  sizes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  inStock: z.boolean().optional(),
  featured: z.boolean().optional(),
  isNew: z.boolean().optional(),
});

function serializeProduct(product: any) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: product.price,
    images: (product.images ?? []).map((i: any) => i.url),
    sizes: product.sizes ? JSON.parse(product.sizes) : [],
    colors: product.colors ? JSON.parse(product.colors) : [],
    inStock: product.inStock,
    featured: product.featured,
    isNew: product.isNew,
    category: product.category ? { id: product.category.id, name: product.category.name, slug: product.category.slug } : undefined,
    createdAt: product.createdAt,
  };
}

const includeForList = {
  images: { orderBy: { position: 'asc' as const } },
  category: true,
};

/**
 * @openapi
 * /api/products:
 *   get:
 *     summary: List products, optionally filtered
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Category slug
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: featured
 *         schema: { type: boolean }
 */
productsRouter.get('/', async (req, res, next) => {
  try {
    const { category, search, featured } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (category && category !== 'All') {
      where.category = { slug: category };
    }
    if (featured === 'true') {
      where.featured = true;
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: includeForList,
      orderBy: { createdAt: 'desc' },
    });

    res.json(products.map(serializeProduct));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/products/{slug}:
 *   get:
 *     summary: Get a single product by slug
 *     tags: [Products]
 */
productsRouter.get('/:slug', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      include: includeForList,
    });
    if (!product) throw new ApiError(404, 'Product not found');

    const related = await prisma.product.findMany({
      where: { categoryId: product.categoryId, id: { not: product.id } },
      include: includeForList,
      take: 4,
    });

    res.json({ ...serializeProduct(product), related: related.map(serializeProduct) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/products:
 *   post:
 *     summary: Create a product (admin)
 *     tags: [Products]
 *     security: [{ AdminKey: [] }]
 */
productsRouter.post('/', requireAdminKey, async (req, res, next) => {
  try {
    const input = productInputSchema.parse(req.body);
    const product = await prisma.product.create({
      data: {
        name: input.name,
        slug: `${slugify(input.name)}-${Date.now().toString(36)}`,
        description: input.description,
        price: input.price,
        categoryId: input.categoryId,
        inStock: input.inStock ?? true,
        featured: input.featured ?? false,
        isNew: input.isNew ?? false,
        sizes: input.sizes ? JSON.stringify(input.sizes) : null,
        colors: input.colors ? JSON.stringify(input.colors) : null,
        images: { create: input.images.map((url, position) => ({ url, position })) },
      },
      include: includeForList,
    });
    res.status(201).json(serializeProduct(product));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/products/{id}:
 *   put:
 *     summary: Update a product (admin)
 *     tags: [Products]
 *     security: [{ AdminKey: [] }]
 */
productsRouter.put('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = productInputSchema.partial().parse(req.body);

    const data: any = { ...input };
    delete data.images;
    delete data.sizes;
    delete data.colors;
    if (input.sizes) data.sizes = JSON.stringify(input.sizes);
    if (input.colors) data.colors = JSON.stringify(input.colors);

    if (input.images) {
      await prisma.productImage.deleteMany({ where: { productId: id } });
      data.images = { create: input.images.map((url, position) => ({ url, position })) };
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: includeForList,
    });
    res.json(serializeProduct(product));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/products/{id}:
 *   delete:
 *     summary: Delete a product (admin)
 *     tags: [Products]
 *     security: [{ AdminKey: [] }]
 */
productsRouter.delete('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.product.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
