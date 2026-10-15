import assert from 'node:assert/strict';
export async function rejectedStore(create: () => {
    ready: Promise<void>;
    close(): Promise<void>;
}, expected?: RegExp | ((error: unknown) => boolean)) {
    const store = create();
    try {
        if (expected)
            await assert.rejects(store.ready, expected);
        else
            await assert.rejects(store.ready);
    }
    finally {
        await store.close();
    }
}
