import { t as translateText } from '../i18n/index';
import { gameAudio } from './GameAudio';
import Phaser from 'phaser';
import type { BreakerStatus } from './breaker';
export type ArcadeMode = 'orbit' | 'drift' | 'pixel';
export const MAZE = [
  '#############',
  '#...#.......#',
  '#.#.#.###.#.#',
  '#.#...#...#.#',
  '#.#####.#.#.#',
  '#.......#...#',
  '#.###.#####.#',
  '#...#.......#',
  '#############',
];
export function createArcade(parent: HTMLElement, mode: ArcadeMode, onStatus: (s: BreakerStatus) => void) {
  class Arcade extends Phaser.Scene {
    private state: BreakerStatus = {score:0,lives:3,phase:'ready'};
    private art!: Phaser.GameObjects.Graphics;
    private text!: Phaser.GameObjects.Text;
    private keys!: Phaser.Types.Input.Keyboard.CursorKeys;
    private x=320;
    private elapsed=0;
    private shotAt=0;
    private spawnAt=0;
    private invincible=0;
    private shots: {x:number;y:number}[]=[];
    private enemies: {x:number;y:number;speed:number;hp:number}[]=[];
    private lane=1;
    private distance=0;
    private dodged=0;
    private obstacles: {lane:number;y:number;coin:boolean}[]=[];
    private cell={x:1,y:1};
    private gems = new Set<string>();
    private mazeTime=75;
    private stepAt=0;
    private lastScore=-1;private lastPhase='ready';
    private pointerTarget: {x:number;y:number}|null=null;
    constructor(){super(mode);}
    create(){
      this.art=this.add.graphics();
      this.text=this.add.text(320,17,'',{fontFamily:'Arial',fontStyle:'bold',fontSize:'13px',color:'#fff1ca',backgroundColor:'#497867',padding:{x:8,y:4}}).setOrigin(.5,0);
      this.keys=this.input.keyboard!.createCursorKeys();
      this.input.keyboard!.on('keydown-SPACE',()=>this.start());
      this.input.keyboard!.on('keydown-LEFT',()=>{if(mode==='drift')this.lane=Math.max(0,this.lane-1);});
      this.input.keyboard!.on('keydown-RIGHT',()=>{if(mode==='drift')this.lane=Math.min(2,this.lane+1);});
      this.input.on('pointermove',(p:Phaser.Input.Pointer)=>{if(mode==='orbit')this.x=Phaser.Math.Clamp(p.x,35,605);});
      this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{
        if(this.state.phase!=='playing')return;
        if(mode==='drift')this.lane=Phaser.Math.Clamp(Math.floor((p.x-170)/100),0,2);
        if(mode==='orbit')this.x=Phaser.Math.Clamp(p.x,35,605);
        if(mode==='pixel')this.pointerTarget={x:Math.floor((p.x-60)/40),y:Math.floor((p.y-55)/40)};
      });
      this.restart();
    }
    start(){if(this.state.phase==='playing')return;if(this.state.phase==='won'||this.state.phase==='lost')this.restart();this.state.phase='playing';gameAudio.setGame(mode);gameAudio.effect('start');this.publish();}
    restart(){
      this.state={score:0,lives:mode==='pixel'?1:3,phase:'ready'};this.elapsed=0;this.shotAt=0;this.spawnAt=0;this.invincible=0;this.x=320;this.lane=1;this.distance=0;this.dodged=0;
      this.shots=[];this.enemies=[];this.obstacles=[];this.cell={x:1,y:1};this.mazeTime=75;this.stepAt=0;this.pointerTarget=null;
      this.gems=new Set(['3,1','11,1','1,7','7,3','7,7']);this.lastScore=-1;this.publish();this.draw();
    }
    private publish(){if(this.state.phase!==this.lastPhase){if(this.state.phase==='won'||this.state.phase==='lost'){gameAudio.effect(this.state.phase==='won'?'win':'lose');gameAudio.setGame('mini');}this.lastPhase=this.state.phase;}onStatus({...this.state});this.lastScore=this.state.score;}
    getState(){return {...this.state,mode,x:this.x,lane:this.lane,distance:this.distance,dodged:this.dodged,enemies:this.enemies.map(e=>({...e})),cell:{...this.cell},gems:[...this.gems],maze:MAZE,timeLeft:this.mazeTime,obstacles:this.obstacles.map(o=>({...o}))};}
    private damage(){if(this.elapsed<this.invincible)return;gameAudio.effect(mode==='drift'?'crash':'explosion');this.state.lives--;this.invincible=this.elapsed+1.3;if(!this.state.lives)this.state.phase='lost';this.publish();}
    update(_time:number,delta:number){
      if(!this.art)return;
      const dt=Math.min(delta,40)/1000;
      if(this.state.phase==='playing'){
        this.elapsed+=dt;
        if(mode==='orbit')this.orbit(dt);else if(mode==='drift')this.drift(dt);else this.pixel(dt);
        if(this.state.score!==this.lastScore)this.publish();
      }
      this.draw();
    }
    private orbit(dt:number){
      if(this.keys.left.isDown)this.x-=dt*350;if(this.keys.right.isDown)this.x+=dt*350;this.x=Phaser.Math.Clamp(this.x,30,610);
      if(this.elapsed>this.shotAt){gameAudio.effect('laser');this.shots.push({x:this.x,y:359});this.shotAt=this.elapsed+.18;}
      if(this.elapsed>this.spawnAt){this.enemies.push({x:45+Math.random()*550,y:45,speed:65+Math.random()*40+this.elapsed*.7,hp:1});this.spawnAt=this.elapsed+.62;}
      for(const shot of this.shots){shot.y-=dt*480;const hit=this.enemies.find(e=>e.hp>0&&Math.abs(e.x-shot.x)<23&&Math.abs(e.y-shot.y)<20);if(hit){gameAudio.effect('explosion',.6);hit.hp=0;shot.y=-20;this.state.score+=100;}}
      for(const e of this.enemies){e.y+=e.speed*dt;if(e.hp>0&&e.y>355&&Math.abs(e.x-this.x)<29){e.hp=0;this.damage();}else if(e.hp>0&&e.y>425){e.hp=0;this.damage();}}
      this.enemies=this.enemies.filter(e=>e.hp>0);this.shots=this.shots.filter(s=>s.y>30);
      if(this.state.score>=2000&&this.state.phase==='playing'){this.state.phase='won';this.publish();}
    }
    private drift(dt:number){
      this.x=Phaser.Math.Linear(this.x,220+this.lane*100,Math.min(1,dt*12));this.distance+=dt*25;gameAudio.engineSpeed(this.distance/1000);
      if(this.elapsed>this.spawnAt){const lane=Math.floor(Math.random()*3);this.obstacles.push({lane,y:40,coin:false});this.obstacles.push({lane:(lane+1+Math.floor(Math.random()*2))%3,y:5,coin:true});this.spawnAt=this.elapsed+.95;}
      for(const o of this.obstacles){o.y+=dt*(155+this.elapsed*1.8);if(o.y>344&&o.y<400&&Math.abs(220+o.lane*100-this.x)<38){if(o.coin){this.state.score+=50;gameAudio.effect('coin');}else this.damage();o.y=500;}}
      for(const o of this.obstacles)if(o.y>450&&!o.coin)this.dodged++;
      this.obstacles=this.obstacles.filter(o=>o.y<=450);
      this.state.score=Math.max(this.state.score,Math.floor(this.distance));
      if(this.distance>=1000&&this.state.phase==='playing'){this.state.phase='won';this.state.score+=500;this.publish();}
    }
    private pixel(dt:number){
      this.mazeTime-=dt;
      if(this.mazeTime<=0){this.state.phase='lost';this.state.lives=0;this.publish();return;}
      if(this.elapsed<this.stepAt)return;
      let dx=Number(this.keys.right.isDown)-Number(this.keys.left.isDown),dy=Number(this.keys.down.isDown)-Number(this.keys.up.isDown);
      if(this.pointerTarget && !dx&&!dy){
        const queue=[{...this.cell,path:[] as {x:number;y:number}[]}],visited=new Set<string>();
        while(queue.length){const cur=queue.shift()!;if(cur.x===this.pointerTarget.x&&cur.y===this.pointerTarget.y){const next=cur.path[0];if(next){dx=next.x-this.cell.x;dy=next.y-this.cell.y;}else this.pointerTarget=null;break;}
          for(const [mx,my] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=cur.x+mx,y=cur.y+my,key=x+','+y;if(MAZE[y]?.[x]!=='.'||visited.has(key))continue;visited.add(key);queue.push({x,y,path:[...cur.path,{x,y}]});}}
      }
      if(dx||dy){if(dx)dy=0;const x=this.cell.x+dx,y=this.cell.y+dy;
        if(MAZE[y]?.[x]==='.') {this.cell={x,y};gameAudio.effect('maze');if(this.gems.delete(x+','+y)){this.state.score+=200;gameAudio.effect('coin');}}
        this.stepAt=this.elapsed+.13;
      }
      if(!this.gems.size&&this.cell.x===11&&this.cell.y===7){this.state.phase='won';this.state.score+=Math.floor(this.mazeTime)*10;this.publish();}
    }
    private draw(){
      const g=this.art;g.clear().fillStyle(mode==='orbit'?0x334d66:0xf4ead0).fillRect(0,0,640,450);
      if(mode==='orbit'){
        for(let i=0;i<65;i++)g.fillStyle(i%3?0x536b91:0xb5c1e2).fillRect(i*137%630,40+(i*83+this.elapsed*25)%390,i%4?1:2,2);
        g.fillStyle(0xf0d585).fillCircle(530,105,52);g.lineStyle(2,0x342f2a).strokeCircle(530,105,52);g.fillStyle(0xcfb568).fillCircle(512,90,12);g.fillCircle(546,123,8);
        for(const s of this.shots)g.fillStyle(0xabedee).fillRect(s.x-2,s.y,4,14);
        for(const e of this.enemies){g.fillStyle(0x9879c1).fillTriangle(e.x-22,e.y-12,e.x+22,e.y-12,e.x,e.y+17);g.fillStyle(0xefbadc).fillRect(e.x-6,e.y-8,12,10);}
        if(this.elapsed>this.invincible||Math.floor(this.elapsed*12)%2){g.fillStyle(0x88dcd5).fillTriangle(this.x,352,this.x-20,392,this.x+20,392);g.fillStyle(0xf5d391).fillTriangle(this.x-6,390,this.x+6,390,this.x,405+Math.sin(this.elapsed*20)*5);g.fillStyle(0xe4f4ed).fillRect(this.x-4,367,8,13);}
        this.text.setText(translateText('SPACE ORBIT  /  СБЕЙ 20 КОРАБЛЕЙ'));
      }else if(mode==='drift'){
        g.fillStyle(0x707c79).fillRect(168,40,304,400);g.lineStyle(3,0x342f2a).strokeRect(165,40,310,400);
        for(let y=-20;y<450;y+=58)for(const x of [270,370])g.fillStyle(0xfff5d2).fillRect(x-2,40+(y+this.distance*4)%400,4,26);
        for(let i=0;i<8;i++){
          const y=45+(i*62+this.distance*3)%390;
          for(const x of [96,542]){g.fillStyle(0x795639).fillRect(x-3,y,6,24);g.fillStyle(0x467958).fillTriangle(x-25,y+12,x,y-36,x+25,y+12);g.fillStyle(0xfffdf1).fillTriangle(x-14,y-12,x,y-36,x+14,y-12);}
        }
        for(const o of this.obstacles){const x=220+o.lane*100;if(o.coin){g.fillStyle(0xf0d187).fillCircle(x,o.y,10);g.lineStyle(2,0xb68455).strokeCircle(x,o.y,6);}else this.car(x,o.y,0xc7749a);}
        if(this.elapsed>this.invincible||Math.floor(this.elapsed*12)%2)this.car(this.x,373,0x74d5d8);
        this.text.setText('NIGHT DRIFT  /  '+Math.min(1000,Math.floor(this.distance))+translateText(' / 1000 М'));
      }else{
        for(let y=0;y<9;y++)for(let x=0;x<13;x++){
          const px=60+x*40,py=55+y*40;
          g.fillStyle(MAZE[y][x]==='#'?0x5b9068:0xf7efd9).fillRoundedRect(px+1,py+1,38,38,3);
          if(MAZE[y][x]==='#'){g.fillStyle(0x85ad78).fillRect(px+3,py+3,34,4);g.fillStyle(0x487353).fillRect(px+3,py+29,34,8);}
        }
        for(const gem of this.gems){const [x,y]=gem.split(',').map(Number);g.fillStyle(0xe15d73).fillTriangle(80+x*40,65+y*40,70+x*40,76+y*40,90+x*40,76+y*40);g.fillTriangle(70+x*40,76+y*40,90+x*40,76+y*40,80+x*40,89+y*40);}
        g.fillStyle(this.gems.size?0x5f586e:0xb4e490).fillRoundedRect(60+11*40+7,55+7*40+6,26,29,4);
        const px=80+this.cell.x*40,py=75+this.cell.y*40;
        g.fillStyle(0xdb533c).fillRoundedRect(px-11,py-1,22,15,3);
        g.fillStyle(0x342f2a).fillRect(px-11,py+13,10,3);g.fillRect(px+1,py+13,10,3);
        g.fillStyle(0xf0bf90).fillCircle(px,py-7,12);g.lineStyle(1,0x342f2a).strokeCircle(px,py-7,12);
        g.fillStyle(0xffffff).fillEllipse(px-4,py-7,8,10);g.fillEllipse(px+4,py-7,8,10);
        g.fillStyle(0x342f2a).fillCircle(px-2,py-7,1);g.fillCircle(px+2,py-7,1);
        g.fillStyle(0x419dad).fillRoundedRect(px-12,py-19,24,7,3);g.fillStyle(0xf2c745).fillRect(px-12,py-14,24,3);

        this.text.setText(translateText('PIXEL QUEST  /  КРИСТАЛЛЫ ')+(5-this.gems.size)+'/5  /  '+Math.max(0,Math.ceil(this.mazeTime))+translateText(' С'));
      }
    }
    private car(x:number,y:number,color:number){const g=this.art;g.fillStyle(0x080c14).fillRoundedRect(x-22,y-31,44,62,5);g.fillStyle(color).fillRoundedRect(x-17,y-29,34,58,5);g.fillStyle(0x293d53).fillRect(x-13,y-16,26,15);g.fillStyle(0xa5dcdf).fillRect(x-11,y-14,22,3);g.fillStyle(0xefdeb0).fillRect(x-16,y-26,7,4);g.fillRect(x+9,y-26,7,4);g.fillStyle(0xdb82a2).fillRect(x-15,y+22,6,4);g.fillRect(x+9,y+22,6,4);}
  }
  const scene=new Arcade();
  const game=new Phaser.Game({type:Phaser.AUTO,parent,width:640,height:450,backgroundColor:'#0b1120',scene:[scene],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},audio:{noAudio:true},banner:false});
  return {game,start:()=>scene.start(),restart:()=>scene.restart(),getState:()=>scene.getState()};
}
