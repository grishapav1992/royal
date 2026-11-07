import type { ChatResult } from '../src/shared/chat';
import { LOBBY_RECOVERY_WINDOW_MS } from '../src/shared/lobbyConnection';

type ChatOutcome = { status: Exclude<ChatResult['status'], 'queued'>; message?: string };
export type ChatReceipt = { settledAt?: number; outcome: Promise<ChatOutcome>; settle: (outcome: ChatOutcome) => void };

class ChatReceipts {
  private readonly accounts = new Map<string, Map<string, ChatReceipt>>();
  private cleanedAt = 0;

  find(accountId: string, requestId: string, now: number): ChatReceipt | undefined {
    const receipt = this.accounts.get(accountId)?.get(requestId.toLowerCase());
    if (receipt && (receipt.settledAt === undefined || now - receipt.settledAt < LOBBY_RECOVERY_WINDOW_MS)) return receipt;
  }

  create(accountId: string, requestId: string, now: number): ChatReceipt {
    if (now - this.cleanedAt >= LOBBY_RECOVERY_WINDOW_MS) {
      for (const [id, receipts] of this.accounts) {
        for (const [key, receipt] of receipts) {
          if (receipt.settledAt !== undefined && now - receipt.settledAt >= LOBBY_RECOVERY_WINDOW_MS) receipts.delete(key);
        }
        if (receipts.size === 0) this.accounts.delete(id);
      }
      this.cleanedAt = now;
    }
    const receipts = this.accounts.get(accountId) ?? new Map<string, ChatReceipt>();
    let resolve!: ChatReceipt['settle'];
    const outcome = new Promise<ChatOutcome>(done => { resolve = done; });
    const receipt: ChatReceipt = {
      outcome,
      settle(result) { receipt.settledAt = Date.now(); resolve(result); },
    };
    receipts.set(requestId.toLowerCase(), receipt);
    this.accounts.set(accountId, receipts);
    return receipt;
  }
}

export const chatReceipts = new ChatReceipts();
