import {language,t,tr} from '../i18n/index';

// The installed host can predate this independent package's result vocabulary.
const english:Record<string,string>={
 'Героини открываются по очереди: Мия (обычная), Наоми (редкая), Ева (эпическая), Алиса (легендарная). Следующая героиня открывается по общему прогрессу только после предыдущих.':'Heroines unlock in order: Mia (common), Naomi (rare), Eva (epic), Alice (legendary). The next heroine unlocks through album progress only after the earlier heroines.',
 'ВЫПЛАТА ЗА РАУНД':'ROUND PAYOUT',
 'ГРАНДИОЗНЫЙ ВЫИГРЫШ':'EPIC WIN',
 'Показать итог':'Show total',
 'ИТОГ РАУНДА +{0}':'ROUND NET +{0}',
 'СТАВКА ВОЗВРАЩЕНА':'STAKE RETURNED',
 'ВЫПЛАТА {0} · ИТОГ −{1}':'PAYOUT {0} · NET −{1}',
 'ВЫПЛАТА {0} · ИТОГ +{1}':'PAYOUT {0} · NET +{1}',
 'Фотосессия продолжается. Выплата после завершения раунда.':'The photo shoot continues. Payout follows the completed round.',
};
export const afterText=(source:string)=>language==='en'&&Object.hasOwn(english,source)?english[source]:t(source);
export function afterTr(parts:TemplateStringsArray,...values:unknown[]):string{
 const key=parts.map((part,i)=>part+(i<values.length?`{${i}}`:'')).join('');
 return language==='en'&&Object.hasOwn(english,key)?english[key].replace(/\{(\d+)\}/g,(_,i)=>String(values[Number(i)])):tr(parts,...values);
}
