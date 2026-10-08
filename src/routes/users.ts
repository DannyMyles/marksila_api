import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminRole } from '../middleware/userAuth';
import { ApiError } from '../middleware/errorHandler';
import { parseId, passwordSchema } from '../utils/validation';
import { tenantOf } from '../middleware/tenant';

export const usersRouter = Router();

usersRouter.use(requireAdminRole);

async function assertOwnUser(appId: number, id: number) {
  const user = await prisma.user.findFirst({ where: { id, appId }, select: { id: true } });
  if (!user) throw new ApiError(404, 'User not found');
}

function roleDisplayName(role: string): string {
  return role === 'admin' ? 'Administrator' : 'User';
}

function serializeUser(u: any) {
  return {
    _id: String(u.id),
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    roleId: { _id: u.role, name: roleDisplayName(u.role) },
    isActive: u.isActive,
    lastLogin: u.lastLogin ?? undefined,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/**
 * @openapi
 * /api/v1/users:
 *   get:
 *     summary: List all user accounts (admin)
 *     tags: [Users]
 *     security: [{ BearerAuth: [] }]
 */
usersRouter.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: { appId: tenantOf(req).id }, orderBy: { createdAt: 'desc' } });
    res.json({ users: users.map(serializeUser) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({ where: { id: parseId(req.params.id), appId: tenantOf(req).id } });
    if (!user) throw new ApiError(404, 'User not found');
    res.json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// The frontend's role picker sends 'admin' | 'user' directly as roleId —
// there is no separate Role collection in this backend.
const roleIdSchema = z.enum(['user', 'admin']);

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(255),
  password: passwordSchema,
  roleId: roleIdSchema,
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const appId = tenantOf(req).id;
    const input = createUserSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { appId, OR: [{ email: input.email }, { username: input.username }] },
    });
    if (existing) throw new ApiError(409, 'An account with that email or username already exists');

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        appId,
        name: input.name,
        username: input.username,
        email: input.email,
        password: passwordHash,
        role: input.roleId,
      },
    });

    res.status(201).json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  username: z.string().trim().min(1).max(50).optional(),
  email: z.string().trim().email().max(255).optional(),
  password: passwordSchema.optional(),
  roleId: roleIdSchema.optional(),
  isActive: z.boolean().optional(),
});

usersRouter.put('/:id', async (req, res, next) => {
  try {
    const input = updateUserSchema.parse(req.body);
    const id = parseId(req.params.id);
    await assertOwnUser(tenantOf(req).id, id);
    if (id === req.user!.id && (input.isActive === false || input.roleId === 'user')) {
      throw new ApiError(400, "You can't deactivate or demote your own account");
    }

    const data: Record<string, unknown> = {
      name: input.name,
      username: input.username,
      email: input.email,
      isActive: input.isActive,
    };
    if (input.roleId) data.role = input.roleId;
    if (input.password) data.password = await bcrypt.hash(input.password, 10);

    const user = await prisma.user.update({ where: { id }, data });
    res.json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    await assertOwnUser(tenantOf(req).id, id);
    if (id === req.user!.id) throw new ApiError(400, "You can't delete your own account");
    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
