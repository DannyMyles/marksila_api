import { ApiError } from '../middleware/errorHandler';

// Any Prisma model delegate whose rows carry an appId.
interface TenantScopedDelegate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findFirst(args: any): Promise<unknown>;
}

/**
 * Throws 404 unless row `id` exists AND belongs to `appId`. Call before any
 * update/delete by id: Prisma's update/delete can only filter on unique
 * keys, so ownership is checked first. Another app's row is reported as
 * "not found" — never as "forbidden" — so ids can't be probed across apps.
 */
export async function assertOwned(delegate: TenantScopedDelegate, appId: number, id: number, label: string) {
  const row = await delegate.findFirst({ where: { id, appId }, select: { id: true } });
  if (!row) throw new ApiError(404, `${label} not found`);
}

/** First free slug for this app: "title", "title-2", "title-3", ... */
export async function uniqueSlugFor(
  delegate: TenantScopedDelegate,
  appId: number,
  base: string,
  excludeId?: number
): Promise<string> {
  const root = base || 'item';
  let slug = root;
  for (let n = 2; await delegate.findFirst({ where: { appId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) } }); n++) {
    slug = `${root}-${n}`;
  }
  return slug;
}
