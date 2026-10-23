import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({publicDir:false,build:{outDir:'dist-admin',rollupOptions:{input:{admin:resolve('admin.html')}}}});
