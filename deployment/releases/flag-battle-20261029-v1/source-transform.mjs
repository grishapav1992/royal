import assert from 'node:assert/strict';
const flagImport="import { FLAG_GAME, supportsFlagRules, flagModeInfo, flagViewMode, validFlagSettings, validFlagSession, validFlagStake, flagPayout, type FlagSettings } from '../src/shared/flagBattle';\nimport { startFlagBattle } from './games/flagBattle';\n";
const flagRules="  [FLAG_GAME]:'12 / 24 / 48 стран. Равные шансы. Выплаты 11,52 / 23,04 / 46,08 включают ставку. RTP 96%.',";
/** Add Flag Battle to reviewed inputs without changing any existing game branch. */
export function addFlag(file,original){
 let s=original;assert(!s.includes('FLAG_GAME'),file+' already contains Flag Battle');
 const replace=(a,b)=>{assert(s.includes(a),file+': missing '+a.slice(0,80));s=s.replaceAll(a,b);};
 if(file==='server/demoExpansion.ts'){
  s=flagImport+s;
  replace(' = {...STUDIO_MAX',' = {[FLAG_GAME]:48,...STUDIO_MAX');
  replace('(game:ExpansionGameId,version:1|2|3|4) => game===','(game:ExpansionGameId,version:1|2|3|4,settings?:unknown) => game===FLAG_GAME&&validFlagSettings(settings)?flagModeInfo(settings.flags.mode??\'classic\').count:game===');
  replace('expansionMax(s.gameId,s.rulesVersion)','expansionMax(s.gameId,s.rulesVersion,s.settings)');
  replace('expansionMax(op.gameId,expansionRulesVersion(op.gameId))','expansionMax(op.gameId,expansionRulesVersion(op.gameId),op.settings)');
  replace("    if(s.gameId===PENALTY_GAME&&!validPenaltySettlement", "    if(s.gameId===FLAG_GAME&&!validFlagSession(this.public(s)))throw Error('Invalid Flag Battle settlement');\n    if(s.gameId===PENALTY_GAME&&!validPenaltySettlement");
  let methods=0;s=s.split('\n').map(line=>{if(/^  (private async sessions|async active|async operate)\(/.test(line)){methods++;return line.replace('){',',flagClient:boolean|2=true){');}return line;}).join('\n');assert.equal(methods,3);
  s=s.replace(/this\.sessions\(([^()\n]*)\)/g,(_m,args)=>'this.sessions('+args+',flagClient)');
  s=s.split('\n').map(line=>line.startsWith('    return rows.map(')?line.slice(0,-1)+'.filter(s=>s.gameId!==FLAG_GAME||supportsFlagRules(flagClient,s.rulesVersion));':line).join('\n');
  replace('const op=structuredClone(value),key=JSON.stringify(op);',"const op=structuredClone(value),key=JSON.stringify(op);\n    if(op.gameId===FLAG_GAME&&(!flagClient||op.action==='start'&&validFlagSettings(op.settings)&&op.settings.flags.mode!==undefined&&flagClient!==2))throw new WalletError(409,'Refresh for Flag Battle modes');");
  replace("if(op.action==='start'&&!(op.gameId===","if(op.action==='start'&&!(op.gameId===FLAG_GAME?validFlagStake(op.stakeUnits):op.gameId===");
  replace('if(session.gameId===NEOPOLIS_GAME&&!supportsNeopolis',"if(session.gameId===FLAG_GAME&&!supportsFlagRules(flagClient,session.rulesVersion))throw new WalletError(409,'Refresh for Flag Battle modes');\n        if(session.gameId===NEOPOLIS_GAME&&!supportsNeopolis");
  replace('debit=cost;\n        if(',"debit=cost;\n        if(op.gameId===FLAG_GAME){\n          const flags=startFlagBattle(op.settings as FlagSettings,op.stakeUnits,this.draw);\n          s.rulesVersion=flags.version;s.state='settled';s.view={...emptyView(),flags,ended:true,message:'Flag Battle complete'};\n          credit=flags.order.at(-1)===flags.country?Number(flagPayout(op.stakeUnits,flagViewMode(flags))):0;\n        }else if(");
 }else if(file==='src/shared/casinoExpansion.ts'){
  s="import {FLAG_GAME,validFlagSettings,type FlagSettings,type FlagView} from './flagBattle';\n"+s;
  s=s.split('\n').map(l=>l.startsWith('export const EXPANSION_GAMES = ')?l.replace('] as const;',',FLAG_GAME] as const;'):l).join('\n');
  replace('export const EXPANSION_NAMES: Record<ExpansionGameId,string> = {',"export const EXPANSION_NAMES: Record<ExpansionGameId,string> = {\n  [FLAG_GAME]:'Флажочки',");
  replace('export const EXPANSION_RULES: Record<ExpansionGameId,string> = {','export const EXPANSION_RULES: Record<ExpansionGameId,string> = {\n'+flagRules);
  replace('game===AFTER_GAME||isNitroFamily(game)','game===FLAG_GAME||game===AFTER_GAME||isNitroFamily(game)');
  replace(' | PenaltySettings',' | FlagSettings | PenaltySettings');
  replace('export type ExpansionView = {','export type ExpansionView = {flags?:FlagView;');
  replace('if(r.gameId===PENALTY_GAME)return validPenaltySettings',"if(r.gameId===FLAG_GAME)return validFlagSettings(r.settings);\n    if(r.gameId===PENALTY_GAME)return validPenaltySettings");
  replace("if(r.gameId===PENALTY_GAME)return ['penalty-kick'","if(r.gameId===FLAG_GAME)return false;\n  if(r.gameId===PENALTY_GAME)return ['penalty-kick'");
 }else if(file==='server/finance/nile-game-runtime.ts'){
  replace('legacy?:{wardrobe:AfterWardrobe','flagRules?:0|1|2;legacy?:{wardrobe:AfterWardrobe');
  replace("key!=='neopolisRules'","key!=='neopolisRules'&&key!=='flagRules'");
  replace('||c.neopolisRules!==undefined&&![0,1,2,3,4].includes(c.neopolisRules)','||c.flagRules!==undefined&&![0,1,2].includes(c.flagRules)||c.neopolisRules!==undefined&&![0,1,2,3,4].includes(c.neopolisRules)');
  s=s.split('\n').map(l=>l.includes("case '/expansion':result=")?l.replace(');break;',',c.flagRules===2?2:c.flagRules===1);break;'):l).join('\n');
  for(const version of [1,2])replace(`expansionMax(op.gameId,${version})`,`expansionMax(op.gameId,${version},op.settings)`);
 }else throw Error('Unsupported projection '+file);
 return s;
}
