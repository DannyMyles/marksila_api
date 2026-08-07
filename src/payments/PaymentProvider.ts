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

export interface PaymentQueryResult {
  resultCode: number;
  resultDesc: string;
}

export interface PaymentProvider {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  // Actively asks the provider for a payment's outcome, used as a fallback
  // when a callback hasn't (or can't, e.g. on localhost) land. Optional
  // because StubMpesaProvider has nothing real to query.
  queryStatus?(reference: string): Promise<PaymentQueryResult | null>;
}
