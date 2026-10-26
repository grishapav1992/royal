export const PAYMENT_METHODS = [
  { id: 'nowpayments', name: 'NOWPayments', environment: 'live' },
  { id: 'nowpayments-sandbox', name: 'NOWPayments Sandbox', environment: 'sandbox' },
] as const;

export const RETIRED_PAYMENT_MESSAGE = 'Этот способ оплаты удалён. Используй NOWPayments или NOWPayments Sandbox.';
