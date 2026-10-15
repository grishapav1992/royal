import { applySchemaMigration, type SchemaMigration } from '../database-migrations';
import type { PostgresDatabase } from '../database';

const migrations: Record<'nile-deposits' | 'nile-play' | 'mainnet', SchemaMigration> = {
    'nile-deposits': { id: 'nile-deposits-query-indexes-v1', statements: [], indexes: [
        { name: 'nile_entries_account_v1', table: 'entries', columns: ['account'] },
        { name: 'nile_credits_user_recent_v1', table: 'credits', columns: ['user_id', 'height DESC', 'tx_id', 'log_index'] },
    ] },
    'nile-play': { id: 'nile-play-query-indexes-v1', statements: [], indexes: [
        { name: 'play_entries_account_v1', table: 'entries', columns: ['account'] },
        { name: 'play_events_kind_seq_v1', table: 'events', columns: ['kind', 'seq'] },
        { name: 'play_funding_user_seq_v1', table: 'events', columns: ["(payload::jsonb->>'userId')", 'seq'], where: "kind='funding'" },
        { name: 'play_round_account_seq_v1', table: 'events', columns: ["(payload::jsonb->>'accountId')", 'seq'], where: "kind='round'" },
        { name: 'play_round_account_time_v1', table: 'events', columns: ["(payload::jsonb->>'accountId')", "((payload::jsonb->>'createdAt')::bigint)"], where: "kind='round'" },
    ] },
    'mainnet': { id: 'mainnet-query-indexes-v1', statements: [], indexes: [
        { name: 'mainnet_events_kind_seq_v1', table: 'events', columns: ['kind', 'seq'] },
        { name: 'mainnet_transfer_owner_seq_v1', table: 'events', columns: ["(payload::jsonb->>'owner')", 'seq'], where: "kind='transfer'" },
        { name: 'mainnet_round_time_v1', table: 'events', columns: ["((payload::jsonb->>'createdAt')::bigint)"], where: "kind='round'" },
    ] },
};

export async function migrateFinanceQueries(db: PostgresDatabase, kind: keyof typeof migrations) {
    await applySchemaMigration(db, migrations[kind]);
}
