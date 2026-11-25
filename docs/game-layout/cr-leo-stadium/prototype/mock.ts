import { PENALTY_RISKS, penaltyPathQuote, penaltyZone, type PenaltyHero, type PenaltyRisk, type PenaltyShot, type PenaltyView } from '../../../../../src/shared/crLeo';
import { isWallHit } from '../../../../../src/ui/crLeoFreeKick';
import { loadAssets } from './assets';
import { MatchScene } from './scene';

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const money = (u: string | bigint | number) => (Number(u) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const times = (risks: PenaltyRisk[]) => '≈' + (Number(penaltyPathQuote('1000000', risks)) / 1e6).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
const about = { safe: '11 м', sharp: '20 м<i>, стенка 5</i>', extreme: '30 м<i>, стенка 3</i>' } as const;
const PLACE = { safe: 'Пенальти, 11 м', sharp: 'Штрафной, 20 м', extreme: 'Дальний, 30 м' } as const;

const root = $('#game');
root.innerHTML = `<header class="cl-header"><div class="cl-brand"><b>CR</b><i>vs.</i><b>Leo</b></div><div class="cl-tools"><button type="button">Как играть</button><button type="button" data-sound>Звук</button></div></header>
<div class="cl-stage"><canvas aria-label="Удар по воротам на дневном стадионе"></canvas>
<div class="cl-spot"><b data-name>CR</b><span data-place></span></div><div class="cl-sum" data-sum><span data-caption></span><strong data-value></strong><span data-detail></span></div>
<div class="cl-moment" data-moment hidden><b></b><span></span></div>
<div class="cl-loader" data-loader><b>CR <i>vs.</i> <span>Leo</span></b><progress max="100" value="0"></progress><span>Готовим стадион</span></div></div>
<ol class="cl-track" data-ladder aria-label="Серия из пяти ударов"></ol>
<div class="cl-controls"><div class="cl-choose"><div><span class="cl-label">Твой игрок</span><div class="cl-heroes"><button data-hero="cr" type="button"><i class="cl-mini" style="background-image:url(a/cr-white-thumb.webp)"></i><span><b>CR</b> <small>правая</small></span></button><button data-hero="leo" type="button"><i class="cl-mini" style="background-image:url(a/leo-thumb.webp)"></i><span><b>Leo</b> <small>левая</small></span></button></div></div><button class="cl-gear" type="button" aria-label="Настройки игры">⚙</button></div>
<div><span class="cl-label">Тип удара и шанс гола</span><div class="cl-risks">${(Object.keys(PENALTY_RISKS) as PenaltyRisk[]).map(r => `<button data-risk="${r}" type="button"><b>${PENALTY_RISKS[r].name}</b><em>${PENALTY_RISKS[r].chance}%</em><small>${about[r]}</small></button>`).join('')}</div></div>
<div class="cl-betting"><div class="cl-bank"><span><span>Баланс</span><b data-balance></b></span><label>Ставка <select id="stake" data-stake>${['10', '20', '50', '100', '200', '500', '1000', '2000', '5000'].map(v => `<option value="${v}">${money(v)}</option>`).join('')}</select></label></div><div class="cl-actions"><button class="cl-take" data-take type="button"></button><button class="cl-primary" data-shoot type="button"></button></div></div></div>
<p class="cl-status" role="status" data-status></p>
<div class="cl-menu" hidden data-menu><button type="button">Как играть</button><button type="button">Звук включён</button></div>`;
const ballIcon = (frames: { image: HTMLCanvasElement }[]) => root.style.setProperty('--ball', `url(${frames[0].image.toDataURL()})`);

// Sample series with the real odds and payouts. No wallet and no network.
let hero: PenaltyHero = 'cr', risk: PenaltyRisk = 'safe', stake = '10', balance = 100000, view: PenaltyView | undefined, selection = true, scene: MatchScene | undefined, shownBalance = balance, returned = '0', bumped = '';
let speed = 1, virtual = 0, lastReal = performance.now(), outcome = 'random', reduced = false;
const clock = () => virtual;
const roll = () => Math.random();
function kick(forced = outcome) {
  if (!scene || scene.state().busy) return;
  const active = view?.status === 'playing';
  if (!active) { if (balance < Number(stake)) balance += 100000; balance -= Number(stake); shownBalance = balance; }
  let goal = forced === 'goal' || forced === 'random' && roll() * 100 < PENALTY_RISKS[risk].chance, finish: PenaltyShot['finish'] = 'goal', zone = Math.floor(roll() * 18);
  if (!goal) { finish = forced === 'random' ? (['save', 'save', 'post', 'wide'] as const)[Math.floor(roll() * 4)] : forced === 'wall' ? 'wide' : forced as PenaltyShot['finish']; if (forced === 'wall') { zone = [8, 9, 2, 3][Math.floor(roll() * 4)]; if (risk === 'safe') { risk = 'sharp'; scene.chooseRisk(risk); } } if (finish === 'post') zone = [0, 5, 6, 11, 2, 3, 1][Math.floor(roll() * 7)]; if (forced === 'wide') zone = [0, 5, 6, 11][Math.floor(roll() * 4)]; }
  const shots: PenaltyShot[] = [...(active ? view!.shots : []), { index: active ? view!.shots.length : 0, goal, finish, side: penaltyZone(zone).side, risk, zone }];
  const risks = shots.filter(s => s.goal).map(s => s.risk!);
  view = { version: 2, hero, risk, revision: shots.length, shots, status: !goal ? 'lost' : shots.length === 5 ? 'complete' : 'playing', availableUnits: goal ? penaltyPathQuote(stake, risks) : '0' };
  returned = view.status === 'complete' ? view.availableUnits : '0'; if (returned !== '0') balance += Number(returned);
  selection = false; scene.reduced = reduced; scene.show(view, true); sync();
}
function take() {
  if (!scene || scene.state().busy || view?.status !== 'playing') return;
  view = { ...view, status: 'banked', revision: view.revision + 1 }; returned = view.availableUnits; balance += Number(returned); scene.reduced = reduced; scene.show(view, true, true); sync();
}
function showFinal() {
  if (!scene) return; const risks = Array<PenaltyRisk>(5).fill(risk);
  view = { version: 2, hero, risk, revision: 5, status: 'complete', availableUnits: penaltyPathQuote(stake, risks), shots: risks.map((r, index) => ({ index, goal: true, finish: 'goal', side: -1, risk: r, zone: 7 })) };
  returned = view.availableUnits; selection = false; scene.show(view, true); sync();
}
root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(b => b.onclick = () => { if (scene?.state().busy || view?.status === 'playing') return; hero = b.dataset.hero as PenaltyHero; selection = true; view = undefined; scene?.select(hero, risk); sync(); });
root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b => b.onclick = () => { if (scene?.state().busy) return; risk = b.dataset.risk as PenaltyRisk; scene?.chooseRisk(risk); if (view?.status !== 'playing') { selection = true; view = undefined; scene?.select(hero, risk); } sync(); });
$('[data-shoot]', root).onclick = () => kick(); $('[data-take]', root).onclick = take;
$<HTMLSelectElement>('[data-stake]', root).onchange = e => { stake = (e.target as HTMLSelectElement).value; sync(); };
$('.cl-gear', root).onclick = () => { const m = $('[data-menu]', root); m.hidden = !m.hidden; };

let drawnKey = '';
function sync() {
  if (!scene) return;
  const st = scene.state(), active = view?.status === 'playing', shots = view?.shots ?? [], shown = st.reveal ? shots : shots.slice(0, -1);
  const key = JSON.stringify([view?.revision, view?.status, st.reveal, st.busy, hero, risk, stake, selection, shownBalance, balance, scene.shout()]); if (key === drawnKey) return; drawnKey = key;
  if (st.reveal) shownBalance = balance;
  const lost = view?.status === 'lost' && st.reveal, paid = (view?.status === 'complete' || view?.status === 'banked') && st.reveal, over = lost || paid;
  const won = shown.filter(s => s.goal).map(s => s.risk!), path = (n: number) => Array.from({ length: n }, (_, i) => won[i] ?? risk);
  root.dataset.hero = hero;
  root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.hero === hero)); b.disabled = !!active || st.busy; });
  root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.risk === risk)); b.disabled = st.busy; });
  $<HTMLSelectElement>('[data-stake]', root).disabled = !!active || st.busy; $('[data-balance]', root).textContent = money(shownBalance);
  $('[data-name]', root).textContent = hero === 'cr' ? 'CR' : 'Leo'; $('[data-place]', root).textContent = PLACE[risk];
  const tag = won.length + ':' + view?.revision;
  $('[data-ladder]', root).innerHTML = Array.from({ length: 5 }, (_, i) => { const s = shown[i], mode = s ? s.goal ? 'goal' : 'miss' : over ? 'idle' : i === shown.length ? st.phase === 'shooting' ? 'live' : 'next' : 'idle';
    return `<li data-s="${mode}" aria-label="Удар ${i + 1}: ${s ? s.goal ? 'гол' : 'промах' : 'впереди'}"><span class="n">${mode === 'miss' ? '×' : i + 1}<i class="${mode === 'goal' && i === won.length - 1 && bumped !== tag ? 'cl-fresh' : ''}"></i></span><b>${times(path(i + 1))}</b></li>`; }).join('');
  const available = won.length ? penaltyPathQuote(stake, won) : '0', sum = $('[data-sum]', root);
  const [cap, val, det] = lost ? ['Серия завершена', money(0), 'Ставка ' + money(stake)] : paid ? ['Выплата', money(returned), 'Прибыль +' + money(Number(returned) - Number(stake))]
    : won.length ? ['Можно забрать', money(available), times(won)] : ['Твоя серия', money(0), 'Первый гол даст ' + money(penaltyPathQuote(stake, [risk]))];
  $('[data-caption]', root).textContent = cap; $('[data-value]', root).textContent = val; $('[data-detail]', root).textContent = det;
  if (bumped !== tag && won.length && st.reveal) { sum.classList.remove('cl-pop'); void sum.offsetWidth; sum.classList.add('cl-pop'); bumped = tag; }
  const t = $<HTMLButtonElement>('[data-take]', root), s = $<HTMLButtonElement>('[data-shoot]', root), canTake = !!active && st.reveal;
  t.disabled = !canTake || st.busy; t.dataset.live = String(canTake && !st.busy); t.innerHTML = canTake ? `ЗАБРАТЬ<b>${money(available)}</b>` : 'ЗАБРАТЬ<small>после гола</small>';
  s.disabled = st.busy; s.innerHTML = st.busy && !st.reveal ? 'МЯЧ В ИГРЕ<small>&nbsp;</small>' : active ? `СЛЕДУЮЩИЙ УДАР<small>гол даст ${money(penaltyPathQuote(stake, [...won, risk]))}</small>` : `${over ? 'НОВАЯ СЕРИЯ' : risk === 'safe' ? 'БИТЬ ПЕНАЛЬТИ' : 'БИТЬ ШТРАФНОЙ'}<small>ставка ${money(stake)}</small>`;
  const m = $('[data-moment]', root), last = shots.at(-1), show = !!view && !selection && st.reveal && (st.busy || over); m.hidden = !show;
  if (show) {
    const tone = paid ? 'paid' : lost ? 'miss' : 'goal', full = view!.status === 'complete';
    m.dataset.tone = tone;
    $('b', m).textContent = paid ? full ? !st.busy || scene.shout() ? hero === 'cr' ? 'SIUUU!' : 'LEO!' : '5 ИЗ 5!' : 'ЗАБРАЛ!' : lost ? isWallHit(last, last?.risk) ? 'СТЕНКА' : last?.finish === 'save' ? 'СЕЙВ' : last?.finish === 'post' ? 'ШТАНГА' : 'МИМО' : 'ГОООЛ!';
    $('span', m).textContent = paid ? `Выплата ${money(returned)}` : lost ? 'Новая серия, новый шанс' : ''; $('span', m).hidden = tone === 'goal';
  }
  $('[data-status]', root).textContent = st.phase === 'shooting' ? 'Мяч в игре.' : active ? 'Продолжи серию или забери выплату. Время не ограничено.' : over ? paid ? 'Выплата зачислена.' : 'Серия завершена. Можно начать новую.' : 'Выбери игрока и тип удара. Первый удар начинает серию.';
}
const layout = () => { const w = root.offsetWidth, h = root.offsetHeight; root.dataset.layout = w >= 900 && h >= 600 ? 'full' : w > h && h < 600 ? 'landscape' : 'portrait'; };
new ResizeObserver(layout).observe(root); layout();
let manual = false;
function frame(now: number) { if (!manual) { virtual += Math.min(60, now - lastReal) * speed; } lastReal = now; if (scene && !manual) { scene.paint(); sync(); } requestAnimationFrame(frame); }
requestAnimationFrame(frame);
(window as any).mock = { kick, take, showFinal, get scene() { return scene; }, set: (o: any) => { if (o.hero) hero = o.hero; if (o.risk) risk = o.risk; if (o.reduced !== undefined) reduced = o.reduced; view = undefined; selection = true; scene?.select(hero, risk); drawnKey = ''; sync(); },
  manual: (on: boolean) => { manual = on; }, advance: (ms: number) => { const step = 1000 / 60; for (let left = ms; left > 0; left -= step) { virtual += Math.min(step, left); scene!.paint(); } sync(); },
  play: (o: any) => { view = { version: 2, hero, risk, revision: o.goals ?? 1, status: o.finish && o.finish !== 'goal' ? 'lost' : (o.goals ?? 1) === 5 ? 'complete' : 'playing', availableUnits: '0', shots: Array.from({ length: o.goals ?? 1 }, (_, index) => ({ index, goal: index < (o.goals ?? 1) - 1 || (o.finish ?? 'goal') === 'goal', finish: index < (o.goals ?? 1) - 1 ? 'goal' : o.finish ?? 'goal', side: penaltyZone(o.zone ?? 7).side, risk, zone: o.zone ?? 7 })) } as PenaltyView; if (view.status !== 'lost') view.availableUnits = penaltyPathQuote(stake, view.shots.map(s => s.risk!)); returned = view.status === 'complete' ? view.availableUnits : '0'; selection = false; scene!.show(view, true); sync(); } };

// Page controls around the game window.
document.querySelectorAll<HTMLButtonElement>('[data-size]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#frame').dataset.frame = b.dataset.size!; fit(); });
$<HTMLSelectElement>('#outcome').onchange = e => outcome = (e.target as HTMLSelectElement).value;
$<HTMLInputElement>('#slow').onchange = e => speed = (e.target as HTMLInputElement).checked ? .25 : 1;
$<HTMLInputElement>('#calm').onchange = e => { reduced = (e.target as HTMLInputElement).checked; if (scene) scene.reduced = reduced; };
$('#final').onclick = showFinal;
function fit() { const f = $('#frame'), size = { desk: [1104, 846], phone: [387, 800], land: [846, 342] }[f.dataset.frame as 'desk'], box = $('#fit').clientWidth, k = Math.min(1, box / size[0]); f.style.width = size[0] + 'px'; f.style.height = size[1] + 'px'; f.style.transform = `scale(${k})`; $('#fit').style.height = size[1] * k + 'px'; f.style.marginLeft = Math.max(0, (box - size[0] * k) / 2) + 'px'; }
addEventListener('resize', fit);
{ const start = innerWidth < 700 ? 'phone' : 'desk'; $('#frame').dataset.frame = start; document.querySelectorAll<HTMLElement>('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.size === start))); } fit();
loadAssets('a/', n => $<HTMLProgressElement>('progress', root).value = n).then(a => { ballIcon(a.frames.get('ball')!); scene = new MatchScene($<HTMLCanvasElement>('canvas', root), a, () => {}, clock); reduced = scene.reduced; $<HTMLInputElement>('#calm').checked = reduced; scene.select(hero, risk); $('[data-loader]', root).hidden = true; sync(); (window as any).mockReady = true; }).catch(() => { $('[data-loader] > span', root).textContent = 'Не удалось загрузить графику. Обнови страницу.'; });
