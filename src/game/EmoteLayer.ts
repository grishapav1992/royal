import type Phaser from 'phaser';
import { t } from '../i18n';
import { EMOTES, emoteIcon, type EmoteId } from '../shared/emotes';
import './street-play.css';

/** Characters that answer a wave (Mira, the dealers) and floor-2 tables that cheer back with confetti. */
export type EmoteNpc = { id: string; anchor: { x: number; y: number }; near: { x: number; y: number }; depth: number };
export type EmoteContext = { selfId: string; npcs: readonly EmoteNpc[]; tables: readonly { id: string; anchor: { x: number; y: number }; near: { x: number; y: number } }[] };
export type EmoteActor = { id: string; sprite: Phaser.GameObjects.Sprite; label?: Phaser.GameObjects.Text; seated: boolean; emote: string; emoteUntil: number; visible: boolean };

/**
 * Shows emotes for everyone in the hall: an icon above the name and a small gesture.
 * Runs after the characters are placed for the frame, so offsets never accumulate.
 */
export class EmoteLayer {
  private icons = new Map<string, Phaser.GameObjects.Text>();
  private toggle = document.createElement('button');
  private row = document.createElement('div');
  private root = document.createElement('div');
  private open = false;
  private last = '';
  private lastSelf = 0;
  private replies = new Map<string, { text: Phaser.GameObjects.Text; from: number; until: number }>();
  private bursts: { g: Phaser.GameObjects.Graphics; x: number; y: number; started: number; kind: 'confetti' | 'clink' }[] = [];
  private clinked = new Set<string>();
  private reactions = 0;
  private context: EmoteContext = { selfId: '', npcs: [], tables: [] };
  constructor(private scene: Phaser.Scene, private send: (id: EmoteId) => boolean, private canUse: () => boolean) {
    this.root.className = 'emote-bar'; this.root.id = 'emote-bar';
    this.toggle.type = 'button'; this.toggle.id = 'emote-toggle'; this.toggle.textContent = '😊 ' + t('Эмоции');
    this.toggle.setAttribute('aria-expanded', 'false'); this.toggle.setAttribute('aria-controls', 'emote-row');
    this.toggle.onclick = () => this.setOpen(!this.open);
    this.row.id = 'emote-row'; this.row.className = 'emote-row'; this.row.hidden = true;
    for (const emote of EMOTES) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.emote = emote.id; button.textContent = emote.icon;
      button.title = `${emote.label} · ${emote.key}`; button.setAttribute('aria-label', `${emote.label}, ${t('клавиша')} ${emote.key}`);
      button.onclick = () => { this.use(emote.id); this.setOpen(false); };
      this.row.append(button);
    }
    this.root.append(this.row, this.toggle);
    document.querySelector('.room-panel')?.append(this.root);
    const keys = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const emote = EMOTES.find(e => e.key === event.key);
      if (emote && this.canUse()) this.use(emote.id);
      if (event.key === 'Escape' && this.open) this.setOpen(false);
    };
    document.addEventListener('keydown', keys);
    scene.events.once('shutdown', () => { document.removeEventListener('keydown', keys); this.root.remove(); });
  }
  private setOpen(open: boolean) { this.open = open; this.row.hidden = !open; this.toggle.setAttribute('aria-expanded', String(open)); }
  use(id: EmoteId) { this.last = id; return this.send(id); }
  update(actors: readonly EmoteActor[], overview: boolean, reducedMotion: boolean, online: boolean, context: EmoteContext = { selfId: '', npcs: [], tables: [] }) {
    this.root.hidden = !online || overview;
    const now = Date.now(), seen = new Set<string>();
    for (const actor of actors) {
      if (!actor.emote || actor.emoteUntil <= now || !actor.visible) continue;
      seen.add(actor.id);
      let icon = this.icons.get(actor.id);
      if (!icon) { icon = this.scene.add.text(0, 0, '', { fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif', fontSize: '22px' }).setOrigin(.5, 1); this.icons.set(actor.id, icon); }
      const sprite = actor.sprite, elapsed = (actor.emoteUntil - now), phase = now / 1000;
      const top = actor.label?.visible ? actor.label.y - actor.label.height - 2 : sprite.y - 96;
      icon.setText(emoteIcon(actor.emote)).setPosition(sprite.x, top - (reducedMotion ? 0 : Math.abs(Math.sin(phase * 4)) * 4)).setDepth(3100).setVisible(!overview).setAlpha(Math.min(1, elapsed / 300));
      if (reducedMotion || actor.seated) continue;
      // Small gestures on top of the ordinary pose.
      if (actor.emote === 'dance') { sprite.setY(sprite.y - Math.abs(Math.sin(phase * 6)) * 7); sprite.setAngle(Math.sin(phase * 6) * 9); }
      else if (actor.emote === 'wave') sprite.setAngle(Math.sin(phase * 10) * 5);
      else if (actor.emote === 'clap' || actor.emote === 'cheers') sprite.setScale(sprite.scaleX * (1 + Math.abs(Math.sin(phase * 12)) * .03), sprite.scaleY);
      else if (actor.emote === 'laugh') sprite.setY(sprite.y - Math.abs(Math.sin(phase * 14)) * 2);
    }
    for (const [id, icon] of this.icons) if (!seen.has(id)) { icon.destroy(); this.icons.delete(id); }
    this.context = context;
    this.react(actors, overview, reducedMotion, context, now);
  }
  /** A fresh emote by this visitor draws a local answer from the hall around them. */
  private react(actors: readonly EmoteActor[], overview: boolean, reducedMotion: boolean, context: EmoteContext, now: number) {
    const self = actors.find(a => a.id === context.selfId);
    if (self && self.emote && self.emoteUntil > now && self.emoteUntil !== this.lastSelf) {
      this.lastSelf = self.emoteUntil;
      const at = { x: self.sprite.x, y: self.sprite.y };
      if (self.emote === 'wave') for (const npc of context.npcs) if (Math.hypot(npc.near.x - at.x, npc.near.y - at.y) < 230) {
        let reply = this.replies.get(npc.id);
        if (!reply) { reply = { text: this.scene.add.text(npc.anchor.x, npc.anchor.y, '👋', { fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif', fontSize: '22px' }).setOrigin(.5, 1).setDepth(3100), from: 0, until: 0 }; this.replies.set(npc.id, reply); }
        reply.from = now + 450; reply.until = now + 2600; this.reactions++;
      }
      if (self.emote === 'clap' || self.emote === 'cheers') for (const table of context.tables) if (Math.hypot(table.near.x - at.x, table.near.y - at.y) < 260) {
        this.bursts.push({ g: this.scene.add.graphics().setDepth(3050), x: table.anchor.x, y: table.anchor.y, started: now, kind: 'confetti' }); this.reactions++;
      }
    }
    // Two visitors raising glasses together get a small shared sparkle.
    const cheering = actors.filter(a => a.emote === 'cheers' && a.emoteUntil > now);
    for (let i = 0; i < cheering.length; i++) for (let j = i + 1; j < cheering.length; j++) {
      const a = cheering[i], b = cheering[j], key = [a.id, b.id].sort().join(':') + ':' + Math.max(a.emoteUntil, b.emoteUntil);
      if (this.clinked.has(key) || Math.hypot(a.sprite.x - b.sprite.x, a.sprite.y - b.sprite.y) > 150) continue;
      this.clinked.add(key); this.reactions++;
      this.bursts.push({ g: this.scene.add.graphics().setDepth(3050), x: (a.sprite.x + b.sprite.x) / 2, y: Math.min(a.sprite.y, b.sprite.y) - 70, started: now, kind: 'clink' });
    }
    if (this.clinked.size > 50) this.clinked.clear();
    for (const [id, reply] of this.replies) {
      if (now > reply.until) { reply.text.destroy(); this.replies.delete(id); continue; }
      reply.text.setVisible(!overview && now >= reply.from).setY(context.npcs.find(n => n.id === id)?.anchor.y ?? reply.text.y);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i], k = (now - burst.started) / (burst.kind === 'clink' ? 700 : 1600);
      const g = burst.g.clear().setVisible(!overview);
      if (k >= 1) { g.destroy(); this.bursts.splice(i, 1); continue; }
      if (burst.kind === 'clink') {
        const r = 6 + k * 18;
        for (let n = 0; n < 8; n++) { const a = n / 8 * Math.PI * 2; g.lineStyle(2, 0xf6cf58, 1 - k).lineBetween(burst.x + Math.cos(a) * r * .4, burst.y + Math.sin(a) * r * .4, burst.x + Math.cos(a) * r, burst.y + Math.sin(a) * r); }
        continue;
      }
      const colors = [0xf6cf58, 0xeb91af, 0x75cbd9, 0x7bcaa1, 0xc6a0ed];
      for (let n = 0; n < 22; n++) {
        const a = -Math.PI / 2 + (n / 21 - .5) * 2.4, speed = 60 + (n * 37) % 70;
        const x = burst.x + Math.cos(a) * speed * k * (reducedMotion ? .4 : 1), y = burst.y + Math.sin(a) * speed * k + (reducedMotion ? 0 : 90 * k * k);
        g.fillStyle(colors[n % colors.length], 1 - k).fillRect(x - 2.5, y - 1.5, 5, 3);
      }
    }
  }
  setActive() { for (const r of this.replies.values()) r.text.destroy(); this.replies.clear(); for (const b of this.bursts) b.g.destroy(); this.bursts = []; }
  getState() { return { visible: !this.root.hidden, open: this.open, last: this.last, shown: [...this.icons.keys()], reactions: this.reactions, replies: [...this.replies.keys()], npcs: this.context.npcs.map(n => ({ id: n.id, near: n.near })), tables: this.context.tables.map(t => ({ id: t.id, near: t.near })) }; }
}
