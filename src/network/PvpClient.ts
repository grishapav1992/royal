import { validPvpRequest, validVirtualPvpWallet, VIRTUAL_PVP_SCOPE, type PvpRequest, type PvpSnapshot } from '../shared/pvp';
import { validNilePlayWallet } from '../shared/nilePlay';

export class PvpClient extends EventTarget {
  snapshot?:PvpSnapshot;
  pending?:PvpRequest;
  error='';accountId:string|null=null;connected=false;
  private receivedAt=performance.now();
  now(){return this.snapshot?this.snapshot.now+performance.now()-this.receivedAt:Date.now();}
  constructor(private transport:(value:PvpRequest)=>boolean){super();}
  private key(){return 'royal-pvp-virtual-request:'+this.accountId;}
  private notify(){this.dispatchEvent(new Event('change'));}
  setAccount(id:string|null){
    if(id===this.accountId)return;this.accountId=id;this.snapshot=undefined;this.pending=undefined;this.error='';
    if(id)try{const saved=sessionStorage.getItem(this.key());if(saved){const op=JSON.parse(saved);if(!validPvpRequest(op))throw Error();this.pending=op;}}catch{this.error='Не удалось восстановить действие. Обнови список поединков.';}
    this.notify();
  }
  setConnected(value:boolean){this.connected=value;if(value&&this.pending)this.transport(this.pending);this.notify();}
  receive(value:PvpSnapshot){
    if(!this.accountId||!value||!Array.isArray(value.challenges)||!Array.isArray(value.people)||!validVirtualPvpWallet(value.wallet))return;
    const previous=this.snapshot;
    if(previous?.active&&value.active?.id===previous.active.id&&value.active.revision<previous.active.revision)value={...value,active:previous.active,cards:previous.cards};
    this.receivedAt=performance.now();this.snapshot=value;
    if(value.requestId===this.pending?.id){sessionStorage.removeItem(this.key());this.pending=undefined;this.error='';}
    this.notify();
  }
  rejected(value:{requestId:string;error:string;rejected:boolean}){
    if(value.requestId!==this.pending?.id)return;
    this.error=value.error;
    if(value.rejected){sessionStorage.removeItem(this.key());this.pending=undefined;}
    this.notify();
  }
  send(op:PvpRequest){
    op={...op,walletScope:VIRTUAL_PVP_SCOPE};
    if(!this.accountId||!this.connected)throw Error('Войди в онлайн-зал, чтобы играть с соперником.');
    if(this.pending)throw Error('Сначала проверь предыдущее действие.');
    if(!validPvpRequest(op))throw Error('Некорректное действие.');
    try{sessionStorage.setItem(this.key(),JSON.stringify(op));}catch{throw Error('Для сохранения ставки разреши хранилище браузера.');}
    this.pending=structuredClone(op);this.error='';
    this.transport(this.pending);this.notify();
  }
  retry(){if(this.pending&&this.connected)this.transport(this.pending);}
}
