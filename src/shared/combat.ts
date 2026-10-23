import { COMBAT_USDT_STAKES } from './combatEscrow';
export const COMBAT_STAKES = COMBAT_USDT_STAKES;
export const COMBAT_FEE_PERCENT = 5;
export type CombatInput = { left:boolean; right:boolean; jump:boolean; punch:boolean; kick:boolean; block:boolean };
export const neutralCombatInput = ():CombatInput => ({left:false,right:false,jump:false,punch:false,kick:false,block:false});
export type Fighter = { x:number; y:number; vy:number; health:number; action:'stand'|'walking'|'jumping'|'high-punch'|'high-kick'|'blocking'|'endure'|'fall'; actionTime:number; cooldown:number; stun:number; input:CombatInput; inputAt:number; inputSequence:number };
export type CombatState = {
 id:string; players:string[]; names:string[]; ready:string[]; stake:number;
 phase:'waiting'|'funding'|'countdown'|'playing'|'settling'|'finished';
 fighters:Fighter[]; remaining:number; countdown:number; winner:string; winnerName:string; message:string;
 pot:number; fee:number; payout:number; revision:number; hitSeq:number;
};
export const freshCombatState = (id=''):CombatState => ({
 id,players:[],names:[],ready:[],stake:1,phase:'waiting',fighters:[],
 remaining:90,countdown:3,winner:'',winnerName:'',message:'',pot:0,fee:0,payout:0,revision:0,hitSeq:0,
});
