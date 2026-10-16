// Tiny migration runner: applies every .sql file in /migrations once, in order.
const fs = require('fs');
const path = require('path');
const db = require('./db');

// Wait for Postgres to accept connections (it may start after the backend)
async function waitForDb(retries = 30) {
  for (let i = 1; ; i++) {
    try {
      return await db.query('SELECT 1');
    } catch (err) {
      if (i >= retries) throw err;
      console.log(`Database not ready (${err.message}), retry ${i}/${retries}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function migrate() {
  await waitForDb();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rowCount } = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rowCount) continue;
    console.log(`Applying migration ${file}`);
    await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }
  console.log('Migrations up to date');
}

migrate()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
