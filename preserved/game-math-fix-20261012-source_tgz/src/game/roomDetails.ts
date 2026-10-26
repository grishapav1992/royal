import Phaser from 'phaser';
import type { Cabinet } from '../shared/cabinets';
import type { HallId } from '../shared/world';
import { CABINET_SCALE, CABINET_SIZE, cabinetScreen } from './cabinetArt';
import { isStudioGame, STUDIO_INFO } from '../shared/studioGames';
import { isCardGame } from '../shared/cardTables';

/** Decorative layers share the scene's existing floor coordinates. */
export class RoomDetails {
  private screens: Phaser.GameObjects.Graphics[] = [];
  private lastFrame = -1;
  private reducedMotion: boolean;
  constructor(private scene: Phaser.Scene, private cabinets: Cabinet[], private hall: HallId) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cabinets = cabinets.filter(cabinet => !isCardGame(cabinet.id));
    this.walls();
    this.cabinets.forEach(c => {
      const bounds = cabinetScreen(c);
      const screen = scene.add.graphics({
        x: c.x + (bounds.x - CABINET_SIZE.width / 2) * CABINET_SCALE,
        y: c.y + (bounds.y - CABINET_SIZE.height) * CABINET_SCALE,
      }).setScale(CABINET_SCALE * bounds.width / 46, CABINET_SCALE * bounds.height / 42).setDepth(c.y + .2);
      this.screens.push(screen);
    });
    this.update(0);
  }
  private walls() {
    const s = this.scene, g = s.add.graphics().setDepth(2);
    const art = (key: string, x: number, y: number, w: number, h: number) =>
      s.add.image(x, y, key).setOrigin(0).setDisplaySize(w, h).setDepth(2);
    if (this.hall === 'arcade' || this.hall === 'github') {
      art('window-city', 132, 74, 110, 90);
      art('casino-suits', 710, 74, 110, 90);
      art('casino-chips', 266, 77, 70, 82);
      art(this.hall === 'github' ? 'casino-chips' : 'casino-sevens', 975, 84, this.hall === 'github' ? 70 : 36, 76);
      g.fillStyle(0x1e3039).fillRoundedRect(79, 99, 26, 53, 3);
      g.lineStyle(1, 0xa68e67).strokeRoundedRect(79, 99, 26, 53, 3);
      for (const [y, radius] of [[112, 6], [135, 8]]) {
        g.fillStyle(0x63716e).fillCircle(92, y, radius);
        g.fillStyle(0x293c45).fillCircle(92, y, radius / 2);
      }
      art('club-sconce', 816, 80, 22, 76);
    } else {
      art('club-books', 132, 74, 110, 90);
      art('billiard-cues', 258, 79, 80, 78);
      art('club-clock', 76, 79, 42, 76);
      g.fillStyle(0x2e3035).fillRoundedRect(972, 87, 35, 66, 2);
      for (const x of [981, 991, 1001]) {
        g.lineStyle(2, 0xd4bc86).lineBetween(x, 94, x, 144);
        g.lineStyle(2, 0x6f927e).lineBetween(x, 94, x, 107);
      }
      g.fillStyle(0xb0956b).fillRect(975, 145, 29, 3);
      // The club uses practical reading lamps, instead of the casino's brass fixtures.
      g.fillStyle(0x5a674c).fillRect(860, 110, 4, 32);
      g.fillStyle(0x355b42).fillTriangle(849, 116, 862, 96, 875, 116);
      g.fillStyle(0xc4b580).fillRect(849, 116, 26, 3);
      g.fillStyle(0x806c46).fillRect(854, 140, 16, 3);
    }
    if(this.hall==='arcade'||this.hall==='github')art('club-sconce', 336, 80, 36, 76);
    else{
      g.fillStyle(0x5a674c).fillRect(348, 110, 4, 32);
      g.fillStyle(0x355b42).fillTriangle(337, 116, 350, 96, 363, 116);
      g.fillStyle(0xc4b580).fillRect(337, 116, 26, 3);
      g.fillStyle(0x806c46).fillRect(342, 140, 16, 3);
    }
  }
  update(time:number) {
    const frame=this.reducedMotion?0:Math.floor(time/110);
    if(frame===this.lastFrame)return;
    this.lastFrame=frame;
    this.screens.forEach((g,i)=>{
      g.clear().fillStyle(0x081420).fillRect(0,0,46,42);
      const color=this.cabinets[i]!.color;
      const cabinetId=this.cabinets[i]!.id;
      g.fillStyle(color,.08).fillRect(2,2,42,37);
      if(this.cabinets[i]!.provider){
        // The multi-game terminal previews roulette, cards and slots in turn.
        const preview=Math.floor(frame/64)%3;
        if(preview===0){
          g.lineStyle(2,0xb89965).strokeCircle(23,21,14);
          for(let n=0;n<12;n++){
            const angle=n*Math.PI/6;
            g.fillStyle(n%2?0xc47982:0x668c82).fillCircle(23+Math.cos(angle)*10,21+Math.sin(angle)*10,2.4);
          }
          g.fillStyle(0xe5d7ad).fillCircle(23+Math.cos(frame*.045)*13,21+Math.sin(frame*.045)*13,1.3);
          g.fillStyle(0xb89965).fillCircle(23,21,3);
        }else if(preview===1){
          g.fillStyle(0xebddbc).fillRoundedRect(8,6,16,26,2).fillRoundedRect(24,10,14,26,2);
          g.fillStyle(0x315365).fillTriangle(16,12,12,20,20,20).fillRect(15,19,2,5);
          g.fillStyle(0xc17c83).fillTriangle(31,17,27,23,31,29).fillTriangle(31,17,35,23,31,29);
        }else{
          for(let reel=0;reel<3;reel++){
            g.fillStyle(0x274453).fillRoundedRect(5+reel*13,9,10,23,2);
            g.fillStyle([0xbba06a,0x77b9a5,0xc58996][reel]!).fillCircle(10+reel*13,16+(frame+reel*4)%11,3);
          }
        }
      }else if(isStudioGame(cabinetId)){
        const info=STUDIO_INFO[cabinetId];
        if(info.kind==='slot'){
          const cols=info.cols,rows=Math.min(info.rows,5),w=38/cols,h=29/rows;
          for(let col=0;col<cols;col++)for(let row=0;row<rows;row++){
            const x=4+col*w,y=5+row*h,symbol=(col*3+row+Math.floor(frame/20))%6;
            g.fillStyle(0x254053).fillRoundedRect(x,y,w-1,h-1,1);
            g.fillStyle(symbol===3?0xf1d58a:symbol===4?0xe3acdd:color,.85);
            if(info.features.includes('hold')&&symbol>=4)g.fillCircle(x+w/2,y+h/2,Math.min(w,h)*.28);
            else if(info.features.includes('cluster')||info.features.includes('tumble'))g.fillTriangle(x+w/2,y+1,x+1,y+h-2,x+w-2,y+h-2);
            else g.fillRect(x+w*.28,y+h*.26,w*.38,h*.42);
          }
          g.lineStyle(1.2,0xf1d58a,.8);
          if(info.paylines.length)g.lineBetween(4,5+Math.floor(rows/2)*h+h/2,42,5+Math.floor(rows/2)*h+h/2);
          else g.lineBetween(4,37,42,37);
          for(let n=0;n<Math.min(info.features.length+1,4);n++)g.fillStyle(color,.7).fillCircle(17+n*4,39,1.1);
        }else if(info.kind==='wheel'){
          g.lineStyle(2,color).strokeCircle(23,23,15);
          for(let n=0;n<12;n++){const angle=n*Math.PI/6+frame*.024;g.fillStyle(n%3===0?0xf1d58a:color,.8).fillCircle(23+Math.cos(angle)*11,23+Math.sin(angle)*11,2);}
          g.fillStyle(0xf6e3b1).fillTriangle(20,3,26,3,23,9);
        }else if(info.kind==='plinko'){
          for(let row=0;row<7;row++)for(let col=0;col<=row;col++)g.fillStyle(0xaac7d1).fillCircle(23+(col-row/2)*5,5+row*4,.8);
          const progress=frame%28;g.fillStyle(color).fillCircle(23+Math.sin(progress*.7)*progress*.18,5+progress,2);
          g.fillStyle(0xf1d58a).fillRect(3,35,40,3);
        }else if(info.kind==='mines'||info.kind==='keno'){
          for(let cell=0;cell<(info.kind==='mines'?16:20);cell++){const x=6+cell%4*9,y=3+Math.floor(cell/4)*7;g.fillStyle((cell+Math.floor(frame/14))%7===0?color:0x29485a).fillRoundedRect(x,y,7,5,1);}
        }else if(info.kind==='dice'){
          g.fillStyle(0x345c68).fillRoundedRect(5,13,36,10,2);g.fillStyle(color).fillRoundedRect(5+frame%26,13,10,10,2);g.lineStyle(1,0xf1d58a).lineBetween(23,7,23,31);
        }else{
          g.lineStyle(1,color,.6).lineBetween(4,35,12,29).lineBetween(12,29,21,22).lineBetween(21,22,37,10);
          const progress=frame%30,x=5+progress,y=34-progress*.75;
          g.fillStyle(0xf1d58a).fillTriangle(x+5,y,x-3,y-3,x-3,y+3);
          for(let n=0;n<4;n++)g.fillStyle(color,.6).fillCircle(8+n*9,7,1.1);
        }
      }else if(this.cabinets[i]!.github){
        const id=this.cabinets[i]!.id;
        if(id==='github-craps'){
          for(let die=0;die<2;die++){
            const x=6+die*19,y=11+die*4,value=1+(Math.floor(frame/12)+die*3)%6;
            g.fillStyle(0xebddbc).fillRoundedRect(x,y,15,15,2);
            const pips=value===1?[[7.5,7.5]]:value===2?[[4,4],[11,11]]:value===3?[[4,4],[7.5,7.5],[11,11]]:value===4?[[4,4],[11,4],[4,11],[11,11]]:value===5?[[4,4],[11,4],[7.5,7.5],[4,11],[11,11]]:[[4,3],[11,3],[4,7.5],[11,7.5],[4,12],[11,12]];
            for(const [px,py] of pips)g.fillStyle(0x203842).fillCircle(x+px,y+py,1.2);
          }
        }else{
          const count=id==='github-video-poker'||id==='github-poker'?5:2,width=count===5?7:14,gap=count===5?1:4,start=(46-count*width-(count-1)*gap)/2;
          for(let card=0;card<count;card++){
            const x=start+card*(width+gap),y=count===5?13:9+card*4;
            g.fillStyle(0xebddbc).fillRoundedRect(x,y,width,23,1);
            g.fillStyle(card%2?0xc17c83:0x315365).fillCircle(x+width/2,y+10,width/4);
            g.fillStyle(color).fillRect(x+2,y+3,2,3);
          }
        }
      }else if(this.cabinets[i]!.id === 'variant-target-plinko'){
        for(let row=0;row<7;row++)for(let col=0;col<=row;col++)g.fillStyle(0xaac7d1).fillCircle(23+(col-row/2)*5,5+row*4,.8);
        const progress=frame%28;
        g.fillStyle(color).fillCircle(23+Math.sin(progress*.7)*progress*.18,5+progress,2);
        for(let slot=0;slot<8;slot++)g.fillStyle(slot===3||slot===4?color:0x355166).fillRect(3+slot*5,35,4,4);
        g.lineStyle(1,0xf1d28e).strokeRect(17,34,12,6);
      }else if(this.cabinets[i]!.id === 'variant-triple-poker'){
        for(let card=0;card<3;card++){
          const x=5+card*13,y=10+Math.abs(card-1)*3;
          g.fillStyle(0xebddbc).fillRoundedRect(x,y,11,25,1);
          g.fillStyle(card===2?0x315365:0xc17c83).fillCircle(x+5.5,y+12,2.3);
          g.fillStyle(color).fillRect(x+2,y+3,2,3);
        }
        g.lineStyle(1.5,color).lineBetween(6,38,28,38);
        g.fillStyle(color).fillCircle(17,5,2).fillCircle(23,5,2);
      }else if(this.cabinets[i]!.id === 'variant-dice-streak'){
        for(let die=0;die<5;die++){
          const x=3+die*8,y=14,value=1+(Math.floor(frame/12)+die*2)%6,hit=value>=4;
          g.fillStyle(hit?color:0xd9d5ca).fillRoundedRect(x,y,6,9,1);
          g.fillStyle(0x203842);if(value%2)g.fillCircle(x+3,y+4.5,1);
          if(value>=2)g.fillCircle(x+1.5,y+2,0.6).fillCircle(x+4.5,y+7,0.6);
          if(value>=4)g.fillCircle(x+4.5,y+2,0.6).fillCircle(x+1.5,y+7,0.6);
          if(value===6)g.fillCircle(x+1.5,y+4.5,0.6).fillCircle(x+4.5,y+4.5,0.6);
          g.fillStyle(hit?color:0x355166).fillRoundedRect(x,29,6,4,1);
        }
        g.lineStyle(1,color,.5).lineBetween(4,8,42,8);
      }else if(this.cabinets[i]!.id === 'variant-gem-collection'){
        const gems=[0x84d5c2,0xeb9bad,0xf4cf7f,0xa79beb,0x84d5c2];
        for(let gem=0;gem<3;gem++)g.lineStyle(1.3,gems[gem]).strokeCircle(12+gem*11,7,3.5);
        for(let gem=0;gem<5;gem++){
          const x=8+gem*7.5,y=24+(gem%2)*4;
          g.fillStyle(gems[gem]).fillTriangle(x,y-5,x-4,y,x+4,y).fillTriangle(x-4,y,x+4,y,x,y+5);
          g.lineStyle(.6,0xe6f4ea).lineBetween(x-2,y-1,x,y-4);
        }
        g.lineStyle(1,color).lineBetween(7,37,39,37);
      }else if(this.cabinets[i]!.id === 'variant-double-mines'){
        const first=Math.floor(frame/18)%8,second=15-first;
        for(let cell=0;cell<16;cell++){
          const x=6+cell%4*9,y=4+Math.floor(cell/4)*9;
          g.fillStyle(cell===first||cell===second?color:0x274453).fillRoundedRect(x,y,7,7,1);
          if(cell===first||cell===second)g.fillStyle(0xecedca).fillCircle(x+3.5,y+3.5,1.2);
        }
        g.lineStyle(1,color,.6).lineBetween(9.5+first%4*9,7.5+Math.floor(first/4)*9,9.5+second%4*9,7.5+Math.floor(second/4)*9);
      }else if(this.cabinets[i]!.id === 'variant-blackjack-target'){
        for(let card=0;card<3;card++){
          const x=6+card*12,y=14+card*2;
          g.fillStyle(0xebddbc).fillRoundedRect(x,y,10,22,1);
          g.fillStyle(card%2?0xc17c83:0x315365).fillCircle(x+5,y+10,2);
          g.fillStyle(color).fillRect(x+2,y+3,2,3);
        }
        g.lineStyle(1.5,color).lineBetween(15,4,22,4).lineBetween(22,4,22,8).lineBetween(22,8,15,8).lineBetween(15,8,15,12).lineBetween(15,12,22,12);
        g.lineBetween(27,4,29,4).lineBetween(29,4,29,12);
      }else if(this.cabinets[i]!.id === 'royal-flight'){
        for(let n=0;n<16;n++)g.fillStyle(n%3?0x8199b5:0xffffff,.65).fillCircle(3+(n*13-frame*.3+frame*46)%40,3+n*17%33,n%4===0?1:.5);
        const x=24+Math.sin(frame*.045)*5,y=21-Math.cos(frame*.035)*3;
        g.fillStyle(0x3ccecb,.35).fillTriangle(x-3,y-1,x-16,y-4,x-16,y+4);
        g.fillStyle(0xf6e6bb).fillTriangle(x+10,y,x-6,y-6,x-6,y+6);
        g.fillStyle(0x83e9dd).fillCircle(x+1,y-1,2);
      }else if(this.cabinets[i]!.id === 'royal-wheel'){
        g.lineStyle(2,0xdbb879).strokeCircle(23,23,16);
        for(let n=0;n<12;n++){
          const angle=n*Math.PI/6+frame*.024;
          g.fillStyle(n%3===0?0xf3cc83:n%2?0x705c85:0x3c6568).fillCircle(23+Math.cos(angle)*11,23+Math.sin(angle)*11,2.5);
        }
        g.fillStyle(0xf6e3b1).fillTriangle(20,3,26,3,23,10);
        g.fillStyle(0xd4ac64).fillCircle(23,23,4);
      }else if(this.cabinets[i]!.id === 'royal-dice'){
        g.fillStyle(color).fillRoundedRect(11,9,24,24,4);
        for(const [x,y] of [[16,14],[30,14],[23,21],[16,28],[30,28]])g.fillStyle(0x10212e).fillCircle(x!,y!,1.8);
      }else if(this.cabinets[i]!.id === 'royal-mines'){
        for(let row=0;row<5;row++)for(let col=0;col<5;col++){
          const opened=(row*5+col+Math.floor(frame/12))%8===0;
          g.fillStyle(opened?color:0x274453).fillRoundedRect(5+col*7.5,4+row*7,6,5.5,1);
        }
      }else if(this.cabinets[i]!.id === 'royal-plinko'){
        for(let row=0;row<7;row++)for(let col=0;col<=row;col++)g.fillStyle(0xaac7d1).fillCircle(23+(col-row/2)*5,5+row*4,0.8);
        const progress=frame%28;
        g.fillStyle(color).fillCircle(23+Math.sin(progress*.7)*progress*.18,5+progress,2);
        for(let slot=0;slot<8;slot++)g.fillStyle(slot<2||slot>5?color:0x59758d).fillRect(3+slot*5,35,4,4);
      }else if(this.cabinets[i]!.id === 'royal-limbo'){
        g.lineStyle(2,color).lineBetween(7,32,16,27).lineBetween(16,27,25,21).lineBetween(25,21,36,7);
        g.fillStyle(color).fillTriangle(36,7,29,9,35,14);
        g.fillStyle(color,.4).fillRect(7,35,31,1);
      }else if(this.cabinets[i]!.id === 'royal-keno'){
        for(let row=0;row<5;row++)for(let col=0;col<8;col++)g.fillStyle((row*8+col+Math.floor(frame/16))%7===0?color:0x355166).fillRoundedRect(3+col*5,5+row*6.5,3.6,4.5,1);
      }else if(this.cabinets[i]!.demo || this.cabinets[i]!.wallet){
        for(let reel=0;reel<3;reel++){
          g.fillStyle(0x243145).fillRoundedRect(5+reel*13,9,10,23,2);
          g.fillStyle(color).fillCircle(10+reel*13,16+(frame+reel*4)%11,3);
        }
      }else if(i===0){
        for(let row=0;row<3;row++)for(let col=0;col<5;col++){
          if((row*5+col+Math.floor(frame/14))%17===0)continue;
          g.fillStyle([0xc9f56b,0x7edba8,0x69adba][row]!).fillRect(5+col*7,5+row*5,5,3);
        }
        const ballX=23+Math.sin(frame*.23)*16,ballY=25+Math.cos(frame*.31)*10;
        g.fillStyle(0xe8ffd3).fillRect(ballX,ballY,2,2);
        g.fillStyle(color).fillRect(16+Math.sin(frame*.23)*12,35,14,2);
      }else if(i===1){
        for(let n=0;n<17;n++)g.fillStyle(n%3?0x7984aa:0xe0d0ff).fillRect(3+(n*13%40),3+(n*7+frame)%33,1,1);
        const x=22+Math.sin(frame*.12)*9;
        g.fillStyle(color).fillTriangle(x,26,x-4,33,x+4,33);
        g.fillStyle(0xf4c889).fillRect(x-1,34,2,frame%2?3:1);
        g.fillStyle(0xedbfe0).fillRect(8+frame*2%30,8,4,2);
      }else if(i===2){
        g.fillStyle(0x3c5e70).fillTriangle(20,3,3,39,44,39);
        g.lineStyle(1,color,.6).lineBetween(20,4,6,38);g.lineBetween(26,4,42,38);
        for(let n=0;n<4;n++)g.fillStyle(0xbbddd6).fillRect(22,5+(n*9+frame*2)%32,2,4);
        const x=20+Math.round(Math.sin(frame*.15)*5);
        g.fillStyle(0x050a15).fillRect(x-1,27,8,10);g.fillStyle(color).fillRect(x,26,6,10);
        g.fillStyle(0xd2eeec).fillRect(x+1,28,4,2);g.fillStyle(0xf591ae).fillRect(x,34,2,1);
      }else{
        for(let n=0;n<6;n++)g.fillStyle(0x49506b).fillRect(n*8,33-(n%3)*8,7,2);
        g.fillStyle(color).fillRect(5+frame*2%33,24-Math.round(Math.abs(Math.sin(frame*.2))*12),5,7);
        g.fillStyle(0xf6d891).fillRect(32,9,3,4);g.fillStyle(color,.5).fillRect(31,11,5,1);
      }

    });
  }
}
