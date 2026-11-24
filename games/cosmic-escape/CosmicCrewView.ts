import {language} from '../../src/i18n/index';
import {COSMIC_CREW, COSMIC_CREW_CAPSULES, COSMIC_CREW_RATES, type CosmicCrewId, type CosmicCrewProfile} from '../../src/shared/cosmicCrew';
import {cosmicText as t, cosmicMarkup as tr} from './cosmicText';

const media = '/assets/cosmic-guardians/';
export const COSMIC_CREW_MEDIA: Record<CosmicCrewId, string> = {racer: media + 'racer-v2', silver: media + 'silver-v1'};
export const crewName = (id: CosmicCrewId) => id === 'silver' ? t('Серебряная героиня') : t('Гонщица');
export const crewShortName = (id: CosmicCrewId) => id === 'silver' ? t('Серебряная') : t('Гонщица');

export function crewPoints(count: number) {
  if (language === 'en') return `${count} ${count === 1 ? 'point' : 'points'}`;
  const form = ({one: 'очко', few: 'очка'} as Record<string, string>)[new Intl.PluralRules('ru').select(count)] ?? 'очков';
  return `${count} ${form}`;
}
export const crewRemaining = (count: number) => language === 'en' ? `${crewPoints(count)} to go` : `Ещё ${crewPoints(count)}`;
const money = (cents: number) => (cents / 100).toFixed(2).replace('.', language === 'en' ? '.' : ',');

export type CrewPlate = {state: 'none' | 'ready' | 'new' | 'full'; title: string; count: string; note: string; fill: number};
/** Everything the pedestal plate shows. Only a confirmed profile reaches it. */
export function crewPlate(profile: CosmicCrewProfile | undefined, failed: boolean, narrow = false): CrewPlate {
  if (!profile) return {state: 'none', title: narrow ? t('Экипаж') : crewShortName('racer'), count: narrow ? '' : t('Экипаж'), note: failed ? t('Прогресс недоступен') : '', fill: 0};
  const opened = profile.unlocked.length, count = narrow ? tr`${opened} из ${COSMIC_CREW_CAPSULES}` : tr`Экипаж ${opened} из ${COSMIC_CREW_CAPSULES}`, title = narrow ? t('Экипаж') : crewShortName(profile.selected);
  if (profile.unlocked.some(id => !profile.revealed.includes(id))) return {state: 'new', title: t('Новый персонаж'), count: '', note: narrow ? t('Открыть') : t('Открыть капсулу'), fill: 100};
  const next = COSMIC_CREW.find(member => member.points > profile.points);
  if (!next) return {state: 'full', title, count, note: narrow ? t('Скоро новые') : t('Новые персонажи скоро'), fill: 100};
  return {state: 'ready', title, count, note: crewRemaining(next.points - profile.points), fill: Math.floor(profile.points / next.points * 100)};
}
export const crewNewcomer = (profile: CosmicCrewProfile | undefined) => profile?.unlocked.find(id => !profile.revealed.includes(id));

const still = (id: CosmicCrewId, cue = 'idle') => `${COSMIC_CREW_MEDIA[id]}/${cue}-still.webp`;
const lock = '<svg viewBox="0 0 60 60" aria-hidden="true" focusable="false"><path d="M19 27v-7a11 11 0 0 1 22 0v7" fill="none" stroke="currentColor" stroke-width="5"/><rect x="13" y="27" width="34" height="25" rx="6" fill="currentColor"/><path d="M30 36v7" stroke="#171222" stroke-width="5" stroke-linecap="round"/></svg>';

export function crewDialog(profile: CosmicCrewProfile | undefined, options: {view: CosmicCrewId; busy: boolean; locked: boolean; failed: boolean; refused: string; animatePreview: boolean}) {
  const points = profile?.points ?? 0, selected = profile?.selected ?? 'racer', view = options.view, open = !profile ? view === 'racer' : profile.unlocked.includes(view), mine = view === selected;
  const deckPortrait = open && view === 'silver';
  const portrait = deckPortrait
    ? options.animatePreview ? `${COSMIC_CREW_MEDIA.silver}/deck.webp` : still(view, 'deck')
    : still(view);
  const pods = COSMIC_CREW.map(member => {
    const unlocked = member.points === 0 || !!profile?.unlocked.includes(member.id), chosen = member.id === selected, fresh = unlocked && !!profile && !profile.revealed.includes(member.id);
    const look = chosen ? 'chosen' : fresh ? 'fresh' : unlocked ? 'open' : 'next', left = Math.max(0, member.points - points);
    const note = chosen ? t('Выбрана') : unlocked ? t('Открыта') : profile ? crewRemaining(left) : crewPoints(member.points);
    return `<button type="button" class="cx-pod" data-look="${look}" data-lg-dialog-action="crew-view:${member.id}" aria-pressed="${view === member.id}"><span class="cx-capsule"><img src="${still(member.id)}" alt="" decoding="async"></span><b>${unlocked ? crewName(member.id) : t('Закрыта')}</b><span class="cx-pod-bar" aria-hidden="true"><i style="width:${unlocked ? 100 : Math.floor(points / member.points * 100)}%"></i></span><span class="cx-pod-note">${note}</span></button>`;
  }).join('') + Array.from({length: COSMIC_CREW_CAPSULES - COSMIC_CREW.length}, () => `<div class="cx-pod" data-look="soon"><span class="cx-capsule">${lock}</span><b>${t('Закрыта')}</b><span class="cx-pod-bar" aria-hidden="true"></span><span class="cx-pod-note">${t('Скоро')}</span></div>`).join('');
  const rates = COSMIC_CREW_RATES.map((rate, i) => { const next = COSMIC_CREW_RATES[i + 1]; return `<li><span>${next ? `${money(rate.from)}–${money(next.from - 1)}` : tr`от ${money(rate.from)}`}</span><b>+${rate.points}</b></li>`; }).join('');
  const message = options.refused === 'round-active' || open && !mine && options.locked ? t('Сменить персонажа можно после завершения раунда.') : options.refused ? t('Выбор не сохранён. Попробуй ещё раз.') : options.failed && !profile ? t('Не удалось загрузить прогресс. Игра продолжает работать.') : '';
  const label = mine ? t('Выбрана') : open ? t('Выбрать') : t('Пока закрыта');
  return `<div class="cx-crew-figure" data-open="${open}"><img src="${portrait}" ${deckPortrait ? 'data-cx-deck-pose' : ''} alt="" decoding="async"><div><b>${open ? crewName(view) : t('Закрытая капсула')}</b><span class="cx-crew-opened">${tr`Открыто ${profile?.unlocked.length ?? 1} из ${COSMIC_CREW_CAPSULES}`}</span><button type="button" class="lg-primary ce-primary" data-lg-dialog-action="crew-choose:${view}" ${mine || !open || options.busy || options.locked || !profile ? 'disabled' : ''}>${label}</button></div></div>
<div class="cx-crew-main"><header><h2 id="lg-dialog-title">${t('Экипаж')}</h2><span>${tr`Открыто ${profile?.unlocked.length ?? 1} из ${COSMIC_CREW_CAPSULES}`}</span><strong>${profile ? crewPoints(points) : ''}</strong><button type="button" class="cx-icon" data-lg-dialog-action="close" aria-label="${t('Закрыть экипаж')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
<div class="cx-pods">${pods}</div><p class="cx-crew-message" role="status">${message}</p>
<section class="cx-rates"><h3>${t('Очки за завершённый раунд')}</h3><ul>${rates}</ul></section>
<p class="cx-crew-note">${t('Считается вся сумма, списанная за раунд, USDT. Бесплатные вращения и выигрыш очков не добавляют. Персонаж не влияет на ставки и шансы, сменить его можно между раундами.')}</p></div>`;
}

export function crewReveal(id: CosmicCrewId, options: {busy: boolean; locked: boolean; refused: string}) {
  const message = options.refused === 'round-active' || options.locked ? t('Сменить персонажа можно после завершения раунда.') : options.refused ? t('Выбор не сохранён. Попробуй ещё раз.') : '';
  return `<div class="cx-capsule-open" aria-hidden="true"><i></i><i></i><span></span><img src="${still(id, 'win')}" alt=""></div><p class="cx-reveal-kicker">${t('Новый персонаж')}</p><h2 id="lg-dialog-title">${crewName(id)}</h2><p class="cx-crew-message" role="status">${message}</p><div class="cx-reveal-actions"><button type="button" class="lg-primary ce-primary" data-lg-dialog-action="crew-choose:${id}" ${options.busy || options.locked ? 'disabled' : ''}>${t('Выбрать')}</button><button type="button" class="ce-dialog-back" data-lg-dialog-action="crew-open">${t('В экипаж')}</button></div>`;
}
