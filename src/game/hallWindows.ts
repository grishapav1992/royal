import {CAT_HOME} from '../shared/catHome';

// One raised row keeps every frame aligned with the cat's window and perch.
export const HALL_WINDOWS = {top:CAT_HOME.window.y-59,width:200,height:128,spacing:300} as const;
export const HALL_WINDOW_XS = Array.from({length:14},(_,i)=>CAT_HOME.window.x+(i-4)*HALL_WINDOWS.spacing);
export const HALL_WINDOW_DIVIDERS = Array.from({length:HALL_WINDOW_XS.length+1},(_,i)=>HALL_WINDOW_XS[0]-HALL_WINDOWS.spacing/2+i*HALL_WINDOWS.spacing);
