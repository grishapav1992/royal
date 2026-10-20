import { t as translateText, tr, locale } from '../../i18n/index';
/** These render confirmed data only; symbols/bodyHtml come from trusted game adapters. */
export const slotCoins = (value: string | number) => (Number(value) / 100).toLocaleString(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const slotEscape = (value: string) => translateText(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
type Style = 'lg' | 'cc';
const styles = {
  lg: {ledger: 'lg-round-ledger', scroll: 'lg-info-scroll', history: 'lg-spin-history', primary: 'lg-primary ce-primary', title: 'lg-dialog-title', action: 'data-lg-dialog-action'},
  cc: {ledger: 'cc-ledger', scroll: 'cc-info-scroll', history: 'cc-history', primary: 'cc-primary', title: 'cc-dialog-title', action: 'data-cc-action'},
} as const;

interface Heading {style: Style; eyebrow: string; title: string;}
function heading({style, eyebrow, title}: Heading) {
  return (style === 'lg' ? `<span class="lg-eyebrow">${slotEscape(eyebrow)}</span>` : `<small>${slotEscape(eyebrow)}</small>`) + `<h2 id="${styles[style].title}">${slotEscape(title)}</h2>`;
}
function button(style: Style, action: string, label: string) {
  return `<button type="button" class="${styles[style].primary}" ${styles[style].action}="${slotEscape(action)}">${slotEscape(label)}</button>`;
}

export function renderSlotLedger(style: Style, spent: string, returned: string, active: boolean) {
  return tr`<div class="${styles[style].ledger}"><span>Стоимость<strong>${slotCoins(spent)}</strong></span><span>${active ? translateText('Накоплено') : translateText('Выплата')}<strong>${slotCoins(returned)}</strong></span><span>Итог<strong>${slotCoins(Number(returned) - Number(spent))}</strong></span></div>`;
}

export interface SlotHistoryRow {title: string; detail: string; payoutUnits: string;}

/** Server indices cover the whole round; the displayed bonus count excludes base spins. */
export function slotSpinNumber(spin: {kind: string; index: number}, history: readonly {kind: string; index: number}[]) {
  return spin.index + 1 - (spin.kind === 'base' ? 0 : history.filter(item => item.kind === 'base' && item.index < spin.index).length);
}

export function renderSlotHistory(options: Heading & {
  ledger?: string; status: string; empty: string; rows: readonly SlotHistoryRow[]; extraHtml?: string;
}) {
  const {style, ledger, status, empty, rows, extraHtml = ''} = options, classes = styles[style];
  const body = ledger ? `${ledger}<div class="${classes.scroll}"><p>${slotEscape(status)}</p><ol class="${classes.history}">${rows.map(row => `<li><span>${slotEscape(row.title)}<small>${slotEscape(row.detail)}</small></span><b>${slotCoins(row.payoutUnits)}</b></li>`).join('')}</ol>${extraHtml}</div>` : `<p>${slotEscape(empty)}</p>`;
  return heading(options) + body + button(style, 'close', translateText('ВЕРНУТЬСЯ'));
}

export function renderSlotInfo(options: Heading & {reduced: boolean; bodyHtml: string; motionSetting?: boolean;}) {
  const {style, reduced, bodyHtml} = options;
  const labelClass = style === 'lg' ? ' class="lg-motion-setting"' : '';
  const motion = options.motionSetting === false ? '' : tr`<label${labelClass}><input type="checkbox" data-${style}-reduce ${reduced ? 'checked' : ''}> Уменьшить движение</label>`;
  return heading(options) + `<div class="${styles[style].scroll}">${motion}${bodyHtml}</div>` + button(style, 'close', translateText('ПОНЯТНО'));
}

export function renderSlotResult(options: Heading & {returned: string; ledger: string; note: string; label: string;}) {
  const {style, returned, ledger, note, label} = options;
  const prize = style === 'lg' ? tr`<div class="lg-bonus-number">${slotCoins(returned)}<span>тестовых монет</span></div>` : tr`<div class="cc-prize">${slotCoins(returned)}<small>ТЕСТОВЫХ МОНЕТ</small></div>`;
  return heading(options) + prize + ledger + `<p>${slotEscape(note)}</p>` + button(style, 'complete', label);
}

export function renderSlotPaylines(lines: readonly (readonly number[])[], rows: number) {
  return `<div class="lg-paylines">${lines.map((line, index) => `<span><small>${index + 1}</small><svg viewBox="0 0 100 ${rows * 20}"><polyline points="${line.map((row, col) => `${col * 20 + 10},${row * 20 + 10}`).join(' ')}"/></svg></span>`).join('')}</div>`;
}

export function renderSlotPaytable(style: Style, rows: readonly {symbolHtml: string; name: string; values: readonly string[];}[], headers?: readonly string[]) {
  const header = headers ? `<div><span>${slotEscape(headers[0])}</span>${headers.slice(1).map(value => `<b>${slotEscape(value)}</b>`).join('')}</div>` : '';
  return `<div class="${style}-paytable">${header}${rows.map(row => `<div><span>${row.symbolHtml}<small>${slotEscape(row.name)}</small></span>${row.values.map(value => `<b>${slotEscape(value)}</b>`).join('')}</div>`).join('')}</div>`;
}
