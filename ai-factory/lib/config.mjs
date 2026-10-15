import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function fileSecret(name, fallback = '') {
  const path = process.env[`${name}_FILE`];
  return path ? readFileSync(path, 'utf8').trim() : (process.env[name] || fallback);
}

export function config() {
  const prefix = process.env.URL_PREFIX || '/team';
  if (!/^\/[a-z0-9/-]*$/.test(prefix)) throw new Error('Invalid URL_PREFIX');
  return {
    data: resolve(process.env.FACTORY_DATA || './data'),
    source: resolve(process.env.PROJECT_SOURCE || '../'),
    workspaces: resolve(process.env.WORKSPACES_DIR || './workspaces'),
    artifacts: resolve(process.env.FACTORY_ARTIFACTS_DIR || './artifacts'),
    databaseUrl: fileSecret('FACTORY_DATABASE_URL'),
    origin: process.env.APP_ORIGIN || 'http://localhost:2580',
    prefix,
    port: Number(process.env.PORT || 2580),
    host: process.env.HOST || '127.0.0.1',
    production: process.env.NODE_ENV === 'production',
    graphUrl: process.env.KNOWLEDGE_GRAPH_URL || '',
  };
}
