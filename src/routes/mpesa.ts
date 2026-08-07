import { Router } from 'express';
import { prisma } from '../prisma';
import { applyMpesaResultToOrder, applyMpesaResultToRegistration } from '../payments/applyMpesaResult';

export const mpesaRouter = Router();

interface StkCallbackItem {
  Name: string;
  Value?: string | number;
}

interface StkCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: { Item: StkCallbackItem[] };
}

function metadataValue(callback: StkCallback, name: string): string | number | undefined {
  return callback.CallbackMetadata?.Item.find((item) => item.Name === name)?.Value;
}

/**
 * @openapi
 * /api/v1/mpesa/callback:
 *   post:
 *     summary: Safaricom Daraja STK push result callback (called by Safaricom, not the app)
 *     tags: [Payments]
 */
mpesaRouter.post('/callback', async (req, res) => {
  // Daraja requires a fast 200 ack regardless of outcome, or it retries the
  // callback repeatedly — internal errors are logged, never surfaced here.
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Confirmed' });

  try {
    const callback: StkCallback | undefined = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) {
      console.error('[mpesa] Callback missing CheckoutRequestID:', JSON.stringify(req.body));
      return;
    }

    const receiptNumber =
      callback.ResultCode === 0 ? metadataValue(callback, 'MpesaReceiptNumber') : undefined;
    const result = { resultCode: callback.ResultCode, resultDesc: callback.ResultDesc, receiptNumber };

    const order = await prisma.order.findFirst({ where: { paymentRef: callback.CheckoutRequestID } });
    if (order) {
      await applyMpesaResultToOrder(order, result);
      return;
    }

    const registration = await prisma.eventRegistration.findFirst({
      where: { paymentRef: callback.CheckoutRequestID },
    });
    if (registration) {
      await applyMpesaResultToRegistration(registration, result);
      return;
    }

    console.error(`[mpesa] No order or registration found for CheckoutRequestID ${callback.CheckoutRequestID}`);
  } catch (err) {
    console.error('[mpesa] Failed to process callback:', err);
  }
});
