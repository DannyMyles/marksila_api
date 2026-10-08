import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { slugify } from '../utils/slugify';
import { uploadBlogImage, uploadPath, removeUpload } from '../uploads';
import { tenantOf } from '../middleware/tenant';
import { assertOwned, uniqueSlugFor } from '../utils/tenantScope';
import { optionalAuth } from '../middleware/userAuth';
import { parseId, urlOrPathSchema } from '../utils/validation';

export const blogsRouter = Router();

function imageInfoFor(blog: any) {
  const hasImage = Boolean(blog.imageFilename || blog.imageUrl);
  return {
    hasImage,
    type: blog.imageFilename ? 'uploaded' : blog.imageUrl ? 'external' : undefined,
    contentType: blog.imageContentType ?? undefined,
    filename: blog.imageFilename ?? undefined,
    size: blog.imageSize ?? undefined,
    url: hasImage ? `/api/v1/blogs/${blog.id}/image` : '',
  };
}

function serializeBlog(blog: any) {
  const imageInfo = imageInfoFor(blog);
  return {
    id: String(blog.id),
    title: blog.title,
    slug: blog.slug,
    excerpt: blog.excerpt,
    content: blog.content,
    category: blog.category,
    author: blog.author,
    authorId: blog.authorId ? String(blog.authorId) : undefined,
    date: blog.createdAt,
    readTime: blog.readTime ?? '',
    image: imageInfo.url,
    imageInfo,
    featured: blog.featured,
    views: blog.views,
    likes: blog.likes,
    tags: blog.tags ? JSON.parse(blog.tags) : [],
    metaTitle: blog.metaTitle ?? undefined,
    metaDescription: blog.metaDescription ?? undefined,
    createdAt: blog.createdAt,
    updatedAt: blog.updatedAt,
    published: blog.published,
  };
}

/**
 * @openapi
 * /api/v1/blogs:
 *   get:
 *     summary: List blogs (paginated, filterable)
 *     tags: [Blogs]
 */
blogsRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 12));
    const { category, featured, search, sort } = req.query as Record<string, string | undefined>;

    const where: Prisma.BlogWhereInput = { appId: tenantOf(req).id, published: true };
    if (category) where.category = category;
    if (featured !== undefined) where.featured = featured === 'true';
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { excerpt: { contains: search } },
        { content: { contains: search } },
      ];
    }

    let orderBy: Prisma.BlogOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort) {
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;
      if (['createdAt', 'views', 'likes', 'title'].includes(field)) {
        orderBy = { [field]: desc ? 'desc' : 'asc' };
      }
    }

    const [blogs, totalBlogs] = await Promise.all([
      prisma.blog.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
      prisma.blog.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalBlogs / limit));
    res.json({
      blogs: blogs.map(serializeBlog),
      pagination: {
        currentPage: page,
        totalPages,
        totalBlogs,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/featured', async (req, res, next) => {
  try {
    const blogs = await prisma.blog.findMany({
      where: { appId: tenantOf(req).id, published: true, featured: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ blogs: blogs.map(serializeBlog) });
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/categories', async (req, res, next) => {
  try {
    const blogs = await prisma.blog.findMany({ where: { appId: tenantOf(req).id, published: true }, select: { category: true } });
    const counts = new Map<string, number>();
    for (const b of blogs) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
    res.json({ categories: Array.from(counts, ([name, count]) => ({ name, count })) });
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/stats', requireAdminRole, async (req, res, next) => {
  try {
    const blogs = await prisma.blog.findMany({ where: { appId: tenantOf(req).id } });
    const withImages = blogs.filter((b) => b.imageFilename || b.imageUrl);
    const sizes = withImages.map((b) => b.imageSize ?? 0).filter((s) => s > 0);
    const totalImageSize = sizes.reduce((sum, s) => sum + s, 0);
    res.json({
      stats: {
        totalBlogs: blogs.length,
        blogsWithImages: withImages.length,
        totalImageSize,
        avgImageSize: sizes.length ? Math.round(totalImageSize / sizes.length) : 0,
        maxImageSize: sizes.length ? Math.max(...sizes) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/slug/:slug', optionalAuth, async (req, res, next) => {
  try {
    const blog = await prisma.blog.findUnique({
      where: { appId_slug: { appId: tenantOf(req).id, slug: req.params.slug } },
    });
    if (!blog || (!blog.published && req.user?.role !== 'admin')) throw new ApiError(404, 'Blog not found');
    res.json({ blog: serializeBlog(blog) });
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/:id/image', async (req, res, next) => {
  try {
    const blog = await prisma.blog.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!blog) throw new ApiError(404, 'Blog not found');
    if (blog.imageFilename) {
      return res.sendFile(uploadPath(req, 'blogs', blog.imageFilename));
    }
    if (blog.imageUrl) {
      return res.redirect(302, blog.imageUrl);
    }
    throw new ApiError(404, 'No image for this blog');
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/:id/image-info', async (req, res, next) => {
  try {
    const blog = await prisma.blog.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!blog) throw new ApiError(404, 'Blog not found');
    res.json(imageInfoFor(blog));
  } catch (err) {
    next(err);
  }
});

blogsRouter.post('/:id/like', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwned(prisma.blog, tenantOf(req).id, id, 'Blog');
    const blog = await prisma.blog.update({
      where: { id },
      data: { likes: { increment: 1 } },
    });
    res.json({ likes: blog.likes });
  } catch (err) {
    next(err);
  }
});

blogsRouter.get('/:id', async (req, res, next) => {
  try {
    const blog = await prisma.blog.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!blog) throw new ApiError(404, 'Blog not found');
    res.json({ blog: serializeBlog(blog) });
  } catch (err) {
    next(err);
  }
});

const boolField = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const blogFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(50000),
  category: z.string().trim().min(1).max(100),
  author: z.string().trim().min(1).max(100),
  readTime: z.string().max(50).optional(),
  featured: boolField,
  published: boolField,
  tags: z.string().max(2000).optional(),
  metaTitle: z.string().max(200).optional(),
  metaDescription: z.string().max(300).optional(),
  imageUrl: urlOrPathSchema.optional(),
});

function parseTags(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    throw new ApiError(400, 'Invalid tags format');
  }
}

const uniqueSlug = (appId: number, title: string, excludeId?: number) =>
  uniqueSlugFor(prisma.blog, appId, slugify(title), excludeId);

/**
 * @openapi
 * /api/v1/blogs:
 *   post:
 *     summary: Create a blog post (admin)
 *     tags: [Blogs]
 *     security: [{ BearerAuth: [] }]
 */
blogsRouter.post('/', requireAdminRole, uploadBlogImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = blogFormSchema.parse(req.body);
    const slug = await uniqueSlug(appId, input.title);
    const file = req.file;

    const blog = await prisma.blog.create({
      data: {
        appId,
        title: input.title,
        slug,
        excerpt: input.excerpt,
        content: input.content,
        category: input.category,
        author: input.author,
        authorId: req.user!.id,
        readTime: input.readTime,
        featured: input.featured,
        published: input.published ?? true,
        tags: parseTags(input.tags),
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        imageUrl: !file ? input.imageUrl : undefined,
        imageFilename: file?.filename,
        imageContentType: file?.mimetype,
        imageSize: file?.size,
      },
    });

    res.status(201).json({ blog: serializeBlog(blog) });
  } catch (err) {
    next(err);
  }
});

const blogUpdateFormSchema = blogFormSchema.partial();

blogsRouter.put('/:id', requireAdminRole, uploadBlogImage.single('image'), async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = blogUpdateFormSchema.parse(req.body);
    const id = parseId(req.params.id);
    const file = req.file;
    const existing = await prisma.blog.findFirst({ where: { id, appId } });
    if (!existing) {
      removeUpload(req, 'blogs', file?.filename);
      throw new ApiError(404, 'Blog not found');
    }

    const data: Record<string, unknown> = {
      ...input,
      tags: parseTags(input.tags),
    };
    if (input.title) data.slug = await uniqueSlug(appId, input.title, id);
    if (file || input.imageUrl) removeUpload(req, 'blogs', existing.imageFilename);
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

    const blog = await prisma.blog.update({ where: { id }, data });
    res.json({ blog: serializeBlog(blog) });
  } catch (err) {
    next(err);
  }
});

blogsRouter.delete('/:id', requireAdminRole, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const blog = await prisma.blog.findFirst({ where: { id, appId: tenantOf(req).id } });
    if (!blog) throw new ApiError(404, 'Blog not found');
    await prisma.blog.delete({ where: { id } });
    removeUpload(req, 'blogs', blog.imageFilename);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
