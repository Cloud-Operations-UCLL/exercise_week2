import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Builds the Express app. The database pool is passed in so tests can use a fake one.
export function createApp({ pool, config, state = { shuttingDown: false } }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  // One log line per request, to stdout. In Kubernetes you read these with `kubectl logs`.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/healthz' || req.path === '/readyz') return;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  // Liveness: is the process alive and able to answer? Never touches the database.
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: can this pod do useful work right now? Checks the database.
  app.get('/readyz', async (req, res) => {
    if (state.shuttingDown) {
      return res.status(503).json({ status: 'shutting down' });
    }
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready', database: 'ok' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', database: err.message || err.code || String(err) });
    }
  });

  // Which pod answered, and which version is it running? Handy to see load balancing and rollouts.
  app.get('/api/info', (req, res) => {
    res.json({
      title: config.appTitle,
      version: config.appVersion,
      hostname: os.hostname(),
      node: process.version,
    });
  });

  app.get('/api/tickets', async (req, res, next) => {
    try {
      const status = req.query.status;
      if (status !== undefined && status !== 'open' && status !== 'resolved') {
        return res.status(400).json({ error: 'status must be "open" or "resolved"' });
      }
      const { rows } = status
        ? await pool.query('SELECT * FROM tickets WHERE status = $1 ORDER BY created_at ASC', [status])
        : await pool.query('SELECT * FROM tickets ORDER BY created_at ASC');
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tickets', async (req, res, next) => {
    try {
      const student = typeof req.body?.student === 'string' ? req.body.student.trim() : '';
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      const errors = [];
      if (student.length < 1 || student.length > 80) errors.push('student must be 1-80 characters');
      if (question.length < 1 || question.length > 500) errors.push('question must be 1-500 characters');
      if (errors.length > 0) return res.status(400).json({ error: errors.join(', ') });

      const { rows } = await pool.query(
        'INSERT INTO tickets (student, question) VALUES ($1, $2) RETURNING *',
        [student, question],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tickets/:id/resolve', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid id' });
      const { rows } = await pool.query(
        `UPDATE tickets SET status = 'resolved', resolved_at = now()
         WHERE id = $1 AND status = 'open' RETURNING *`,
        [id],
      );
      if (rows.length === 0) return res.status(404).json({ error: 'no open ticket with that id' });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.use(express.static(publicDir));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`Error handling ${req.method} ${req.originalUrl}: ${err.message}`);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
