// Reads all configuration from environment variables.
// Nothing is hard-coded: the same image must run on a laptop, in CI and in Kubernetes.
// See docs/application.md for the full list.

const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

export class ConfigError extends Error {}

function parsePort(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${name} must be a port number between 1 and 65535, got "${value}"`);
  }
  return port;
}

function parseBool(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const v = value.toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`${name} must be "true" or "false", got "${value}"`);
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'See docs/application.md for what the app expects.',
    );
  }

  return {
    port: parsePort('PORT', env.PORT, 8080),
    appTitle: env.APP_TITLE || 'Lab Queue',
    appVersion: env.APP_VERSION || 'dev',
    db: {
      host: env.DB_HOST,
      port: parsePort('DB_PORT', env.DB_PORT, 5432),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl: parseBool('DB_SSL', env.DB_SSL, false),
    },
  };
}

// Safe to print: everything except the password.
export function describeConfig(config) {
  const { password, ...db } = config.db;
  return { ...config, db: { ...db, password: password ? '***' : '' } };
}
