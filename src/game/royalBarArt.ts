import Phaser from 'phaser';
import {t} from '../i18n/index';
import {BAR_POSITION} from '../shared/furniture';
import {SEATS} from '../shared/world';
import {MIRA_ATLASES} from './miraAnimation';
import {ROYAL_BAR_DEPTH,ROYAL_BAR_PROPS} from './royalBarLayers';

export const ROYAL_BAR_ART={
  'royal-bar-assembly':'bar-assembly.png','royal-bar-stool':'bar-stool.png',
} as const;
export function preloadRoyalBarArt(scene:Phaser.Scene){
  for(const[key,file]of Object.entries(ROYAL_BAR_ART))scene.load.image(key,'/assets/royal-bar/v2/'+file);
  for(const[key,spec]of Object.entries(MIRA_ATLASES))scene.load.image('mira-painted-'+key,'/assets/royal-bar/v3/'+spec.file);
}
function opaqueCounterProps(scene:Phaser.Scene){
  const key='royal-bar-opaque-props';
  if(scene.textures.exists(key))return key;
  const texture=scene.textures.createCanvas(key,880,170)!;
  texture.context.drawImage(scene.textures.get('royal-bar-assembly').getSourceImage() as HTMLImageElement,260,520,880,170,0,0,880,170);
  const pixels=texture.context.getImageData(0,0,880,170);
  // The assembly has alpha 252-253 even inside solid cups. Opaque props must fully hide staff.
  for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=255;
  texture.context.putImageData(pixels,0,0);texture.refresh();
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{if(scene.textures.exists(key))scene.textures.remove(key);});
  return key;
}
export function drawRoyalBar(scene:Phaser.Scene,onSeat:(id:string)=>void,onOrder:()=>void){
  const{x,y}=BAR_POSITION;
  scene.add.image(x-22.6,y-24,'royal-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setDepth(ROYAL_BAR_DEPTH.back).setName('royal-bar-back');
  scene.add.image(x-22.6,y-24,'royal-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setCrop(0,650,1536,374).setDepth(ROYAL_BAR_DEPTH.counter).setName('royal-bar-front');
  // Complete countertop props occlude staff, rather than cutting them at the front crop.
  const propsTexture=opaqueCounterProps(scene);
  for(const [name,outline] of Object.entries(ROYAL_BAR_PROPS)){
    const shape=scene.add.graphics().setVisible(false);
    shape.fillStyle(0xffffff).fillPoints(outline.map(([u,v])=>({x:x-22.6+u*.2,y:y-24+v*.2})),true);
    const mask=shape.createGeometryMask();
    scene.add.image(x-22.6+260*.2,y-24+520*.2,propsTexture).setOrigin(0).setDisplaySize(176,34).setDepth(ROYAL_BAR_DEPTH.props).setMask(mask).setName('royal-bar-prop-'+name);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>mask.destroy());
  }
  scene.add.text(x+131,y+143,t('ЛИМОНАД  ·  КОФЕ  ·  ЯГОДЫ'),{fontFamily:'Georgia, serif',fontSize:'6px',fontStyle:'bold',color:'#f2c77d'}).setOrigin(.5).setDepth(y+167);
  for(const object of scene.children.list)if(object instanceof Phaser.GameObjects.Text&&object.text===t('Роял Бар')){
    object.setStyle({fontFamily:'Georgia, serif',fontSize:'19px',fontStyle:'bold',color:'#ecc36f'}).setLetterSpacing(.7);
  }
  scene.add.zone(x+132,y+102,255,115).setDepth(y+168).setInteractive({useHandCursor:true}).on('pointerdown',onOrder);
  for(const seat of SEATS.filter(seat=>seat.kind==='bar')){
    scene.add.image(seat.x,seat.y-16.5,'royal-bar-stool').setOrigin(.5,0).setDisplaySize(70,50).setDepth(seat.y-6);
    scene.add.zone(seat.x,seat.y-22,48,48).setDepth(seat.y+2).setInteractive({useHandCursor:true}).on('pointerdown',()=>onSeat(seat.id));
  }
  // The permanent cat-water-mug is still drawn separately by drawCatCare.
}
