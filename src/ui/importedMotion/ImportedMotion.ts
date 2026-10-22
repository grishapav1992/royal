import { gameAudio } from '../../game/GameAudio';
import { language, locale } from '../../i18n/index';
import { demoWallet } from '../../wallet/WalletClient';
import type { GameModuleInstance } from '../../modules/GameHostContract';
import { ImportedMotionAudio } from './Audio';
import { IMPORTED_OUTCOME_EVENT, importedOutcomeTier, isImportedMotionGame, type ImportedMotionGame, type ImportedOutcome } from './Outcome';
import { MOTION_PROFILES } from './Profiles';
import './imported-motion.css';

const actions = '[data-start],[data-fruits-spin],[data-dice-play],[data-limbo-play],#original-play,[data-mine-cell],[data-cell],[data-cashout],[data-action="start"],[data-action="roll"]';
const cells = '[data-mine-cell],[data-cell],[data-keno-number],[data-confirmed-die],[data-confirmed-gem]';
const boardSelector = '.fruits-frame,[data-dice-board-host],[data-limbo-board],.limbo-stage,.original-board-wrap,.royal-confirmed-motion,.expansion-board,.casino-board,.github-table';
const labels = () => language === 'en'
  ? { win: 'WIN', big: 'BIG WIN', epic: 'EPIC WIN', payout: 'Return', profit: 'Profit', skip: 'Skip effects', coins: 'coins', chips: 'chips' }
  : { win: 'ВЫИГРЫШ', big: 'КРУПНЫЙ ВЫИГРЫШ', epic: 'ВЕЛИКОЛЕПНЫЙ ВЫИГРЫШ', payout: 'Выплата', profit: 'Прибыль', skip: 'Пропустить эффекты', coins: 'монет', chips: 'фишек' };

export class ImportedMotion {
  private lifetime = new AbortController();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private animations = new Set<Animation>();
  private states = new Map<string, string>();
  private observer: MutationObserver;
  private frame = 0;
  private watchdog = 0;
  private hideTimer = 0;
  private armed = false;
  private alive = true;
  private panel?: HTMLElement;
  private audio: ImportedMotionAudio;
  private unsubscribe: () => void;
  private token = 0;
  private preference = () => this.cancel();
  private owner = demoWallet.accountId;
  private accountChange = () => { if (this.owner !== demoWallet.accountId) { this.owner = demoWallet.accountId; this.cancel(); } };

  constructor(private root: HTMLElement, private content: HTMLElement, private game: ImportedMotionGame) {
    const profile = MOTION_PROFILES[game];
    root.className = 'imported-motion'; root.dataset.importedMotion = game; root.dataset.motionPhase = 'idle';
    root.style.setProperty('--imp-color', profile.color); root.style.setProperty('--imp-secondary', profile.secondary);
    this.audio = new ImportedMotionAudio(profile);
    this.unsubscribe = gameAudio.onPreferences(value => { if (value.muted || value.volume === 0) this.audio.stop(); });
    content.addEventListener('click', event => this.start(event), { capture: true, signal: this.lifetime.signal });
    root.addEventListener(IMPORTED_OUTCOME_EVENT, event => this.outcome((event as CustomEvent<ImportedOutcome>).detail), { signal: this.lifetime.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); }, { signal: this.lifetime.signal });
    content.addEventListener('change', event => { if ((event.target as Element | null)?.matches('[data-asset]')) this.cancel(); }, { signal: this.lifetime.signal });
    demoWallet.addEventListener('change', this.accountChange, { signal: this.lifetime.signal });
    this.reduced.addEventListener('change', this.preference);
    this.scan(false);
    this.observer = new MutationObserver(() => {
      // Only confirmed board changes can receive landing accents. UI rerenders keep
      // their stable cell identities, so refreshes cannot replay earlier reveals.
      this.scan(this.armed);
      if (this.armed && content.querySelector('[role="alert"]')?.textContent?.trim()) this.cancel();
    });
    this.observer.observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-revealed', 'data-state', 'data-phase', 'data-motion-phase', 'data-motion', 'data-keno-presentation', 'data-tower-motion'] });
  }
  private start(event: Event) {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button');
    if (!button || button.disabled || document.hidden) return;
    if (!button.matches(actions)) {
      if (button.matches('[data-asset],[data-refresh],[data-retry]')) this.cancel();
      return;
    }
    this.cancel(); this.armed = true; const token = ++this.token;
    this.root.dataset.motionPhase = 'anticipation';
    if (!this.reduced.matches) {
      this.animate(button, [{ transform: 'scale(1)' }, { transform: 'scale(.965)', offset: .35 }, { transform: 'scale(1)' }], 190);
      this.audio.contact();
    }
    this.watchdog = window.setTimeout(() => { if (this.token === token) this.cancel(); }, 18000);
  }
  private scan(play: boolean) {
    if (play) {
      const phase = this.content.dataset.motionPhase ?? this.content.querySelector<HTMLElement>('[data-phase],[data-keno-presentation],[data-tower-motion],[data-motion]')?.dataset;
      const value = typeof phase === 'string' ? phase : phase?.phase ?? phase?.kenoPresentation ?? phase?.towerMotion ?? phase?.motion;
      if (value && ['waiting', 'pending', 'rolling', 'accelerating', 'spinning'].includes(value)) this.root.dataset.motionPhase = 'spinning';
      if (value && ['stopping', 'revealing', 'confirmed', 'drawing'].includes(value)) this.root.dataset.motionPhase = 'revealing';
    }
    const next = new Map<string, string>(); let index = 0;
    this.content.querySelectorAll<HTMLElement>(cells).forEach(node => {
      const key = ['mineCell', 'cell', 'kenoNumber', 'confirmedDie', 'confirmedGem'].map(name => `${name}:${node.dataset[name] ?? ''}`).join('/');
      const state = [node.className, node.dataset.revealed ?? '', node.dataset.gem ?? ''].join('/');
      next.set(key, state);
      const prior = this.states.get(key);
      const revealed = node.matches('.is-gem,.is-mine,.is-drawn,.safe,.trap,.chosen,[data-revealed="true"]');
      if (!play || !revealed || prior === state || prior === undefined && !node.matches('[data-revealed="true"]')) return;
      if (!this.reduced.matches) {
        this.animate(node, [{ transform: node.hasAttribute('data-mine-cell') ? 'perspective(600px) rotateY(-72deg) scale(.9)' : 'translateY(-4px) scale(.94)', opacity: .6 }, { transform: 'scale(1.045)', opacity: 1, offset: .68 }, { transform: 'scale(1)', opacity: 1 }], node.hasAttribute('data-mine-cell') ? 340 : 220);
        if (!node.matches('.is-mine,.trap')) this.audio.reveal(Number(node.dataset.confirmedGem ?? node.dataset.confirmedDie ?? index++));
      }
      this.root.dataset.motionPhase = 'landing';
    });
    this.states = next;
  }
  private outcome(result: ImportedOutcome) {
    if (!this.alive || !this.armed || document.hidden || result.gameId !== this.game) return;
    const tier = importedOutcomeTier(result.spentUnits, result.returnedUnits);
    if (!tier) return;
    this.armed = false; clearTimeout(this.watchdog); this.watchdog = 0;
    this.root.dataset.motionPhase = 'settled'; this.root.dataset.winTier = tier;
    this.root.dataset.returnedUnits = result.returnedUnits;
    const profit = BigInt(result.returnedUnits) - BigInt(result.spentUnits);
    this.root.dataset.profitUnits = profit.toString();
    if (tier === 'none' || tier === 'return') { this.audio.stop(); return; }
    const text = labels(), decimals = result.decimals ?? 2, scale = 10n ** BigInt(decimals);
    const money = (units: bigint) => {
      const whole = (units / scale).toLocaleString(locale), fraction = (units % scale).toString().padStart(decimals, '0');
      return whole + (language === 'en' ? '.' : ',') + fraction;
    };
    const unit = result.unit === 'USDT' ? 'USDT' : result.unit === 'chips' ? text.chips : text.coins;
    const large = tier !== 'win', motion = !this.reduced.matches;
    const duration = motion ? tier === 'epic' ? 2100 : large ? 1500 : 950 : 650;
    const panel = document.createElement('section'); panel.className = `imp-celebration imp-tier-${tier}`;
    panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    const heading = document.createElement('span'); heading.className = 'imp-heading'; heading.textContent = text[tier];
    const value = document.createElement('strong'); value.className = 'imp-value'; value.setAttribute('aria-hidden', 'true');
    const detail = document.createElement('span'); detail.className = 'imp-detail';
    detail.textContent = `${text.payout}: ${money(BigInt(result.returnedUnits))} ${unit}. ${text.profit}: +${money(profit)}`;
    const caption = document.createElement('span'); caption.className = 'imp-caption'; caption.textContent = `${text.profit} · ${unit}`;
    panel.append(heading, value, caption, detail);
    if (large) {
      const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'imp-skip'; skip.textContent = '×'; skip.setAttribute('aria-label', text.skip);
      skip.onclick = () => this.clearPanel(); panel.append(skip);
    }
    const board = this.content.querySelector<HTMLElement>(boardSelector) ?? this.content;
    const rect = board.getBoundingClientRect(), outer = this.root.getBoundingClientRect();
    const viewport = this.root.closest('#mini-game')?.getBoundingClientRect();
    const visibleTop = Math.max(outer.top, viewport?.top ?? 0, 0) + 12;
    const visibleBottom = Math.min(outer.bottom, viewport?.bottom ?? innerHeight, innerHeight) - 12;
    const desired = rect.top + Math.min(rect.height / 2, 180) - (large ? 92 : 58);
    const anchored = Math.max(visibleTop, Math.min(desired, visibleBottom - (large ? 200 : 142)));
    panel.style.top = `${Math.max(0, anchored - outer.top)}px`;
    this.panel = panel; this.root.append(panel);
    const token = this.token, started = performance.now(), countDuration = motion && large ? 700 : 0;
    const count = (now: number) => {
      if (!this.alive || this.panel !== panel || token !== this.token) return;
      const progress = countDuration ? Math.min(1, (now - started) / countDuration) : 1;
      const steps = BigInt(Math.round((1 - (1 - progress) ** 3) * 1000));
      value.textContent = '+' + money(profit * steps / 1000n);
      if (progress < 1) this.frame = requestAnimationFrame(count); else this.frame = 0;
    };
    count(started);
    if (motion) {
      this.animate(panel, [{ opacity: 0, transform: 'translateY(14px) scale(.92)' }, { opacity: 1, transform: 'translateY(-2px) scale(1.025)', offset: .7 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], 340);
      this.particles(panel, tier === 'epic' ? 28 : large ? 18 : 9);
      this.audio.celebrate(tier);
    }
    this.hideTimer = window.setTimeout(() => this.dismissPanel(), duration - (motion ? 160 : 0));
  }
  private particles(panel: HTMLElement, count: number) {
    const { glyph } = MOTION_PROFILES[this.game];
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('i'); particle.className = 'imp-particle'; particle.textContent = glyph; particle.setAttribute('aria-hidden', 'true'); panel.append(particle);
      const angle = Math.PI * 2 * i / count, radius = 65 + i % 4 * 18, x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * .62;
      this.animate(particle, [{ transform: 'translate(0,0) scale(.25)', opacity: 0 }, { transform: `translate(${x * .65}px,${y - 18}px) scale(1) rotate(${i * 28}deg)`, opacity: .9, offset: .35 }, { transform: `translate(${x}px,${y + 34}px) scale(.4) rotate(${i * 47}deg)`, opacity: 0 }], 650 + i % 5 * 90);
    }
  }
  private animate(node: HTMLElement, frames: Keyframe[], duration: number) {
    if (this.reduced.matches || !this.alive || document.hidden) return;
    try {
      const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.16,.75,.25,1)' }); this.animations.add(animation);
      const finish = () => { this.animations.delete(animation); animation.cancel(); };
      animation.finished.then(finish, finish);
    } catch { /* The settled result remains visible without an animation API. */ }
  }
  private clearPanel() {
    clearTimeout(this.hideTimer); this.hideTimer = 0; cancelAnimationFrame(this.frame); this.frame = 0;
    this.panel?.remove(); this.panel = undefined; this.audio.stop();
    for (const animation of this.animations) animation.cancel(); this.animations.clear();
  }
  private dismissPanel() {
    const panel = this.panel;
    if (!panel || this.reduced.matches) { this.clearPanel(); return; }
    const finish = () => { if (this.panel === panel) this.clearPanel(); };
    try {
      const animation = panel.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(-5px) scale(.985)'}],{duration:160,easing:'ease-in',fill:'forwards'});
      this.animations.add(animation); animation.finished.then(finish,finish);
      this.hideTimer = window.setTimeout(finish,210);
    } catch { finish(); }
  }
  private cancel() {
    this.token++; this.armed = false; clearTimeout(this.watchdog); this.watchdog = 0; this.clearPanel();
    this.root.dataset.motionPhase = 'idle'; delete this.root.dataset.winTier; delete this.root.dataset.profitUnits; delete this.root.dataset.returnedUnits;
  }
  destroy() {
    this.alive = false; this.cancel(); this.observer.disconnect(); this.lifetime.abort(); this.unsubscribe();
    this.reduced.removeEventListener('change', this.preference);
  }
}

/** Each independent game keeps its view, server rules, wallet and lifecycle. */
export function mountImportedMotion(host: HTMLElement, game: string, mount: (content: HTMLElement) => Pick<GameModuleInstance, 'destroy'>): GameModuleInstance {
  if (!isImportedMotionGame(game)) return mount(host);
  const root = document.createElement('div'), content = document.createElement('div'); content.className = 'imp-content';
  root.append(content); host.replaceChildren(root);
  let view: Pick<GameModuleInstance, 'destroy'>;
  try { view = mount(content); } catch (error) { root.remove(); throw error; }
  const motion = new ImportedMotion(root, content, game);
  return { destroy() { motion.destroy(); view.destroy(); root.remove(); } };
}
