import { t as translateText } from '../i18n/index';
import Phaser from 'phaser';
import { MIRA_HOME } from '../shared/miraRoutine';
import type { GuardView } from '../shared/security';
import type { HallId } from '../shared/world';
import { WORLD } from '../shared/clubGeometry';
import { NpcMotion } from '../network/NpcMotion';

type Person = { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; label?: Phaser.GameObjects.Text };
const WIDTH = 112, HEIGHT = 144, SCALE = .77;

function createGuard(scene: Phaser.Scene) {
  if (scene.textures.exists('security-guard')) return;
  const texture = scene.textures.createCanvas('security-guard', WIDTH * 14 * 2, HEIGHT * 8 * 2)!;
  const c = texture.context;
  ['down', 'left', 'right', 'up'].forEach((direction, row) => {
    for (let frame = 0; frame < 28; frame++) {
      const col=frame%14, atlasRow=row*2+Math.floor(frame/14);
      c.save(); c.translate(col * WIDTH * 2, atlasRow * HEIGHT * 2); c.scale(2, 2);
      c.beginPath(); c.rect(0,0,WIDTH,HEIGHT); c.clip(); c.translate(56,0);
      const side = direction === 'left' || direction === 'right', back = direction === 'up';
      if (direction === 'left') c.scale(-1,1);
      const walking = frame < 6 || (frame >= 12 && frame < 18);
      const step = walking ? [0,1,1,0,-1,-1][frame%6] : 0;
      const bounce = walking ? [0,-2,-2,0,-2,-2][frame%6] : 0;
      const holding = frame === 8 || frame === 9 || (frame >= 12 && frame < 18);
      const pointing = frame === 7, throwing = frame === 10 || frame === 11;
      const fist=frame===26||frame===27;
      const talking=frame===18||frame===19, looking=frame===20, blink=frame===22, glance=frame===23?-3:frame===24?3:0;
      const skin = '#89563f', ink = '#302b2a', shirt = '#20212a';
      const fill = (color: string) => { c.fillStyle=color; c.fill(); c.strokeStyle=ink; c.lineWidth=.9; c.stroke(); };
      const poly = (points: number[], color: string) => {
        c.beginPath(); c.moveTo(points[0],points[1]);
        for(let i=2;i<points.length;i+=2)c.lineTo(points[i],points[i+1]);
        c.closePath(); fill(color);
      };
      const oval = (x: number,y: number,rx: number,ry: number,color: string,angle=0) => {
        c.beginPath(); c.ellipse(x,y,rx,ry,angle,0,Math.PI*2); fill(color);
      };
      const line = (x: number,y: number,x2: number,y2: number,color=ink,width=1.3) => {
        c.beginPath(); c.moveTo(x,y); c.lineTo(x2,y2); c.strokeStyle=color; c.lineWidth=width; c.stroke();
      };
      c.lineJoin='round'; c.lineCap='round';
      // Short denim legs and flat shoes move as separate paper pieces.
      for(const leg of [-1,1]) {
        if(side) {
          // Both hips overlap in profile; the feet separate along the direction of travel.
          const near=leg===1,swing=step*leg,hip=near?-5:3;
          const knee=hip+swing*6,ankle=hip+swing*12+(near?0:3);
          const ground=139-(near?0:1)-Math.max(0,swing)*3;
          poly([hip-9,110,hip+9,110,knee+8,124,ankle+7,ground-5,ankle-8,ground-5,knee-8,124],near?'#282934':'#22232d');
          c.beginPath();c.moveTo(ankle-9,ground-6);c.lineTo(ankle+7,ground-6);
          c.quadraticCurveTo(ankle+10,ground-3,ankle+16,ground-3);
          c.quadraticCurveTo(ankle+22,ground-2,ankle+22,ground+1);
          c.quadraticCurveTo(ankle+16,ground+4,ankle-9,ground+3);
          c.closePath();fill(near?'#161920':'#1b1e27');
          continue;
        }
        const swing=step*leg, x=leg*16, y=139-Math.max(0,swing)*3;
        poly([x-11,110,x+11,110,x+11,y,x-11,y],'#282934');
        oval(x,y,16,4,'#161920');
      }
      c.save(); c.translate(0,bounce);
      if(frame===21)c.rotate((side?4:-2)*Math.PI/180);
      if(talking)c.translate(0,frame===19?-1:0);
      const bodyWidth=side?25:38,shoulderWidth=side?14:20;
      const arm = (near: boolean) => {
        const x=side?(near?-5:7):(near?38:-38), sign=near?1:-1;
        c.save(); c.translate(x,76);
        if(side) {
          const active=near&&(holding||pointing||throwing||talking||looking||frame===25||fist);
          let elbowX=0,elbowY=19,handX=0,handY=32;
          if(active) {
            elbowX=18;elbowY=18;handX=36;handY=-6;
            if(pointing){handX=43;handY=-12;}
            if(fist){handX=39;handY=-10;c.rotate((frame===26?-12:8)*Math.PI/180);}
            if(throwing){elbowX=frame===11?22:10;elbowY=frame===11?12:7;handX=frame===11?44:19;handY=frame===11?5:-13;}
            if(talking||frame===25){elbowX=12;elbowY=19;handX=frame===19?28:24;handY=frame===19?24:29;}
            if(looking){elbowX=37;elbowY=-10;handX=39;handY=-47;}
          } else c.rotate(sign*step*24*Math.PI/180);
          const armSkin=near?skin:'#754a38',length=Math.hypot(elbowX,elbowY);
          const sleeveLength=Math.min(14,length*.72);
          const sleeveX=elbowX/length*sleeveLength,sleeveY=elbowY/length*sleeveLength;
          const handAngle=Math.atan2(handY-elbowY,handX-elbowX)-Math.PI/2;
          // Paint the whole outer contour before the skin, leaving no seam at the wrist.
          for(const outline of [true,false]) {
            const edge=outline?.8:0,color=outline?ink:armSkin;
            c.beginPath();c.moveTo(sleeveX,sleeveY);c.lineTo(elbowX,elbowY);c.lineTo(handX,handY);
            c.strokeStyle=color;c.lineWidth=outline?15:13;c.stroke();
            c.beginPath();c.ellipse(handX,handY,(fist&&near?7:6)+edge,(fist&&near?7:8.5)+edge,handAngle,0,Math.PI*2);
            c.fillStyle=color;c.fill();
            if(pointing&&near){c.beginPath();c.roundRect(handX-2-edge,handY-20-edge,5+edge*2,17+edge*2,2.5+edge);c.fill();}
          }
          // The rounded sleeve merges into the shirt; only its cuff has a visible edge.
          c.save();c.rotate(Math.atan2(elbowY,elbowX)-Math.PI/2);
          c.beginPath();c.moveTo(-10,-2);c.bezierCurveTo(-9,-10,5,-11,10,-3);
          c.quadraticCurveTo(12,5,8,sleeveLength+1);c.quadraticCurveTo(0,sleeveLength+3,-8,sleeveLength+1);
          c.quadraticCurveTo(-11,7,-10,-2);c.closePath();c.fillStyle=near?shirt:'#1b1d25';c.fill();
          c.beginPath();c.moveTo(-8,sleeveLength);c.quadraticCurveTo(0,sleeveLength+2,8,sleeveLength);
          c.strokeStyle='#151720';c.lineWidth=.8;c.stroke();c.restore();
          if(fist&&near){for(let i=-1;i<=1;i++)line(handX+i*3,handY-4,handX+i*3,handY-1,'#563729',1);line(handX-5,handY+3,handX+4,handY+3,'#563729',1);}
          else {line(handX+4,handY,handX+2,handY+3,'#634033',1);line(handX-2,handY+3,handX-2,handY+5,'#634033',.8);}
          c.restore();return;
        }
        if(near && (holding||pointing||throwing||talking||looking||frame===25||fist)) {
          if(fist)c.rotate((frame===26?-12:8)*Math.PI/180);
          const raised=holding||pointing||fist, handY=looking?-47:raised?-25:talking?8:15;
          const handX=looking?-12:fist&&frame===27?4:7;
          poly([-9,-3,8,-3,13,15,-5,21,-12,11],shirt);
          oval(3,16,10,11,skin);
          poly([-2,17,handX-8,handY+2,handX+7,handY+2,11,19],skin);
          oval(handX,handY,10,9,skin);
          if(fist){for(let i=-1;i<=1;i++)line(handX+i*4,handY-5,handX+i*4,handY-1,'#563729',1.2);line(handX-7,handY+3,handX+5,handY+3,'#563729',1.2);}
          if(pointing) {
            c.beginPath();c.roundRect(handX-2,handY-20,6,17,3);fill(skin);
          }
        } else {
          c.rotate(sign*step*7*Math.PI/180);
          // A tapered forearm flows into a small relaxed palm without a second skin disc.
          c.beginPath();c.moveTo(-8,12);c.lineTo(8,12);c.lineTo(6,27);
          c.quadraticCurveTo(10,29,8,34);c.quadraticCurveTo(6,38,0,38);
          c.quadraticCurveTo(-7,38,-8,33);c.lineTo(-6,27);c.closePath();fill(skin);
          poly([-10,-4,8,-4,12,13,-10,16],shirt);
          line(6,30,4,33,'#634033',1);line(-2,33,-2,35,'#634033',.8);
        }
        c.restore();
      };
      arm(false);
      // Broad, simple shapes replace anatomical shading and angular superhero proportions.
      c.beginPath();c.moveTo(-shoulderWidth,66);c.quadraticCurveTo(-bodyWidth,67,-bodyWidth,87);
      c.lineTo(-bodyWidth+3,116);c.quadraticCurveTo(0,123,bodyWidth-3,116);
      c.lineTo(bodyWidth,87);c.quadraticCurveTo(bodyWidth,67,shoulderWidth,66);c.closePath();fill(shirt);
      if(!back) {
        if(side)poly([9,69,18,74,12,87,5,77],'#34343f');
        else {
          poly([-15,70,-2,81,-10,88,-22,73],'#34343f');
          poly([15,70,2,81,10,88,22,73],'#34343f');
        }
        line(side?14:0,80,side?14:0,111,'#46434a',.8);
      }
      c.fillStyle='#131620';c.fillRect(-bodyWidth+3,111,bodyWidth*2-6,8);
      c.fillStyle='#d9ba61';c.fillRect(side?17:-6,111,side?7:12,9);c.fillStyle='#171a23';c.fillRect(side?19:-3,113,side?3:6,5);
      // Linked gold chain follows the collar, with a narrow perspective in profile.
      c.save();if(side){c.translate(10,0);c.scale(.62,1);}
      c.beginPath();c.moveTo(-20,69);c.quadraticCurveTo(0,back?80:119,20,69);
      c.strokeStyle='#72501c';c.lineWidth=7;c.stroke();
      c.strokeStyle='#eeb52f';c.lineWidth=4.5;c.stroke();
      for(let i=0;i<=14;i++){
        const t=i/14,x=-20+40*t,y=69+2*t*(1-t)*(back?11:50);
        c.beginPath();c.ellipse(x,y,2.5,1.5,Math.atan2(2*(1-2*t)*(back?11:50),40),0,Math.PI*2);
        c.strokeStyle=i%2?'#fff0a1':'#ae7420';c.lineWidth=1.1;c.stroke();
      }
      c.restore();
      if(!side)arm(true);
      // The profile has its own forehead, nose and jaw instead of a front-facing disc.
      if(side) {
        c.beginPath();c.moveTo(-19,14);c.quadraticCurveTo(-6,4,10,11);
        c.quadraticCurveTo(26,15,26,30);c.lineTo(25,35);c.lineTo(34,43);
        c.quadraticCurveTo(36,46,27,47);c.lineTo(27,51);
        c.quadraticCurveTo(30,53,26,55);c.quadraticCurveTo(24,65,12,69);
        c.quadraticCurveTo(-5,74,-19,61);c.quadraticCurveTo(-30,50,-27,32);
        c.quadraticCurveTo(-26,20,-19,14);c.closePath();fill(skin);
      } else {
        oval(-31,42,5,7,skin);oval(31,42,5,7,skin);
        oval(0,38,32,32,skin);
      }
      if(!back) {
        if(side) {
          if(blink)line(12.5,38,25.5,38);else {oval(19,37.5,6.5,9,'#fffdf3',-.05);oval(22+glance*.35,frame===25?41:38.5,1.7,2.3,'#17191e');}
          line(11,26,25,29,ink,2.3);if(frame===19)oval(22,55,3.5,2.5,'#301e23');else line(17,56,26,56,ink,1.7);
        } else {
          if(blink){line(-22,39,-2,39);line(2,39,22,39);}else{
            oval(-11,39,11,14,'#fffdf3',.08);oval(11,39,11,14,'#fffdf3',-.08);
            oval(-7+glance,frame===25?44:40,2.1,2.7,'#17191e');oval(7+glance,frame===25?44:40,2.1,2.7,'#17191e');
          }
          line(-23,24,-5,28,ink,2.3);line(5,28,23,24,ink,2.3);
          line(-2,51,2,51,'#633d31',1);if(frame===19)oval(0,59,4,3,'#301e23');else line(-8,59,8,59,ink,1.7);
        }
      }
      // The flat top is a single compact black cutout with tapered sides, never a fan.
      if(side) {
        poly([-28,37,-29,13,-24,4,20,4,26,10,26,23,7,21,-7,22,-8,37,-15,40,-22,39],'#171a22');
        oval(-10,43,5,7,skin);
        c.beginPath();c.moveTo(-11,40);c.quadraticCurveTo(-6,40,-9,46);c.strokeStyle='#633d31';c.lineWidth=1;c.stroke();
      } else poly([-30,34,-30,10,-25,4,25,4,30,10,30,34,24,26,24,21,-24,21,-24,27],'#171a22');
      if(back) {
        c.beginPath();c.moveTo(-30,19);c.lineTo(30,19);c.lineTo(28,43);
        c.quadraticCurveTo(0,55,-28,43);c.closePath();fill('#171a22');
      }
      // The near arm can pass in front of the jaw and forehead without disappearing.
      if(side)arm(true);
      else if(looking)oval(27,27,8,5,skin);
      c.restore();c.restore();
      texture.add(`${direction}-${frame}`,0,col*WIDTH*2,atlasRow*HEIGHT*2,WIDTH*2,HEIGHT*2);
    }
  });
  texture.refresh();
}

export class SecurityGuard {
  private sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;
  private speech: Phaser.GameObjects.Text;
  private guards: GuardView[] = [];
  private motion=new NpcMotion<GuardView>({delayMs:0,isMoving:view=>['approach','return','carry','patrol','transit','enter'].includes(view.phase)});
  private reply: Phaser.GameObjects.Text;
  constructor(private scene: Phaser.Scene) {
    createGuard(scene);
    this.shadow = scene.add.ellipse(585,635,54,17,0x151521,.35);
    this.sprite = scene.add.sprite(585,635,'security-guard','down-6').setOrigin(.5,1).setScale(SCALE / 2);
    this.reply = scene.add.text(MIRA_HOME.x,MIRA_HOME.y-116,'',{fontFamily:'Arial',fontSize:'12px',color:'#fff0d9',backgroundColor:'#513045',align:'center',padding:{x:11,y:8},wordWrap:{width:210}}).setOrigin(.5,1).setDepth(1500).setVisible(false);
    this.speech = scene.add.text(585,505,'', { fontFamily:'Arial', fontSize:'12px', fontStyle:'bold', color:'#ffe49b', backgroundColor:'#25212c', align:'center', padding:{x:12,y:9}, wordWrap:{width:240} }).setOrigin(.5,1).setVisible(false);
  }
  sync(guards: GuardView[], at=performance.now()) {
    this.guards = guards;
    // One guard travels between halls. Missing samples must not retain an old route.
    if(guards[0])this.motion.push(guards[0],at);else this.motion.reset();
  }
  resetMotion() { this.motion.reset(); }
  getState() { return this.guards; }
  barConversation() { const g=this.guards.find(g=>g.hall==='arcade');return { active:g?.phase==='chat', speaking:Boolean(g?.reply) }; }
  update(hall: HallId, time: number, dt: number, getPerson: (id: string) => Person | undefined, renderAt=performance.now()) {
    const latest = this.guards.find(guard => guard.hall === hall);
    const buffered=this.motion.sample(renderAt);
    const g=latest&&buffered?.hall===hall?buffered:latest;
    this.sprite.setVisible(Boolean(g)); this.shadow.setVisible(Boolean(g));
    if (!g) { this.speech.setVisible(false); this.reply.setVisible(false); return; }
    const x = g.x, y = g.y;
    const moved=Math.hypot(x-this.sprite.x,y-this.sprite.y)>.001;
    const moving = moved&&['approach','return','carry','patrol','transit','enter'].includes(g.phase);
    const opacity = g.phase==='door' ? 1-g.progress : g.phase==='enter' ? g.progress : 1;
    this.sprite.setAlpha(opacity);this.shadow.setAlpha(opacity);
    const leisurely = g.phase==='patrol'||g.phase==='return'||(['transit','enter'].includes(g.phase)&&!g.target);
    let frame = g.phase==='warn' ? 7 : g.phase==='grab' ? 8 : g.phase==='carry' ? 12+(moving?Math.floor(time/130)%6:0) : g.phase==='throw' ? (g.progress<.3?10:11) : moving ? Math.floor(time/(leisurely?170:110))%6 : 6;
    if(g.phase==='chat')frame=g.speech?(Math.floor(g.progress*40)%2?18:19):6;
    if(g.phase==='window')frame=g.progress<.7?20:6;
    if(g.phase==='inspect')frame=Math.floor(g.progress*6)%2?21:6;
    if(g.phase==='watch')frame=g.progress>.7?25:Math.floor(g.progress*9)%2?23:24;
    if(g.phase==='bump')frame=26+Math.floor(g.progress*8)%2;
    if(['idle','watch','chat'].includes(g.phase)&&time%5100<130)frame=22;
    this.sprite.setFrame(`${g.facing}-${frame}`).setPosition(x,y).setDepth(y+.2);
    this.shadow.setPosition(x,y-2).setDepth(y-1);
    this.speech.setText(translateText(g.speech)).setPosition(Phaser.Math.Clamp(x,160,WORLD.width-160),y-116).setDepth(1500).setVisible(Boolean(g.speech));
    this.reply.setText(translateText(g.reply || '')).setVisible(hall==='arcade'&&Boolean(g.reply));
    const person = getPerson(g.target);
    if (person && ['grab','carry','throw'].includes(g.phase)) {
      const lift = g.phase==='grab'?g.progress:1;
      const flight = g.phase==='throw'?g.progress:0;
      const py = y - 60*lift + flight*135 - Math.sin(flight*Math.PI)*55;
      person.sprite.setPosition(x+12*lift+flight*18,py).setAngle(80*lift+flight*200).setDepth(y+1);
      person.shadow.setPosition(x+flight*18,y+flight*80).setScale(1-flight*.5).setDepth(y-1);
      person.label?.setVisible(false);
    }
  }
}
