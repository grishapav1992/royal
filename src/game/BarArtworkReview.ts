import Phaser from 'phaser';
import { t } from '../i18n/index';
import { BAR_POSITION } from '../shared/furniture';
import { SEATS } from '../shared/world';
import { MIRA_SEAT } from '../shared/miraRoutine';

/** Static visual review only. The local review server substitutes this module. */
export class Bar {
  constructor(scene: Phaser.Scene, onSeat: (id: string) => void, onOrder: () => void) {
    const {x,y}=BAR_POSITION;
    scene.add.image(x-22.6,y-24,'reference-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setDepth(y+53);
    scene.add.image(x-22.6,y-24,'reference-bar-assembly').setOrigin(0).setDisplaySize(307.2,204.8).setCrop(0,650,1536,374).setDepth(y+166);
    scene.add.image(x+17,y+48.8,'reference-mira-seated').setOrigin(0).setDisplaySize(69.6,104.4).setDepth(y+170);
    scene.add.text(x+131,y+143,t('ЛИМОНАД  ·  КОФЕ  ·  ЯГОДЫ'),{fontFamily:'Georgia, serif',fontSize:'6px',fontStyle:'bold',color:'#f2c77d'}).setOrigin(.5).setDepth(y+167);
    for(const object of scene.children.list){
      if(object instanceof Phaser.GameObjects.Text&&object.x===275&&object.y===308){
        object.setStyle({fontFamily:'Georgia, serif',fontSize:'19px',fontStyle:'bold',color:'#ecc36f'}).setLetterSpacing(.7);
      }
    }
    scene.add.zone(x+132,y+102,255,115).setDepth(y+168).setInteractive({useHandCursor:true}).on('pointerdown',onOrder);
    for(const seat of SEATS.filter(seat=>seat.kind==='bar')){
      scene.add.image(seat.x,seat.y-16.5,'reference-bar-stool').setOrigin(.5,0).setDisplaySize(70,50).setDepth(seat.y-6);
      scene.add.zone(seat.x,seat.y-22,48,48).setDepth(seat.y+2).setInteractive({useHandCursor:true}).on('pointerdown',()=>onSeat(seat.id));
    }
    // drawCatCare still owns the mug, and CatRenderer still owns its water ripples.
    // Neither the permanent mug nor CAT_CARE's approach/perch points is replaced.
  }
  sync() {}
  resetMotion() {}
  setAttention() {}
  update() {}
  getState(){return {...MIRA_SEAT,facing:'down' as const,action:'sit' as const,progress:.5,seatAmount:1,renderX:MIRA_SEAT.x,renderY:BAR_POSITION.y+153.2,artReview:true};}
}
