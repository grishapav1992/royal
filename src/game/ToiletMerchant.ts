import type Phaser from 'phaser';
import atlas from '../../docs/concepts/toilet-janitor-animations/animations-v1.json';
import {TOILET_MERCHANT} from '../shared/toilet';
import {language} from '../i18n';
import {ToiletMerchantRoutine} from './toiletMerchantPose';

export const TOILET_MERCHANT_TEXTURE='royal-toilet-janitor-v1';
export const TOILET_MERCHANT_URL='/assets/toilet/royal-janitor-v1-90a698e1d019.png';
const scale=.28;
const lines={
  ru:{name:'Жора',beckon:'Эй, приятель... Сюда.',trade:[
    'Мыло, бумага... Всё почти новое.',
    'Тише. Для своих всё найдётся.',
    'Администрации про мой ассортимент знать необязательно.',
  ]},
  en:{name:'Zhora',beckon:'Hey, pal... Over here.',trade:[
    'Soap, paper... Almost brand new.',
    'Keep it down. I can sort you out.',
    'Management does not need to know about my stock.',
  ]},
};
export function preloadToiletMerchant(scene:Phaser.Scene){scene.load.image(TOILET_MERCHANT_TEXTURE,TOILET_MERCHANT_URL);}

export class ToiletMerchant{
  private routine=new ToiletMerchantRoutine();
  private sprite?:Phaser.GameObjects.Image;
  private bubble:Phaser.GameObjects.Text;
  private frame=0;
  private reducedMotion=false;
  private art?:CanvasImageSource;
  constructor(scene:Phaser.Scene,approach:()=>void){
    const p=TOILET_MERCHANT;
    if(scene.textures.exists(TOILET_MERCHANT_TEXTURE)){
      const texture=scene.textures.get(TOILET_MERCHANT_TEXTURE);
      for(const f of atlas.frames)if(!texture.has(String(f.index)))texture.add(String(f.index),0,f.rect.x,f.rect.y,f.rect.width,f.rect.height);
      this.art=texture.getSourceImage() as CanvasImageSource;
      scene.add.ellipse(p.x,p.y-1,40,10,0x27352f,.23).setDepth(p.y-2);
      this.sprite=scene.add.image(p.x,p.y,TOILET_MERCHANT_TEXTURE,'0').setScale(scale).setDepth(p.y);
      this.setFrame(0);
    }
    scene.add.text(p.x,p.y+10,lines[language].name,{fontFamily:'Arial, sans-serif',fontSize:'10px',color:'#eee4c4',backgroundColor:'#443c35',padding:{x:5,y:2}}).setOrigin(.5,0).setDepth(p.y+1);
    this.bubble=scene.add.text(p.x+44,p.y-99,'',{fontFamily:'Arial, sans-serif',fontSize:'11px',color:'#f6edcc',backgroundColor:'#35342f',padding:{x:8,y:6},wordWrap:{width:171},align:'left'}).setOrigin(1,1).setDepth(705).setAlpha(0);
    scene.add.zone(p.x,p.y-42,54,84).setDepth(700).setInteractive({useHandCursor:true}).on('pointerdown',approach);
  }
  private setFrame(index:number){
    this.frame=index;
    const f=atlas.frames[index];
    this.sprite?.setFrame(String(index)).setOrigin(f.anchor.x/f.rect.width,f.anchor.y/f.rect.height);
  }
  interact(person:{x:number;y:number}){
    const distance=Math.hypot(person.x-TOILET_MERCHANT.x,person.y-TOILET_MERCHANT.y);
    if(distance>TOILET_MERCHANT.interactionRadius)return false;
    this.routine.show(distance);return true;
  }
  update(delta:number,person:{x:number;y:number;moving?:boolean},reducedMotion:boolean,available=true){
    this.reducedMotion=reducedMotion;
    const distance=available?Math.hypot(person.x-TOILET_MERCHANT.x,person.y-TOILET_MERCHANT.y):Infinity;
    const frame=this.routine.update(delta,distance,!person.moving,reducedMotion),changed=frame!==this.frame;
    if(changed)this.setFrame(frame);
    const text=lines[language],speech=distance<185?this.routine.speech:'';
    this.bubble.setText(speech==='trade'?text.trade[this.routine.speechVariant]:speech==='beckon'?text.beckon:'').setAlpha(speech?1:0);
    return changed;
  }
  drawMap(c:CanvasRenderingContext2D){
    if(!this.art)return;
    const f=atlas.frames[this.frame],p=TOILET_MERCHANT;
    c.drawImage(this.art,f.rect.x,f.rect.y,f.rect.width,f.rect.height,p.x-f.anchor.x*scale,p.y-f.anchor.y*scale,f.rect.width*scale,f.rect.height*scale);
  }
  getState(){return {name:'Жора',...TOILET_MERCHANT,artVersion:1,artLoaded:!!this.art,frame:this.frame,action:this.routine.action,elapsedMs:this.routine.elapsed,reducedMotion:this.reducedMotion,speech:this.bubble.text,scale,depth:this.sprite?.depth,anchor:atlas.frames[this.frame].anchor};}
}


export function toiletMerchantPortrait(){
  const canvas=document.createElement('canvas');canvas.width=176;canvas.height=200;
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',language==='en'?'Zhora in a Royal work coat':'Жора в рабочем плаще Royal');
  const image=new Image();image.onload=()=>{const f=atlas.frames[15];canvas.getContext('2d')!.drawImage(image,f.rect.x,f.rect.y,f.rect.width,f.rect.height,0,12,176,176);};image.src=TOILET_MERCHANT_URL;
  return canvas;
}
