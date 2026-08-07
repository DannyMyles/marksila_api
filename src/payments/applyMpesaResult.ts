import { Order, EventRegistration } from '@prisma/client';
import { prisma } from '../prisma';

interface MpesaResult {
  resultCode: number;
  resultDesc: string;
  receiptNumber?: string | number;
  // Only ever present when this came from the real STK callback — the STK
  // Query fallback's response has no CallbackMetadata equivalent, so these
  // stay undefined (and the existing DB value, if any, is left untouched)
  // when a payment resolves via polling instead of a delivered callback.
  phone?: string | number;
  amount?: string | number;
  transactionTime?: string | number; // Safaricom's TransactionDate, format YYYYMMDDHHmmss
}

function parseMpesaTimestamp(value: string | number | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const digits = String(value);
  if (digits.length !== 14) return undefined;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6)) - 1;
  const day = Number(digits.slice(6, 8));
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  const second = Number(digits.slice(12, 14));
  return new Date(year, month, day, hour, minute, second);
}

function successMeta(result: MpesaResult) {
  const transactionTime = parseMpesaTimestamp(result.transactionTime);
  return {
    ...(result.phone !== undefined ? { mpesaPhone: String(result.phone) } : {}),
    ...(result.amount !== undefined ? { mpesaAmount: Math.round(Number(result.amount)) } : {}),
    ...(transactionTime ? { mpesaTransactionTime: transactionTime } : {}),
  };
}

export async function applyMpesaResultToOrder(order: Order, result: MpesaResult): Promise<Order> {
  const succeeded = result.resultCode === 0;
  const resultMeta = { paymentResultCode: result.resultCode, paymentResultDesc: result.resultDesc };
  return prisma.order.update({
    where: { id: order.id },
    data: succeeded
      ? {
          status: 'paid',
          paymentStatus: 'paid',
          paymentRef: String(result.receiptNumber ?? order.paymentRef),
          ...resultMeta,
          ...successMeta(result),
        }
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
      ? {
          status: 'confirmed',
          paymentRef: String(result.receiptNumber ?? registration.paymentRef),
          ...resultMeta,
          ...successMeta(result),
        }
      : resultMeta,
  });
}
