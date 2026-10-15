import { gameAudio } from './GameAudio';
import Phaser from 'phaser';
export type BreakerStatus = { score: number; lives: number; phase: 'ready' | 'playing' | 'won' | 'lost' };
export function createBreaker(parent: HTMLElement, onStatus: (state: BreakerStatus) => void) {
  class Breaker extends Phaser.Scene {
    private paddle!: Phaser.GameObjects.Rectangle;
    private ball!: Phaser.GameObjects.Arc;
    private blocks: Phaser.GameObjects.Rectangle[] = [];
    private keys!: Phaser.Types.Input.Keyboard.CursorKeys;
    private velocity = { x: 145, y: -245 };
    private state: BreakerStatus = { score: 0, lives: 3, phase: 'ready' };
    private trail: Phaser.GameObjects.Arc[] = [];
    constructor() { super('breaker'); }
    create() {
      const g = this.add.graphics();
      g.fillStyle(0xa9d9e2).fillRect(0, 0, 640, 450);
      g.fillStyle(0x72968f).fillTriangle(0, 370, 180, 145, 370, 370);
      g.fillStyle(0xfff8e3).fillTriangle(129, 210, 180, 145, 235, 210);
      g.fillStyle(0x497867).fillTriangle(280, 430, 480, 200, 690, 430);
      g.fillStyle(0xfff8e3).fillTriangle(435, 253, 480, 200, 528, 253);
      g.fillStyle(0xf8f1db).fillRect(0, 408, 640, 42);
      g.lineStyle(3, 0x342f2a).strokeRect(14, 12, 612, 425);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 9; col++) {
        const block = this.add.rectangle(64 + col * 64, 63 + row * 28, 56, 18, [0xe35b42, 0xf2c745, 0x4e9b97, 0x9975b4][row]).setStrokeStyle(2, 0x342f2a);
        this.blocks.push(block);
      }
      this.paddle = this.add.rectangle(320, 400, 96, 11, 0xe44f3e).setStrokeStyle(2, 0x342f2a);
      this.trail = Array.from({ length: 6 }, (_, i) => this.add.circle(320, 380, 4 - i * .4, 0xe44f3e, .35 - i * .05));
      this.ball = this.add.circle(320, 385, 7, 0xfff7dc).setStrokeStyle(2, 0x342f2a);
      this.keys = this.input.keyboard!.createCursorKeys();
      this.input.keyboard!.on('keydown-SPACE', () => this.start());
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => { this.paddle.x = Phaser.Math.Clamp(p.x, 65, 575); });
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.paddle.x = Phaser.Math.Clamp(p.x, 65, 575); this.start(); });
      this.publish();
    }
    start() {
      if (this.state.phase === 'playing') return;
      if (this.state.phase === 'won' || this.state.phase === 'lost') { this.restart(); }
      gameAudio.effect('start');this.state.phase = 'playing'; this.velocity = { x: 145 * (Math.random() > .5 ? 1 : -1), y: -245 }; this.publish();
    }
    restart() {
      this.blocks.forEach(b => b.setVisible(true).setActive(true));
      this.state = { score: 0, lives: 3, phase: 'ready' }; this.paddle.x = 320; this.publish();
    }
    private publish() { onStatus({ ...this.state }); }
    getState() { return { ...this.state, ball: { x: this.ball.x, y: this.ball.y }, paddleX: this.paddle.x, blocks: this.blocks.filter(b => b.active).length }; }
    update(_time: number, delta: number) {
      if (!this.paddle) return;
      const dt = Math.min(delta, 40) / 1000;
      if (this.keys.left.isDown) this.paddle.x = Math.max(65, this.paddle.x - dt * 440);
      if (this.keys.right.isDown) this.paddle.x = Math.min(575, this.paddle.x + dt * 440);
      if (this.state.phase !== 'playing') { this.ball.setPosition(this.paddle.x, 383); this.trail.forEach(t => t.setPosition(this.ball.x, this.ball.y)); return; }
      for (let i = this.trail.length - 1; i > 0; i--) this.trail[i]!.setPosition(this.trail[i - 1]!.x, this.trail[i - 1]!.y);
      this.trail[0]!.setPosition(this.ball.x, this.ball.y);
      for (let n = 0; n < 3; n++) {
        const beforeX = this.ball.x, beforeY = this.ball.y;
        this.ball.x += this.velocity.x * dt / 3; this.ball.y += this.velocity.y * dt / 3;
        if (this.ball.x < 23) {gameAudio.effect('bounce'); this.ball.x = 23; this.velocity.x = Math.abs(this.velocity.x); }
        if (this.ball.x > 617) {gameAudio.effect('bounce'); this.ball.x = 617; this.velocity.x = -Math.abs(this.velocity.x); }
        if (this.ball.y < 22) {gameAudio.effect('bounce'); this.ball.y = 22; this.velocity.y = Math.abs(this.velocity.y); }
        if (this.velocity.y > 0 && this.ball.y >= 388 && this.ball.y < 410 && Math.abs(this.ball.x - this.paddle.x) < 55) {
          gameAudio.effect('bounce');this.ball.y = 387; const offset = (this.ball.x - this.paddle.x) / 50;
          this.velocity.x = offset * 245; this.velocity.y = -Math.sqrt(Math.max(18000, 320 * 320 - this.velocity.x ** 2));
        }
        const hit = this.blocks.find(b => b.active && Math.abs(this.ball.x - b.x) < 34 && Math.abs(this.ball.y - b.y) < 15);
        if (hit) {
          gameAudio.effect('block');hit.setActive(false).setVisible(false);
          if (Math.abs(beforeX - hit.x) >= 34) this.velocity.x *= -1; else this.velocity.y *= -1;
          this.ball.setPosition(beforeX, beforeY);
          this.state.score += 100;
          const spark = this.add.rectangle(hit.x, hit.y, 56, 18, hit.fillColor, .7);
          this.tweens.add({ targets: spark, scale: 1.5, alpha: 0, duration: 200, onComplete: () => spark.destroy() });
          if (this.blocks.every(b => !b.active)) {this.state.phase = 'won';gameAudio.effect('win');}
          this.publish();
        }
        if (this.ball.y > 444) {gameAudio.effect('lose'); this.state.lives--; this.state.phase = this.state.lives ? 'ready' : 'lost'; this.publish(); break; }
      }
    }
  }
  const scene = new Breaker();
  const game = new Phaser.Game({ type: Phaser.AUTO, parent, width: 640, height: 450, backgroundColor: '#101624', scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true }, audio: { noAudio: true } });
  return { game, start: () => scene.start(), restart: () => scene.restart(), getState: () => scene.getState() };
}
