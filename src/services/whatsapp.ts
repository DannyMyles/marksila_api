import { Tenant } from '../middleware/tenant';

/**
 * Checkout hand-off to WhatsApp. Orders and bookings are saved first, then
 * the customer is sent to the app's WhatsApp number with a pre-filled
 * message built here from the server-side record (server prices, the real
 * reference) — the frontend never composes the totals itself.
 */
export interface WhatsAppHandoff {
  number: string;
  message: string;
  url: string;
}

const kes = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

/** Digits only, Kenyan local numbers normalised to 2547XXXXXXXX for wa.me. */
export function normalizeWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`;
  return digits;
}

function handoff(tenant: Tenant, lines: (string | null | undefined | false)[]): WhatsAppHandoff | null {
  if (!tenant.whatsappNumber) return null;
  const number = normalizeWhatsAppNumber(tenant.whatsappNumber);
  const message = lines.filter((l) => l !== null && l !== undefined && l !== false).join('\n');
  return { number, message, url: `https://wa.me/${number}?text=${encodeURIComponent(message)}` };
}

export interface OrderForMessage {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  shippingAddress: string;
  notes?: string | null;
  total: number;
  items: { name: string; price: number; quantity: number; size?: string | null; color?: string | null }[];
}

export function orderWhatsApp(tenant: Tenant, order: OrderForMessage): WhatsAppHandoff | null {
  const items = order.items.map((i) => {
    const variant = [i.color, i.size].filter(Boolean).join(' / ');
    return `• ${i.name}${variant ? ` (${variant})` : ''} × ${i.quantity} — ${kes(i.price * i.quantity)}`;
  });
  return handoff(tenant, [
    `Hello ${tenant.name}, I'd like to place this order.`,
    '',
    `*Order ${order.orderNumber}*`,
    ...items,
    '',
    `*Total: ${kes(order.total)}*`,
    '',
    `Name: ${order.customerName}`,
    `Phone: ${order.customerPhone}`,
    order.customerEmail ? `Email: ${order.customerEmail}` : null,
    `Delivery: ${order.shippingAddress}`,
    order.notes ? `Notes: ${order.notes}` : null,
    '',
    'Please confirm availability and how to pay. Thank you!',
  ]);
}

export interface BookingForMessage {
  ticketNumber: string;
  attendeeName: string;
  attendeePhone: string;
  attendeeEmail?: string | null;
  participants: number;
  total: number;
  notes?: string | null;
  event: { title: string; date: Date; time: string; location: string; price: number };
}

export function bookingWhatsApp(tenant: Tenant, booking: BookingForMessage): WhatsAppHandoff | null {
  const date = booking.event.date.toLocaleDateString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  });
  const people = `${booking.participants} ${booking.participants === 1 ? 'person' : 'people'}`;
  return handoff(tenant, [
    `Hello ${tenant.name}, I'd like to book.`,
    '',
    `*Booking ${booking.ticketNumber}*`,
    `${booking.event.title}`,
    `Date: ${date}, ${booking.event.time}`,
    `Location: ${booking.event.location}`,
    `Participants: ${people}`,
    booking.event.price > 0
      ? `*Total: ${kes(booking.total)}* (${kes(booking.event.price)} per person)`
      : 'Price: to be confirmed',
    '',
    `Name: ${booking.attendeeName}`,
    `Phone: ${booking.attendeePhone}`,
    booking.attendeeEmail ? `Email: ${booking.attendeeEmail}` : null,
    booking.notes ? `Notes: ${booking.notes}` : null,
    '',
    'Please confirm my spot. Thank you!',
  ]);
}

/** Plain "chat with us" link with an optional opening line. */
export function chatWhatsApp(tenant: Tenant, message: string): WhatsAppHandoff | null {
  return handoff(tenant, [message]);
}

export interface EnquiryForMessage {
  reference: string;
  type: 'contact' | 'booking' | 'corporate' | 'quote';
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
  message?: string | null;
}

const ENQUIRY_OPENERS: Record<EnquiryForMessage['type'], string> = {
  contact: 'I have a question.',
  booking: "I'd like to book.",
  corporate: "I'd like to arrange a corporate booking.",
  quote: "I'd like a quotation.",
};

export function enquiryWhatsApp(tenant: Tenant, e: EnquiryForMessage): WhatsAppHandoff | null {
  const date = e.preferredDate
    ? e.preferredDate.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' })
    : null;
  return handoff(tenant, [
    `Hello ${tenant.name}, ${ENQUIRY_OPENERS[e.type]}`,
    '',
    `*Ref ${e.reference}*`,
    e.serviceName ? `Service: ${e.serviceName}` : null,
    e.packageName ? `Package: ${e.packageName}` : null,
    e.company ? `Company: ${e.company}` : null,
    e.participants ? `Participants: ${e.participants}` : null,
    date ? `Preferred date: ${date}` : null,
    e.location ? `Location: ${e.location}` : null,
    e.estimate ? `Estimate: ${kes(e.estimate)} (to be confirmed)` : null,
    '',
    `Name: ${e.name}`,
    `Phone: ${e.phone}`,
    e.email ? `Email: ${e.email}` : null,
    e.message ? `Details: ${e.message}` : null,
    '',
    e.type === 'contact' ? 'Thank you!' : 'Please confirm availability and pricing. Thank you!',
  ]);
}
