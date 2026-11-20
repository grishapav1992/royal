import { useId } from 'react';
import { t } from '../../src/i18n/index';
import { slotStakeStep } from '../../src/ui/slotKit/SlotControls';
import { formatCents } from '../../templates/slot-primitive/src/index.ts';
import { Icon } from './Icons';

interface StakeControlProps {
  draft: string;
  cents: string | undefined;
  presets: readonly string[];
  disabled: boolean;
  onDraft: (draft: string, preset?: boolean) => void;
  onSubmit: () => void;
}

export function StakeControl({ draft, cents, presets, disabled, onDraft, onSubmit }: StakeControlProps) {
  const id = useId();
  const previous = cents === undefined ? undefined : slotStakeStep(presets, cents, -1);
  const next = cents === undefined ? undefined : slotStakeStep(presets, cents, 1);
  return <div className="panda-stake">
    <label htmlFor={id}>{t('Ставка')}</label>
    <div className="panda-stake-controls">
      <button type="button" className="panda-step" aria-label={t('Уменьшить ставку')} disabled={disabled || previous === undefined}
        onClick={() => previous !== undefined && onDraft(formatCents(previous), true)}>
        <Icon name="minus" />
      </button>
      <div className="panda-stake-field">
        <input id={id} className="panda-input" type="text" inputMode="decimal" autoComplete="off" maxLength={12}
          value={draft} aria-invalid={!disabled && cents === undefined} disabled={disabled}
          onChange={event => onDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.repeat || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onSubmit();
          }} />
        <select className="panda-stake-presets" aria-label={t('Быстрый выбор ставки')} value="" disabled={disabled}
          onChange={event => { if (event.target.value) onDraft(formatCents(event.target.value), true); }}>
          <option value="" disabled>▾</option>
          {presets.map(value => <option key={value} value={value}>{formatCents(value)}</option>)}
        </select>
      </div>
      <button type="button" className="panda-step" aria-label={t('Увеличить ставку')} disabled={disabled || next === undefined}
        onClick={() => next !== undefined && onDraft(formatCents(next), true)}>
        <Icon name="plus" />
      </button>
    </div>
  </div>;
}
