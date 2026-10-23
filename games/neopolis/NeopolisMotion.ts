import type { BattleCue, NeopolisAudio, ScheduledAccent } from './NeopolisAudio';

export type Accent = { cue: BattleCue; variant?: number };
export type MotionOptions = { signal: AbortSignal; paused: () => boolean; fast: boolean; audio?: NeopolisAudio };
type Marker = { at: number; sounds: Accent[]; visual: () => void; tickets?: ScheduledAccent[]; fired: boolean };

/** Visible-time animation, with sound scheduled for its audible output position.
 * Markers survive pauses; canceled audio is rearmed only for an unshown marker. */
export function motionClock(element: HTMLElement, options: MotionOptions, tick: (elapsed: number, delta: number) => boolean) {
  const win = element.ownerDocument.defaultView!, markers = new Map<string, Marker>();
  let request = 0, elapsed = 0, last = win.performance.now(), closed = false, wasPaused = false;
  let resolve!: () => void;
  const done = new Promise<void>(finish => { resolve = finish; });
  const unschedule = () => { for (const marker of markers.values()) if (!marker.fired) { marker.tickets?.forEach(ticket => ticket.cancel()); marker.tickets = undefined; } };
  const visibility = () => { last = win.performance.now(); if (element.ownerDocument.hidden) unschedule(); };
  const cancel = () => {
    if (closed) return;
    closed = true; win.cancelAnimationFrame(request); unschedule();
    options.signal.removeEventListener('abort', cancel); element.ownerDocument.removeEventListener('visibilitychange',visibility); resolve();
  };
  const cue = (key: string, at: number, sounds: Accent[], visual: () => void = () => {}) => {
    if (!closed && !markers.has(key)) markers.set(key,{at,sounds,visual,fired:false});
  };
  const frame = (now: number) => {
    if (closed) return;
    const paused = options.paused(), delta = Math.max(0,now-last); last = now;
    if (paused) { if (!wasPaused) unschedule(); wasPaused = true; }
    else {
      elapsed += wasPaused ? 0 : delta; wasPaused = false;
      const active = tick(elapsed, Math.min(50,delta));
      for (const marker of markers.values()) {
        if (marker.fired) continue;
        const until = marker.at - elapsed;
        if (marker.tickets?.some(ticket => !ticket.valid())) { marker.tickets.forEach(ticket=>ticket.cancel()); marker.tickets=undefined; }
        if (!marker.tickets && until <= (options.audio?.leadMs ?? 0) + 90) {
          const tickets = marker.sounds.flatMap(sound => {
            const ticket = options.audio?.schedule(sound.cue,Math.max(0,until),sound.variant);
            return ticket ? [ticket] : [];
          });
          marker.tickets=tickets.length ? tickets : undefined;
        }
        if (until <= 0) {
          marker.fired = true; marker.visual();
          marker.tickets?.forEach(ticket => options.audio?.markVisual(ticket,now));
        }
      }
      if (!active) { cancel(); return; }
    }
    request = win.requestAnimationFrame(frame);
  };
  options.signal.addEventListener('abort',cancel,{once:true}); element.ownerDocument.addEventListener('visibilitychange',visibility);
  if (options.signal.aborted) cancel(); else request = win.requestAnimationFrame(frame);
  return {done,cancel,cue};
}

export function waitMotion(element: HTMLElement, duration: number, options: MotionOptions) {
  return motionClock(element,options,elapsed => elapsed < duration).done;
}

export const accentLead = (options: MotionOptions) => Math.max(36,(options.audio?.leadMs ?? 0)+24);
