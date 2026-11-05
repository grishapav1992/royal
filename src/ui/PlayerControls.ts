import type { RoomScene } from '../game/RoomScene';

/** Account and wallet controls do not require a rendered world. */
export type PlayerControls = Pick<RoomScene, 'setLocked' | 'getReducedMotion' | 'onAtelier' | 'onToiletMerchant' | 'onNotice'> & { presentation?: 'club' | 'casino' };
