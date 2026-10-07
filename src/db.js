import pg from 'pg';

const SCHEMA_LOCK_ID = 424242;

export function createPool(dbConfig) {
  return new pg.Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
}

// Creates the table if it does not exist yet.
// Several replicas can start at the same moment, so the migration runs under an
// advisory lock: only one pod creates the schema, the others wait and then see it exists.
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id          SERIAL PRIMARY KEY,
        student     TEXT        NOT NULL CHECK (char_length(student) BETWEEN 1 AND 80),
        question    TEXT        NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
        status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ
      )
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Tries to reach the database a number of times before giving up.
// Giving up means the process exits, so Kubernetes will restart the pod (CrashLoopBackOff).
export async function waitForDatabase(pool, { attempts = 10, delayMs = 3000, log = console } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      log.warn(`Database not reachable (attempt ${i}/${attempts}): ${err.message || err.code || err}`);
      if (i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
