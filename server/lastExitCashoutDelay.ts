import type { ExpansionAction } from '../src/shared/casinoExpansion';

export const LAST_EXIT_CASHOUT_DELAY_MS = 200;

/** Wait outside the wallet transaction so the race and other requests keep running. */
export class LastExitCashoutDelay {
  private gates = new Map<string, { wait: Promise<void>; done: boolean }>();

  constructor(private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  async wait(account: string, operation: ExpansionAction): Promise<void> {
    if (operation.gameId !== 'github-crash' || operation.action !== 'move' || operation.move !== 'cashout') return;
    const key = JSON.stringify([account, operation.id]);
    let gate = this.gates.get(key);
    if (!gate) {
      gate = { wait: this.sleep(LAST_EXIT_CASHOUT_DELAY_MS), done: false };
      this.gates.set(key, gate);
      const current = gate;
      void gate.wait.then(() => {
        current.done = true;
        for (const [id, entry] of this.gates) {
          if (this.gates.size <= 512) break;
          if (entry.done && id !== key) this.gates.delete(id);
        }
      });
    }
    await gate.wait;
  }
}
