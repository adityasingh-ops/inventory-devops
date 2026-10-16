// The database is mocked, so tests never touch a real/production database.
jest.mock('../src/db', () => ({ query: jest.fn() }));

const request = require('supertest');
const db = require('../src/db');
const app = require('../src/app');

beforeEach(() => db.query.mockReset());

test('GET /health returns ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('GET /api/items returns the list of items', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 1, name: 'Laptop', quantity: 5 }] });
  const res = await request(app).get('/api/items');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].name).toBe('Laptop');
});

test('POST /api/items creates an item', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 2, name: 'Mouse', quantity: 10 }] });
  const res = await request(app).post('/api/items').send({ name: 'Mouse', quantity: 10 });
  expect(res.status).toBe(201);
  expect(res.body.id).toBe(2);
});

test('POST /api/items without name returns 400', async () => {
  const res = await request(app).post('/api/items').send({ quantity: 1 });
  expect(res.status).toBe(400);
  expect(db.query).not.toHaveBeenCalled();
});

test('PUT /api/items/:id updates an item', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 1, name: 'Laptop Pro', quantity: 3 }] });
  const res = await request(app).put('/api/items/1').send({ name: 'Laptop Pro', quantity: 3 });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('Laptop Pro');
});

test('DELETE /api/items/:id returns 204', async () => {
  db.query.mockResolvedValue({ rowCount: 1 });
  const res = await request(app).delete('/api/items/1');
  expect(res.status).toBe(204);
});

test('GET /api/items/:id returns 404 when missing', async () => {
  db.query.mockResolvedValue({ rows: [] });
  const res = await request(app).get('/api/items/999');
  expect(res.status).toBe(404);
});

test('GET /metrics returns Prometheus metrics', async () => {
  const res = await request(app).get('/metrics');
  expect(res.status).toBe(200);
  expect(res.text).toContain('http_requests_total');
});
