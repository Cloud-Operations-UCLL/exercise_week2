import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, describeConfig, ConfigError } from '../src/config.js';

const minimal = {
  DB_HOST: 'localhost',
  DB_NAME: 'labqueue',
  DB_USER: 'labqueue',
  DB_PASSWORD: 'secret',
};

test('applies defaults when only the required variables are set', () => {
  const config = loadConfig(minimal);
  assert.equal(config.port, 8080);
  assert.equal(config.appTitle, 'Lab Queue');
  assert.equal(config.appVersion, 'dev');
  assert.equal(config.db.port, 5432);
  assert.equal(config.db.ssl, false);
});

test('reads optional variables', () => {
  const config = loadConfig({
    ...minimal,
    PORT: '3000',
    DB_PORT: '6543',
    DB_SSL: 'true',
    APP_TITLE: 'Help desk',
    APP_VERSION: 'abc123',
  });
  assert.equal(config.port, 3000);
  assert.equal(config.db.port, 6543);
  assert.equal(config.db.ssl, true);
  assert.equal(config.appTitle, 'Help desk');
  assert.equal(config.appVersion, 'abc123');
});

test('lists every missing required variable', () => {
  assert.throws(() => loadConfig({ DB_HOST: 'x' }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /DB_NAME, DB_USER, DB_PASSWORD/);
    return true;
  });
});

test('rejects an invalid port', () => {
  assert.throws(() => loadConfig({ ...minimal, PORT: 'eighty' }), ConfigError);
  assert.throws(() => loadConfig({ ...minimal, DB_PORT: '70000' }), ConfigError);
});

test('rejects an invalid boolean', () => {
  assert.throws(() => loadConfig({ ...minimal, DB_SSL: 'yes' }), ConfigError);
});

test('never exposes the password when describing the config', () => {
  const described = describeConfig(loadConfig(minimal));
  assert.equal(described.db.password, '***');
  assert.ok(!JSON.stringify(described).includes('secret'));
});
