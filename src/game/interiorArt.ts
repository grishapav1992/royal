import { t as translateText } from '../i18n/index';
import { FLOOR } from '../shared/clubGeometry';
import type Phaser from 'phaser';
import { CABINETS } from '../shared/cabinets';
import type { HallId } from '../shared/world';

type Paint = CanvasRenderingContext2D;
const brass = '#c6a16b';
const line = (c: Paint, x: number, y: number, x2: number, y2: number, color = brass, width = 1) => {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
};
const rect = (c: Paint, x: number, y: number, w: number, h: number, color: string, radius = 0) => {
  c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill();
};
const oval = (c: Paint, x: number, y: number, rx: number, ry: number, color: string, rotation = 0) => {
  c.beginPath(); c.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2); c.fillStyle = color; c.fill();
};
const label = (c: Paint, text: string, x: number, y: number, size: number, color = brass) => {
  c.font = `bold ${size}px Arial, sans-serif`; c.textAlign = 'center'; c.fillStyle = color; c.fillText(text, x, y);
};
const diamond = (c: Paint, x: number, y: number, size: number, color: string) => {
  c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size, y); c.lineTo(x, y + size); c.lineTo(x - size, y); c.closePath(); c.fillStyle = color; c.fill();
};
function rug(c: Paint, x: number, y: number, w: number, h: number, color: string, edge: string) {
  rect(c, x, y, w, h, '#272631', 6); rect(c, x + 3, y + 3, w - 6, h - 6, color, 4);
  c.strokeStyle = edge; c.lineWidth = 1.2; c.strokeRect(x + 8, y + 8, w - 16, h - 16);
  c.globalAlpha = .45; c.strokeRect(x + 12, y + 12, w - 24, h - 24); c.globalAlpha = 1;
  for (const px of [x + 22, x + w - 22]) for (const py of [y + 22, y + h - 22]) diamond(c, px, py, 4, edge);
}

export const plantTexture = (hall: HallId, index: number) => `plant-${hall}-${index}`;

// Large room panoramas stay within the common 4096-pixel GPU texture limit.
export function interiorRasterSize(width: number, height: number, resolution: number, panorama = false) {
  const density = Math.min(panorama ? 1 : resolution, 4096 / width, 4096 / height);
  const rasterWidth = Math.max(1, Math.floor(width * density));
  const rasterHeight = Math.max(1, Math.floor(height * density));
  return { width: rasterWidth, height: rasterHeight, scaleX: rasterWidth / width, scaleY: rasterHeight / height };
}

export function drawHallIdentity(scene: Phaser.Scene, hall: HallId) {
  const art=(key:string,x:number,y:number,w:number,h:number,depth=2)=>
    scene.add.image(x,y,key).setOrigin(.5,1).setDisplaySize(w,h).setDepth(depth);
  const lights=scene.add.graphics().setDepth(.04);
  if(hall==='arcade'){
    art('casino-marquee',540,170,342,106);
    art('casino-chandelier',282,251,64,88,3);
    art('casino-chandelier',712,243,64,88,3);
    for(const x of [282,712])lights.fillStyle(0xf4ca7e,.045).fillEllipse(x,285,154,90);
    scene.add.text(1560,113,translateText('КАЗИНО И БАР'),{fontFamily:'Georgia',fontSize:'31px',fontStyle:'bold',letterSpacing:4,color:'#d9e7ef'}).setOrigin(.5).setDepth(3);
    scene.add.text(1560,151,translateText('НОВЫЕ ИГРЫ · GITHUB · ДЕМОКАТАЛОГИ'),{fontFamily:'Arial',fontSize:'11px',letterSpacing:2,color:'#b2c8d4'}).setOrigin(.5).setDepth(3);
  }else if(hall==='github'){
    art('card-salon-sign',540,170,342,106);
    for(const x of [1240,2170,3100,4030]){
      art('casino-chandelier',x,225,62,85,3);
      lights.fillStyle(0xf4ca7e,.05).fillEllipse(x,250,175,98);
    }
    scene.add.text(2620,113,translateText('КАРТОЧНЫЙ САЛОН'),{fontFamily:'Georgia',fontSize:'30px',fontStyle:'bold',letterSpacing:3,color:'#e5d5b0'}).setOrigin(.5).setDepth(3);
    scene.add.text(2620,151,translateText('33 ИГРЫ · 33 КРУПЬЕ · ЭТАЖ 3'),{fontFamily:'Arial',fontSize:'11px',letterSpacing:2,color:'#c2d0c8'}).setOrigin(.5).setDepth(3);
  }else{
    art('billiard-sign',540,166,316,98);
    art('billiard-lamp',562,323,156,66,3);
    lights.fillStyle(0xf6e3ab,.07).fillEllipse(562,378,248,148);
  }
}

export function createInteriorArt(scene: Phaser.Scene, resolution: number) {
  const make = (key: string, w: number, h: number, draw: (c: Paint) => void) => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const raster = interiorRasterSize(w,h,resolution,key.startsWith('club-floor-')||key.startsWith('club-wall-'));
    const t = scene.textures.createCanvas(key, raster.width, raster.height)!;
    t.context.scale(raster.scaleX,raster.scaleY); t.context.lineJoin = 'round'; t.context.lineCap = 'round'; draw(t.context); t.refresh();
  };
  for (const hall of ['arcade', 'tables', 'github'] as const) {
    make('club-wall-' + hall, FLOOR.width, 112, c => {
      const casino = hall !== 'tables';
      if (casino) {
        rect(c, 0, 0, FLOOR.width, 112, '#2b1323');
        for(let x=0;x<FLOOR.width;x+=26){
          rect(c,x,12,13,78,'#461b31');
          line(c,x+3,14,x+3,85,'#71304a');
        }
        for(const x of [10,200,654,FLOOR.width-16]){
          rect(c,x,6,12,94,'#a67a36');
          rect(c,x+3,9,5,86,'#f1d190');
          rect(c,x-4,8,20,5,'#ddb365');rect(c,x-4,90,20,5,'#ddb365');
        }
        rect(c,0,0,FLOOR.width,8,'#d9b767');line(c,0,10,FLOOR.width,10,'#73512f',2);
        rect(c,0,92,FLOOR.width,20,'#261b25');
        line(c,0,92,FLOOR.width,92,'#f2cf7e',3);line(c,0,109,FLOOR.width,109,'#ad833f',2);
      }else{
        rect(c,0,0,FLOOR.width,112,'#b5a58c');
        for(let y=12;y<80;y+=17){
          line(c,0,y,FLOOR.width,y,'#9c8c76',.7);
          for(let x=(y%2)*25;x<FLOOR.width;x+=100)line(c,x,y,x,y+17,'#9c8c76',.7);
        }
        rect(c,0,0,FLOOR.width,9,'#493b2c');rect(c,0,78,FLOOR.width,34,'#4a3d30');
        for(let x=11;x<FLOOR.width;x+=70){rect(c,x,84,58,21,'#624e38',2);line(c,x+4,87,x+54,87,'#8c7252');}
        line(c,0,78,FLOOR.width,78,'#8d7251',3);line(c,0,109,FLOOR.width,109,'#342b22',3);
      }
    });
    make('club-floor-' + hall, FLOOR.width, FLOOR.height, c => {
      const casino=hall==='arcade'||hall==='github';
      rect(c,0,0,FLOOR.width,FLOOR.height,casino?hall==='github'?'#283c43':'#482238':'#95764f');
      if(casino){
        for(let y=24;y<FLOOR.height;y+=48)for(let x=26+(Math.floor(y/48)%2)*24;x<FLOOR.width;x+=48){
          c.strokeStyle=hall==='github'?'#587076':'#856058';c.lineWidth=.9;c.beginPath();c.arc(x,y,8,Math.PI,Math.PI*2);c.stroke();diamond(c,x,y+4,2.4,hall==='github'?'#a8936c':'#9e765e');
        }
      }else{
        for(let y=0,row=0;y<FLOOR.height;y+=24,row++)for(let x=-(row%2)*70;x<FLOOR.width;x+=140){
          rect(c,x+1,y+1,138,22,['#96764f','#aa875a','#8e704e'][(row+Math.floor(x/140)+3)%3]!);
          line(c,x+8,y+7,x+104,y+7,'#b7996a',.7);line(c,x+24,y+17,x+121,y+17,'#806244',.5);
        }
      }
      c.strokeStyle='#c1a16e';c.lineWidth=3;c.strokeRect(12,10,FLOOR.width-24,FLOOR.height-20);
      c.strokeStyle='#69553c';c.lineWidth=1;c.strokeRect(20,18,FLOOR.width-40,FLOOR.height-36);
    });
  }

  make('window-city', 110, 90, c => {
    rect(c, 3, 2, 104, 84, '#151e2b', 5); rect(c, 6, 4, 98, 78, brass, 4);
    rect(c, 11, 9, 88, 68, '#203345', 3);
    oval(c, 75, 24, 6, 6, '#f3deac');
    for (const [x, y, w] of [[13, 41, 16], [30, 33, 21], [54, 49, 15], [72, 39, 23]]) {
      rect(c, x!, y!, w!, 35, '#324d5d');
      for (let px = x! + 4; px < x! + w! - 2; px += 6) for (let py = y! + 5; py < 69; py += 9) rect(c, px, py, 2, 3, '#d8bc81');
    }
    line(c, 54, 11, 54, 77, '#c2a671', 3); line(c, 11, 47, 99, 47, '#c2a671', 2);
    for (const x of [9, 91]) {
      rect(c, x, 8, 10, 66, '#763b52', 3); line(c, x + 4, 12, x + 4, 70, '#ad6374');
      rect(c, x - 1, 52, 12, 3, '#dcc084');
    }
    rect(c, 1, 81, 108, 6, '#ceae7b', 1);
  });
  make('window-fan', 110, 90, c => {
    oval(c, 55, 43, 40, 40, '#16242d'); oval(c, 55, 43, 37, 37, '#bb9a65'); oval(c, 55, 43, 32, 32, '#294a58');
    c.save(); c.beginPath(); c.arc(55, 43, 31, 0, Math.PI * 2); c.clip();
    oval(c, 70, 31, 11, 11, '#e1c790');
    rect(c, 23, 52, 64, 26, '#38636b');
    for (let x = 29; x < 85; x += 11) {
      line(c, 55, 72, x, 17, '#90afa4', 1.3);
    }
    line(c, 22, 47, 88, 47, '#c5ad76', 2); c.restore();
    rect(c, 10, 82, 90, 5, '#c5a678', 1);
  });
  make('window-garden', 124, 90, c => {
    rect(c, 1, 1, 122, 84, '#251f2a', 2); rect(c, 4, 4, 116, 78, '#bd9b6c', 2);
    rect(c, 9, 9, 106, 66, '#253f49', 2);
    oval(c, 93, 23, 5, 5, '#edddad');
    for (const [x, y, r] of [[20, 60, 18], [51, 57, 21], [86, 65, 25], [111, 51, 17]]) {
      oval(c, x!, y!, r!, r!, '#3d615d');
    }
    for (const x of [43, 80]) line(c, x, 10, x, 74, '#d0b282', 3);
    line(c, 10, 40, 114, 40, '#d0b282', 2);
    for (const x of [6, 112]) {
      rect(c, x, 7, 7, 68, '#82928a', 2); line(c, x + 3, 11, x + 3, 69, '#b0b8a0');
    }
    rect(c, 0, 81, 124, 6, '#d2b888', 1);
  });
  make('club-books', 110, 90, c => {
    rect(c, 1, 2, 108, 85, '#b28e5d', 2); rect(c, 5, 6, 100, 77, '#2d3137');
    for (const y of [41, 77]) {
      for (let n = 0; n < 10; n++) {
        const x = 10 + n * 9, h = 17 + (n * 7 + y) % 12;
        rect(c, x, y - h, 6, h, ['#738f84', '#bc9570', '#b66c70', '#7991a3'][n % 4]!);
        line(c, x + 1, y - 4, x + 5, y - 4, '#e3c99b');
      }
      rect(c, 5, y, 100, 4, '#b7956b');
    }
  });
  make('club-posters', 80, 78, c => {
    rect(c, 1, 1, 36, 74, '#c8a471'); rect(c, 4, 4, 30, 68, '#e5d4b1');
    rect(c, 43, 1, 36, 74, '#c8a471'); rect(c, 46, 4, 30, 68, '#263f49');
    label(c, 'JAZZ', 19, 17, 7, '#554439');
    c.beginPath(); c.moveTo(23, 27); c.lineTo(23, 47); c.bezierCurveTo(23, 60, 9, 60, 9, 48); c.strokeStyle = '#a96655'; c.lineWidth = 5; c.stroke();
    label(c, 'AFTER', 61, 16, 5, '#e4c99c'); label(c, 'HOURS', 61, 24, 7, '#e4c99c');
    for (const x of [54, 62, 70]) {
      rect(c, x - 2, 42, 4, 16, '#d8bc8a'); oval(c, x, 40, 3, 4, '#d8bc8a'); oval(c, x, 59, 4, 2, '#d8bc8a');
    }
    line(c, 9, 65, 29, 65, '#a78862'); line(c, 51, 66, 71, 66, '#a78862');
  });
  make('club-clock', 42, 76, c => {
    oval(c, 21, 24, 20, 20, '#252b35'); oval(c, 21, 24, 17, 17, '#c8a472'); oval(c, 21, 24, 14, 14, '#eadcbb');
    for (let n = 0; n < 12; n++) {
      const a = n * Math.PI / 6;
      line(c, 21 + Math.sin(a) * 11, 24 - Math.cos(a) * 11, 21 + Math.sin(a) * 12, 24 - Math.cos(a) * 12, '#5b5147');
    }
    line(c, 21, 24, 17, 17, '#514641', 1.5); line(c, 21, 24, 30, 19, '#514641', 1.2);
    rect(c, 11, 52, 20, 17, '#b99b71', 2); label(c, 'R', 21, 64, 9, '#33343b');
  });
  make('club-sconce', 36, 76, c => {
    oval(c, 18, 29, 17, 27, '#edcd8e18');
    rect(c, 15, 22, 6, 39, '#a18255', 2); rect(c, 10, 53, 16, 5, '#dab67b', 2);
    rect(c, 7, 13, 22, 26, '#e2c99c', 3);
    line(c, 8, 15, 28, 15, '#a78253', 1.5); line(c, 8, 37, 28, 37, '#a78253', 1.5);
    for (const x of [12, 24]) line(c, x, 17, x, 35, '#f8e4ba', 1.5);
  });

  make('casino-marquee',342,106,c=>{
    rect(c,1,1,340,104,'#e4bd6e',12);rect(c,6,6,330,94,'#321827',9);
    c.strokeStyle='#a77942';c.lineWidth=1;c.beginPath();c.roundRect(11,11,320,84,7);c.stroke();
    for(let x=17;x<332;x+=14)for(const y of [7,99])oval(c,x,y,1.8,1.8,'#fff0b3');
    label(c,'R O Y A L',171,26,12,'#f7dd9c');
    c.font='bold 39px Georgia, serif';c.fillStyle='#f8da8d';c.textAlign='center';c.fillText('CASINO',171,65);
    label(c,'♠   ♥   ♣   ♦',171,86,13,'#e5ae87');
    for(const x of [27,315]){
      for(let n=0;n<4;n++)line(c,x,80,x+(x<100?1:-1)*n*5,39,'#bb914f',1);
    }
  });
  make('card-salon-sign',342,106,c=>{
    rect(c,1,1,340,104,'#d0ab68',12);rect(c,6,6,330,94,'#263d44',9);
    c.strokeStyle='#b79763';c.lineWidth=1;c.beginPath();c.roundRect(12,12,318,82,7);c.stroke();
    label(c,'R O Y A L   /   0 3',171,27,11,'#e6cf9d');
    c.font='bold 31px Georgia, serif';c.fillStyle='#f2e0b4';c.textAlign='center';c.fillText('CARD SALON',171,63);
    label(c,'♠   ♥   ♣   ♦',171,86,15,'#daacb1');
    for(const x of [20,322])for(const y of [18,88])diamond(c,x,y,3,'#e8cb88');
  });
  make('billiard-sign',316,98,c=>{
    rect(c,0,3,316,90,'#352d23',8);rect(c,5,8,306,80,'#86704a',6);rect(c,9,12,298,72,'#284738',4);
    c.strokeStyle='#b2a77a';c.lineWidth=1;c.strokeRect(15,18,286,60);
    label(c,'R O Y A L   /   0 2',158,30,9,'#ccbf8d');
    c.font='bold 26px Georgia, serif';c.fillStyle='#eee2b9';c.textAlign='center';c.fillText('BILLIARD CLUB',158,57);
    label(c,'POOL  ·  CHESS  ·  AIR HOCKEY',158,72,7,'#afbd99');
  });
  make('casino-suits',110,90,c=>{
    rect(c,3,3,104,84,'#bd924c',6);rect(c,7,7,96,76,'#28172b',4);
    for(const [symbol,x,y,color] of [['♠',33,38,'#edcd81'],['♥',78,38,'#f2a0a9'],['♣',33,72,'#edcd81'],['♦',78,72,'#f2a0a9']] as const){
      c.shadowColor=color;c.shadowBlur=6;label(c,symbol,x,y,28,color);c.shadowBlur=0;
    }
  });
  make('casino-chips',70,82,c=>{
    rect(c,1,1,68,80,'#c79e5b',3);rect(c,5,5,60,72,'#251926');
    for(const [x,y,r,col] of [[24,28,15,'#c95667'],[42,48,17,'#e0b355']] as const){
      oval(c,x,y,r,r,col);oval(c,x,y,r-4,r-4,'#33232f');
      for(let n=0;n<8;n++){
        const a=n*Math.PI/4;line(c,x+Math.cos(a)*(r-2),y+Math.sin(a)*(r-2),x+Math.cos(a)*r,y+Math.sin(a)*r,'#f6dfb1',2.5);
      }
      label(c,x<30?'25':'100',x,y+3,7,'#f5d494');
    }
    label(c,'ROYAL',35,71,6,'#d8bc7d');
  });
  make('casino-sevens',36,76,c=>{
    rect(c,0,2,36,72,'#bc904c',4);rect(c,3,5,30,66,'#331828',2);
    for(const y of [23,43,63]){
      c.shadowColor='#f0c671';c.shadowBlur=4;label(c,'7',18,y,21,'#ffe5a6');c.shadowBlur=0;
    }
  });
  make('casino-chandelier',80,110,c=>{
    line(c,40,0,40,30,'#ddbd70',2);oval(c,40,33,5,7,'#d9b05d');
    for(const [x,y] of [[10,47],[24,58],[40,64],[56,58],[70,47]]){
      c.beginPath();c.moveTo(40,38);c.quadraticCurveTo(x,70,x,y);c.strokeStyle='#d9b76c';c.lineWidth=2;c.stroke();
      rect(c,x-3,y-13,6,13,'#f9e9b6',1);oval(c,x,y-13,3,2,'#fff8d5');
      oval(c,x,y+2,6,2,'#dcbb72');
      line(c,x,y+4,x,y+15,'#baab85',1);oval(c,x,y+20,2.5,7,'#deead4');
      line(c,x-1,y+17,x-1,y+22,'#fff9db');
    }
    line(c,40,71,40,93,'#d9b76c');diamond(c,40,101,4,'#e7e6cf');
  });
  make('billiard-lamp',156,66,c=>{
    for(const x of [28,128])line(c,x,0,x,21,'#494a36',1.3);
    line(c,12,22,144,22,'#af9561',3);
    for(const x of [28,78,128]){
      line(c,x,22,x,30,'#a89060',2);
      c.beginPath();c.moveTo(x-10,31);c.lineTo(x+10,31);c.lineTo(x+21,52);c.lineTo(x-21,52);c.closePath();c.fillStyle='#2a5944';c.fill();
      oval(c,x,52,21,4,'#d3bd87');oval(c,x,53,16,2,'#fff0bf');
      line(c,x-8,33,x+8,33,'#77a183');
    }
  });
  make('billiard-cues',82,80,c=>{
    rect(c,1,1,80,78,'#5a4530',3);rect(c,5,5,72,70,'#9d835b');
    line(c,19,14,64,64,'#eee1b8',3);line(c,64,14,19,64,'#e4d3a4',3);
    line(c,19,14,28,24,'#50756b',3);line(c,64,14,55,24,'#50756b',3);
    for(const [x,y,color] of [[42,32,'#ebe1c5'],[37,42,'#b26c4e'],[48,42,'#405a6e']] as const)oval(c,x,y,4,4,color);
    label(c,'THE CLUB',41,71,6,'#393c2e');
  });
  const pot = (c: Paint, color: string, ribbed = false) => {
    oval(c, 32, 89, 18, 4, '#15282b33');
    rect(c, 17, 61, 31, 27, color, 3);
    if (ribbed) for (let x = 21; x < 46; x += 5) line(c, x, 66, x, 84, '#ffffff24');
    oval(c, 32, 62, 16, 4, '#d0b78a'); oval(c, 32, 62, 12, 2.3, '#403b36');
    line(c, 21, 86, 44, 86, '#26343b55');
  };
  const leaf = (c: Paint, x: number, y: number, rx: number, ry: number, rotation: number, color: string) => {
    oval(c, x, y, rx, ry, color, rotation);
    line(c, x - Math.sin(rotation) * ry * .65, y + Math.cos(rotation) * ry * .65, x + Math.sin(rotation) * ry * .65, y - Math.cos(rotation) * ry * .65, '#9caf7944', .8);
  };
  make(plantTexture('arcade', 0), 62, 95, c => {
    // Palm fronds have a different silhouette from the broad leaves by the bar.
    pot(c, '#b39465', true); line(c, 32, 61, 32, 27, '#67825a', 3);
    for (const [x, y, angle] of [[11, 33, -1.05], [16, 17, -.72], [29, 11, -.13], [43, 17, .65], [51, 33, 1.05]]) {
      line(c, 32, 40, x, y, '#4c765d', 2);
      leaf(c, x, y, 6, 17, angle, '#4c896c');
      for (let n = -2; n <= 2; n++) {
        const py = y + n * 4;
        line(c, x - 5, py - 2, x + 5, py + 2, '#8aaa7855', .9);
      }
    }
  });
  make(plantTexture('arcade', 1), 62, 95, c => {
    pot(c, '#c5c1ac');
    leaf(c, 24, 55, 6, 18, -.9, '#4d8171'); leaf(c, 42, 55, 6, 17, .9, '#63917b');
    c.beginPath(); c.moveTo(31, 63); c.quadraticCurveTo(24, 8, 49, 15); c.strokeStyle = '#6b825e'; c.lineWidth = 2; c.stroke();
    for (const [x, y] of [[30, 31], [33, 20], [43, 14], [53, 17]]) {
      for (let n = 0; n < 5; n++) oval(c, x! + Math.cos(n * 1.26) * 3.5, y! + Math.sin(n * 1.26) * 3.5, 3.5, 2.8, n % 2 ? '#e9d3d0' : '#f4e6dd', n * 1.26);
      oval(c, x!, y!, 1.7, 1.7, '#c88591');
    }
  });
  make(plantTexture('arcade', 2), 62, 95, c => {
    pot(c, '#568582', true);
    for (const [x, y, angle] of [[13, 32, -.65], [25, 19, -.3], [46, 27, .7], [17, 49, -1], [42, 46, 1]]) {
      line(c, 32, 63, x!, y!, '#50755c', 2);
      leaf(c, x!, y!, 10, 15, angle!, '#49886a');
      for (const dy of [-4, 3]) line(c, x! + 3, y! + dy, x! + 8, y! + dy - 3, '#274f4a', 1.7);
    }
  });
  make(plantTexture('tables', 0), 62, 95, c => {
    pot(c, '#b98264', true);
    for (const [x, y, angle] of [[20, 31, -.18], [27, 17, -.05], [35, 25, .1], [43, 38, .28]]) {
      leaf(c, x!, y!, 4, 25, angle!, '#638770');
      line(c, x!, y! - 16, 31, 60, '#bdba7f', 1);
    }
  });
  make(plantTexture('tables', 1), 62, 95, c => {
    pot(c, '#b5a997'); line(c, 32, 63, 31, 20, '#8e7759', 3);
    for (let n = 0; n < 15; n++) {
      const x = 31 + Math.cos(n * 2.4) * (10 + n % 4 * 3), y = 12 + n % 7 * 6;
      line(c, 31, 41, x, y, '#8e7759'); leaf(c, x, y, 3, 7, Math.sin(n) * .8, n % 2 ? '#9ea782' : '#6f947e');
    }
  });
  make(plantTexture('tables', 2), 62, 95, c => {
    pot(c, '#9a6e53');
    for (let n = 0; n < 8; n++) {
      const x = 7 + n * 7, y = 18 + Math.abs(3.5 - n) * 4;
      line(c, 32, 62, x, y, '#658264', 1.5);
      for (let j = 0; j < 6; j++) {
        const t = j / 6, px = x + (32 - x) * t, py = y + (62 - y) * t;
        leaf(c, px - 3, py, 2, 5, -.9, '#6d9474'); leaf(c, px + 3, py, 2, 5, .9, '#4d8069');
      }
    }
  });
}
