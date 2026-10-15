import { validNilePlayWallet, validNileRound, validNileRoundRequest, type NilePlayWallet, type NilePlayResult, type NileRoundRequest } from '../shared/nilePlay';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';

const inviteKey='royal-nile-invite';
const fragment=new URLSearchParams(location.hash.slice(1)), supplied=fragment.get('nile-invite');
if (supplied && /^[a-zA-Z0-9_-]{43}$/.test(supplied)) {
  try {sessionStorage.setItem(inviteKey,supplied);}catch { /* The form still accepts a manually entered code. */ }
  fragment.delete('nile-invite');history.replaceState(null,'',location.pathname+location.search+(fragment.size?'#'+fragment.toString():''));
}
export function nileInviteCode() {try{return sessionStorage.getItem(inviteKey)??'';}catch{return '';}}
export class NilePlayClient extends EventTarget {
  accountId:string|null=null;wallet?:NilePlayWallet;pending?:NileRoundRequest;busy=false;error='';
  private epoch=0;private version=0;
  private key(){return 'royal-nile-round:'+this.accountId;}
  private notify(){this.dispatchEvent(new Event('change'));}
  setAccount(id:string|null){
    if(id===this.accountId)return;
    this.epoch++;this.version++;this.accountId=id;this.wallet=undefined;this.pending=undefined;this.busy=false;this.error='';
    if(id){try{const value=sessionStorage.getItem(this.key());if(value){const parsed=JSON.parse(value);if(!validNileRoundRequest(parsed))throw new Error();this.pending=parsed;}}catch{this.error='Не удалось восстановить незавершённую тестовую ставку.';} void this.refresh();}
    this.notify();
  }
  async refresh(){
    if(!this.accountId)return;
    const epoch=this.epoch,version=++this.version,accountId=this.accountId;this.wallet=undefined;this.notify();
    try{
      const response=await fetch('/api/nile-play/wallet',{credentials:'same-origin',headers:{[WALLET_ACCOUNT_HEADER]:accountId},cache:'no-store',signal:AbortSignal.timeout(10000)});
      const wallet=await response.json();if(!response.ok)throw new Error(wallet.error);
      if(!validNilePlayWallet(wallet))throw new Error('Некорректный ответ тестового кошелька.');
      if(epoch!==this.epoch||version!==this.version)return;this.wallet=wallet;this.error='';
    }catch(e){if(epoch!==this.epoch||version!==this.version)return;this.wallet=undefined;this.error=this.message(e,'Не удалось подтвердить тестовый баланс. Обнови его позже.');}
    this.notify();
  }
  private message(e:unknown,fallback:string){return e instanceof Error&&/[а-я]/i.test(e.message)?e.message:fallback;}
  async deposit(){
    if(!this.accountId||this.busy)throw new Error('Войди в аккаунт и дождись завершения операции.');
    const epoch=this.epoch,accountId=this.accountId;this.busy=true;this.version++;this.notify();
    try{
      const response=await fetch('/api/nile-play/deposit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:accountId},body:'{}',signal:AbortSignal.timeout(15000)});
      const wallet=await response.json();if(!response.ok)throw new Error(wallet.error);
      if(!validNilePlayWallet(wallet)||wallet.state!=='assigned')throw new Error('Не удалось подтвердить адрес пополнения.');
      if(epoch!==this.epoch)throw new Error('Аккаунт изменился. Открой пополнение после входа.');
      this.wallet=wallet;this.error='';return wallet;
    }finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
  }
  async claim(code:string){
    if(!this.accountId||this.busy)throw new Error('Сначала войди в аккаунт и дождись завершения операции.');
    const epoch=this.epoch,accountId=this.accountId;this.busy=true;this.version++;this.notify();
    try{
      const response=await fetch('/api/nile-play/claim',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:accountId},body:JSON.stringify({code}),signal:AbortSignal.timeout(15000)});
      const wallet=await response.json();if(!response.ok)throw new Error(wallet.error);
      if(!validNilePlayWallet(wallet)||wallet.state!=='assigned')throw new Error('Кошелёк не подтверждён.');
      if(epoch!==this.epoch)throw new Error('Аккаунт изменился. Проверь кошелёк после входа.');
      this.wallet=wallet;this.error='';try{sessionStorage.removeItem(inviteKey);}catch{}
    }finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
  }
  async spin(stakeUnits:string):Promise<NilePlayResult>{
    if(!this.accountId)throw new Error('Войди в аккаунт, чтобы играть на тестовый USDT.');
    if(this.busy)throw new Error('Дождись завершения операции.');
    if(this.pending&&this.pending.stakeUnits!==stakeUnits)throw new Error('Сначала проверь результат предыдущей ставки.');
    const operation=this.pending??{id:crypto.randomUUID(),stakeUnits};
    if(!validNileRoundRequest(operation))throw new Error('Некорректная тестовая ставка.');
    try{sessionStorage.setItem(this.key(),JSON.stringify(operation));}catch{throw new Error('Для сохранения ставки разреши хранилище браузера.');}
    const epoch=this.epoch,key=this.key(),accountId=this.accountId;this.pending=operation;this.busy=true;this.version++;this.error='';this.notify();
    try{
      const response=await fetch('/api/nile-play/rounds',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:accountId},body:JSON.stringify(operation),signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if(epoch!==this.epoch)throw new Error('Аккаунт изменился. Проверь результат после входа.');
      if(!response.ok){
        if([400,409].includes(response.status)){this.pending=undefined;sessionStorage.removeItem(key);}
        throw new Error(result.error);
      }
      if(!validNilePlayWallet(result.wallet)||!validNileRound(result.round)||result.round.id!==operation.id||result.round.stakeUnits!==operation.stakeUnits||typeof result.replayed!=='boolean')throw new Error('Ответ ставки не подтверждён. Повтори проверку операции.');
      this.wallet=result.wallet;this.pending=undefined;sessionStorage.removeItem(key);this.version++;return result;
    }catch(e){const message=this.message(e,'Ответ не получен. Нажми «Проверить результат»: повторного списания не будет.');if(epoch===this.epoch)this.error=message;throw new Error(message);}
    finally{if(epoch===this.epoch){this.busy=false;this.notify();}}
  }
}
export const nilePlay=new NilePlayClient();
