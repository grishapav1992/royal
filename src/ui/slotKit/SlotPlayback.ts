export type SlotOperation = {token: string; account: string; generation: number};

/** Cancel visual work together when its owner, visibility or round generation changes. */
export class SlotPlayback {
  private generation = 0;
  private destroyed = false;
  private delays = new Map<ReturnType<typeof setTimeout>, (ok: boolean) => void>();
  private nextTimer?: ReturnType<typeof setTimeout>;

  constructor(private environment: {account(): string | null; hidden(): boolean}) {}

  capture(account: string): SlotOperation {
    return {token: crypto.randomUUID(), account, generation: this.generation};
  }

  current(operation: SlotOperation, active: SlotOperation | undefined): boolean {
    return active === operation && !this.destroyed
      && operation.generation === this.generation
      && operation.account === this.environment.account() && !this.environment.hidden();
  }

  delay(ms: number, current: () => boolean): Promise<boolean> {
    if (this.destroyed || !current()) return Promise.resolve(false);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.delays.delete(timer);
        resolve(!this.destroyed && current());
      }, ms);
      this.delays.set(timer, resolve);
    });
  }

  schedule(ms: number, next: () => void): void {
    this.cancelScheduled();
    if (this.destroyed) return;
    const generation = this.generation, account = this.environment.account();
    this.nextTimer = setTimeout(() => {
      this.nextTimer = undefined;
      if (!this.destroyed && generation === this.generation
          && account === this.environment.account() && !this.environment.hidden()) next();
    }, ms);
  }

  cancelScheduled(): void {
    clearTimeout(this.nextTimer);
    this.nextTimer = undefined;
  }

  cancel(): void {
    this.generation++;
    this.cancelScheduled();
    for (const [timer, resolve] of this.delays) {
      clearTimeout(timer);
      resolve(false);
    }
    this.delays.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
  }
}
