import {
  CARIBBEAN_GAME, validCaribbeanSettings, validCaribbeanStake, validCaribbeanSettlement,
  type CaribbeanSettings, type CaribbeanView, type CaribbeanMove,
} from './caribbeanTreasures.ts';
import type { ExpansionSession, ExpansionView, ExpansionAction } from './casinoExpansion';

export type CaribbeanTransportSettings = { caribbean: CaribbeanSettings };
export const CARIBBEAN_CLIENT_HEADER='X-Royal-Caribbean-Treasures';
export const CARIBBEAN_MOVES = ['caribbean-spin','caribbean-choose-raid','caribbean-choose-flagship'] as const;
export function validCaribbeanTransportSettings(value: unknown): value is CaribbeanTransportSettings {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).join(',') === 'caribbean'
    && validCaribbeanSettings((value as CaribbeanTransportSettings).caribbean);
}
export function caribbeanCoreMove(value: string): CaribbeanMove {
  if (!(CARIBBEAN_MOVES as readonly string[]).includes(value)) throw new Error('Unknown Caribbean action');
  return value.slice('caribbean-'.length) as CaribbeanMove;
}
export function caribbeanMaximumFactor(settings: unknown): number {
  if (!validCaribbeanTransportSettings(settings)) return 300000;
  const {lines,mode,stakeBasis} = settings.caribbean;
  return (stakeBasis === 'total' ? 1 : lines) * (mode === 'normal' ? 15000 : mode === 'buy-raid' ? 14000 : 6000);
}
export function caribbeanExpansionView(view: CaribbeanView): ExpansionView {
  const ended = view.phase === 'complete';
  const actions = view.phase === 'choice'
    ? [{ move:'caribbean-choose-raid',label:'Рейд на торговцев · 14 вращений',cost:0 },
      { move:'caribbean-choose-flagship',label:'Штурм флагмана · 6 вращений',cost:0 }]
    : ended ? [] : [{ move:'caribbean-spin',label:'Бесплатное вращение',cost:0 }];
  return { player:[],dealer:[],community:[],actions,phase:view.revision,ended,
    message:ended ? 'Раунд завершён. Общая выплата начислена.' :
      view.phase === 'choice' ? 'Карта абордажа открыта. Выбери тактику.' : 'Бесплатная серия сохранена.',
    caribbean:view };
}
export function validCaribbeanSession(value: unknown): value is ExpansionSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as ExpansionSession, view = session.view?.caribbean;
  return Object.keys(session).sort().join(',') === 'gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view'
    && session.gameId === CARIBBEAN_GAME && session.rulesVersion === view?.version
    && typeof session.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session.id)
    && validCaribbeanStake(session.stakeUnits)
    && validCaribbeanSettlement(session.state,session.spentUnits,session.returnedUnits,view)
    && session.stakeUnits === view.lineStakeUnits
    && JSON.stringify(session.view) === JSON.stringify(caribbeanExpansionView(view));
}
export function validCaribbeanReply(session: ExpansionSession, operation: ExpansionAction, replayed: boolean, sessions: ExpansionSession[]): boolean {
  if (operation.gameId !== CARIBBEAN_GAME) return true;
  if (!validCaribbeanSession(session)) return false;
  const view = session.view.caribbean!;
  if (!replayed && !sessions.some(candidate => candidate.id === session.id
    && candidate.gameId === CARIBBEAN_GAME && JSON.stringify(candidate) === JSON.stringify(session))) return false;
  if (operation.action === 'start') return validCaribbeanTransportSettings(operation.settings)
    && session.stakeUnits === operation.stakeUnits
    && JSON.stringify(view.settings) === JSON.stringify(operation.settings.caribbean)
    && (replayed || view.revision === 1);
  return Number.isSafeInteger(operation.revision) && view.revision > operation.revision!
    && (replayed || view.revision === operation.revision! + 1)
    && view.operations[operation.revision!]?.move === caribbeanCoreMove(operation.move);
}
