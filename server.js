import express from 'express';
import session from 'express-session';
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL Connection Pool (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Auto-create database tables
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      guests INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      total INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blocked_dates (
      date TEXT PRIMARY KEY,
      reason TEXT NOT NULL
    );
  `);

  const defaults = { nightly_rate: '10000', max_guests: '10', property_name: 'Casa Verde Taytay' };
  for (const [k, v] of Object.entries(defaults)) {
    await pool.query('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
}

initDb().catch(console.error);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

function iso(d) { return new Date(d + 'T00:00:00').toISOString().slice(0, 10); }
function datesBetween(a, b) {
  const out = [];
  let d = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
  while (d < e) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function conflicts(a, b) {
  const ds = datesBetween(a, b);
  if (!ds.length) return true;
  
  const q = await pool.query(
    "SELECT 1 FROM bookings WHERE status IN ('pending','paid','confirmed') AND check_in < $1 AND check_out > $2 LIMIT 1",
    [b, a]
  );
  if (q.rows.length > 0) return true;

  const blockedRes = await pool.query('SELECT date FROM blocked_dates WHERE date = ANY($1)', [ds]);
  const blocked = new Set(blockedRes.rows.map(x => x.date));
  return ds.some(x => blocked.has(x));
}

async function getSettings() {
  const res = await pool.query('SELECT key, value FROM settings');
  return Object.fromEntries(res.rows.map(x => [x.key, x.value]));
}

app.get('/api/config', async (req, res) => res.json(await getSettings()));

app.get('/api/availability', async (req, res) => {
  const from = req.query.from || iso(new Date().toISOString().slice(0, 10));
  const to = req.query.to || iso(new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10));
  
  const booked = (await pool.query(
    "SELECT check_in, check_out, status FROM bookings WHERE status IN ('pending','paid','confirmed') AND check_out > $1 AND check_in < $2",
    [from, to]
  )).rows;

  const blocked = (await pool.query(
    'SELECT date, reason FROM blocked_dates WHERE date >= $1 AND date < $2',
    [from, to]
  )).rows;

  res.json({ booked, blocked });
});

app.post('/api/bookings', async (req, res) => {
  const { checkIn, checkOut, guests, name, email, phone, paymentMethod } = req.body || {};
  const s = await getSettings();

  if (!checkIn || !checkOut || !name || !email || !phone) {
    return res.status(400).json({ error: 'Please complete all required fields.' });
  }
  if (!Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > Number(s.max_guests)) {
    return res.status(400).json({ error: `Maximum guests: ${s.max_guests}.` });
  }
  
  const nights = datesBetween(checkIn, checkOut).length;
  if (nights < 1) return res.status(400).json({ error: 'Check-out must be after check-in.' });
  if (await conflicts(checkIn, checkOut)) return res.status(409).json({ error: 'Those dates are not available.' });

  const total = nights * Number(s.nightly_rate);
  const id = 'CV-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  await pool.query(
    `INSERT INTO bookings (id, check_in, check_out, guests, name, email, phone, total, payment_method, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, checkIn, checkOut, Number(guests), name, email, phone, total, paymentMethod || 'online', 'pending', new Date().toISOString()]
  );

  res.status(201).json({ id, total, nights, status: 'pending', message: 'Reservation created. Payment is the next step.' });
});

app.get('/api/booking/:id', async (req, res) => {
  const b = (await pool.query(
    'SELECT id, check_in, check_out, guests, name, email, phone, total, payment_method, status, created_at FROM bookings WHERE id = $1',
    [req.params.id]
  )).rows[0];

  if (!b) return res.status(404).json({ error: 'Booking not found' });
  res.json(b);
});

function auth(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Admin login required.' });
}

app.post('/api/admin/login', (req, res) => {
  if (req.body.email === process.env.ADMIN_EMAIL && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid login.' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/bookings', auth, async (req, res) => {
  const bookings = (await pool.query('SELECT * FROM bookings ORDER BY check_in ASC')).rows;
  res.json(bookings);
});

app.post('/api/admin/block', auth, async (req, res) => {
  const { date, reason = 'Blocked' } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Date required' });
  await pool.query(
    'INSERT INTO blocked_dates(date, reason) VALUES($1, $2) ON CONFLICT (date) DO UPDATE SET reason = EXCLUDED.reason',
    [date, reason]
  );
  res.json({ ok: true });
});

app.delete('/api/admin/block/:date', auth, async (req, res) => {
  await pool.query('DELETE FROM blocked_dates WHERE date = $1', [req.params.date]);
  res.json({ ok: true });
});

app.post('/api/admin/booking-status', auth, async (req, res) => {
  const { id, status } = req.body || {};
  if (!['pending', 'paid', 'confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, id]);
  res.json({ ok: true });
});

app.post('/api/admin/settings', auth, async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (['nightly_rate', 'max_guests'].includes(k)) {
      await pool.query(
        'INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [k, String(v)]
      );
    }
  }
  res.json(await getSettings());
});

app.post('/api/webhooks/payment', async (req, res) => {
  const { bookingId, status } = req.body || {};
  if (bookingId && ['paid', 'cancelled'].includes(status)) {
    await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, bookingId]);
  }
  res.json({ received: true });
});

const server = app.listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 10000}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
