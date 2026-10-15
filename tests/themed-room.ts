import { test as base } from '@playwright/test';
import { securityRoom } from './security-room';

export const test = base.extend<{ roomPath: string }>({
  roomPath: async ({ request }, use) => {
    const host = await securityRoom(request);
    try { await use('/?room=' + host.room.roomId); }
    finally { await Promise.race([host.room.leave(), new Promise(resolve => setTimeout(resolve, 1500))]); }
  },
});
