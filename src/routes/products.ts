import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { slugify } from '../utils/slugify';
import { ApiError } from '../middleware/errorHandler';
import { parseId, urlOrPathSchema } from '../utils/validation';
import { Request } from 'express';
import { uploadProductImages, uploadUrl } from '../uploads';
import { tenantOf } from '../middleware/tenant';

export const productsRouter = Router();

const boolField = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

// Product create/update now arrive as multipart form-data (to carry uploaded
// image files alongside the other fields) rather than a JSON body — text
// fields are all strings on the wire, coerced/parsed below.
const productFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  price: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  sizes: z.string().optional(), // JSON-encoded string[]
  colors: z.string().optional(), // JSON-encoded string[]
  inStock: boolField,
  featured: boolField,
  isNew: boolField,
  // JSON-encoded array describing the final ordered image list — see
  // parseImageMeta() below for the shape.
  imageMeta: z.string().min(1),
});

const imageMetaEntrySchema = z
  .object({
    type: z.enum(['upload', 'existing', 'url']),
    color: z.string().trim().max(50).nullable().optional(),
    url: urlOrPathSchema.optional(),
  })
  .refine((e) => e.type === 'upload' || !!e.url, {
    message: 'url is required for existing/url image entries',
  });

const imageMetaListSchema = z.array(imageMetaEntrySchema).min(1).max(20);

function parseImageMeta(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Invalid imageMeta format');
  }
  return imageMetaListSchema.parse(parsed);
}

function parseJsonStringArray(raw: string | undefined, field: string): string[] | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, `Invalid ${field} format`);
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    throw new ApiError(400, `Invalid ${field} format`);
  }
  return parsed as string[];
}

// Turns the imageMeta entries + any uploaded files into ProductImage create
// rows, in order — 'upload' entries consume the next file in req.files,
// 'existing'/'url' entries just use their given url.
function buildImagesData(req: Request, imageMeta: string, files: Express.Multer.File[]) {
  const meta = parseImageMeta(imageMeta);
  let fileIndex = 0;
  return meta.map((entry, position) => {
    if (entry.type === 'upload') {
      const file = files[fileIndex++];
      if (!file) throw new ApiError(400, 'Not enough uploaded files for imageMeta');
      return { url: uploadUrl(req, 'products', file.filename), position, color: entry.color || null };
    }
    return { url: entry.url!, position, color: entry.color || null };
  });
}

async function assertCategory(appId: number, categoryId: number) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, appId } });
  if (!category) throw new ApiError(400, 'Category not found');
}

async function assertOwnProduct(appId: number, id: number) {
  const product = await prisma.product.findFirst({ where: { id, appId }, select: { id: true } });
  if (!product) throw new ApiError(404, 'Product not found');
}

function serializeProduct(product: any) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: product.price,
    images: (product.images ?? []).map((i: any) => i.url),
    imageDetails: (product.images ?? []).map((i: any) => ({ url: i.url, color: i.color ?? null })),
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

    const where: Prisma.ProductWhereInput = { appId: tenantOf(req).id };
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
    const appId = tenantOf(req).id;
    const product = await prisma.product.findUnique({
      where: { appId_slug: { appId, slug: req.params.slug } },
      include: includeForList,
    });
    if (!product) throw new ApiError(404, 'Product not found');

    const related = await prisma.product.findMany({
      where: { appId, categoryId: product.categoryId, id: { not: product.id } },
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
productsRouter.post('/', requireAdminKey, uploadProductImages.array('images', 20), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = productFormSchema.parse(req.body);
    await assertCategory(appId, input.categoryId);
    const sizes = parseJsonStringArray(input.sizes, 'sizes');
    const colors = parseJsonStringArray(input.colors, 'colors');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imagesData = buildImagesData(req, input.imageMeta, files);

    const product = await prisma.product.create({
      data: {
        appId,
        name: input.name,
        slug: `${slugify(input.name)}-${Date.now().toString(36)}`,
        description: input.description,
        price: input.price,
        categoryId: input.categoryId,
        inStock: input.inStock ?? true,
        featured: input.featured ?? false,
        isNew: input.isNew ?? false,
        sizes: sizes ? JSON.stringify(sizes) : null,
        colors: colors ? JSON.stringify(colors) : null,
        images: { create: imagesData },
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
productsRouter.put('/:id', requireAdminKey, uploadProductImages.array('images', 20), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const id = parseId(req.params.id);
    await assertOwnProduct(appId, id);
    const input = productFormSchema.partial().parse(req.body);
    if (input.categoryId) await assertCategory(appId, input.categoryId);

    const data: Prisma.ProductUncheckedUpdateInput = {
      name: input.name,
      description: input.description,
      price: input.price,
      categoryId: input.categoryId,
      inStock: input.inStock,
      featured: input.featured,
      isNew: input.isNew,
    };

    const sizes = parseJsonStringArray(input.sizes, 'sizes');
    const colors = parseJsonStringArray(input.colors, 'colors');
    if (sizes) data.sizes = JSON.stringify(sizes);
    if (colors) data.colors = JSON.stringify(colors);

    if (input.imageMeta) {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const imagesData = buildImagesData(req, input.imageMeta, files);
      data.images = { deleteMany: {}, create: imagesData };
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
    const id = parseId(req.params.id);
    await assertOwnProduct(tenantOf(req).id, id);
    await prisma.product.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
