import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { t, tr } from '../../src/i18n/index';
import { AUTO_SPIN_COUNTS } from '../../src/ui/slotKit/SlotAutoplay';
import { formatCents, type SlotRound } from '../../templates/slot-primitive/src/index.ts';
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

export function BonusResult({ round, onConfirm, onDismiss }: BonusResultProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  const features = round.view.features ?? [];
  return <dialog ref={dialog} className="panda-info" aria-labelledby={heading} onClose={onDismiss}>
    <h2 id={heading}>{t('Итог бонуса')}</h2>
    <dl className="panda-round-totals">
      <dt>{t('Ставка за раунд')}</dt><dd>{formatCents(round.spentCents)}</dd>
      <dt>{t('Выплата за раунд')}</dt><dd>{formatCents(round.returnedCents)}</dd>
    </dl>
    {features.length ? <ul>{features.map(feature => <li key={feature}>{t(feature)}</li>)}</ul> : null}
    <div className="panda-dialog-actions">
      <button type="button" className="panda-info-close" onClick={onDismiss}>{t('Закрыть')}</button>
      <button type="button" className="panda-auto" onClick={onConfirm}>{t('Продолжить')}</button>
    </div>
  </dialog>;
}
