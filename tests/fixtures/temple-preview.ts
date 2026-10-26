import {IndependentGameUI} from '../../src/modules/IndependentGameUI';
import {demoWallet} from '../../src/wallet/WalletClient';
import {expansionClient} from '../../src/wallet/ExpansionClient';
import {language} from '../../src/i18n/index';
import {validTempleSession} from '../../src/shared/floodedTemple';
let game:IndependentGameUI;
const host=document.querySelector<HTMLElement>('#preview')!;
const open=()=>{game?.destroy();game=new IndependentGameUI(host,'studio-flooded-temple');};
async function start(){
  document.querySelector('#review-label')!.textContent=language==='en'?'Local prototype · Separate test database':'Локальный прототип · отдельная тестовая база';
  let account=(await(await fetch('/api/auth/me')).json()).account;
  if(!account){
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'temple-local-'+crypto.randomUUID()+'@example.test',password:'Temple-local-review-42!'})});
    if(!response.ok)throw Error('Test account could not be created');account=(await response.json()).account;
    const deposit=await fetch('/api/demo-wallet/operations',{method:'POST',headers:{'Content-Type':'application/json','X-Royal-Account-Id':account.id},body:JSON.stringify({id:crypto.randomUUID(),kind:'deposit',amount:10000})});
    if(!deposit.ok)throw Error('Local demo deposit failed');
  }
  demoWallet.setAccount(account.id);await demoWallet.refresh();expansionClient.setAccount(account.id);await expansionClient.refresh();open();
  (window as any).templePreview={open,close:()=>game.destroy(),state:()=>game.getState(),validate:validTempleSession,client:expansionClient,wallet:demoWallet,account:account.id};
  document.querySelector('#reopen')!.addEventListener('click',open);
}
void start().catch(error=>{host.textContent=String(error);});
