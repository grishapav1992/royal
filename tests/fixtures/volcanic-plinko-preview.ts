import { VolcanicPlinkoUI } from '../../src/ui/VolcanicPlinkoUI';
import { demoWallet } from '../../src/wallet/WalletClient';
import { gameAudio } from '../../src/game/GameAudio';

gameAudio.install();
const params = new URL(location.href).searchParams;
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
  const review = document.createElement('aside'); review.style.cssText = 'position:fixed;bottom:2px;left:8px;z-index:40;color:#fff;background:#25122fee;font:10px Arial;padding:6px;display:flex;gap:10px';
  const close = document.createElement('button'); close.textContent = 'Закрыть тест'; close.onclick = () => game.destroy();
  const output = document.createElement('output'); output.setAttribute('aria-label', 'Проверка анимации и звука'); review.append(close, output); document.body.append(review);
  setInterval(() => { const state = game.getState(); output.textContent = `${state.state}; launch=${state.sounds.launch}; hits=${state.sounds.hit}; land=${state.sounds.land}; sources=${state.activeSources}`; }, 150);
}
