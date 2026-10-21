import { VolcanicPlinkoUI } from '../../src/ui/VolcanicPlinkoUI';
import { demoWallet } from '../../src/wallet/WalletClient';
import { gameAudio } from '../../src/game/GameAudio';

gameAudio.install();
const params = new URL(location.href).searchParams;
// Fixture-only network delay: the idle clip stays responsive while a gesture loads.
const portraitDelay = Number(params.get('slowPortrait'));
if (params.has('review') && portraitDelay >= 250 && portraitDelay <= 10000) {
  const nativeSource = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
  const nativeLoad = HTMLMediaElement.prototype.load;
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    ...nativeSource,
    set: function (this: HTMLMediaElement, value: string) {
      if (!value.includes('/vespera-gesture-')) { nativeSource.set!.call(this, value); return; }
      setTimeout(() => {
        if (this.isConnected) { nativeSource.set!.call(this, value); nativeLoad.call(this); }
      }, portraitDelay);
    },
  });
}
// Exercise the real reduced-motion listener through a fixture-only preference.
const nativeMatchMedia = window.matchMedia.bind(window);
let quietMotion = params.has('quietMotion');
const motionEvents = new EventTarget();
const controlledMotion = {
  get matches() { return quietMotion; }, media: '(prefers-reduced-motion: reduce)', onchange: null,
  addEventListener: motionEvents.addEventListener.bind(motionEvents),
  removeEventListener: motionEvents.removeEventListener.bind(motionEvents),
  dispatchEvent: motionEvents.dispatchEvent.bind(motionEvents),
  addListener(listener: EventListener) { motionEvents.addEventListener('change', listener); },
  removeListener(listener: EventListener) { motionEvents.removeEventListener('change', listener); },
} as MediaQueryList;
if (params.has('review') || params.has('quietMotion')) {
  window.matchMedia = query => query === controlledMotion.media ? controlledMotion : nativeMatchMedia(query);
}
if (params.has('loseReply')) {
  const originalFetch = window.fetch.bind(window); let lost = false;
  window.fetch = async (request, init) => {
    const response = await originalFetch(request, init);
    if (!lost && String(request).endsWith('/api/demo-wallet/operations') && init?.body && JSON.parse(String(init.body)).kind === 'play' && response.ok) {
      lost = true; throw new TypeError('Simulated lost response after the server accepted the round');
    }
    return response;
  };
}
const width = Number(params.get('width')), height = Number(params.get('height'));
const preview = document.querySelector<HTMLElement>('#preview')!;
if (width >= 300 && width <= 1900 && height >= 540 && height <= 1300) {
  preview.style.width = width + 'px'; preview.style.height = height + 'px';
}
const tools = document.querySelector<HTMLElement>('#preview-tools')!;
const game = new VolcanicPlinkoUI(preview, { skipIntro: params.has('skipIntro') });
if (params.has('portraitAt')) game.previewPortrait(Math.max(0, Number(params.get('portraitAt')) || 0));
// This test fixture is served only by Vite and is not part of the application build.
async function connect() {
  try {
    const result = await (await fetch('/api/auth/me')).json();
    if (result.account) { demoWallet.setAccount(result.account.id); tools.replaceChildren(); return; }
    tools.innerHTML = '<span>Локальный тестовый сервер</span><button type="button">Создать тестовый аккаунт</button>';
    tools.querySelector('button')!.onclick = async () => {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `plinko-${crypto.randomUUID()}@example.test`, password: 'Royal-plinko-test-password!' }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      demoWallet.setAccount(value.account.id); await demoWallet.operate('deposit', 1000); tools.replaceChildren();
    };
  } catch { tools.textContent = 'Тестовый API недоступен.'; }
}
void connect();
Object.assign(window, { volcanicPreview: { game, wallet: demoWallet, destroy: () => game.destroy() } });
if (params.has('review')) {
  const review = document.createElement('aside'); review.style.cssText = 'position:fixed;bottom:2px;left:8px;max-width:calc(100vw - 16px);z-index:40;color:#fff;background:#25122fee;font:10px Arial;padding:6px;display:flex;flex-wrap:wrap;gap:7px';
  const close = document.createElement('button'); close.textContent = 'Закрыть тест'; close.onclick = () => game.destroy();
  const motion = document.createElement('button'); motion.textContent = 'Меньше движения'; motion.onclick = () => {
    quietMotion = !quietMotion; motion.setAttribute('aria-pressed', String(quietMotion));
    motionEvents.dispatchEvent(new MediaQueryListEvent('change', { matches: quietMotion, media: controlledMotion.media }));
  };
  const gestures = [['Начало', 0], ['Талия', 4.2], ['Перед стыком', 7.45], ['Стык', 7.7], ['Продолжить', undefined]].map(([label, seconds]) => {
    const button = document.createElement('button'); button.textContent = String(label); button.onclick = () => game.previewPortrait(seconds === undefined ? undefined : Number(seconds)); return button;
  });
  const wins = [2, 3].map(multiplier => {
    const button = document.createElement('button'); button.textContent = `Проверить ${multiplier}×`;
    button.onclick = () => game.previewPortraitWin(multiplier); return button;
  });
  const output = document.createElement('output'); output.setAttribute('aria-label', 'Проверка анимации и звука'); review.append(close, motion, ...gestures, ...wins, output); document.body.append(review);
  setInterval(() => { const state = game.getState(), portrait = state.portrait; output.textContent = `${state.state}; launch=${state.sounds.launch}; hits=${state.sounds.hit}; land=${state.sounds.land}; sources=${state.activeSources}; portrait=${portrait.state}/${portrait.scene}; frames=${portrait.frames}; fps=${portrait.fps}; media=${portrait.profile}; first=${Math.round(portrait.firstFrameMs)}ms; time=${portrait.time.toFixed(2)}/${portrait.duration.toFixed(2)}; loops=${portrait.loops}; reactions=${portrait.reactions}/${portrait.lastReaction || '-'}; cooldown=${Math.ceil(portrait.cooldown / 1000)}; paused=${portrait.paused}; muted=${portrait.muted}`; }, 150);
}
