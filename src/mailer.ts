import nodemailer from 'nodemailer';
import { env } from './env';
import { BRAND_LOGO_PNG_BASE64 } from './emailAssets';

const transporter = env.smtpHost
  ? nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    })
  : null;

const LOGO_BUFFER = Buffer.from(BRAND_LOGO_PNG_BASE64, 'base64');
const LOGO_CID = 'marksila-brand-logo';

/**
 * Who an email is sent on behalf of. The backend serves several apps, so
 * templates contain {{BRAND_*}} placeholders that sendMail() fills from the
 * app the email belongs to — an SOS email never carries Fitness branding.
 * Only the `fitness` app ships an embedded logo; others show their name.
 */
export interface MailBrand {
  key: string;
  name: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  location?: string | null;
}

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  brand: MailBrand;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; cid: string }[];
}

function brandHeader(brand: MailBrand): string {
  return brand.key === 'fitness'
    ? `<img src="cid:${LOGO_CID}" alt="${escapeHtml(brand.name)}" height="36" style="height:36px;width:auto;border-radius:10px;display:inline-block;" />`
    : `<span style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:0.02em;">${escapeHtml(brand.name)}</span>`;
}

function brandContact(brand: MailBrand): string {
  const parts: string[] = [];
  if (brand.location) parts.push(escapeHtml(brand.location));
  if (brand.contactPhone) {
    const tel = brand.contactPhone.replace(/[^\d+]/g, '');
    parts.push(`<a href="tel:${tel}" style="color:#94a3b8;text-decoration:none;">${escapeHtml(brand.contactPhone)}</a>`);
  }
  if (brand.contactEmail) {
    parts.push(`<a href="mailto:${escapeHtml(brand.contactEmail)}" style="color:#94a3b8;text-decoration:none;">${escapeHtml(brand.contactEmail)}</a>`);
  }
  return parts.join(' &middot; ');
}

function applyBrand(text: string, brand: MailBrand): string {
  return text
    .replace(/\{\{BRAND_HEADER\}\}/g, brandHeader(brand))
    .replace(/\{\{BRAND_CONTACT\}\}/g, brandContact(brand))
    .replace(/\{\{BRAND_NAME\}\}/g, escapeHtml(brand.name));
}

/**
 * Throws if SMTP isn't configured or the send fails — callers decide what
 * that means for them. Contact-form submissions have no fallback (the email
 * IS the outcome), so that route lets failures propagate as a real error.
 * Order emails are a side effect of an already-persisted order, so that
 * route explicitly swallows failures rather than awaiting this on the
 * critical path of a checkout response.
 *
 * Every send carries the brand logo as a cid attachment (rather than a
 * remote <img src>) so it renders in dev too, where FRONTEND_URL is
 * localhost and unreachable from the recipient's mail client.
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  if (!transporter) {
    throw new Error('Email is not configured on the server yet.');
  }
  const { brand, ...rest } = options;
  const info = await transporter.sendMail({
    from: `"${brand.name.replace(/"/g, '')}" <${env.smtpUser}>`,
    ...rest,
    subject: applyBrand(rest.subject, brand).replace(/&amp;/g, '&'),
    html: applyBrand(rest.html, brand),
    attachments: [
      ...(brand.key === 'fitness' ? [{ filename: 'logo.png', content: LOGO_BUFFER, cid: LOGO_CID }] : []),
      ...(rest.attachments ?? []),
    ],
  });
  console.log(`[mailer] Sent "${options.subject}" to ${options.to} (messageId: ${info.messageId})`);
}

/**
 * Fire-and-forget send for side-effect emails (confirmations, alerts): the
 * record is already saved, so a slow or failing SMTP server must never delay
 * or fail the API response. Skips silently when there's no recipient.
 */
export function sendMailInBackground(options: SendMailOptions, context: string): void {
  if (!options.to) return;
  sendMail(options).catch((err) => console.error(`[mailer] ${context}:`, err?.message ?? err));
}

const ORANGE = '#FF6B35';
const ORANGE_DARK = '#D44A1B';
const GRADIENT = `linear-gradient(135deg,${ORANGE} 0%,${ORANGE_DARK} 100%)`;
const INK = '#0f172a';
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Plain emoji above a heading — no colored box behind it, just a bigger
 * glyph, so it reads as an icon accent rather than a small odd-colored tile.
 */
function iconBadge(emoji: string): string {
  return `<div style="text-align:center;margin:0 0 4px;"><span style="font-size:36px;line-height:1;">${emoji}</span></div>`;
}

/**
 * Shared shell for every email: compact gradient header with the logo,
 * the content slot, and a dark footer with real contact details (matching
 * components/ui/Footer.tsx on the live site). Deliberately a plain HTML
 * fragment (no <html>/<head>) — every client this app targets (Gmail, Apple
 * Mail, Outlook web) renders that fine, and it keeps nodemailer's `html`
 * option simple. Padding throughout is kept tight on purpose — no wasted
 * vertical space above the fold.
 */
function wrap(
  bodyHtml: string,
  { center = false, unsubscribeUrl }: { center?: boolean; unsubscribeUrl?: string } = {}
): string {
  const year = new Date().getFullYear();
  return `
    <div style="background:#ffffff;padding:10px 8px;font-family:${FONT_STACK};">
      <div style="max-width:460px;margin:0 auto;border:1px solid #f1f5f9;border-radius:14px;overflow:hidden;">
        <div style="background:${GRADIENT};padding:12px 20px;text-align:center;">
          {{BRAND_HEADER}}
        </div>
        <div style="padding:16px 20px;color:${INK};line-height:1.4;font-size:14px;${center ? 'text-align:center;' : ''}">${bodyHtml}</div>
        <div style="background:${INK};color:#94a3b8;padding:12px 20px;text-align:center;font-size:11px;line-height:1.5;">
          <p style="margin:0;color:#e2e8f0;font-weight:700;font-size:12px;">{{BRAND_NAME}}</p>
          <p style="margin:2px 0 0;">{{BRAND_CONTACT}}</p>
          <p style="margin:4px 0 0;color:#64748b;">&copy; ${year} {{BRAND_NAME}}.${unsubscribeUrl ? ` <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>` : ''}</p>
        </div>
      </div>
    </div>
  `;
}

function button(url: string, label: string): string {
  return `
    <p style="text-align:center;margin:14px 0 4px;">
      <a href="${url}" style="background:${GRADIENT};color:#fff;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">${label}</a>
    </p>
  `;
}

/** Bold solid-color pill (not pastel) — reads as a punchier "status chip". */
const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  pending: { bg: '#f59e0b', label: '⏳ Pending' },
  paid: { bg: '#10b981', label: '✅ Paid' },
  shipped: { bg: '#3b82f6', label: '🚚 Shipped' },
  delivered: { bg: '#10b981', label: '📦 Delivered' },
  cancelled: { bg: '#ef4444', label: '✕ Cancelled' },
};

function statusBadge(status: string): string {
  const s = STATUS_STYLES[status] ?? { bg: '#64748b', label: status };
  return `<span style="background:${s.bg};color:#fff;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;">${s.label}</span>`;
}

function pill(text: string): string {
  return `<span style="display:inline-block;background:#f1f5f9;color:${INK};padding:4px 12px;border-radius:999px;font-family:monospace;font-size:12px;font-weight:700;">${text}</span>`;
}

function infoRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:5px 0;color:#64748b;width:90px;font-size:13px;vertical-align:top;">${label}</td>
      <td style="padding:5px 0;font-weight:600;font-size:13px;">${value}</td>
    </tr>
  `;
}

function infoCard(rowsHtml: string): string {
  return `<div style="background:#f8fafc;border-radius:10px;padding:4px 14px;"><table style="width:100%;border-collapse:collapse;">${rowsHtml}</table></div>`;
}

export function contactNotificationEmail(data: {
  name: string;
  phone: string;
  email?: string;
  service?: string;
  message: string;
}): { subject: string; html: string } {
  return {
    subject: `New contact form message from ${data.name}`,
    html: wrap(`
      ${iconBadge('💬')}
      <h2 style="margin:0 0 10px;font-size:17px;font-weight:800;text-align:center;">New website message</h2>
      ${infoCard(
        infoRow('Name', escapeHtml(data.name)) +
          infoRow('Phone', escapeHtml(data.phone)) +
          (data.email ? infoRow('Email', escapeHtml(data.email)) : '') +
          (data.service ? infoRow('Service', escapeHtml(data.service)) : '')
      )}
      <p style="color:#94a3b8;margin:14px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Message</p>
      <p style="white-space:pre-wrap;background:#fff7ed;border:1px solid #fed7aa;padding:12px;border-radius:10px;margin:0;font-size:13px;">${escapeHtml(String(data.message))}</p>
    `),
  };
}

export function orderConfirmationEmail(order: {
  orderNumber: string;
  customerName: string;
  items: { name: string; price: number; quantity: number }[];
  subtotal: number;
  total: number;
  shippingAddress: string;
}): { subject: string; html: string } {
  const itemsHtml = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 10px;background:#f8fafc;border-radius:8px 0 0 8px;font-size:13px;">${escapeHtml(String(i.name))} <span style="color:#94a3b8;">&times; ${i.quantity}</span></td>
          <td style="padding:8px 10px;background:#f8fafc;border-radius:0 8px 8px 0;text-align:right;font-weight:700;font-size:13px;">KES ${(i.price * i.quantity).toLocaleString()}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>`
    )
    .join('');
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: wrap(`
      ${iconBadge('🛍️')}
      <h2 style="margin:0 0 4px;font-size:17px;font-weight:800;text-align:center;">Thanks, ${escapeHtml(String(order.customerName))}!</h2>
      <p style="color:#64748b;margin:0 0 10px;text-align:center;font-size:13px;">Your order is in — we'll confirm it with you on WhatsApp shortly.</p>
      <p style="text-align:center;margin:0 0 12px;">${pill(order.orderNumber)}</p>
      <table style="width:100%;border-collapse:collapse;">${itemsHtml}</table>
      <table style="width:100%;border-collapse:collapse;margin-top:2px;">
        <tr><td style="padding:3px 10px;color:#64748b;font-size:13px;">Subtotal</td><td style="padding:3px 10px;text-align:right;font-size:13px;">KES ${order.subtotal.toLocaleString()}</td></tr>
        <tr><td style="padding:3px 10px;color:#64748b;font-size:13px;">Shipping</td><td style="padding:3px 10px;text-align:right;color:#10b981;font-weight:700;font-size:13px;">FREE</td></tr>
        <tr><td style="padding:8px 10px 0;font-size:15px;font-weight:800;border-top:1px dashed #e2e8f0;">Total</td><td style="padding:8px 10px 0;text-align:right;font-size:15px;font-weight:800;color:${ORANGE};border-top:1px dashed #e2e8f0;">KES ${order.total.toLocaleString()}</td></tr>
      </table>
      <div style="margin-top:10px;padding:10px;background:${GRADIENT};border-radius:10px;color:#fff;">
        <p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.85;">📍 Shipping to</p>
        <p style="margin:0;font-weight:700;font-size:13px;">${escapeHtml(String(order.shippingAddress))}</p>
      </div>
    `),
  };
}

export function orderAlertEmail(order: {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  total: number;
}): { subject: string; html: string } {
  return {
    subject: `New order: ${order.orderNumber} (KES ${order.total.toLocaleString()})`,
    html: wrap(`
      ${iconBadge('🔔')}
      <h2 style="margin:0 0 10px;font-size:17px;font-weight:800;text-align:center;">New order received</h2>
      ${infoCard(
        infoRow('Order', pill(order.orderNumber)) +
          infoRow('Customer', escapeHtml(order.customerName)) +
          infoRow('Phone', `<a href="tel:${escapeHtml(String(order.customerPhone))}" style="color:${INK};text-decoration:none;">${escapeHtml(String(order.customerPhone))}</a>`) +
          (order.customerEmail
            ? infoRow('Email', `<a href="mailto:${escapeHtml(String(order.customerEmail))}" style="color:${INK};text-decoration:none;">${escapeHtml(String(order.customerEmail))}</a>`)
            : '') +
          infoRow('Total', `<span style="color:${ORANGE};font-weight:800;">KES ${order.total.toLocaleString()}</span>`)
      )}
    `),
  };
}

export function eventTicketEmail(data: {
  ticketNumber: string;
  attendeeName: string;
  eventTitle: string;
  date: string;
  time: string;
  location: string;
  price: number;
}): { subject: string; html: string } {
  return {
    subject: `Your ticket for ${data.eventTitle} — ${data.ticketNumber}`,
    html: wrap(`
      ${iconBadge('🎟️')}
      <h2 style="margin:0 0 4px;font-size:17px;font-weight:800;text-align:center;">You're in, ${escapeHtml(String(data.attendeeName))}!</h2>
      <p style="color:#64748b;margin:0 0 14px;text-align:center;font-size:13px;">
        ${data.price > 0
          ? `Total: <strong style="color:${INK};">KES ${data.price.toLocaleString()}</strong> &mdash; we'll confirm your booking on WhatsApp.`
          : `We'll confirm your booking on WhatsApp.`}
      </p>

      <div style="border-radius:14px;overflow:hidden;">
        <div style="background:${GRADIENT};padding:12px 16px;">
          <p style="margin:0 0 2px;color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Event Ticket</p>
          <h3 style="margin:0;font-size:15px;font-weight:800;color:#fff;">${escapeHtml(String(data.eventTitle))}</h3>
        </div>
        <div style="background:#f8fafc;padding:12px 16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:3px 0;width:24px;font-size:13px;">📅</td>
              <td style="padding:3px 0;font-weight:600;font-size:13px;">${escapeHtml(String(data.date))}</td>
            </tr>
            <tr>
              <td style="padding:3px 0;font-size:13px;">🕐</td>
              <td style="padding:3px 0;font-weight:600;font-size:13px;">${escapeHtml(String(data.time))}</td>
            </tr>
            <tr>
              <td style="padding:3px 0;font-size:13px;">📍</td>
              <td style="padding:3px 0;font-weight:600;font-size:13px;">${escapeHtml(String(data.location))}</td>
            </tr>
          </table>
        </div>
        <div style="border-top:2px dashed #cbd5e1;padding:16px;text-align:center;background:#ffffff;">
          <img src="cid:qr-ticket" alt="Ticket QR code" style="width:180px;height:180px;border-radius:10px;background:#fff;padding:6px;border:1px solid #f1f5f9;" />
          <p style="margin:10px 0 0;">${pill(data.ticketNumber)}</p>
          <p style="margin:6px 0 0;color:#94a3b8;font-size:11px;">Show this QR code at check-in</p>
        </div>
      </div>
    `),
  };
}

export function eventRegistrationAlertEmail(data: {
  ticketNumber: string;
  eventTitle: string;
  attendeeName: string;
  attendeePhone: string;
  attendeeEmail?: string | null;
  participants: number;
  price: number;
}): { subject: string; html: string } {
  return {
    subject: `New booking: ${data.eventTitle} (${data.ticketNumber})`,
    html: wrap(`
      ${iconBadge('🎫')}
      <h2 style="margin:0 0 10px;font-size:17px;font-weight:800;text-align:center;">New booking</h2>
      ${infoCard(
        infoRow('Event', escapeHtml(data.eventTitle)) +
          infoRow('Attendee', escapeHtml(data.attendeeName)) +
          infoRow('Phone', `<a href="tel:${escapeHtml(String(data.attendeePhone))}" style="color:${INK};text-decoration:none;">${escapeHtml(String(data.attendeePhone))}</a>`) +
          (data.attendeeEmail
            ? infoRow('Email', `<a href="mailto:${escapeHtml(String(data.attendeeEmail))}" style="color:${INK};text-decoration:none;">${escapeHtml(String(data.attendeeEmail))}</a>`)
            : '') +
          infoRow('Participants', String(data.participants)) +
          infoRow('Reference', pill(data.ticketNumber)) +
          infoRow('Total', `<span style="color:${ORANGE};font-weight:800;">${data.price > 0 ? `KES ${data.price.toLocaleString()}` : 'To be confirmed'}</span>`)
      )}
    `),
  };
}

export function passwordResetEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: 'Reset your {{BRAND_NAME}} password',
    html: wrap(`
      ${iconBadge('🔒')}
      <h2 style="margin:0 0 4px;font-size:17px;font-weight:800;text-align:center;">Reset your password</h2>
      <p style="color:#64748b;margin:0;text-align:center;font-size:13px;">Click the button below to choose a new password. This link expires in 1 hour.</p>
      ${button(resetUrl, 'Reset Password')}
      <p style="color:#94a3b8;font-size:11px;margin:10px 0 0;text-align:center;">If you didn't request this, you can safely ignore this email &mdash; your password won't change.</p>
    `),
  };
}

export function verificationEmail(verifyUrl: string): { subject: string; html: string } {
  return {
    subject: 'Verify your {{BRAND_NAME}} email',
    html: wrap(`
      ${iconBadge('✉️')}
      <h2 style="margin:0 0 4px;font-size:17px;font-weight:800;text-align:center;">Confirm your email</h2>
      <p style="color:#64748b;margin:0;text-align:center;font-size:13px;">Click the button below to verify your email and activate your account. This link expires in 24 hours.</p>
      ${button(verifyUrl, 'Verify Email')}
      <p style="color:#94a3b8;font-size:11px;margin:10px 0 0;text-align:center;">If you didn't create an account, you can safely ignore this email.</p>
    `),
  };
}

const ORDER_STATUS_COPY: Record<string, string> = {
  pending: 'has been received',
  confirmed: 'has been confirmed',
  shipped: 'is on its way',
  delivered: 'has been delivered — enjoy!',
  cancelled: 'has been cancelled',
};

export function orderStatusUpdateEmail(data: {
  orderNumber: string;
  customerName: string;
  status: string;
  total: number;
}): { subject: string; html: string } {
  const copy = ORDER_STATUS_COPY[data.status] ?? `is now ${data.status}`;
  return {
    subject: `Order ${data.orderNumber} update`,
    html: wrap(`
      ${iconBadge('📦')}
      <h2 style="margin:0 0 6px;font-size:17px;font-weight:800;text-align:center;">Hi ${escapeHtml(data.customerName)},</h2>
      <p style="color:#64748b;margin:0 0 10px;text-align:center;font-size:13px;">Your order ${pill(data.orderNumber)} ${copy}.</p>
      <p style="margin:0 0 10px;text-align:center;">${statusBadge(data.status)}</p>
      <p style="color:#64748b;margin:0;text-align:center;font-size:13px;">Order total: <strong style="color:${INK};">KES ${data.total.toLocaleString()}</strong></p>
    `),
  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function newsletterCampaignEmail(data: {
  subject: string;
  message: string;
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  const paragraphs = data.message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 10px;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return {
    subject: data.subject,
    html: wrap(
      `
      ${iconBadge('📰')}
      <h2 style="margin:0 0 10px;font-size:17px;font-weight:800;text-align:center;">${escapeHtml(data.subject)}</h2>
      <div style="font-size:13px;color:${INK};">${paragraphs}</div>
    `,
      { unsubscribeUrl: data.unsubscribeUrl }
    ),
  };
}
