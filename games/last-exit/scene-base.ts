import { mix } from './scene-kit';
import { rollPath, type StuntVariant } from './stunts';
import { zoneOf } from './route';
import { Pursuit, type Car, type Hero, type Prop } from './pursuit';
import { Bits } from './scene-bits';
import type { RacePhase } from './model';
/** Moment for the sound mix: kind, strength and lateral position from -1 to 1. */
export type SceneSound = (kind: 'hit' | 'contact' | 'blast' | 'smash' | 'rock' | 'scrape' | 'gear' | 'bridge', power: number, pan: number) => void;
export type Point = {
 x: number;
 y: number;
 s: number;
};
type P = Point;
/** Shared state and one road projection: X lateral, z distance from the camera, Y height. */
export abstract class SceneBase {
 protected c: CanvasRenderingContext2D;
 protected road: HTMLCanvasElement[] = [];
 protected gravel: HTMLCanvasElement[] = [];
 protected smoke: HTMLCanvasElement[] = [];
 protected dust: HTMLCanvasElement[] = [];
 protected black: HTMLCanvasElement[] = [];
 protected hot: HTMLCanvasElement[] = [];
 protected ember: HTMLCanvasElement[] = [];
 protected red!: HTMLCanvasElement;
 protected blue!: HTMLCanvasElement;
 protected flame!: HTMLCanvasElement;
 protected white!: HTMLCanvasElement;
 protected img: Record<string, HTMLImageElement> = {};
 protected bits = new Bits();
 protected w = 1;
 protected h = 1;
 protected hy = 1;
 protected G = 1;
 protected R = 1;
 protected U = 1;
 protected portrait = false;
 protected dist = 0;
 protected vel = 0;
 protected camX = 0;
 protected vpx = 0;
 protected carX = 0;
 protected carVX = 0;
 protected roll = 0;
 protected pitch = 0;
 protected kick = 0;
 protected shake = 0;
 protected weights = [1, 0, 0, 0];
 protected zone = 0;
 protected bridge = -99;
 protected bridgeTo = 0;
 protected phase: RacePhase = 'idle';
 protected run = '';
 protected age = 0;
 protected clock = 0;
 protected last = 0;
 protected since = 0;
 protected gear = -1;
 protected flash = 0;
 protected sim = new Pursuit({
  hit: (x, y, z, p, side) => this.onHit(x, y, z, p, side), scrape: (x, z, side, p) => this.onScrape(x, z, side, p), contact: (c, p) => this.onContact(c, p),
  wreck: c => this.onWreck(c), boom: (x, z, size, v) => this.onBoom(x, z, size, v), smash: (p, v) => this.onSmash(p, v), hero: p => this.onHero(p),
 });
 protected onHit(_x: number, _y: number, _z: number, _power: number, _side: number) { }
 protected onScrape(_x: number, _z: number, _side: number, _power: number) { }
 protected onContact(_car: Car, _power: number) { }
 protected onWreck(_car: Car) { }
 protected onBoom(_x: number, _z: number, _size: number, _speed: number) { }
 protected onSmash(_prop: Prop, _speed: number) { }
 protected onHero(_power: number) { }
 protected hero: Hero = { x: 0, vx: 0, hw: .17, z: 1.055, bias: 0 };
 protected booms: {
  x: number;
  z: number;
  age: number;
  size: number;
  v: number;
 }[] = [];
 protected stop = 0;
 protected scuff = 0;
 protected drift = 0;
 protected pose = 0;
 protected path?: ReturnType<typeof rollPath>;
 protected fired = new Set<string>();
 protected skid: {
  x: number;
  z: number;
  w: number;
  l: number;
 }[] = [];
 protected wreck = { x: 0, z: 3 };
 protected variant: StuntVariant = 'drive';
 protected zoneIndex = 0;
 protected holding = false;
 protected quality = 0;
 protected dark: Record<string, HTMLCanvasElement> = {};
 protected cliff?: HTMLCanvasElement;
 protected rocks: {
  x: number;
  y: number;
  vy: number;
  rest: number;
  size: number;
  rot: number;
  flip: number;
  hit: boolean;
  wait: number;
 }[] = [];
 protected exitAt = 0;
 protected tunnelZ = 1.055;
 protected attX = 0;
 /** Height covered by the road signs, so endings stay below them. */
 top = 0;
 speed = 0;
 rpm = 0;
 sound?: SceneSound;
 private observer: ResizeObserver;
 constructor(protected canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context)
   throw new Error('Canvas 2D unavailable');
  this.c = context;
  this.observer = new ResizeObserver(() => this.resize());
  this.observer.observe(canvas);
  this.resize();
 }
 protected release() { this.observer.disconnect(); this.bits.clear(); this.sim.cars = []; this.dark = {}; this.cliff = undefined; this.road = []; this.gravel = []; }
 protected resize() {
  const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1, d = Math.min([1.5, 1.2, 1][this.quality] ?? 1.5, devicePixelRatio || 1);
  this.w = w;
  this.h = h;
  this.canvas.width = Math.round(w * d);
  this.canvas.height = Math.round(h * d);
  this.c.setTransform(d, 0, 0, d, 0, 0);
  this.portrait = h > w * 1.05;
  this.hy = h * (this.portrait ? .49 : .5);
  this.G = h - this.hy;
  this.R = this.portrait ? w * 1.02 : Math.min(w * .79, h * 1.5);
  this.U = this.portrait ? w * .62 : Math.min(this.R * .5, h * .8);
 }
 protected get carW() { return this.portrait ? this.w * .46 : Math.min(this.w * .238, this.h * .46); }
 protected at(X: number, z: number, Y = 0): P { const s = 1 / z; return { x: this.vpx + (X - this.camX) * this.R * s, y: this.hy + this.G * s - Y * this.U * s, s }; }
 protected get carZ() { return 1.055; }
 protected get copW() { return this.portrait ? this.w * .31 : Math.min(this.w * .188, this.h * .37); }
 protected once(k: string, f: () => void) { if (this.fired.has(k))
  return; this.fired.add(k); f(); }
 protected jumpZone(value: number) { this.zone = zoneOf(value); this.weights = [0, 1, 2, 3].map(i => i === this.zone ? 1 : 0); this.bridge = -99; this.bridgeTo = this.zone; }
 protected reset() { this.fired.clear(); this.skid = []; this.bits.clear(); }
}
