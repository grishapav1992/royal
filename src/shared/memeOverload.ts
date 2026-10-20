import { t as translateText } from '../i18n/index';
import {NITRO_GAME,validNitroSession} from './nitroRun';

export const MEME_GAME='studio-meme-overload' as const;
export const MEME_CLIENT_HEADER='X-Royal-Meme-Rules';
export const isNitroFamily=(game:unknown):game is typeof NITRO_GAME|typeof MEME_GAME=>game===NITRO_GAME||game===MEME_GAME;
// The existing version 1 engine is reused without probability or payment changes.
export {NITRO_BETS as MEME_BETS,NITRO_PAYTABLE as MEME_PAYTABLE,NITRO_LINES as MEME_LINES} from './nitroRun';
export const MEME_NAMES=['Doge','Harold','Grumpy Cat','Smudge','Stonks','Pepe','WILD: admin.exe',translateText('Папка BONUS'),translateText('Переподключение')] as const;
export const MEME_RULES=translateText('Поле 6×5, 20 постоянных линий. От трёх одинаковых символов слева. WILD заменяет обычные символы. На каждой линии оплачивается лучшая комбинация. Выигрышные мемы удаляются, остальные падают, новые загружаются сверху. Каждый выигрыш повышает множитель следующего каскада на один до ×5. Два значка сети, собранные на выигрышных полях, дают одно бесплатное переподключение с полной заменой поля при первом поле без выигрыша. Множитель при переподключении сохраняется. 3/4/5+ папок на конечном поле дают 8/10/12 бесплатных вращений. Вирусный режим начинает каждое вращение с ×2. Три папки в нём добавляют два вращения, максимум 20 за раунд. До 12 показов поля за вращение. Общая выплата ограничена 3000 начальными ставками. Одна начальная ставка и одна итоговая выплата. Только тестовые монеты клуба.');
export function validMemeSession(value:unknown):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return v.gameId===MEME_GAME&&validNitroSession({...v,gameId:NITRO_GAME});
}
