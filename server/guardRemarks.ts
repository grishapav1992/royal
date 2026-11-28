// Short local guard lines. They appear above the guard only and never enter the public chat.
export const GUARD_REMARKS = {
  greeting: ['Добрый вечер.', 'Хорошей игры.', 'Всё спокойно, отдыхайте.', 'Удачи за столами.'],
  drunk: ['Аккуратнее на поворотах.', 'Может, стакан воды?', 'Держись ровнее, гость.'],
  disguised: ['Пол блестит. Хорошая работа.', 'Уборка? Проходи.', 'Тут уже чисто, спасибо.'],
} as const;
export type GuardRemarkKind = keyof typeof GUARD_REMARKS;

export const GUARD_TRAIL_LINES = {
  lost: 'Куда делся?',
  search: 'Где-то здесь был…',
  found: 'Вот ты где!',
  gone: 'Ушёл. Ещё встретимся.',
  radio: 'Вызываю подмогу.',
  arriving: 'Иду на помощь.',
} as const;

export function pickRemark(kind: GuardRemarkKind, random: () => number, previous?: string): string {
  const lines = GUARD_REMARKS[kind];
  let index = Math.min(lines.length - 1, Math.floor(random() * lines.length));
  if (lines[index] === previous) index = (index + 1) % lines.length;
  return lines[index];
}
