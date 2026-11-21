import type { SlotFreeAction, SlotRound } from '../index.ts';

// Спецификация сообщений для будущего тестового шлюза, не его реализация.
export type SandboxScopeV1 = Readonly<{
  environment: 'sandbox';
  sandboxId: string;
  projectId: string;
  accountId: string;
}>;

export type SandboxCapabilitiesV1 = Readonly<{
  protocolVersion: 1;
  scope: SandboxScopeV1;
  games: readonly Readonly<{
    gameId: string;
    rulesVersion: number;
    commands: readonly ('start' | 'free')[];
    stakes: Readonly<{
      minimumCents: string;
      maximumCents: string;
      stepCents: string;
      defaultCents: string;
      presetsCents: readonly string[];
    }>;
  }>[];
}>;

export type SandboxOperationV1<Settings extends object = Readonly<Record<string, never>>> = Readonly<{
  operationId: string;
} & (
  | { kind: 'start'; stakeCents: string; rulesVersion: number; settings: Settings }
  | { kind: 'free'; roundId: string; revision: number; actionId: string; picks?: readonly number[] }
)>;

export type SandboxSnapshotV1<View> = Readonly<{
  protocolVersion: 1;
  scope: SandboxScopeV1;
  gameId: string;
  snapshotVersion: number;
  balanceCents: string;
  round: SlotRound<View> | null;
  freeActions: readonly SlotFreeAction[];
}>;

export type SandboxOperationReplyV1<View> = Readonly<{
  receipt: Readonly<{
    operationId: string;
    roundId: string;
    acceptedRevision: number;
    replayed: boolean;
  }>;
  snapshot: SandboxSnapshotV1<View>;
}>;

export type SandboxErrorV1 = Readonly<{
  protocolVersion: 1;
} & (
  | { code: 'invalid-operation' | 'insufficient-funds' | 'stale-round'; disposition: 'rejected'; operationId: string }
  | { code: 'operation-conflict'; disposition: 'unknown'; operationId: string }
  | { code: 'invalid-request' | 'unauthorized' | 'forbidden' | 'incompatible' | 'unavailable'; disposition: 'unknown'; operationId?: string }
)>;
