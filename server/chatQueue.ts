type Job = {
  task: (cancelled: () => boolean) => void | Promise<void>;
  cancelled: boolean;
  onCancel?: () => void;
  owner?: object;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type Lane = { running?: Job; waiting: Job[] };

/** Account order spans rooms; a slow account never blocks other available lanes. */
export class ChatQueue {
  private lanes = new Map<string, Lane>();
  constructor(private maxPerAccount = CHAT_PENDING_LIMIT, private maxAccounts = 12) {}

  enqueue(account: string, task: Job['task'], onCancel?: () => void, owner?: object): Promise<void> | undefined {
    let lane = this.lanes.get(account);
    if (!lane) {
      if (this.lanes.size >= this.maxAccounts) return;
      lane = { waiting: [] }; this.lanes.set(account, lane);
    }
    if (lane.waiting.length + Number(Boolean(lane.running)) >= this.maxPerAccount) return;
    const current = lane;
    const promise = new Promise<void>((resolve, reject) => {
      current.waiting.push({ task, cancelled: false, onCancel, owner, resolve, reject });
    });
    this.next(account, current);
    return promise;
  }

  cancel(account: string, owner?: object) {
    const lane = this.lanes.get(account);
    if (!lane) return;
    const cancel = (job: Job) => {
      if (job.cancelled || (owner && job.owner !== owner)) return false;
      job.cancelled = true;
      try { job.onCancel?.(); } catch { /* Cancellation must still release queue capacity. */ }
      return true;
    };
    if (lane.running) cancel(lane.running);
    lane.waiting = lane.waiting.filter(job => {
      if (!cancel(job)) return true;
      job.resolve(); return false;
    });
  }

  private next(account: string, lane: Lane) {
    if (lane.running) return;
    const job = lane.waiting.shift();
    if (!job) { if (this.lanes.get(account) === lane) this.lanes.delete(account); return; }
    lane.running = job;
    // Cancelled in-flight work keeps its lane until the provider actually settles.
    void Promise.resolve().then(() => job.cancelled ? undefined : job.task(() => job.cancelled))
      .then(job.resolve, job.reject).finally(() => { lane.running = undefined; this.next(account, lane); });
  }
}

export const chatQueue = new ChatQueue();
import { CHAT_PENDING_LIMIT } from '../src/shared/chat';

