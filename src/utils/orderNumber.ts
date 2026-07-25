// Mirrors the MK254-XXXXXXXXX format already used client-side in the Fitness
// repo's lib/utils.ts (generateOrderId), so order numbers look consistent
// regardless of which side generated them.
export function generateOrderNumber(): string {
  const random = Math.random().toString(36).slice(2, 11).toUpperCase();
  return `MK254-${random}`;
}
