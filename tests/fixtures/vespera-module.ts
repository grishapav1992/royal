import { IndependentGameUI } from '../../src/modules/IndependentGameUI';
import { gameAudio } from '../../src/game/GameAudio';
import type { VolcanicPlinkoUI } from '../../src/ui/VolcanicPlinkoUI';

// Served only by the local verification server; never a production entry point.
gameAudio.install();
const preview = document.querySelector<HTMLElement>('#preview')!;
const width = Number(new URL(location.href).searchParams.get('width'));
if (width >= 300 && width <= 1900) preview.style.width = width + 'px';
let view: IndependentGameUI | undefined, instance: VolcanicPlinkoUI | undefined;
function open() {
  view?.destroy(); instance = undefined;
  view = new IndependentGameUI(preview, 'royal-plinko', { onMounted(game) { instance = game as unknown as VolcanicPlinkoUI; } });
}
document.querySelector<HTMLButtonElement>('#open')!.onclick = open;
document.querySelector<HTMLButtonElement>('#close')!.onclick = () => { view?.destroy(); view = undefined; instance = undefined; preview.replaceChildren(); };
document.querySelector<HTMLButtonElement>('#small')!.onclick = () => instance?.previewPortraitWin(2);
document.querySelector<HTMLButtonElement>('#win')!.onclick = () => instance?.previewPortraitWin(3);
setInterval(() => {
  const state = instance?.getState();
  document.querySelector('nav output')!.textContent = state ? `${preview.dataset.gameModuleVersion}; ${JSON.stringify(state.portrait)}` : 'Module not mounted';
}, 100);
open();
