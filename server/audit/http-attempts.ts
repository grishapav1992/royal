import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { gameAccountId } from '../../src/shared/nileWallet';
import { operationReplayed } from '../operation-attempt';
import { auditDemoLedgerSnapshot, type AuditAttemptObservation, type AuditAttemptSink } from './attempts';
import type { AuditResponseBalance, AuditSourceRef } from './contract';
import { auditCommandRoutes, auditFineOperationId, observeAuditIntent } from './intents';

type BalanceShape = 'virtual' | 'real' | 'none';
type Route = { template: string; balanceShape: BalanceShape; pathId?: string | null };
type FormedResponse = Pick<AuditAttemptObservation, 'decision' | 'statusCode' | 'balance'>;

const moneyRoutes: ReadonlyMap<string, BalanceShape> = new Map([
  ['/api/demo-wallet/operations', 'virtual'],
  ['/api/demo-wallet/expansion', 'virtual'],
  ['/api/demo-wallet/casino-sessions', 'virtual'],
  ['/api/demo-wallet/flight', 'virtual'],
  ['/api/demo-wallet/mines', 'virtual'],
  ['/api/demo-wallet/flag-tote', 'virtual'],
  [auditCommandRoutes.fine, 'none'],
  ['/api/progression/spins', 'virtual'],
  ['/api/nowpayments-sandbox/deposits', 'none'],
  ['/api/crypto-wallet/deposits', 'real'],
  ['/api/crypto-wallet/withdrawals', 'real'],
  ['/api/crypto-wallet/rounds', 'real'],
  ['/api/crypto-wallet/stars', 'real'],
  ['/api/skin-studio/generations', 'none'],
]);

const serverReplayRoutes = new Set([
  auditCommandRoutes.core,
  '/api/demo-wallet/flight',
  '/api/demo-wallet/mines',
  '/api/nowpayments-sandbox/deposits',
  '/api/crypto-wallet/stars',
  '/api/skin-studio/generations',
]);

const refreshRoutes = [
  { pattern: /^\/api\/crypto-wallet\/operations\/([^/]+)\/refresh$/i,
    template: '/api/crypto-wallet/operations/:id/refresh', balanceShape: 'real' },
  { pattern: /^\/api\/nowpayments-sandbox\/deposits\/([^/]+)\/refresh$/i,
    template: '/api/nowpayments-sandbox/deposits/:id/refresh', balanceShape: 'none' },
] as const;

const maxObservedResponseBytes = 1_048_576;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bodyOperationId(body: unknown, route: string): string | null {
  const fields = object(body);
  const id = fields && Object.hasOwn(fields, 'id') ? fields.id : null;
  const format = route === auditCommandRoutes.core ? /^[a-f0-9-]{36}$/i : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (typeof id !== 'string' || !format.test(id)) return null;
  return route === auditCommandRoutes.fine ? auditFineOperationId(id) : id;
}

function paidRoute(path: string): Route | null {
  const canonical = path.replace(/\/$/, '').toLowerCase();
  const balanceShape = moneyRoutes.get(canonical);
  if (balanceShape) return { template: canonical, balanceShape };
  for (const route of refreshRoutes) {
    const matched = route.pattern.exec(path.replace(/\/$/, ''));
    if (!matched) continue;
    let pathId: string | null = null;
    try {
      const decoded = decodeURIComponent(matched[1]);
      if (gameAccountId(decoded)) pathId = decoded;
    } catch {
      // Express will reject a malformed escape. Keep only the static template.
    }
    return { template: route.template, balanceShape: route.balanceShape, pathId };
  }
  return null;
}

function virtualUnits(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const amount = /^(-?)(0|[1-9][0-9]{0,75})(?:\.([0-9]{1,78}))?$/.exec(value);
  if (!amount) return null;
  const [, sign, whole, fraction = ''] = amount;
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const absolute = BigInt(whole + fraction.slice(0, 2).padEnd(2, '0'));
  return (sign === '-' ? -absolute : absolute).toString();
}

function responseBalance(body: Record<string, unknown> | null, shape: BalanceShape, snapshot: AuditSourceRef | null): AuditResponseBalance {
  if (!body || shape === 'none') return { state: 'absent' };
  const wallet = Object.hasOwn(body, 'wallet') ? object(body.wallet) : shape === 'real' ? body : null;
  if (!wallet) return { state: Object.hasOwn(body, 'wallet') ? 'invalid' : 'absent' };
  if (shape === 'virtual') {
    if (!Object.hasOwn(wallet, 'balance')) return { state: 'absent' };
    const units = virtualUnits(wallet.balance);
    return units === null ? { state: 'invalid' } :
      { state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 }, units, snapshot };
  }
  if (!Object.hasOwn(wallet, 'balanceUnits')) return { state: 'absent' };
  const units = wallet.balanceUnits;
  if (wallet.asset !== 'USDT' || wallet.scale !== 6 || typeof units !== 'string' || !/^(0|-?[1-9][0-9]{0,77})$/.test(units)) {
    return { state: 'invalid' };
  }
  return { state: 'value', asset: { contour: 'real', code: 'USDT', scale: 6 }, units, snapshot: null };
}

function observeResponse(response: Response, body: unknown, route: Route, snapshot: AuditSourceRef | null,
  serverReplayed: boolean | undefined): FormedResponse {
  const statusCode = response.statusCode;
  let parsed: Record<string, unknown> | null = null;
  let decoded = false;
  const json = typeof response.getHeader('Content-Type') === 'string' &&
    /^application\/json(?:\s*;|$)/i.test(String(response.getHeader('Content-Type')));
  const bodyFits = typeof body === 'string' ? Buffer.byteLength(body) <= maxObservedResponseBytes
    : Buffer.isBuffer(body) && body.length <= maxObservedResponseBytes;
  if (json && bodyFits && ![204, 205, 304].includes(statusCode)) {
    try {
      parsed = object(JSON.parse(typeof body === 'string' ? body : String(body),
        (key: string, value: unknown, context?: { source?: string }) =>
          key === 'balance' && typeof value === 'number' ? context?.source ?? String(value) : value));
      decoded = parsed !== null;
    } catch {
      // The response can still be sent. Its balance is unavailable to the observer.
    }
  }

  let decision: FormedResponse['decision'] = 'unknown';
  if ((statusCode >= 400 && statusCode < 500) || (statusCode >= 500 && parsed?.rejected === true)) {
    decision = 'rejected';
  } else if (statusCode >= 200 && statusCode < 300) {
    if (route.template === auditCommandRoutes.fine && ['changed', 'inactive', 'insufficient', 'id-conflict']
        .some(status => status === parsed?.status)) decision = 'rejected';
    else if (serverReplayed !== undefined) decision = serverReplayed ? 'replayed' : 'accepted';
    else if (!serverReplayRoutes.has(route.template) &&
      (route.template !== auditCommandRoutes.fine || parsed?.status === 'paid') && typeof parsed?.replayed === 'boolean') {
      decision = parsed.replayed ? 'replayed' : 'accepted';
    }
  }
  const balance = decoded || route.balanceShape === 'none' || [204, 205, 304].includes(statusCode)
    ? responseBalance(parsed, route.balanceShape, snapshot) : { state: 'not-recorded' as const };
  return { statusCode, decision, balance };
}

/** Install before the paid route handlers. The route's existing authorization supplies the account. */
export function auditHttpAttempts(sink: AuditAttemptSink, { gameSchema }: { gameSchema?: string } = {}): RequestHandler {
  return (request, response, next) => {
    const route = request.method === 'POST' ? paidRoute(request.path) : null;
    if (!route) return next();
    const { template, pathId } = route;
    const hasServerReplay = serverReplayRoutes.has(template);
    const attemptId = randomUUID();
    const occurredAtMs = Date.now();
    let observed: FormedResponse | null = null;
    let snapshot: AuditSourceRef | null = null;
    let serverReplayed: boolean | undefined;
    let ended = false;

    function complete(delivery: 'handed-off' | 'closed' | 'unobserved') {
      if (ended) return;
      ended = true;
      response.off('finish', onFinish);
      response.off('close', onClose);
      const accountId: unknown = response.locals.accountId;
      if (!gameAccountId(accountId)) return;

      try {
        const operationId = pathId === undefined ? bodyOperationId(request.body, template) : pathId;
        const intentFingerprint = operationId ? observeAuditIntent(template, accountId, operationId, request.body) : undefined;
        sink({
          attemptId, occurredAtMs, accountId, operationId,
          ...(intentFingerprint ? { intentFingerprint } : {}),
          entity: null, transport: 'http', route: template, delivery,
          ...(observed ? { ...observed, response: 'formed' }
            : { decision: 'unknown', statusCode: null, response: 'not-observed', balance: { state: 'not-recorded' } }),
        });
      } catch {
        // Diagnostics must not change the wallet response or propagate from a transport event.
      }
    }

    const onFinish = () => complete(observed ? 'handed-off' : 'unobserved');
    const onClose = () => complete('closed');
    response.once('finish', onFinish);
    response.once('close', onClose);

    // Pin server-only evidence before JSON serialization.
    if (hasServerReplay || (route.balanceShape === 'virtual' && gameSchema !== undefined)) {
      const json = response.json;
      response.json = function (this: Response, body?: unknown) {
        const previousSnapshot = snapshot;
        const previousServerReplayed = serverReplayed;
        if (!ended && !this.headersSent && gameAccountId(this.locals.accountId)) {
          try {
            if (route.balanceShape === 'virtual') snapshot = auditDemoLedgerSnapshot(gameSchema, object(body)?.wallet);
            if (hasServerReplay) {
              const result = body as { [operationReplayed]?: boolean } | null | undefined;
              serverReplayed = result?.[operationReplayed];
            }
          } catch {
            snapshot = null;
            serverReplayed = undefined;
          }
        }
        try {
          return json.call(this, body);
        } finally {
          snapshot = previousSnapshot;
          serverReplayed = previousServerReplayed;
        }
      };
    }
    // Express res.json passes the serialized body to res.send after applying JSON replacers.
    const send = response.send;
    response.send = function (this: Response, body?: unknown) {
      const observe = !ended && !this.headersSent && observed === null && gameAccountId(this.locals.accountId);
      if (observe) {
        try {
          observed = observeResponse(this, body, route, snapshot, serverReplayed);
        } catch {
          // Leave the response unobserved if sanitization fails.
        }
      }
      try {
        return send.call(this, body);
      } catch (error) {
        if (observe && !this.headersSent) observed = null;
        throw error;
      }
    };
    next();
  };
}
