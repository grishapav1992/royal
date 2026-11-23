import { useId, useRef, type ReactNode } from 'react';
import { t, tr } from '../../src/i18n/index';
import { DRAGON_PATH_PAYS, DRAGON_PATH_POINT_SCALE } from '../../src/shared/dragonPathMath';
import { formatCents, type SlotRound } from '../../templates/slot-primitive/src/index.ts';
import { paylineCells } from '../../templates/slot-primitive/src/paylines.ts';
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

export function GameInfo({ disabled }: { disabled: boolean }) {
  return <GamePanel title={t('Об игре')} icon="info" disabled={disabled}>
    <p>{tr`Поле 5×5, ${PANDA_LAYOUT.paylines.length} линий слева направо. Вертикаль: пять одинаковых символов в столбце. Три Свитка Дракона открывают бонус.`}</p>
    <p>{t('Одна ставка покрывает весь раунд. Бонусные ходы бесплатны.')}</p>
    <p>{t('Бесплатное вращение умножает выигрыш этого вращения на три. Выбор награды не влияет на выплату.')}</p>
    <details>
      <summary>{t('Таблица выплат')}</summary>
      <p>{t('Коэффициенты указаны от полной ставки. Вертикали оплачиваются отдельно, без подстановки.')}</p>
      <table className="panda-paytable">
        <thead><tr><th scope="col">{t('Символ')}</th><th scope="col">3</th><th scope="col">4</th><th scope="col">5</th></tr></thead>
        <tbody>{SYMBOLS.map(symbol => <tr key={symbol.key}>
          <th scope="row"><div>
            <span className="panda-info-sym"><img loading="lazy" src={symbolImages[symbol.id]} alt="" /></span>
            <span>{t(symbol.name)}<small>{t(symbol.role)}</small></span>
          </div></th>
          {[0, 1, 2].map(index => {
            const points = DRAGON_PATH_PAYS[symbol.id]?.[index];
            return <td key={index}>{points === undefined ? '–' : `×${(points / DRAGON_PATH_POINT_SCALE).toFixed(2)}`}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </details>
    <details>
      <summary>{t('Линии выплат')}</summary>
      <ol className="panda-paylines">{PANDA_LAYOUT.paylines.map((path, index) => {
        const cells = paylineCells(PANDA_LAYOUT.columns, path);
        return <li key={index} aria-label={tr`Линия ${index + 1}`}>
          <span aria-hidden="true">{index + 1}</span>
          <div aria-hidden="true">{Array.from({ length: PANDA_LAYOUT.columns * PANDA_LAYOUT.rows }, (_, cell) => (
            <i key={cell} data-path={cells.includes(cell) || undefined} />
          ))}</div>
        </li>;
      })}</ol>
    </details>
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
