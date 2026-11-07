import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { gameAccountId } from '../../src/shared/nileWallet';
import { auditDemoLedgerSnapshot, type AuditAttemptObservation, type AuditAttemptSink } from './attempts';
import { isAuditEntityRef, type AuditEntityRef } from './contract';
import { observeAuditIntent } from './intents';

export type WsAttemptOwner = { sessionId: string; accountId: string; connection: object };
type Delivery = 'handed-off' | 'closed' | 'unobserved';
type Decision = AuditAttemptObservation['decision'];
type Balance = AuditAttemptObservation['balance'];
type Reply = { balance: Balance; delivery: Delivery };
type Context = {
  owner: WsAttemptOwner;
  observation: AuditAttemptObservation;
  reply?: Reply;
  dropped: boolean;
  finished: boolean;
};

const pvpActions = new Set(['create', 'invite', 'accept', 'cancel', 'ready', 'terms', 'duel-ready', 'unready', 'resign', 'move']);
const activityActions = new Set(['chess-move', 'chess-resign', 'shot', 'place', 'leave', 'combat-stake', 'combat-ready', 'combat-rematch']);
const pvpRejections = new Set([400, 404, 409, 429]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pvpBalance(payload: Record<string, unknown>, gameSchema: string | undefined): Balance {
  if (!Object.hasOwn(payload, 'wallet')) return { state: 'absent' };
  const wallet = object(payload.wallet);
  if (!wallet) return { state: 'invalid' };
  if (!Object.hasOwn(wallet, 'balanceUnits')) return { state: 'absent' };
  const units = wallet.balanceUnits;
  if (wallet.scope !== 'virtual-usdt-v1' || typeof units !== 'string' || !/^(0|-?[1-9][0-9]{0,77})$/.test(units)) {
    return { state: 'invalid' };
  }
  const micro = BigInt(units);
  if (micro % 10_000n !== 0n) return { state: 'invalid' };
  const sharedWallet = object(wallet.wallet);
  // The virtual transport derives both values from one locked shared-wallet snapshot.
  const snapshot = sharedWallet && !sharedWallet.asset && typeof sharedWallet.balance === 'number' &&
    Number.isFinite(sharedWallet.balance) ? auditDemoLedgerSnapshot(gameSchema, sharedWallet) : null;
  return {
    state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 }, units: String(micro / 10_000n),
    snapshot,
  };
}

/** Observe only commands and replies at the room boundary. The capture never changes a command result. */
export class WsAttemptCapture {
  private readonly contexts = new AsyncLocalStorage<Context>();
  private readonly pending = new WeakMap<object, Set<Context>>();
  private readonly now: () => number;
  private readonly gameSchema: string | undefined;

  constructor(private readonly sink: AuditAttemptSink, options: { now?: () => number; gameSchema?: string } = {}) {
    this.now = options.now ?? Date.now;
    this.gameSchema = options.gameSchema;
  }

  private observation(accountId: string, route: string, operationId: string | null, entity: AuditEntityRef | null): AuditAttemptObservation {
    return {
      accountId, route, operationId, entity, transport: 'websocket', attemptId: randomUUID(), occurredAtMs: this.now(),
      decision: 'unknown', response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' },
    };
  }

  private emit(observation: AuditAttemptObservation, delivery: Delivery) {
    const output = { ...observation, delivery };
    try { this.sink(output); } catch { /* The observer must not fail the underlying command. */ }
  }

  async runPvp<T>(owner: WsAttemptOwner, value: unknown, invoke: () => T | Promise<T>): Promise<T> {
    const command = object(value);
    if (!gameAccountId(owner.accountId) || !command || typeof command.action !== 'string' || !pvpActions.has(command.action) ||
        (command.action === 'create' && (command.mode === 'free' || command.stakeUnits === '0'))) return invoke();
    const operationId = gameAccountId(command.id) ? command.id : null;
    const context: Context = { owner, observation: this.observation(owner.accountId, 'pvp', operationId, null), dropped: false, finished: false };
    const fingerprint = operationId ? observeAuditIntent('pvp', owner.accountId, operationId, value) : undefined;
    if (fingerprint) context.observation.intentFingerprint = fingerprint;
    const active = this.pending.get(owner.connection) ?? new Set<Context>();
    active.add(context);
    this.pending.set(owner.connection, active);
    try {
      return await this.contexts.run(context, invoke);
    } finally {
      context.finished = true;
      active.delete(context);
      if (!active.size) this.pending.delete(owner.connection);
      const reply = context.reply;
      this.emit(reply ? { ...context.observation, response: 'formed', balance: reply.balance } : context.observation,
        reply?.delivery ?? (context.dropped ? 'closed' : 'unobserved'));
    }
  }

  runActivity<T>(owner: WsAttemptOwner, value: unknown, invoke: () => T, entity?: AuditEntityRef): T {
    const type = object(value)?.type;
    if (!gameAccountId(owner.accountId) || typeof type !== 'string' || !activityActions.has(type)) return invoke();
    const reference = isAuditEntityRef(entity) && entity.category === 'pvp' ? entity : null;
    const observation = this.observation(owner.accountId, 'activity.' + type, null, reference);
    try {
      return invoke();
    } finally {
      // The room has no per-command acknowledgement for these controls.
      this.emit(observation, 'unobserved');
    }
  }

  async runPvpService<T extends { status: number; value: unknown }>(
    accountId: string, action: string, value: unknown, invoke: () => T | Promise<T>,
  ): Promise<T> {
    const context = this.contexts.getStore();
    const request = action === 'pvp-command' ? object(object(value)?.request) : null;
    const result = await invoke();
    if (!context || context.finished || context.owner.accountId !== accountId ||
        !context.observation.operationId || request?.id !== context.observation.operationId) return result;
    const snapshot = result.status === 200 ? object(result.value) : null;
    let decision: Decision = 'unknown';
    if (pvpRejections.has(result.status)) decision = 'rejected';
    else if (snapshot?.requestId === context.observation.operationId && typeof snapshot.replayed === 'boolean') {
      decision = snapshot.replayed ? 'replayed' : 'accepted';
    }
    context.observation.decision = decision;
    return result;
  }

  observePvpReply(sessionId: string, connection: object | undefined, type: string, value: unknown, delivery: Delivery) {
    const context = this.contexts.getStore();
    if (!context || context.finished || context.owner.sessionId !== sessionId ||
        (type !== 'pvp' && type !== 'pvp-result') || !context.observation.operationId) return;
    const payload = object(value);
    if (!payload || payload.requestId !== context.observation.operationId) return;
    if (connection && connection !== context.owner.connection) {
      context.dropped = true;
      return;
    }
    if (context.reply?.delivery === 'handed-off') return;
    if (type === 'pvp-result' && payload.rejected === true) context.observation.decision = 'rejected';
    context.reply = {
      balance: type === 'pvp' ? pvpBalance(payload, this.gameSchema) : { state: 'absent' },
      delivery: context.dropped ? 'closed' : delivery,
    };
  }

  dropped(sessionId: string, connection: object) {
    for (const context of this.pending.get(connection) ?? []) {
      if (context.owner.sessionId === sessionId) context.dropped = true;
    }
  }
}
