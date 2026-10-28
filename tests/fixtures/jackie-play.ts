import {IndependentGameUI} from '../../src/modules/IndependentGameUI';
import {demoWallet} from '../../src/wallet/WalletClient';
import {gameAudio} from '../../src/game/GameAudio';
const host=document.querySelector<HTMLElement>('#preview')!;let view:IndependentGameUI|undefined;
const open=()=>{view?.destroy();view=new IndependentGameUI(host,'original-jackie-chan');};
try{const response=await fetch('/__jackie/setup',{method:'POST',credentials:'same-origin'});const result=await response.json();if(!response.ok)throw Error(result.error);gameAudio.install();demoWallet.setAccount(result.account.id);open();}catch(e){host.textContent=(e as Error).message;}
document.querySelector<HTMLButtonElement>('#reopen')!.onclick=open;
window.addEventListener('pagehide',()=>view?.destroy());
