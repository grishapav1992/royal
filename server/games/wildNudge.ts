import {randomInt} from 'node:crypto';
import {startWildNudgeRound,moveWildNudgeRound} from '../../src/shared/wildNudge';
import type {WildNudgeRandom} from '../../src/shared/wildNudgeMath';
export const startWildNudge=(settings:unknown,stakeUnits:unknown,draw:WildNudgeRandom=randomInt)=>startWildNudgeRound(settings,stakeUnits,draw);
export const moveWildNudge=(view:unknown,stakeUnits:string,revision:unknown,move:unknown,draw:WildNudgeRandom=randomInt)=>moveWildNudgeRound(view,stakeUnits,revision,move,draw);
