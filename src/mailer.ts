import nodemailer from 'nodemailer';
import { env } from './env';

const transporter = env.smtpHost
  ? nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    })
  : null;

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
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  if (!transporter) {
    throw new Error('Email is not configured on the server yet.');
  }
  const info = await transporter.sendMail({
    from: `"Marksila254" <${env.smtpUser}>`,
    ...options,
  });
  console.log(`[mailer] Sent "${options.subject}" to ${options.to} (messageId: ${info.messageId})`);
}

const brandHeader = `
  <div style="background:linear-gradient(135deg,#FF6B35,#D44A1B);padding:24px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-family:sans-serif;font-size:20px;">Marksila254</h1>
  </div>
`;

function wrap(bodyHtml: string): string {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden;">
      ${brandHeader}
      <div style="padding:24px;color:#1f2937;">${bodyHtml}</div>
    </div>
  `;
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
      <h2 style="margin-top:0;">New message from your website</h2>
      <p><strong>Name:</strong> ${data.name}</p>
      <p><strong>Phone:</strong> ${data.phone}</p>
      ${data.email ? `<p><strong>Email:</strong> ${data.email}</p>` : ''}
      ${data.service ? `<p><strong>Service interested in:</strong> ${data.service}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:8px;">${data.message}</p>
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
        `<tr><td style="padding:6px 0;">${i.name} × ${i.quantity}</td><td style="padding:6px 0;text-align:right;">KES ${(i.price * i.quantity).toLocaleString()}</td></tr>`
    )
    .join('');
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: wrap(`
      <h2 style="margin-top:0;">Thanks for your order, ${order.customerName}!</h2>
      <p>We've received your order <strong>${order.orderNumber}</strong> and we'll be in touch shortly to confirm payment.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">${itemsHtml}</table>
      <p style="border-top:1px solid #eee;padding-top:8px;"><strong>Total: KES ${order.total.toLocaleString()}</strong></p>
      <p><strong>Shipping to:</strong> ${order.shippingAddress}</p>
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
      <h2 style="margin-top:0;">New order received</h2>
      <p><strong>Order:</strong> ${order.orderNumber}</p>
      <p><strong>Customer:</strong> ${order.customerName}</p>
      <p><strong>Phone:</strong> ${order.customerPhone}</p>
      <p><strong>Email:</strong> ${order.customerEmail}</p>
      <p><strong>Total:</strong> KES ${order.total.toLocaleString()}</p>
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
      <h2 style="margin-top:0;">You're registered, ${data.attendeeName}!</h2>
      <p><strong>${data.eventTitle}</strong></p>
      <p>${data.date} · ${data.time}</p>
      <p>${data.location}</p>
      ${
        data.price > 0
          ? `<p>Ticket price: KES ${data.price.toLocaleString()} — we'll be in touch shortly to confirm payment.</p>`
          : `<p>This is a free event — no payment needed.</p>`
      }
      <p style="text-align:center;margin:24px 0;">
        <img src="cid:qr-ticket" alt="Ticket QR code" style="width:200px;height:200px;" />
      </p>
      <p style="text-align:center;font-family:monospace;font-size:14px;color:#6b7280;">${data.ticketNumber}</p>
      <p style="color:#6b7280;font-size:13px;">Show this QR code at check-in.</p>
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
      <h2 style="margin-top:0;">New event registration</h2>
      <p><strong>Event:</strong> ${data.eventTitle}</p>
      <p><strong>Attendee:</strong> ${data.attendeeName}</p>
      <p><strong>Phone:</strong> ${data.attendeePhone}</p>
      <p><strong>Email:</strong> ${data.attendeeEmail}</p>
      <p><strong>Ticket:</strong> ${data.ticketNumber}</p>
      <p><strong>Price:</strong> ${data.price > 0 ? `KES ${data.price.toLocaleString()}` : 'Free'}</p>
    `),
  };
}

export function passwordResetEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: 'Reset your Marksila254 password',
    html: wrap(`
      <h2 style="margin-top:0;">Reset your password</h2>
      <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${resetUrl}" style="background:#FF6B35;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
    `),
  };
}

export function verificationEmail(verifyUrl: string): { subject: string; html: string } {
  return {
    subject: 'Verify your Marksila254 email',
    html: wrap(`
      <h2 style="margin-top:0;">Confirm your email</h2>
      <p>Click the button below to verify your email and activate your account. This link expires in 24 hours.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${verifyUrl}" style="background:#FF6B35;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If you didn't create an account, you can safely ignore this email.</p>
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
      <h2 style="margin-top:0;">Hi ${data.customerName},</h2>
      <p>Your order <strong>${data.orderNumber}</strong> ${copy}.</p>
      <p style="color:#6b7280;">Total: KES ${data.total.toLocaleString()}</p>
    `),
  };
}
