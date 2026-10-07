import { loadConfig, describeConfig, ConfigError } from './config.js';
import { createPool, migrate, waitForDatabase } from './db.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

console.log('Starting Lab Queue with config:', JSON.stringify(describeConfig(config)));

const pool = createPool(config.db);
pool.on('error', (err) => console.error(`Database pool error: ${err.message}`));

try {
  await waitForDatabase(pool);
  await migrate(pool);
  console.log('Database ready, schema up to date');
} catch (err) {
  console.error(`Could not prepare the database, exiting: ${err.message || err.code || err}`);
  await pool.end().catch(() => {});
  process.exit(1);
}

const state = { shuttingDown: false };
const app = createApp({ pool, config, state });

const server = app.listen(config.port, () => {
  console.log(`Lab Queue ${config.appVersion} listening on port ${config.port}`);
});

// Kubernetes sends SIGTERM when it stops a pod. Stop accepting work, finish what is running, then exit.
function shutdown(signal) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end().catch(() => {});
    console.log('Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Shutdown took too long, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
