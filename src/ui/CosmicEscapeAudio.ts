import {SlotAudio} from './slotKit/SlotAudio';
import {cosmicSlot} from './slotKit/nativeSlots';

export class CosmicEscapeAudio extends SlotAudio {
  constructor() { super(cosmicSlot.audio); }
}
