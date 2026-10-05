import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baselineSql } from './001-baseline';
import { migrateDatabase } from './runner';

const enabled = process.env.CI === 'true' || process.env.RUN_DB_INTEGRATION === 'true';
const schema = `migration_test_${randomUUID().replace(/-/g, '')}`;
let admin: Pool;
let pool: Pool;

describe.skipIf(!enabled)('versioned PostgreSQL migrations', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('adopts a legacy schema without losing users, then records each migration once', async () => {
    await pool.query(baselineSql);
    await pool.query("INSERT INTO users (id, name, email, password_hash, role) VALUES ('legacy', 'Legacy', 'legacy@test.invalid', 'test-hash', 'admin')");
    await migrateDatabase(pool);
    await migrateDatabase(pool);
    expect((await pool.query('SELECT id FROM users WHERE id = $1', ['legacy'])).rows).toHaveLength(1);
    expect((await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows).toEqual([{ version: 1 }, { version: 2 }]);
    expect((await pool.query('SELECT direction FROM schema_migration_history')).rows).toHaveLength(2);
  });
  it('rolls back the latest migration and reapplies it with an audit trail', async () => {
    await migrateDatabase(pool, 'down');
    expect((await pool.query("SELECT to_regclass('admin_sessions') AS name")).rows[0].name).toBeNull();
    await migrateDatabase(pool);
    expect((await pool.query('SELECT direction FROM schema_migration_history ORDER BY id')).rows.map((row) => row.direction)).toEqual(['up', 'up', 'down', 'up']);
  });
  it('rejects checksum changes without altering history', async () => {
    await pool.query("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 2");
    await expect(migrateDatabase(pool)).rejects.toThrow('changed after application');
    expect((await pool.query('SELECT * FROM schema_migration_history')).rows).toHaveLength(4);
  });
});
