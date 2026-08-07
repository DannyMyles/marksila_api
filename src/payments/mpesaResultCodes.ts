// Well-documented, commonly-seen Safaricom STK push ResultCodes, mapped to
// clearer customer-facing copy. Anything not in this table falls back to
// Safaricom's own ResultDesc — still a real, specific reason, just not one
// we've rewritten a friendlier version of.
const KNOWN_RESULT_MESSAGES: Record<number, string> = {
  0: 'Payment completed successfully.',
  1: 'Insufficient M-Pesa balance.',
  1032: 'You cancelled the M-Pesa request.',
  1037: "You didn't respond to the M-Pesa prompt in time.",
};

export function describeMpesaResult(resultCode: number, resultDesc: string): string {
  return KNOWN_RESULT_MESSAGES[resultCode] ?? resultDesc;
}
