import type Phaser from 'phaser';
import {STAIR_WINDOW} from '../shared/stairWindow';
import {ROOF_STAIR_ROUTE} from '../shared/rooftop';
import {StreetView} from './streetView';
import {rearWindowLayout} from './rearWindowLife';

export function stairWindowFrame(view:StreetView){
  const windows=rearWindowLayout(view.wall,view.roofEdge),rows=Math.max(...windows.map(w=>w.row))+1;
  return windows.find(w=>w.row===rows-STAIR_WINDOW.floor&&w.column===STAIR_WINDOW.column)!;
}

/** Replaces one existing card-salon window, preserving its flat wall geometry. */
export function drawCardStairWindow(scene:Phaser.Scene,leave:()=>void){
  const w=STAIR_WINDOW.interior,key='card-salon-open-escape-window-v1';
  scene.children.getByName('hall-window-github-'+w.x)?.destroy();
  if(!scene.textures.exists(key)){
    const canvas=document.createElement('canvas');canvas.width=w.width*2;canvas.height=w.height*2;
    const c=canvas.getContext('2d')!;c.scale(2,2);
    const box=(x:number,y:number,width:number,height:number,color:string,edge='#382f34')=>{c.fillStyle=color;c.fillRect(x,y,width,height);c.strokeStyle=edge;c.lineWidth=2;c.strokeRect(x,y,width,height);};
    box(1,1,198,124,'#d8b873');box(7,7,186,111,'#ecdfb7');box(15,14,170,96,'#e6eef2');
    c.save();c.beginPath();c.rect(16,15,168,94);c.clip();
    // Use the same projected flights as the exterior, seen through the open sash.
    const view=new StreetView();view.side='rear';const frame=stairWindowFrame(view),landing=view.point(STAIR_WINDOW.landing,true);
    c.translate(100,105);c.scale(.68,.68);c.translate(-frame.x-98,-landing.y);
    for(let i=1;i<ROOF_STAIR_ROUTE.length;i++){
      const a=view.point(ROOF_STAIR_ROUTE[i-1],true),b=view.point(ROOF_STAIR_ROUTE[i],true);
      c.strokeStyle='#66585a';c.lineWidth=10;c.beginPath();c.moveTo(a.x,a.y+5);c.lineTo(b.x,b.y+5);c.stroke();
      c.strokeStyle='#443b44';c.lineWidth=3;
      for(const offset of [-44,-24]){c.beginPath();c.moveTo(a.x,a.y+offset);c.lineTo(b.x,b.y+offset);c.stroke();}
      for(let t=0;t<=1;t+=.125){const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;c.beginPath();c.moveTo(x,y-44);c.lineTo(x,y+7);c.stroke();}
    }
    c.fillStyle='#695554';c.fillRect(landing.x-166,landing.y,200,16);
    c.strokeStyle='#443b44';c.lineWidth=3;
    for(const [left,right]of [[-164,-139],[-32,32]]){
      for(const y of [-50,-30]){c.beginPath();c.moveTo(landing.x+left,landing.y+y);c.lineTo(landing.x+right,landing.y+y);c.stroke();}
      for(const x of [left,right]){c.beginPath();c.moveTo(landing.x+x,landing.y-50);c.lineTo(landing.x+x,landing.y+6);c.stroke();}
    }
    c.fillStyle='#f4f8fc';c.beginPath();c.ellipse(landing.x-151,landing.y-52,14,3,0,0,Math.PI*2);c.fill();
    c.restore();
    box(13,10,174,34,'#a9bdba99');box(11,42,178,8,'#e7d7a8');box(91,44,18,3,'#9d784b');
    c.strokeStyle='#fff4cf';c.lineWidth=2;c.beginPath();c.moveTo(33,35);c.lineTo(58,18);c.stroke();
    box(0,116,200,10,'#e5d0a3');c.fillStyle='#f4f8fc';c.beginPath();c.ellipse(171,115,20,3,0,0,Math.PI*2);c.fill();
    scene.textures.addCanvas(key,canvas);
  }
  scene.add.image(w.x,w.top,key).setOrigin(.5,0).setDisplaySize(w.width,w.height).setDepth(3);
  const step=scene.add.graphics().setDepth(3);
  step.fillStyle(0xb99b6a).fillRect(w.x-39,177,78,19).lineStyle(2,0x69513f).strokeRect(w.x-39,177,78,19);
  step.lineStyle(2,0xead7a7).lineBetween(w.x-36,180,w.x+36,180);
  scene.add.zone(w.x,w.top+70,200,142).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',leave);
}
