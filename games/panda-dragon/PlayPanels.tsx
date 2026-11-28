import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { t, tr } from '../../src/i18n/index';
import { AUTO_SPIN_COUNTS } from '../../src/ui/slotKit/SlotAutoplay';
import { formatCents, type SlotRound } from '../../templates/slot-primitive/src/index.ts';
import { DRAGON_PATH_REWARDS, DRAGON_PATH_REWARD_LABELS } from '../../src/shared/dragonPathProtocol';
import { symbolImages } from './assets';
import type { PandaView } from './PandaView';

interface AutoplayPanelProps {
  disabled: boolean;
  active: boolean;
  stopping: boolean;
  remaining: number;
  onStart: (count: number) => void;
  onStop: () => void;
}

export function AutoplayPanel({ disabled, active, stopping, remaining, onStart, onStop }: AutoplayPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [count, setCount] = useState<number>(AUTO_SPIN_COUNTS[0]);
  useLayoutEffect(() => {
    if (disabled && !active) dialog.current?.close();
  }, [disabled, active]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dialog.current?.close();
    if (!disabled && !active) onStart(count);
  }

  return <>
    <button type="button" className="panda-auto" disabled={active ? stopping : disabled}
      onClick={active ? onStop : () => dialog.current?.showModal()}>
      {active ? tr`Стоп · ${remaining}` : t('Авто')}
    </button>
    <dialog ref={dialog} className="panda-info" aria-labelledby={heading}>
      <h2 id={heading}>{t('Автоигра')}</h2>
      <form className="panda-auto-form" onSubmit={submit}>
        <label>{t('Количество вращений')}
          <select value={count} onChange={event => setCount(Number(event.target.value))}>
            {AUTO_SPIN_COUNTS.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <div className="panda-dialog-actions">
          <button type="button" className="panda-info-close" onClick={() => dialog.current?.close()}>{t('Закрыть')}</button>
          <button type="submit" className="panda-auto">{t('Запустить автоигру')}</button>
        </div>
      </form>
    </dialog>
  </>;
}

interface BonusResultProps {
  round: SlotRound<PandaView>;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** Множитель раунда для показа: два знака до десяти, один после. */
function bonusMultiplier(spent: string, returned: string): number {
  const stake = Number(spent);
  const gain = Number(returned);
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(gain)) return 0;
  return gain / stake;
}

function bonusMultiplierText(value: number): string {
  if (value <= 0) return '';
  const text = value < 10 ? value.toFixed(2) : value.toFixed(1);
  return text.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** Сумма итога набегает счётчиком: игрок видит, откуда взялась выплата. */
function useCountUp(cents: string, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const target = Number(cents);
    if (!Number.isFinite(target) || target <= 0) {
      setValue(Number.isFinite(target) && target > 0 ? target : 0);
      return;
    }
    if (typeof requestAnimationFrame !== 'function') {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, duration]);
  return value;
}

export function BonusResult({ round, onConfirm, onDismiss }: BonusResultProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  const features = round.view.features ?? [];
  const shown = useCountUp(round.returnedCents);
  const multiplier = bonusMultiplier(round.spentCents, round.returnedCents);
  // Талисман раунда виден в итоге: игрок понимает, что именно он выбрал.
  const talisman = DRAGON_PATH_REWARDS.find(value => features.includes(DRAGON_PATH_REWARD_LABELS[value]));
  return <dialog ref={dialog} className="panda-info panda-bonus" aria-labelledby={heading} onClose={onDismiss}>
    <h2 id={heading}>{t('Итог бонуса')}</h2>
    <div className="panda-bonus-total">
      <span className="panda-bonus-total-label">{t('Выплата за раунд')}</span>
      <strong className="panda-bonus-total-value">{formatCents(String(shown))}</strong>
      {multiplier > 0 && <span className="panda-bonus-total-mult">×{bonusMultiplierText(multiplier)}</span>}
    </div>
    {talisman !== undefined ? (
      <p className="panda-bonus-talisnan">
        <img src={symbolImages[talisman]} alt="" className="panda-bonus-talisnan-image" />
        <span>{t(DRAGON_PATH_REWARD_LABELS[talisman])}</span>
      </p>
    ) : null}
    <dl className="panda-round-totals">
      <dt>{t('Ставка за раунд')}</dt><dd>{formatCents(round.spentCents)}</dd>
    </dl>
    {features.length ? <ul>{features.map(feature => <li key={feature}>{t(feature)}</li>)}</ul> : null}
    <div className="panda-dialog-actions">
      <button type="button" className="panda-info-close" onClick={onDismiss}>{t('Закрыть')}</button>
      <button type="button" className="panda-auto" onClick={onConfirm}>{t('Продолжить')}</button>
    </div>
  </dialog>;
}
