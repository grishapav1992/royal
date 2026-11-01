import {language} from '../i18n/index';

/** Shared player-facing explanation of the complete paid-round settlement. */
export function stakeRulesHtml(en = language === 'en') {
  return '<section data-stake-rules><p>' + (en
    ? 'A normal round starts at 0.10 USDT in total, including all selected lines. Bonus purchases have a separate displayed price.'
    : 'Обычный раунд стоит от 0,10 USDT за всё вращение, включая все выбранные линии. Покупка бонуса оплачивается отдельно по указанной цене.') + '</p><p>' + (en
    ? 'Fractions of a cent are carried through to the end of the round. The final amount rounds up with probability equal to its fractional cent, otherwise down. This preserves the average return. Previously accepted rounds finish under their original rules.'
    : 'Доли цента учитываются до конца раунда. Итог округляется вверх с вероятностью, равной дробной части цента, иначе вниз. Это сохраняет среднюю выплату. Ранее принятые раунды завершаются по исходным правилам.') + '</p></section>';
}
