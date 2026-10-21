export type AutoplayState = Readonly<{
  active: boolean;
  stopping: boolean;
  total: number;
  completed: number;
}>;

export class Autoplay {
  private active = false;
  private stopping = false;
  private total = 0;
  private completed = 0;

  constructor(private next: () => Promise<boolean>, private changed: () => void) {}

  get state(): AutoplayState {
    return { active: this.active, stopping: this.stopping, total: this.total, completed: this.completed };
  }

  async start(count: number): Promise<void> {
    if (this.active) return;
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Invalid autoplay count');
    this.active = true;
    this.stopping = false;
    this.total = count;
    this.completed = 0;
    try {
      this.changed();
      while (!this.stopping && this.completed < this.total) {
        if (!await this.next()) break;
        this.completed++;
        this.changed();
      }
    } finally {
      this.active = false;
      this.changed();
    }
  }

  stop(): void {
    if (!this.active || this.stopping) return;
    this.stopping = true;
    this.changed();
  }
}
