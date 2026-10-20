type Pending = { count: number; tail: Promise<void> };

// Bound both waiting messages and active accounts while preserving each account's order.
export class ChatQueue {
  private pending = new Map<string, Pending>();
  constructor(private perAccount = 3, private maxAccounts = 12) {}

  enqueue(id: string, run: () => Promise<void>): Promise<void> | undefined {
    let entry = this.pending.get(id);
    if (entry ? entry.count >= this.perAccount : this.pending.size >= this.maxAccounts) return;
    if (!entry) {
      entry = { count: 0, tail: Promise.resolve() };
      this.pending.set(id, entry);
    }
    const pending = entry;
    pending.count++;
    const result = pending.tail.then(run).finally(() => {
      if (--pending.count === 0) this.pending.delete(id);
    });
    // A failed check must not discard the next message or leave an unhandled rejection.
    pending.tail = result.catch(() => {});
    return result;
  }
}

export const chatQueue = new ChatQueue();
