import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { baselineSql } from './001-baseline';
import { logger } from '../observability/logger';

export const migrations = [
  { version: 1, name: 'baseline', up: baselineSql, down: null },
  {
    version: 2,
    name: 'admin_sessions',
    up: `CREATE TABLE admin_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);`,
    down: 'DROP TABLE admin_sessions;',
  },
] as const;

export async function migrateDatabase(pool: Pool, mode: 'up' | 'down' | 'status' = 'up') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '60s'");
    await client.query('SELECT pg_advisory_xact_lock(19471001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); CREATE TABLE IF NOT EXISTS schema_migration_history (
      id BIGSERIAL PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL,
      direction TEXT NOT NULL, executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);
    const applied = (await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version'
    )).rows;
    for (const row of applied) {
      const migration = migrations.find((entry) => entry.version === row.version);
      if (!migration || createHash('sha256').update(migration.up).digest('hex') !== row.checksum) {
        throw new Error(`Migration ${row.version} is unknown or has changed after application`);
      }
    }
    if (mode === 'status') {
      await client.query('COMMIT');
      return applied;
    }
    const latest = applied[applied.length - 1];
    const pending = mode === 'down'
      ? migrations.filter((entry) => entry.version === latest?.version)
      : migrations.filter((entry) => !applied.some((row) => row.version === entry.version));
    for (const migration of pending) {
      if (mode === 'down' && !migration.down) {
        throw new Error('Baseline rollback is unavailable: restore a verified pre-migration backup instead');
      }
      await client.query(mode === 'up' ? migration.up : migration.down!);
      if (mode === 'up') {
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, createHash('sha256').update(migration.up).digest('hex')]);
      } else {
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
      }
      await client.query('INSERT INTO schema_migration_history (version, name, direction) VALUES ($1, $2, $3)',
        [migration.version, migration.name, mode]);
    }
    await client.query('COMMIT');
    for (const migration of pending) logger.info('db.migration.completed', { version: migration.version, direction: mode });
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('db.migration.failed', { error });
    throw error;
  } finally {
    client.release();
  }
}
