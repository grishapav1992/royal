import { CARAMEL_GAME, caramelCost, validCaramelSettings } from '../shared/caramelCarnival';
import { DRAGON_PATH_GAME, validDragonPathSettings } from '../shared/dragonPathProtocol';
import { validCaribbeanTransportSettings } from '../shared/caribbeanTransport';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../shared/caribbeanTreasures';
import { DEFAULT_GAME_STAKE, GAME_STAKE_UNITS, gameStakeMaximum, parseGameStake, usesGameStakes } from '../shared/gameStakes';
import { isLuelonSlotGame, luelonSlotInitialCost, validLuelonSlotSettings } from '../shared/luelonSlots';
import type { ExpansionGameId, ExpansionSession } from '../shared/casinoExpansion';
import { canRecoverOperation } from '../ui/operationFeedback';
import type { NewExpansionAction } from '../wallet/ExpansionClient';
import { validFreePicks, type SlotChoice, type SlotFreeAction, type SlotRound, type SlotServicesV1, type SlotSnapshot, type SlotStatus } from '../../templates/slot-primitive/src/index.ts';
import type { GameHostV1 } from './GameHostContract';

type SlotHost = Pick<GameHostV1, 'manualStakes' | 'expansionClient' | 'demoWallet' | 'walletCoins'>;
type StartSettings = Extract<NewExpansionAction, { action: 'start' }>['settings'];
export type RoyalSlotBinding<View> = Readonly<{
  gameId: ExpansionGameId;
  rulesVersion: number;
  ordinaryStart(stakeCents: string): StartSettings;
  freeMoves?(session: ExpansionSession): readonly Readonly<{ id: string; choices?: readonly SlotChoice[] }>[];
  project(session: ExpansionSession): Readonly<{ revision: number; view: View }> | undefined;
}>;

function startCost(gameId: ExpansionGameId, settings: StartSettings, stake: string): string | undefined {
  if (gameId === DRAGON_PATH_GAME && validDragonPathSettings(settings)) return stake;
  if (gameId === CARAMEL_GAME && validCaramelSettings(settings)) {
    return String(BigInt(stake) * BigInt(caramelCost(settings)));
  }
  if (isLuelonSlotGame(gameId) && validLuelonSlotSettings(gameId, settings)) {
    return String(BigInt(stake) * BigInt(luelonSlotInitialCost(gameId, settings)));
  }
  if (gameId === CARIBBEAN_GAME && validCaribbeanTransportSettings(settings) && settings.caribbean.stakeBasis === 'total') {
    return caribbeanInitialCost(settings.caribbean, stake);
  }
}

export function createRoyalSlotServices<View>(host: SlotHost, binding: RoyalSlotBinding<View>): SlotServicesV1<View> {
  const { expansionClient: client, demoWallet: wallet, walletCoins } = host;
  if (!usesGameStakes(binding.gameId) || host.manualStakes !== 1) throw Error('Slot requires the shared editable stakes contract');
  const maximum = gameStakeMaximum(binding.gameId);
  const parse = (draft: string) => parseGameStake(draft, maximum);
  const currentAccount = () => client.accountId !== null && client.accountId === wallet.accountId;
  const walletBlocked = () => wallet.busy || !!wallet.pending || wallet.hasExternalBusy('expansion');

  function read(): SlotSnapshot<View> {
    if (!currentAccount()) return { status: 'signed-out', round: null, freeActions: [], balanceLabel: null, error: null };
    const session = client.sessions.find(saved => saved.gameId === binding.gameId);
    const projection = session?.rulesVersion === binding.rulesVersion ? binding.project(session) : undefined;
    const round: SlotRound<View> | null = session && projection ? {
      id: session.id, rulesVersion: session.rulesVersion, state: session.state,
      stakeCents: session.stakeUnits, spentCents: session.spentUnits, returnedCents: session.returnedUnits,
      revision: projection.revision, view: projection.view,
    } : null;
    const balance = (wallet.wallet ?? client.wallet)?.balance;
    let status: SlotStatus;
    if (client.busy || client.loading) status = 'busy';
    else if (walletBlocked() || (client.pending && client.pending.gameId !== binding.gameId)) status = 'blocked';
    else if (canRecoverOperation(client)) status = 'recover';
    else if (!client.wallet) status = 'sync-required';
    else if (session && (!round || session.state === 'active')) status = 'unsupported-round';
    else status = 'spin';
    const freeActions: SlotFreeAction[] = [];
    if (status === 'unsupported-round' && session && round) {
      for (const option of binding.freeMoves?.(session) ?? []) {
        const allowed = session.view.actions.find(action => action.move === option.id);
        if (!allowed || allowed.cost !== 0 || (allowed.perPick ?? 0) !== 0) continue;
        const minPicks = allowed.minPicks ?? 0;
        const maxPicks = allowed.maxPicks ?? minPicks;
        const choices = option.choices ?? [];
        if (minPicks > maxPicks || minPicks > choices.length) continue;
        freeActions.push({ id: option.id, label: allowed.label, minPicks, maxPicks, choices });
      }
      if (freeActions.length) status = 'continue';
    }
    return { status, round, freeActions, balanceLabel: balance === undefined ? null : walletCoins(balance), error: client.error || null };
  }

  async function submit(action: NewExpansionAction): Promise<SlotRound<View> | null> {
    const account = client.accountId;
    let accountChanged = false;
    const watchAccount = () => { if (client.accountId !== account) accountChanged = true; };
    client.addEventListener('change', watchAccount);
    try {
      const request = client.act(action);
      // ExpansionClient sets pending before awaiting the network. Only that operation can confirm this command.
      const operation = client.pending;
      await request;
      if (accountChanged || !currentAccount() || client.accountId !== account || !operation
        || operation.gameId !== binding.gameId || client.pending?.id === operation.id) return null;
      const round = read().round;
      if (action.action === 'start') return operation.action === 'start' && round?.id === operation.id ? round : null;
      return action.action === 'move' && operation.action === 'move' && operation.sessionId === action.sessionId
        && operation.revision === action.revision && operation.move === action.move && round?.id === action.sessionId
        && action.revision !== undefined && round.revision === action.revision + 1 ? round : null;
    } finally {
      client.removeEventListener('change', watchAccount);
    }
  }

  return {
    apiVersion: 1,
    stakes: { defaultCents: DEFAULT_GAME_STAKE, presetsCents: GAME_STAKE_UNITS, parse },
    read,
    subscribe(change) {
      const listener = () => change();
      client.addEventListener('change', listener);
      wallet.addEventListener('change', listener);
      return () => {
        client.removeEventListener('change', listener);
        wallet.removeEventListener('change', listener);
      };
    },
    async spin(draft) {
      const stakeUnits = parse(draft);
      if (stakeUnits === undefined || read().status !== 'spin') throw Error('Slot start is unavailable');
      const settings = binding.ordinaryStart(stakeUnits);
      const cost = startCost(binding.gameId, settings, stakeUnits);
      if (cost === undefined) throw Error('Slot start settings do not have a supported price');
      if (cost !== stakeUnits) throw Error('The ordinary spin must cost exactly the selected stake');
      return submit({ gameId: binding.gameId, action: 'start', settings, stakeUnits });
    },
    async playFree(expected, actionId, picks = []) {
      const { status, round, freeActions } = read();
      const action = freeActions.find(option => option.id === actionId);
      if (status !== 'continue' || !round || round.id !== expected.id || round.revision !== expected.revision
        || !action || !validFreePicks(action, picks)) throw Error('Free action is unavailable');
      return submit({ gameId: binding.gameId, action: 'move', sessionId: round.id, revision: round.revision,
        move: action.id, ...(picks.length ? { picks: [...picks] } : {}) });
    },
    async recover() {
      if (read().status !== 'recover') throw Error('No recoverable operation for this slot');
      await client.retry();
    },
    async refresh() {
      if (currentAccount()) await client.refresh();
    },
  };
}
