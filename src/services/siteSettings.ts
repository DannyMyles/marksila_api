import { z } from 'zod';
import { urlOrPathSchema } from '../utils/validation';

/**
 * Editable website content stored as JSON on App.settings. Everything here
 * is public (it is what the websites render), so never put secrets in it.
 * Every field is optional: the frontends fall back to sensible copy.
 */
const text = (max: number) => z.string().trim().max(max);
const optionalUrl = z.union([urlOrPathSchema, z.literal('')]).optional();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #FF6B35');

const titled = z.object({ title: text(80), text: text(400) });

export const siteSettingsSchema = z
  .object({
    brand: z
      .object({
        primaryColor: z.union([hexColor, z.literal('')]),
        secondaryColor: z.union([hexColor, z.literal('')]),
        logoUrl: optionalUrl,
      })
      .partial(),
    hero: z
      .object({
        eyebrow: text(120),
        title: text(120),
        highlight: text(120),
        subtitle: text(600),
        imageUrl: optionalUrl,
        primaryCtaLabel: text(40),
        primaryCtaUrl: optionalUrl,
        secondaryCtaLabel: text(40),
        secondaryCtaUrl: optionalUrl,
        perks: z.array(text(60)).max(6),
      })
      .partial(),
    social: z
      .object({
        instagram: optionalUrl,
        facebook: optionalUrl,
        tiktok: optionalUrl,
        youtube: optionalUrl,
        x: optionalUrl,
        linkedin: optionalUrl,
      })
      .partial(),
    hours: text(120),
    secondaryEmail: z.union([z.string().trim().email().max(255), z.literal('')]),
    mapUrl: optionalUrl,
    about: z
      .object({
        headline: text(160),
        body: text(4000),
        mission: text(1000),
        vision: text(1000),
        story: text(6000), // paragraphs separated by blank lines
        imageUrl: optionalUrl,
      })
      .partial(),
    team: z
      .array(
        z.object({
          name: text(80),
          role: text(80),
          bio: text(600),
          imageUrl: optionalUrl,
          expertise: z.array(text(40)).max(8).default([]),
        })
      )
      .max(12),
    // Banner copy of inner pages, keyed by page (e.g. "services", "contact").
    pages: z
      .record(
        z.string().regex(/^[a-z0-9-]{1,40}$/),
        z
          .object({
            eyebrow: text(80),
            title: text(120),
            highlight: text(80),
            subtitle: text(400),
            imageUrl: optionalUrl,
          })
          .partial()
      )
      .refine((v) => Object.keys(v).length <= 30, 'Too many pages'),
    stats: z.array(z.object({ value: text(20), label: text(60) })).max(8),
    steps: z.array(titled).max(6),
    highlights: z.array(titled).max(9),
    values: z.array(titled).max(9),
    corporate: z
      .object({
        headline: text(160),
        subtitle: text(600),
        imageUrl: optionalUrl,
        minGroupForQuote: z.number().int().min(1).max(10000),
      })
      .partial(),
    booking: z
      .object({
        // Shown wherever the customer is sent to WhatsApp.
        whatsappNotice: text(300),
        successMessage: text(300),
      })
      .partial(),
    email: z
      .object({
        footerNote: text(300),
        signature: text(120),
      })
      .partial(),
    seo: z.object({ description: text(300) }).partial(),
  })
  .partial()
  .strict();

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export function parseSiteSettings(raw: string | null | undefined): SiteSettings {
  if (!raw) return {};
  try {
    const parsed = siteSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Shallow-merges each section so saving one section keeps the others. */
export function mergeSiteSettings(current: SiteSettings, patch: SiteSettings): SiteSettings {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    const isPlainObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
    out[key] = isPlainObject(value) && isPlainObject(existing) ? { ...(existing as object), ...(value as object) } : value;
  }
  return out as SiteSettings;
}

export const DEFAULT_BRAND_COLORS: Record<string, { primary: string; secondary: string }> = {
  fitness: { primary: '#FF6B35', secondary: '#0BA154' },
  sos: { primary: '#EA580C', secondary: '#059669' },
};
