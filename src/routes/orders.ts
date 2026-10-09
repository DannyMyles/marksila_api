import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { optionalAuth, requireAuth } from '../middleware/userAuth';
import { adminUrlFor, notificationEmailFor, tenantOf } from '../middleware/tenant';
import { ApiError } from '../middleware/errorHandler';
import { deliverEmailInBackground, orderConfirmationEmail, orderAlertEmail, orderStatusUpdateEmail } from '../mailer';
import { parseId, phoneSchema } from '../utils/validation';
import { generateReference } from '../utils/reference';
import { orderWhatsApp } from '../services/whatsapp';
import { publicWriteLimiter } from '../middleware/rateLimiters';

export const ordersRouter = Router();

const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(50),
  size: z.string().trim().max(50).optional(),
  color: z.string().trim().max(50).optional(),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// One short form: name, phone, where to deliver. Email/notes are optional —
// the order is confirmed with the customer on WhatsApp, not by email.
const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  customerPhone: phoneSchema,
  customerEmail: z.string().trim().email().max(255).optional().or(z.literal('')).transform((v) => v || undefined),
  shippingAddress: z.string().trim().min(1).max(500),
  notes: optionalText(500),
  items: z.array(orderItemSchema).min(1).max(50),
});

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

function serializeOrder(order: OrderWithItems) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    shippingAddress: order.shippingAddress,
    notes: order.notes,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    shipping: order.total - order.subtotal,
    total: order.total,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      size: i.size,
      color: i.color,
    })),
  };
}

/**
 * @openapi
 * /api/orders:
 *   post:
 *     summary: Place an order (guest or logged in). Prices come from the database; the response includes a WhatsApp link with the order summary.
 *     tags: [Orders]
 *     parameters:
 *       - { in: header, name: X-App-Key, required: true, schema: { type: string } }
 */
ordersRouter.post('/', publicWriteLimiter, optionalAuth, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = createOrderSchema.parse(req.body);

    // Only products of THIS app can be ordered — an id from another app is
    // simply "not found".
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, appId: tenant.id } });
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) throw new ApiError(409, 'An item in your cart is no longer available. Please refresh your cart.');
      if (!product.inStock) throw new ApiError(409, `${product.name} is out of stock`);
    }

    const subtotal = input.items.reduce((sum, item) => sum + productById.get(item.productId)!.price * item.quantity, 0);
    const total = subtotal; // delivery is agreed on WhatsApp

    let order: OrderWithItems | null = null;
    for (let attempt = 0; !order; attempt++) {
      try {
        order = await prisma.order.create({
          data: {
            appId: tenant.id,
            orderNumber: generateReference(tenant.orderPrefix),
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            shippingAddress: input.shippingAddress,
            notes: input.notes,
            subtotal,
            total,
            userId: req.user?.id,
            items: {
              create: input.items.map((item) => {
                const product = productById.get(item.productId)!;
                return {
                  productId: product.id,
                  name: product.name,
                  price: product.price,
                  quantity: item.quantity,
                  size: item.size,
                  color: item.color,
                };
              }),
            },
          },
          include: { items: true },
        });
      } catch (err) {
        // Unlucky reference collision — try a fresh one.
        const dup = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!dup || attempt >= 4) throw err;
      }
    }

    const whatsapp = orderWhatsApp(tenant, order);
    deliverEmailInBackground({
      tenant,
      kind: 'order_received',
      to: order.customerEmail,
      template: orderConfirmationEmail(order, { whatsappUrl: whatsapp?.url }),
      dedupeKey: `order-received:${order.id}`,
      entity: { type: 'order', id: order.id },
    });
    deliverEmailInBackground({
      tenant,
      kind: 'order_alert',
      to: notificationEmailFor(tenant),
      template: orderAlertEmail(order, adminUrlFor(tenant, `/orders/${order.id}`)),
      dedupeKey: `order-alert:${order.id}`,
      entity: { type: 'order', id: order.id },
      replyTo: order.customerEmail ?? undefined,
    });

    res.status(201).json({ order: serializeOrder(order), whatsapp });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: List this app's orders (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.get('/', requireAdminKey, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { appId: tenantOf(req).id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders.map(serializeOrder));
  } catch (err) {
    next(err);
  }
});

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  // RFC 4180 quoting; also neutralise spreadsheet formula injection from
  // customer-typed fields (a name starting with "=" etc.).
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const EXPORT_COLUMNS: [string, (o: ReturnType<typeof serializeOrder>) => unknown][] = [
  ['Order Number', (o) => o.orderNumber],
  ['Placed At', (o) => new Date(o.createdAt).toISOString()],
  ['Customer Name', (o) => o.customerName],
  ['Customer Phone', (o) => o.customerPhone],
  ['Customer Email', (o) => o.customerEmail],
  ['Delivery Address', (o) => o.shippingAddress],
  ['Items', (o) => o.items.map((i) => `${i.name} x${i.quantity}`).join('; ')],
  ['Order Status', (o) => o.status],
  ['Payment Status', (o) => o.paymentStatus],
  ['Total (KES)', (o) => o.total],
  ['Notes', (o) => o.notes],
];

/**
 * @openapi
 * /api/orders/export:
 *   get:
 *     summary: Download this app's orders as CSV (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.get('/export', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const orders = await prisma.order.findMany({
      where: { appId: tenant.id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    const rows = orders.map(serializeOrder).map((o) => EXPORT_COLUMNS.map(([, get]) => csvCell(get(o))).join(','));
    const csv = [EXPORT_COLUMNS.map(([name]) => name).join(','), ...rows].join('\r\n');
    const filename = `${tenant.key}-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders/mine:
 *   get:
 *     summary: List the logged-in customer's own orders
 *     tags: [Orders]
 *     security: [{ BearerAuth: [] }]
 */
ordersRouter.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id, appId: tenantOf(req).id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders.map(serializeOrder));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     summary: Get a single order (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.get('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: parseId(req.params.id), appId: tenantOf(req).id },
      include: { items: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json(serializeOrder(order));
  } catch (err) {
    next(err);
  }
});

const statusUpdateSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']).optional(),
  paymentStatus: z.enum(['unpaid', 'paid']).optional(),
});

/**
 * @openapi
 * /api/orders/{id}/status:
 *   patch:
 *     summary: Update order status and/or record offline payment (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.patch('/:id/status', requireAdminKey, async (req, res, next) => {
  try {
    const tenant = tenantOf(req);
    const input = statusUpdateSchema.parse(req.body);
    if (!input.status && !input.paymentStatus) {
      throw new ApiError(400, 'Provide status and/or paymentStatus');
    }
    const id = parseId(req.params.id);
    const existing = await prisma.order.findFirst({ where: { id, appId: tenant.id } });
    if (!existing) throw new ApiError(404, 'Order not found');

    const order = await prisma.order.update({ where: { id }, data: input, include: { items: true } });

    if (input.status && input.status !== existing.status) {
      deliverEmailInBackground({
        tenant,
        kind: 'order_status',
        to: order.customerEmail,
        template: orderStatusUpdateEmail(order),
        dedupeKey: `order-status:${order.id}:${order.status}`,
        entity: { type: 'order', id: order.id },
      });
    }

    res.json(serializeOrder(order));
  } catch (err) {
    next(err);
  }
});
