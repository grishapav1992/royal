import Phaser from 'phaser';
import {t} from '../i18n/index';
import {BAR_POSITION} from '../shared/furniture';
import {SEATS} from '../shared/world';
import {MIRA_ATLASES} from './miraAnimation';

export const ROYAL_BAR_ART={
  'royal-bar-assembly':'bar-assembly.png','royal-bar-stool':'bar-stool.png',
} as const;
export function preloadRoyalBarArt(scene:Phaser.Scene){
  for(const[key,file]of Object.entries(ROYAL_BAR_ART))scene.load.image(key,'/assets/royal-bar/v2/'+file);
  for(const[key,spec]of Object.entries(MIRA_ATLASES))scene.load.image('mira-painted-'+key,'/assets/royal-bar/v3/'+spec.file);
}
export function drawRoyalBar(scene:Phaser.Scene,onSeat:(id:string)=>void,onOrder:()=>void){
  const{x,y}=BAR_POSITION;
  scene.add.image(x-22.6,y-24,'royal-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setDepth(y+53).setName('royal-bar-back');
  scene.add.image(x-22.6,y-24,'royal-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setCrop(0,650,1536,374).setDepth(y+166).setName('royal-bar-front');
  // Complete countertop props occlude staff, rather than cutting them at the front crop.
  const props=[
    [[1006,525],[1118,525],[1138,683],[975,685]],
    [[588,535],[627,549],[649,578],[632,611],[616,626],[619,668],[595,677],[570,668],[570,635],[539,624],[532,595],[548,561]],
    [[733,623],[769,625],[780,637],[797,638],[802,648],[793,661],[779,666],[800,672],[788,682],[719,680],[708,670],[721,662],[719,637]],
  ];
  for(const outline of props){
    const shape=scene.add.graphics().setVisible(false);
    shape.fillStyle(0xffffff).fillPoints(outline.map(([u,v])=>({x:x-22.6+u*.2,y:y-24+v*.2})),true);
    const mask=shape.createGeometryMask();
    scene.add.image(x-22.6,y-24,'royal-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setDepth(y+169).setMask(mask);
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
