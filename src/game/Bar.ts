import { t as translateText } from '../i18n/index';
import Phaser from 'phaser';
import { SEATS } from '../shared/world';
import { BAR_POSITION } from '../shared/furniture';
import { CHARACTER_RESOLUTION } from './characters';
import { paintMira as drawMira } from './miraCharacterArt';
import { MiraRoutine, miraSeatAmount, type MiraAttention, type MiraView } from '../shared/miraRoutine';
import { NpcMotion } from '../network/NpcMotion';

export class Bar {
  private mira: Phaser.GameObjects.Sprite;
  private routine = new MiraRoutine();
  private target?: MiraView;
  private motion=new NpcMotion<MiraView>({delayMs:0,isMoving:view=>view.action==='walk'});
  private view: MiraView = { ...this.routine.state };
  private work: Phaser.Textures.CanvasTexture;
  private handsWork: Phaser.Textures.CanvasTexture;
  private hands: Phaser.GameObjects.Sprite;
  private lastDraw = -Infinity;
  private attention: MiraAttention = 'closed';
  private steam: Phaser.GameObjects.Graphics;
  private contact: Phaser.GameObjects.Ellipse;
  constructor(scene: Phaser.Scene, onSeat: (id: string) => void, onOrder: () => void) {
    const {x,y}=BAR_POSITION;
    scene.add.image(x+7,y,'bar-back').setOrigin(0).setDisplaySize(248,99).setDepth(y+53);
    scene.add.image(x,y-27,'bar-lamps').setOrigin(0).setDisplaySize(262,138).setDepth(y+55);
    this.mira = scene.add.sprite(x+125,y+116,'citizen-6','down-6').setOrigin(.5,1).setScale(2.65/CHARACTER_RESOLUTION).setDepth(y+117);
    this.mira.play('citizen-6-idle-down');
    this.work = scene.textures.createCanvas('mira-work', 32 * CHARACTER_RESOLUTION, 40 * CHARACTER_RESOLUTION)!;
    this.mira.anims.stop(); this.mira.setTexture('mira-work');
    this.handsWork=scene.textures.createCanvas('mira-hands',32*CHARACTER_RESOLUTION,40*CHARACTER_RESOLUTION)!;
    this.hands=scene.add.sprite(x+125,y+158,'mira-hands').setOrigin(.5,1).setScale(2.65/CHARACTER_RESOLUTION).setDepth(y+169).setVisible(false);
    this.contact = scene.add.ellipse(x+51,y+111,27,5,0x241922,.4).setDepth(y+169).setVisible(false);
    this.steam = scene.add.graphics().setDepth(y+169);
    scene.add.image(x,y+94,'bar-front').setOrigin(0).setDisplaySize(262,72).setDepth(y+166);
    scene.add.text(x+131,y+142,translateText('ЛИМОНАД  ·  КОФЕ  ·  ЯГОДЫ'),{fontFamily:'sans-serif',fontSize:'5px',color:'#e9ce9e'}).setOrigin(.5).setDepth(y+167);
    scene.add.zone(x+132,y+102,255,115).setDepth(y+168).setInteractive({useHandCursor:true}).on('pointerdown',onOrder);
    for (const seat of SEATS.filter(seat=>seat.kind==='bar')) {
      if (seat.kind==='bar') scene.add.image(seat.x-24,seat.y-18,'bar-stool').setOrigin(0).setDisplaySize(48,44).setDepth(seat.y-6);
      scene.add.zone(seat.x,seat.y-22,48,48).setDepth(seat.y+2).setInteractive({useHandCursor:true}).on('pointerdown',()=>onSeat(seat.id));
    }
  }
  sync(view: MiraView, at=performance.now()) { this.target = view; this.motion.push(view,at); }
  resetMotion() { this.motion.reset();this.target=undefined; }
  setAttention(attention: MiraAttention) { this.attention = attention; }
  getState() { return { ...this.view, seatAmount:miraSeatAmount(this.view.action,this.view.progress), renderX:this.mira.x, renderY:this.mira.y }; }
  update(serving: boolean, reducedMotion: boolean, conversation = {active:false,speaking:false}, delta = .016, online = false, renderAt=performance.now()) {
    if (!online) { this.routine.tick(delta, serving, conversation.active,this.attention); this.target = { ...this.routine.state }; }
    const target = online ? this.motion.sample(renderAt) ?? this.target ?? this.routine.state : this.target ?? this.routine.state;
    Object.assign(this.view, target);
    const seat = miraSeatAmount(target.action,target.progress);
    // Keep her waist at the counter; seated legs belong in front of its fascia.
    this.mira.setPosition(target.x,target.y+42-10*seat).setDepth(BAR_POSITION.y+(seat>.001?170:117));
    this.hands.setPosition(this.mira.x,this.mira.y).setVisible(target.action==='wipe'||target.action==='serve');
    this.contact.setVisible(seat>.01).setAlpha(seat*.4);
    const time = this.mira.scene.time.now;
    if (time - this.lastDraw < 40) return;
    this.lastDraw = time;
    const phase = reducedMotion ? 0 : target.progress * Math.PI * 8;
    const frame = reducedMotion ? 6 : target.action === 'walk' ? Math.floor(target.progress*6)%6 : time%4500 > 4350 ? 8 : 6;
    const c = this.work.context; c.clearRect(0,0,this.work.width,this.work.height); c.save(); c.scale(CHARACTER_RESOLUTION,CHARACTER_RESOLUTION);
    const listeningToGuard=target.action==='chat'&&target.facing==='left'&&conversation.active&&!conversation.speaking;
    const action=listeningToGuard||reducedMotion&&target.action==='greet'?'listen':target.action;
    drawMira(c,target.facing,frame,-1,action,phase,target.progress); c.restore(); this.work.refresh();
    if(this.hands.visible){
      const foreground=this.handsWork.context;foreground.clearRect(0,0,this.handsWork.width,this.handsWork.height);foreground.save();foreground.scale(CHARACTER_RESOLUTION,CHARACTER_RESOLUTION);
      drawMira(foreground,target.facing,frame,-1,action,phase,target.progress,true);foreground.restore();this.handsWork.refresh();
    }
    this.steam.clear();
    if (!reducedMotion) {
      const {x,y}=BAR_POSITION;
      for(let n=0;n<2;n++) {
        const rise=(time/1600+n*.5)%1;
        this.steam.lineStyle(.55,0xe8d3b1,(1-rise)*.3);
        this.steam.beginPath();this.steam.moveTo(x+128+n*3,y+100-rise*8);
        this.steam.lineTo(x+128+n*3+Math.sin(rise*5+n),y+96-rise*8);this.steam.strokePath();
      }
    }
  }
}
