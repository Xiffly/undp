import { Pool } from 'pg';
import { migrateDatabase } from './migrations/runner';
import { seedRuntimeData } from './db/seed';
import { logger } from './observability/logger';

const DATABASE_URL = process.env.DATABASE_URL || '';
export const isPostgres = Boolean(DATABASE_URL);
const pgPool = new Pool({ connectionString: DATABASE_URL });
pgPool.on('error', (error) => {
  logger.error('db.pool.failed', { error });
});

function transformSql(sql: string): string {
  let out = sql;
  
  out = out.replace(/datetime\('now'\)/g, 'NOW()');
  out = out.replace(/datetime\('now',\s*'-1 day'\)/g, "(NOW() - INTERVAL '1 day')");
  out = out.replace(/datetime\('now',\s*'-24 hours'\)/g, "(NOW() - INTERVAL '24 hours')");
  out = out.replace(/datetime\('now',\s*'-1 hour'\)/g, "(NOW() - INTERVAL '1 hour')");
  out = out.replace(/strftime\('%H',\s*submitted_at\)/g, "to_char(submitted_at, 'HH24')");

  let placeholderIndex = 0;
  let transformed = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  const isPlaceholderBoundary = (char?: string) => {
    if (!char) return true;
    return /\s|[,(=<>!+\-*/%]/.test(char);
  };

  for (let i = 0; i < out.length; i += 1) {
    const current = out[i];
    const next = out[i + 1];
    const prev = out[i - 1];

    if (inLineComment) {
      transformed += current;
      if (current === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      transformed += current;
      if (current === '*' && next === '/') {
        transformed += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      transformed += current;
      if (current === "'" && next === "'") {
        transformed += next;
        i += 1;
        continue;
      }
      if (current === "'") inSingleQuote = false;
      continue;
    }

    if (inDoubleQuote) {
      transformed += current;
      if (current === '"') inDoubleQuote = false;
      continue;
    }

    if (current === '-' && next === '-') {
      transformed += current + next;
      i += 1;
      inLineComment = true;
      continue;
    }

    if (current === '/' && next === '*') {
      transformed += current + next;
      i += 1;
      inBlockComment = true;
      continue;
    }

    if (current === "'") {
      transformed += current;
      inSingleQuote = true;
      continue;
    }

    if (current === '"') {
      transformed += current;
      inDoubleQuote = true;
      continue;
    }

    if (current === '?') {
      const prevIsBoundary = isPlaceholderBoundary(prev);
      const nextIsJsonOperator = next === '|' || next === '&';
      const nextStartsLiteralOrIdentifier = next === "'" || next === '"' || /[A-Za-z_]/.test(next || '');

      if (!nextIsJsonOperator && (prevIsBoundary || !nextStartsLiteralOrIdentifier)) {
        transformed += `$${++placeholderIndex}`;
        continue;
      }
    }

    transformed += current;
  }

  out = transformed;

  return out;
}

export async function queryAll<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pgPool.query(transformSql(sql), params);
  return r.rows as T[];
}

export async function queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await pgPool.query(transformSql(sql), params);
  return (r.rows[0] as T) || undefined;
}

export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pgPool.query(transformSql(sql), params);
  return r.rowCount || 0;
}

export async function executeBatch(sql: string): Promise<void> {
  await pgPool.query(transformSql(sql));
}

export async function closeRuntimeDb(): Promise<void> { await pgPool.end(); }

export interface TransactionDb {
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<number>;
}

export async function withTransaction<T>(work: (db: TransactionDb) => Promise<T>): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await work({
      queryOne: async <Row>(sql: string, params: unknown[] = []) =>
        (await client.query(transformSql(sql), params)).rows[0] as Row | undefined,
      execute: async (sql: string, params: unknown[] = []) =>
        (await client.query(transformSql(sql), params)).rowCount || 0,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function initRuntimeDb(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required for PostgreSQL runtime');
  }

  await migrateDatabase(pgPool);

  await seedRuntimeData();
}
