import { useEffect, useState } from 'react';
import { DRAGON_PATH_BELT_PATH, readDragonPathBeltRounds } from '../../src/shared/dragonPathBelt';
import { WALLET_ACCOUNT_HEADER } from '../../src/shared/walletAccount';

export function usePandaBelt(account: string | null, settledRoundId: string | null) {
  const [profile, setProfile] = useState<{ rounds: number; roundId: string | null }>();
  useEffect(() => {
    if (!account) return;
    const request = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    void (async () => {
      try {
        const response = await fetch(DRAGON_PATH_BELT_PATH, {
          cache: 'no-store', credentials: 'same-origin', signal, headers: { [WALLET_ACCOUNT_HEADER]: account },
        });
        if (!response.ok) return;
        const rounds = readDragonPathBeltRounds(await response.json());
        if (!signal.aborted && rounds !== undefined) setProfile({ rounds, roundId: settledRoundId });
      } catch { /* Cosmetic progress never blocks a round. */ }
    })();
    return () => request.abort();
  }, [account, settledRoundId]);
  return profile;
}
