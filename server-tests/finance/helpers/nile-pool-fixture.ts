import { createECDH } from 'node:crypto';
import { nilePublicKeyAddress } from '../../../server/finance/nile-address';
import type { NileDepositPool } from '../../../server/finance/nile-deposit-pool';
export const customerPool: NileDepositPool = { version: 1, network: 'nile', asset: 'USDT_NILE_TEST', startHeight: 101, addresses: [21, 22, 23].map(n => {
        const e = createECDH('secp256k1');
        e.setPrivateKey(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
        const publicKey = e.getPublicKey('hex', 'uncompressed');
        return { userId: 'nile_customer_' + n, address: nilePublicKeyAddress(publicKey), publicKey };
    }) };
