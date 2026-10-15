import { nileHex } from './nile-address';
import { gameAccountId, nileUnits } from '../../src/shared/nileWallet';

export const MAINNET_GENESIS = '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc';
// Official issuer reference: https://tether.to/en/supported-protocols/
export const MAINNET_USDT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const MAINNET_USDT_TOKEN = nileHex(MAINNET_USDT_ADDRESS);
export const MAINNET_ORIGINS = ['https://api.trongrid.io', 'https://api.tronstack.io'] as const;
export type MainnetConfig = { version: 1; network: 'tron-mainnet'; token: string; genesis: string; accountId: string;
  playerAddress: string; serviceAddress: string; anchorHeight: number; anchorHash: string; openingReserveUnits: string };
export class UsdtError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function usdtFail(code: string, status = 409): never { throw new UsdtError(code, status); }
export function validateMainnetConfig(value: unknown): MainnetConfig {
  const row = value as MainnetConfig;
  try {
    if (!row || Object.keys(row).sort().join(',') !== 'accountId,anchorHash,anchorHeight,genesis,network,openingReserveUnits,playerAddress,serviceAddress,token,version'
      || row.version !== 1 || row.network !== 'tron-mainnet' || row.genesis !== MAINNET_GENESIS || row.token !== MAINNET_USDT_TOKEN
      || !gameAccountId(row.accountId) || !Number.isSafeInteger(row.anchorHeight) || row.anchorHeight < 1
      || !/^[a-f0-9]{64}$/.test(row.anchorHash) || BigInt('0x' + row.anchorHash.slice(0, 16)) !== BigInt(row.anchorHeight)
      || !nileUnits(row.openingReserveUnits) || BigInt(row.openingReserveUnits) > 10n ** 18n) throw new Error();
    const player = nileHex(row.playerAddress), service = nileHex(row.serviceAddress);
    if (player === service || [player, service].includes(MAINNET_USDT_TOKEN) || [player, service].includes('41' + '0'.repeat(40))) throw new Error();
    return row;
  } catch { return usdtFail('invalid_mainnet_config', 503); }
}
