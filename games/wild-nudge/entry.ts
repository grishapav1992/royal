import type {GameModuleV1} from '../../src/modules/GameHostContract';
import {GalacticReactorUI} from './GalacticReactorUI';
import './reactor.css';
export const gameId='studio-wild-nudge';
export const apiVersion=1;
export const rulesVersion=1;
export const progressVersion=1;
export const mount:GameModuleV1['mount']=(host,context)=>{const game=new GalacticReactorUI(host);context?.setTitle?.(game.title);return game;};
