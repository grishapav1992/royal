import {SlotAudio} from './slotKit/SlotAudio';
import {velvetSlot} from './slotKit/nativeSlots';

export class VelvetReignAudio extends SlotAudio {
  constructor() { super(velvetSlot.audio); }
}
