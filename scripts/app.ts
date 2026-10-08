/**
 * Manage the apps (tenants) that share this backend.
 *
 *   npm run app -- list
 *   npm run app -- upsert --key sos --name "Source of Adventure" \
 *       --whatsapp 254701437959 --frontend-url https://sourceofadventure.co.ke \
 *       [--contact-email ..] [--contact-phone ..] [--location ..] \
 *       [--notification-email ..] [--order-prefix SOA] [--booking-prefix SOA] \
 *       [--youtube-channel handle] [--active true|false]
 *   npm run app -- rotate-key --key sos            # prints a NEW admin key once
 *   npm run app -- set-key --key fitness --admin-key "<existing key>"
 *   npm run app -- create-admin --key sos --email you@example.com --name "Your Name"
 *       # creates (or resets) an admin login for that app; prints a password once
 *
 * Connecting a new frontend = `upsert` a new key, then have that frontend
 * send `X-App-Key: <key>` on every API call (its Next.js proxy does this).
 * Its data starts empty and is isolated from every other app.
 */
import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { hashAdminKey } from '../src/middleware/adminAuth';
import { normalizeWhatsAppNumber } from '../src/services/whatsapp';

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    flags[arg.slice(2)] = value;
    i++;
  }
  return { command, flags };
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

const KEY_RE = /^[a-z][a-z0-9-]{1,39}$/;
const newAdminKey = () => crypto.randomBytes(32).toString('base64url');

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'list': {
      const apps = await prisma.app.findMany({ orderBy: { id: 'asc' } });
      console.table(
        apps.map((a) => ({
          id: a.id,
          key: a.key,
          name: a.name,
          whatsapp: a.whatsappNumber,
          frontendUrl: a.frontendUrl,
          adminKey: a.adminKeyHash ? 'set' : '—',
          active: a.active,
        }))
      );
      return;
    }

    case 'upsert': {
      const key = requireFlag(flags, 'key').toLowerCase();
      if (!KEY_RE.test(key)) throw new Error('--key must be lowercase letters, digits or dashes (2-40 chars)');
      const data = {
        ...(flags.name ? { name: flags.name } : {}),
        ...(flags.whatsapp ? { whatsappNumber: normalizeWhatsAppNumber(flags.whatsapp) } : {}),
        ...(flags['frontend-url'] ? { frontendUrl: flags['frontend-url'].replace(/\/+$/, '') } : {}),
        ...(flags['contact-email'] ? { contactEmail: flags['contact-email'] } : {}),
        ...(flags['contact-phone'] ? { contactPhone: flags['contact-phone'] } : {}),
        ...(flags.location ? { location: flags.location } : {}),
        ...(flags['notification-email'] ? { notificationEmail: flags['notification-email'] } : {}),
        ...(flags['order-prefix'] ? { orderPrefix: flags['order-prefix'].toUpperCase() } : {}),
        ...(flags['booking-prefix'] ? { bookingPrefix: flags['booking-prefix'].toUpperCase() } : {}),
        ...(flags['youtube-channel'] ? { youtubeChannelHandle: flags['youtube-channel'] } : {}),
        ...(flags.active ? { active: flags.active === 'true' } : {}),
      };
      const existing = await prisma.app.findUnique({ where: { key } });
      if (existing) {
        await prisma.app.update({ where: { key }, data });
        console.log(`Updated app "${key}".`);
      } else {
        const adminKey = newAdminKey();
        await prisma.app.create({
          data: { key, name: requireFlag(flags, 'name'), adminKeyHash: hashAdminKey(adminKey), ...data },
        });
        console.log(`Created app "${key}". Its admin key (shown once — store it in that frontend's server env):\n\n  ${adminKey}\n`);
      }
      console.log('Running API servers pick this up within 30 seconds.');
      return;
    }

    case 'rotate-key': {
      const key = requireFlag(flags, 'key');
      const adminKey = newAdminKey();
      await prisma.app.update({ where: { key }, data: { adminKeyHash: hashAdminKey(adminKey) } });
      console.log(`New admin key for "${key}" (the old one stops working within 30 seconds):\n\n  ${adminKey}\n`);
      return;
    }

    case 'set-key': {
      const key = requireFlag(flags, 'key');
      const adminKey = requireFlag(flags, 'admin-key');
      if (adminKey.length < 24) throw new Error('Admin keys must be at least 24 characters');
      await prisma.app.update({ where: { key }, data: { adminKeyHash: hashAdminKey(adminKey) } });
      console.log(`Admin key for "${key}" updated.`);
      return;
    }

    case 'create-admin': {
      const app = await prisma.app.findUnique({ where: { key: requireFlag(flags, 'key') } });
      if (!app) throw new Error('Unknown app key');
      const email = requireFlag(flags, 'email').trim().toLowerCase();
      const name = flags.name ?? 'Admin';
      // Meets the API's password policy: upper, lower, digit, special.
      const password = `${crypto.randomBytes(9).toString('base64url')}Aa1!`;
      const hash = await bcrypt.hash(password, 10);
      const existing = await prisma.user.findUnique({ where: { appId_email: { appId: app.id, email } } });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { password: hash, role: 'admin', isActive: true, emailVerified: true },
        });
        console.log(`Reset ${email} as an admin of "${app.key}".`);
      } else {
        const base = email.split('@')[0].replace(/[^a-z0-9]/g, '') || 'admin';
        let username = base;
        for (let n = 2; await prisma.user.findUnique({ where: { appId_username: { appId: app.id, username } } }); n++) {
          username = `${base}${n}`;
        }
        await prisma.user.create({
          data: { appId: app.id, name, username, email, password: hash, role: 'admin', emailVerified: true },
        });
        console.log(`Created ${email} as an admin of "${app.key}".`);
      }
      console.log(`Password (shown once):\n\n  ${password}\n`);
      return;
    }

    default:
      throw new Error('Usage: npm run app -- list | upsert --key <key> [...] | rotate-key --key <key> | set-key --key <key> --admin-key <key> | create-admin --key <key> --email <email> [--name <name>]');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
