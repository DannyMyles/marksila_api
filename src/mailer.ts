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

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; cid: string }[];
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
  const info = await transporter.sendMail({
    from: `"MarkSila254" <${env.smtpUser}>`,
    ...options,
    attachments: [
      { filename: 'logo.png', content: LOGO_BUFFER, cid: LOGO_CID },
      ...(options.attachments ?? []),
    ],
  });
  console.log(`[mailer] Sent "${options.subject}" to ${options.to} (messageId: ${info.messageId})`);
}

const ORANGE = '#FF6B35';
const ORANGE_DARK = '#D44A1B';
const GRADIENT = `linear-gradient(135deg,${ORANGE} 0%,${ORANGE_DARK} 100%)`;
const INK = '#0f172a';
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Icon badge floated above a heading — a small gradient "orb" with an emoji,
 * the common modern-transactional-email pattern (Stripe/Linear-style) that
 * gives each message a visual anchor without needing a custom image asset
 * per template.
 */
function iconBadge(emoji: string): string {
  return `
    <div style="width:64px;height:64px;border-radius:20px;background:${GRADIENT};display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 12px 24px -8px rgba(255,107,53,0.55);">
      <span style="font-size:30px;line-height:1;">${emoji}</span>
    </div>
  `;
}

/**
 * Shared shell for every email: gradient hero with the logo floated in a
 * white "badge" card, the content slot, and a dark footer with real contact
 * details (matching components/ui/Footer.tsx on the live site). Deliberately
 * a plain HTML fragment (no <html>/<head>) — every client this app targets
 * (Gmail, Apple Mail, Outlook web) renders that fine, and it keeps
 * nodemailer's `html` option simple.
 */
function wrap(
  bodyHtml: string,
  { center = false, unsubscribeUrl }: { center?: boolean; unsubscribeUrl?: string } = {}
): string {
  const year = new Date().getFullYear();
  return `
    <div style="background:radial-gradient(circle at 15% 0%,rgba(255,107,53,0.12),transparent 55%),radial-gradient(circle at 85% 100%,rgba(212,74,27,0.10),transparent 55%),#f1f1f4;padding:40px 14px;font-family:${FONT_STACK};">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;box-shadow:0 24px 48px -12px rgba(15,23,42,0.18);">
        <div style="background:${GRADIENT};padding:36px 32px 44px;text-align:center;position:relative;">
          <div style="display:inline-block;background:#ffffff;border-radius:18px;padding:12px 20px;box-shadow:0 16px 32px -10px rgba(0,0,0,0.35);">
            <img src="cid:${LOGO_CID}" alt="MarkSila254 Active Wear" height="40" style="height:40px;width:auto;display:block;" />
          </div>
        </div>
        <div style="padding:40px 36px;color:${INK};line-height:1.65;margin-top:-24px;background:#ffffff;border-radius:24px 24px 0 0;position:relative;${center ? 'text-align:center;' : ''}">${bodyHtml}</div>
        <div style="background:${INK};color:#94a3b8;padding:28px 32px;text-align:center;font-size:12px;line-height:1.8;">
          <div style="width:36px;height:3px;background:${GRADIENT};border-radius:999px;margin:0 auto 16px;"></div>
          <p style="margin:0 0 6px;color:#f1f5f9;font-weight:700;font-size:14px;letter-spacing:0.02em;">MarkSila254 Active Wear</p>
          <p style="margin:0 0 4px;">Nairobi, Kenya &middot; <a href="tel:+254701437959" style="color:#94a3b8;text-decoration:none;">+254 701 437 959</a> &middot; <a href="mailto:markotundo777@gmail.com" style="color:#94a3b8;text-decoration:none;">markotundo777@gmail.com</a></p>
          <p style="margin:16px 0 0;color:#64748b;">&copy; ${year} MarkSila254. All rights reserved.</p>
          ${unsubscribeUrl ? `<p style="margin:10px 0 0;"><a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from these emails</a></p>` : ''}
        </div>
      </div>
    </div>
  `;
}

function button(url: string, label: string): string {
  return `
    <p style="text-align:center;margin:32px 0 8px;">
      <a href="${url}" style="background:${GRADIENT};color:#fff;padding:16px 40px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;box-shadow:0 14px 28px -8px rgba(255,107,53,0.55);">${label}</a>
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
  return `<span style="background:${s.bg};color:#fff;padding:6px 16px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:0.01em;">${s.label}</span>`;
}

function pill(text: string): string {
  return `<span style="display:inline-block;background:#f1f5f9;color:${INK};padding:7px 16px;border-radius:999px;font-family:monospace;font-size:13px;font-weight:700;">${text}</span>`;
}

function infoRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 0;color:#64748b;width:110px;font-size:14px;vertical-align:top;">${label}</td>
      <td style="padding:10px 0;font-weight:600;font-size:14px;">${value}</td>
    </tr>
  `;
}

function infoCard(rowsHtml: string): string {
  return `<div style="background:#f8fafc;border-radius:16px;padding:4px 18px;"><table style="width:100%;border-collapse:collapse;">${rowsHtml}</table></div>`;
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
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;text-align:center;">New website message</h2>
      ${infoCard(
        infoRow('Name', data.name) +
          infoRow('Phone', data.phone) +
          (data.email ? infoRow('Email', data.email) : '') +
          (data.service ? infoRow('Service', data.service) : '')
      )}
      <p style="color:#94a3b8;margin:24px 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Message</p>
      <p style="white-space:pre-wrap;background:#fff7ed;border:1px solid #fed7aa;padding:18px;border-radius:16px;margin:0;font-size:14px;">${data.message}</p>
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
          <td style="padding:14px 16px;background:#f8fafc;border-radius:14px 0 0 14px;font-size:14px;">${i.name} <span style="color:#94a3b8;">&times; ${i.quantity}</span></td>
          <td style="padding:14px 16px;background:#f8fafc;border-radius:0 14px 14px 0;text-align:right;font-weight:700;font-size:14px;">KES ${(i.price * i.quantity).toLocaleString()}</td>
        </tr>
        <tr><td colspan="2" style="height:8px;"></td></tr>`
    )
    .join('');
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: wrap(`
      ${iconBadge('🛍️')}
      <h2 style="margin:0 0 6px;font-size:22px;font-weight:800;text-align:center;">Thanks, ${order.customerName}!</h2>
      <p style="color:#64748b;margin:0 0 20px;text-align:center;font-size:14px;">Your order is in — we'll be in touch shortly to confirm payment.</p>
      <p style="text-align:center;margin:0 0 24px;">${pill(order.orderNumber)}</p>
      <table style="width:100%;border-collapse:collapse;">${itemsHtml}</table>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;padding:0 16px;">
        <tr><td style="padding:6px 16px;color:#64748b;font-size:14px;">Subtotal</td><td style="padding:6px 16px;text-align:right;font-size:14px;">KES ${order.subtotal.toLocaleString()}</td></tr>
        <tr><td style="padding:6px 16px;color:#64748b;font-size:14px;">Shipping</td><td style="padding:6px 16px;text-align:right;color:#10b981;font-weight:700;font-size:14px;">FREE</td></tr>
        <tr><td style="padding:16px 16px 0;font-size:18px;font-weight:800;border-top:1px dashed #e2e8f0;">Total</td><td style="padding:16px 16px 0;text-align:right;font-size:18px;font-weight:800;color:${ORANGE};border-top:1px dashed #e2e8f0;">KES ${order.total.toLocaleString()}</td></tr>
      </table>
      <div style="margin-top:28px;padding:18px;background:${GRADIENT};border-radius:16px;color:#fff;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.85;">📍 Shipping to</p>
        <p style="margin:0;font-weight:700;font-size:14px;">${order.shippingAddress}</p>
      </div>
    `),
  };
}

export function orderAlertEmail(order: {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  total: number;
}): { subject: string; html: string } {
  return {
    subject: `New order: ${order.orderNumber} (KES ${order.total.toLocaleString()})`,
    html: wrap(`
      ${iconBadge('🔔')}
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;text-align:center;">New order received</h2>
      ${infoCard(
        infoRow('Order', pill(order.orderNumber)) +
          infoRow('Customer', order.customerName) +
          infoRow('Phone', `<a href="tel:${order.customerPhone}" style="color:${INK};text-decoration:none;">${order.customerPhone}</a>`) +
          infoRow('Email', `<a href="mailto:${order.customerEmail}" style="color:${INK};text-decoration:none;">${order.customerEmail}</a>`) +
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
      <h2 style="margin:0 0 6px;font-size:22px;font-weight:800;text-align:center;">You're in, ${data.attendeeName}!</h2>
      <p style="color:#64748b;margin:0 0 28px;text-align:center;font-size:14px;">
        ${data.price > 0
          ? `Ticket price: <strong style="color:${INK};">KES ${data.price.toLocaleString()}</strong> &mdash; we'll be in touch shortly to confirm payment.`
          : `This is a free event &mdash; no payment needed.`}
      </p>

      <div style="border-radius:22px;overflow:hidden;box-shadow:0 16px 32px -12px rgba(15,23,42,0.15);">
        <div style="background:${GRADIENT};padding:22px 24px;">
          <p style="margin:0 0 6px;color:rgba(255,255,255,0.85);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Event Ticket</p>
          <h3 style="margin:0;font-size:19px;font-weight:800;color:#fff;">${data.eventTitle}</h3>
        </div>
        <div style="background:#f8fafc;padding:20px 24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;width:32px;">📅</td>
              <td style="padding:6px 0;font-weight:600;font-size:14px;">${data.date}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;">🕐</td>
              <td style="padding:6px 0;font-weight:600;font-size:14px;">${data.time}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;">📍</td>
              <td style="padding:6px 0;font-weight:600;font-size:14px;">${data.location}</td>
            </tr>
          </table>
        </div>
        <div style="border-top:2px dashed #cbd5e1;padding:28px 24px;text-align:center;background:#ffffff;">
          <img src="cid:qr-ticket" alt="Ticket QR code" style="width:172px;height:172px;border-radius:16px;background:#fff;padding:10px;box-shadow:0 12px 24px -8px rgba(15,23,42,0.2);border:1px solid #f1f5f9;" />
          <p style="margin:16px 0 0;">${pill(data.ticketNumber)}</p>
          <p style="margin:10px 0 0;color:#94a3b8;font-size:12px;">Show this QR code at check-in</p>
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
  attendeeEmail: string;
  price: number;
}): { subject: string; html: string } {
  return {
    subject: `New registration: ${data.eventTitle} (${data.ticketNumber})`,
    html: wrap(`
      ${iconBadge('🎫')}
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;text-align:center;">New event registration</h2>
      ${infoCard(
        infoRow('Event', data.eventTitle) +
          infoRow('Attendee', data.attendeeName) +
          infoRow('Phone', `<a href="tel:${data.attendeePhone}" style="color:${INK};text-decoration:none;">${data.attendeePhone}</a>`) +
          infoRow('Email', `<a href="mailto:${data.attendeeEmail}" style="color:${INK};text-decoration:none;">${data.attendeeEmail}</a>`) +
          infoRow('Ticket', pill(data.ticketNumber)) +
          infoRow('Price', `<span style="color:${ORANGE};font-weight:800;">${data.price > 0 ? `KES ${data.price.toLocaleString()}` : 'Free'}</span>`)
      )}
    `),
  };
}

export function passwordResetEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: 'Reset your MarkSila254 password',
    html: wrap(`
      ${iconBadge('🔒')}
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:800;text-align:center;">Reset your password</h2>
      <p style="color:#64748b;margin:0;text-align:center;font-size:14px;">Click the button below to choose a new password. This link expires in 1 hour.</p>
      ${button(resetUrl, 'Reset Password')}
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;text-align:center;">If you didn't request this, you can safely ignore this email &mdash; your password won't change.</p>
    `),
  };
}

export function verificationEmail(verifyUrl: string): { subject: string; html: string } {
  return {
    subject: 'Verify your MarkSila254 email',
    html: wrap(`
      ${iconBadge('✉️')}
      <h2 style="margin:0 0 10px;font-size:22px;font-weight:800;text-align:center;">Confirm your email</h2>
      <p style="color:#64748b;margin:0;text-align:center;font-size:14px;">Click the button below to verify your email and activate your account. This link expires in 24 hours.</p>
      ${button(verifyUrl, 'Verify Email')}
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;text-align:center;">If you didn't create an account, you can safely ignore this email.</p>
    `),
  };
}

const ORDER_STATUS_COPY: Record<string, string> = {
  pending: 'is pending payment',
  paid: 'payment has been confirmed',
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
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;text-align:center;">Hi ${data.customerName},</h2>
      <p style="color:#64748b;margin:0 0 20px;text-align:center;font-size:14px;">Your order ${pill(data.orderNumber)} ${copy}.</p>
      <p style="margin:0 0 20px;text-align:center;">${statusBadge(data.status)}</p>
      <p style="color:#64748b;margin:0;text-align:center;font-size:14px;">Order total: <strong style="color:${INK};">KES ${data.total.toLocaleString()}</strong></p>
    `),
  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function newsletterCampaignEmail(data: {
  subject: string;
  message: string;
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  const paragraphs = data.message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return {
    subject: data.subject,
    html: wrap(
      `
      ${iconBadge('📰')}
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;text-align:center;">${escapeHtml(data.subject)}</h2>
      <div style="font-size:14px;color:${INK};">${paragraphs}</div>
    `,
      { unsubscribeUrl: data.unsubscribeUrl }
    ),
  };
}
