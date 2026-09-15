import postgres from 'postgres';
import { config } from '../config.js';

/** Single shared connection pool. Column names stay snake_case — the storefront depends on them. */
export const sql = postgres(config.DATABASE_URL, {
  max: config.ROLE === 'worker' ? 6 : 16,
  idle_timeout: 30,
  connect_timeout: 15,
  onnotice: () => {},
  transform: { undefined: null },
});

export type Sql = typeof sql;
/** Transaction handle as passed to sql.begin callbacks. */
export type Tx = postgres.TransactionSql<Record<string, never>>;

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
