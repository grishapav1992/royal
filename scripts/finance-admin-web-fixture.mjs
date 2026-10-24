import { build, preview } from 'vite';

await build({ configFile: 'vite.admin.config.ts' });
await preview({ configFile: 'vite.admin.config.ts', preview: { host: '127.0.0.1', port: 5194, strictPort: true } });
