import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

// A production bundle uses the public root for Colyseus, rather than /multiplayer.
export default mergeConfig(base, defineConfig({
  preview: { proxy: {
    ...base.server?.proxy,
    '^/(?:matchmake(?:/|$)|[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+(?:\\?|$))': { target: 'http://127.0.0.1:2591', ws: true },
  } },
}));
