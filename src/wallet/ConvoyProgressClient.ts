import { t as translateText } from '../i18n/index';
import {WALLET_ACCOUNT_HEADER} from '../shared/walletAccount';
import {validConvoyProgress,type ConvoyProgress} from '../shared/convoyWardrobe';

/** Read-only account progress. Cosmetic loading never holds a wallet operation. */
export class ConvoyProgressClient extends EventTarget{
  account:string|null=null;profile?:ConvoyProgress;loading=false;error='';
  private epoch=0;private again=false;private request?:AbortController;private disposed=false;
  private notify(){this.dispatchEvent(new Event('change'));}
  setAccount(account:string|null){
    if(this.disposed||this.account===account)return;
    this.epoch++;this.request?.abort();this.account=account;this.profile=undefined;this.loading=this.again=false;this.error='';this.notify();
    if(account)void this.refresh();
  }
  async refresh(){
    if(this.disposed||!this.account)return;
    if(this.loading){this.again=true;return;}
    const account=this.account,epoch=this.epoch,request=new AbortController();this.request=request;this.loading=true;this.notify();
    const timeout=setTimeout(()=>request.abort(),10000);
    try{
      const reply=await fetch('/api/game-wallet/convoy-progress',{credentials:'same-origin',cache:'no-store',headers:{[WALLET_ACCOUNT_HEADER]:account},signal:request.signal});
      const data:unknown=await reply.json();if(this.disposed||epoch!==this.epoch)return;
      if(!reply.ok||!validConvoyProgress(data))throw new Error('progress');
      this.profile=data;this.error='';
    }catch{if(!this.disposed&&epoch===this.epoch)this.error=translateText('Не удалось проверить прогресс. Открытые образы сохранены. Обнови данные игры.');}
    finally{
      clearTimeout(timeout);
      if(!this.disposed&&epoch===this.epoch){this.request=undefined;this.loading=false;this.notify();if(this.again){this.again=false;void this.refresh();}}
    }
  }
  destroy(){this.disposed=true;this.epoch++;this.request?.abort();this.request=undefined;this.again=false;}
}
