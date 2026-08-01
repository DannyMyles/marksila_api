import { env } from '../env';
import { ApiError } from '../middleware/errorHandler';
import { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider } from './PaymentProvider';

const BASE_URLS: Record<string, string> = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

// Converts the app's loosely-validated phone formats (+254712345678,
// 0712345678, 254712345678) into the 2547XXXXXXXX/2541XXXXXXXX shape Daraja
// requires.
export function normalizeMpesaPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`;
  throw new ApiError(400, `Invalid M-Pesa phone number: ${phone}`);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export class DarajaMpesaProvider implements PaymentProvider {
  private baseUrl(): string {
    return BASE_URLS[env.mpesaEnv] ?? BASE_URLS.sandbox;
  }

  private async getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.value;
    }

    const credentials = Buffer.from(`${env.mpesaConsumerKey}:${env.mpesaConsumerSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    if (!res.ok) {
      throw new ApiError(502, 'Could not authenticate with M-Pesa. Please try again shortly.');
    }
    const data = (await res.json()) as { access_token: string; expires_in: string };
    // Refresh a little early to avoid racing the actual expiry.
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in || '3600') - 60) * 1000,
    };
    return cachedToken.value;
  }

  private buildPassword(timestamp: string): string {
    return Buffer.from(`${env.mpesaShortcode}${env.mpesaPasskey}${timestamp}`).toString('base64');
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const phone = normalizeMpesaPhone(input.phone);
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'Could not reach M-Pesa. Please try again shortly.');
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          BusinessShortCode: env.mpesaShortcode,
          Password: this.buildPassword(timestamp),
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.max(1, Math.round(input.amount)),
          PartyA: phone,
          PartyB: env.mpesaShortcode,
          PhoneNumber: phone,
          CallBackURL: `${env.mpesaCallbackUrl}/api/v1/mpesa/callback`,
          AccountReference: input.orderNumber.slice(0, 12),
          TransactionDesc: `Mark254 payment ${input.orderNumber}`,
        }),
      });
    } catch {
      throw new ApiError(502, 'Could not reach M-Pesa. Please try again shortly.');
    }

    const data = (await res.json().catch(() => ({}))) as {
      ResponseCode?: string;
      ResponseDescription?: string;
      CheckoutRequestID?: string;
      errorMessage?: string;
    };

    if (!res.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID) {
      throw new ApiError(502, data.errorMessage || data.ResponseDescription || 'M-Pesa declined the payment request.');
    }

    return {
      status: 'pending',
      reference: data.CheckoutRequestID,
      message: `Enter your M-Pesa PIN on your phone (${input.phone}) to complete payment.`,
    };
  }
}
