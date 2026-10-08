import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Validation failed';
    return res.status(400).json({ error: message, details: err.flatten() });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Record missing (update/delete of something that isn't there — or that
    // belongs to another app, which is deliberately indistinguishable).
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'A record with these details already exists' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'This record is still in use' });
  }
  if (err instanceof Error && /Only image uploads|File too large/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
