import { test, expect } from '@playwright/test';
import { DEFAULT_APPEARANCE } from '../src/shared/appearance';

test('server rejects malformed appearances without changing the saved profile', async ({ request }) => {
  await request.post('/api/auth/login', { data: { email: `validation-${crypto.randomUUID()}@example.test`, password: 'Validation-test-123!' } });
  const valid = { ...DEFAULT_APPEARANCE, tattoo: 5, body: 1 };
  expect((await request.post('/api/auth/character', { data: { appearance: valid, name: 'Сохранённое имя' } })).ok()).toBe(true);
  for (const invalid of [{ ...valid, hat: 1000 }, { ...valid, body: -1 }, { ...valid, tattoo: 1.2 }, { ...valid, topColor: '#ff0000' }, { ...valid, makeup: 6 }, { ...valid, makeupColor: '#ff0000' }, { ...valid, version: 2 }, { ...valid, script: '<script>' }, { version: 1 }, null]) {
    expect((await request.post('/api/auth/character', { data: { appearance: invalid, name: 'Не сохранять' } })).status()).toBe(400);
  }
  const account = (await request.get('/api/auth/me').then(response => response.json())).account;
  expect(account.appearance).toEqual(valid); expect(account.name).toBe('Сохранённое имя');
});
