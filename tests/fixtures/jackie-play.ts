import {IndependentGameUI} from '../../src/modules/IndependentGameUI';
import {demoWallet} from '../../src/wallet/WalletClient';
import {gameAudio} from '../../src/game/GameAudio';
import {expansionClient} from '../../src/wallet/ExpansionClient';
import {validModulePointer} from '../../src/modules/GameModuleManifest';
const host=document.querySelector<HTMLElement>('#preview')!;let view:IndependentGameUI|undefined;
const open=()=>{view?.destroy();view=new IndependentGameUI(host,'original-jackie-chan');};
(window as any).jackiePreview={state:()=>view?.getState()};
try{const response=await fetch('/__jackie/setup',{method:'POST',credentials:'same-origin'});const result=await response.json();if(!response.ok)throw Error(result.error);gameAudio.install();demoWallet.setAccount(result.account.id);open();}catch(e){host.textContent=(e as Error).message;}
document.querySelector<HTMLButtonElement>('#reopen')!.onclick=open;
// Only this disposable development preview follows rebuilt packages automatically.
// The production host deliberately keeps a mounted immutable version until closing.
let checking=false;
async function checkVersion(){
  if(checking||document.hidden)return;checking=true;
  try{
    const reply=await fetch('/game-modules/original-jackie-chan/active.json',{cache:'no-store'});
    if(!reply.ok)return;const pointer:unknown=await reply.json();
    if(!validModulePointer(pointer,'original-jackie-chan'))return;
    const current=host.dataset.gameModuleVersion,next=pointer.manifest.split('/')[4];
    if(!current)return;
    if(current===next){document.querySelector('#preview-version')!.textContent='Актуальная сборка · '+current.split('-').at(-1);return;}
    document.querySelector('#preview-version')!.textContent='Новая постановка готова. Обновим после текущего действия.';
    const state=view?.getState() as {busy?:boolean}|null;
    if(state?.busy||expansionClient.busy||expansionClient.loading||expansionClient.pending||demoWallet.busy||demoWallet.pending||host.querySelector('dialog[open]'))return;
    open();
  }catch{/* Keep the mounted game on a temporary local network error. */}
  finally{checking=false;}
}
const updates=setInterval(()=>void checkVersion(),2500);
window.addEventListener('pagehide',()=>{clearInterval(updates);view?.destroy();});
