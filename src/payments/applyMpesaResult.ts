import { Order, EventRegistration } from '@prisma/client';
import { prisma } from '../prisma';

interface MpesaResult {
  resultCode: number;
  resultDesc: string;
  receiptNumber?: string | number;
}

export async function applyMpesaResultToOrder(order: Order, result: MpesaResult): Promise<Order> {
  const succeeded = result.resultCode === 0;
  const resultMeta = { paymentResultCode: result.resultCode, paymentResultDesc: result.resultDesc };
  return prisma.order.update({
    where: { id: order.id },
    data: succeeded
      ? { status: 'paid', paymentStatus: 'paid', paymentRef: String(result.receiptNumber ?? order.paymentRef), ...resultMeta }
      : { paymentStatus: 'failed', ...resultMeta },
  });
}

export async function applyMpesaResultToRegistration(
  registration: EventRegistration,
  result: MpesaResult
): Promise<EventRegistration> {
  const succeeded = result.resultCode === 0;
  const resultMeta = { paymentResultCode: result.resultCode, paymentResultDesc: result.resultDesc };
  // A failed/cancelled STK push leaves the registration as-is
  // (pending_payment) so the customer can retry — no TicketStatus value
  // represents "failed" the way PaymentStatus does for orders — but
  // resultMeta still records why, for the status endpoint to surface.
  return prisma.eventRegistration.update({
    where: { id: registration.id },
    data: succeeded
      ? { status: 'confirmed', paymentRef: String(result.receiptNumber ?? registration.paymentRef), ...resultMeta }
      : resultMeta,
  });
}
