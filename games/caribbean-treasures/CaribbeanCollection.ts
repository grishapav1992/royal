import {WALLET_ACCOUNT_HEADER} from '../../src/shared/walletAccount';
import {isCrewId,type CrewCollection,type CrewRequest} from '../../src/shared/caribbeanCrew';
export async function crewCollection(account:string,signal:AbortSignal,request?:CrewRequest):Promise<CrewCollection>{
 const timeout=new AbortController(),abort=()=>timeout.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(abort,10000);
 try{
 const response=await fetch('/api/caribbean-crew',{method:request?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:timeout.signal,headers:{[WALLET_ACCOUNT_HEADER]:account,...(request?{'Content-Type':'application/json'}:{})},...(request?{body:JSON.stringify(request)}:{})});
 const data=await response.json();if(!response.ok)throw Error(typeof data.error==='string'?data.error:'collection-unavailable');
 if(data.version!==1||data.accountId!==account||!Number.isSafeInteger(data.tokens)||data.tokens<0||!Array.isArray(data.owned)||!data.owned.every(isCrewId)||!data.owned.includes(data.selected)||!Array.isArray(data.challenges))throw Error('collection-unavailable');
 return data;
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export const crewErrors:Record<string,[string,string]>={
 'incorrect-answer':['Попробуй другой ответ. Жетоны начисляются за верное решение.','Try another answer. A correct solution earns the tokens.'],
 'not-enough-tokens':['Пока не хватает жетонов. Выполни бесплатные задания.','Not enough tokens yet. Complete free challenges.'],
 'captain-locked':['Сначала открой эту пиратку за жетоны.','Unlock this pirate with tokens first.'],
 'day-changed':['Начался новый день. Обнови задания.','A new day has started. Refresh the challenges.'],
 'account-changed':['Аккаунт изменился. Открой коллекцию ещё раз.','The account changed. Reopen the collection.'],
 'sign-in-required':['Войди в зал, чтобы сохранить коллекцию.','Sign in to save the collection.'],
};
