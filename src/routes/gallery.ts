import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import { uploadGalleryImages, uploadPath, removeUpload } from '../uploads';
import { tenantOf } from '../middleware/tenant';
import { assertOwned, uniqueSlugFor } from '../utils/tenantScope';
import { parseId } from '../utils/validation';

export const galleryRouter = Router();

function serializeCategory(c: any) {
  return {
    id: String(c.id),
    name: c.name,
    slug: c.slug,
    description: c.description ?? undefined,
    imageCount: c._count?.images ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function serializeImage(img: any) {
  return {
    id: String(img.id),
    title: img.title ?? undefined,
    categoryId: String(img.categoryId),
    url: `/api/v1/gallery/images/${img.id}/file`,
    createdAt: img.createdAt,
  };
}

const uniqueSlug = (appId: number, name: string, excludeId?: number) =>
  uniqueSlugFor(prisma.galleryCategory, appId, slugify(name), excludeId);

/** Gallery images have no appId of their own — they belong to an app through their category. */
async function findOwnImage(appId: number, id: number) {
  const image = await prisma.galleryImage.findFirst({ where: { id, category: { appId } } });
  if (!image) throw new ApiError(404, 'Image not found');
  return image;
}

async function assertOwnCategory(appId: number, id: number) {
  await assertOwned(prisma.galleryCategory, appId, id, 'Category');
}

/**
 * @openapi
 * /api/v1/gallery/categories:
 *   get:
 *     summary: List gallery categories
 *     tags: [Gallery]
 */
galleryRouter.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.galleryCategory.findMany({
      where: { appId: tenantOf(req).id },
      orderBy: { name: 'asc' },
      include: { _count: { select: { images: true } } },
    });
    res.json({ categories: categories.map(serializeCategory) });
  } catch (err) {
    next(err);
  }
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
});

galleryRouter.post('/categories', requireAdminRole, async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = categorySchema.parse(req.body);
    const slug = await uniqueSlug(appId, input.name);
    const category = await prisma.galleryCategory.create({
      data: { appId, name: input.name, description: input.description, slug },
      include: { _count: { select: { images: true } } },
    });
    res.status(201).json({ category: serializeCategory(category) });
  } catch (err) {
    next(err);
  }
});

galleryRouter.put('/categories/:id', requireAdminRole, async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const id = parseId(req.params.id);
    await assertOwnCategory(appId, id);
    const input = categorySchema.partial().parse(req.body);

    const data: Record<string, unknown> = { ...input };
    if (input.name) data.slug = await uniqueSlug(appId, input.name, id);

    const category = await prisma.galleryCategory.update({
      where: { id },
      data,
      include: { _count: { select: { images: true } } },
    });
    res.json({ category: serializeCategory(category) });
  } catch (err) {
    next(err);
  }
});

galleryRouter.delete('/categories/:id', requireAdminRole, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwnCategory(tenantOf(req).id, id);
    const imageCount = await prisma.galleryImage.count({ where: { categoryId: id } });
    if (imageCount > 0) {
      throw new ApiError(409, `Cannot delete category with ${imageCount} photo(s). Delete them first.`);
    }
    await prisma.galleryCategory.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/gallery/images:
 *   get:
 *     summary: List gallery images, optionally filtered by category
 *     tags: [Gallery]
 */
galleryRouter.get('/images', async (req, res, next) => {
  try {
    const { categoryId } = req.query as Record<string, string | undefined>;
    const where = {
      category: { appId: tenantOf(req).id },
      ...(categoryId ? { categoryId: parseId(categoryId) } : {}),
    };
    const images = await prisma.galleryImage.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ images: images.map(serializeImage) });
  } catch (err) {
    next(err);
  }
});

galleryRouter.get('/images/:id/file', async (req, res, next) => {
  try {
    const image = await findOwnImage(tenantOf(req).id, parseId(req.params.id));
    res.sendFile(uploadPath(req, 'gallery', image.filename));
  } catch (err) {
    next(err);
  }
});

const singleUploadSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  title: z.string().trim().max(200).optional(),
});

galleryRouter.post(
  '/images/single',
  requireAdminRole,
  uploadGalleryImages.single('image'),
  async (req, res, next) => {
    try {
      const input = singleUploadSchema.parse(req.body);
      const file = req.file;
      if (!file) throw new ApiError(400, 'An image file is required');

      const category = await prisma.galleryCategory.findFirst({ where: { id: input.categoryId, appId: tenantOf(req).id } });
      if (!category) {
        removeUpload(req, 'gallery', file.filename);
        throw new ApiError(404, 'Category not found');
      }

      const image = await prisma.galleryImage.create({
        data: {
          title: input.title,
          filename: file.filename,
          contentType: file.mimetype,
          size: file.size,
          categoryId: input.categoryId,
        },
      });
      res.status(201).json({ image: serializeImage(image) });
    } catch (err) {
      next(err);
    }
  }
);

const bulkUploadSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
});

galleryRouter.post(
  '/images/bulk',
  requireAdminRole,
  uploadGalleryImages.array('images', 30),
  async (req, res, next) => {
    try {
      const input = bulkUploadSchema.parse(req.body);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new ApiError(400, 'At least one image file is required');

      const category = await prisma.galleryCategory.findFirst({ where: { id: input.categoryId, appId: tenantOf(req).id } });
      if (!category) {
        files.forEach((f) => removeUpload(req, 'gallery', f.filename));
        throw new ApiError(404, 'Category not found');
      }

      const images = await prisma.$transaction(
        files.map((file) =>
          prisma.galleryImage.create({
            data: {
              filename: file.filename,
              contentType: file.mimetype,
              size: file.size,
              categoryId: input.categoryId,
            },
          })
        )
      );
      res.status(201).json({ images: images.map(serializeImage) });
    } catch (err) {
      next(err);
    }
  }
);

galleryRouter.delete('/images/:id', requireAdminRole, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const image = await findOwnImage(tenantOf(req).id, id);
    await prisma.galleryImage.delete({ where: { id } });
    removeUpload(req, 'gallery', image.filename);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
