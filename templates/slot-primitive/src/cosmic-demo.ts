import { createSlotActions } from './actions.ts';
import { createCosmicDemo, cosmicScenarios, type CosmicScenario } from './cosmic/demo-services.ts';
import { mountCosmic } from './cosmic/entry.ts';

const scene = document.querySelector<HTMLSelectElement>('#cosmic-scenario')!;
const size = document.querySelector<HTMLSelectElement>('#cosmic-size')!;
const host = document.querySelector<HTMLElement>('#cosmic-host')!;
const reopen = document.querySelector<HTMLButtonElement>('#cosmic-reopen')!;
scene.replaceChildren(...Object.entries(cosmicScenarios).map(([id, label]) => new Option(label, id)));
let slot: ReturnType<typeof mountCosmic> | undefined;
let demo: ReturnType<typeof createCosmicDemo>;

function open() {
  const { services } = demo;
  slot = mountCosmic(host, services, createSlotActions(services));
  reopen.textContent = 'Закрыть экран';
}
function reset() {
  slot?.destroy();
  demo = createCosmicDemo(scene.value as CosmicScenario, () => new Promise(resolve => setTimeout(resolve, 140)));
  open();
}
scene.onchange = reset;
size.onchange = () => { host.dataset.preset = size.value; };
document.querySelector<HTMLButtonElement>('#cosmic-reset')!.onclick = reset;
reopen.onclick = () => {
  if (!slot) { open(); return; }
  slot.destroy(); slot = undefined; reopen.textContent = 'Открыть экран';
};
reset();
