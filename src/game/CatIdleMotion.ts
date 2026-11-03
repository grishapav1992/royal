import type Phaser from 'phaser';

type IdlePose = 'sleeping' | 'seated';
const PADDING = 12;
let nextTexture = 0;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Deform the existing painting locally, keeping the resting paws anchored. */
export class CatIdleMotion {
  private texture: Phaser.Textures.CanvasTexture | null;
  private frames: Record<IdlePose, Phaser.Textures.Frame>;
  private pose?: IdlePose;
  private elapsed = 0;
  private drawnAt = -Infinity;

  constructor(private scene: Phaser.Scene, atlas: string) {
    const source = scene.textures.get(atlas);
    this.frames = { sleeping: source.get('16'), seated: source.get('17') };
    this.texture = scene.textures.createCanvas(
      'cat-idle-' + nextTexture++,
      Math.max(...Object.values(this.frames).map(frame => frame.cutWidth)) + PADDING * 2,
      Math.max(...Object.values(this.frames).map(frame => frame.cutHeight)) + PADDING,
    );
    if (this.texture) for (const [pose, frame] of Object.entries(this.frames)) {
      this.texture.add(pose, 0, 0, 0, frame.cutWidth + PADDING * 2, frame.cutHeight + PADDING);
    }
    scene.events.once('shutdown', () => {
      if (this.texture) scene.textures.remove(this.texture.key);
      this.texture = null;
    });
  }

  frame(pose: IdlePose | undefined, dt: number) {
    if (pose !== this.pose) {
      this.pose = pose;
      this.elapsed = 0;
      this.drawnAt = -Infinity;
    }
    if (!pose || !this.texture) return;
    // Advance only while visible and animated. A resumed tab cannot skip ahead.
    this.elapsed += Math.max(0, Math.min(dt, .1));
    if (this.elapsed - this.drawnAt >= 1 / 30) {
      this.draw(pose);
      this.drawnAt = this.elapsed;
    }
    return { key: this.texture.key, frame: pose };
  }

  private draw(pose: IdlePose) {
    const texture = this.texture!, context = texture.getContext();
    const frame = this.frames[pose], image = frame.source.image as HTMLImageElement;
    const { cutX: sx, cutY: sy, cutWidth: width, cutHeight: height } = frame;
    context.clearRect(0, 0, texture.width, texture.height);
    if (pose === 'sleeping') {
      const breath = .5 - .5 * Math.cos(this.elapsed * Math.PI * 2 / 3.6);
      const anchor = Math.floor(height * .74);
      for (let x = 0; x < width; x++) {
        const u = x / width;
        // The sleeping face at the left and the paws below the belly stay still.
        const back = smooth((u - .3) / .22) * (1 - smooth((u - .84) / .16));
        const lift = anchor * .065 * breath * back;
        context.drawImage(image, sx + x, sy, 1, anchor,
          PADDING + x, PADDING - lift, 1, anchor + lift);
      }
      context.drawImage(image, sx, sy + anchor, width, height - anchor,
        PADDING, PADDING + anchor, width, height - anchor);
    } else {
      const breath = .5 - .5 * Math.cos(this.elapsed * Math.PI * 2 / 3.2);
      const cycle = this.elapsed % 9.2;
      const tilt = cycle < 2.4 ? Math.sin(cycle / 2.4 * Math.PI) ** 2 : 0;
      const direction = Math.floor(this.elapsed / 9.2) % 2 ? -1 : 1;
      const sway = Math.sin(this.elapsed * Math.PI * 2 / 5.6);
      for (let y = 0; y < height; y++) {
        const v = y / height;
        const upper = 1 - smooth((v - .38) / .4);
        const chest = smooth((v - .28) / .16) * (1 - smooth((v - .62) / .2));
        const shift = upper * (sway * 1.2 + (height * .46 - y) * .018 * tilt * direction);
        const expand = width * .018 * breath * chest;
        context.drawImage(image, sx, sy + y, width, 1,
          PADDING + shift - expand / 2, PADDING + y, width + expand, 1);
      }
    }
    texture.refresh();
  }
}
