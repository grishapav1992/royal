import type Phaser from 'phaser';
import { CAT_CARE } from '../shared/catCare';

/** Permanent belongings stay in the room even while the cat is elsewhere. */
export function drawCatCare(scene: Phaser.Scene) {
  const { bar, food, scratcher } = CAT_CARE;
  const mug=scene.add.graphics().setDepth(bar.depth+2).setName('cat-water-mug');
  const {x,y}=bar.mug;
  mug.fillStyle(0x131723,.2).fillEllipse(x+1,y+8,25,7);
  mug.lineStyle(3,0xe9e4d9).strokeEllipse(x+9,y,8,9);
  mug.fillStyle(0xddd7c8).fillRoundedRect(x-8,y-5,16,15,4);
  mug.fillStyle(0xfff8ea).fillEllipse(x,y-5,16,6);
  mug.fillStyle(0x8ac8da).fillEllipse(x,y-5,12,4);
  mug.lineStyle(1,0xe1f5f5).lineBetween(x-3,y-6,x+3,y-6);
  mug.fillStyle(0x786c78).fillEllipse(x,y+4,4,3);
  for(const [dx,dy] of [[-3,1],[0,0],[3,1]])mug.fillCircle(x+dx,y+dy,1.1);

  const bowl=scene.add.graphics().setDepth(food.bowl.y+2).setName('cat-food-bowl');
  const bx=food.bowl.x,by=food.bowl.y;
  bowl.fillStyle(0xb09b88,.8).fillRoundedRect(bx-31,by-14,62,28,10);
  bowl.lineStyle(1,0xd1bba1,.8).strokeRoundedRect(bx-28,by-11,56,22,8);
  bowl.fillStyle(0x171b29,.2).fillEllipse(bx+2,by+6,35,12);
  bowl.fillStyle(0x647e85).fillRoundedRect(bx-17,by-5,34,13,6);
  bowl.fillStyle(0xb8d3d4).fillEllipse(bx,by-5,34,14);
  bowl.fillStyle(0x5d4838).fillEllipse(bx,by-5,27,9);
  for(const [dx,dy] of [[-8,-6],[-2,-7],[5,-6],[10,-4],[-5,-3],[2,-3]]) {
    bowl.fillStyle(0xb57d49).fillEllipse(bx+dx,by+dy,5,3);
    bowl.fillStyle(0xd3a268).fillEllipse(bx+dx-.8,by+dy-.5,2,1);
  }
  bowl.fillStyle(0xe7e7d5).fillEllipse(bx,by+4,4,3);
  for(const dx of [-3,0,3])bowl.fillCircle(bx+dx,by+1,1);

  const post=scene.add.graphics().setDepth(scratcher.post.y+2).setName('cat-scratching-post');
  const sx=scratcher.post.x,sy=scratcher.post.y;
  post.fillStyle(0x171b29,.18).fillEllipse(sx+3,sy+5,46,14);
  post.fillStyle(0x6b5d57).fillRoundedRect(sx-22,sy-7,44,17,7);
  post.fillStyle(0xb7a49b).fillRoundedRect(sx-22,sy-11,44,16,7);
  post.lineStyle(1,0xd2c0b1).strokeRoundedRect(sx-19,sy-9,38,11,5);
  post.fillStyle(0x8e6a42).fillRoundedRect(sx-8,sy-70,16,66,4);
  post.fillStyle(0xc6a875).fillRect(sx-7,sy-67,11,59);
  for(let row=0;row<20;row++) {
    const py=sy-65+row*2.8;
    post.lineStyle(1.4,0x84623f,.8).lineBetween(sx-7,py,sx+7,py+2);
    post.lineStyle(.7,0xe2c79b,.9).lineBetween(sx-6,py-.7,sx+5,py+1.3);
  }
  post.fillStyle(0xd6bd93).fillEllipse(sx,sy-70,18,7);
  post.lineStyle(1,0x8f714f).strokeEllipse(sx,sy-70,18,7);
  post.fillStyle(0x75635d).fillEllipse(sx+12,sy-1,4,3);
  for(const dx of [-2,0,2])post.fillCircle(sx+12+dx,sy-4,1);
}
