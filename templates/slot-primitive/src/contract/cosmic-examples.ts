import type { SlotFreeAction, SlotRound } from '../index.ts';
import { COSMIC_FREE_SPIN, COSMIC_GAME, COSMIC_RULES, type CosmicFrame, type CosmicView } from '../cosmic/view-model.ts';
import type { SandboxCapabilitiesV1, SandboxOperationReplyV1, SandboxOperationV1, SandboxSnapshotV1 } from './sandbox-v1.ts';

// Только подтверждённые проекции фиксированных примеров, без движка и параметров случайности.
const frame = (grid: string, highlights: readonly number[] = [], line: readonly number[] = [], cue?: CosmicFrame['cue']): CosmicFrame =>
  ({ symbols: Array.from(grid, Number), highlights, line, ...(cue ? { cue } : {}) });
const ordinary = (result: CosmicFrame, cents = '0', portals = 1): CosmicView =>
  ({ frames: [result], portals, energy: 1, series: null, accumulatedCents: cents });
export const cosmicLoss = ordinary(frame('542621021248453'));
export const cosmicWin = ordinary(frame('485445336625556', [5, 11, 12, 13], [5, 11, 12, 13]), '12');
const bonusFrames = [
  [frame('038634112488225', [2, 10, 11])],
  [frame('465045105132510'), frame('465745107132570', [], [], 'expand')],
  [frame('146635266064001'), frame('301606266425012', [], [], 'echo')],
  [frame('463568552155532', [10, 11, 12, 7, 6], [10, 11, 12])],
  [frame('260553555632575')],
  [frame('545424617321144')],
  [frame('413101046443620'), frame('713107046473620', [], [], 'expand')],
  [frame('041064362405065')],
  [frame('655533226032061')],
  [frame('666640474404551', [0, 1, 2, 3, 7], [0, 1, 2, 3])],
  [frame('040613156451354'), frame('070613756457354', [0, 1, 2, 10, 11, 7, 13, 5, 6, 12], [0, 1, 2], 'expand')],
];
const energy = [1, 2, 3, 6, 6, 9, 10, 10, 10, 11, 11];
const totals = ['0', '0', '0', '72', '72', '72', '72', '72', '72', '248', '830'];
export const cosmicBonus: readonly CosmicView[] = bonusFrames.map((frames, played) => ({
  frames, portals: 3, energy: energy[played], series: { awarded: 10, played, remaining: 10 - played }, accumulatedCents: totals[played],
}));
export const cosmicFreeAction = {
  id: COSMIC_FREE_SPIN, label: 'Продолжить бесплатную серию', minPicks: 0, maxPicks: 0, choices: [],
} as const satisfies SlotFreeAction;
export const cosmicStakes = {
  minimumCents: '10', maximumCents: '10000', stepCents: '1', defaultCents: '10',
  presetsCents: ['10', '20', '50', '100', '200', '500', '1000', '2000', '5000', '10000'],
} as const;
export function cosmicRound(id: string, revision: number, stakeCents: string, view: CosmicView): SlotRound<CosmicView> {
  const active = (view.series?.remaining ?? 0) > 0;
  return { id, revision, rulesVersion: COSMIC_RULES, state: active ? 'active' : 'settled', stakeCents,
    spentCents: stakeCents, returnedCents: active ? '0' : view.accumulatedCents, view };
}

const scope = { environment: 'sandbox', sandboxId: 'cosmic-example', projectId: 'project-example', accountId: 'account-example' } as const;
const capabilities = { protocolVersion: 1, scope, games: [{ gameId: COSMIC_GAME, rulesVersion: COSMIC_RULES,
  commands: ['start', 'free'], stakes: cosmicStakes }] } as const satisfies SandboxCapabilitiesV1;
const idle = { protocolVersion: 1, scope, gameId: COSMIC_GAME, snapshotVersion: 1, balanceCents: '5000',
  round: null, freeActions: [] } as const satisfies SandboxSnapshotV1<CosmicView>;
const start = { operationId: '00000000-0000-4000-8000-000000000011', kind: 'start', stakeCents: '10',
  rulesVersion: COSMIC_RULES, settings: { luelon: { mode: 'normal' } } } as const satisfies
  SandboxOperationV1<{ luelon: { mode: 'normal' } }>;
const free = { operationId: '00000000-0000-4000-8000-000000000012', kind: 'free', roundId: start.operationId,
  revision: 1, actionId: COSMIC_FREE_SPIN } as const satisfies SandboxOperationV1;
function snapshot(view: CosmicView, revision: number, balanceCents: string): SandboxSnapshotV1<CosmicView> {
  const round = cosmicRound(start.operationId, revision, start.stakeCents, view);
  return { ...idle, snapshotVersion: revision + 1, balanceCents, round,
    freeActions: round.state === 'active' ? [cosmicFreeAction] : [] };
}
function reply(operationId: string, acceptedRevision: number, current: SandboxSnapshotV1<CosmicView>, replayed = false): SandboxOperationReplyV1<CosmicView> {
  return { receipt: { operationId, roundId: start.operationId, acceptedRevision, replayed }, snapshot: current };
}
const portal = reply(start.operationId, 1, snapshot(cosmicBonus[0], 1, '4990'));
const continuation = reply(free.operationId, 2, snapshot(cosmicBonus[1], 2, '4990'));
const settled = snapshot(cosmicBonus[10], 11, '5820');
export const cosmicExamples = { capabilities, idle, start, free, loss: reply(start.operationId, 1, snapshot(cosmicLoss, 1, '4990')),
  win: reply(start.operationId, 1, snapshot(cosmicWin, 1, '5002')), portal, continuation, settled,
  recovered: reply(start.operationId, 1, portal.snapshot, true), lateReplay: reply(free.operationId, 2, settled, true) } as const;
