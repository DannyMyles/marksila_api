/**
 * End-to-end smoke test against a running API (npm run dev):
 *
 *   ADMIN_EMAIL=admin@marksila254.com ADMIN_PASSWORD='...' npm run smoke
 *
 * Checks admin login per app, cross-app isolation, enquiries (incl. retry
 * dedupe), bookings, status emails, FAQs, settings and dashboard stats.
 * Every record it creates is deleted again at the end.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const EMAIL = process.env.ADMIN_EMAIL || 'admin@marksila254.com';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const prisma = new PrismaClient();

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function call(app: string, path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-app-key': app,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, data: data as any };
}

const created: { enquiries: number[]; bookings: number[]; faqs: number[] } = { enquiries: [], bookings: [], faqs: [] };

async function main() {
  if (!PASSWORD) throw new Error('Set ADMIN_PASSWORD');
  const tokens: Record<string, string> = {};

  console.log('Auth');
  for (const app of ['fitness', 'sos']) {
    const r = await call(app, '/api/v1/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
    check(`${app}: admin can log in`, r.status === 200 && r.data.user?.role === 'admin', r.data);
    check(`${app}: login response has no password hash`, !JSON.stringify(r.data).includes('$2'), undefined);
    tokens[app] = r.data.user?.token;
  }
  const bad = await call('sos', '/api/v1/auth/login', { method: 'POST', body: { email: EMAIL, password: 'wrong-Password1!' } });
  check('wrong password is rejected', bad.status === 401);
  const cross = await call('sos', '/api/v1/admin/stats', { token: tokens.fitness });
  check('a Fitness token is rejected by SOS', cross.status === 401, cross.status);
  const anon = await call('fitness', '/api/v1/enquiries');
  check('admin endpoints need auth', anon.status === 401, anon.status);

  console.log('Enquiries');
  const corp = (await call('fitness', '/api/v1/trainings?audience=corporate')).data.trainings.find((t: any) => t.packages.length);
  check('corporate services with packages exist', Boolean(corp));
  const requestId = `smoke-${Date.now()}`;
  const body = {
    type: 'corporate',
    serviceId: Number(corp.id),
    packageId: corp.packages[0].id,
    name: 'Smoke Test',
    phone: '0700000000',
    email: 'smoke@example.com',
    company: 'Smoke Ltd',
    participants: 25,
    preferredDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
    message: 'Automated smoke test — safe to delete.',
    requestId,
  };
  const e1 = await call('fitness', '/api/v1/enquiries', { method: 'POST', body });
  check('corporate enquiry is created', e1.status === 201 && Boolean(e1.data.enquiry?.reference), e1.data);
  check('WhatsApp link is prefilled with the reference', String(e1.data.whatsapp?.url).includes(encodeURIComponent(e1.data.enquiry?.reference)), e1.data.whatsapp);
  const e2 = await call('fitness', '/api/v1/enquiries', { method: 'POST', body });
  check('retry with same requestId returns the same enquiry', e2.status === 200 && e2.data.enquiry?.reference === e1.data.enquiry?.reference, e2.data);
  const missing = await call('fitness', '/api/v1/enquiries', { method: 'POST', body: { ...body, company: '', requestId: undefined } });
  check('corporate enquiry without company is rejected', missing.status === 400, missing.data);

  const list = await call('fitness', `/api/v1/enquiries?q=${e1.data.enquiry.reference}`, { token: tokens.fitness });
  const enquiryId = list.data.enquiries?.[0]?.id;
  if (enquiryId) created.enquiries.push(enquiryId);
  check('admin can find the enquiry by reference', list.data.total === 1, list.data);
  const sosList = await call('sos', `/api/v1/enquiries?q=${e1.data.enquiry.reference}`, { token: tokens.sos });
  check('SOS admin cannot see the Fitness enquiry', sosList.data.total === 0, sosList.data);
  const sosGet = await call('sos', `/api/v1/enquiries/${enquiryId}`, { token: tokens.sos });
  check('SOS admin gets 404 for the Fitness enquiry id', sosGet.status === 404, sosGet.status);

  const quoteNoAmount = await call('fitness', `/api/v1/enquiries/${enquiryId}`, { method: 'PATCH', token: tokens.fitness, body: { status: 'quoted' } });
  check('cannot mark quoted without an amount', quoteNoAmount.status === 400);
  const quoted = await call('fitness', `/api/v1/enquiries/${enquiryId}`, {
    method: 'PATCH',
    token: tokens.fitness,
    body: { status: 'quoted', quotedAmount: 50000, notify: true, note: 'Includes transport.' },
  });
  check('admin can quote and notify', quoted.status === 200 && quoted.data.enquiry?.status === 'quoted' && Boolean(quoted.data.email?.message), quoted.data);

  await new Promise((r) => setTimeout(r, 800));
  const detail = await call('fitness', `/api/v1/enquiries/${enquiryId}`, { token: tokens.fitness });
  const kinds = (detail.data.emails ?? []).map((e: any) => e.kind);
  check('received + alert + update emails are logged once each', ['enquiry_received', 'enquiry_alert', 'enquiry_update'].every((k) => kinds.filter((x: string) => x === k).length === 1), kinds);

  const contact = await call('sos', '/api/v1/contact', { method: 'POST', body: { name: 'Smoke Test', phone: '0700000000', message: 'Smoke test message' } });
  check('SOS contact form saves an enquiry', contact.status === 200 && Boolean(contact.data.reference), contact.data);
  const contactRow = await prisma.enquiry.findUnique({ where: { reference: contact.data.reference } });
  if (contactRow) created.enquiries.push(contactRow.id);
  check('…stored under the SOS app', contactRow?.appId === (await prisma.app.findUnique({ where: { key: 'sos' } }))?.id);

  console.log('Bookings');
  const adventures = (await call('sos', '/api/v1/events?upcoming=true')).data.events;
  const adventure = adventures.find((a: any) => a.spotsRemaining >= 2);
  check('SOS has bookable upcoming adventures', Boolean(adventure));
  const bookBody = { attendeeName: 'Smoke Test', attendeePhone: '0700000000', attendeeEmail: 'smoke@example.com', participants: 2, requestId: `smoke-b-${Date.now()}` };
  const b1 = await call('sos', `/api/v1/events/${adventure.slug}/register`, { method: 'POST', body: bookBody });
  check('booking is created as pending', b1.status === 201 && b1.data.registration?.status === 'pending', b1.data);
  if (b1.data.registration?.id) created.bookings.push(b1.data.registration.id);
  const b2 = await call('sos', `/api/v1/events/${adventure.slug}/register`, { method: 'POST', body: bookBody });
  check('retried booking returns the original (no double spots)', b2.data.registration?.id === b1.data.registration?.id && b2.data.duplicate === true, b2.data);
  const fitnessSees = await call('fitness', `/api/v1/events/${adventure.slug}`);
  check('Fitness cannot see the SOS adventure', fitnessSees.status === 404, fitnessSees.status);
  const confirm = await call('sos', `/api/v1/events/registrations/${b1.data.registration.id}/status`, { method: 'PATCH', token: tokens.sos, body: { status: 'confirmed' } });
  check('admin confirms the booking (customer emailed)', confirm.data.registration?.status === 'confirmed' && Boolean(confirm.data.email), confirm.data);
  const crossPatch = await call('fitness', `/api/v1/events/registrations/${b1.data.registration.id}/status`, { method: 'PATCH', token: tokens.fitness, body: { status: 'cancelled' } });
  check('Fitness admin cannot change the SOS booking', crossPatch.status === 404, crossPatch.status);
  const remind = await call('sos', `/api/v1/events/registrations/${b1.data.registration.id}/notify`, { method: 'POST', token: tokens.sos, body: { type: 'reminder' } });
  check('reminder endpoint reports delivery status', ['sent', 'skipped', 'failed'].includes(remind.data.status), remind.data);
  const search = await call('sos', `/api/v1/events/registrations/all?q=${b1.data.registration.ticketNumber}`, { token: tokens.sos });
  check('bookings search finds it', search.data.total === 1, search.data);

  console.log('Content');
  const faq = await call('sos', '/api/v1/faqs', { method: 'POST', token: tokens.sos, body: { question: 'Smoke test question?', answer: 'Yes.', published: false } });
  check('admin creates a FAQ', faq.status === 201, faq.data);
  if (faq.data.faq?.id) created.faqs.push(faq.data.faq.id);
  const publicFaqs = await call('sos', '/api/v1/faqs');
  check('hidden FAQ is not public', !publicFaqs.data.faqs.some((f: any) => f.id === faq.data.faq?.id));
  const fitnessFaqs = await call('fitness', '/api/v1/faqs?all=true', { token: tokens.fitness });
  check('Fitness admin does not see the SOS FAQ', !fitnessFaqs.data.faqs.some((f: any) => f.id === faq.data.faq?.id));
  const badSettings = await call('sos', '/api/v1/app', { method: 'PUT', token: tokens.sos, body: { settings: { brand: { primaryColor: 'orange' } } } });
  check('invalid settings are rejected', badSettings.status === 400, badSettings.data);
  const stats = await call('fitness', '/api/v1/admin/stats', { token: tokens.fitness });
  check('dashboard stats load', stats.status === 200 && typeof stats.data.enquiries?.total === 'number', stats.data);
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await prisma.emailLog.deleteMany({
      where: {
        OR: [
          { entityType: 'enquiry', entityId: { in: created.enquiries } },
          { entityType: 'booking', entityId: { in: created.bookings } },
        ],
      },
    });
    await prisma.enquiry.deleteMany({ where: { id: { in: created.enquiries } } });
    await prisma.eventRegistration.deleteMany({ where: { id: { in: created.bookings } } });
    await prisma.faq.deleteMany({ where: { id: { in: created.faqs } } });
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
    process.exitCode = failures ? 1 : 0;
  });
