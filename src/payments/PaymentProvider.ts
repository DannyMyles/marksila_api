export interface InitiatePaymentInput {
  orderNumber: string;
  amount: number; // KES
  phone: string;
}

export interface InitiatePaymentResult {
  status: 'pending' | 'paid' | 'failed';
  reference: string;
  message: string;
}

export interface PaymentProvider {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}
