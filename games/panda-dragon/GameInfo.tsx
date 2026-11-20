import { useId, useRef, type ReactNode } from 'react';
import { t, tr } from '../../src/i18n/index';
import { formatCents, type SlotRound } from '../../templates/slot-primitive/src/index.ts';
import { PANDA_LAYOUT, SYMBOLS } from './layout';
import { symbolImages } from './assets';
import { Icon } from './Icons';
import type { PandaView } from './PandaView';

interface GamePanelProps {
  title: string;
  icon: 'info' | 'history';
  disabled?: boolean;
  children: ReactNode;
}

function GamePanel({ title, icon, disabled, children }: GamePanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  function open() { dialog.current?.showModal(); }
  return <>
    <button type="button" className="panda-icon-btn" aria-label={title} title={title} disabled={disabled} onClick={open}>
      <Icon name={icon} />
    </button>
    <dialog className="panda-info" ref={dialog} aria-labelledby={heading}>
      <form method="dialog"><button className="panda-info-close" autoFocus>{t('Закрыть')}</button></form>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  </>;
}

export function GameInfo() {
  return <GamePanel title={t('Об игре')} icon="info">
    <p>{tr`Поле 5×5, ${PANDA_LAYOUT.paylines.length} линий слева направо. Вертикаль: пять одинаковых символов в столбце. Три Свитка Дракона открывают бонус.`}</p>
    <p>{t('Одна ставка покрывает весь раунд. Бонусные ходы бесплатны.')}</p>
    <ul className="panda-symbol-list">{SYMBOLS.map(symbol => <li key={symbol.key}>
      <span className="panda-info-sym"><img loading="lazy" src={symbolImages[symbol.id]} alt="" /></span>
      <span><strong>{t(symbol.name)}</strong><br />{t(symbol.role)}</span>
    </li>)}</ul>
    <p>{t('Бесплатное вращение умножает выигрыш этого вращения на три. Выбор награды не влияет на выплату.')}</p>
    <p>{t('Используется общий виртуальный баланс Royal. Реальных денег и вывода нет.')}</p>
  </GamePanel>;
}

interface RoundDetailsProps {
  round: SlotRound<PandaView> | null;
  disabled: boolean;
}

export function RoundDetails({ round, disabled }: RoundDetailsProps) {
  return <GamePanel title={t('Текущий раунд')} icon="history" disabled={disabled}>
    {round ? <>
      <p>{t(round.state === 'active' ? 'Бонус не завершён' : 'Раунд завершён')}</p>
      <dl className="panda-round-totals">
        <dt>{t('Ставка за раунд')}</dt><dd>{formatCents(round.spentCents)}</dd>
        <dt>{t('Возврат')}</dt><dd>{round.state === 'settled' ? formatCents(round.returnedCents) : '–'}</dd>
      </dl>
      {round.view.features?.length ? <ul>{round.view.features.map((feature, index) => <li key={index}>{t(feature)}</li>)}</ul> : null}
    </> : <p>{t('Нет подтверждённого раунда.')}</p>}
  </GamePanel>;
}
