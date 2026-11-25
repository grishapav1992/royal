import { language, locale } from '../../src/i18n/index';

/** Wording ships with the package, so an older host never lacks a translation. */
export const text = (ru: string, en: string) => language === 'en' ? en : ru;
export const money = (units: string | number | bigint) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function rulesHtml() {
 return [
  text('Выбери ставку и начни заезд. После двухсекундного отсчёта множитель растёт. Нажми «Уйти от погони» до аварии: выплата равна ставке, умноженной на коэффициент в момент принятия запроса сервером. Если авария произошла раньше, ставка проиграна.',
   'Choose your bet and start a run. After a two-second countdown the multiplier rises. Take the exit before the crash: the payout is your bet times the multiplier when the server accepts your request. If the crash happens first, the bet is lost.'),
  text('Коэффициент округляется вниз до сотой, доли цента учитываются при завершении заезда. Достижение 100× оплачивается автоматически. Повтор подтверждённой операции не создаёт новую ставку или выплату.',
   'The cashout multiplier rounds down to a hundredth and fractional cents are included when the run ends. Reaching 100× pays automatically. Repeating a confirmed operation does not create another bet or payout.'),
  text('Столкновения, погоня, повороты, мосты и взрывы являются оформлением. Управления машиной нет, эффекты не сообщают будущий исход. Они зависят от показанного множителя и номера заезда. Точку аварии определяет сервер при старте.',
   'Collisions, the pursuit, turns, bridges and explosions are presentation. There is no steering, and effects do not reveal the future outcome. They follow the displayed multiplier and the run number. The server determines the crash point at the start.'),
  text('Во время заезда коэффициент рассчитывается непрерывно между ответами сервера. Третья цифра показывает движение счётчика, сумма на кнопке приблизительная. Окончательный коэффициент и выплату подтверждает сервер. Если ответа нет 3 секунды, показ останавливается до восстановления связи. Авария при этом не откладывается. Закрытый заезд сохраняется.',
   'During a run the multiplier is calculated continuously between server replies. The third decimal shows the counter moving; the button amount is approximate. The server confirms the final multiplier and payout. If no reply arrives for 3 seconds, the display pauses until the connection recovers. A crash is not postponed. Closed runs are saved.'),
  text('После завершения кнопка нового заезда закрыта на мгновение, чтобы запоздалое нажатие на выход не начало новый платный заезд.',
   'After a run ends the new run button stays closed for a moment, so a late press of the exit cannot start another paid run.'),
  text('Основа Crash: расчётный возврат около 96% для фиксированных целей до округления и задержек. Это долгосрочная оценка, не обещание результата отдельного заезда.',
   'Crash base: approximately 96% theoretical return for fixed targets before rounding and network delays. This is a long-run figure, not a promise for any individual run.'),
 ].map(paragraph => `<p>${paragraph}</p>`).join('');
}
