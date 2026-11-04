import {parseGameStake, validGameStake, gameBetCents} from '../shared/gameStakes';

interface StakeField { input: HTMLInputElement; current: string; }
const fields = new WeakMap<HTMLSelectElement, StakeField>();
const guarded = new WeakSet<HTMLElement>();
function supportedHost() {
  const host=(globalThis as unknown as Record<symbol,{manualStakes?:1}>)[Symbol.for('royal.game-host.v1')];
  return !host||host.manualStakes===1;
}
const wagerButtons = '[data-cc-spin],[data-lg-spin],[data-cc-auto],[data-lg-auto],[data-cc-buy],[data-lg-buy],'
  + '[data-gn="spin"],[data-gn="auto"],[data-ft="primary"],[data-ft="auto"],[data-start],[data-shoot],[data-fight],'
  + '[data-ct-action="play"],[data-ct-action="buy"],[data-ct-action="auto"],[data-fh="spin"],[data-fh="auto"],'
  + '[data-np="spin"],[data-np="auto"],[data-fb="play"],[data-rr="spin"],[data-vp="drop"],#spin,#autoplay';

/** Invalid drafts never silently submit the last valid amount. */
export function validStakeDraft(root: HTMLElement, report = false): boolean {
  const invalid = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-manual-stake]'))
    .find(input => !input.disabled && !input.checkValidity());
  if (invalid && report) invalid.reportValidity();
  return !invalid;
}

function fieldFor(select: HTMLSelectElement, scale: number): StakeField {
  const existing = fields.get(select);
  if (existing) return existing;
  const doc = select.ownerDocument, en = doc.documentElement.lang.startsWith('en');
  const wrapper = doc.createElement('span'), input = doc.createElement('input');
  wrapper.dataset.stakeField = 'true';
  wrapper.style.cssText = 'display:inline-flex;align-items:stretch;min-width:76px;max-width:100%;position:relative;vertical-align:middle;';
  const style = doc.defaultView!.getComputedStyle(select);
  if(style.opacity==='0'&&style.position==='absolute'){
    const display=select.previousElementSibling;
    if(display instanceof doc.defaultView!.HTMLElement&&['STRONG','OUTPUT'].includes(display.tagName))display.style.display='none';
  }
  wrapper.style.flex = '1 1 auto'; wrapper.style.width = style.width;
  wrapper.style.background = style.backgroundColor; wrapper.style.borderRadius = style.borderRadius;
  input.type = 'text'; input.inputMode = 'decimal'; input.required = true; input.maxLength = 12;
  input.autocomplete = 'off'; input.spellcheck = false; input.dataset.manualStake = 'true';
  input.setAttribute('aria-label', select.getAttribute('aria-label') || (en ? 'Total stake, USDT' : 'Общая ставка, USDT'));
  input.title = en ? '0.10 to 50.00 USDT, in steps of 0.01' : 'От 0,10 до 50,00 USDT с шагом 0,01';
  input.style.cssText = 'box-sizing:border-box;flex:1 1 0;min-width:0;width:0;margin:0;padding:4px 6px;color:inherit;background:transparent;border:1px solid transparent;border-radius:inherit;';
  input.style.font = style.font; input.style.color = style.color;
  select.before(wrapper); wrapper.append(input, select);
  select.style.setProperty('flex', '0 0 24px'); select.style.setProperty('width', '24px');
  select.style.setProperty('min-width', '0'); select.style.setProperty('padding-inline', '0');
  select.style.setProperty('position','static');select.style.setProperty('opacity','1');
  select.style.setProperty('inset','auto');select.style.setProperty('height','auto');
  select.setAttribute('aria-label', en ? 'Quick stakes' : 'Быстрый выбор ставки');
  const field: StakeField = {input, current: ''}; fields.set(select, field);
  input.addEventListener('input', () => {
    if(input.disabled||input.readOnly)return;
    const cents = parseGameStake(input.value), message = en
      ? 'Enter a stake from 0.10 to 50.00, with at most two decimal places.'
      : 'Введи ставку от 0,10 до 50,00, не больше двух знаков после запятой.';
    input.setCustomValidity(cents === undefined ? message : '');
    input.setAttribute('aria-invalid', String(cents === undefined));
    input.style.borderColor = cents === undefined ? '#ff7979' : 'transparent';
    if (cents === undefined) return;
    const value = String(Number(cents) * scale / 100);
    setOption(select, value, false, scale); select.value = value;
    select.dispatchEvent(new doc.defaultView!.Event('change', {bubbles: true}));
  });
  select.addEventListener('change', () => {
    if (doc.activeElement === input) return;
    input.setCustomValidity(''); input.setAttribute('aria-invalid', 'false'); input.style.borderColor = 'transparent';
    input.value = (Number(select.value) / scale).toFixed(2);
  });
  input.addEventListener('blur', () => { if (input.checkValidity()) input.value = (Number(select.value) / scale).toFixed(2); });
  const root = select.closest<HTMLElement>('#mini-game') ?? doc.body;
  if (!guarded.has(root)) {
    guarded.add(root);
    root.addEventListener('click', event => {
      if ((event.target as Element).closest(wagerButtons) && !validStakeDraft(root, true)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    root.addEventListener('keydown', event => {
      if (event.code === 'Space' && !(event.target instanceof doc.defaultView!.HTMLInputElement) && !validStakeDraft(root, true)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  }
  return field;
}

function setOption(select: HTMLSelectElement, value: string, historical: boolean, scale: number) {
  select.querySelector('[data-extra-stake]')?.remove();
  if (!Array.from(select.options).some(option => option.value === value)) {
    const option = select.ownerDocument.createElement('option'); option.value = value;
    option.textContent = (Number(value) / scale).toFixed(2) + ' USDT'; option.disabled = historical;
    option.dataset.extraStake = 'true'; select.append(option);
  }
}

/** Presets and manual input share the accepted stake and the existing operation transport. */
export function syncStakeSelect(select: HTMLSelectElement, current: string, values: readonly (string | number)[], locked: boolean, scale = 100): string {
  const choices = values.map(String), cents = scale === 100 ? current : String(gameBetCents(Number(current)));
  const allowed = validGameStake(cents), value = !locked && !allowed && !choices.includes(current) ? choices[0] : current;
  setOption(select, value, locked && !allowed, scale); select.value = value; select.disabled = locked;
  const field = fieldFor(select, scale); field.input.disabled = locked;
  field.input.readOnly=!supportedHost();
  if(field.input.readOnly)field.input.title='Обнови страницу сайта, чтобы вводить свою ставку. / Refresh the page to enter a custom stake.';
  if (select.ownerDocument.activeElement !== field.input && (field.current !== value || locked)) {
    field.input.value = (Number(value) / scale).toFixed(2);
    field.input.setCustomValidity(''); field.input.setAttribute('aria-invalid', 'false'); field.input.style.borderColor = 'transparent';
  }
  field.current = value;
  return value;
}
