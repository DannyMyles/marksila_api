# mark254-commerce-api — shared backend

One Express + Prisma + **MariaDB** API serving several websites:

| App key   | Frontend                         | Dev URL               |
|-----------|----------------------------------|-----------------------|
| `fitness` | `../Fitness` (MarkSila254)       | http://localhost:3000 |
| `sos`     | `../sos` (Source of Adventure)   | http://localhost:3001 |

## How apps are kept apart

* Every app is a row in the `App` table. Every tenant-owned table (users, products,
  categories, orders, events, bookings, blogs, testimonials, services, enquiries, FAQs,
  banners, email log, gallery, newsletter) has an `appId` foreign key; slugs/emails
  are unique **per app**.
* Every `/api` request must send `X-App-Key: <key>` (`src/middleware/tenant.ts`).
  Routes read and write only `req.tenant`'s rows — another app's record is a plain 404.
* Logins are per app: JWTs carry the app id and are rejected by any other app.
* Admin keys (`x-admin-key`, used by the Fitness Next.js server) are per app and
  stored only as a sha256 hash.
* Uploads are stored under `uploads/<app key>/<kind>/`.
* Emails (alerts, verification, newsletters) are branded and linked per app.

The frontends never send the header themselves: each has a `proxy.ts` that
forwards same-origin `/api/*` calls here and **overwrites** `X-App-Key`.

## Orders & bookings → WhatsApp

There is no online payment (M-Pesa was removed). `POST /api/orders` and
`POST /api/v1/events/:slug/register` work for guests, price everything from the
database, save the record as `pending`, and return:

```json
{ "order": { ... }, "whatsapp": { "number": "2547…", "message": "…", "url": "https://wa.me/…" } }
```

The message is built in `src/services/whatsapp.ts` from the saved record. The
customer sends it; an admin then moves the order (`pending → confirmed → shipped →
delivered`) and records payment (`unpaid / paid`). Bookings take a participant
count and are protected against overbooking with a row lock.

## Website content (all editable in each app's admin)

| What | Where it lives | Endpoints |
|---|---|---|
| Business details, hero, about/team, stats, steps, values, social links, booking notice, email branding | `App` columns + `App.settings` JSON (shape: `src/services/siteSettings.ts`) | `GET /api/v1/app` (public), `GET /api/v1/app/admin`, `PUT /api/v1/app`, `POST /api/v1/app/test-email` |
| Services & packages (individual + corporate, category, pricing fixed / per person / quote, availability) | `Training`, `ServicePackage` | `GET /api/v1/trainings?audience=corporate&category=…`, admin CRUD with `packages` JSON |
| Enquiries: contact messages, service bookings, corporate bookings, quote requests | `Enquiry` | `POST /api/v1/enquiries` (public), `POST /api/v1/contact`, admin `GET/PATCH/DELETE /api/v1/enquiries` |
| FAQs | `Faq` | `GET /api/v1/faqs`, admin CRUD |
| Banners & promotions (optional start/end dates) | `Banner` | `GET /api/v1/banners?placement=home`, admin CRUD (image upload) |
| Dashboard numbers, email log | — / `EmailLog` | `GET /api/v1/admin/stats`, `GET /api/v1/admin/emails` |

Bookings (`EventRegistration`) now have a `completed` status. Admins move them with
`PATCH /api/v1/events/registrations/:id/status` (emails the customer unless `notify:false`)
and can (re)send the received/status/reminder email with `POST …/:id/notify`.
`GET /api/v1/events/registrations/all` supports `q`, `status`, `eventId`, `page`, `pageSize`, `sort`.

Public create endpoints accept an optional `requestId`; resubmitting the same id returns
the original record instead of creating a duplicate or emailing twice.

## Email

`src/mailer.ts` renders every email from structured content into a table-based,
responsive HTML layout (inline styles, bulletproof buttons, no JS or unsupported
CSS) **and** a plain-text version, branded per app (name, logo from
`assets/email/<app key>.png`, colours, contact details, social links, footer note).

Every send goes through `deliverEmail()`, which writes an `EmailLog` row first.
Its `dedupeKey` (unique per app) means a retried action never emails the same
thing twice, and the status (`sent` / `failed` / `skipped`) is shown to admins.
Email problems never fail the booking or enquiry that triggered them.

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and optionally `MAIL_FROM`).
Without SMTP, emails are logged as `skipped`; in development set
`MAIL_PREVIEW_DIR=./.mail-preview` to save each rendered email as `.html` + `.txt`.
Team alerts go to the app's `notificationEmail`, else `ADMIN_NOTIFICATION_EMAIL`,
else `SMTP_USER`, else the app's public contact email.

## Setup

```bash
docker compose up -d            # or use an existing MariaDB 10.6+
cp .env.example .env            # set DATABASE_URL, JWT_SECRET
npm install
npm run prisma:deploy           # creates tables + the fitness and sos apps (additive migrations only)
SEED_ADMIN_PASSWORD='…' npm run seed   # catalogue, corporate packages, FAQs, page copy, admins (idempotent)
ADMIN_PASSWORD='…' npm run app -- set-password --key all --email admin@marksila254.com
npm run dev                     # http://localhost:4000  (Swagger: /docs)
ADMIN_PASSWORD='…' npm run smoke   # end-to-end checks against the running API (cleans up after itself)
```

Upgrading an existing database: `npm run prisma:deploy` backfills every existing row
to the `fitness` app and maps old statuses (`paid → confirmed`, `pending_payment → pending`).

## Managing apps / connecting a new one

```bash
npm run app -- list
npm run app -- upsert --key myapp --name "My App" --whatsapp 0712345678 \
    --frontend-url https://myapp.co.ke --notification-email team@myapp.co.ke \
    --order-prefix MYA --booking-prefix MYA      # prints the new app's admin key once
npm run app -- upsert --key sos --whatsapp 0700111222   # change a setting
npm run app -- rotate-key --key sos
ADMIN_PASSWORD='…' npm run app -- set-password --key sos --email you@example.com   # create/reset an admin
```

Admins sign in per app (a Fitness token is rejected by SOS and vice versa). One email
can be an admin of both apps — `set-password --key all` sets the same password on each.

A new app starts empty. Point its frontend at this API with `X-App-Key: myapp`
(copy `../sos/proxy.ts`), and it can use every endpoint without touching other apps' data.

`GET /api/v1/app` returns the calling app's public details (name, WhatsApp, contact).
