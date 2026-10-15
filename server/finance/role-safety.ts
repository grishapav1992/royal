import { existsSync, readFileSync } from 'node:fs';
import type { Pool } from 'pg';

const source = new URL('./role-safety.sql', import.meta.url);
export const ROLE_SAFETY_SQL = readFileSync(existsSync(source) ? source : new URL('../finance-assets/role-safety.sql', import.meta.url), 'utf8');

export async function roleViolations(pool: Pool, profile: 'runtime' | 'observer'): Promise<number> {
  const { rows } = await pool.query('SELECT royal_finance.role_safety(current_user,$1) AS violations', [profile]);
  return rows[0].violations;
}
