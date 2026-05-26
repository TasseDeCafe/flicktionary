import postgres from 'postgres'
import { getConfig } from '../../config/environment-config'

export const sql: postgres.Sql = postgres(getConfig().supabaseConnectionString)

// Run `cb` inside a transaction with a usable, fully-typed `tx`. postgres.js types
// TransactionSql as `Omit<Sql, ...>`, and Omit on a callable interface strips the
// tagged-template call signature — so the raw transaction handle isn't callable and
// isn't assignable to Sql. We cast it back to Sql here, in this one place, so callers
// get a typed `tx` and never need a per-query `(tx as any)`.
// TODO: drop the cast (pass `txRaw` through untouched, or inline `sql.begin`) once
// postgres.js fixes the TransactionSql types: https://github.com/porsager/postgres/issues/1150
export const beginTx = <T>(cb: (tx: postgres.Sql) => T | Promise<T>) =>
  sql.begin((txRaw) => cb(txRaw as unknown as postgres.Sql))
