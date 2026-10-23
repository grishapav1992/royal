import { t as translateText } from '../i18n/index';
import Phaser from 'phaser';
import { SEATS } from '../shared/world';
import { BAR_POSITION } from '../shared/furniture';
import { CHARACTER_RESOLUTION } from './characters';
import { drawMira } from './miraArt';
import { MiraRoutine, type MiraView } from '../shared/miraRoutine';
import { NpcMotion } from '../network/NpcMotion';

export class Bar {
  private mira: Phaser.GameObjects.Sprite;
  private routine = new MiraRoutine();
  private target?: MiraView;
  private motion=new NpcMotion<MiraView>({delayMs:0,isMoving:view=>view.action==='walk'});
  private view: MiraView = { ...this.routine.state };
  private work: Phaser.Textures.CanvasTexture;
  private lastDraw = -Infinity;
  constructor(scene: Phaser.Scene, onSeat: (id: string) => void, onOrder: () => void) {
    const {x,y}=BAR_POSITION;
    scene.add.image(x+7,y,'bar-back').setOrigin(0).setDisplaySize(248,99).setDepth(y+53);
    scene.add.text(x+131,y-13,'M I R A ’ S   B A R',{fontFamily:'sans-serif',fontSize:'11px',color:'#f0b2cc',fontStyle:'bold'}).setOrigin(.5).setDepth(y+54);
    this.mira = scene.add.sprite(x+125,y+116,'citizen-6','down-6').setOrigin(.5,1).setScale(2.65/CHARACTER_RESOLUTION).setDepth(y+117);
    this.mira.play('citizen-6-idle-down');
    this.work = scene.textures.createCanvas('mira-work', 32 * CHARACTER_RESOLUTION, 40 * CHARACTER_RESOLUTION)!;
    this.mira.anims.stop(); this.mira.setTexture('mira-work');
    scene.add.image(x,y+94,'bar-front').setOrigin(0).setDisplaySize(262,72).setDepth(y+166);
    scene.add.text(x+134,y+143,translateText('ЛИМОНАД  ·  КОФЕ  ·  ЯГОДЫ'),{fontFamily:'sans-serif',fontSize:'8px',color:'#fff2d1'}).setOrigin(.5).setDepth(y+167);
    scene.add.zone(x+132,y+102,255,115).setDepth(y+168).setInteractive({useHandCursor:true}).on('pointerdown',onOrder);
    for (const seat of SEATS.filter(seat=>seat.kind==='bar')) {
      if (seat.kind==='bar') scene.add.image(seat.x-24,seat.y-18,'bar-stool').setOrigin(0).setDisplaySize(48,44).setDepth(seat.y-6);
      scene.add.zone(seat.x,seat.y-22,48,48).setDepth(seat.y+2).setInteractive({useHandCursor:true}).on('pointerdown',()=>onSeat(seat.id));
    }
  }
  sync(view: MiraView, at=performance.now()) { this.target = view; this.motion.push(view,at); }
  resetMotion() { this.motion.reset();this.target=undefined; }
  getState() { return { ...this.view }; }
  update(serving: boolean, reducedMotion: boolean, conversation = {active:false,speaking:false}, delta = .016, online = false, renderAt=performance.now()) {
    if (!online) { this.routine.tick(delta, serving, conversation.active); this.target = { ...this.routine.state }; }
    const target = online ? this.motion.sample(renderAt) ?? this.target ?? this.routine.state : this.target ?? this.routine.state;
    Object.assign(this.view, target);
    const moved=Math.hypot(target.x-this.mira.x,target.y-this.mira.y)>.001;
    this.mira.setPosition(target.x,target.y);
    const time = this.mira.scene.time.now;
    this.mira.setAngle(!reducedMotion && target.action === 'chat' && conversation.speaking ? Math.sin(time/210)*2 : 0);
    if (time - this.lastDraw < 85) return;
    this.lastDraw = time;
    const phase = reducedMotion ? 0 : target.progress * Math.PI * 16;
    const frame = reducedMotion ? 6 : target.action === 'walk' ? moved?Math.floor(time/100)%6:6 : time%4500 > 4350 ? 8 : 6;
    const c = this.work.context; c.clearRect(0,0,this.work.width,this.work.height); c.save(); c.scale(CHARACTER_RESOLUTION,CHARACTER_RESOLUTION);
    drawMira(c,target.facing,frame,-1,target.action,phase); c.restore(); this.work.refresh();
  }
}
