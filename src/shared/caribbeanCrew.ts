/** Cosmetic account progress. No wager, wallet conversion, random draw or payout. */
export const CREW_IDS=['isabella','amara','mei','priya','yasmin','zahara','catalina','moana','freya','rowan','ines'] as const;
export type CaribbeanCrewId=typeof CREW_IDS[number];
export const CREW_UNLOCK_COST=100;
export type CrewText={ru:string;en:string};
export type CrewChallenge={id:string;kind:'lesson'|'daily';reward:number;title:CrewText;question:CrewText;options:{id:string;text:CrewText}[];completed:boolean};
export type CrewCollection={version:1;accountId:string;revision:number;day:string;nextResetAt:number;tokens:number;unlockCost:number;owned:CaribbeanCrewId[];selected:CaribbeanCrewId;challenges:CrewChallenge[];receipt?:{requestId:string;reward:number;unlocked?:CaribbeanCrewId}};
export type CrewRequest={id:string;action:'unlock'|'select';characterId:string}|{id:string;action:'answer';challengeId:string;day:string;answer:string};
export function isCrewId(id:unknown):id is CaribbeanCrewId{return typeof id==='string'&&(CREW_IDS as readonly string[]).includes(id);}
export function crewDay(now:number){return new Date(now+3*60*60*1000).toISOString().slice(0,10);}
