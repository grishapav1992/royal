import { BAR_APPROACH } from '../src/shared/world';
import { ACTIVITIES } from '../src/shared/activities';
import type { Facing } from '../src/shared/movement';
import type { HallId } from '../src/shared/world';

export type GuardStop = { id: string; x: number; y: number; facing: Facing; activity: 'chat' | 'window' | 'inspect' | 'watch' };
export const GUARD_STOPS: Record<HallId, GuardStop[]> = {
  github: [
    { id:'cards', x:650, y:405, facing:'up', activity:'inspect' },
    { id:'dice', x:1480, y:875, facing:'up', activity:'watch' },
    { id:'entrance', x:855, y:1250, facing:'right', activity:'watch' },
  ],
  arcade: [
    { id:'bar', x:BAR_APPROACH.x-38, y:BAR_APPROACH.y-35, facing:'up', activity:'chat' },
    { id:'arcades', x:1380, y:455, facing:'up', activity:'inspect' },
    { id:'window', x:980, y:235, facing:'right', activity:'window' },
    { id:'piano', x:ACTIVITIES.piano.entry.x+95, y:ACTIVITIES.piano.entry.y+5, facing:'left', activity:'inspect' },
    { id:'lounge', x:350, y:955, facing:'left', activity:'watch' },
    { id:'entrance', x:600, y:610, facing:'down', activity:'watch' },
  ],
  tables: [
    { id:'pool', x:710, y:465, facing:'left', activity:'inspect' },
    { id:'window', x:740, y:235, facing:'up', activity:'window' },
    { id:'hockey', x:1220, y:535, facing:'up', activity:'inspect' },
    { id:'chess', x:1550, y:990, facing:'left', activity:'watch' },
    { id:'entrance', x:855, y:1250, facing:'right', activity:'watch' },
  ],
};

// Ambient exchanges are local game dialogue; they do not trigger model requests or enter public chat.
export const GUARD_BAR_TALKS = [
  ['Мира, как смена?', 'Тихо. Только лёд шумит.', 'Тогда продолжаю обход.', 'И не распугай гостей.'],
  ['Всё спокойно у стойки?', 'Да. Лимонад держит оборону.', 'Надёжный напарник.', 'И без перерывов на обед.'],
  ['Сегодня хороший джаз.', 'Наконец-то ты слушаешь музыку.', 'Я всё слышу. Работа такая.', 'Ну конечно, работа.'],
  ['Мира, тебе что-нибудь нужно?', 'Пять минут тишины и новый лимон.', 'Тишину постараюсь обеспечить.', 'Тогда лимон оставь мне.'],
  ['Проверил столы. Порядок.', 'Даже под столами?', 'Там только потерянная удача.', 'Передай в бюро находок.'],
];
