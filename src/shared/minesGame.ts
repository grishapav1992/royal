import type { DemoWallet } from './demoWallet';
export type MinesOperation =
  | { id: string; action: 'start'; amount: number; mineCount: number }
  | { id: string; action: 'reveal'; sessionId: string; cell: number }
  | { id: string; action: 'cashout'; sessionId: string };
export type MinesSession = {
  id: string;
  state: 'active' | 'lost' | 'cashed_out';
  amount: number;
  mineCount: number;
  revealed: number[];
  mineCells?: number[];
  multiplier: number;
  nextMultiplier: number | null;
  payout: number;
};
export type MinesResult = { wallet: DemoWallet; session: MinesSession | null };
