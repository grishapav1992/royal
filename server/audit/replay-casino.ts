import { identifier, type PostgresDatabase } from '../database';
import type { ExpansionState } from '../demoExpansion';
import { verifyGameRound } from '../games/core';
import { validExpansionAction, type ExpansionAction } from '../../src/shared/casinoExpansion';
import { caribbeanCoreMove } from '../../src/shared/caribbeanTransport';
import { flagCountries, flagViewMode } from '../../src/shared/flagBattle';
import { rebuildTempleView } from '../../src/shared/floodedTemple';
import { advanceCascade, initialCascadeState } from '../../src/shared/floodedTempleCascadeMath';
import { GAME_CATALOG, type GameRound } from '../../src/shared/gameCore';
import { JACKIE_COSTUMES, JACKIE_LOCATIONS } from '../../src/shared/jackieChan';
import { PLINKO_RISKS } from '../../src/shared/originalGames';
import type { RoundPrecision } from '../../src/shared/roundPrecision';
import type { AuditSourceRef } from './contract';
import { checkCapturedCasinoRound, type CapturedCasinoRoundCheck } from './check-casino';
import { registeredAuditMode } from './mode-registry';
import { createReplayPackage, isReplayId, type ReplayEvent, type ReplayManifest, type ReplayPackage, type ReplayState } from './replay-package';
import { AuditReplayStore } from './replay-store';

type Request = { datasetId: string; gameSchema: string; posting: AuditSourceRef; replayId: string };
type Checked = Extract<CapturedCasinoRoundCheck, { status: 'found' }>;
type Step = Checked['result']['steps'][number];
type Money = NonNullable<ReplayEvent['money']>[number];
type Start = Extract<ExpansionAction, { action: 'start' }>;
type Move = Extract<ExpansionAction, { action: 'move' }>;
type EventData = ReplayEvent['data'];
type Draft = Parameters<typeof createReplayPackage>[0];
type BuildGap = 'not-captured' | 'unsupported' | 'source-unavailable' | 'opening-outside-dataset'
  | 'sealed-session-unavailable' | 'inconsistent-source' | 'accepted-start-unavailable';
export type CasinoReplayBuild = { status: 'built'; value: ReplayPackage } | { status: 'unavailable'; reason: BuildGap };

const unavailable = (reason: BuildGap): CasinoReplayBuild => ({ status: 'unavailable', reason });
const maxRequests = 512;
const ordinal = <T>(value: T, values: readonly T[]) => values.indexOf(value);
const risks = ['safe', 'sharp', 'extreme'] as const;
const moves = [
  'cashout', 'caribbean-spin', 'caribbean-choose-raid', 'caribbean-choose-flagship',
  'temple-cascade', 'temple-step', 'temple-rope', 'temple-finish', 'forest-spin', 'forest-pass', 'forest-turn',
  'jackie-fight', 'penalty-kick', 'neopolis-spin', 'dracona-spin', 'afterglow-spin', 'nitro-spin', 'convoy-spin',
  'caramel-spin', 'luelon-spin', 'luelon-pick', 'wild-nudge-spin', 'studio-spin',
] as const;

function parse(text: unknown): unknown {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function money(value: Step | Checked['result']['payout'], namespace: string, movement: Money['movement']): Money | null {
  const refs = value.sources.filter(ref => ref.namespace === namespace);
  const units = value.observedUnits;
  if (value.status !== 'match' || units === null || refs.length !== 1) return null;
  const debit = movement === 'stake' || movement === 'paid-option';
  if (debit && BigInt(units) <= 0n) return null;
  return { movement, units: debit ? '-' + units : units, posting: refs[0] };
}

function state(revision: number, visible: number[], phase: 'open' | 'settled' = 'open'): ReplayState {
  return { profile: 'casino-steps', phase, revision, visible };
}

function action(code: 'start' | 'move' | 'cashout', selection: number[]): EventData {
  return { kind: 'action', action: { profile: 'casino-steps', code, selection } };
}

function terminal(revision: number, visible: number[]): EventData {
  return { kind: 'terminal', state: state(revision, visible, 'settled'), outcome: 'settled', winnerSeat: null };
}

function collect(events: ReplayEvent[], data: EventData, leg?: Money, precision?: RoundPrecision) {
  events.push({ sequence: events.length + 1, atMs: 0, data, postings: leg ? [leg.posting] : [],
    ...(leg ? { money: [leg] } : {}),
    ...(precision ? { calculation: { baseUnits: precision.baseUnits, creditedUnits: precision.creditedUnits,
      numerator: precision.numerator, denominator: precision.denominator } } : {}),
  });
}

function draft(checked: Checked, replayId: string, entityId: string, engineId: string, engineRevision?: string): Draft | null {
  const { entity, scope } = checked;
  if (!entity.rulesVersion) return null;
  const rulesVersion = entity.rulesVersion;
  const mode = registeredAuditMode(entity.gameId, entity.modeId, Number(rulesVersion));
  if (mode?.category !== 'casino') return null;
  return {
    formatVersion: 2, timing: 'source-order', scope, replayId, entityId,
    game: { ...mode,
      gameVersion: 'server-rules-' + rulesVersion, engineId,
      engineVersion: engineRevision === undefined ? rulesVersion : rulesVersion + '-' + engineRevision },
    initial: state(0, []), coverage: 'complete', gaps: [],
  };
}

function built(header: Draft, events: ReplayEvent[], gaps: ReplayManifest['gaps'] = []): CasinoReplayBuild {
  return { status: 'built', value: createReplayPackage({ ...header, gaps, coverage: gaps.length ? 'partial' : 'complete' }, events) };
}

function instantView(round: GameRound): { selection: number[]; visible: number[] } | null {
  if (round.gameId === 'royal-roulette') {
    const bet = ordinal(round.input.bet, ['red', 'black', 'even', 'odd', 'number']);
    return { selection: round.input.bet === 'number' ? [bet, round.input.number] : [bet], visible: [round.outcome.number] };
  }
  if (round.gameId === 'royal-plinko') {
    return { selection: [round.input.rows, ordinal(round.input.risk, PLINKO_RISKS)],
      visible: [...round.outcome.path, round.outcome.bucket] };
  }
  return null;
}

async function instant(audit: PostgresDatabase, checked: Checked, input: Request, id: string): Promise<CasinoReplayBuild> {
  const row = await audit.prepare(`SELECT result FROM ${identifier(input.gameSchema)}.demo_operations
    WHERE account_id=? AND operation_id=?`).get(checked.accountId, id);
  const saved = parse(row?.result), round = record(saved) ? saved.gameRound : null;
  if (!verifyGameRound(round) || round.gameId !== checked.entity.gameId) return unavailable('inconsistent-source');
  const view = instantView(round), definition = GAME_CATALOG.find(game => game.id === round.gameId && game.rulesVersion === round.rulesVersion);
  const header = definition && draft(checked, input.replayId, id, definition.engineId);
  if (!view || !header) return unavailable('unsupported');
  const namespace = input.gameSchema + '.demo_ledger';
  const debit = checked.result.steps[0] && money(checked.result.steps[0], namespace, 'stake');
  const credit = money(checked.result.payout, namespace, 'payout');
  if (!debit || !credit) return unavailable('inconsistent-source');
  const events: ReplayEvent[] = [];
  collect(events, action('start', view.selection), debit);
  collect(events, terminal(1, view.visible), credit, round.precision);
  return built(header, events);
}

function startSelection(start: Start, saved: ExpansionState): number[] {
  const { settings } = start;
  if ('caribbean' in settings) return [settings.caribbean.lines];
  if ('flags' in settings && saved.view.flags) return [flagCountries(flagViewMode(saved.view.flags)).findIndex(c => c.id === settings.flags.country)];
  if ('penalty' in settings) return [settings.penalty.hero === 'cr' ? 0 : 1, ordinal(settings.penalty.risk, risks)];
  if ('jackie' in settings) return [ordinal(settings.jackie.risk, risks),
    JACKIE_COSTUMES.findIndex(costume => costume.id === settings.jackie.costume),
    JACKIE_LOCATIONS.findIndex(location => location.id === settings.jackie.location)];
  return [];
}

function moveSelection(move: Move): number[] | null {
  const forest = /^forest-turn-(\d+)$/.exec(move.move);
  if (forest) return [moves.indexOf('forest-turn'), Number(forest[1])];
  const kind = moves.findIndex(value => value === move.move);
  if (kind === -1) return null;
  return [kind, ...(move.picks ?? []), ...(move.penaltyRisk ? [ordinal(move.penaltyRisk, risks)] : [])];
}

function consecutiveMoves(moves: readonly Move[], initialRevision: number) {
  return moves.every((move, index) => move.revision === initialRevision + index);
}

function singleCheckpointFrames(s: ExpansionState, start: Start, accepted: Move[]): number[][] | null {
  const v = s.view;
  if (v.flags) {
    const flags = v.flags, countries = flagCountries(flagViewMode(flags)).map(country => country.id);
    return accepted.length ? null : [flags.order.map(country => countries.indexOf(country))];
  }
  if (s.gameId === 'github-crash') {
    if (accepted.length > 1 || accepted.some(move => move.move !== 'cashout')) return null;
    const hundredths = Math.round((s.multiplier ?? 0) * 100);
    // The cutoff becomes public after settlement. Encode its saved decimal without assigning a time.
    const cutoff = [...String(s.crashPoint)].map(character => character === '.' ? 10 : Number(character));
    const visible = s.state === 'settled' ? [...compact(hundredths), ...cutoff] : [];
    return accepted.length ? [[], visible] : [visible];
  }
  if (v.caribbean && 'caribbean' in start.settings) {
    const c = v.caribbean;
    let spin = 0, visible: number[] = [];
    return c.operations.length === accepted.length + 1 && accepted.every(move =>
      move.revision !== undefined && c.operations[move.revision]?.move === caribbeanCoreMove(move.move))
      ? c.operations.map(operation => {
        if (operation.move === 'spin' || operation.move === 'start' && c.settings.mode === 'normal') {
          visible = c.spins[spin++].frame.grid;
        }
        return visible;
      }) : null;
  }
  if (v.temple) {
    const t = v.temple;
    if (!consecutiveMoves(accepted, 1) || t.history.length !== accepted.length ||
        t.history.some((step, i) => accepted[i].move !== 'temple-' + step.kind
      || ('to' in step ? accepted[i].picks?.[0] !== step.to : accepted[i].picks !== undefined))) return null;
    return Array.from({ length: t.history.length + 1 }, (_, i) => {
      const bonus = rebuildTempleView(t.baseCase, t.bonusCase, s.stakeUnits, t.history.slice(0, i)).bonusState;
      return bonus ? [bonus.at, bonus.left, Number(bonus.ropeAvailable), ...bonus.visited] : [];
    });
  }
  if (v.forestHeart) {
    const f = v.forestHeart, chose = f.base.ability && f.base.choiceDone;
    const expected = chose ? f.base.rotation === null ? 'forest-pass' : 'forest-turn-' + f.base.rotation : null;
    if (!consecutiveMoves(accepted, 1) || (expected && accepted[0]?.move !== expected) ||
        accepted.slice(Number(chose)).some(move => move.move !== 'forest-spin')) return null;
    const base = [...compact(f.base.bits), f.base.energy];
    return [base, ...(chose ? [[...base, (f.base.rotation ?? -1) + 1]] : []),
      ...f.bonus.map(spin => [...compact(spin.bits), spin.energy, spin.receiverMask, spin.heldState])];
  }
  const combat = v.penalty ?? v.jackie?.combat;
  if (combat) {
    const shotMove = v.penalty ? 'penalty-kick' : 'jackie-fight';
    const banked = combat.status === 'banked';
    const shotMoves = accepted.slice(0, banked ? -1 : undefined);
    if (!consecutiveMoves(accepted, 1) || shotMoves.some((move, i) => move.move !== shotMove || move.penaltyRisk !== undefined
      && move.penaltyRisk !== (combat.shots[i + 1]?.risk ?? combat.risk))
      || banked && accepted.at(-1)?.move !== 'cashout') return null;
    const frames = combat.shots.map(shot => [ordinal(shot.finish, ['goal', 'save', 'post', 'wide']), Number(shot.side === 1),
      ordinal(shot.risk ?? combat.risk, risks), ...(shot.zone === undefined ? [] : [shot.zone])]);
    return banked ? [...frames, frames.at(-1)!] : frames;
  }
  if (v.wildNudge) {
    if (!consecutiveMoves(accepted, 1)) return null;
    return v.wildNudge.spins.map(spin => spin.grid);
  }
  return null;
}

// Each accepted operation can produce several visible checkpoints. Only public boards leave the source.
function operationCheckpoints(s: ExpansionState, start: Start, accepted: Move[]): number[][][] | null {
  const v = s.view;
  if (v.templeCascade) {
    if (!consecutiveMoves(accepted, 1) || accepted.some(move => move.move !== 'temple-cascade')) return null;
    const cascade = initialCascadeState();
    return v.templeCascade.operations.map(operation => operation.map(tape => {
      let consumed = 0;
      const frame = advanceCascade(cascade, maximum => {
        const value = tape[consumed++];
        if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error('Invalid saved cascade tape');
        return value;
      });
      if (!frame || consumed !== tape.length) throw new Error('Invalid saved cascade frame');
      return frame.grid;
    }));
  }
  if (v.neopolis || v.dracona) {
    if (!consecutiveMoves(accepted, 1)) return null;
    return v.neopolis?.history.map(spin => spin.result.frames.map(frame => frame.grid))
      ?? v.dracona?.history.map(spin => spin.result.steps.map(step => step.grid)) ?? null;
  }
  const slot = v.caramel ?? v.convoy ?? v.nitro ?? v.afterglow;
  const luelon = v.luelon?.decisions.length === 0 ? v.luelon : undefined;
  const spins = slot?.history.map(spin => {
    const boards = spin.frames.map(frame => frame.before);
    const last = boards.at(-1);
    if (last && spin.finalGrid.some((symbol, position) => symbol !== last[position])) boards.push(spin.finalGrid);
    return boards;
  }) ?? luelon?.history.map(spin => spin.frames.map(frame => frame.gridAfter));
  if (spins) {
    const baseSpin = (slot ?? luelon)?.history[0]?.kind === 'base';
    if (!consecutiveMoves(accepted, baseSpin ? 1 : 0)) return null;
    // A purchased bonus can open before its first spin generates a board.
    return baseSpin ? spins : [[[]], ...spins];
  }
  return singleCheckpointFrames(s, start, accepted)?.map(visible => [visible]) ?? null;
}

const compact = (value: number): number[] => [Math.floor(value / 1000), value % 1000];
const visibleSafe = (values: number[]) => values.length <= 256 && values.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1023);

async function expansion(audit: PostgresDatabase, checked: Checked, input: Request, id: string): Promise<CasinoReplayBuild> {
  const schema = identifier(input.gameSchema), gameId = checked.entity.gameId;
  const raw = await audit.prepare(`SELECT payload FROM ${schema}.demo_casino_sessions WHERE account_id=? AND id=? AND game_id=?`)
    .get(checked.accountId, id, gameId);
  const value = parse(raw?.payload);
  if (!record(value) || !record(value.view) || value.id !== id || value.gameId !== gameId) return unavailable('source-unavailable');
  const saved = value as ExpansionState;
  const combatVersion = saved.view.jackie?.version ?? saved.view.penalty?.version;
  const engineRevision = saved.mathProfileVersion !== undefined ? 'math-' + saved.mathProfileVersion
    : combatVersion === undefined ? undefined : 'combat-' + combatVersion;
  const header = draft(checked, input.replayId, id, 'royal-expansion', engineRevision);
  if (!header) return unavailable('unsupported');
  const accepted = await audit.prepare(`SELECT id,request_key FROM ${schema}.demo_casino_requests WHERE account_id=? AND session_id=? LIMIT ?`)
    .all(checked.accountId, id, maxRequests + 1);
  if (accepted.length > maxRequests) return unavailable('source-unavailable');
  const requests = accepted.map(row => {
    const candidate = parse(row.request_key);
    return validExpansionAction(candidate) && candidate.id === row.id && candidate.gameId === gameId ? candidate : null;
  });
  const start = requests.find((request): request is Start => request?.action === 'start' && request.id === id);
  const startStep = checked.result.steps.find(step => step.operationId === id);
  const namespace = input.gameSchema + '.demo_ledger';
  const debit = startStep && money(startStep, namespace, startStep.kind === 'paid-option' ? 'paid-option' : 'stake');
  if (!start || !debit) return unavailable('accepted-start-unavailable');
  const selection = startSelection(start, saved);
  if (!visibleSafe(selection)) return unavailable('inconsistent-source');
  const events: ReplayEvent[] = [];
  collect(events, action('start', selection), debit);
  const incomplete: ReplayManifest['gaps'] = ['event-gap', 'terminal-unavailable'];
  if (checked.result.stake.status !== 'match' || checked.result.payout.status !== 'match' || requests.some(request => !request)) {
    return built(header, events, incomplete);
  }

  const byId = new Map(checked.result.steps.map(step => [step.operationId, step]));
  // A Crash cashout that only returned an already settled result never advanced the round.
  const acceptedMoves = requests.filter((request): request is Move => request?.action === 'move'
    && request.sessionId === id && byId.get(request.id)?.kind !== 'no-op');
  if (acceptedMoves.some(move => byId.get(move.id)?.kind !== 'free')) return built(header, events, incomplete);
  if (gameId === 'github-crash' ? acceptedMoves.length > 1
    : acceptedMoves.some(move => move.revision === undefined)
      || new Set(acceptedMoves.map(move => move.revision)).size !== acceptedMoves.length) return built(header, events, incomplete);
  acceptedMoves.sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0));
  const selections = acceptedMoves.map(moveSelection);
  let operations: number[][][] | null;
  try { operations = operationCheckpoints(saved, start, acceptedMoves); } catch { operations = null; }
  if (!operations || operations.length !== acceptedMoves.length + 1
    || operations.some(frames => !frames.length || !frames.every(visibleSafe))
    || selections.some(picks => picks === null || !visibleSafe(picks))) return built(header, events, incomplete);

  const settled = checked.result.state === 'settled';
  const payout = settled ? money(checked.result.payout, namespace, 'payout') : null;
  if (settled && !payout) return built(header, events, incomplete);
  for (const [index, frames] of operations.entries()) {
    const move = acceptedMoves[index - 1];
    if (move) collect(events, action(move.move === 'cashout' ? 'cashout' : 'move', selections[index - 1]!));
    const revision = index + 1;
    for (const [frame, visible] of frames.entries()) {
      if (settled && index === operations.length - 1 && frame === frames.length - 1) {
        collect(events, terminal(revision, visible), payout!, saved.precision);
      } else {
        collect(events, { kind: 'checkpoint', state: state(revision, visible) });
      }
    }
  }
  return built(header, events, settled ? [] : ['terminal-unavailable']);
}

/** Project a captured round from one read-only snapshot. No session or wallet method is called. */
export async function buildCapturedCasinoReplay(audit: PostgresDatabase, input: Request): Promise<CasinoReplayBuild> {
  if (!isReplayId(input.replayId)) return unavailable('unsupported');
  return audit.transaction(async () => {
    const checked = await checkCapturedCasinoRound(audit, input);
    if (checked.status !== 'found') return unavailable(checked.status);
    if (checked.basis === 'unavailable-as-of-seal') return unavailable('sealed-session-unavailable');
    if (checked.basis === 'current-source-only') return unavailable('opening-outside-dataset');
    const key = parse(checked.entity.source.rowId);
    if (!Array.isArray(key) || key[0] !== checked.accountId || !isReplayId(key[1])) return unavailable('unsupported');
    const id = key[1];
    return checked.entity.source.namespace.endsWith('.demo_operations')
      ? instant(audit, checked, input, id) : expansion(audit, checked, input, id);
  }, { readOnly: true });
}

export async function persistCapturedCasinoReplay(audit: PostgresDatabase, input: Request) {
  const built = await buildCapturedCasinoReplay(audit, input);
  if (built.status !== 'built') return built;
  const store = new AuditReplayStore(audit), { manifest, fragments } = built.value;
  const header = await store.writeManifest(manifest);
  if (header !== 'recorded' && header !== 'replayed') return { status: 'write-failed' as const, reason: header };
  for (const fragment of fragments) {
    const result = await store.writeFragment(manifest.scope, manifest.replayId, fragment);
    if (result !== 'recorded' && result !== 'replayed') return { status: 'write-failed' as const, reason: result };
  }
  return { status: 'stored' as const, coverage: manifest.coverage, replayId: manifest.replayId };
}
