import type {AfterView} from '../../shared/afterglow';
import type {ExpansionSession} from '../../shared/casinoExpansion';
import type {NitroView} from '../../shared/nitroRun';
import type {ConvoyView} from '../../shared/lastConvoy';
import type {CaramelView} from '../../shared/caramelCarnival';
import type {LuelonSlotView} from '../../shared/luelonSlots';
import type {NewExpansionAction} from '../../wallet/ExpansionClient';
import type {SlotDefinition, SlotProtocol} from './SlotDefinition';

type SlotViews = {afterglow:AfterView;nitro:NitroView;luelon: LuelonSlotView; caramel: CaramelView; convoy: ConvoyView};
export type NativeSlotSession<K extends SlotProtocol> = ExpansionSession & {
  view: ExpansionSession['view'] & {[P in K]: SlotViews[P]};
};
type WalletOwner = {accountId: string | null; wallet?: {balance: number}};

/** Uses the existing wallet transport, pending UUID and server idempotency unchanged. */
export class SlotSessions<K extends SlotProtocol> {
  constructor(private definition: Pick<SlotDefinition, 'gameId'> & {protocol: K}) {}

  session(sessions: readonly ExpansionSession[]): NativeSlotSession<K> | undefined {
    const kind = this.definition.protocol === 'afterglow' ? 'afterglow' : this.definition.protocol === 'nitro' ? 'nitro-run' : this.definition.protocol === 'convoy' ? 'last-convoy' : this.definition.protocol === 'caramel' ? 'caramel-carnival' : 'luelon-slot';
    return sessions.find(s => s.gameId === this.definition.gameId && s.rulesVersion === 2
      && s.view[this.definition.protocol]?.kind === kind) as NativeSlotSession<K> | undefined;
  }

  revision(session: NativeSlotSession<K>): number {
    return session.view[this.definition.protocol].revision;
  }

  key(session: NativeSlotSession<K>): string {
    return `${session.id}:${this.revision(session)}`;
  }

  balance(client: WalletOwner, wallet: WalletOwner): number {
    return wallet.accountId === client.accountId
      ? wallet.wallet?.balance ?? client.wallet?.balance ?? 0 : client.wallet?.balance ?? 0;
  }

  operation(stakeUnits: string, mode: string, previous?: NativeSlotSession<K>, pick?: number): NewExpansionAction {
    const gameId = this.definition.gameId;
    if (this.definition.protocol !== 'luelon' && pick !== undefined) throw Error('This game has no symbol choice');
    if (previous?.state === 'active') {
      return {gameId, action: 'move', sessionId: previous.id, revision: this.revision(previous),
        move: this.definition.protocol === 'afterglow' ? 'afterglow-spin' : this.definition.protocol === 'nitro' ? 'nitro-spin' : this.definition.protocol === 'convoy' ? 'convoy-spin' : this.definition.protocol === 'caramel' ? 'caramel-spin' : pick === undefined ? 'luelon-spin' : 'luelon-pick',
        ...(pick === undefined ? {} : {picks: [pick]})};
    }
    return {gameId, action: 'start', stakeUnits,
      settings: this.definition.protocol === 'afterglow' ? {afterglow:{mode:'normal'}} : this.definition.protocol === 'nitro' ? {nitro:{mode:'normal'}} : this.definition.protocol === 'convoy' ? {convoy:{mode:'normal'}} : this.definition.protocol === 'caramel' ? {caramel: {mode}} : {luelon: {mode}}} as NewExpansionAction;
  }

  confirmed(session: NativeSlotSession<K> | undefined, previous: NativeSlotSession<K> | undefined,
    operationId: string): session is NativeSlotSession<K> {
    if (!session || session.gameId !== this.definition.gameId) return false;
    return previous?.state === 'active'
      ? session.id === previous.id && this.revision(session) === this.revision(previous) + 1
      : session.id === operationId;
  }
}
