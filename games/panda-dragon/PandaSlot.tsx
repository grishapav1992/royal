import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { isUserMessage, t, tr } from "../../src/i18n/index";
import { DRAGON_PATH_FREE_SPIN } from "../../src/shared/dragonPathProtocol";
import { DRAGON_PATH_FREE_MULTIPLIER } from "../../src/shared/dragonPathMath";
import { formatCents, validFreePicks, type SlotStatus } from "../../templates/slot-primitive/src/index.ts";
import type { SlotActionsV1, SlotFeedback } from "../../templates/slot-primitive/src/actions.ts";
import { paylineCells } from "../../templates/slot-primitive/src/paylines.ts";
import { PANDA_LAYOUT, SYMBOLS } from "./layout";
import type { PandaView } from "./PandaView";
import type { PandaState } from "./mountPanda";
import { heroStrikeUrl, heroTiptoeUrl, heroUrl, symbolImages } from "./assets";
import { GameInfo, RoundDetails } from "./GameInfo";
import { StakeControl } from "./StakeControl";
import { Icon } from "./Icons";
import { useReelMotion } from "./useReelMotion";
import { loadHeroPreference } from "./hero-preference";
import { usePandaAutoplay } from "./usePandaAutoplay";
import { AutoplayPanel, BonusResult } from "./PlayPanels";
import type { PandaAudio } from "./sound";

type Mood = "idle" | "spin" | "loss" | "partial" | "return" | "win" | "bigwin" | "bonus" | "recover";
const heroLines: Record<Mood, string> = {
  idle: "Крути барабаны!",
  spin: "Хи-я!",
  loss: "Без выигрыша",
  partial: "Частичный возврат",
  return: "Возврат ставки",
  win: "Отличный удар!",
  bigwin: "Крупный выигрыш!",
  bonus: "Бонус!",
  recover: "Связь прервалась",
};

const serviceNotices: Partial<Record<SlotStatus, string>> = {
  blocked: 'Дождитесь завершения другой операции.',
  'signed-out': 'Войдите в клуб, чтобы играть.',
  'sync-required': 'Обновите состояние игры.',
  'unsupported-round': 'Для сохранённого раунда нужна совместимая версия игры.',
};

const COLUMNS = PANDA_LAYOUT.columns;
/** Замах героя перед первой линией и шаг между линиями (мс). */
const STRIKE_LEAD_MS = 420;
const LINE_STEP_MS = 760;
const ROWS = PANDA_LAYOUT.rows;
/** Декоративная лента на время вращения – исход раунда на неё не влияет. */
const BLUR_STRIP = (column: number) =>
  Array.from({ length: 8 }, (_, i) => (i * 4 + column * 3) % SYMBOLS.length);

interface PandaSlotProps {
  title: string;
  state: PandaState;
  commands: SlotActionsV1<PandaView>;
  audio: PandaAudio;
  account: () => string | null;
  canPlay: () => boolean;
  paused: boolean;
  reducedMotion: boolean;
}

export function PandaSlot({ title, state, commands, audio, account, canPlay, paused, reducedMotion }: PandaSlotProps) {
  const [snapshot, setSnapshot] = useState(() => state.read());
  useLayoutEffect(() => {
    const update = () => setSnapshot(state.read());
    const unsubscribe = state.subscribe(update);
    update();
    return unsubscribe;
  }, [state]);
  const { status, round, freeActions, balanceLabel, error } = snapshot;

  const [draft, setDraft] = useState(() => formatCents(state.stakes.defaultCents));
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SlotFeedback<PandaView> | null>(null);
  const sending = useRef(false);
  const [motion, setMotion] = useState(false);
  useLayoutEffect(() => {
    if (paused) {
      setFeedback(null);
      setMotion(false);
      return;
    }
    return commands.subscribeFeedback(event => {
      const current = state.read().round;
      if (document.hidden || current?.id !== event.round.id || current.revision !== event.round.revision) return;
      setFeedback(event);
    });
  }, [commands, state, paused]);

  async function run(action: () => Promise<void>, animate = true) {
    if (sending.current || !canPlay()) return false;
    const startedBy = account();
    sending.current = true;
    audio.cancel();
    setFeedback(null);
    setFailure(null);
    setMotion(animate);
    setRunning(true);
    try {
      await action();
      return startedBy === account();
    } catch (reason) {
      if (startedBy === account()) {
        setFailure(reason instanceof Error && isUserMessage(reason.message)
          ? reason.message : 'Ход не подтверждён. Проверьте состояние.');
        setMotion(false);
      }
      return false;
    } finally {
      sending.current = false;
      setRunning(false);
    }
  }

  const busy = running || status === "busy";
  const { spinning, settled: reelsSettled } = useReelMotion(running, COLUMNS, motion && !paused && !reducedMotion);
  const settled = !busy && reelsSettled;
  const confirmed = !paused && settled && round && feedback?.round.id === round.id && feedback.round.revision === round.revision
    ? feedback : null;
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (reducedMotion || confirmed?.type !== "bigwin") return;
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), 3200);
    return () => {
      clearTimeout(timer);
      setCelebrate(false);
    };
  }, [confirmed, reducedMotion]);

  // Удар посохом: герой бьёт, посох проходит по каждой линии, за ним остаётся зачёркивание.
  const winCount = confirmed && motion && !reducedMotion
    ? (confirmed.round.view.wins?.length ?? confirmed.round.view.winLines?.length ?? 0) +
      (confirmed.round.view.columnWins?.length ?? 0)
    : 0;
  const [striking, setStriking] = useState(false);
  useEffect(() => {
    if (!winCount) return;
    setStriking(true);
    const timer = setTimeout(() => setStriking(false), STRIKE_LEAD_MS + winCount * LINE_STEP_MS);
    return () => {
      clearTimeout(timer);
      setStriking(false);
    };
  }, [winCount, confirmed]);

  // Звук сопровождает события: старт вращения, остановку каждого барабана, удары посохом и итог.
  const prevSpinning = useRef<boolean[]>(spinning);
  useEffect(() => {
    const before = prevSpinning.current;
    prevSpinning.current = spinning;
    if (!motion || paused || reducedMotion || status === "recover") return;
    if (spinning.some((v, i) => v && !before[i]) && spinning.every(Boolean)) audio.play("spin");
    else
      spinning.forEach((v, i) => {
        if (!v && before[i]) audio.play("stop");
      });
  }, [audio, motion, paused, reducedMotion, spinning, status]);
  useEffect(() => {
    if (!winCount || confirmed?.type === 'partial' || confirmed?.type === 'return') return;
    const cancels = Array.from({ length: winCount }, (_, i) => audio.schedule("strike", STRIKE_LEAD_MS + i * LINE_STEP_MS - 150));
    return () => cancels.forEach(cancel => cancel());
  }, [audio, winCount, confirmed]);
  useEffect(() => {
    if (!confirmed) return;
    const delay = winCount ? STRIKE_LEAD_MS + winCount * LINE_STEP_MS - 300 : 0;
    const type = confirmed.type;
    const sfx = type === "bet" || type === "free" ? (status === "continue" ? "bonus" : null) : type;
    if (sfx) return audio.schedule(sfx, delay);
  }, [audio, confirmed, status, winCount]);

  // Герой можно скрыть: поле тогда растягивается на освободившееся место. Выбор запоминается.
  const [heroOn, setHeroOn] = useState(true);
  useEffect(() => {
    try {
      setHeroOn(loadHeroPreference(localStorage));
    } catch {
      /* хранилище недоступно */
    }
  }, []);
  function toggleHero() {
    const next = !heroOn;
    setHeroOn(next);
    audio.unlock();
    audio.play("click");
    try {
      localStorage.setItem("panda-hero", next ? "on" : "off");
    } catch {
      /* хранилище недоступно */
    }
  }

  const action = freeActions[0];
  const [dismissedBonus, setDismissedBonus] = useState<string>();
  const auto = usePandaAutoplay({
    state, commands, account, canPlay, run, status, paused, failure,
    presented: settled ? round : null,
    resultDelay: Math.max(500, confirmed?.type === 'bigwin' && !reducedMotion ? 3200 : 0,
      winCount ? STRIKE_LEAD_MS + winCount * LINE_STEP_MS : 0),
  });
  const manualBonus = !auto.active && !paused && confirmed && round?.state === 'settled'
    && round.revision === 3 && round.id !== dismissedBonus ? round : null;
  const bonusResult = paused ? null : auto.bonusResult ?? manualBonus;
  function finishBonus(resume: boolean) {
    if (!bonusResult) return;
    setDismissedBonus(bonusResult.id);
    if (resume) auto.confirmBonus();
    else auto.stop();
  }
  const stageLabel = action?.id === DRAGON_PATH_FREE_SPIN ? t('Остался 1 бесплатный спин')
    : action?.choices.length ? tr`Бонусное вращение ×${DRAGON_PATH_FREE_MULTIPLIER}` : '';
  const stakeCents = state.stakes.parse(draft);
  const invalidStake = status === "spin" && stakeCents === undefined;
  const needsRefresh = status === "sync-required";
  const canPrimary = !paused && !auto.active && !bonusResult && settled && (
    status === "recover" || needsRefresh || (status === "spin" && stakeCents !== undefined)
    || (status === "continue" && !!action && validFreePicks(action, []))
  );

  function onPrimary() {
    if (!canPrimary || document.hidden || state.read().status !== status) return;
    audio.unlock();
    if (status === "spin") void run(() => commands.bet(draft));
    else if (status === "continue" && round && action) void run(() => commands.playFree(round, action.id));
    else if (status === "recover") void run(() => commands.recover(), false);
    else if (needsRefresh) void run(() => commands.refresh(), false);
  }

  function chooseReward(value: number) {
    if (paused || document.hidden || !settled || busy || status !== "continue" || !round || !action || !validFreePicks(action, [value])) return;
    audio.unlock();
    void run(() => commands.playFree(round, action.id, [value]), false);
  }

  let mood: Mood = "idle";
  if (!settled) mood = "spin";
  else if (status === "recover") mood = "recover";
  else if (status === "continue") mood = "bonus";
  else if (confirmed && confirmed.type in heroLines) mood = confirmed.type as Mood;

  const winCents = settled && round ? round.returnedCents : "0";
  const line =
    mood === "win" || mood === "bigwin" || mood === "partial" || mood === "return"
      ? `${t(heroLines[mood])} +${formatCents(winCents)}`
      : t(heroLines[mood]);
  const notice = serviceNotices[status];
  const errorText = t(failure ?? error ?? notice ?? '');
  const statusText = busy ? t(running ? (motion ? 'Проверяем ход…' : 'Подтверждаем результат…') : 'Обновляем состояние…')
    : stageLabel || line;
  const stakeLocked = paused || auto.active || !settled || !!bonusResult || status !== "spin";

  const spinLabel = needsRefresh ? 'Обновить' : status === 'recover' ? 'Проверить'
    : action?.id === DRAGON_PATH_FREE_SPIN ? 'Фриспин' : null;

  function changeStake(nextDraft: string, preset?: boolean) {
    setDraft(nextDraft);
    setFailure(null);
    if (preset) {
      audio.unlock();
      audio.play('click');
    }
  }

  const rewardOptions = settled && action?.choices.length ? action.choices : null;
  const firstReward = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (rewardOptions && canPlay() && !document.activeElement?.closest('.game-chat-dock')) firstReward.current?.focus({ preventScroll: true });
  }, [!!rewardOptions, canPlay, paused]);

  return (
    <div className="panda-game" data-hero={heroOn ? undefined : "off"}>
      {heroOn ? <HeroPanel mood={mood} line={line} striking={striking} moving={spinning.some(Boolean)} /> : null}

      <section aria-label={title} className="panda-board">
        <header className="panda-topbar">
          <div><h1>{title}</h1><span className="panda-mode">{t('Виртуальные ставки')}</span></div>
          <div className="panda-topbar-actions">
            <button
              type="button"
              className="panda-icon-btn panda-hero-toggle"
              aria-label={t(heroOn ? 'Скрыть героя' : 'Показать героя')}
              title={t(heroOn ? 'Скрыть героя' : 'Показать героя')}
              aria-pressed={heroOn}
              onClick={toggleHero}
            >
              <Icon name="hero" />
            </button>
            <SoundToggle audio={audio} />
            <GameInfo disabled={auto.active || busy} />
            <RoundDetails round={round} disabled={auto.active || busy || !settled} />
          </div>
        </header>

          <Reels roundKey={round ? `${round.id}:${round.revision}` : 'empty'} view={round?.view} spinning={spinning} settled={settled} animateCuts={Boolean(confirmed && !reducedMotion)} celebrate={celebrate}>
          {stageLabel && <div className="panda-bonus-ribbon">{stageLabel}</div>}
          {rewardOptions ? (
            <div className="panda-reward-overlay">
              <div className="panda-reward-panel">
                <fieldset className="panda-choices">
                  <legend className="panda-reward-title">{t('Выберите награду')}</legend>
                  {rewardOptions.map((choice, index) => (
                    <button type="button" key={choice.value} ref={index === 0 ? firstReward : undefined}
                      className="panda-choice" disabled={paused || busy} onClick={() => chooseReward(choice.value)}>
                      <img src={symbolImages[choice.value]} alt="" className="panda-choice-image" />
                      <span>{t(choice.label)}</span>
                    </button>
                  ))}
                </fieldset>
              </div>
            </div>
          ) : null}
        </Reels>

        <div className="panda-bar">
          <div className="panda-console">
            <dl className="panda-stat">
              <div><dt>{t('Виртуальный баланс')}</dt><dd>{balanceLabel ?? "–"}</dd></div>
              <div><dt>{t('Возврат')}</dt><dd>{formatCents(winCents)}</dd></div>
            </dl>

            <StakeControl draft={draft} cents={stakeCents} presets={state.stakes.presetsCents} disabled={stakeLocked}
              invalid={invalidStake && !stakeLocked} onDraft={changeStake} onSubmit={onPrimary} />

            <div className="panda-play-buttons">
              <button type="button" onClick={onPrimary} disabled={!canPrimary} className="panda-spin" data-mode={status}>
                {!spinLabel && <Icon name="spin" className="panda-spin-icon" data-active={!settled || undefined} />}
                <span>{t(spinLabel ?? 'Вращать')}</span>
              </button>
              <AutoplayPanel disabled={!canPrimary || status !== 'spin'} active={auto.active} stopping={auto.stopping}
                remaining={auto.total - auto.completed} onStart={count => { audio.unlock(); auto.start(count, draft); }} onStop={auto.stop} />
            </div>
          </div>
        </div>

        <div className="panda-feedback">
          <p role="status" className="panda-status">{statusText}</p>
          <p role="alert" className="panda-error">{errorText}</p>
        </div>
        {bonusResult && <BonusResult round={bonusResult} onConfirm={() => finishBonus(true)} onDismiss={() => finishBonus(false)} />}
      </section>
    </div>
  );
}

function HeroPanel({ mood, line, striking, moving }: { mood: Mood; line: string; striking: boolean; moving: boolean }) {
  return (
    <aside aria-label={t('Персонаж')} className="panda-hero-wrap panda-hero-side">
      <div
        className="panda-hero-stage"
        data-striking={striking || undefined}
        data-tiptoe={moving || undefined}
      >
        {moving && <img
          src={heroTiptoeUrl}
          alt=""
          aria-hidden="true"
          className="panda-hero panda-hero-tiptoe"
          width={336}
          height={440}
        />}
        <img
          src={heroUrl}
          alt={t('Мастер-панда с посохом')}
          data-mood={mood}
          className="panda-hero"
          width={336}
          height={440}
        />
        <img
          src={heroStrikeUrl}
          alt=""
          aria-hidden="true"
          className="panda-hero panda-hero-strike"
          width={336}
          height={440}
        />
      </div>
      <p className="panda-bubble" aria-hidden="true" data-mood={mood}>
        {line}
      </p>
    </aside>
  );
}

function Reels({
  roundKey,
  view,
  spinning,
  settled,
  animateCuts,
  celebrate,
  children,
}: {
  roundKey: string;
  view: PandaView | undefined;
  spinning: boolean[];
  settled: boolean;
  animateCuts: boolean;
  celebrate: boolean;
  children?: ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{
    w: number;
    h: number;
    centers: [number, number][];
  } | null>(null);
  const highlights = new Set(settled ? (view?.highlights ?? []) : []);
  const wins = settled
    ? (view?.wins ?? (view?.winLines ?? []).map((line) => ({ line, length: COLUMNS })))
    : [];
  // Клетки каждого разреза: горизонтальные линии и вертикали в одном списке, по порядку ударов.
  const cuts: number[][] = [
    ...wins.map((win) => {
      const line = PANDA_LAYOUT.paylines[win.line];
      return line ? paylineCells(COLUMNS, line).slice(0, win.length) : [];
    }),
    ...(settled ? (view?.columnWins ?? []) : []).map((win) =>
      Array.from({ length: win.length }, (_, i) => (win.from + i) * COLUMNS + win.column),
    ),
  ].filter((cells) => cells.length > 0);

  // Линии строятся по реальным центрам клеток, поэтому отступы и зазоры не сдвигают их.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      // offset* не учитывают CSS-анимации символов, поэтому центры стабильны.
      const centers: [number, number][] = [];
      grid.querySelectorAll<HTMLElement>("[data-pos]").forEach((cell) => {
        let x = cell.offsetWidth / 2;
        let y = cell.offsetHeight / 2;
        for (
          let node: HTMLElement | null = cell;
          node && node !== grid;
          node = node.offsetParent as HTMLElement | null
        ) {
          x += node.offsetLeft;
          y += node.offsetTop;
        }
        centers[Number(cell.dataset["pos"])] = [x, y];
      });
      const box = { width: grid.clientWidth, height: grid.clientHeight };
      setGeometry({ w: box.width, h: box.height, centers });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [settled, view]);

  return (
    <div className="panda-frame" data-celebrate={celebrate || undefined}>
      <div
        ref={gridRef}
        role="group"
        aria-label={t('Барабаны')}
        className="panda-grid"
        data-dim={highlights.size > 0 || undefined}
      >
        {Array.from({ length: COLUMNS }, (_, column) => (
          <div key={column} className="panda-reel" data-spinning={spinning[column] || undefined}>
            {spinning[column] ? (
              <div className="panda-strip" aria-hidden="true">
                {[...BLUR_STRIP(column), ...BLUR_STRIP(column)].map((symbol, i) => (
                  <div key={i} className="panda-cell">
                    <img src={symbolImages[symbol]} alt="" draggable={false} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="panda-column" data-landed={view ? true : undefined}>
                {Array.from({ length: ROWS }, (_, row) => {
                  const position = row * COLUMNS + column;
                  const symbol = view?.symbols[position];
                  const info = symbol === undefined ? undefined : SYMBOLS[symbol];
                  return (
                    <div
                      key={row}
                      data-pos={position}
                      className="panda-cell"
                      data-highlighted={highlights.has(position) || undefined}
                      data-sym={info?.key}
                      style={{ "--delay": `${(position * 137) % 1000}ms` } as CSSProperties}
                    >
                      {info ? (
                        <>
                          <img src={symbolImages[info.id]} alt={t(info.name)} draggable={false} />
                          {info.key === "dumplings" ? (
                            <span aria-hidden="true" className="panda-steam">
                              <i />
                              <i />
                              <i />
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span aria-hidden="true" className="panda-empty">
                          龍
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {settled && cuts.length > 0 && geometry ? (
          <svg
            className="panda-lines"
            viewBox={`0 0 ${geometry.w} ${geometry.h}`}
            aria-hidden="true"
          >
            {cuts.map((cells, index) => {
              const pts = cells
                .map((cell) => geometry.centers[cell])
                .filter((point): point is [number, number] => Boolean(point));
              const first = pts[0];
              const last = pts[pts.length - 1];
              if (!first || !last) return null;
              // Разрез выходит чуть за крайние клетки – как след клинка от удара посоха.
              const ext = (a: [number, number], b: [number, number]): [number, number] => {
                const dx = a[0] - b[0];
                const dy = a[1] - b[1];
                const len = Math.hypot(dx, dy) || 1;
                const k = geometry.w / COLUMNS / 2.2 / len;
                return [a[0] + dx * k, a[1] + dy * k];
              };
              const second = pts[1] ?? last;
              const beforeLast = pts[pts.length - 2] ?? first;
              const points = [ext(first, second), ...pts, ext(last, beforeLast)]
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(" ");
              const delay = animateCuts ? { animationDelay: `${STRIKE_LEAD_MS + index * LINE_STEP_MS}ms` } : undefined;
              return (
                <g key={`${roundKey}-${index}`} className="panda-cut" data-static={!animateCuts || undefined}>
                  <polyline
                    points={points}
                    pathLength={1}
                    className="panda-cut-glow"
                    style={delay}
                  />
                  <polyline
                    points={points}
                    pathLength={1}
                    className="panda-cut-core"
                    style={delay}
                  />
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
      {children}
      {celebrate ? (
        <div className="panda-bigwin" role="presentation">
          <span>{t('Крупный выигрыш!')}</span>
        </div>
      ) : null}
    </div>
  );
}

function SoundToggle({ audio }: { audio: PandaAudio }) {
  const muted = useSyncExternalStore(audio.subscribeMute, audio.muted);
  return (
    <button type="button" className="panda-icon-btn" aria-label={t(muted ? 'Включить звук' : 'Выключить звук')} aria-pressed={!muted} onClick={() => audio.setMuted(!muted)}>
      <Icon name={muted ? "mute" : "sound"} />
    </button>
  );
}
