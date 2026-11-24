import { rng } from './scene-kit';
export type Bit = {
 kind: 'puff' | 'spark' | 'shard' | 'fire' | 'panel' | 'cone' | 'chip';
 x: number;
 y: number;
 z: number;
 vx: number;
 vy: number;
 vz: number;
 age: number;
 life: number;
 size: number;
 grow: number;
 spin: number;
 rot: number;
 alpha: number;
 tint: number;
 k: number;
 gravity: number;
 bounce: number;
 front: boolean;
 pin: boolean;
};
export class Bits {
 list: Bit[] = [];
 limit = 520;
 private r = rng(77);
 rand(a = 0, b = 1) { return a + this.r() * (b - a); }
 add(b: Partial<Bit> & {
  kind: Bit['kind'];
 }) { if (this.list.length > this.limit)
  this.list.shift(); this.list.push({ x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: .1, grow: 0, spin: 0, rot: this.rand(0, 6.3), alpha: 1, tint: 0, k: Math.floor(this.rand(0, 4)), gravity: 0, bounce: 0, front: true, pin: false, ...b }); }
 step(dt: number, flow: number) {
  for (const b of this.list) {
   b.age += dt;
   b.vy -= b.gravity * dt;
   b.x += b.vx * dt;
   b.y += b.vy * dt;
   b.z += b.vz * dt - (b.pin ? 0 : flow * dt);
   b.size += b.grow * dt;
   b.rot += b.spin * dt;
   if (b.y < 0 && b.gravity > 0) {
    b.y = 0;
    b.vy = Math.abs(b.vy) * b.bounce;
    b.vx *= .6;
    b.spin *= .5;
   }
  }
  this.list = this.list.filter(b => b.age < b.life && b.z > .42);
 }
 clear() { this.list = []; }
}
