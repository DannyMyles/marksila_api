import { NextFunction, Request, Response } from 'express';
import { App } from '@prisma/client';
import { prisma } from '../prisma';
import { env } from '../env';
import { DEFAULT_BRAND_COLORS, parseSiteSettings } from '../services/siteSettings';
import type { MailBrand } from '../mailer';

/**
 * Tenant (application) resolution.
 *
 * Every /api request must say which app it belongs to with an `X-App-Key`
 * header (e.g. `fitness`, `sos`). The frontends add it in their same-origin
 * proxy, so browsers never have to. Every route then scopes its reads and
 * writes to `req.tenant.id` — that is the isolation boundary between apps.
 *
 * The key is a public identifier, not a secret: knowing it only lets a
 * caller do what that app's own public website already allows. Privileged
 * operations additionally need that app's admin key or an admin JWT issued
 * by that same app (see adminAuth.ts / userAuth.ts).
 */
export type Tenant = Pick<
  App,
  | 'id'
  | 'key'
  | 'name'
  | 'adminKeyHash'
  | 'whatsappNumber'
  | 'contactEmail'
  | 'contactPhone'
  | 'location'
  | 'notificationEmail'
  | 'frontendUrl'
  | 'youtubeChannelHandle'
  | 'orderPrefix'
  | 'bookingPrefix'
  | 'enquiryPrefix'
  | 'tagline'
  | 'settings'
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; byKey: Map<string, Tenant> } | null = null;

async function loadApps(): Promise<Map<string, Tenant>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.byKey;
  const apps = await prisma.app.findMany({ where: { active: true } });
  const byKey = new Map(apps.map((a) => [a.key, a]));
  cache = { at: Date.now(), byKey };
  return byKey;
}

/** Drop the cached app list (after the CLI or an admin changes an app). */
export function invalidateTenantCache() {
  cache = null;
}

export async function findTenant(key: string): Promise<Tenant | undefined> {
  return (await loadApps()).get(key.trim().toLowerCase());
}

export async function resolveTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.header('x-app-key');
    if (!key) {
      return res.status(400).json({ error: 'Missing X-App-Key header' });
    }
    const tenant = await findTenant(key);
    if (!tenant) {
      return res.status(404).json({ error: 'Unknown or inactive app' });
    }
    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
}

/** The resolved tenant for a request. Only valid behind resolveTenant. */
export function tenantOf(req: Request): Tenant {
  if (!req.tenant) throw new Error('resolveTenant middleware did not run for this route');
  return req.tenant;
}

/** Base URL for links back to this app's website (emails). */
export function frontendUrlFor(tenant: Tenant): string {
  return (tenant.frontendUrl || env.frontendUrl).replace(/\/+$/, '');
}

/** Link to a page of this app's admin area (used in team alert emails). */
export function adminUrlFor(tenant: Tenant, path: string): string {
  return `${frontendUrlFor(tenant)}/admin${path.startsWith('/') ? path : `/${path}`}`;
}

/** Where this app's new-order/booking/contact alerts are emailed. */
export function notificationEmailFor(tenant: Tenant): string {
  return tenant.notificationEmail || env.adminNotificationEmail || tenant.contactEmail || '';
}

/** Branding used for this app's outgoing emails (see mailer.ts). */
export function mailBrandFor(tenant: Tenant): MailBrand {
  const settings = parseSiteSettings(tenant.settings);
  const defaults = DEFAULT_BRAND_COLORS[tenant.key] ?? { primary: '#EA580C', secondary: '#0F766E' };
  return {
    key: tenant.key,
    name: tenant.name,
    tagline: tenant.tagline,
    contactPhone: tenant.contactPhone,
    contactEmail: tenant.contactEmail,
    location: tenant.location,
    whatsappNumber: tenant.whatsappNumber,
    websiteUrl: frontendUrlFor(tenant),
    primaryColor: settings.brand?.primaryColor || defaults.primary,
    secondaryColor: settings.brand?.secondaryColor || defaults.secondary,
    hours: settings.hours,
    social: settings.social,
    footerNote: settings.email?.footerNote,
    signature: settings.email?.signature,
  };
}
