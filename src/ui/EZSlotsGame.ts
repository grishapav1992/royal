import {FruitsSlotUI} from './FruitsSlotUI';

// EZSlotsJS vendor code, Apache2.0 licence and NOTICE remain unchanged.
export class EZSlotsGame {
  private game:FruitsSlotUI;
  constructor(container:HTMLElement){this.game=new FruitsSlotUI(container,'royal-fruits');}
  destroy(){this.game.destroy();}
}
