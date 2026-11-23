import { createSlotActions } from '../../templates/slot-primitive/src/actions.ts';
import { mountSlot } from '../../templates/slot-primitive/src/view.ts';
import '../../templates/slot-primitive/view.css';
import { readGameHost, type GameModuleV1 } from './GameHostContract';
import { createCaramelSlotServices } from './SlotPrimitiveCaramelBinding';

export { gameId, rulesVersion } from './SlotPrimitiveCaramelBinding';
export const apiVersion = 1;
export const progressVersion = 1;

export const mount: GameModuleV1['mount'] = root => {
  const services = createCaramelSlotServices(readGameHost());
  return mountSlot(root, services, createSlotActions(services));
};
