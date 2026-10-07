// These tests use a fake database pool, so they run without PostgreSQL (for example in CI).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const config = { appTitle: 'Test Queue', appVersion: 'test-1' };

function fakePool({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail) throw new Error('connection refused');
      if (sql.startsWith('INSERT')) {
        return { rows: [{ id: 1, student: params[0], question: params[1], status: 'open' }] };
      }
      return { rows: [] };
    },
  };
}

async function startServer(pool, state) {
  const app = createApp({ pool, config, state });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

let healthy;
let broken;

before(async () => {
  healthy = await startServer(fakePool());
  broken = await startServer(fakePool({ fail: true }));
});

after(() => {
  healthy.server.close();
  broken.server.close();
});

test('GET /healthz is ok even when the database is down', async () => {
  const res = await fetch(`${broken.url}/healthz`);
  assert.equal(res.status, 200);
});

test('GET /readyz is ok when the database answers', async () => {
  const res = await fetch(`${healthy.url}/readyz`);
  assert.equal(res.status, 200);
});

test('GET /readyz returns 503 when the database is down', async () => {
  const res = await fetch(`${broken.url}/readyz`);
  assert.equal(res.status, 503);
});

test('GET /readyz returns 503 while shutting down', async () => {
  const { server, url } = await startServer(fakePool(), { shuttingDown: true });
  const res = await fetch(`${url}/readyz`);
  assert.equal(res.status, 503);
  server.close();
});

test('GET /api/info reports version and hostname', async () => {
  const res = await fetch(`${healthy.url}/api/info`);
  const body = await res.json();
  assert.equal(body.version, 'test-1');
  assert.equal(body.title, 'Test Queue');
  assert.ok(body.hostname);
});

test('POST /api/tickets validates input', async () => {
  const res = await fetch(`${healthy.url}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student: '', question: 'help' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/tickets creates a ticket', async () => {
  const res = await fetch(`${healthy.url}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student: ' Ada ', question: 'My pod is Pending' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.student, 'Ada');
});

test('GET /api/tickets returns 500 when the database is down', async () => {
  const res = await fetch(`${broken.url}/api/tickets`);
  assert.equal(res.status, 500);
});

test('GET / serves the web page', async () => {
  const res = await fetch(`${healthy.url}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Lab Queue/);
});
