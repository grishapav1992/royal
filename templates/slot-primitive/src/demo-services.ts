import { validFreePicks, type SlotFreeAction, type SlotRound, type SlotServicesV1, type SlotStatus } from './index.ts';
import { paylineCells, type PaylineLayout } from './paylines.ts';
import type { ReelView } from './view.ts';

export const scenarios = {
  lines: 'Линии', ways: 'Ways с разной высотой', cascades: 'Кластер и каскад',
  hold: 'Удержание и респин', bonus: 'Фриспин, выбор и восстановление',
};
export type Scenario = keyof typeof scenarios;
const symbols = [2, 5, 2, 4, 1, 1, 3, 1, 2];
const nextGrid = [4, 1, 3, 2, 3, 4, 1, 2, 2];
const cascadeGrid = [2, 1, 3, 4, 3, 2, 3, 5, 2];
const holdGrid = [2, 1, 3, 2, 1, 4, 1, 1, 2];
const defaultLayout = { columns: 5, rows: 3, paylines: [[1, 1, 1, 1, 1]] };
const presets = ['10', '20', '50', '100', '200', '500', '1000', '2000', '5000'];
const board = { columns: 3, symbols };
const free: SlotFreeAction = { id: 'free-spin', label: 'Бесплатный спин', minPicks: 0, maxPicks: 0, choices: [] };
const respin: SlotFreeAction = { ...free, id: 'respin', label: 'Респин' };
const choose: SlotFreeAction = { id: 'choose', label: 'Подтвердить выбор', minPicks: 1, maxPicks: 1,
  choices: [{ value: 1, label: 'Символ 1' }, { value: 2, label: 'Символ 2' }] };

function parse(draft: string): string | undefined {
  const parts = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(draft.trim());
  if (!parts) return;
  const cents = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  if (cents >= 10 && cents <= 5000) return String(cents);
}

function initial(scenario: Scenario, layout: PaylineLayout): ReelView {
  switch (scenario) {
    case 'lines': return { columns: layout.columns, paylines: layout.paylines,
      symbols: Array.from({ length: layout.rows * layout.columns }, (_, index) => symbols[index % symbols.length]),
      highlights: layout.paylines[0] ? paylineCells(layout.columns, layout.paylines[0]) : [],
      features: ['Подсветка первой линии из конструктора, без расчёта выигрыша'] };
    case 'ways': return { ...board, heights: [3, 2, 3], highlights: [0, 3, 4, 5], features: ['Подтверждённый путь ways'] };
    case 'cascades': return { ...board, symbols: cascadeGrid, stages: [
      { symbols, symbolsAfter: cascadeGrid, highlights: [4, 5, 7], removed: [4, 5, 7],
        drops: [{ from: 1, to: 7, symbol: 5 }, { from: 2, to: 5, symbol: 2 }],
        refills: [{ position: 1, symbol: 1 }, { position: 2, symbol: 3 }, { position: 4, symbol: 3 }] },
      { symbols: cascadeGrid },
    ], features: ['Кластер и два готовых кадра каскада'] };
    case 'hold': return { ...board, held: [0, 4, 7], features: ['Удержано 3 символа', 'Остался 1 респин'] };
    case 'bonus': return { ...board, highlights: [0, 2, 8], features: ['Скаттеры', 'Остался 1 бесплатный спин'] };
  }
}

export function createDemoServices(scenario: Scenario = 'bonus', readLayout: () => PaylineLayout = () => defaultLayout): SlotServicesV1<ReelView> {
  const events = new EventTarget();
  const notify = () => events.dispatchEvent(new Event('change'));
  let count = 0;
  let status: SlotStatus = 'spin';
  let round: SlotRound<ReelView> | null = null;
  let pending: SlotRound<ReelView> | null = null;

  function freeActions(): readonly SlotFreeAction[] {
    if (status !== 'continue' || !round) return [];
    if (scenario === 'hold') return [respin];
    return round.revision === 1 ? [free] : [choose];
  }

  async function show(next: SlotRound<ReelView>, loseReply = false) {
    status = 'busy'; notify();
    await Promise.resolve();
    if (loseReply) {
      pending = next;
      status = 'recover'; notify();
      return null;
    }
    pending = null;
    round = next;
    status = next.state === 'active' ? 'continue' : 'spin';
    notify();
    return next;
  }

  return {
    apiVersion: 1,
    stakes: { defaultCents: '10', presetsCents: presets, parse },
    read: () => ({ status, round, freeActions: freeActions(), balanceLabel: null, error: null }),
    subscribe(change) {
      const listener = () => change();
      events.addEventListener('change', listener);
      return () => events.removeEventListener('change', listener);
    },
    async spin(draft) {
      const stakeCents = parse(draft);
      if (status !== 'spin' || stakeCents === undefined) throw Error('Demo spin is unavailable');
      const active = scenario === 'bonus' || scenario === 'hold';
      return show({ id: `demo-${++count}`, revision: 1, rulesVersion: 1, state: active ? 'active' : 'settled',
        stakeCents, spentCents: stakeCents, returnedCents: scenario === 'cascades' ? '300' : scenario === 'ways' ? '5' : '0',
        view: initial(scenario, readLayout()) });
    },
    async playFree(expected, actionId, picks = []) {
      const action = freeActions().find(option => option.id === actionId);
      if (!round || round.id !== expected.id || round.revision !== expected.revision
        || !action || !validFreePicks(action, picks)) throw Error('Demo action is unavailable');
      const active = actionId === 'free-spin';
      const view: ReelView = { columns: 3, symbols: actionId === 'respin' ? holdGrid : nextGrid,
        features: active ? ['Множитель ×3', 'Выберите символ для коллекции']
          : actionId === 'respin' ? ['Респин завершён'] : [`В коллекцию добавлен символ ${picks[0]}`],
        ...(actionId === 'respin' ? { held: [0, 4, 7, 8] } : {}),
      };
      const returnedCents = actionId === 'respin' ? '10' : actionId === 'choose' ? '30' : '0';
      return show({ ...round, revision: round.revision + 1, state: active ? 'active' : 'settled', view, returnedCents }, active);
    },
    async recover() {
      if (status !== 'recover' || !pending) throw Error('No demo operation to recover');
      await show(pending);
    },
    async refresh() { notify(); },
  };
}
