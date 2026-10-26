import Phaser from 'phaser';
import { CABINETS } from '../shared/cabinets';
import { CABINET_SIZE, paintCabinet } from './cabinetArt';
import { createInteriorArt } from './interiorArt';

export const ART_RESOLUTION = 3;
type Paint = CanvasRenderingContext2D;
const ink = '#251e2c';
const box = (c: Paint, x: number, y: number, w: number, h: number, color: string, radius = 1) => {
  c.beginPath(); c.roundRect(x, y, w, h, radius); c.fillStyle = color; c.fill(); c.strokeStyle = ink; c.lineWidth = 1.5; c.stroke();
};
const oval = (c: Paint, x: number, y: number, rx: number, ry: number, color: string) => {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill(); c.strokeStyle = ink; c.lineWidth = 1.2; c.stroke();
};
const line = (c: Paint, x: number, y: number, x2: number, y2: number, color = ink, width = 1.5) => {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
};
const label = (c: Paint, text: string, x: number, y: number, size = 8, color = ink) => {
  c.font = `900 ${size}px Arial, sans-serif`; c.fillStyle = color; c.textAlign = 'center'; c.fillText(text, x, y);
};

/** Flat cut-paper props use the original dimensions and interaction footprints. */
export function createDetailedArt(scene: Phaser.Scene) {
  const make = (key: string, w: number, h: number, draw: (c: Paint) => void) => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, w * ART_RESOLUTION, h * ART_RESOLUTION)!;
    const c = texture.context; c.scale(ART_RESOLUTION, ART_RESOLUTION); c.lineJoin = 'round'; draw(c); texture.refresh();
  };
  make('pool', 208, 134, c => {
    for (const x of [17, 181]) box(c, x, 88, 12, 42, '#80543a');
    box(c, 2, 13, 202, 95, '#785039', 6); box(c, 2, 2, 202, 96, '#bd7b42', 6);
    box(c, 13, 12, 180, 74, '#31885b', 3);
    for (const [x, y] of [[14,14],[191,14],[14,85],[191,85],[103,13],[103,85]]) oval(c,x,y,5,5,ink);
    for (const [x,y,color] of [[72,43,'#fff7df'],[126,47,'#f4c938'],[134,42,'#e84b41'],[134,52,'#4b83bc'],[142,47,'#ef8932']] as const) oval(c,x,y,3.4,3.4,color);
    line(c,38,26,107,67,'#f3d299',3); label(c,'ROYAL',103,104,5,'#fff0c9');
  });
  make('sofa',158,82,c=>{
    for(const x of [12,140])box(c,x,62,6,17,'#684431');
    box(c,4,6,150,60,'#542e40',7); box(c,10,9,138,27,'#895064',5);
    for(let n=0;n<3;n++){
      box(c,17+n*42,12,40,22,'#a36376',4);box(c,17+n*42,36,40,26,'#834459',3);
      line(c,23+n*42,40,51+n*42,40,'#ab6a7d',1);
      oval(c,37+n*42,23,1.4,1.4,'#704358');
    }
    box(c,3,27,13,42,'#a76579',4);box(c,142,27,13,42,'#a76579',4);
    box(c,24,20,23,20,'#dfbd78',3);box(c,109,20,23,20,'#69968c',3);
    line(c,29,24,42,36,'#af895a',1);line(c,29,36,42,24,'#af895a',1);
    for(const x of [114,120,126])line(c,x,23,x,37,'#94b1a0',1);
    line(c,18,67,141,67,'#c5a472',2);
  });
  make('table',112,66,c=>{
    for(const x of [13,94])box(c,x,31,6,31,'#704b33');
    box(c,3,8,104,36,'#85573a',3);box(c,3,3,104,33,'#dba76a',3);
    box(c,21,12,30,18,'#f7e7bd');line(c,26,18,45,18);line(c,26,23,41,23);
    oval(c,81,23,11,4,'#fff4d7');box(c,76,12,11,11,'#f5cf49',2);oval(c,81.5,12,5.5,2,'#694132');
    box(c,58,14,10,17,'#375568',2);box(c,60,16,6,10,'#93ced7');
  });
  CABINETS.forEach((cabinet, i) => make(`cabinet-${i}`, CABINET_SIZE.width, CABINET_SIZE.height, c => paintCabinet(c, cabinet)));
  createInteriorArt(scene, ART_RESOLUTION);
  make('bar-back',248,99,c=>{
    box(c,1,1,246,97,'#b59057');box(c,6,5,236,90,'#273e48');
    for(let x=12;x<240;x+=46)box(c,x,9,39,79,'#334e59');
    for(const y of [34,72]){
      for(let n=0;n<10;n++){
        const x=15+n*23,col=['#689a87','#d2a75b','#a36a74','#7198a7'][n%4]!;
        if(n%5===3){
          box(c,x,y-16,10,15,'#9caeb0',2);box(c,x+2,y-9,6,7,col,1);
          line(c,x+2,y-13,x+2,y-5,'#e1e3cf',1);
        }else{
          const h=17+(n*7+y)%7,w=n%5===4?12:8;
          box(c,x,y-h,w,h,col,n%5===4?4:2);box(c,x+w/2-2,y-h-6,4,8,col,1);
          box(c,x+1,y-11,w-2,5,n%2?'#ecddbf':'#3d5a5e',1);
          line(c,x+2,y-h+5,x+2,y-14,'#c9d4bd',.8);
        }
      }
      box(c,7,y,234,5,'#bd965b');line(c,9,y+5,239,y+5,'#90c0af',1.5);
    }
  });
  make('bar-front',262,72,c=>{
    box(c,7,27,248,43,'#523941');
    for(let x=17;x<250;x+=47){box(c,x,33,41,31,'#66484c',2);line(c,x+5,38,x+36,38,'#ad8961',1);}
    box(c,1,12,260,17,'#303446',2);line(c,3,29,259,29,'#e7bd72',3);line(c,18,66,244,66,'#f0c55d',3);
    oval(c,44,16,8,2,'#cfb890');box(c,40,3,8,13,'#dfddbe');box(c,41,9,6,6,'#e0b265');
    oval(c,127,16,8,2,'#cfb890');box(c,122,6,10,9,'#eddfc0',2);oval(c,134,10,3,3,'#eddfc0');oval(c,127,6,5,2,'#624a3f');
    box(c,205,3,8,13,'#c8d4c6');box(c,206,10,6,5,'#b06f83');line(c,211,0,209,9,'#e6d5aa',1);
  });
  make('bar-stool',48,44,c=>{
    box(c,22,12,4,26,'#656863');oval(c,24,38,15,3,'#7c7c70');
    oval(c,24,11,18,7,'#603147');oval(c,24,7,18,6,'#ad526d');
  });
}
