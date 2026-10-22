import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    watch:{ignored:['**/module-dist/**','**/module-build/**']},
    proxy: {
      '/api': { target: process.env.ROYAL_DEV_API_URL || 'http://127.0.0.1:2567' },
      '/game-modules': { target: process.env.ROYAL_DEV_API_URL || 'http://127.0.0.1:2567' },
      '/multiplayer': { target: process.env.ROYAL_DEV_API_URL || 'http://127.0.0.1:2567', ws: true, rewrite: path => path.replace(/^\/multiplayer/, '') },
    },
  },
});
