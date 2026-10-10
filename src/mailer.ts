import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { Prisma } from '@prisma/client';
import { env } from './env';
import { prisma } from './prisma';
import type { Tenant } from './middleware/tenant';
import { mailBrandFor } from './middleware/tenant';

/**
 * SMTP settings per app: SMTP_<APP>_HOST / _PORT / _USER / _PASS / MAIL_FROM_<APP>
 * (e.g. SMTP_FITNESS_USER) override the shared SMTP_* values, so each app
 * can send from its own mailbox. An app with neither has email switched off.
 */
interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function smtpConfigFor(appKey: string): SmtpConfig | null {
  const k = appKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const pick = (name: string) => process.env[`SMTP_${k}_${name}`];
  const host = pick('HOST') ?? env.smtpHost;
  if (!host) return null;
  const user = pick('USER') ?? env.smtpUser;
  return {
    host,
    port: Number(pick('PORT') ?? env.smtpPort),
    user,
    // App passwords are often copied with spaces ("abcd efgh ..."); Gmail wants them without.
    pass: (pick('PASS') ?? env.smtpPass).replace(/\s+/g, ''),
    from: process.env[`MAIL_FROM_${k}`] || (pick('HOST') ? '' : env.mailFrom) || user,
  };
}

const transporters = new Map<string, { config: SmtpConfig; transport: nodemailer.Transporter } | null>();

function transporterFor(appKey: string) {
  if (!transporters.has(appKey)) {
    const config = smtpConfigFor(appKey);
    transporters.set(
      appKey,
      config
        ? {
            config,
            transport: nodemailer.createTransport({
              host: config.host,
              port: config.port,
              secure: config.port === 465,
              auth: config.user ? { user: config.user, pass: config.pass } : undefined,
            }),
          }
        : null
    );
  }
  return transporters.get(appKey) ?? null;
}

export const isEmailConfigured = (appKey: string) => Boolean(transporterFor(appKey));

/** Checks the login with the mail server without sending anything. */
export async function verifyEmailSettings(appKey: string): Promise<{ ok: boolean; error?: string }> {
  const t = transporterFor(appKey);
  if (!t) return { ok: false, error: 'Email is not configured for this app.' };
  try {
    await t.transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Who an email is sent on behalf of. The backend serves several apps, so
 * every email is rendered with the branding of the app it belongs to — an
 * SOS email never carries Fitness branding. See mailBrandFor() in tenant.ts.
 */
export interface MailBrand {
  key: string;
  name: string;
  tagline?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  location?: string | null;
  whatsappNumber?: string | null;
  websiteUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  hours?: string;
  social?: Partial<Record<'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'x' | 'linkedin', string>>;
  footerNote?: string;
  signature?: string;
}

// ---------------------------------------------------------------------------
// Content model: templates describe WHAT to say; renderHtml/renderText decide
// how it looks, so every email (and its plain-text fallback) stays consistent.
// ---------------------------------------------------------------------------

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type Section =
  | { type: 'details'; heading?: string; rows: [string, string | null | undefined][] }
  | {
      type: 'items';
      heading?: string;
      items: { name: string; detail?: string; amount: string }[];
      totals: { label: string; value: string; emphasis?: boolean }[];
    }
  | { type: 'callout'; tone: Tone; heading?: string; text: string }
  | { type: 'message'; heading?: string; text: string }
  | { type: 'qr'; cid: string; caption: string }
  | { type: 'list'; heading?: string; items: string[]; ordered?: boolean }
  | { type: 'paragraphs'; text: string[] };

export interface EmailContent {
  preheader: string;
  eyebrow?: string;
  title: string;
  intro?: string[];
  status?: { label: string; tone: Tone };
  reference?: { label: string; value: string };
  sections?: Section[];
  cta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  outro?: string[];
  unsubscribeUrl?: string;
  /** Who the email is for — controls the sign-off and footer wording. */
  audience?: 'customer' | 'team';
}

export interface EmailTemplate {
  subject: string;
  content: EmailContent;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safeUrl = (url: string) => (/^(https?:|mailto:|tel:)/i.test(url) ? escapeHtml(url) : '#');

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = '#18181b';
const BODY = '#3f3f46';
const MUTED = '#71717a';
const LINE = '#e4e4e7';
const SOFT = '#f4f4f5';

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  success: { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  warning: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  danger: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  info: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
  neutral: { bg: SOFT, fg: '#3f3f46', border: LINE },
};

/** Light tint of a brand colour for backgrounds (mixes with white). */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const para = (t: string, style = '') =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BODY};${style}">${escapeHtml(t).replace(/\n/g, '<br>')}</p>`;

const sectionHeading = (h?: string) =>
  h
    ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${escapeHtml(h)}</p>`
    : '';

function button(cta: { label: string; url: string }, color: string, ghost = false): string {
  const bg = ghost ? '#ffffff' : color;
  const fg = ghost ? color : '#ffffff';
  // Bulletproof button: the table cell carries the colour so Outlook (which
  // ignores padding on <a>) still shows a solid, clickable block.
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
      <tr>
        <td align="center" bgcolor="${bg}" style="border-radius:10px;background:${bg};${ghost ? `border:2px solid ${color};` : ''}">
          <a href="${safeUrl(cta.url)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:${fg};text-decoration:none;border-radius:10px;">${escapeHtml(cta.label)}</a>
        </td>
      </tr>
    </table>`;
}

function renderSection(s: Section, brand: MailBrand): string {
  switch (s.type) {
    case 'paragraphs':
      return s.text.map((t) => para(t)).join('');
    case 'details': {
      const rows = s.rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (!rows.length) return '';
      return `
        <div style="margin:0 0 20px;">
          ${sectionHeading(s.heading)}
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${LINE};border-radius:12px;border-collapse:separate;">
            ${rows
              .map(
                ([label, value], i) => `
              <tr class="stack">
                <td width="38%" style="padding:12px 16px;font-size:13px;color:${MUTED};vertical-align:top;${i ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(label)}</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:600;color:${INK};vertical-align:top;${i ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(String(value)).replace(/\n/g, '<br>')}</td>
              </tr>`
              )
              .join('')}
          </table>
        </div>`;
    }
    case 'items':
      return `
        <div style="margin:0 0 20px;">
          ${sectionHeading(s.heading)}
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${LINE};border-radius:12px;border-collapse:separate;">
            ${s.items
              .map(
                (item, i) => `
              <tr>
                <td style="padding:12px 16px;${i ? `border-top:1px solid ${LINE};` : ''}">
                  <p style="margin:0;font-size:14px;font-weight:600;color:${INK};">${escapeHtml(item.name)}</p>
                  ${item.detail ? `<p style="margin:2px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(item.detail)}</p>` : ''}
                </td>
                <td align="right" style="padding:12px 16px;font-size:14px;font-weight:600;color:${INK};white-space:nowrap;vertical-align:top;${i ? `border-top:1px solid ${LINE};` : ''}">${escapeHtml(item.amount)}</td>
              </tr>`
              )
              .join('')}
            ${s.totals
              .map(
                (t) => `
              <tr>
                <td style="padding:10px 16px;border-top:1px solid ${LINE};font-size:${t.emphasis ? 16 : 13}px;font-weight:${t.emphasis ? 800 : 500};color:${t.emphasis ? INK : MUTED};background:${SOFT};">${escapeHtml(t.label)}</td>
                <td align="right" style="padding:10px 16px;border-top:1px solid ${LINE};font-size:${t.emphasis ? 16 : 13}px;font-weight:800;color:${t.emphasis ? brand.primaryColor : INK};background:${SOFT};white-space:nowrap;">${escapeHtml(t.value)}</td>
              </tr>`
              )
              .join('')}
          </table>
        </div>`;
    case 'callout': {
      const t = TONES[s.tone];
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;">
          <tr>
            <td style="background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:14px 16px;">
              ${s.heading ? `<p style="margin:0 0 4px;font-size:14px;font-weight:700;color:${t.fg};">${escapeHtml(s.heading)}</p>` : ''}
              <p style="margin:0;font-size:14px;line-height:1.55;color:${t.fg};">${escapeHtml(s.text).replace(/\n/g, '<br>')}</p>
            </td>
          </tr>
        </table>`;
    }
    case 'message':
      return `
        <div style="margin:0 0 20px;">
          ${sectionHeading(s.heading)}
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="border-left:4px solid ${brand.primaryColor};background:${tint(brand.primaryColor, 0.92)};border-radius:0 12px 12px 0;padding:14px 16px;font-size:14px;line-height:1.6;color:${INK};">${escapeHtml(s.text).replace(/\n/g, '<br>')}</td>
            </tr>
          </table>
        </div>`;
    case 'list': {
      const tag = s.ordered ? 'ol' : 'ul';
      return `
        <div style="margin:0 0 20px;">
          ${sectionHeading(s.heading)}
          <${tag} style="margin:0;padding:0 0 0 20px;color:${BODY};font-size:14px;line-height:1.7;">
            ${s.items.map((i) => `<li style="margin:0 0 4px;">${escapeHtml(i)}</li>`).join('')}
          </${tag}>
        </div>`;
    }
    case 'qr':
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;">
          <tr>
            <td align="center" style="border:2px dashed ${LINE};border-radius:12px;padding:20px;">
              <img src="cid:${s.cid}" width="170" height="170" alt="QR code" style="display:block;width:170px;height:170px;border:0;" />
              <p style="margin:10px 0 0;font-size:12px;color:${MUTED};">${escapeHtml(s.caption)}</p>
            </td>
          </tr>
        </table>`;
  }
}

function contactParts(brand: MailBrand) {
  const parts: { label: string; href?: string }[] = [];
  if (brand.contactPhone) parts.push({ label: brand.contactPhone, href: `tel:${brand.contactPhone.replace(/[^\d+]/g, '')}` });
  if (brand.whatsappNumber) parts.push({ label: 'WhatsApp', href: `https://wa.me/${brand.whatsappNumber.replace(/\D/g, '')}` });
  if (brand.contactEmail) parts.push({ label: brand.contactEmail, href: `mailto:${brand.contactEmail}` });
  return parts;
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X',
  linkedin: 'LinkedIn',
};

function socialLinks(brand: MailBrand) {
  return Object.entries(brand.social ?? {})
    .filter(([, url]) => url && /^https?:\/\//.test(url))
    .map(([key, url]) => ({ label: SOCIAL_LABELS[key] ?? key, url: url as string }));
}

export function renderHtml(subject: string, c: EmailContent, brand: MailBrand, hasLogo: boolean): string {
  const primary = brand.primaryColor;
  const year = new Date().getFullYear();
  const footerLink = `color:${MUTED};text-decoration:underline;`;
  const contacts = contactParts(brand)
    .map((p) => (p.href ? `<a href="${safeUrl(p.href)}" style="${footerLink}">${escapeHtml(p.label)}</a>` : escapeHtml(p.label)))
    .join(' &nbsp;&middot;&nbsp; ');
  const socials = socialLinks(brand)
    .map((s) => `<a href="${safeUrl(s.url)}" style="${footerLink}">${escapeHtml(s.label)}</a>`)
    .join(' &nbsp;&middot;&nbsp; ');
  const signOff =
    c.audience === 'team'
      ? `Sent automatically by the ${brand.name} website.`
      : brand.signature || `The ${brand.name} team`;

  const statusPill = c.status
    ? `<span style="display:inline-block;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.02em;background:${TONES[c.status.tone].bg};color:${TONES[c.status.tone].fg};border:1px solid ${TONES[c.status.tone].border};">${escapeHtml(c.status.label)}</span>`
    : '';
  const reference = c.reference
    ? `<span style="display:inline-block;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;background:${SOFT};color:${INK};font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${escapeHtml(c.reference.label)}: ${escapeHtml(c.reference.value)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
  img{border:0;line-height:100%;outline:none;text-decoration:none;}
  a{color:${primary};}
  @media only screen and (max-width:620px){
    .container{width:100%!important;border-radius:0!important;}
    .px{padding-left:20px!important;padding-right:20px!important;}
    .title{font-size:22px!important;}
    .stack td{display:block!important;width:100%!important;box-sizing:border-box;}
    .stack td+td{border-top:0!important;padding-top:0!important;}
    .hide-sm{display:none!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${SOFT};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(c.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${SOFT}" style="background:${SOFT};">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE};">
        <tr>
          <td bgcolor="${primary}" class="px" style="background:${primary};padding:20px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${hasLogo ? `<img src="cid:brand-logo" width="40" height="40" alt="" style="display:inline-block;vertical-align:middle;width:40px;height:40px;border-radius:10px;background:#ffffff;" />` : ''}
                  <span style="display:inline-block;vertical-align:middle;${hasLogo ? 'margin-left:10px;' : ''}font-size:18px;font-weight:800;color:#ffffff;letter-spacing:0.01em;">${escapeHtml(brand.name)}</span>
                </td>
                ${brand.tagline ? `<td align="right" class="hide-sm" style="vertical-align:middle;font-size:12px;color:#ffffff;opacity:0.9;">${escapeHtml(brand.tagline)}</td>` : ''}
              </tr>
            </table>
          </td>
        </tr>
        <tr><td bgcolor="${brand.secondaryColor}" style="height:4px;line-height:4px;font-size:0;background:${brand.secondaryColor};">&nbsp;</td></tr>
        <tr>
          <td class="px" style="padding:32px 32px 8px;">
            ${c.eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${primary};">${escapeHtml(c.eyebrow)}</p>` : ''}
            <h1 class="title" style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:800;color:${INK};">${escapeHtml(c.title)}</h1>
            ${statusPill || reference ? `<p style="margin:0 0 18px;">${statusPill}${statusPill && reference ? '&nbsp;' : ''}${reference}</p>` : ''}
            ${(c.intro ?? []).map((t) => para(t)).join('')}
            ${(c.sections ?? []).map((s) => renderSection(s, brand)).join('')}
            ${c.cta ? `<div style="margin:8px 0 ${c.secondaryCta ? 12 : 24}px;">${button(c.cta, primary)}</div>` : ''}
            ${c.secondaryCta ? `<div style="margin:0 0 24px;">${button(c.secondaryCta, primary, true)}</div>` : ''}
            ${(c.outro ?? []).map((t) => para(t, `color:${MUTED};font-size:14px;`)).join('')}
            <p style="margin:8px 0 24px;font-size:14px;color:${INK};font-weight:600;">${escapeHtml(signOff)}</p>
          </td>
        </tr>
      </table>
      <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
        <tr>
          <td class="px" align="center" style="padding:22px 32px 8px;font-size:12px;line-height:1.7;color:${MUTED};">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${INK};">${escapeHtml(brand.name)}</p>
            ${brand.location || brand.hours ? `<p style="margin:0;">${[brand.location, brand.hours].filter(Boolean).map((v) => escapeHtml(v as string)).join(' &nbsp;&middot;&nbsp; ')}</p>` : ''}
            ${contacts ? `<p style="margin:0;">${contacts}</p>` : ''}
            ${socials ? `<p style="margin:4px 0 0;">${socials}</p>` : ''}
            ${brand.websiteUrl && /^https?:/.test(brand.websiteUrl) ? `<p style="margin:4px 0 0;"><a href="${safeUrl(brand.websiteUrl)}" style="${footerLink}">${escapeHtml(brand.websiteUrl.replace(/^https?:\/\//, ''))}</a></p>` : ''}
            ${brand.footerNote ? `<p style="margin:10px 0 0;">${escapeHtml(brand.footerNote)}</p>` : ''}
            <p style="margin:10px 0 0;color:#a1a1aa;">&copy; ${year} ${escapeHtml(brand.name)}.${c.unsubscribeUrl ? ` <a href="${safeUrl(c.unsubscribeUrl)}" style="color:#a1a1aa;text-decoration:underline;">Unsubscribe</a>` : ''}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderText(c: EmailContent, brand: MailBrand): string {
  const out: string[] = [brand.name.toUpperCase(), ''];
  if (c.eyebrow) out.push(c.eyebrow.toUpperCase());
  out.push(c.title, '='.repeat(Math.min(60, c.title.length)), '');
  if (c.status) out.push(`Status: ${c.status.label}`);
  if (c.reference) out.push(`${c.reference.label}: ${c.reference.value}`);
  if (c.status || c.reference) out.push('');
  for (const t of c.intro ?? []) out.push(t, '');
  for (const s of c.sections ?? []) {
    const heading = 'heading' in s && s.heading ? s.heading : undefined;
    if (heading) out.push(`-- ${heading} --`);
    switch (s.type) {
      case 'paragraphs':
        for (const t of s.text) out.push(t, '');
        break;
      case 'details':
        for (const [label, value] of s.rows) if (value) out.push(`${label}: ${value}`);
        out.push('');
        break;
      case 'items':
        for (const i of s.items) out.push(`* ${i.name}${i.detail ? ` (${i.detail})` : ''} — ${i.amount}`);
        for (const t of s.totals) out.push(`${t.label}: ${t.value}`);
        out.push('');
        break;
      case 'callout':
      case 'message':
        out.push(s.text, '');
        break;
      case 'list':
        s.items.forEach((i, n) => out.push(`${s.ordered ? `${n + 1}.` : '*'} ${i}`));
        out.push('');
        break;
      case 'qr':
        out.push(s.caption, '');
        break;
    }
  }
  if (c.cta) out.push(`${c.cta.label}: ${c.cta.url}`);
  if (c.secondaryCta) out.push(`${c.secondaryCta.label}: ${c.secondaryCta.url}`);
  if (c.cta || c.secondaryCta) out.push('');
  for (const t of c.outro ?? []) out.push(t, '');
  out.push(c.audience === 'team' ? `Sent automatically by the ${brand.name} website.` : brand.signature || `The ${brand.name} team`);
  out.push('', '---', brand.name);
  const contact = contactParts(brand).map((p) => (p.label === 'WhatsApp' ? `WhatsApp: ${p.href}` : p.label));
  if (brand.location) out.push(brand.location);
  if (contact.length) out.push(contact.join(' | '));
  if (brand.websiteUrl) out.push(brand.websiteUrl);
  if (brand.footerNote) out.push(brand.footerNote);
  if (c.unsubscribeUrl) out.push(`Unsubscribe: ${c.unsubscribeUrl}`);
  return out.join('\n');
}

const LOGO_DIR = path.join(process.cwd(), 'assets', 'email');
const logoCache = new Map<string, Buffer | null>();

/** assets/email/<app key>.png, if present, is embedded as the header logo. */
function logoFor(key: string): Buffer | null {
  if (!logoCache.has(key)) {
    const file = path.join(LOGO_DIR, `${path.basename(key)}.png`);
    logoCache.set(key, fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  return logoCache.get(key) ?? null;
}

export function renderEmail(template: EmailTemplate, brand: MailBrand): RenderedEmail & { hasLogo: boolean } {
  const hasLogo = Boolean(logoFor(brand.key));
  return {
    subject: template.subject,
    html: renderHtml(template.subject, template.content, brand, hasLogo),
    text: renderText(template.content, brand),
    hasLogo,
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

type Attachment = { filename: string; content: Buffer; cid: string };

export interface SendMailOptions {
  to: string;
  brand: MailBrand;
  template: EmailTemplate;
  replyTo?: string;
  attachments?: Attachment[];
}

/**
 * Sends one email. Throws when SMTP isn't configured or the send fails —
 * use deliverEmail() for logged, deduplicated, non-throwing delivery.
 * The logo travels as a cid attachment so it renders even when the
 * website is on localhost and unreachable from the recipient's mail client.
 */
export async function sendMail(options: SendMailOptions): Promise<{ messageId: string }> {
  const rendered = renderEmail(options.template, options.brand);
  const logo = logoFor(options.brand.key);
  const attachments = [
    ...(logo ? [{ filename: 'logo.png', content: logo, cid: 'brand-logo' }] : []),
    ...(options.attachments ?? []),
  ];
  const t = transporterFor(options.brand.key);
  if (!t) {
    writePreview(options.brand.key, options.to, rendered, options.attachments);
    throw new Error('Email is not configured on the server (set SMTP_HOST).');
  }
  const info = await t.transport.sendMail({
    from: `"${options.brand.name.replace(/"/g, '')}" <${t.config.from}>`,
    to: options.to,
    replyTo: options.replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments,
  });
  console.log(`[mailer] Sent "${rendered.subject}" to ${options.to} (messageId: ${info.messageId})`);
  return { messageId: String(info.messageId ?? '') };
}

/** Dev aid: with MAIL_PREVIEW_DIR set and no SMTP, emails are saved as files. */
function writePreview(appKey: string, to: string, rendered: RenderedEmail, attachments: Attachment[] = []) {
  if (!env.mailPreviewDir) return;
  try {
    fs.mkdirSync(env.mailPreviewDir, { recursive: true });
    const base = path.join(
      env.mailPreviewDir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${appKey}-${rendered.subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`
    );
    const logo = logoFor(appKey);
    const inline = [...(logo ? [{ cid: 'brand-logo', content: logo }] : []), ...attachments];
    const html = inline.reduce(
      (out, a) => out.split(`cid:${a.cid}`).join(`data:image/png;base64,${a.content.toString('base64')}`),
      rendered.html
    );
    fs.writeFileSync(`${base}.html`, html);
    fs.writeFileSync(`${base}.txt`, `To: ${to}\nSubject: ${rendered.subject}\n\n${rendered.text}`);
  } catch (err) {
    console.error('[mailer] Could not write preview:', err);
  }
}

export interface DeliverOptions {
  tenant: Tenant;
  kind: string;
  to: string | null | undefined;
  template: EmailTemplate;
  /** Same key twice (per app) = second call is a no-op. Omit for always-send. */
  dedupeKey?: string;
  entity?: { type: string; id: number };
  replyTo?: string;
  attachments?: Attachment[] | (() => Promise<Attachment[]>);
}

export type DeliveryStatus = 'sent' | 'failed' | 'skipped' | 'duplicate' | 'no_recipient';

/**
 * Logged, deduplicated delivery that never throws: the outcome is recorded
 * in EmailLog (visible to admins) and returned so callers can tell the user.
 */
export async function deliverEmail(opts: DeliverOptions): Promise<{ status: DeliveryStatus; error?: string; logId?: number }> {
  const to = opts.to?.trim();
  if (!to) return { status: 'no_recipient' };

  let logId: number;
  try {
    const log = await prisma.emailLog.create({
      data: {
        appId: opts.tenant.id,
        kind: opts.kind,
        to: to.slice(0, 255),
        subject: opts.template.subject.slice(0, 255),
        dedupeKey: opts.dedupeKey?.slice(0, 150),
        entityType: opts.entity?.type,
        entityId: opts.entity?.id,
        status: 'queued',
      },
    });
    logId = log.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'duplicate' };
    }
    console.error('[mailer] Could not write email log:', err);
    return { status: 'failed', error: 'Could not record email' };
  }

  const brand = mailBrandFor(opts.tenant);
  try {
    const attachments = typeof opts.attachments === 'function' ? await opts.attachments() : opts.attachments;
    if (!transporterFor(brand.key)) {
      writePreview(brand.key, to, renderEmail(opts.template, brand), attachments);
      const error = 'Email is not configured on the server (SMTP_HOST not set).';
      await prisma.emailLog.update({ where: { id: logId }, data: { status: 'skipped', error, attempts: { increment: 1 } } });
      console.warn(`[mailer] Skipped "${opts.template.subject}" to ${to}: ${error}`);
      return { status: 'skipped', error, logId };
    }
    const { messageId } = await sendMail({ to, brand, template: opts.template, replyTo: opts.replyTo, attachments });
    await prisma.emailLog.update({
      where: { id: logId },
      data: { status: 'sent', messageId: messageId.slice(0, 255), sentAt: new Date(), attempts: { increment: 1 } },
    });
    return { status: 'sent', logId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[mailer] Failed "${opts.template.subject}" to ${to}:`, error);
    await prisma.emailLog
      .update({ where: { id: logId }, data: { status: 'failed', error: error.slice(0, 2000), attempts: { increment: 1 } } })
      .catch(() => {});
    return { status: 'failed', error, logId };
  }
}

/** Fire-and-forget deliverEmail() for side-effect emails (record already saved). */
export function deliverEmailInBackground(opts: DeliverOptions): void {
  deliverEmail(opts).catch((err) => console.error(`[mailer] ${opts.kind}:`, err));
}

/** A one-line, user-facing summary of what happened to an email. */
export function deliveryMessage(status: DeliveryStatus, what = 'Email'): string {
  switch (status) {
    case 'sent':
      return `${what} sent.`;
    case 'duplicate':
      return `${what} was already sent earlier.`;
    case 'no_recipient':
      return `No email address on file — ${what.toLowerCase()} not sent.`;
    case 'skipped':
      return `${what} not sent: email isn't configured on the server yet.`;
    default:
      return `${what} could not be sent. Please try again later.`;
  }
}

// ---------------------------------------------------------------------------
// Templates. Values here come from the saved records; nothing is invented.
// ---------------------------------------------------------------------------

export const kes = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

export function formatDate(d: Date | string, withWeekday = true): string {
  return new Date(d).toLocaleDateString('en-KE', {
    ...(withWeekday ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  });
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export function verificationEmail(verifyUrl: string): EmailTemplate {
  return {
    subject: 'Confirm your email address',
    content: {
      preheader: 'One quick click to activate your account.',
      eyebrow: 'Welcome',
      title: 'Confirm your email',
      intro: ['Thanks for signing up! Confirm your email address to activate your account. The link expires in 24 hours.'],
      cta: { label: 'Confirm email address', url: verifyUrl },
      outro: ["If you didn't create an account, you can ignore this email.", `Button not working? Paste this link into your browser: ${verifyUrl}`],
    },
  };
}

export function passwordResetEmail(resetUrl: string): EmailTemplate {
  return {
    subject: 'Reset your password',
    content: {
      preheader: 'Use this link within the next hour to choose a new password.',
      eyebrow: 'Account security',
      title: 'Reset your password',
      intro: ['We received a request to reset your password. Choose a new one using the button below — the link expires in 1 hour.'],
      cta: { label: 'Choose a new password', url: resetUrl },
      outro: ["If you didn't ask for this, you can ignore this email — your password won't change.", `Link: ${resetUrl}`],
    },
  };
}

// --- Enquiries (contact messages, service & corporate bookings, quotes) -----

export interface EnquiryForEmail {
  reference: string;
  type: 'contact' | 'booking' | 'corporate' | 'quote';
  status: string;
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  participants?: number | null;
  preferredDate?: Date | null;
  location?: string | null;
  serviceName?: string | null;
  packageName?: string | null;
  estimate?: number | null;
  quotedAmount?: number | null;
  message?: string | null;
}

const ENQUIRY_NOUN: Record<EnquiryForEmail['type'], string> = {
  contact: 'message',
  booking: 'booking request',
  corporate: 'corporate booking request',
  quote: 'quotation request',
};

function enquiryRows(e: EnquiryForEmail, forTeam: boolean): [string, string | null | undefined][] {
  return [
    ['Service', e.serviceName],
    ['Package', e.packageName],
    ['Company', e.company],
    ['Participants', e.participants ? people(e.participants) : null],
    ['Preferred date', e.preferredDate ? formatDate(e.preferredDate) : null],
    ['Location', e.location],
    ['Estimate', e.estimate ? `${kes(e.estimate)} (to be confirmed)` : null],
    ['Quoted price', e.quotedAmount ? kes(e.quotedAmount) : null],
    ...(forTeam
      ? ([
          ['Name', e.name],
          ['Phone', e.phone],
          ['Email', e.email],
        ] as [string, string | null | undefined][])
      : []),
  ];
}

export function enquiryReceivedEmail(e: EnquiryForEmail, opts: { whatsappUrl?: string; siteUrl: string }): EmailTemplate {
  const noun = ENQUIRY_NOUN[e.type];
  const isContact = e.type === 'contact';
  return {
    subject: isContact ? `We've received your message (${e.reference})` : `We've received your ${noun} — ${e.reference}`,
    content: {
      preheader: `Thanks ${e.name.split(' ')[0]} — we'll be in touch shortly about ${e.serviceName ?? 'your enquiry'}.`,
      eyebrow: isContact ? 'Message received' : 'Request received',
      title: `Thanks, ${e.name.split(' ')[0]}!`,
      status: { label: 'Received — awaiting confirmation', tone: 'warning' },
      reference: { label: 'Ref', value: e.reference },
      intro: [
        isContact
          ? "We've received your message and a member of the team will reply as soon as possible."
          : `We've received your ${noun}. Nothing is booked yet — we'll contact you to confirm availability, the final price and next steps.`,
      ],
      sections: [
        { type: 'details', heading: 'Your request', rows: enquiryRows(e, false) },
        ...(e.message ? [{ type: 'message' as const, heading: isContact ? 'Your message' : 'Special requirements', text: e.message }] : []),
        ...(isContact
          ? []
          : [
              {
                type: 'list' as const,
                heading: 'What happens next',
                ordered: true,
                items: [
                  'We review your request and check availability.',
                  e.type === 'booking' ? 'We confirm the date, price and payment details with you.' : 'We send you a tailored quote.',
                  'Your booking is confirmed once you accept — you will get a confirmation email.',
                ],
              },
            ]),
      ],
      cta: opts.whatsappUrl ? { label: 'Continue on WhatsApp', url: opts.whatsappUrl } : { label: 'Visit our website', url: opts.siteUrl },
      outro: [`Please quote ${e.reference} in any message to us.`],
    },
  };
}

export function enquiryAlertEmail(e: EnquiryForEmail, adminUrl: string): EmailTemplate {
  const noun = ENQUIRY_NOUN[e.type];
  return {
    subject: `New ${noun}: ${e.serviceName ?? e.name} (${e.reference})`,
    content: {
      audience: 'team',
      preheader: `${e.name}${e.company ? ` (${e.company})` : ''} · ${e.phone}`,
      eyebrow: `New ${noun}`,
      title: e.company ? `${e.company} — ${e.serviceName ?? 'enquiry'}` : `${e.name}${e.serviceName ? ` — ${e.serviceName}` : ''}`,
      reference: { label: 'Ref', value: e.reference },
      sections: [
        { type: 'details', heading: 'Details', rows: enquiryRows(e, true) },
        ...(e.message ? [{ type: 'message' as const, heading: 'Message', text: e.message }] : []),
      ],
      cta: { label: 'Open in admin', url: adminUrl },
      secondaryCta: { label: 'WhatsApp the customer', url: `https://wa.me/${toWaNumber(e.phone)}` },
    },
  };
}

const ENQUIRY_STATUS: Record<string, { label: string; tone: Tone; title: string; text: string }> = {
  new: { label: 'Received', tone: 'warning', title: 'We have your request', text: "We've received your request and will be in touch shortly." },
  contacted: { label: 'In progress', tone: 'info', title: "We're on it", text: "We're working on your request and will get back to you shortly." },
  quoted: { label: 'Quote ready', tone: 'info', title: 'Your quote is ready', text: 'Here is our quote for your request. Reply or message us on WhatsApp to accept it or ask questions.' },
  confirmed: { label: 'Confirmed', tone: 'success', title: "You're confirmed!", text: 'Great news — your booking is confirmed. We look forward to seeing you.' },
  completed: { label: 'Completed', tone: 'success', title: 'Thank you!', text: 'Thanks for choosing us. We hope you enjoyed it and would love to hear your feedback.' },
  cancelled: { label: 'Cancelled', tone: 'danger', title: 'Your request was cancelled', text: 'Your request has been cancelled. If this is unexpected, or you would like to rebook, just get in touch.' },
};

export function enquiryUpdateEmail(e: EnquiryForEmail, opts: { note?: string; whatsappUrl?: string }): EmailTemplate {
  const s = ENQUIRY_STATUS[e.status] ?? ENQUIRY_STATUS.contacted;
  return {
    subject: `${s.label}: ${e.serviceName ?? 'your request'} (${e.reference})`,
    content: {
      preheader: s.text,
      eyebrow: 'Update on your request',
      title: s.title,
      status: { label: s.label, tone: s.tone },
      reference: { label: 'Ref', value: e.reference },
      intro: [`Hi ${e.name.split(' ')[0]},`, s.text],
      sections: [
        ...(opts.note ? [{ type: 'message' as const, heading: 'Note from the team', text: opts.note }] : []),
        { type: 'details', heading: 'Request summary', rows: enquiryRows(e, false) },
      ],
      cta: opts.whatsappUrl ? { label: 'Message us on WhatsApp', url: opts.whatsappUrl } : undefined,
    },
  };
}

// --- Event / adventure bookings ---------------------------------------------

export interface BookingForEmail {
  ticketNumber: string;
  attendeeName: string;
  attendeePhone: string;
  attendeeEmail?: string | null;
  participants: number;
  total: number;
  notes?: string | null;
  status: string;
  event: { title: string; date: Date; time: string; location: string; price: number };
}

function bookingRows(b: BookingForEmail): [string, string | null | undefined][] {
  return [
    ['Date', formatDate(b.event.date)],
    ['Time', b.event.time],
    ['Location', b.event.location],
    ['Participants', people(b.participants)],
    ['Total', b.event.price > 0 ? `${kes(b.total)} (${kes(b.event.price)} per person)` : 'To be confirmed'],
  ];
}

export function bookingReceivedEmail(b: BookingForEmail, opts: { whatsappUrl?: string; withQr: boolean }): EmailTemplate {
  return {
    subject: `Booking received: ${b.event.title} — ${b.ticketNumber}`,
    content: {
      preheader: `${b.event.title} on ${formatDate(b.event.date, false)}. We'll confirm your spot shortly.`,
      eyebrow: 'Booking received',
      title: `You're almost in, ${b.attendeeName.split(' ')[0]}!`,
      status: { label: 'Pending confirmation', tone: 'warning' },
      reference: { label: 'Ref', value: b.ticketNumber },
      intro: [
        `We're holding ${b.participants === 1 ? 'a spot' : `${b.participants} spots`} for you on ${b.event.title}. Your booking is confirmed once we've agreed the details and payment with you on WhatsApp.`,
      ],
      sections: [
        { type: 'details', heading: b.event.title, rows: bookingRows(b) },
        ...(b.notes ? [{ type: 'message' as const, heading: 'Your notes', text: b.notes }] : []),
        ...(opts.withQr ? [{ type: 'qr' as const, cid: 'qr-ticket', caption: `Show this code at check-in · ${b.ticketNumber}` }] : []),
      ],
      cta: opts.whatsappUrl ? { label: 'Confirm on WhatsApp', url: opts.whatsappUrl } : undefined,
      outro: ['Opening WhatsApp does not confirm the booking by itself — we will reply to confirm.'],
    },
  };
}

export function bookingAlertEmail(b: BookingForEmail, adminUrl: string): EmailTemplate {
  return {
    subject: `New booking: ${b.event.title} — ${people(b.participants)} (${b.ticketNumber})`,
    content: {
      audience: 'team',
      preheader: `${b.attendeeName} · ${b.attendeePhone}`,
      eyebrow: 'New booking',
      title: b.event.title,
      reference: { label: 'Ref', value: b.ticketNumber },
      sections: [
        {
          type: 'details',
          heading: 'Booking',
          rows: [['Name', b.attendeeName], ['Phone', b.attendeePhone], ['Email', b.attendeeEmail], ...bookingRows(b)],
        },
        ...(b.notes ? [{ type: 'message' as const, heading: 'Notes', text: b.notes }] : []),
      ],
      cta: { label: 'Open bookings', url: adminUrl },
      secondaryCta: { label: 'WhatsApp the customer', url: `https://wa.me/${toWaNumber(b.attendeePhone)}` },
    },
  };
}

const BOOKING_STATUS: Record<string, { label: string; tone: Tone; title: string; text: string }> = {
  pending: { label: 'Pending', tone: 'warning', title: 'Your booking is pending', text: "Your booking is pending — we'll confirm it with you shortly." },
  confirmed: { label: 'Confirmed', tone: 'success', title: "You're confirmed!", text: 'Your spot is confirmed. See you there — arrive 15 minutes early and bring water.' },
  completed: { label: 'Completed', tone: 'success', title: 'Thanks for joining us!', text: 'Thank you for joining us. We hope you had a great time — we would love to see you again soon.' },
  cancelled: { label: 'Cancelled', tone: 'danger', title: 'Your booking was cancelled', text: 'Your booking has been cancelled and the spots released. If this is unexpected, just get in touch.' },
};

export function bookingStatusEmail(b: BookingForEmail, opts: { whatsappUrl?: string; siteUrl: string }): EmailTemplate {
  const s = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.pending;
  return {
    subject: `${s.label}: ${b.event.title} — ${b.ticketNumber}`,
    content: {
      preheader: s.text,
      eyebrow: 'Booking update',
      title: s.title,
      status: { label: s.label, tone: s.tone },
      reference: { label: 'Ref', value: b.ticketNumber },
      intro: [`Hi ${b.attendeeName.split(' ')[0]},`, s.text],
      sections: [{ type: 'details', heading: b.event.title, rows: bookingRows(b) }],
      cta:
        b.status === 'cancelled' || b.status === 'completed'
          ? { label: 'Browse upcoming dates', url: opts.siteUrl }
          : opts.whatsappUrl
            ? { label: 'Questions? WhatsApp us', url: opts.whatsappUrl }
            : undefined,
    },
  };
}

export function bookingReminderEmail(b: BookingForEmail, opts: { whatsappUrl?: string }): EmailTemplate {
  return {
    subject: `Reminder: ${b.event.title} on ${formatDate(b.event.date, false)}`,
    content: {
      preheader: `${b.event.time} · ${b.event.location}`,
      eyebrow: 'Reminder',
      title: 'See you soon!',
      status: { label: 'Confirmed', tone: 'success' },
      reference: { label: 'Ref', value: b.ticketNumber },
      intro: [`Hi ${b.attendeeName.split(' ')[0]}, this is a friendly reminder about your upcoming booking.`],
      sections: [
        { type: 'details', heading: b.event.title, rows: bookingRows(b) },
        {
          type: 'list',
          heading: 'Before you go',
          items: ['Arrive 15 minutes early for check-in.', 'Bring water, comfortable shoes and weather-appropriate clothing.', `Have your reference (${b.ticketNumber}) ready.`],
        },
      ],
      cta: opts.whatsappUrl ? { label: 'Message us on WhatsApp', url: opts.whatsappUrl } : undefined,
    },
  };
}

// --- Shop orders --------------------------------------------------------------

interface OrderForEmail {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string | null;
  items: { name: string; price: number; quantity: number; size?: string | null; color?: string | null }[];
  subtotal: number;
  total: number;
  shippingAddress?: string;
  status?: string;
}

function orderItemsSection(o: OrderForEmail): Section {
  return {
    type: 'items',
    heading: 'Your items',
    items: o.items.map((i) => ({
      name: i.name,
      detail: [`Qty ${i.quantity}`, i.color, i.size].filter(Boolean).join(' · '),
      amount: kes(i.price * i.quantity),
    })),
    totals: [
      { label: 'Subtotal', value: kes(o.subtotal) },
      { label: 'Delivery', value: 'Free' },
      { label: 'Total', value: kes(o.total), emphasis: true },
    ],
  };
}

export function orderConfirmationEmail(o: OrderForEmail, opts: { whatsappUrl?: string } = {}): EmailTemplate {
  return {
    subject: `Order received — ${o.orderNumber}`,
    content: {
      preheader: `${o.items.length} item${o.items.length === 1 ? '' : 's'} · ${kes(o.total)}. We'll confirm on WhatsApp.`,
      eyebrow: 'Order received',
      title: `Thanks for your order, ${o.customerName.split(' ')[0]}!`,
      status: { label: 'Awaiting confirmation', tone: 'warning' },
      reference: { label: 'Order', value: o.orderNumber },
      intro: ["We've received your order and will confirm availability, delivery and payment with you on WhatsApp."],
      sections: [orderItemsSection(o), { type: 'details', heading: 'Delivery', rows: [['Deliver to', o.shippingAddress]] }],
      cta: opts.whatsappUrl ? { label: 'Confirm on WhatsApp', url: opts.whatsappUrl } : undefined,
    },
  };
}

export function orderAlertEmail(o: OrderForEmail, adminUrl: string): EmailTemplate {
  return {
    subject: `New order: ${o.orderNumber} (${kes(o.total)})`,
    content: {
      audience: 'team',
      preheader: `${o.customerName} · ${o.customerPhone ?? ''}`,
      eyebrow: 'New order',
      title: `${o.customerName} — ${kes(o.total)}`,
      reference: { label: 'Order', value: o.orderNumber },
      sections: [
        { type: 'details', heading: 'Customer', rows: [['Name', o.customerName], ['Phone', o.customerPhone], ['Email', o.customerEmail], ['Deliver to', o.shippingAddress]] },
        orderItemsSection(o),
      ],
      cta: { label: 'Open order', url: adminUrl },
      secondaryCta: o.customerPhone ? { label: 'WhatsApp the customer', url: `https://wa.me/${toWaNumber(o.customerPhone)}` } : undefined,
    },
  };
}

const ORDER_STATUS: Record<string, { label: string; tone: Tone; text: string }> = {
  pending: { label: 'Received', tone: 'warning', text: 'Your order has been received.' },
  confirmed: { label: 'Confirmed', tone: 'success', text: "Your order is confirmed and we're getting it ready." },
  shipped: { label: 'On its way', tone: 'info', text: 'Your order is on its way to you.' },
  delivered: { label: 'Delivered', tone: 'success', text: 'Your order has been delivered — enjoy!' },
  cancelled: { label: 'Cancelled', tone: 'danger', text: 'Your order has been cancelled. If this is unexpected, please get in touch.' },
};

export function orderStatusUpdateEmail(o: OrderForEmail): EmailTemplate {
  const s = ORDER_STATUS[o.status ?? 'pending'] ?? { label: o.status ?? '', tone: 'neutral' as Tone, text: `Your order is now ${o.status}.` };
  return {
    subject: `Order ${o.orderNumber}: ${s.label}`,
    content: {
      preheader: s.text,
      eyebrow: 'Order update',
      title: s.text,
      status: { label: s.label, tone: s.tone },
      reference: { label: 'Order', value: o.orderNumber },
      intro: [`Hi ${o.customerName.split(' ')[0]},`],
      sections: o.items.length ? [orderItemsSection(o)] : [{ type: 'details', rows: [['Order total', kes(o.total)]] }],
    },
  };
}

export function newsletterCampaignEmail(data: { subject: string; message: string; unsubscribeUrl: string }): EmailTemplate {
  const paragraphs = data.message.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    subject: data.subject,
    content: {
      preheader: paragraphs[0]?.slice(0, 120) ?? data.subject,
      eyebrow: 'Newsletter',
      title: data.subject,
      sections: [{ type: 'paragraphs', text: paragraphs }],
      unsubscribeUrl: data.unsubscribeUrl,
    },
  };
}

/** Customer phone as a wa.me number (Kenyan 07…/01… → 2547…/2541…). */
function toWaNumber(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 10) return `254${d.slice(1)}`;
  return d;
}
