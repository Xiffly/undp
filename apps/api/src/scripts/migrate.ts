import '../loadEnv';
import { Pool } from 'pg';
import { migrateDatabase } from '../migrations/runner';
import { logger } from '../observability/logger';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const mode = process.argv[2] || 'up';
  if (mode !== 'up' && mode !== 'down' && mode !== 'status') throw new Error('Use up, down, or status');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await migrateDatabase(pool, mode);
    if (mode === 'status') console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => { logger.error('db.migrate.failed', { error }); process.exitCode = 1; });
