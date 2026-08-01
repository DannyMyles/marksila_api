import { env } from '../env';
import { PaymentProvider } from './PaymentProvider';
import { StubMpesaProvider } from './StubMpesaProvider';
import { DarajaMpesaProvider } from './DarajaMpesaProvider';

const hasMpesaCredentials = Boolean(
  env.mpesaConsumerKey && env.mpesaConsumerSecret && env.mpesaShortcode && env.mpesaPasskey && env.mpesaCallbackUrl
);

export const paymentProvider: PaymentProvider = hasMpesaCredentials
  ? new DarajaMpesaProvider()
  : new StubMpesaProvider();

console.log(
  hasMpesaCredentials
    ? `[payments] Using real M-Pesa (Daraja, ${env.mpesaEnv}) — STK pushes are live.`
    : '[payments] MPESA_* env vars not fully set — using StubMpesaProvider (simulated payments).'
);

export * from './PaymentProvider';
