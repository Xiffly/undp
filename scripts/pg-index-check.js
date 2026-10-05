const { Client } = require('../apps/api/node_modules/pg');

async function run() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://crisis_user:change-me@127.0.0.1:5432/crisis_db';
  const c = new Client({ connectionString });
  await c.connect();
  try {
    const idx = await c.query("SELECT indexname FROM pg_indexes WHERE tablename='reports' ORDER BY indexname");
    console.log('PG_INDEX_COUNT=' + idx.rows.length);
    console.log('PG_INDEXES=' + idx.rows.map((r) => r.indexname).join(','));
  } finally {
    await c.end();
  }
}

run().catch((e) => {
  console.error('PG_ERR=' + e.message);
  process.exit(1);
});
