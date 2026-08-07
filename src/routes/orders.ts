import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { optionalAuth, requireAuth } from '../middleware/userAuth';
import { generateOrderNumber } from '../utils/orderNumber';
import { paymentProvider } from '../payments';
import { describeMpesaResult } from '../payments/mpesaResultCodes';
import { applyMpesaResultToOrder } from '../payments/applyMpesaResult';
import { ApiError } from '../middleware/errorHandler';
import { sendMail, orderConfirmationEmail, orderAlertEmail, orderStatusUpdateEmail } from '../mailer';
import { env } from '../env';
import { parseId, phoneSchema } from '../utils/validation';
import { publicWriteLimiter } from '../middleware/rateLimiters';

export const ordersRouter = Router();

const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(100),
  size: z.string().max(50).optional(),
  color: z.string().max(50).optional(),
});

const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  customerEmail: z.string().trim().email().max(255),
  customerPhone: phoneSchema,
  shippingAddress: z.string().trim().min(1).max(500),
  items: z.array(orderItemSchema).min(1).max(100),
});

function serializeOrder(order: any) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    shippingAddress: order.shippingAddress,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentRef: order.paymentRef,
    // Admin-visible raw Safaricom result, so a failed payment isn't a mystery.
    paymentResultCode: order.paymentResultCode,
    paymentResultDesc: order.paymentResultDesc,
    subtotal: order.subtotal,
    shipping: order.total - order.subtotal,
    total: order.total,
    createdAt: order.createdAt,
    items: (order.items ?? []).map((i: any) => ({
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
 *     summary: Create an order (checkout). Guest checkout — no auth required.
 *     tags: [Orders]
 */
ordersRouter.post('/', publicWriteLimiter, optionalAuth, async (req, res, next) => {
  try {
    const input = createOrderSchema.parse(req.body);

    const productIds = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) throw new ApiError(400, `Product ${item.productId} not found`);
      if (!product.inStock) throw new ApiError(409, `${product.name} is out of stock`);
    }

    const subtotal = input.items.reduce((sum, item) => {
      const product = productById.get(item.productId)!;
      return sum + product.price * item.quantity;
    }, 0);
    const total = subtotal;

    const orderNumber = generateOrderNumber();
    const payment = await paymentProvider.initiate({
      orderNumber,
      amount: total,
      phone: input.customerPhone,
    });

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        shippingAddress: input.shippingAddress,
        subtotal,
        total,
        paymentStatus: payment.status,
        paymentRef: payment.reference,
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

    // Email is a side effect of an already-persisted order — never let a
    // slow/failed send delay or fail the checkout response.
    const confirmation = orderConfirmationEmail({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      items: order.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity })),
      subtotal: order.subtotal,
      total: order.total,
      shippingAddress: order.shippingAddress,
    });
    sendMail({ to: order.customerEmail, ...confirmation }).catch((err) =>
      console.error(`[orders] Failed to send confirmation email for ${order.orderNumber}:`, err)
    );

    const alert = orderAlertEmail({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      total: order.total,
    });
    sendMail({ to: env.adminNotificationEmail, ...alert }).catch((err) =>
      console.error(`[orders] Failed to send admin alert email for ${order.orderNumber}:`, err)
    );

    res.status(201).json({ order: serializeOrder(order), payment });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: List all orders (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.get('/', requireAdminKey, async (_req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
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
 * /api/orders/mine:
 *   get:
 *     summary: List the logged-in customer's own orders
 *     tags: [Orders]
 *     security: [{ BearerAuth: [] }]
 */
ordersRouter.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
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
    const order = await prisma.order.findUnique({
      where: { id: parseId(req.params.id) },
      include: { items: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json(serializeOrder(order));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders/{id}/status:
 *   get:
 *     summary: Get the status of the logged-in customer's own order (for payment polling)
 *     tags: [Orders]
 *     security: [{ BearerAuth: [] }]
 */
ordersRouter.get('/:id/status', requireAuth, async (req, res, next) => {
  try {
    let order = await prisma.order.findUnique({ where: { id: parseId(req.params.id) } });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.userId !== req.user!.id) throw new ApiError(403, 'Not your order');

    // Fallback for a callback that hasn't (or, on localhost, can't) land —
    // actively ask Safaricom on every poll while the order is still pending.
    if (order.paymentStatus === 'pending' && order.paymentRef && paymentProvider.queryStatus) {
      const result = await paymentProvider.queryStatus(order.paymentRef);
      if (result) {
        order = await applyMpesaResultToOrder(order, result);
      }
    }

    res.json({
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentFailureReason:
        order.paymentStatus === 'failed' && order.paymentResultCode !== null
          ? describeMpesaResult(order.paymentResultCode, order.paymentResultDesc ?? '')
          : undefined,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders/{id}/retry-payment:
 *   post:
 *     summary: Re-initiate M-Pesa payment for an order whose STK push failed, was cancelled, or timed out
 *     tags: [Orders]
 *     security: [{ BearerAuth: [] }]
 */
ordersRouter.post('/:id/retry-payment', requireAuth, publicWriteLimiter, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: parseId(req.params.id) } });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.userId !== req.user!.id) throw new ApiError(403, 'Not your order');
    if (order.paymentStatus === 'paid') throw new ApiError(409, 'This order is already paid');

    const payment = await paymentProvider.initiate({
      orderNumber: order.orderNumber,
      amount: order.total,
      phone: order.customerPhone,
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      // Clear the previous attempt's result so the old failure reason
      // doesn't linger on screen while this fresh STK push is in flight.
      data: { paymentStatus: payment.status, paymentRef: payment.reference, paymentResultCode: null, paymentResultDesc: null },
      include: { items: true },
    });
    res.json({ order: serializeOrder(updated), payment });
  } catch (err) {
    next(err);
  }
});

const statusUpdateSchema = z.object({
  status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']).optional(),
  paymentStatus: z.enum(['pending', 'paid', 'failed']).optional(),
});

/**
 * @openapi
 * /api/orders/{id}/status:
 *   patch:
 *     summary: Update order/payment status (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.patch('/:id/status', requireAdminKey, async (req, res, next) => {
  try {
    const input = statusUpdateSchema.parse(req.body);
    if (!input.status && !input.paymentStatus) {
      throw new ApiError(400, 'Provide status and/or paymentStatus');
    }
    const order = await prisma.order.update({
      where: { id: parseId(req.params.id) },
      data: input,
      include: { items: true },
    });

    if (input.status) {
      const { subject, html } = orderStatusUpdateEmail({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        status: order.status,
        total: order.total,
      });
      sendMail({ to: order.customerEmail, subject, html }).catch((err) =>
        console.error(`[orders] Failed to send status update email for ${order.orderNumber}:`, err)
      );
    }

    res.json(serializeOrder(order));
  } catch (err) {
    next(err);
  }
});
