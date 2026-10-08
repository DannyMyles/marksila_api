# mark254-commerce-api — shared backend

One Express + Prisma + **MariaDB** API serving several websites:

| App key   | Frontend                         | Dev URL               |
|-----------|----------------------------------|-----------------------|
| `fitness` | `../Fitness` (MarkSila254)       | http://localhost:3000 |
| `sos`     | `../sos` (Source of Adventure)   | http://localhost:3001 |

## How apps are kept apart

* Every app is a row in the `App` table. Every tenant-owned table (users, products,
  categories, orders, events, bookings, blogs, testimonials, trainings, gallery,
  newsletter) has an `appId` foreign key; slugs/emails are unique **per app**.
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

## Setup

```bash
docker compose up -d            # or use an existing MariaDB 10.6+
cp .env.example .env            # set DATABASE_URL, JWT_SECRET
npm install
npm run prisma:deploy           # creates tables + the fitness and sos apps
npm run seed                    # Fitness catalogue/admin + SOS starter adventures (idempotent)
npm run app -- rotate-key --key fitness   # prints the admin key → Fitness COMMERCE_ADMIN_KEY
npm run dev                     # http://localhost:4000  (Swagger: /docs)
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
```

A new app starts empty. Point its frontend at this API with `X-App-Key: myapp`
(copy `../sos/proxy.ts`), and it can use every endpoint without touching other apps' data.

`GET /api/v1/app` returns the calling app's public details (name, WhatsApp, contact).
