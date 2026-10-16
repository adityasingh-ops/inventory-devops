const express = require('express');
const client = require('prom-client');
const db = require('./db');

const app = express();
app.use(express.json());

// ---------- Prometheus metrics ----------
client.collectDefaultMetrics();
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
});

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const labels = { method: req.method, route: req.route ? req.baseUrl + req.route.path : req.path, status: res.statusCode };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
});

// ---------- Health ----------
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: err.message });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ---------- Items REST API ----------
app.get('/api/items', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM items ORDER BY id');
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/items/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.post('/api/items', async (req, res, next) => {
  const { name, quantity = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO items (name, quantity) VALUES ($1, $2) RETURNING *',
      [name, quantity]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

app.put('/api/items/:id', async (req, res, next) => {
  const { name, quantity } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await db.query(
      'UPDATE items SET name = $1, quantity = $2 WHERE id = $3 RETURNING *',
      [name, quantity ?? 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.delete('/api/items/:id', async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Item not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
