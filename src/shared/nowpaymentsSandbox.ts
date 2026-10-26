export const SANDBOX_CASES = ['success', 'partially_paid', 'failed'] as const;
export type SandboxCase = typeof SANDBOX_CASES[number];
export type SandboxDeposit = { id: string; amount: number; scenario: SandboxCase; status: string;
  creditedAmount: number; createdAt: number; paymentId: string | null };
export type SandboxSnapshot = { enabled: false } | { enabled: true; environment: 'sandbox'; currency: string;
  operations: SandboxDeposit[] };
export const validSandboxCase = (value: unknown): value is SandboxCase => SANDBOX_CASES.includes(value as SandboxCase);
