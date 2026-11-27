import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { isUserMessage, t, tr } from "../../src/i18n/index";
import { DRAGON_PATH_FREE_SPIN } from "../../src/shared/dragonPathProtocol";
import { DRAGON_PATH_FREE_MULTIPLIER } from "../../src/shared/dragonPathMath";
import { dragonPathBeltProgress, DRAGON_PATH_BELTS, type DragonPathBelt } from "../../src/shared/dragonPathBelt";
import { formatCents, validFreePicks, type SlotStatus } from "../../templates/slot-primitive/src/index.ts";
import type { SlotActionsV1, SlotFeedback } from "../../templates/slot-primitive/src/actions.ts";
import { paylineCells } from "../../templates/slot-primitive/src/paylines.ts";
import { PANDA_LAYOUT, SYMBOLS } from "./layout";
import type { PandaView } from "./PandaView";
import type { PandaState } from "./mountPanda";
import { heroClips, heroImages, symbolImages } from "./assets";
import { usePandaBelt } from "./usePandaBelt";
import { GameInfo, RoundDetails } from "./GameInfo";
import { StakeControl } from "./StakeControl";
import { Icon } from "./Icons";
import { useReelMotion } from "./useReelMotion";
import { GRID_SHAKE, HERO_RECOIL, RECOIL_OPTIONS, SHAKE_OPTIONS, useImpactShake } from "./useImpactShake";
import { loadHeroPreference } from "./hero-preference";
import { usePandaAutoplay } from "./usePandaAutoplay";
import { AutoplayPanel, BonusResult } from "./PlayPanels";
import type { PandaAudio } from "./sound";
import {
  pandaMultiplier,
  pandaReelPan,
  pandaScatterCount,
  pandaStrikePan,
  pandaStrikes,
  pandaWinLineCount,
  pandaWinTier,
  SCATTER_SYMBOL,
  SCATTER_TARGET,
} from "./roundStory";

type Mood = "idle" | "spin" | "loss" | "partial" | "return" | "win" | "bigwin" | "bonus" | "recover";
const heroLines: Record<Mood, string> = {
  idle: "Крути барабаны!",
  spin: "Хи-я!",
  loss: "Без выигрыша",
  partial: "Частичный возврат",
  return: "Возврат ставки",
  win: "Отличный удар!",
  bigwin: "Крупный выигрыш!",
  bonus: "Бонус ×3!",
  recover: "Связь прервалась",
};

/** Реплики героя во время серии ударов посохом. */
const strikeCries = ["Замах!", "Разрез!", "Точно в цель!"];

/** Действие героя: от спокойного ожидания до победы. */
type HeroAction = "idle" | "spin" | "charge" | "strike" | "reach" | "cheer";

const serviceNotices: Partial<Record<SlotStatus, string>> = {
  blocked: 'Дождитесь завершения другой операции.',
  'signed-out': 'Войдите в клуб, чтобы играть.',
  'sync-required': 'Обновите состояние игры.',
  'unsupported-round': 'Для сохранённого раунда нужна совместимая версия игры.',
};

const COLUMNS = PANDA_LAYOUT.columns;
/** Замах героя перед первой линией и шаг между линиями (мс). */
const STRIKE_LEAD_MS = 470;
const LINE_STEP_MS = 640;
/** Пауза после последнего удара, чтобы выигрыш фриспина успел прочитаться (мс). */
const TALISMAN_DELAY_MS = 320;
const ROWS = PANDA_LAYOUT.rows;
/** Декоративная лента на время вращения – исход раунда на неё не влияет. */
const BLUR_STRIP = (column: number) =>
  Array.from({ length: 8 }, (_, i) => (i * 4 + column * 3) % SYMBOLS.length);

/** Множитель раунда для показа: 2,4 / 12 / 25. */
function multiplierText(value: number): string {
  if (value <= 0) return '';
  const text = value < 10 ? value.toFixed(2) : value.toFixed(1);
  return text.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

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
  const [beltNotice, setBeltNotice] = useState('');
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

  async function run(action: () => Promise<void>, animate = true, keepAudio = false) {
    if (sending.current || !canPlay()) return false;
    const startedBy = account();
    sending.current = true;
    // Звук текущего показа не гасим: выбор талисмана не должен прерывать удары посоха.
    if (!keepAudio) audio.cancel();
    setFeedback(null);
    setBeltNotice('');
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
  const { spinning, settled: reelsSettled, anticipating } = useReelMotion(running, COLUMNS, motion && !paused && !reducedMotion);
  const settled = !busy && reelsSettled;
  const confirmed = !paused && settled && round && feedback?.round.id === round.id && feedback.round.revision === round.revision
    ? feedback : null;
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    // Крупный итог и завершённый бонус отмечаются одной анимацией поля.
    const bonusWin = confirmed?.round.revision === 3 && (confirmed.type === "win" || confirmed.type === "bigwin");
    if (reducedMotion || (confirmed?.type !== "bigwin" && !bonusWin)) return;
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), 3200);
    return () => {
      clearTimeout(timer);
      setCelebrate(false);
    };
  }, [confirmed, reducedMotion]);

  // Ритуал выбора талисмана: сначала удары по выигрышным линиям, потом выбор, потом итог.
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [chosenTalisnan, setChosenTalisnan] = useState<number | null>(null);

  // Порядок ударов посоха по подтверждённому полю: линии, затем вертикали.
  const strikes = useMemo(() => pandaStrikes(confirmed?.round.view, settled), [confirmed, settled]);
  const [strikeIndex, setStrikeIndex] = useState(-1);
  const [impact, setImpact] = useState(0);
  useEffect(() => {
    // Итог бонуса показывается сразу: повторять удары после выбора талисмана не нужно.
    if (!strikes.length || !confirmed || reducedMotion || !motion || confirmed.round.revision === 3) {
      setStrikeIndex(-1);
      return;
    }
    setStrikeIndex(0);
    setImpact(value => value + 1);
    const timers = strikes.map((_, index) => setTimeout(() => {
      setStrikeIndex(index);
      setImpact(value => value + 1);
    }, STRIKE_LEAD_MS + index * LINE_STEP_MS));
    const end = setTimeout(() => setStrikeIndex(-1), STRIKE_LEAD_MS + strikes.length * LINE_STEP_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(end);
    };
  }, [strikes, confirmed, reducedMotion, motion]);
  const striking = strikeIndex >= 0;
  // Без анимации ударов серия не растягивается: пауза между ходами остаётся короткой.
  const strikeCount = reducedMotion || confirmed?.round.revision === 3 ? 0 : strikes.length;

  // Звук сопровождает события: старт вращения, остановку каждого барабана, удары посохом и итог.
  const prevSpinning = useRef<boolean[]>(spinning);
  useEffect(() => {
    const before = prevSpinning.current;
    prevSpinning.current = spinning;
    if (!motion || paused || reducedMotion || status === "recover") return;
    if (spinning.some((v, i) => v && !before[i]) && spinning.every(Boolean)) audio.play("spin");
    else
      spinning.forEach((v, i) => {
        // Барабан звучит из своей колонки и на своей высоте: пять остановок складываются в фразу.
        if (!v && before[i]) audio.play("stop", { pan: pandaReelPan(i, COLUMNS), variant: i });
      });
  }, [audio, motion, paused, reducedMotion, spinning, status]);
  // Фоновый гул барабанов звучит только пока барабаны крутятся.
  useEffect(() => {
    audio.spinning(Boolean(motion && !paused && !reducedMotion && spinning.some(Boolean)));
  }, [audio, motion, paused, reducedMotion, spinning]);
  // Заминка перед последним барабаном слышна как нарастание.
  useEffect(() => {
    if (!anticipating || !motion || paused || reducedMotion) return;
    audio.play("charge");
  }, [anticipating, audio, motion, paused, reducedMotion]);
  useEffect(() => {
    if (!strikes.length || !confirmed || reducedMotion) return;
    const cancels = strikes.flatMap((strike, index) => {
      const at = STRIKE_LEAD_MS + index * LINE_STEP_MS;
      // Удар слышен из места, где посох коснулся линии или вертикали.
      const pan = pandaStrikePan(strike, COLUMNS);
      return [
        audio.schedule("whoosh", at - 300, { pan: pan * 0.4 }),
        audio.schedule("strike", at - 150, { pan }),
        audio.schedule("spark", at - 10, { pan }),
      ];
    });
    return () => cancels.forEach(cancel => cancel());
  }, [audio, strikes, confirmed, reducedMotion]);
  useEffect(() => {
    if (!confirmed) return;
    const delay = strikeCount ? STRIKE_LEAD_MS + strikeCount * LINE_STEP_MS - 300 : 0;
    const type = confirmed.type;
    // Завершение бонуса звучит отдельной фразой, а не обычной выплатой.
    const sfx = type === "bet" || type === "free"
      ? (status === "continue" ? "bonus" : null)
      : confirmed.round.revision === 3 && (type === "win" || type === "bigwin") ? "triumph" : type;
    if (sfx) return audio.schedule(sfx, delay);
  }, [audio, confirmed, status, strikeCount]);

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
  // Талисманы раунда доступны, пока сервер ждёт выбора награды.
  const rewardOptions = settled && action?.choices.length ? action.choices : null;
  const choiceKey = rewardOptions ? rewardOptions.map(choice => choice.value).join('-') : '';
  const [dismissedBonus, setDismissedBonus] = useState<string>();
  const auto = usePandaAutoplay({
    state, commands, account, canPlay, run, status, paused, failure,
    presented: settled ? round : null,
    resultDelay: Math.max(500, confirmed?.type === 'bigwin' && !reducedMotion ? 3200 : 0,
      strikeCount ? STRIKE_LEAD_MS + strikeCount * LINE_STEP_MS : 0),
  });
  const manualBonus = !auto.active && !paused && confirmed && round?.state === 'settled'
    && round.revision === 3 && round.id !== dismissedBonus ? round : null;
  const bonusResult = paused ? null : auto.bonusResult ?? manualBonus;
  const [presentedRoundId, setPresentedRoundId] = useState<string | null>(null);
  const [beltRounds, setBeltRounds] = useState<number>();
  const mayChangeBelt = settled && status !== 'recover' && !paused && !striking && !celebrate && !bonusResult;
  const completedRoundId = round?.state === 'settled' ? round.id : null;
  useEffect(() => {
    if (!mayChangeBelt || !completedRoundId || presentedRoundId === completedRoundId) return;
    const timer = setTimeout(() => setPresentedRoundId(completedRoundId), 0);
    return () => clearTimeout(timer);
  }, [mayChangeBelt, completedRoundId, presentedRoundId]);
  const beltProfile = usePandaBelt(account(), presentedRoundId);
  const belt = dragonPathBeltProgress(beltRounds ?? 0);
  useEffect(() => {
    if (!mayChangeBelt || !beltProfile || beltProfile.rounds === beltRounds) return;
    const next = dragonPathBeltProgress(beltProfile.rounds).current;
    if (beltRounds !== undefined && next.rounds > belt.current.rounds && confirmed?.round.id === beltProfile.roundId) {
      setBeltNotice(tr`Новый пояс: ${t(next.label)}`);
      // Новый пояс отмечается коротким металлическим откликом.
      audio.play("clink");
    }
    setBeltRounds(beltProfile.rounds);
  }, [beltProfile, beltRounds, belt.current.rounds, mayChangeBelt, confirmed, audio]);

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
    if (chosenTalisnan !== null) return;
    audio.unlock();
    setChosenTalisnan(value);
    void run(() => commands.playFree(round, action.id, [value]), false, true);
  }

  let mood: Mood = "idle";
  if (!settled) mood = "spin";
  else if (status === "recover") mood = "recover";
  else if (status === "continue") mood = "bonus";
  else if (confirmed?.type === "free") mood = "bonus";
  else if (confirmed && confirmed.type in heroLines) mood = confirmed.type as Mood;

  const winCents = settled && round ? round.returnedCents : "0";
  const multiplier = settled && round ? pandaMultiplier(round.spentCents, round.returnedCents) : 0;
  const tier = pandaWinTier(multiplier);
  const scatterCount = pandaScatterCount(settled ? round?.view : undefined);
  // Выигрышные линии подтверждённого поля: их видно игроку и до выбора талисмана.
  const freeWinLines = pandaWinLineCount(confirmed?.round.view);
  const currentStrike = striking ? strikes[strikeIndex] : undefined;
  const strikeText = currentStrike
    ? currentStrike.kind === "line"
      ? tr`Линия ${currentStrike.index + 1} · удар ${strikeIndex + 1} из ${strikes.length}`
      : tr`Вертикаль ${currentStrike.index + 1} · удар ${strikeIndex + 1} из ${strikes.length}`
    : "";
  const heroAction: HeroAction = striking ? "strike"
    : !settled ? (anticipating ? "charge" : "spin")
    : chosenTalisnan !== null ? (confirmed?.round.revision === 3 ? "cheer" : "reach")
    : rewardOptions ? "reach"
    : mood === "win" || mood === "bigwin" || mood === "bonus" ? "cheer"
    : "idle";
  const chosenLabel = rewardOptions?.find(choice => choice.value === chosenTalisnan)?.label ?? '';
  const line = striking
    ? t(strikeCries[Math.min(strikeIndex, strikeCries.length - 1)] ?? strikeCries[0])
    : chosenTalisnan !== null
      ? `${t(chosenLabel)}: беру!`
      : choiceOpen
        ? t('Выбери талисман раунда')
        : mood === "win" || mood === "bigwin" || mood === "partial" || mood === "return"
          ? `${t(heroLines[mood])} +${formatCents(winCents)}`
          : t(heroLines[mood]);
  const notice = serviceNotices[status];
  const errorText = t(failure ?? error ?? notice ?? '');
  const statusText = busy ? t(running ? (motion ? 'Проверяем ход…' : 'Подтверждаем результат…') : 'Обновляем состояние…')
    : striking ? strikeText : stageLabel || line;
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

  // Талисманы появляются после ударов посоха: игрок сначала видит выигрыш фриспина.
  useEffect(() => {
    if (!choiceKey) {
      setChoiceOpen(false);
      setChosenTalisnan(null);
      return;
    }
    // Ждём первый удар посоха, дальше выбор не задерживается: линии дорисовываются на фоне.
    const delay = reducedMotion || !motion ? 0
      : STRIKE_LEAD_MS + Math.min(strikeCount, 1) * LINE_STEP_MS + TALISMAN_DELAY_MS;
    const timer = setTimeout(() => setChoiceOpen(true), delay);
    return () => clearTimeout(timer);
  }, [choiceKey, strikeCount, reducedMotion, motion]);
  // Появление талисманов слышно: воздух и два колокольчика.
  useEffect(() => {
    if (!choiceOpen) return;
    audio.play("summon");
  }, [choiceOpen, audio]);
  // Взятый талисман отмечен коротким ударом лапы.
  useEffect(() => {
    if (chosenTalisnan === null) return;
    audio.play("grab");
  }, [chosenTalisnan, audio]);
  const firstReward = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (choiceOpen && canPlay() && !document.activeElement?.closest('.game-chat-dock')) firstReward.current?.focus({ preventScroll: true });
  }, [choiceOpen, canPlay, paused]);

  return (
    <div className="panda-game" data-hero={heroOn ? undefined : "off"}>
      <section aria-label={title} className="panda-board">
        <header className="panda-topbar">
          <div className="panda-heading">
            <h1>{title}</h1>
            <span className="panda-mode">{t('Виртуальные ставки')}</span>
            <BeltRail belt={belt.current.id} rounds={beltRounds ?? 0} visible={beltRounds !== undefined} />
          </div>
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

        <Reels
          roundKey={round ? `${round.id}:${round.revision}` : 'empty'}
          view={round?.view}
          spinning={spinning}
          settled={settled}
          animateCuts={Boolean(confirmed && !reducedMotion)}
          celebrate={celebrate}
          charge={anticipating}
          impact={impact}
          tier={tier}
          winCents={winCents}
          reducedMotion={reducedMotion}
        >
          {stageLabel && <div className="panda-bonus-ribbon"><span>{stageLabel}</span></div>}
          {strikeText && <div className="panda-strike-label">{strikeText}</div>}
          <div
            className="panda-scroll-meter"
            data-state={scatterCount >= SCATTER_TARGET ? 'ready' : scatterCount > 0 ? 'near' : 'none'}
            aria-label={tr`Свитки: ${scatterCount} из ${SCATTER_TARGET}`}
          >
            <img src={symbolImages[SCATTER_SYMBOL]} alt="" className="panda-scroll-icon" />
            <span className="panda-scroll-pips" aria-hidden="true">
              {Array.from({ length: SCATTER_TARGET }, (_, index) => (
                <i key={index} data-on={index < scatterCount || undefined} />
              ))}
            </span>
            <span className="panda-scroll-text">{t('Свитки')}</span>
          </div>
          {choiceOpen && rewardOptions ? (
            <div className="panda-reward-overlay" data-state={chosenTalisnan !== null ? "taken" : "open"}>
              <div className="panda-reward-panel">
                <p className="panda-reward-title">{t('Выбери талисман раунда')}</p>
                <p className="panda-reward-note">
                  {tr`Фриспин ×${DRAGON_PATH_FREE_MULTIPLIER}: выигрышных линий ${freeWinLines}`}
                </p>
                <div className="panda-choices">
                  {rewardOptions.map((choice, index) => (
                    <button type="button" key={choice.value} ref={index === 0 ? firstReward : undefined}
                      className="panda-choice" data-talisnan={choice.value}
                      data-taken={chosenTalisnan === choice.value || undefined}
                      data-dimmed={chosenTalisnan !== null && chosenTalisnan !== choice.value || undefined}
                      disabled={paused || busy || chosenTalisnan !== null} onClick={() => chooseReward(choice.value)}>
                      <img src={symbolImages[choice.value]} alt="" className="panda-choice-image" />
                      <span className="panda-choice-text">
                        <span className="panda-choice-name">{t(choice.label)}</span>
                        <span className="panda-choice-note">{t('Печать мастера на раунд')}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </Reels>

        {heroOn ? <HeroPanel mood={mood} line={line} belt={belt.current.id} action={heroAction}
          impact={impact} reducedMotion={reducedMotion} /> : null}

        <div className="panda-bar">
          <div className="panda-console">
            <dl className="panda-stat">
              <div><dt title={t('Виртуальный баланс')}>{t('Баланс')}</dt><dd>{balanceLabel ?? "–"}</dd></div>
              <div className="panda-stat-win" data-tier={tier}>
                <dt>{t('Возврат')}</dt>
                <dd>
                  <span className="panda-return">{formatCents(winCents)}</span>
                  {multiplier > 0 && <span className="panda-mult" data-tier={tier}>×{multiplierText(multiplier)}</span>}
                </dd>
              </div>
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
          <p aria-live="polite" className="panda-belt-notice">{beltNotice}</p>
        </div>
        {bonusResult && <BonusResult round={bonusResult} onConfirm={() => finishBonus(true)} onDismiss={() => finishBonus(false)} />}
      </section>
    </div>
  );
}

/** Пояс мастера: пройденные ступени, текущая и цель до следующей. */
function BeltRail({ belt, rounds, visible }: { belt: DragonPathBelt; rounds: number; visible: boolean }) {
  const current = DRAGON_PATH_BELTS.findIndex(step => step.id === belt);
  const step = DRAGON_PATH_BELTS[current] ?? DRAGON_PATH_BELTS[0];
  const next = DRAGON_PATH_BELTS[current + 1];
  const span = next ? next.rounds - step.rounds : 0;
  const progress = !next ? 1 : span > 0 ? Math.min(1, Math.max(0, (rounds - step.rounds) / span)) : 0;
  if (!visible) return null;
  return <div className="panda-belt" data-belt={belt}>
    <span className="panda-belt-name">{t(step.label)}</span>
    <span className="panda-path" aria-hidden="true">
      {DRAGON_PATH_BELTS.map((beltStep, index) => (
        <i key={beltStep.id}
          data-state={index < current ? 'done' : index === current ? 'current' : 'future'}
          style={index === current ? { "--part": `${(progress * 100).toFixed(1)}%` } as CSSProperties : undefined}
        />
      ))}
    </span>
    {next ? <small>{tr`До следующего пояса: ${next.rounds - rounds}`}</small> : null}
  </div>;
}

function HeroPanel({
  mood,
  line,
  belt,
  action,
  impact,
  reducedMotion,
}: {
  mood: Mood;
  line: string;
  belt: DragonPathBelt;
  action: HeroAction;
  impact: number;
  reducedMotion: boolean;
}) {
  const images = heroImages[belt];
  // Клип, если он есть, заменяет статичную позу: анимация внутри кадра, а не поверх.
  const clip = heroClips[belt]?.[action];
  const source = clip ?? images[action];
  const stageRef = useRef<HTMLDivElement>(null);
  useImpactShake(stageRef, impact, reducedMotion, HERO_RECOIL, RECOIL_OPTIONS);
  return (
    <aside aria-label={t('Персонаж')} className="panda-hero-wrap panda-hero-side" data-belt={belt} data-action={action}>
      <div
        ref={stageRef}
        className="panda-hero-stage"
        data-action={action}
        data-media={clip ? "clip" : "pose"}
      >
        <img
          key={`${action}-${impact}`}
          src={source}
          alt={t('Мастер-панда с посохом')}
          data-mood={mood}
          className="panda-hero"
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
  charge,
  impact,
  tier,
  winCents,
  reducedMotion,
  children,
}: {
  roundKey: string;
  view: PandaView | undefined;
  spinning: boolean[];
  settled: boolean;
  animateCuts: boolean;
  celebrate: boolean;
  charge: boolean;
  impact: number;
  tier: string;
  winCents: string;
  reducedMotion: boolean;
  children?: ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  useImpactShake(gridRef, impact, reducedMotion, GRID_SHAKE, SHAKE_OPTIONS);
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
    <div className="panda-frame" data-celebrate={celebrate || undefined} data-tier={tier === 'none' ? undefined : tier}>
      {impact > 0 && <div className="panda-impact" key={impact} aria-hidden="true" />}
      <div
        ref={gridRef}
        role="group"
        aria-label={t('Барабаны')}
        className="panda-grid"
        data-dim={highlights.size > 0 || undefined}
      >
        {Array.from({ length: COLUMNS }, (_, column) => (
          <div key={column} className="panda-reel" data-spinning={spinning[column] || undefined}
            data-charge={charge && spinning[column] ? true : undefined}>
            {spinning[column] ? (
              <div className="panda-strip" aria-hidden="true">
                {[...BLUR_STRIP(column), ...BLUR_STRIP(column)].map((symbol, i) => (
                  <div key={i} className="panda-cell">
                    <img src={symbolImages[symbol]} alt="" draggable={false} />
                  </div>
                ))}
              </div>
            ) : (
              <>
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
                {view ? <span className="panda-reel-hit" aria-hidden="true" /> : null}
              </>
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
          <small>{formatCents(winCents)}</small>
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
