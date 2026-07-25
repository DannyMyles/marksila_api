import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAdminKey } from '../middleware/adminAuth';
import { generateOrderNumber } from '../utils/orderNumber';
import { paymentProvider } from '../payments/StubMpesaProvider';
import { ApiError } from '../middleware/errorHandler';

export const ordersRouter = Router();

const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  size: z.string().optional(),
  color: z.string().optional(),
});

const createOrderSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().min(7),
  shippingAddress: z.string().min(1),
  items: z.array(orderItemSchema).min(1),
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
    subtotal: order.subtotal,
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
ordersRouter.post('/', async (req, res, next) => {
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
    const total = subtotal; // no shipping/tax/coupon logic in this milestone

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
 * /api/orders/{id}:
 *   get:
 *     summary: Get a single order (admin)
 *     tags: [Orders]
 *     security: [{ AdminKey: [] }]
 */
ordersRouter.get('/:id', requireAdminKey, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: true },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json(serializeOrder(order));
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
      where: { id: Number(req.params.id) },
      data: input,
      include: { items: true },
    });
    res.json(serializeOrder(order));
  } catch (err) {
    next(err);
  }
});
