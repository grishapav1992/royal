import { formatCents, type SlotRound, type SlotServicesV1, type SlotStatus } from '../index.ts';
import { cosmicBonus, cosmicFreeAction, cosmicLoss, cosmicRound, cosmicStakes, cosmicWin } from '../contract/cosmic-examples.ts';
import { COSMIC_FREE_SPIN, type CosmicView } from './view-model.ts';

export const cosmicScenarios = {
  ordinary: 'Обычный спин', win: 'Выигрышная линия', bonus: 'Портал и 10 фриспинов',
  portal: 'Бонус: открытый портал', echo: 'Бонус: кадр эха', result: 'Бонус: итог',
  recovery: 'Потеря ответа после принятия',
} as const;
export type CosmicScenario = keyof typeof cosmicScenarios;
type Operation = Readonly<{ id: string; kind: 'start' | 'free'; round: SlotRound<CosmicView> }>;

function parse(draft: string): string | undefined {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(draft.trim());
  if (!match) return;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (amount >= 10n && amount <= 10000n) return String(amount);
}

export function createCosmicDemo(scenario: CosmicScenario, pause: () => Promise<void> = () => Promise.resolve()) {
  const updates = new EventTarget();
  const notify = () => updates.dispatchEvent(new Event('change'));
  const ledger: Operation[] = [];
  let serial = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  let starts = 0;
  let acceptedBalance = 5000n;
  let balance = acceptedBalance;
  let round: SlotRound<CosmicView> | null = null;
  let pending: Operation | undefined;
  let busy = false;
  let error: string | null = null;

  function record(operation: Operation) {
    ledger.push(operation);
    if (operation.kind === 'start') acceptedBalance -= BigInt(operation.round.spentCents);
    if (operation.round.state === 'settled') acceptedBalance += BigInt(operation.round.returnedCents);
  }
  function publish(operation: Operation) {
    round = operation.round;
    balance = acceptedBalance;
  }

  if (scenario === 'portal' || scenario === 'echo' || scenario === 'result') {
    const revision = scenario === 'portal' ? 1 : scenario === 'echo' ? 3 : 11;
    const id = nextId();
    starts++;
    for (let index = 1; index <= revision; index++) {
      const operation = { id: index === 1 ? id : nextId(), kind: index === 1 ? 'start' : 'free',
        round: cosmicRound(id, index, cosmicStakes.defaultCents, cosmicBonus[index - 1]) } as const;
      record(operation);
      publish(operation);
    }
  }

  const status = (): SlotStatus => busy ? 'busy' : pending ? 'recover' : round?.state === 'active' ? 'continue' : 'spin';
  async function submit(operation: Operation, loseReply = false) {
    busy = true; error = null; notify();
    try {
      await pause();
      record(operation);
      if (loseReply) {
        pending = operation;
        error = 'Ответ не дошёл. Проверьте тот же ход.';
        return null;
      }
      publish(operation);
      return operation.round;
    } finally { busy = false; notify(); }
  }

  const services: SlotServicesV1<CosmicView> = {
    apiVersion: 1,
    stakes: { ...cosmicStakes, parse },
    read() {
      const current = status();
      return { status: current, round, freeActions: current === 'continue' ? [cosmicFreeAction] : [],
        balanceLabel: formatCents(String(balance)).replace('.', ','), error };
    },
    subscribe(change) {
      updates.addEventListener('change', change);
      return () => updates.removeEventListener('change', change);
    },
    async spin(draft) {
      const stake = parse(draft);
      if (!stake || status() !== 'spin') throw Error('Ставка или новый ход недоступны.');
      if (BigInt(stake) > balance) throw Error('Недостаточно тестовых единиц.');
      const first = ++starts === 1;
      const id = nextId();
      const view = first && scenario === 'bonus' ? cosmicBonus[0] : first && (scenario === 'win' || scenario === 'recovery') ? cosmicWin : cosmicLoss;
      const operation = { id, kind: 'start', round: cosmicRound(id, 1, stake, view) } as const;
      return submit(operation, first && scenario === 'recovery');
    },
    async playFree(expected, actionId, picks = []) {
      if (status() !== 'continue' || !round || expected.id !== round.id || expected.revision !== round.revision
        || actionId !== COSMIC_FREE_SPIN || picks.length) throw Error('Этот ход больше недоступен.');
      const revision = round.revision + 1;
      return submit({ id: nextId(), kind: 'free', round: cosmicRound(round.id, revision, round.stakeCents, cosmicBonus[revision - 1]) });
    },
    async recover() {
      if (status() !== 'recover' || !pending) throw Error('Нет хода для восстановления.');
      const saved = pending;
      busy = true; notify();
      try {
        await pause();
        pending = undefined;
        error = null;
        // Запись уже существует; публикуем её снимок, не записывая повторный ход.
        publish(saved);
      } finally { busy = false; notify(); }
    },
    async refresh() { notify(); },
  };
  return { services, operations: (): readonly Operation[] => ledger.slice(), pendingId: () => pending?.id };
}
