import {STUDIO_INFO,studioStrip} from '../shared/studioGames';
import {clusterSymbol,CLUSTER_SYMBOL_NAMES,type ClusterGame} from './ClusterArtwork';
type Reel={root:HTMLElement;track:HTMLElement;cells:HTMLElement[];offset:number;stopped:boolean;stop?:{at:number;from:number;target:number}};
const ACCELERATE=350,MIN_SPIN=850,STOP=530,GAP=155;

/** Each paid or free stage spins a complete new six-column grid. */
export class ClusterBoard {
  private reels:Reel[];private rows:number;private cols:number;private items:number;
  private frame=0;private token='';private began=0;private stopAt=0;private moving=false;private phase='';
  private shown:number[];private final?:number[];private resolve?:(completed:boolean)=>void;
  constructor(private host:HTMLElement,private game:ClusterGame,private callbacks:{phase:(value:'accelerating'|'spinning'|'stopping')=>void;stop:(index:number)=>void}){
    const info=STUDIO_INFO[game];this.rows=info.rows;this.cols=info.cols;this.items=this.rows*2+12;
    this.shown=Array.from({length:this.cols*this.rows},(_,i)=>(i+Math.floor(i/this.cols))%3);
    host.style.setProperty('--cluster-cols',String(this.cols));host.style.setProperty('--cluster-rows',String(this.rows));host.style.setProperty('--cluster-items',String(this.items));
    this.reels=Array.from({length:this.cols},(_,col)=>{
      const root=document.createElement('div');root.className='cluster-reel';root.dataset.clusterReel=String(col);root.dataset.state='stopped';
      const track=document.createElement('div');track.className='cluster-track';track.dataset.clusterTrack='';track.setAttribute('aria-hidden','true');
      const result=document.createElement('div');result.className='cluster-static';
      const cells=Array.from({length:this.rows},(_,row)=>{const cell=document.createElement('div');cell.className='cluster-cell';cell.dataset.clusterCell=String(row*this.cols+col);cell.setAttribute('role','img');result.append(cell);return cell;});
      root.append(track,result);host.append(root);return {root,track,cells,offset:0,stopped:true};
    });this.show(this.shown);
  }
  private setCell(cell:HTMLElement,symbol:number){cell.dataset.symbol=String(symbol);cell.innerHTML=clusterSymbol(this.game,symbol);cell.setAttribute('aria-label',`Ячейка ${Number(cell.dataset.clusterCell)+1}: ${CLUSTER_SYMBOL_NAMES[this.game][symbol]}`);}
  show(grid:readonly number[]){this.shown=[...grid];this.reels.forEach((reel,col)=>{reel.root.dataset.state='stopped';reel.cells.forEach((cell,row)=>this.setCell(cell,grid[row*this.cols+col]));});}
  values(values:readonly {position:number;value:number}[],animate=false){this.host.querySelectorAll('[data-cluster-value]').forEach(node=>node.remove());for(const item of values){const cell=this.host.querySelector<HTMLElement>(`[data-cluster-cell="${item.position}"]`);if(!cell)continue;const badge=document.createElement('span');badge.className=animate?'cluster-value revealing-value':'cluster-value';badge.dataset.clusterValue=String(item.position);badge.dataset.value=String(item.value);badge.textContent=String(item.value);badge.setAttribute('aria-label',`Сила ячейки ${item.value}`);cell.append(badge);}}
  collect(collector:number,coins:readonly {position:number;rawValue:number}[]){this.clearCollect();const target=this.host.querySelector<HTMLElement>(`[data-cluster-cell="${collector}"]`);target?.classList.add('collector-active');const layer=document.createElement('div');layer.className='cluster-collect-layer';layer.dataset.clusterCollectLayer=String(collector);layer.setAttribute('aria-hidden','true');for(const coin of coins){const node=document.createElement('div');node.className='cluster-collected-seed';node.dataset.clusterCollectedSeed=String(coin.position);node.dataset.collector=String(collector);node.style.left=`${coin.position%this.cols/this.cols*100}%`;node.style.top=`${Math.floor(coin.position/this.cols)/this.rows*100}%`;node.style.width=`${100/this.cols}%`;node.style.height=`${100/this.rows}%`;node.style.setProperty('--collect-x',`${(collector%this.cols-coin.position%this.cols)*100}%`);node.style.setProperty('--collect-y',`${(Math.floor(collector/this.cols)-Math.floor(coin.position/this.cols))*100}%`);node.innerHTML=clusterSymbol(this.game,5);layer.append(node);}this.host.append(layer);}
  clearCollect(){this.host.querySelectorAll('[data-cluster-collect-layer]').forEach(node=>node.remove());this.host.querySelectorAll('.collector-active').forEach(node=>node.classList.remove('collector-active'));}
  begin(token:string,motion:boolean){this.cancel();this.token=token;this.began=performance.now();this.stopAt=0;this.final=undefined;this.phase='';this.moving=motion;if(!motion)return;
    this.reels.forEach((reel,col)=>{const strip=studioStrip(this.game,col);reel.track.innerHTML=Array.from({length:this.items},(_,i)=>`<div class="cluster-track-symbol">${clusterSymbol(this.game,i<this.rows?this.shown[i*this.cols+col]:strip[(i-this.rows)%6])}</div>`).join('');reel.offset=0;reel.stop=undefined;reel.stopped=false;reel.root.dataset.state='moving';reel.track.style.transform='translate3d(0,0,0)';});this.setPhase('accelerating');this.frame=requestAnimationFrame(this.tick);
  }
  settle(token:string,grid:readonly number[]){if(token!==this.token)return Promise.resolve(false);if(!this.moving){this.show(grid);return Promise.resolve(true);}this.final=[...grid];this.stopAt=Math.max(performance.now(),this.began+MIN_SPIN);return new Promise<boolean>(resolve=>{this.resolve=resolve;});}
  private setPhase(value:'accelerating'|'spinning'|'stopping'){if(this.phase!==value){this.phase=value;this.callbacks.phase(value);}}
  private tick=(now:number)=>{if(!this.moving)return;const elapsed=Math.max(0,now-this.began),distance=elapsed<ACCELERATE?14*elapsed**2/(2*ACCELERATE*1000):14*(elapsed-ACCELERATE/2)/1000;if(elapsed>=ACCELERATE&&this.phase==='accelerating')this.setPhase('spinning');
    this.reels.forEach((reel,col)=>{if(reel.stopped)return;if(!reel.stop&&this.final&&now>=this.stopAt+col*GAP){const target=Math.ceil(reel.offset+5);reel.stop={at:now,from:reel.offset,target};reel.root.dataset.state='stopping';this.setPhase('stopping');for(let row=0;row<this.rows;row++)(reel.track.children[target+row] as HTMLElement).innerHTML=clusterSymbol(this.game,this.final[row*this.cols+col]);}
      if(reel.stop){const progress=Math.max(0,Math.min(1,(now-reel.stop.at)/STOP));reel.offset=reel.stop.from+(reel.stop.target-reel.stop.from)*Math.sin(progress*Math.PI/2);if(progress===1){reel.stopped=true;reel.root.dataset.state='stopped';reel.cells.forEach((cell,row)=>this.setCell(cell,this.final![row*this.cols+col]));this.callbacks.stop(col);}}
      else reel.offset=distance<this.rows?distance:this.rows+(distance-this.rows)%6;reel.track.style.transform=`translate3d(0,${-reel.offset/this.items*100}%,0)`;
    });if(this.final&&this.reels.every(reel=>reel.stopped)){this.moving=false;this.shown=[...this.final];this.frame=0;const resolve=this.resolve;this.resolve=undefined;resolve?.(true);}else this.frame=requestAnimationFrame(this.tick);
  };
  cancel(){cancelAnimationFrame(this.frame);this.frame=0;this.moving=false;this.token='';this.final=undefined;const resolve=this.resolve;this.resolve=undefined;resolve?.(false);this.clearCollect();this.show(this.shown);}
  destroy(){this.cancel();}
}
