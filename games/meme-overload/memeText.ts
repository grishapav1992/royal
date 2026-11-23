import {language,t,tr as hostTr} from '../../src/i18n/index';

// Labels of the desktop layout travel with the package. The installed host dictionary can predate them.
const english:Record<string,string>={
 'Основная игра':'Main game','20 линий':'20 lines','Папка «Не открывать»':'“Do not open” folder','Папки':'Folders','Вращения':'Spins','Разгон':'Overclock','Сеть':'Network','Вирусный режим':'Virus mode',
 '3 / 4 / 5+ папок = 8 / 10 / 12 вращений':'3 / 4 / 5+ folders = 8 / 10 / 12 spins','на 8 вращений':'for 8 spins','до ×5':'up to ×5','значки сети':'network icons',
 '{0} из {1}':'{0} of {1}','осталось {0}':'{0} left','Папки {0} / 3. Три папки = ещё 2 вращения':'Folders {0} / 3. Three folders = 2 more spins','папки {0} / 3':'folders {0} / 3',
 'Значки сети собираются при выигрыше. Два значка дают одно бесплатное переподключение.':'Network icons are collected on wins. Two icons give one free reconnect.',
 'Сеть восстановлена. Одно переподключение за вращение.':'Network restored. One reconnect per spin.','Переподключение при остановке серии':'Reconnects when the series stops',
 'Следующий каскад: ×{0}':'Next cascade: ×{0}','Каскад {0} · ×{1}':'Cascade {0} · ×{1}','Каскад {0} · ×{1} · сеть +{2}':'Cascade {0} · ×{1} · network +{2}','Выигрыш раунда':'Round win','Выигрыш':'Win','Баланс':'Balance','Ставка':'Stake','Раунд':'Round',
 'Автоигра':'Autoplay','Сколько вращений':'Number of spins','Запустить {0} вращений':'Start {0} spins','По {0} за вращение. Бесплатные вращения в счёт не входят. Серию можно остановить в любой момент.':'{0} per spin. Free spins are not counted. You can stop the series at any time.','Закрыть автоигру':'Close autoplay','Закрыть':'Close',
 'Правила':'Rules','Журнал':'Log','Звук':'Sound','Музыка':'Music','Громкость':'Volume','Показ без анимаций':'No animations','Настройки игры':'Game settings','Меню игры':'Game menu','Игровое поле':'Game field','Состояние раунда':'Round status','Пауза':'Pause','Вирусный режим на паузе':'Virus mode is paused','Скорость':'Speed',
 'Вирусный режим на паузе. Нажми «Продолжить».':'Virus mode is paused. Press Continue.','Вирусный режим продолжается бесплатно.':'Virus mode continues for free.','ещё {0}':'{0} more','Линия {0}: {1}':'Line {0}: {1}','Л{0}: {1}':'L{0}: {1}',
 'Система готова. Нажми «Крутить».':'System ready. Press Spin.','Система готова. Нажми «Крутить», чтобы загрузить мемы.':'System ready. Press Spin to load memes.','Выигрыш подтверждён':'Win confirmed','Как открыть бесплатные вращения':'How to unlock free spins','Разгон и сеть':'Overclock and network','20 линий и каскады':'20 lines and cascades',
 'Каждый выигрыш разгоняет следующий каскад. Два значка сети дают одно бесплатное переподключение.':'Every win overclocks the next cascade. Two network icons give one free reconnect.',
 'Одна ставка и одна итоговая выплата на раунд. При обрыве связи подтверждается прежний ход. Закрытие или скрытие окна останавливает автоигру. Вирусный режим сохраняется. Автоигра делает выбранные 10, 25, 50 или 100 платных вращений. Бесплатные вращения в счёт не входят, после итога серия продолжается. Покупки бонуса нет.':'One stake and one final payout per round. After a connection loss the previous move is confirmed. Closing or hiding the window stops autoplay. Virus mode is saved. Autoplay makes the chosen 10, 25, 50 or 100 paid spins. Free spins are not counted, the series continues after the result. There is no bonus purchase.',
 'Изображения загружаются':'Loading pictures',
};
const own=(source:string)=>{
 const key=source.trim();if(!Object.hasOwn(english,key))return undefined;
 return source.slice(0,source.length-source.trimStart().length)+english[key]+source.slice(source.trimEnd().length);
};
const labels=(source:string)=>source.replace(/[^<>"'\n]+/g,label=>own(label)??label);
export const memeText=(source:string)=>language!=='en'?t(source):own(source)??t(/[<>]/.test(source)?labels(source):source);
/** Labels are translated as the host does, values stay untouched. */
export function memeMarkup(parts:TemplateStringsArray,...values:unknown[]):string{
 if(language!=='en')return hostTr(parts,...values);
 if(parts.some(part=>/[<>]/.test(part))){const local=parts.map(labels);return hostTr(Object.assign(local,{raw:parts.raw}) as unknown as TemplateStringsArray,...values);}
 const translated=own(parts.map((part,i)=>part+(i<values.length?`{${i}}`:'')).join(''));
 return translated===undefined?hostTr(parts,...values):translated.replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)]));
}
