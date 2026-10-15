import { PostgresDatabase } from '../server/database';

export async function withRestoredDatabase<T>(file: string, callback: (database: PostgresDatabase) => Promise<T>) {
  const database = await PostgresDatabase.restore(file);
  try { return await callback(database); }
  finally { await database.dropSchema(); await database.close(); }
}
