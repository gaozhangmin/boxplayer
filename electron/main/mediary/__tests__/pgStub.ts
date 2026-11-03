// Test-only stand-in for `pg`. The vendored mediary workflow index re-exports its Postgres
// adapter; BoxPlayer stores everything in SQLite and never opens a Postgres pool.
class Pool {
  constructor() {
    throw new Error('Postgres is not available in BoxPlayer; use the SQLite workflow repository')
  }
}

export type { Pool }
export type PoolClient = never
export default { Pool }
