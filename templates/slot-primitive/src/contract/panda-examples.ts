import type { SlotFreeAction, SlotRound } from '../index.ts';
import type { ReelView } from '../view.ts';
import type {
  SandboxCapabilitiesV1, SandboxErrorV1, SandboxOperationReplyV1, SandboxOperationV1, SandboxSnapshotV1,
} from './sandbox-v1.ts';

// Фиксированные примеры сообщений, без вызова движка и случайного выбора исхода.
type PandaView = ReelView & Readonly<{
  scatter: boolean;
  wins: readonly Readonly<{ line: number; length: number }>[];
  columnWins: readonly Readonly<{ column: number; from: number; length: number }>[];
}>;

const gameId = 'panda-dragon-preview';
const scope = { environment: 'sandbox', sandboxId: 'sandbox-example', projectId: 'project-example', accountId: 'account-example' } as const;
const capabilities = {
  protocolVersion: 1,
  scope,
  games: [{ gameId, rulesVersion: 1, commands: ['start', 'free'], stakes: {
    minimumCents: '10', maximumCents: '5000', stepCents: '1', defaultCents: '10',
    presetsCents: ['10', '20', '50', '100', '200', '500', '1000', '2000', '5000'],
  } }],
} as const satisfies SandboxCapabilitiesV1;

const idle = {
  protocolVersion: 1, scope, gameId, snapshotVersion: 1, balanceCents: '5000', round: null, freeActions: [],
} as const satisfies SandboxSnapshotV1<PandaView>;
const start = {
  kind: 'start', operationId: '00000000-0000-4000-8000-000000000001', stakeCents: '10', rulesVersion: 1, settings: {},
} as const satisfies SandboxOperationV1;
const spin = {
  kind: 'free', operationId: '00000000-0000-4000-8000-000000000002', roundId: start.operationId,
  revision: 1, actionId: 'dragon-path-free-spin',
} as const satisfies SandboxOperationV1;
const reward = {
  kind: 'free', operationId: '00000000-0000-4000-8000-000000000003', roundId: start.operationId,
  revision: 2, actionId: 'dragon-path-choose-reward', picks: [2],
} as const satisfies SandboxOperationV1;

const ordinaryView: PandaView = {
  columns: 5,
  paylines: [[2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [4, 4, 4, 4, 4], [1, 1, 1, 1, 1], [3, 3, 3, 3, 3],
    [0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 1, 0, 1, 2], [2, 3, 4, 3, 2], [1, 2, 3, 2, 1]],
  symbols: [2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5],
  highlights: [], wins: [], columnWins: [], scatter: false, features: [],
};
const ordinaryRound = {
  id: start.operationId, revision: 1, rulesVersion: 1, state: 'settled',
  stakeCents: '10', spentCents: '10', returnedCents: '0', view: ordinaryView,
} as const satisfies SlotRound<PandaView>;
const ordinary = {
  receipt: { operationId: start.operationId, roundId: ordinaryRound.id, acceptedRevision: 1, replayed: false },
  snapshot: { ...idle, snapshotVersion: 2, balanceCents: '4990', round: ordinaryRound },
} as const satisfies SandboxOperationReplyV1<PandaView>;

const freeSpin = {
  id: spin.actionId, label: 'Бесплатный спин', minPicks: 0, maxPicks: 0, choices: [],
} as const satisfies SlotFreeAction;
const chooseReward = {
  id: reward.actionId, label: 'Подтвердить выбор', minPicks: 1, maxPicks: 1,
  choices: [{ value: 2, label: 'Персик Мудрости' }, { value: 3, label: 'Пельмени Мастера' }],
} as const satisfies SlotFreeAction;
const bonusStart = {
  receipt: ordinary.receipt,
  snapshot: { ...ordinary.snapshot, freeActions: [freeSpin], round: {
    ...ordinaryRound, state: 'active', view: {
      ...ordinaryView, symbols: [0, 0, 0, ...ordinaryView.symbols.slice(3)], scatter: true, highlights: [0, 1, 2],
      features: ['Три Свитка Дракона открыли бонус', 'Остался 1 бесплатный спин'],
    },
  } },
} as const satisfies SandboxOperationReplyV1<PandaView>;
const bonusSpin = {
  receipt: { operationId: spin.operationId, roundId: spin.roundId, acceptedRevision: 2, replayed: false },
  snapshot: { ...bonusStart.snapshot, snapshotVersion: 3, freeActions: [chooseReward], round: {
    ...bonusStart.snapshot.round, revision: 2, view: {
      ...ordinaryView, symbols: [2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 8, 8, 8, 8, 2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5],
      highlights: [10, 11, 12, 13], wins: [{ line: 0, length: 4 }], features: ['Множитель ×3'],
    },
  } },
} as const satisfies SandboxOperationReplyV1<PandaView>;
const bonusResult = {
  receipt: { operationId: reward.operationId, roundId: reward.roundId, acceptedRevision: 3, replayed: false },
  snapshot: { ...bonusSpin.snapshot, snapshotVersion: 4, balanceCents: '5055', freeActions: [], round: {
    ...bonusSpin.snapshot.round, revision: 3, state: 'settled', returnedCents: '65', view: {
      ...bonusSpin.snapshot.round.view, features: ['Множитель ×3', 'Бонус завершён', 'Персик Мудрости'],
    },
  } },
} as const satisfies SandboxOperationReplyV1<PandaView>;
const retryStart = { ...start } satisfies SandboxOperationV1;
const startReplay = {
  receipt: { ...bonusStart.receipt, replayed: true }, snapshot: bonusStart.snapshot,
} as const satisfies SandboxOperationReplyV1<PandaView>;
const spinReplayAfterSettlement = {
  receipt: { ...bonusSpin.receipt, replayed: true }, snapshot: bonusResult.snapshot,
} as const satisfies SandboxOperationReplyV1<PandaView>;

const errors = {
  stale: { protocolVersion: 1, code: 'stale-round', disposition: 'rejected', operationId: '00000000-0000-4000-8000-000000000004' },
  conflict: { protocolVersion: 1, code: 'operation-conflict', disposition: 'unknown', operationId: spin.operationId },
  revoked: { protocolVersion: 1, code: 'unauthorized', disposition: 'unknown', operationId: start.operationId },
  unavailable: { protocolVersion: 1, code: 'unavailable', disposition: 'unknown', operationId: start.operationId },
} as const satisfies Record<string, SandboxErrorV1>;

// ordinary и bonusStart принадлежат альтернативным историям от одного состояния idle.
export const pandaExamples = {
  capabilities, idle, start, spin, reward, ordinary, bonusStart, bonusSpin, bonusResult, retryStart, startReplay,
  spinReplayAfterSettlement, errors,
} as const;
