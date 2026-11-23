import { createSlotActions, type SlotPresentationActions } from './actions.ts';
import { createDemoServices, scenarios, type Scenario } from './demo-services.ts';
import { mountPaylineEditor } from './payline-editor.ts';
import { mountSlot, type ReelView } from './view.ts';

const lab = mountPaylineEditor(document.querySelector<HTMLElement>('#payline-lab')!);
const select = document.querySelector<HTMLSelectElement>('#scenario')!;
const host = document.querySelector<HTMLElement>('#slot')!;
const highlightWin: NonNullable<SlotPresentationActions<ReelView>['win']> = (event, signal) => {
  host.dataset.slotPresentation = event.type;
  signal.addEventListener('abort', () => { delete host.dataset.slotPresentation; }, { once: true });
};
const effects: SlotPresentationActions<ReelView> = { win: highlightWin, bigwin: highlightWin };
select.replaceChildren(...Object.entries(scenarios).map(([id, name]) => new Option(name, id)));
select.value = 'bonus';
let slot: ReturnType<typeof mountSlot> | undefined;
function mountDemo() {
  slot?.destroy();
  const services = createDemoServices(select.value as Scenario, lab.read);
  slot = mountSlot(host, services, createSlotActions(services, { bigWinMultiplier: 20 }), effects);
}
select.onchange = mountDemo;
document.querySelector<HTMLButtonElement>('#reset')!.onclick = mountDemo;
mountDemo();
