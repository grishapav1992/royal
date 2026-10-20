import {SlotAudio} from './slotKit/SlotAudio';
import {caramelSlot} from './slotKit/nativeSlots';

export class CaramelCarnivalAudio extends SlotAudio {
  constructor() { super(caramelSlot.audio); }
}
