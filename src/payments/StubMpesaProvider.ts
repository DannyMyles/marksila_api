import { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider } from './PaymentProvider';

/**
 * Stand-in for the real Safaricom Daraja STK Push integration. Simulates an
 * STK push being sent to the customer's phone and immediately returns a
 * "pending" checkout request — mirrors the real API's shape closely enough
 * that swapping in a real provider later shouldn't require API contract
 * changes on the frontend. No real credentials/network calls involved.
 */
export class StubMpesaProvider implements PaymentProvider {
  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const reference = `STUB-${Date.now().toString(36).toUpperCase()}`;
    return {
      status: 'pending',
      reference,
      message: `Simulated STK push sent to ${input.phone} for KES ${input.amount}. Mark the order as paid from the admin dashboard once "received".`,
    };
  }
}

export const paymentProvider: PaymentProvider = new StubMpesaProvider();
