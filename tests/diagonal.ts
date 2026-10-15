import type { Page } from '@playwright/test';

export const diagonalTrace = (page: Page, remoteId?: string, duration = 450) => page.evaluate(({ remoteId, duration }) => new Promise<{ facing: string; frame: string; x: number; y: number }[]>(resolve => {
  const samples: { facing: string; frame: string; x: number; y: number }[] = [];
  const start = performance.now();
  function sample() {
    const state = (window as any).royalDemo.getState();
    const actor = remoteId ? state.remotePositions.find((p: any) => p.id === remoteId) : state;
    samples.push({ facing: actor.frame.split('-')[0], frame: actor.frame, x: actor.x, y: actor.y });
    if (performance.now() - start < duration) requestAnimationFrame(sample);
    else resolve(samples);
  }
  requestAnimationFrame(sample);
}), { remoteId, duration });
