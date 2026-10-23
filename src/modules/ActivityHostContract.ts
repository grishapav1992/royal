import type { RoomScene } from '../game/RoomScene';
import type { PianoAudio } from '../game/PianoAudio';
import type { ActivitiesState, PianoNote } from '../shared/activities';
import type { PlayerView } from '../shared/world';

/** The room keeps network membership and shared piano sound while views can close. */
export interface ActivityHostContext {
 scene: Pick<RoomScene, 'hall' | 'player' | 'setLocked' | 'pianoNote'>;
 send(value: unknown): void;
 state: ActivitiesState;
 players: PlayerView[];
 self: string;
 pianoAudio: PianoAudio;
 shotPower?: number;
 onClose(): void;
}
export interface ActivityModuleView {
 update(state: ActivitiesState): void;
 updatePlayers(players: PlayerView[], self: string): void;
 receive(note: PianoNote): void;
 hallChanged(): void;
 connected(): void;
 disconnected(): void;
 getState(): unknown;
 destroy(): void;
}
