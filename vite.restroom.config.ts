import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

const api = process.env.ROYAL_DEV_API_URL || 'http://127.0.0.1:2764';
// Built clients use the production WebSocket paths on their own origin.
export default mergeConfig(base, defineConfig({
  preview: { proxy: {
    '/matchmake': api,
    '^/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+(?:\\?.*)?$': { target: api, ws: true },
  } },
}));
